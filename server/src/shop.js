// Selling minutes with nobody at the till.
//
// 1. The buyer (in the app or on /buy) picks minutes and gets an order with an exact
//    amount to pay (TIERS in common.js). Amounts are kept unique among open orders
//    (5,100, then 5,101 ...),
//    so a payment of that amount can only belong to one order.
// 2. They pay 09 424 469 168 with KBZPay or WavePay and upload the receipt screenshot.
//    Gemini reads it at once: a finished transfer, the right amount and receiver, a
//    transaction ID no other order has used, a time after the order was made, and no
//    sign of editing.
// 3. A clean receipt pays the order there and then: a new code is made, or the buyer's
//    code is topped up. The owner gets each sale on Telegram with the screenshot and an
//    "undo" button, to use if the money never arrived in the wallet.
// 4. A doubtful receipt (no transaction ID, odd time, looks edited ...) puts the order
//    "in review": the owner gets it on Telegram with approve / reject buttons.
//
// Optional: an Android phone can forward wallet notifications (MacroDroid) to
// /mf/pay-inbox/<PHONE_TOKEN>; a matching "money received" approves an order in review.
// Free trials: one 5-minute code per device, with per-network and per-day limits.

import buyPage from "./buy.html";
import { LATER_EXPIRY, TIERS, TRIAL_DAYS, cost, daysFromNow, fail, json, minutesFor, newCode, normalizeCode, validDays } from "./common.js";

const GOOGLE = "https://generativelanguage.googleapis.com";
const VISION_MODEL = "gemini-3.8-flash";
const TEXT_MODEL = "gemini-3.5-flash-lite";

const PAY_TO = "09 424 469 168";
const PAY_TAIL = "9168";                 // receipts often mask the number: ******9168
const MIN_MINUTES = 10, MAX_MINUTES = 6000;
const ORDER_DAYS = 2;                    // an unpaid order can be paid within 2 days
const ORDERS_PER_HOUR = 8;               // per network
const SHOT_TRIES = 6;                    // screenshot checks per order
const HELP_MESSAGES = 3;                 // messages a buyer can send the owner per order
const MAX_SHOT_BYTES = 6 * 1024 * 1024;
const TRIAL_MINUTES = 5, TRIALS_PER_NETWORK = 2, TRIALS_PER_DAY = 40;
const RECOVERIES_PER_HOUR = 10;          // per network
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,100}\.[^\s@]{2,}$/;

// Order status: new (no good screenshot yet) | review (the owner checks it) | paid |
// rejected (the owner found no money) | revoked (paid, then undone by the owner).
// "checking" is from before screenshots could pay on their own.
const WAITING = ["checking", "review"];
const SAY_REVIEW = "Screenshot ရပါပြီ ✓ ငွေဝင်တာကို စစ်ပြီးတာနဲ့ Code ကို ဒီမှာ ပြပါမယ်။";
const SAY_REJECTED = `ဒီငွေလွှဲကို အတည်မပြုနိုင်ပါ။ ငွေလွှဲခဲ့ရင် ${PAY_TO} ကို order နံပါတ်နဲ့ ဆက်သွယ်ပါ။`;
const SAY_REVOKED = `ဒီ order ကို ပယ်ဖျက်လိုက်ပါတယ် (ငွေမဝင်ပါ)။ မှားနေရင် ${PAY_TO} ကို ဆက်သွယ်ပါ။`;

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const DAY = 86_400_000;
const ks = (n) => Number(n).toLocaleString("en-US");
const digits = (s) => String(s || "").replace(/\D/g, "");
const cleanTxn = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
// A payment is fine from the exact amount up to the next 1,000 Ks (5,100 -> 5,100 to 6,000).
const upTo = (amount) => Math.ceil(amount / 1000) * 1000;
const amountOk = (paid, order) => paid >= order.amount && paid <= upTo(order.amount);
const range = (order) => upTo(order.amount) > order.amount ? `${ks(order.amount)} – ${ks(upTo(order.amount))} Ks` : `${ks(order.amount)} Ks`;
// What the AI read off a receipt whose only problem was the amount: {amount, txn, wallet}.
const seenOf = (order) => { try { return order.seen ? JSON.parse(order.seen) : null; } catch { return null; } };

