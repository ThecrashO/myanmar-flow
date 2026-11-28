// The owner's page for making codes and adding minutes. The admin token is typed in
// and kept only in this browser tab (sessionStorage).
export const adminPage = `<!doctype html>
<html lang="my">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Myanmar Flow codes</title>
<style>
  :root { --bg:#f7f7f8; --card:#fff; --text:#18181b; --muted:#6b7280; --line:#e4e4e7; --accent:#2563eb; --ok:#15803d; --bad:#b91c1c; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111113; --card:#1c1c1f; --text:#ececef; --muted:#9ca3af; --line:#2e2e33; --accent:#60a5fa; --ok:#4ade80; --bad:#f87171; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, "Segoe UI", "Myanmar Text", sans-serif; }
  main { max-width:980px; margin:0 auto; padding:24px 16px 60px; }
  h1 { font-size:20px; font-weight:600; margin:0 0 16px; }
  h2 { font-size:16px; font-weight:600; margin:0 0 6px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:16px; }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  input { font:inherit; color:inherit; background:transparent; border:1px solid var(--line); border-radius:8px; padding:7px 10px; min-width:0; }
  button { font:inherit; color:inherit; background:transparent; border:1px solid var(--line); border-radius:8px; padding:6px 12px; cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button:hover { border-color:var(--muted); }
  button.danger { color:var(--bad); }
  button.danger:hover { border-color:var(--bad); }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th, td { text-align:left; padding:8px 6px; border-top:1px solid var(--line); vertical-align:middle; }
  th { color:var(--muted); font-weight:500; border-top:0; }
  td.num { font-variant-numeric:tabular-nums; }
  code { font:14px ui-monospace, Consolas, monospace; }
  .muted { color:var(--muted); font-size:13px; }
  .off { color:var(--bad); }
  .new { color:var(--ok); font-weight:600; }
  #msg { min-height:1.5em; margin:8px 0 0; }
  .scroll { overflow-x:auto; }
</style>
</head>
<body>
<main>
  <h1>Myanmar Flow · codes</h1>
  <div class="card row">
    <input id="token" type="password" placeholder="Admin token" style="flex:1" autocomplete="off">
    <button id="login" class="primary">ဝင်မယ်</button>
  </div>
  <div class="card">
    <div class="row">
      <input id="note" placeholder="ဘယ်သူ့အတွက်လဲ (ဥပမာ Ko Aung)" style="flex:2">
      <input id="minutes" type="number" min="0" step="1" value="60" style="width:110px" aria-label="Minutes">
      <span class="muted">မိနစ်</span>
      <button id="create" class="primary">Code အသစ် ထုတ်မယ်</button>
      <button id="trial">အခမဲ့ စမ်း ၅ မိနစ်</button>
    </div>
    <p class="muted" style="margin:6px 0 0">သက်တမ်း: ၆၀ မိနစ်အောက် ၃၀ ရက်၊ ၆၀–၁၇၉ မိနစ် ၉၀ ရက်၊ ၁၈၀ မိနစ်နဲ့အထက် ၁ နှစ် (ဖြည့်ရင် ပြန်စ)။ အခမဲ့ စမ်းခလုတ်က ၇ ရက် သက်တမ်းနဲ့ ၅ မိနစ် Code ကို "trial:" ဆိုတဲ့ နာမည်နဲ့ ထုတ်ပေးပါတယ်။ ကြိုက်ရင် အဲဒီ Code ကိုပဲ + မိနစ် နဲ့ ဖြည့်ပေးပါ။</p>
    <p id="msg"></p>
  </div>
  <div class="card scroll">
    <table>
      <thead><tr><th>Code</th><th>ဘယ်သူ</th><th>ကျန်</th><th>သုံးပြီး</th><th>နောက်ဆုံးသုံး</th><th>သက်တမ်း</th><th></th></tr></thead>
      <tbody id="rows"><tr><td colspan="7" class="muted">Admin token ထည့်ပြီး ဝင်ပါ</td></tr></tbody>
    </table>
  </div>
  <div class="card">
    <h2>Shop · အလိုလို ရောင်းတာ</h2>
    <p class="muted">AI က screenshot ကို စစ်ပြီး မှန်ရင် Code ကို ချက်ချင်း ပေးပါတယ်။ သံသယရှိရင် "စစ်ရန်" မှာ ထားပြီး Telegram ကို ပို့ပါတယ်။</p>
    <p>Telegram: <span id="tgState" class="muted">—</span> <button id="tgLink">Telegram ချိတ်မယ်</button> <button id="tgTest">စမ်းပို့မယ်</button></p>
    <p id="tgBox" hidden style="background:var(--soft,#eef3ff);padding:12px 14px;border-radius:10px;word-break:break-all"></p>
    <p class="muted">ဖုန်း notification (မထည့်လည်းရ): <button id="copyPhone">Copy</button> <span id="phoneSeen"></span></p>
    <div class="scroll"><table>
      <thead><tr><th>Order</th><th>မိနစ်</th><th>ငွေ</th><th>အခြေအနေ</th><th>Code</th><th>အချိန်</th><th></th></tr></thead>
      <tbody id="orders"></tbody>
    </table></div>
    <p class="muted" style="margin:16px 0 4px">ဖုန်းက ပို့တဲ့ notification တွေ</p>
    <div class="scroll"><table>
      <thead><tr><th>အချိန်</th><th>ငွေ</th><th>Wallet</th><th>ပေးသူ / စာ</th><th>Order</th></tr></thead>
      <tbody id="payments"></tbody>
    </table></div>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const store = { get() { try { return sessionStorage.getItem("mf_admin") || ""; } catch { return ""; } },
                set(v) { try { sessionStorage.setItem("mf_admin", v); } catch {} } };
let token = store.get(), fresh = null, all = [], phoneUrl = null;
$("token").value = token;

async function api(path, options = {}) {
  const resp = await fetch("/admin/api" + path, { ...options, headers: { authorization: "Bearer " + token, "content-type": "application/json" } });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data.error && data.error.message) || resp.status);
  return data;
}
const say = (text, bad) => { $("msg").textContent = text; $("msg").style.color = bad ? "var(--bad)" : "var(--ok)"; };
const mins = (ms) => (ms / 60000).toFixed(1).replace(/\\.0$/, "");
const when = (iso) => iso ? new Date(iso).toLocaleString() : "—";

function cell(row, text, cls) { const td = row.insertCell(); td.textContent = text; if (cls) td.className = cls; return td; }
function button(td, label, onClick, cls) { const b = document.createElement("button"); b.textContent = label; b.onclick = onClick; if (cls) b.className = cls; td.append(b, " "); }

async function load() {
  const { codes } = await api("/codes");
  all = codes;
  const tbody = $("rows");
  tbody.textContent = "";
  if (!codes.length) { const r = tbody.insertRow(); cell(r, "Code မရှိသေးပါ", "muted").colSpan = 7; return; }
  for (const c of codes) {
    const r = tbody.insertRow();
    const codeCell = cell(r, "");
    const code = document.createElement("code"); code.textContent = c.code; codeCell.append(code);
    if (c.code === fresh) codeCell.append(" ", Object.assign(document.createElement("span"), { textContent: "အသစ်", className: "new" }));
    cell(r, c.note || "—");
    cell(r, mins(c.balance_ms) + " မိနစ်", "num" + (c.balance_ms <= 0 ? " off" : ""));
    cell(r, mins(c.used_ms) + " မိနစ်", "num");
    cell(r, when(c.last_used_at), "muted");
    const over = c.expires_at && c.expires_at < new Date().toISOString();
    cell(r, c.expires_at ? new Date(c.expires_at).toLocaleDateString() + (over ? " (ကုန်ပြီ)" : "") : "မကုန်", over ? "off" : "muted");
    const actions = r.insertCell();
    button(actions, "Copy", () => navigator.clipboard.writeText(c.code).then(() => say(c.code + " ကူးပြီးပါပြီ")));
    button(actions, "+ မိနစ်", async () => {
      const m = Number(prompt(c.code + " ကို ဘယ်နှစ်မိနစ် ထည့်မလဲ", "60"));
      if (!m) return;
      try { await api("/codes/" + c.code + "/topup", { method: "POST", body: JSON.stringify({ minutes: m }) }); say(c.code + " ကို " + m + " မိနစ် ထည့်ပြီးပါပြီ"); load(); }
      catch (e) { say(e.message, true); }
    });
    button(actions, c.disabled ? "ပြန်ဖွင့်" : "ပိတ်", async () => {
      try { await api("/codes/" + c.code + "/disabled", { method: "POST", body: JSON.stringify({ disabled: !c.disabled }) }); load(); }
      catch (e) { say(e.message, true); }
    });
    button(actions, "ဖျက်", async () => {
      const who = c.note ? " (" + c.note + ")" : "";
      if (!confirm(c.code + who + " ကို အပြီးဖျက်မလား?\\n\\nကျန်တဲ့ " + mins(c.balance_ms) + " မိနစ်နဲ့ မှတ်တမ်းတွေ ပါ ပျက်သွားမယ်။ ပြန်ယူလို့ မရပါ။ ဒီ Code သုံးနေသူ ဆက်သုံးလို့ မရတော့ပါ။")) return;
      try { await api("/codes/" + c.code, { method: "DELETE" }); if (fresh === c.code) fresh = null; say(c.code + " ကို ဖျက်ပြီးပါပြီ"); load(); }
      catch (e) { say(e.message, true); }
    }, "danger");
    if (c.disabled) cell(r, "ပိတ်ထား", "off");
  }
  await loadShop();
}

const ks = (n) => n == null ? "—" : Number(n).toLocaleString("en-US") + " Ks";
const STATUS = { new: "Screenshot စောင့်", checking: "ဖုန်းအတည်ပြုချက် စောင့်", review: "🔎 စစ်ရန်", paid: "✓ ရပြီ",
                 rejected: "✗ ငြင်းပြီး", revoked: "↩️ ပြန်ရုပ်သိမ်းပြီး" };
const BY = { ai: " (AI)", owner: " (လက်နဲ့)", phone: " (ဖုန်း)" };

async function decide(o, action, question) {
  if (!confirm(question)) return;
  try { const res = await api("/shop/" + o.id + "/" + action, { method: "POST", body: "{}" }); say(res.said); load(); }
  catch (e) { say(e.message, true); }
}

async function loadShop() {
  const { orders, payments, phone_url, telegram } = await api("/shop");
  $("tgState").textContent = !telegram.bot ? "TELEGRAM_BOT_TOKEN secret မထည့်ရသေး" : telegram.linked ? "✓ ချိတ်ပြီး" : "Bot ရှိပြီ၊ မချိတ်ရသေး";
  $("tgLink").disabled = !telegram.bot;
  $("tgTest").disabled = !telegram.linked;
  phoneUrl = phone_url;
  $("copyPhone").disabled = !phone_url;
  $("phoneSeen").textContent = !phone_url ? "(PHONE_TOKEN secret မထည့်ရသေး)"
    : payments.length ? "· ဖုန်းက နောက်ဆုံး ပို့ချိန် " + when(payments[0].at) : "· ဖုန်းက ဘာမှ မပို့ရသေး";
  const ob = $("orders"); ob.textContent = "";
  if (!orders.length) cell(ob.insertRow(), "Order မရှိသေးပါ", "muted").colSpan = 7;
  for (const o of orders) {
    const r = ob.insertRow();
    cell(r, o.id.slice(0, 6) + (o.topup ? " (ဖြည့်)" : "") + (o.name ? " · " + o.name : "") + (o.email ? " · " + o.email : ""));
    cell(r, o.minutes, "num");
    cell(r, ks(o.amount), "num");
    const why = o.status === "review" ? o.doubts : o.status === "new" ? o.reason : null;
    const wrote = o.help_sent ? " · 📩 စာ " + o.help_sent : "";
    cell(r, (STATUS[o.status] || o.status) + (o.status === "paid" ? BY[o.paid_by] || "" : "") + (why ? " — " + why : "")
      + (o.txn ? " · Txn " + o.txn : "") + wrote, o.status === "paid" ? "" : "muted");
    cell(r, o.code || "—");
    cell(r, when(o.created_at), "muted");
    const act = r.insertCell();
    if (o.status !== "paid") button(act, "ငွေရပြီ", () => decide(o, "approve", ks(o.amount) + " ကို တကယ် ရထားတာ သေချာလား? Code ကို ချက်ချင်း ပေးပါမယ်။"));
    const seen = (() => { try { return o.seen ? JSON.parse(o.seen) : null; } catch (e) { return null; } })();
    const fair = seen ? Math.floor(seen.amount / 99) : 0;
    if (o.status !== "paid" && o.status !== "revoked" && fair >= 1 && seen.amount !== o.amount)
      button(act, "လွှဲသလောက် " + fair + " မိနစ်", () => decide(o, "approve-paid", ks(seen.amount) + " Ks (AI ဖတ်တာ) တကယ်ဝင်လား? " + fair + " မိနစ် ပေးပါမယ်။"));
    if (o.status === "review" || o.status === "checking") button(act, "ငြင်းမယ်", () => decide(o, "reject", ks(o.amount) + " မဝင်ဘူးလား? Code မပေးဘဲ ငြင်းပါမယ်။"), "danger");
    if (o.status === "paid") button(act, "ပြန်ရုပ်သိမ်း", () => decide(o, "undo", ks(o.amount) + " မဝင်ဘူးလား? ပေးထားတဲ့ " + o.minutes + " မိနစ်ကို ပြန်နုတ်ပါမယ်။"), "danger");
  }
  const pb = $("payments"); pb.textContent = "";
  if (!payments.length) cell(pb.insertRow(), "မရှိသေးပါ", "muted").colSpan = 5;
  for (const p of payments) {
    const r = pb.insertRow();
    cell(r, when(p.at), "muted");
    cell(r, ks(p.amount), "num");
    cell(r, p.wallet || "—");
    cell(r, p.amount == null ? "(ငွေဝင် မဟုတ်) " + p.raw.slice(0, 60) : (p.sender || "—"), p.amount == null ? "muted" : "");
    cell(r, p.order_id ? p.order_id.slice(0, 6) : "—");
  }
}
$("tgLink").onclick = async () => {
  // Shown as a link to tap (on this computer or on the phone), not opened in a pop-up.
  try {
    const { link, bot } = await api("/shop/telegram", { method: "POST", body: "{}" });
    const box = $("tgBox");
    box.textContent = "";
    const a = Object.assign(document.createElement("a"), { href: link, target: "_blank", rel: "noopener", textContent: "👉 @" + bot + " ကို Telegram မှာ ဖွင့်မယ်" });
    a.style.fontWeight = "700";
    box.append(a, document.createElement("br"), "ဖွင့်ပြီး START နှိပ်ပါ။ ဖုန်းမှာ ဖွင့်ချင်ရင် ဒီ link ကို ကူးပို့ပါ (တစ်ခါပဲ သုံးလို့ရ):", document.createElement("br"),
               Object.assign(document.createElement("code"), { textContent: link }));
    box.hidden = false;
    say("START နှိပ်ပြီးရင် ဒီ page ကို refresh လုပ်ပါ။");
  } catch (e) { say(e.message, true); }
};
$("tgTest").onclick = async () => {
  try { await api("/shop/telegram/test", { method: "POST", body: "{}" }); say("Telegram ကို စမ်းစာ ပို့ပြီးပါပြီ"); }
  catch (e) { say(e.message, true); }
};
$("copyPhone").onclick = () => phoneUrl && navigator.clipboard.writeText(phoneUrl).then(() => say("ဖုန်းချိတ်ရန် link ကူးပြီးပါပြီ — MacroDroid ထဲ Paste လုပ်ပါ"));

$("login").onclick = async () => {
  token = $("token").value.trim(); store.set(token);
  try { await load(); say("ဝင်ပြီးပါပြီ"); } catch (e) { say(e.message, true); }
};
async function create(note, minutes, days) {
  try {
    const { code } = await api("/codes", { method: "POST", body: JSON.stringify({ note, minutes, days }) });
    fresh = code; $("note").value = ""; say(code + " ထုတ်ပြီးပါပြီ — Copy နှိပ်ပြီး ပို့ပေးပါ"); load();
  } catch (e) { say(e.message, true); }
}
$("create").onclick = () => {
  const minutes = Number($("minutes").value);
  if (!(minutes >= 0)) return say("မိနစ် ထည့်ပါ", true);
  create($("note").value.trim(), minutes);
};
// A free 5-minute code, marked "trial:" so it's easy to spot (and to see who already had one).
$("trial").onclick = () => {
  const who = $("note").value.trim();
  if (!who) return say("ဘယ်သူ့အတွက်လဲ ဆိုတာ အရင်ထည့်ပါ (တစ်ယောက် တစ်ခါပဲ ပေးဖို့)", true);
  const had = all.find((c) => (c.note || "").toLowerCase() === ("trial: " + who).toLowerCase());
  if (had && !confirm(who + " က " + had.code + " နဲ့ အခမဲ့ စမ်းပြီးသားပါ။ နောက်တစ်ခု ထပ်ပေးမလား?")) return;
  create("trial: " + who, 5, 7);
};
if (token) load().catch((e) => say(e.message, true));
</script>
</body>
</html>`;
