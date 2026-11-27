// Selling minutes with nobody at the till.
//
// 1. The buyer (in the app or on /buy) picks minutes and gets an order with an exact
//    amount to pay. Amounts are kept unique among open orders (5,940, then 5,941 ...),
//    so a payment of that amount can only belong to one order.
// 2. They pay 09 424 469 168 with KBZPay or WavePay and upload the receipt screenshot.
//    Gemini reads it: a finished transfer, the right amount, the right receiver, and a
//    transaction ID no other order has used.
// 3. The owner's Android phone forwards each wallet notification (MacroDroid, see the
//    README) to /mf/pay-inbox/<PHONE_TOKEN>. Gemini reads that too.
// 4. When a screenshot and a real "money received" notification agree (same amount, and
//    the same transaction ID when both show one), the order is paid: a new code is made,
//    or the buyer's code is topped up, and the app or page picks it up on its next check.
//
// A screenshot alone never gives minutes, because a screenshot can be edited or reused.
// Free trials: one 5-minute code per device, with per-network and per-day limits.

import buyPage from "./buy.html";
import { LATER_EXPIRY, TRIAL_DAYS, daysFromNow, fail, json, newCode, normalizeCode, validDays } from "./common.js";

const GOOGLE = "https://generativelanguage.googleapis.com";
const VISION_MODEL = "gemini-3.8-flash";
const TEXT_MODEL = "gemini-3.5-flash-lite";

export const PRICE = 99;                 // Ks a minute
const PAY_TO = "09 424 469 168";
const PAY_TAIL = "9168";                 // receipts often mask the number: ******9168
const MIN_MINUTES = 10, MAX_MINUTES = 6000;
const ORDER_DAYS = 2;                    // an unpaid order can be paid within 2 days
const ORDERS_PER_HOUR = 8;               // per network
const SHOT_TRIES = 6;                    // screenshot checks per order
const MAX_SHOT_BYTES = 6 * 1024 * 1024;
const TRIAL_MINUTES = 5, TRIALS_PER_NETWORK = 2, TRIALS_PER_DAY = 40;
const RECOVERIES_PER_HOUR = 10;          // per network
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,100}\.[^\s@]{2,}$/;

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const DAY = 86_400_000;
const ks = (n) => Number(n).toLocaleString("en-US");
const digits = (s) => String(s || "").replace(/\D/g, "");
const cleanTxn = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "") || null;

// Routes anyone can call. Returns null when the path isn't the shop's.
export async function shop(request, env, url) {
  const p = url.pathname, post = request.method === "POST";
  if (p === "/buy") return new Response(buyPage, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  if (p === "/mf/orders" && post) return await createOrder(request, env, url);
  let m = p.match(/^\/mf\/orders\/([a-z0-9]{16})$/);
  if (m && request.method === "GET") return await showOrder(env, url, m[1]);
  m = p.match(/^\/mf\/orders\/([a-z0-9]{16})\/screenshot$/);
  if (m && post) return await screenshot(request, env, url, m[1]);
  if (p === "/mf/trial" && post) return await trial(request, env);
  if (p === "/mf/recover" && post) return await recover(request, env);
  m = p.match(/^\/mf\/pay-inbox\/([^/]+)$/);
  if (m && post) return await inbox(request, env, decodeURIComponent(m[1]));
  return null;
}

// ---------------------------------------------------------------- orders

function randomId() {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => abc[b % abc.length]).join("");
}