// Routes anyone can call. Returns null when the path isn't the shop's.
export async function shop(request, env, url) {
  const p = url.pathname, post = request.method === "POST";
  if (p === "/buy") return new Response(buyPage.replace("/*TIERS*/[]", JSON.stringify(TIERS)), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  if (p === "/mf/orders" && post) return await createOrder(request, env, url);
  let m = p.match(/^\/mf\/orders\/([a-z0-9]{16})$/);
  if (m && request.method === "GET") return await showOrder(env, url, m[1]);
  m = p.match(/^\/mf\/orders\/([a-z0-9]{16})\/screenshot$/);
  if (m && post) return await screenshot(request, env, url, m[1]);
  m = p.match(/^\/mf\/orders\/([a-z0-9]{16})\/help$/);
  if (m && post) return await help(request, env, m[1]);
  if (p === "/mf/trial" && post) return await trial(request, env);
  if (p === "/mf/recover" && post) return await recover(request, env);
  m = p.match(/^\/mf\/pay-inbox\/([^/]+)$/);
  if (m && post) return await inbox(request, env, decodeURIComponent(m[1]));
  if (p === "/mf/tg" && post) return await telegramHook(request, env);
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
    max_amount: upTo(order.amount), help_left: Math.max(0, HELP_MESSAGES - (order.help_sent || 0)),
    pay_to: PAY_TO, wallets: ["KBZPay", "WavePay"], note: "Crash Flow",
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
  let amount = cost(minutes);
  while (taken.has(amount)) amount++;

  const order = { id: randomId(), minutes, amount, topup, status: "new", created_at: new Date().toISOString() };
  await env.DB.prepare("INSERT INTO orders (id, minutes, amount, topup, status, net, name, email, created_at) VALUES (?1, ?2, ?3, ?4, 'new', ?5, ?6, ?7, ?8)")
    .bind(order.id, minutes, amount, topup, net, name, email, order.created_at).run();
  return json(publicOrder(order, url), 201);
}

async function showOrder(env, url, id) {
  const order = await getOrder(env, id);
  if (!order) return fail(404, "mf_no_order", "No such order");
  if (WAITING.includes(order.status)) await matchOrder(env, order);  // in case a match was missed
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
    time_iso: { type: "STRING" },
    note: { type: "STRING" },
    looks_edited: { type: "BOOLEAN" },
    doubt: { type: "STRING" },
  },
  required: ["is_transfer_receipt", "succeeded", "wallet", "amount", "receiver_phone", "transaction_id", "time_iso", "looks_edited", "doubt"],
};

const RECEIPT_PROMPT = `This should be a screenshot of a money transfer made in a Myanmar mobile wallet app (KBZPay, also called KPay, or WavePay). Read it.
- is_transfer_receipt: true only if it is the result or detail screen of ONE transfer from such a wallet. A history list showing several transactions is false.
- succeeded: true only if it shows the transfer as successful or completed (Burmese wording counts, e.g. အောင်မြင်ပါသည်).
- wallet: "KBZPay", "WavePay" or "other".
- amount: the amount transferred, in Kyats, as a plain number (5,941.00 Ks -> 5941). Not the balance and not a fee. 0 if not shown.
- receiver_phone: the receiver's phone number exactly as shown, including masking such as ******9168. Empty if not shown.
- receiver_name, transaction_id (the transaction number or ID), time, note (the remark or note): exactly as shown, empty if not shown.
- time_iso: the transaction date and time rewritten as YYYY-MM-DDTHH:MM (as shown, Myanmar time). Empty if not shown.
- looks_edited: true if anything suggests the image was edited or made up rather than a real, untouched phone screenshot of the wallet app: digits or text in a different font, size, colour or alignment from the rest, blurred or patched areas around the amount, ID, number or time, a layout that doesn't match the real app, or a drawing / mock-up. False for an ordinary screenshot.
- doubt: if looks_edited, a short reason in English; otherwise empty.`;

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
  if (!r.is_transfer_receipt) return "ဒါ ငွေလွှဲ screenshot မဟုတ်ပါဘူး။ ငွေလွှဲပြီးတာနဲ့ ပေါ်လာတဲ့ စာမျက်နှာ (ဒါမှမဟုတ် History ထဲက အဲ့ငွေလွှဲ တစ်ခုကို နှိပ်ပြီး ပေါ်လာတဲ့ အသေးစိတ်) ကို screenshot ရိုက်ပြီး ထည့်ပါ။";
  if (!r.succeeded) return "ငွေလွှဲတာ မအောင်မြင်သေးပုံ ရပါတယ်။ အောင်မြင်ကြောင်း ပြတဲ့ စာမျက်နှာကို ထည့်ပါ။";
  const phone = digits(r.receiver_phone);
  if (phone.length >= 4 && !phone.endsWith(PAY_TAIL)) {
    return `ငွေလက်ခံသူ နံပါတ် မှားနေပါတယ်။ ${PAY_TO} ကို လွှဲရပါမယ်။ တခြားနံပါတ်ကို မှားလွှဲမိရင် အဲ့ဒီ wallet ကို ဆက်သွယ်ပြီး ပြန်တောင်းပါ။`;
  }
  if (!amountOk(Math.round(Number(r.amount)), order)) {
    return `Screenshot ထဲမှာ ${ks(r.amount || 0)} Ks ဖြစ်နေပါတယ်။ ဒီ order အတွက် ${range(order)} လွှဲရပါမယ်။ ` +
           "Screenshot အဟောင်း မဟုတ်ဘဲ ခုလွှဲထားတာ ဟုတ်မဟုတ် စစ်ပါ။ ငွေ မှားလွှဲမိရင် အောက်က「ဆိုင်ရှင်ကို ပြောမယ်」နဲ့ ပြောပါ — စစ်ပြီး မိနစ် ထည့်ပေးပါမယ်။";
  }
  return null;
}

