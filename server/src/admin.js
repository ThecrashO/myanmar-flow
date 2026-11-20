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
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:16px; }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  input { font:inherit; color:inherit; background:transparent; border:1px solid var(--line); border-radius:8px; padding:7px 10px; min-width:0; }
  button { font:inherit; color:inherit; background:transparent; border:1px solid var(--line); border-radius:8px; padding:6px 12px; cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button:hover { border-color:var(--muted); }
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
      <input id="minutes" type="number" min="0" step="1" value="110" style="width:110px" aria-label="Minutes">
      <span class="muted">မိနစ်</span>
      <button id="create" class="primary">Code အသစ် ထုတ်မယ်</button>
    </div>
    <p id="msg"></p>
  </div>
  <div class="card scroll">
    <table>
      <thead><tr><th>Code</th><th>ဘယ်သူ</th><th>ကျန်</th><th>သုံးပြီး</th><th>နောက်ဆုံးသုံး</th><th></th></tr></thead>
      <tbody id="rows"><tr><td colspan="6" class="muted">Admin token ထည့်ပြီး ဝင်ပါ</td></tr></tbody>
    </table>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const store = { get() { try { return sessionStorage.getItem("mf_admin") || ""; } catch { return ""; } },
                set(v) { try { sessionStorage.setItem("mf_admin", v); } catch {} } };
let token = store.get(), fresh = null;
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
function button(td, label, onClick) { const b = document.createElement("button"); b.textContent = label; b.onclick = onClick; td.append(b, " "); }

async function load() {
  const { codes } = await api("/codes");
  const tbody = $("rows");
  tbody.textContent = "";
  if (!codes.length) { const r = tbody.insertRow(); cell(r, "Code မရှိသေးပါ", "muted").colSpan = 6; return; }
  for (const c of codes) {
    const r = tbody.insertRow();
    const codeCell = cell(r, "");
    const code = document.createElement("code"); code.textContent = c.code; codeCell.append(code);
    if (c.code === fresh) codeCell.append(" ", Object.assign(document.createElement("span"), { textContent: "အသစ်", className: "new" }));
    cell(r, c.note || "—");
    cell(r, mins(c.balance_ms) + " မိနစ်", "num" + (c.balance_ms <= 0 ? " off" : ""));
    cell(r, mins(c.used_ms) + " မိနစ်", "num");
    cell(r, when(c.last_used_at), "muted");
    const actions = r.insertCell();
    button(actions, "Copy", () => navigator.clipboard.writeText(c.code).then(() => say(c.code + " ကူးပြီးပါပြီ")));
    button(actions, "+ မိနစ်", async () => {
      const m = Number(prompt(c.code + " ကို ဘယ်နှစ်မိနစ် ထည့်မလဲ", "110"));
      if (!m) return;
      try { await api("/codes/" + c.code + "/topup", { method: "POST", body: JSON.stringify({ minutes: m }) }); say(c.code + " ကို " + m + " မိနစ် ထည့်ပြီးပါပြီ"); load(); }
      catch (e) { say(e.message, true); }
    });
    button(actions, c.disabled ? "ပြန်ဖွင့်" : "ပိတ်", async () => {
      try { await api("/codes/" + c.code + "/disabled", { method: "POST", body: JSON.stringify({ disabled: !c.disabled }) }); load(); }
      catch (e) { say(e.message, true); }
    });
    if (c.disabled) cell(r, "ပိတ်ထား", "off");
  }
}

$("login").onclick = async () => {
  token = $("token").value.trim(); store.set(token);
  try { await load(); say("ဝင်ပြီးပါပြီ"); } catch (e) { say(e.message, true); }
};
$("create").onclick = async () => {
  const minutes = Number($("minutes").value);
  if (!(minutes >= 0)) return say("မိနစ် ထည့်ပါ", true);
  try {
    const { code } = await api("/codes", { method: "POST", body: JSON.stringify({ note: $("note").value.trim(), minutes }) });
    fresh = code; $("note").value = ""; say(code + " ထုတ်ပြီးပါပြီ — Copy နှိပ်ပြီး ပို့ပေးပါ"); load();
  } catch (e) { say(e.message, true); }
};
if (token) load().catch((e) => say(e.message, true));
</script>
</body>
</html>`;