// A network fingerprint for rate limits. Hashed, so no IP addresses are kept.
async function network(request) {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mf:" + ip));
  return [...new Uint8Array(hash)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function publicOrder(order, url) {
  const paid = order.status === "paid";
  return {
    id: order.id, minutes: order.minutes, amount: order.amount, status: order.status,
    reason: order.reason || null, topup: order.topup || null, code: paid ? order.code : null,
    expired: !paid && Date.now() - Date.parse(order.created_at) > ORDER_DAYS * DAY,
    days: validDays(order.minutes), expires_at: paid ? order.expires_at || null : null,
    pay_to: PAY_TO, wallets: ["KBZPay", "WavePay"], note: "Myanmar Flow",
    buy_url: `${url.origin}/buy?order=${order.id}`,
  };
}

// The order, with its code's expiry once it has one.
const getOrder = (env, id) => env.DB.prepare(
  "SELECT orders.*, codes.expires_at FROM orders LEFT JOIN codes ON codes.code = orders.code WHERE orders.id = ?",
).bind(id).first();

async function createOrder(request, env, url) {
  const body = await request.json().catch(() => ({}));
  const minutes = Math.round(Number(body.minutes));
  // Name and email let a buyer get the code back later (with the payment's transaction ID).
  const name = String(body.name || "").trim().slice(0, 80);
  const email = String(body.email || "").trim().toLowerCase();
  if (!name || !EMAIL.test(email) || email.length > 160) return fail(400, "mf_bad_contact", "Name and a valid email are needed");
  if (!(minutes >= MIN_MINUTES && minutes <= MAX_MINUTES)) return fail(400, "mf_bad_minutes", `Minutes must be ${MIN_MINUTES}-${MAX_MINUTES}`);
  let topup = null;
  if (body.code) {
    topup = normalizeCode(body.code);
    const row = topup && await env.DB.prepare("SELECT disabled FROM codes WHERE code = ?").bind(topup).first();
    if (!row) return fail(404, "mf_code_invalid", "No such code");
    if (row.disabled) return fail(403, "mf_code_disabled", "This code is turned off");
  }
  const net = await network(request);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE net = ? AND created_at > ?").bind(net, ago(3_600_000)).first();
  if (recent.n >= ORDERS_PER_HOUR) return fail(429, "mf_too_many", "Too many orders, try again later");

  // The exact amount to pay, unique among orders that could still be paid.
  const { results } = await env.DB.prepare("SELECT amount FROM orders WHERE status != 'paid' AND created_at > ?").bind(ago(ORDER_DAYS * DAY)).all();
  const taken = new Set(results.map((r) => r.amount));
  let amount = minutes * PRICE;
  while (taken.has(amount)) amount++;

  const order = { id: randomId(), minutes, amount, topup, status: "new", created_at: new Date().toISOString() };
  await env.DB.prepare("INSERT INTO orders (id, minutes, amount, topup, status, net, name, email, created_at) VALUES (?1, ?2, ?3, ?4, 'new', ?5, ?6, ?7, ?8)")
    .bind(order.id, minutes, amount, topup, net, name, email, order.created_at).run();
  return json(publicOrder(order, url), 201);
}

async function showOrder(env, url, id) {
  const order = await getOrder(env, id);
  if (!order) return fail(404, "mf_no_order", "No such order");
  if (order.status === "checking") await matchOrder(env, order);  // in case a match was missed
  return json(publicOrder((await getOrder(env, id)) || order, url));
}

// ---------------------------------------------------------------- Gemini

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function askGemini(env, model, parts, schema) {
  const resp = await fetch(`${GOOGLE}/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: schema },
    }),
  });
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const out = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
  return JSON.parse(out);
}

const RECEIPT_SCHEMA = {
  type: "OBJECT",
  properties: {
    is_transfer_receipt: { type: "BOOLEAN" },
    succeeded: { type: "BOOLEAN" },
    wallet: { type: "STRING" },
    amount: { type: "NUMBER" },
    receiver_phone: { type: "STRING" },
    receiver_name: { type: "STRING" },
    transaction_id: { type: "STRING" },
    time: { type: "STRING" },
    note: { type: "STRING" },
  },
  required: ["is_transfer_receipt", "succeeded", "wallet", "amount", "receiver_phone", "transaction_id"],
};

const RECEIPT_PROMPT = `This should be a screenshot of a money transfer made in a Myanmar mobile wallet app (KBZPay, also called KPay, or WavePay). Read it.
- is_transfer_receipt: true only if it is a transfer result or transaction detail screen from such a wallet.
- succeeded: true only if it shows the transfer as successful or completed (Burmese wording counts, e.g. အောင်မြင်ပါသည်).
- wallet: "KBZPay", "WavePay" or "other".
- amount: the amount transferred, in Kyats, as a plain number (5,941.00 Ks -> 5941). Not the balance and not a fee. 0 if not shown.
- receiver_phone: the receiver's phone number exactly as shown, including masking such as ******9168. Empty if not shown.
- receiver_name, transaction_id (the transaction number or ID), time, note (the remark or note): exactly as shown, empty if not shown.`;

const NOTICE_SCHEMA = {
  type: "OBJECT",
  properties: {
    money_received: { type: "BOOLEAN" },
    wallet: { type: "STRING" },
    amount: { type: "NUMBER" },
    transaction_id: { type: "STRING" },
    sender: { type: "STRING" },
  },
  required: ["money_received", "wallet", "amount", "transaction_id", "sender"],
};

const NOTICE_PROMPT = `Below is a phone notification forwarded from the wallet owner's Android phone (KBZPay/KPay or WavePay). Decide if it says the owner RECEIVED money into their wallet. Sending money, top-ups to someone else, promotions, OTPs, balance reminders and failed transfers are not money received.
- amount: Kyats received as a plain number (5,941.00 -> 5941), 0 if none.
- wallet: "KBZPay", "WavePay" or "other". transaction_id and sender (name and/or phone): exactly as shown, empty if not shown.

Notification:
`;

// ---------------------------------------------------------------- screenshots

function receiptProblem(r, order) {
  if (!r.is_transfer_receipt) return "ဒါ ငွေလွှဲ screenshot မဟုတ်ပါဘူး။ KBZPay / WavePay မှာ ငွေလွှဲပြီးတဲ့ စာမျက်နှာကို screenshot ရိုက်ပြီး ထည့်ပါ။";
  if (!r.succeeded) return "ငွေလွှဲတာ မအောင်မြင်သေးပုံ ရပါတယ်။ အောင်မြင်ကြောင်း ပြတဲ့ စာမျက်နှာကို ထည့်ပါ။";
  if (Math.round(Number(r.amount)) !== order.amount) {
    return `Screenshot ထဲမှာ ${ks(r.amount || 0)} Ks ဖြစ်နေပါတယ်။ ဒီ order အတွက် ${ks(order.amount)} Ks အတိအကျ လွှဲရပါမယ်။`;
  }
  const phone = digits(r.receiver_phone);
  if (phone.length >= 4 && !phone.endsWith(PAY_TAIL)) return `ငွေလက်ခံသူ နံပါတ် မှားနေပါတယ်။ ${PAY_TO} ကို လွှဲရပါမယ်။`;
  return null;
}

async function screenshot(request, env, url, id) {
  const order = await getOrder(env, id);
  if (!order) return fail(404, "mf_no_order", "No such order");
  if (order.status === "paid") return json(publicOrder(order, url));
  if (order.shot_tries >= SHOT_TRIES) return fail(429, "mf_too_many", "Too many screenshots for this order");
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!/^image\/(png|jpeg|webp|heic|heif)$/.test(type)) return fail(415, "mf_not_image", "Send a PNG or JPEG screenshot");
  const image = await request.arrayBuffer();
  if (image.byteLength > MAX_SHOT_BYTES) return fail(413, "mf_too_big", "Screenshot too big");
  if (image.byteLength < 2000) return fail(400, "mf_not_image", "Screenshot too small");
  await env.DB.prepare("UPDATE orders SET shot_tries = shot_tries + 1 WHERE id = ?").bind(id).run();

  let receipt;
  try {
    receipt = await askGemini(env, VISION_MODEL, [{ inline_data: { mime_type: type, data: toBase64(image) } }, { text: RECEIPT_PROMPT }], RECEIPT_SCHEMA);
  } catch (e) {
    console.error("receipt:", String(e));
    return fail(502, "mf_ai_busy", "Couldn't read the screenshot, try again");
  }
  const txn = cleanTxn(receipt.transaction_id);
  let problem = receiptProblem(receipt, order);
  if (!problem && txn) {
    const used = await env.DB.prepare("SELECT id FROM orders WHERE txn = ? AND id != ?").bind(txn, id).first();
    if (used) problem = "ဒီ screenshot (Transaction ID) ကို တခြား order မှာ သုံးပြီးသားပါ။";
  }
  if (problem) {
    await env.DB.prepare("UPDATE orders SET reason = ? WHERE id = ? AND status != 'paid'").bind(problem, id).run();
  } else {
    await env.DB.prepare("UPDATE orders SET status = 'checking', reason = NULL, txn = ?1, wallet = ?2 WHERE id = ?3 AND status != 'paid'")
      .bind(txn, String(receipt.wallet || "").slice(0, 20), id).run();
    await matchOrder(env, await getOrder(env, id));
  }
  return json(publicOrder(await getOrder(env, id), url));
}

// ---------------------------------------------------------------- the phone's notifications

async function sameSecret(given, token) {
  if (!token || token.length < 16 || given.length !== token.length) return false;
  const enc = new TextEncoder();
  return crypto.subtle.timingSafeEqual(enc.encode(given), enc.encode(token));
}

async function inbox(request, env, token) {
  if (!(await sameSecret(token, env.PHONE_TOKEN || ""))) return fail(401, "mf_phone", "Wrong phone link");
  // MacroDroid sends whatever body it was set up with: JSON fields or plain text both work.
  const raw = (await request.text()).slice(0, 4000);
  let notice = raw;
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === "object") notice = Object.values(j).filter((v) => typeof v === "string").join("\n");
  } catch { /* plain text */ }
  notice = notice.trim().slice(0, 1500);
  if (!notice) return json({ ok: true, received: false });

  const now = new Date().toISOString();
  const dup = await env.DB.prepare("SELECT id FROM payments WHERE raw = ? AND at > ?").bind(notice, ago(10 * 60_000)).first();
  if (dup) return json({ ok: true, duplicate: true });

  let r = null;
  try {
    r = await askGemini(env, TEXT_MODEL, [{ text: NOTICE_PROMPT + notice }], NOTICE_SCHEMA);
  } catch (e) {
    console.error("notice:", String(e));
  }
  const received = !!(r && r.money_received && Number(r.amount) > 0);
  const txn = received ? cleanTxn(r.transaction_id) : null;
  if (txn && await env.DB.prepare("SELECT id FROM payments WHERE txn = ?").bind(txn).first()) return json({ ok: true, duplicate: true });
  const row = await env.DB.prepare(
    "INSERT INTO payments (at, wallet, amount, txn, sender, raw, parsed) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id",
  ).bind(now, received ? String(r.wallet || "").slice(0, 20) : null, received ? Math.round(Number(r.amount)) : null, txn,
         received ? String(r.sender || "").slice(0, 100) : null, notice, r ? 1 : 0).first();
  if (received) await matchPayment(env, row.id);
  return json({ ok: true, received });
}

// ---------------------------------------------------------------- matching

const txnAgrees = (order, payment) => !order.txn || !payment.txn || order.txn === payment.txn;

async function matchOrder(env, order) {
  if (!order || order.status !== "checking") return;
  const { results } = await env.DB.prepare(
    "SELECT * FROM payments WHERE order_id IS NULL AND amount = ?1 AND at > ?2 ORDER BY id",
  ).bind(order.amount, new Date(Date.parse(order.created_at) - 10 * 60_000).toISOString()).all();
  const payment = results.find((p) => order.txn && p.txn === order.txn) || results.find((p) => txnAgrees(order, p));
  if (payment) await complete(env, order, payment.id);
}

async function matchPayment(env, paymentId) {
  const payment = await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(paymentId).first();
  const { results } = await env.DB.prepare(
    "SELECT * FROM orders WHERE status = 'checking' AND amount = ?1 AND created_at > ?2 AND created_at < ?3 ORDER BY created_at",
  ).bind(payment.amount, new Date(Date.parse(payment.at) - ORDER_DAYS * DAY).toISOString(),
         new Date(Date.parse(payment.at) + 10 * 60_000).toISOString()).all();
  const order = results.find((o) => o.txn && o.txn === payment.txn) || results.find((o) => txnAgrees(o, payment));
  if (order) await complete(env, order, paymentId);
}

// Marks the order paid with this payment and gives the minutes, once. `paymentId` is a
// payments row, or a negative number for an order the owner approved by hand.
export async function complete(env, order, paymentId) {
  if (paymentId > 0) {
    const claim = await env.DB.prepare("UPDATE payments SET order_id = ?1 WHERE id = ?2 AND order_id IS NULL").bind(order.id, paymentId).run();
    if (!claim.meta.changes) return false;
  }
  const now = new Date().toISOString();
  const code = order.topup || newCode();
  const ms = order.minutes * 60_000;
  const expires = daysFromNow(validDays(order.minutes));
  const note = [order.name, order.email, order.wallet].filter(Boolean).join(" · ") || `shop ${order.id.slice(0, 6)}`;
  // The minutes are added only if this call is the one that marked the order paid.
  const won = "EXISTS (SELECT 1 FROM orders WHERE id = ? AND payment_id = ?)";
  const steps = [
    env.DB.prepare("UPDATE orders SET status = 'paid', code = ?, paid_at = ?, payment_id = ?, reason = NULL WHERE id = ? AND status != 'paid'")
      .bind(code, now, paymentId, order.id),
    order.topup
      ? env.DB.prepare(`UPDATE codes SET balance_ms = balance_ms + ?, expires_at = ${LATER_EXPIRY} WHERE code = ? AND ${won}`)
          .bind(ms, expires, expires, code, order.id, paymentId)
      : env.DB.prepare(`INSERT INTO codes (code, note, balance_ms, created_at, expires_at) SELECT ?, ?, ?, ?, ? WHERE ${won}`)
          .bind(code, note, ms, now, expires, order.id, paymentId),
    env.DB.prepare(`INSERT INTO ledger (code, at, kind, ms) SELECT ?, ?, 'shop', ? WHERE ${won}`).bind(code, now, ms, order.id, paymentId),
  ];
  const [update] = await env.DB.batch(steps);
  if (!update.meta.changes && paymentId > 0) {
    // Someone else paid this order first; free the payment for another order.
    await env.DB.prepare("UPDATE payments SET order_id = NULL WHERE id = ?1 AND order_id = ?2").bind(paymentId, order.id).run();
    return false;
  }
  return !!update.meta.changes;
}

// ---------------------------------------------------------------- lost codes

// A buyer who lost their code gets it back with their email and the transaction ID from
// their wallet history. Both must match a paid order, so an email alone shows nothing.
async function recover(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const txn = cleanTxn(body.txn);
  if (!EMAIL.test(email) || !txn) return fail(400, "mf_bad_contact", "Email and transaction ID are needed");
  const net = await network(request);
  const tries = await env.DB.prepare("SELECT COUNT(*) AS n FROM recoveries WHERE net = ? AND at > ?").bind(net, ago(3_600_000)).first();
  if (tries.n >= RECOVERIES_PER_HOUR) return fail(429, "mf_too_many", "Too many tries, wait an hour");
  await env.DB.prepare("INSERT INTO recoveries (net, at) VALUES (?, ?)").bind(net, new Date().toISOString()).run();
  const order = await env.DB.prepare("SELECT code, minutes, paid_at FROM orders WHERE status = 'paid' AND email = ? AND txn = ?").bind(email, txn).first();
  if (!order) return fail(404, "mf_not_found", "No paid order with that email and transaction ID");
  // Every code this email has bought, so one lookup finds them all.
  const { results } = await env.DB.prepare(
    `SELECT orders.code, SUM(orders.minutes) AS minutes, MAX(orders.paid_at) AS paid_at, codes.expires_at FROM orders
     LEFT JOIN codes ON codes.code = orders.code WHERE orders.status = 'paid' AND orders.email = ?
     GROUP BY orders.code ORDER BY MAX(orders.paid_at) DESC`,
  ).bind(email).all();
  return json({ codes: results });
}

// ---------------------------------------------------------------- free trial

async function trial(request, env) {
  const body = await request.json().catch(() => ({}));
  const device = String(body.device || "");
  if (device.length < 8 || device.length > 200) return fail(400, "mf_bad_device", "Missing device");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("trial:" + device));
  const id = [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (await env.DB.prepare("SELECT 1 FROM trials WHERE device = ?").bind(id).first()) return fail(409, "mf_trial_used", "This computer already had a free trial");
  const net = await network(request), since = ago(DAY);
  const mine = await env.DB.prepare("SELECT COUNT(*) AS n FROM trials WHERE net = ? AND at > ?").bind(net, since).first();
  if (mine.n >= TRIALS_PER_NETWORK) return fail(429, "mf_trial_used", "Too many free trials from this network today");
  const all = await env.DB.prepare("SELECT COUNT(*) AS n FROM trials WHERE at > ?").bind(since).first();
  if (all.n >= TRIALS_PER_DAY) return fail(503, "mf_trial_busy", "No more free trials today");

  const code = newCode(), now = new Date().toISOString(), ms = TRIAL_MINUTES * 60_000;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO trials (device, net, code, at) VALUES (?1, ?2, ?3, ?4)").bind(id, net, code, now),
    env.DB.prepare("INSERT INTO codes (code, note, balance_ms, created_at, expires_at) VALUES (?1, 'trial: app', ?2, ?3, ?4)")
      .bind(code, ms, now, daysFromNow(TRIAL_DAYS)),
    env.DB.prepare("INSERT INTO ledger (code, at, kind, ms) VALUES (?1, ?2, 'trial', ?3)").bind(code, now, ms),
  ]);
  return json({ code, minutes: TRIAL_MINUTES, days: TRIAL_DAYS }, 201);
}

// ---------------------------------------------------------------- admin

// /admin/api/shop... (the caller has already checked the admin token)
export async function shopAdmin(request, env, url, parts) {
  if (parts.length === 3 && request.method === "GET") {
    const orders = await env.DB.prepare(
      "SELECT id, minutes, amount, topup, code, status, reason, txn, wallet, name, email, created_at, paid_at, payment_id FROM orders ORDER BY created_at DESC LIMIT 100",
    ).all();
    const payments = await env.DB.prepare(
      "SELECT id, at, wallet, amount, txn, sender, raw, order_id FROM payments ORDER BY id DESC LIMIT 60",
    ).all();
    return json({
      orders: orders.results, payments: payments.results,
      phone_url: env.PHONE_TOKEN ? `${url.origin}/mf/pay-inbox/${env.PHONE_TOKEN}` : null,
    });
  }
  const m = (parts[3] || "").match(/^[a-z0-9]{16}$/);
  if (m && parts[4] === "approve" && request.method === "POST") {
    const order = await getOrder(env, parts[3]);
    if (!order) return fail(404, "mf_no_order", "No such order");
    if (order.status === "paid") return json({ ok: true, code: order.code });
    const ok = await complete(env, order, -Date.now());
    return json({ ok, code: (await getOrder(env, order.id)).code });
  }
  return fail(404, "mf_not_found", "Not found");
}