// "2026-11-27T22:41" read off the receipt, in Myanmar time (UTC+6:30).
function receiptTime(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+06:30`) : NaN;
}

// Reasons the owner should look before the minutes are given (in Burmese, for Telegram).
function receiptDoubts(r, order, txn) {
  const doubts = [];
  if (r.looks_edited) doubts.push("AI: ပြင်ထားပုံရ" + (r.doubt ? ` (${String(r.doubt).slice(0, 120)})` : ""));
  if (!txn) doubts.push("Transaction ID မပါ");
  if (digits(r.receiver_phone).length < 4) doubts.push("လက်ခံသူ နံပါတ် မပါ");
  if (!/kbz|kpay|wave/i.test(r.wallet || "")) doubts.push("ဘယ် wallet လဲ မသိ");
  const t = receiptTime(r.time_iso);
  if (Number.isNaN(t)) doubts.push("လွှဲတဲ့အချိန် မဖတ်နိုင်");
  else if (t < Date.parse(order.created_at) - 10 * 60_000) doubts.push("Order မတင်ခင်က လွှဲထားတာ");
  else if (t > Date.now() + 15 * 60_000) doubts.push("လွှဲတဲ့အချိန်က အနာဂတ်");
  return doubts;
}

async function screenshot(request, env, url, id) {
  const order = await getOrder(env, id);
  if (!order) return fail(404, "mf_no_order", "No such order");
  // Paid, waiting for the owner, or already decided: another screenshot changes nothing.
  if (order.status !== "new") return json(publicOrder(order, url));
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!/^image\/(png|jpeg|webp|heic|heif)$/.test(type)) return fail(415, "mf_not_image", "Send a PNG or JPEG screenshot");
  const image = await request.arrayBuffer();
  if (image.byteLength > MAX_SHOT_BYTES) return fail(413, "mf_too_big", "Screenshot too big");
  if (image.byteLength < 2000) return fail(400, "mf_not_image", "Screenshot too small");
  const bytes = await crypto.subtle.digest("SHA-256", image);
  const digest = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const [claimed] = await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO receipt_fingerprints (digest, order_id)
      SELECT ?1, id FROM orders WHERE id = ?2 AND status = 'new' AND shot_tries < ?3`)
      .bind(digest, id, SHOT_TRIES),
    env.DB.prepare("UPDATE orders SET shot_tries = shot_tries + 1 WHERE id = ? AND changes() = 1").bind(id),
  ]);
  if (!claimed.meta.changes) {
    const first = await env.DB.prepare("SELECT order_id FROM receipt_fingerprints WHERE digest = ?").bind(digest).first();
    if (first && first.order_id !== id) {
      return fail(409, "mf_receipt_reused", "ဒီ screenshot ကို တခြား order မှာ သုံးပြီးသားပါ။");
    }
    const current = await getOrder(env, id);
    if (first || current.status !== "new") return json(publicOrder(current, url));
    return fail(429, "mf_too_many", "Too many screenshots for this order");
  }

  let receipt;
  try {
    receipt = await askGemini(env, VISION_MODEL, [{ inline_data: { mime_type: type, data: toBase64(image) } }, { text: RECEIPT_PROMPT }], RECEIPT_SCHEMA);
  } catch (e) {
    console.error("receipt:", String(e));
    await env.DB.prepare("DELETE FROM receipt_fingerprints WHERE digest = ? AND order_id = ?").bind(digest, id).run();
    return fail(502, "mf_ai_busy", "Couldn't read the screenshot, try again");
  }
  const txn = cleanTxn(receipt.transaction_id);
  const wallet = String(receipt.wallet || "").slice(0, 20);
  let problem = receiptProblem(receipt, order);
  let reused = false;
  if (txn && receipt.is_transfer_receipt) {
    const used = await env.DB.prepare("SELECT id FROM orders WHERE txn = ? AND id != ?").bind(txn, id).first();
    if (used) {
      problem = "ဒီ screenshot (Transaction ID) ကို တခြား order မှာ သုံးပြီးသားပါ။";
      reused = used.id;
    }
  }
  if (problem) {
    // Only the amount was wrong (the same receipt with the right amount would pass): keep what
    // was paid, so the owner can give minutes for it with one press.
    const paid = Math.round(Number(receipt.amount)) || 0;
    const wrongAmount = !reused && paid > 0 && !receiptProblem({ ...receipt, amount: order.amount }, order);
    const seen = wrongAmount ? JSON.stringify({ amount: paid, txn, wallet }) : null;
    await env.DB.prepare("UPDATE orders SET reason = ?1, seen = COALESCE(?2, seen) WHERE id = ?3 AND status = 'new'").bind(problem, seen, id).run();
    if (reused) {
      await tell(env, `⚠️ သုံးပြီးသား screenshot ကို ပြန်တင်တယ်\n${orderLine(order)}\nTxn ${txn} ကို order ${reused.slice(0, 6)} မှာ သုံးပြီးသား။ Code မပေးပါ။`,
                 { photo: image, type });
    } else if (receipt.is_transfer_receipt) {
      // A real-looking receipt the AI turned down: the owner sees it, in case the AI misread it.
      const buttons = [["✅ " + ks(order.amount) + " Ks ရပြီ — " + order.minutes + " မိနစ် ပေးမယ်", "ok:" + id]];
      const fair = minutesFor(paid);
      if (wrongAmount && fair >= 1) buttons.push(["💵 လွှဲထားတဲ့ " + ks(paid) + " Ks အတွက် " + fair + " မိနစ် ပေးမယ်", "paid:" + id]);
      await tell(env, `⚠️ AI က လက်မခံ — ${ks(order.amount)} Ks\n${orderLine(order)}\nAI ဖတ်တာ: ${ks(receipt.amount || 0)} Ks · ` +
                      `${receipt.receiver_phone || "နံပါတ် မပါ"} · Txn ${txn || "—"}\nဝယ်သူကို ပြောထားတာ: ${problem}\n\n` +
                      `ငွေတကယ်ဝင်ရင် ခလုတ်တစ်ခု နှိပ်ပါ။ မဟုတ်ရင် ဘာမှ မလုပ်လည်းရ (ဝယ်သူ ပြန်ထည့်လို့ရ)။`,
                 { photo: image, type, buttons });
    }
    return json(publicOrder(await getOrder(env, id), url));
  }

  const doubts = receiptDoubts(receipt, order, txn);
  if (doubts.length) {
    const moved = await env.DB.prepare(
      "UPDATE orders SET status = 'review', reason = ?1, doubts = ?2, txn = ?3, wallet = ?4 WHERE id = ?5 AND status = 'new'",
    ).bind(SAY_REVIEW, doubts.join("; "), txn, wallet, id).run();
    if (moved.meta.changes) {
      await tell(env, `🔎 စစ်ပေးပါ — ${ks(order.amount)} Ks\n${orderLine(order)}\n${wallet || "?"} · Txn ${txn || "—"}\n` +
                      `သံသယ: ${doubts.join("၊ ")}\n\n${wallet || "Wallet"} history မှာ ${ks(order.amount)} Ks ဝင်လား ကြည့်ပြီး နှိပ်ပါ။`,
                 { photo: image, type, buttons: [["✅ ငွေရပြီ", "ok:" + id], ["❌ ငြင်းမယ်", "no:" + id]] });
      await matchOrder(env, await getOrder(env, id));
    }
    return json(publicOrder(await getOrder(env, id), url));
  }

  // OCR supplies matching data. Only a wallet notification or the owner can release credit.
  const moved = await env.DB.prepare(
    "UPDATE orders SET status = 'review', reason = ?1, doubts = NULL, txn = ?2, wallet = ?3 WHERE id = ?4 AND status = 'new'",
  ).bind(SAY_REVIEW, txn, wallet, id).run();
  if (moved.meta.changes) {
    await matchOrder(env, await getOrder(env, id));
    if ((await getOrder(env, id)).status === "review") {
      await tell(env, `🔎 ငွေဝင်တာ အတည်ပြုပေးပါ — ${ks(order.amount)} Ks\n${orderLine(order)}\n${wallet} · Txn ${txn}`,
                 { photo: image, type, buttons: [["✅ ငွေရပြီ", "ok:" + id], ["❌ ငြင်းမယ်", "no:" + id]] });
    }
  }
  return json(publicOrder(await getOrder(env, id), url));
}

const orderLine = (o) => `${o.minutes} မိနစ်${o.topup ? " ဖြည့် " + o.topup : ""} · order ${o.id.slice(0, 6)} · ${o.name || "?"} · ${o.email || "?"}`;

// The buyer writes to the owner from the order page (paid the wrong amount, a stuck order ...).
// It goes to Telegram with the buttons that fit the order.
async function help(request, env, id) {
  const order = await getOrder(env, id);
  if (!order) return fail(404, "mf_no_order", "No such order");
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || "").trim().slice(0, 600);
  const phone = String(body.phone || "").trim().slice(0, 40);
  if (!text) return fail(400, "mf_bad_help", "Write what happened");
  const took = await env.DB.prepare("UPDATE orders SET help_sent = help_sent + 1 WHERE id = ? AND help_sent < ?").bind(id, HELP_MESSAGES).run();
  if (!took.meta.changes) return fail(429, "mf_too_many", "Already sent");
  const seen = seenOf(order), fair = seen ? minutesFor(seen.amount) : 0;
  const buttons = [];
  if (order.status !== "paid" && order.status !== "revoked") buttons.push(["✅ " + ks(order.amount) + " Ks ရပြီ — " + order.minutes + " မိနစ် ပေးမယ်", "ok:" + id]);
  if (order.status !== "paid" && order.status !== "revoked" && fair >= 1 && seen.amount !== order.amount) {
    buttons.push(["💵 လွှဲထားတဲ့ " + ks(seen.amount) + " Ks အတွက် " + fair + " မိနစ် ပေးမယ်", "paid:" + id]);
  }
  if (order.status === "new" || WAITING.includes(order.status)) buttons.push(["❌ ငြင်းမယ်", "no:" + id]);
  const status = { new: "Screenshot မအောင်သေး", review: "စစ်ဖို့ စောင့်", checking: "စစ်ဖို့ စောင့်", paid: "ပေးပြီး " + (order.code || ""), rejected: "ငြင်းထား", revoked: "ပြန်ရုပ်သိမ်းထား" }[order.status] || order.status;
  const told = await tell(env, `📩 ဝယ်သူက စာပို့တယ် — ${ks(order.amount)} Ks\n${orderLine(order)}\nအခြေအနေ: ${status}` +
                               (seen ? `\nAI ဖတ်တာ: ${ks(seen.amount)} Ks · Txn ${seen.txn || "—"}` : "") +
                               (order.reason && order.status === "new" ? `\nဝယ်သူကို ပြောထားတာ: ${order.reason}` : "") +
                               `\nဖုန်း: ${phone || "—"}\n\n「${text}」`, { buttons: buttons.length ? buttons : undefined });
  return json({ ok: true, told, help_left: Math.max(0, HELP_MESSAGES - (order.help_sent || 0) - 1) });
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
  if (dup) {
    await matchPayment(env, dup.id);
    return json({ ok: true, duplicate: true });
  }

  let r = null;
  try {
    r = await askGemini(env, TEXT_MODEL, [{ text: NOTICE_PROMPT + notice }], NOTICE_SCHEMA);
  } catch (e) {
    console.error("notice:", String(e));
  }
  const received = !!(r && r.money_received && Number(r.amount) > 0);
  const txn = received ? cleanTxn(r.transaction_id) : null;
  const known = txn && await env.DB.prepare("SELECT id FROM payments WHERE txn = ?").bind(txn).first();
  if (known) {
    await matchPayment(env, known.id);
    return json({ ok: true, duplicate: true });
  }
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
  if (!order || !WAITING.includes(order.status)) return;
  const { results } = await env.DB.prepare(
    "SELECT * FROM payments WHERE (order_id IS NULL OR order_id = ?3) AND amount = ?1 AND at > ?2 ORDER BY id",
  ).bind(order.amount, new Date(Date.parse(order.created_at) - 10 * 60_000).toISOString(), order.id).all();
  const payment = results.find((p) => order.txn && p.txn === order.txn) || results.find((p) => txnAgrees(order, p));
  if (payment) await complete(env, order, payment.id);
}

async function matchPayment(env, paymentId) {
  const payment = await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(paymentId).first();
  if (!payment?.amount) return;
  if (payment.order_id) {
    const linked = await getOrder(env, payment.order_id);
    if (linked && WAITING.includes(linked.status)) await complete(env, linked, paymentId);
    return;
  }
  const { results } = await env.DB.prepare(
    "SELECT * FROM orders WHERE status IN ('checking', 'review') AND amount = ?1 AND created_at > ?2 AND created_at < ?3 ORDER BY created_at",
  ).bind(payment.amount, new Date(Date.parse(payment.at) - ORDER_DAYS * DAY).toISOString(),
         new Date(Date.parse(payment.at) + 10 * 60_000).toISOString()).all();
  const order = results.find((o) => o.txn && o.txn === payment.txn) || results.find((o) => txnAgrees(o, payment));
  if (order) await complete(env, order, paymentId);
}

// A unique negative payment number for an order paid without a phone notification.
const oneOff = () => -(Date.now() * 1000 + Math.floor(Math.random() * 1000));

// Marks the order paid with this payment and gives the minutes, once. `paymentId` is a
// payments row, or oneOff() when the owner confirmed it manually.
export async function complete(env, order, paymentId, by = "phone") {
  const now = new Date().toISOString();
  const code = order.topup || newCode();
  const ms = order.minutes * 60_000;
  const expires = daysFromNow(validDays(order.minutes));
  const note = [order.name, order.email, order.wallet].filter(Boolean).join(" · ") || `shop ${order.id.slice(0, 6)}`;
  // D1 runs the batch transactionally. Each dependent write requires the previous
  // statement to have changed a row, so retries cannot grant the credit twice.
  const steps = [
    env.DB.prepare(`UPDATE orders SET status = 'paid', code = ?1, paid_at = ?2, payment_id = ?3, paid_by = ?4, reason = NULL
      WHERE id = ?5 AND status IN ('new', 'checking', 'review')
      AND (?6 IS NULL OR EXISTS (SELECT 1 FROM codes WHERE code = ?6))
      AND (?3 < 0 OR EXISTS (SELECT 1 FROM payments WHERE id = ?3 AND (order_id IS NULL OR order_id = ?5)))`)
      .bind(code, now, paymentId, by, order.id, order.topup || null),
    order.topup
      ? env.DB.prepare(`UPDATE codes SET balance_ms = balance_ms + ?, expires_at = ${LATER_EXPIRY} WHERE code = ? AND changes() = 1`)
          .bind(ms, expires, expires, code)
      : env.DB.prepare("INSERT INTO codes (code, note, balance_ms, created_at, expires_at) SELECT ?, ?, ?, ?, ? WHERE changes() = 1")
          .bind(code, note, ms, now, expires),
    env.DB.prepare("INSERT INTO ledger (code, at, kind, ms) SELECT ?, ?, 'shop', ? WHERE changes() = 1").bind(code, now, ms),
  ];
  if (paymentId > 0) {
    steps.push(env.DB.prepare("UPDATE payments SET order_id = ? WHERE id = ? AND changes() = 1").bind(order.id, paymentId));
  }
  const [update] = await env.DB.batch(steps);
  return !!update.meta.changes;
}

// ---------------------------------------------------------------- the owner's decisions

// From Telegram buttons or the admin page. Each returns a short Burmese line for the owner.
async function decide(env, action, id) {
  const order = /^[a-z0-9]{16}$/.test(id || "") && await getOrder(env, id);
  if (!order) return "ဒီ order ကို မတွေ့ပါ";
  const tag = `order ${id.slice(0, 6)}`;
  if (action === "ok") {
    if (order.status === "paid") return `${tag} က ပေးပြီးသားပါ (${order.code})`;
    await complete(env, order, oneOff(), "owner");
    const now = await getOrder(env, id);
    return now.status === "paid" ? `✅ ငွေရပြီ — ${now.code} ပေးလိုက်ပြီ (${tag})` : `${tag} ကို မပေးနိုင်ပါ`;
  }
  if (action === "paid") {
    // Minutes for what the buyer actually paid (the amount the AI read off their receipt).
    if (order.status === "paid") return `${tag} က ပေးပြီးသားပါ (${order.code})`;
    const seen = seenOf(order), minutes = seen ? minutesFor(seen.amount) : 0;
    if (!minutes) return `${tag} မှာ လွှဲထားတဲ့ ပမာဏ မသိပါ`;
    if (seen.txn && await env.DB.prepare("SELECT 1 FROM orders WHERE txn = ? AND id != ?").bind(seen.txn, id).first()) {
      return `Txn ${seen.txn} ကို တခြား order မှာ သုံးပြီးသား — မပေးပါ (${tag})`;
    }
    const changed = { ...order, minutes, amount: seen.amount, txn: seen.txn || null, wallet: seen.wallet || order.wallet };
    await env.DB.prepare("UPDATE orders SET minutes = ?1, amount = ?2, txn = ?3, wallet = ?4 WHERE id = ?5 AND status != 'paid'")
      .bind(changed.minutes, changed.amount, changed.txn, changed.wallet, id).run();
    await complete(env, changed, oneOff(), "owner");
    const now = await getOrder(env, id);
    return now.status === "paid" ? `💵 ${ks(seen.amount)} Ks အတွက် ${minutes} မိနစ် — ${now.code} ပေးလိုက်ပြီ (${tag})` : `${tag} ကို မပေးနိုင်ပါ`;
  }
  if (action === "no") {
    if (order.status === "paid") return `${tag} က ပေးပြီးသားပါ။ ပြန်ရုပ်သိမ်းချင်ရင် ↩️ ကို သုံးပါ`;
    await env.DB.prepare("UPDATE orders SET status = 'rejected', reason = ? WHERE id = ? AND status != 'paid'").bind(SAY_REJECTED, id).run();
    return `❌ ငြင်းလိုက်ပြီ — Code မပေးပါ (${tag})`;
  }
  if (action === "undo") {
    if (order.status !== "paid") return `${tag} က ပေးထားတာ မဟုတ်ပါ`;
    const undo = await env.DB.prepare("UPDATE orders SET status = 'revoked', reason = ? WHERE id = ? AND status = 'paid'").bind(SAY_REVOKED, id).run();
    if (!undo.meta.changes) return `${tag} ကို ပြန်ရုပ်သိမ်းပြီးသားပါ`;
    // Take back what's left of these minutes. A code made by this order is also switched off.
    const ms = order.minutes * 60_000, now = new Date().toISOString();
    const left = await env.DB.prepare("SELECT balance_ms FROM codes WHERE code = ?").bind(order.code).first();
    const taken = Math.min(ms, Math.max(0, left ? left.balance_ms : 0));
    await env.DB.batch([
      env.DB.prepare("UPDATE codes SET balance_ms = balance_ms - ?1, disabled = CASE WHEN ?2 THEN 1 ELSE disabled END WHERE code = ?3")
        .bind(taken, order.topup ? 0 : 1, order.code),
      env.DB.prepare("INSERT INTO ledger (code, at, kind, ms) VALUES (?1, ?2, 'revoke', ?3)").bind(order.code, now, -taken),
    ]);
    const used = Math.round((ms - taken) / 60_000);
    return `↩️ ပြန်ရုပ်သိမ်းပြီး — ${order.code} က ${Math.round(taken / 60_000)} မိနစ် နုတ်လိုက်ပြီ` +
           (order.topup ? "" : "၊ Code ပိတ်လိုက်ပြီ") + (used ? ` (${used} မိနစ် သုံးပြီးသား)` : "") + ` (${tag})`;
  }
  return "?";
}

// ---------------------------------------------------------------- Telegram (the owner's alerts)
//
// Secret TELEGRAM_BOT_TOKEN (from @BotFather). The admin page's "Telegram ချိတ်မယ်" sets the
// webhook and gives a t.me link; when the owner presses Start, their chat is saved in
// `settings`, and from then on only that chat's button presses count.

const setting = async (env, key) => (await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first())?.value || null;
const setSetting = (env, key, value) => value == null
  ? env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(key).run()
  : env.DB.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2").bind(key, String(value)).run();

async function hookSecret(env) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mf-tg:" + env.TELEGRAM_BOT_TOKEN));
  return [...new Uint8Array(hash)].slice(0, 24).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function tgCall(env, method, body) {
  const isForm = body instanceof FormData;
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", body: isForm ? body : JSON.stringify(body),
    headers: isForm ? undefined : { "content-type": "application/json" },
  });
  const data = await resp.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || resp.status}`);
  return data.result;
}

// Tells the owner, with the screenshot and buttons when given. Never fails the caller.
async function tell(env, text, { photo, type, buttons } = {}) {
  if (!env.TELEGRAM_BOT_TOKEN) return false;
  const chat = await setting(env, "tg_chat");
  if (!chat) return false;
  const markup = buttons ? { inline_keyboard: buttons.map(([t, data]) => [{ text: t, callback_data: data }]) } : undefined;
  try {
    if (photo && /jpeg|png|webp/.test(type || "")) {
      const form = new FormData();
      form.append("chat_id", chat);
      form.append("photo", new Blob([photo], { type }), "receipt." + (type.split("/")[1] || "jpg"));
      form.append("caption", text.slice(0, 1024));
      if (markup) form.append("reply_markup", JSON.stringify(markup));
      try { await tgCall(env, "sendPhoto", form); return true; } catch (e) { console.error(String(e)); }
    }
    await tgCall(env, "sendMessage", { chat_id: chat, text: text.slice(0, 4000), reply_markup: markup });
    return true;
  } catch (e) {
    console.error("telegram:", String(e));
    return false;
  }
}

async function telegramHook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) return fail(404, "mf_not_found", "Not found");
  if (!(await sameSecret(request.headers.get("x-telegram-bot-api-secret-token") || "", await hookSecret(env)))) {
    return fail(401, "mf_telegram", "Wrong secret");
  }
  const update = await request.json().catch(() => ({}));
  const quiet = (method, body) => tgCall(env, method, body).catch((e) => console.error(String(e)));

  const msg = update.message;
  if (msg && msg.chat && msg.chat.type === "private") {
    const start = String(msg.text || "").match(/^\/start\s+([a-z0-9]{16})$/);
    const link = await setting(env, "tg_link");
    if (start && link && start[1] === link) {
      await setSetting(env, "tg_chat", msg.chat.id);
      await setSetting(env, "tg_link", null);
      await quiet("sendMessage", { chat_id: msg.chat.id, text: "✅ ချိတ်ပြီးပါပြီ။ ရောင်းရတိုင်းနဲ့ စစ်ဖို့လိုတဲ့ ငွေလွှဲတိုင်း ဒီမှာ အကြောင်းကြားပါမယ်။" });
    }
    return json({ ok: true });
  }

  const q = update.callback_query;
  if (q) {
    const chat = await setting(env, "tg_chat");
    if (!chat || String(q.from && q.from.id) !== chat) {
      await quiet("answerCallbackQuery", { callback_query_id: q.id, text: "ခွင့်မရှိပါ" });
      return json({ ok: true });
    }
    const [action, id] = String(q.data || "").split(":");
    const result = await decide(env, action, id);
    await quiet("answerCallbackQuery", { callback_query_id: q.id, text: result.slice(0, 190) });
    const m = q.message;
    if (m) {
      const photo = m.caption != null || !!m.photo;
      const text = ((photo ? m.caption : m.text) || "") + "\n\n" + result;
      // After undo there's nothing left to press; after ok / no, keep undo for a paid order.
      const after = (await getOrder(env, id))?.status === "paid" ? [[{ text: "↩️ ငွေမဝင်ဘူး — ပြန်ရုပ်သိမ်း", callback_data: "undo:" + id }]] : [];
      await quiet(photo ? "editMessageCaption" : "editMessageText", {
        chat_id: m.chat.id, message_id: m.message_id, [photo ? "caption" : "text"]: text.slice(0, photo ? 1024 : 4000),
        reply_markup: { inline_keyboard: after },
      });
    }
  }
  return json({ ok: true });
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
      "SELECT id, minutes, amount, topup, code, status, reason, doubts, seen, help_sent, txn, wallet, name, email, created_at, paid_at, payment_id, paid_by FROM orders ORDER BY created_at DESC LIMIT 100",
    ).all();
    const payments = await env.DB.prepare(
      "SELECT id, at, wallet, amount, txn, sender, raw, order_id FROM payments ORDER BY id DESC LIMIT 60",
    ).all();
    return json({
      // fair: the minutes the amount the AI read off the receipt pays for.
      orders: orders.results.map((o) => { const seen = seenOf(o); return { ...o, fair: seen ? minutesFor(seen.amount) : 0 }; }),
      payments: payments.results,
      phone_url: env.PHONE_TOKEN ? `${url.origin}/mf/pay-inbox/${env.PHONE_TOKEN}` : null,
      telegram: { bot: !!env.TELEGRAM_BOT_TOKEN, linked: !!(await setting(env, "tg_chat")) },
    });
  }
  const post = request.method === "POST";
  if (parts[3] === "telegram" && post) {
    if (!env.TELEGRAM_BOT_TOKEN) return fail(400, "mf_no_bot", "Put the TELEGRAM_BOT_TOKEN secret first");
    if (parts[4] === "test") {
      const sent = await tell(env, "🔔 Crash Flow — စမ်းပို့တာပါ။ ဒီစာ ရရင် အဆင်ပြေပါပြီ။");
      return sent ? json({ ok: true }) : fail(400, "mf_telegram", "Not linked yet, or Telegram refused");
    }
    // Point the bot at this server and make a one-time link for the owner to press Start.
    try {
      const me = await tgCall(env, "getMe", {});
      await tgCall(env, "setWebhook", { url: `${url.origin}/mf/tg`, secret_token: await hookSecret(env), allowed_updates: ["message", "callback_query"] });
      const code = randomId();
      await setSetting(env, "tg_link", code);
      return json({ link: `https://t.me/${me.username}?start=${code}`, bot: me.username });
    } catch (e) {
      return fail(502, "mf_telegram", String(e.message || e));
    }
  }
  const m = (parts[3] || "").match(/^[a-z0-9]{16}$/);
  const action = { approve: "ok", "approve-paid": "paid", reject: "no", undo: "undo" }[parts[4]];
  if (m && action && post) {
    if (!(await getOrder(env, parts[3]))) return fail(404, "mf_no_order", "No such order");
    const said = await decide(env, action, parts[3]);
    const order = await getOrder(env, parts[3]);
    return json({ ok: true, said, status: order.status, code: order.code });
  }
  return fail(404, "mf_not_found", "Not found");
}
