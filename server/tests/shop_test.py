"""End-to-end test of the shop against a LOCAL server (npx wrangler dev), never the live one:
it makes orders, fake receipts, fake phone notifications and fake Telegram button presses.

    server/.dev.vars needs GEMINI_API_KEY, ADMIN_TOKEN, PHONE_TOKEN and TELEGRAM_BOT_TOKEN
    (any made-up bot token: messages to Telegram then just fail, which the shop shrugs off).
    rm -rf .wrangler/state; npx wrangler d1 execute myanmar-flow --local --file schema.sql
    (an empty local database: it expects 5,100 to be the first free amount)
    npx wrangler dev --port 8799
    .venv/Scripts/python server/tests/shop_test.py http://127.0.0.1:8799

Makes about 12 small Gemini calls.
"""
import hashlib
import io
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8799").rstrip("/")
if not BASE.startswith(("http://127.0.0.1", "http://localhost")):
    sys.exit("shop_test makes fake payments: run it against a local server only.")
SERVER = Path(__file__).parents[1]
VARS = dict(line.split("=", 1) for line in (SERVER / ".dev.vars").read_text().splitlines() if "=" in line)
ADMIN = {"Authorization": "Bearer " + VARS["ADMIN_TOKEN"]}
INBOX = f"{BASE}/mf/pay-inbox/{VARS['PHONE_TOKEN']}"
HOOK = {"x-telegram-bot-api-secret-token": hashlib.sha256(("mf-tg:" + VARS["TELEGRAM_BOT_TOKEN"]).encode()).hexdigest()[:48]}
MMT = timezone(timedelta(hours=6, minutes=30))
failures = 0


def check(name, ok, detail=""):
    global failures
    failures += not ok
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def font(size):
    for name in ("arial.ttf", "Arial.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def receipt(amount, txn, receiver="******9168", status="Transfer Successful", when=None):
    """A made-up wallet receipt screenshot, for this test only. txn=None leaves the ID out."""
    when = when or datetime.now(MMT)
    img = Image.new("RGB", (720, 1280), "#f4f6fb")
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 720, 140), fill="#0b5cab")
    d.text((40, 50), "KBZPay", font=font(44), fill="white")
    d.ellipse((310, 200, 410, 300), fill="#22a35a")
    d.text((330, 222), "OK", font=font(40), fill="white")
    d.text((360, 340), status, font=font(40), fill="#111", anchor="mm")
    d.text((360, 430), f"-{amount:,.2f} Ks", font=font(64), fill="#111", anchor="mm")
    rows = [("Transaction Time", when.strftime("%d/%m/%Y %H:%M:%S"))]
    if txn:
        rows.append(("Transaction No.", txn))
    rows += [("Transaction Type", "Transfer"), ("Transfer To", f"Thecrasho ({receiver})"), ("Notes", "Crash Flow")]
    y = 560
    for k, v in rows:
        d.text((50, y), k, font=font(30), fill="#666")
        d.text((670, y), v, font=font(30), fill="#111", anchor="ra")
        y += 80
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


EMAIL = f"buyer-{uuid.uuid4().hex[:6]}@example.com"
OWNER = 777000111


def order(minutes, code=None):
    body = {"minutes": minutes, "name": "Test Buyer", "email": EMAIL, **({"code": code} if code else {})}
    r = requests.post(f"{BASE}/mf/orders", json=body, timeout=30)
    assert r.status_code == 201, r.text
    return r.json()


def shot(o, png):
    return requests.post(f"{BASE}/mf/orders/{o['id']}/screenshot", data=png, headers={"content-type": "image/png"}, timeout=90).json()


def notify(text):
    return requests.post(INBOX, data=text.encode(), headers={"content-type": "text/plain"}, timeout=60)


def status(o):
    return requests.get(f"{BASE}/mf/orders/{o['id']}", timeout=30).json()


def press(data, user=OWNER):
    """A Telegram button press, as Telegram would send it to the webhook."""
    update = {"update_id": 1, "callback_query": {"id": "q1", "from": {"id": user}, "data": data,
              "message": {"message_id": 5, "chat": {"id": user, "type": "private"}, "caption": "x", "photo": [{}]}}}
    return requests.post(f"{BASE}/mf/tg", json=update, headers=HOOK, timeout=30)


def balance(code):
    return requests.get(f"{BASE}/mf/balance", headers={"Authorization": f"Bearer {code}"}, timeout=20).json()


def seconds(code):
    return balance(code).get("seconds")


def days_left(code):
    """Whole days until the code expires (None if it never does)."""
    iso = balance(code).get("expires_at")
    return None if not iso else round((datetime.fromisoformat(iso.replace("Z", "+00:00")) - datetime.now(timezone.utc)).total_seconds() / 86400)


def admin_code(code):
    return next(c for c in requests.get(f"{BASE}/admin/api/codes", headers=ADMIN, timeout=20).json()["codes"] if c["code"] == code)


def pay_through(o, png):
    """Upload the receipt and simulate the owner's confirmation."""
    r = shot(o, png)
    if r["status"] == "review":
        print(f"     (order {o['id'][:6]} awaits payment confirmation; approving)")
        press("ok:" + o["id"])
        r = status(o)
    return r


tx = lambda n: f"{n:02d}" + uuid.uuid4().hex[:12].upper()

def local_sql(sql):
    subprocess.run(["npx", "wrangler", "d1", "execute", "myanmar-flow", "--local", "--command", sql],
                   cwd=SERVER, check=True, capture_output=True, shell=sys.platform == "win32")


# Telegram: link the owner's chat with the one-time code the admin page would make.
link = uuid.uuid4().hex[:16]
subprocess.run(["npx", "wrangler", "d1", "execute", "myanmar-flow", "--local", "--command",
                f"INSERT INTO settings (key, value) VALUES ('tg_link', '{link}') ON CONFLICT (key) DO UPDATE SET value = '{link}'"],
               cwd=SERVER, check=True, capture_output=True, shell=sys.platform == "win32")
start = lambda text, user=OWNER: requests.post(f"{BASE}/mf/tg", headers=HOOK, timeout=30, json={
    "update_id": 2, "message": {"message_id": 1, "text": text, "chat": {"id": user, "type": "private"}, "from": {"id": user}}})
check("Telegram webhook refuses a wrong secret", requests.post(f"{BASE}/mf/tg", json={}, headers={"x-telegram-bot-api-secret-token": "nope"}).status_code == 401)
start("/start " + "x" * 16, user=12345)
check("a wrong start code doesn't link", not requests.get(f"{BASE}/admin/api/shop", headers=ADMIN).json()["telegram"]["linked"])
start("/start " + link)
check("the start link connects the owner's chat", requests.get(f"{BASE}/admin/api/shop", headers=ADMIN).json()["telegram"]["linked"])

# Orders get unique amounts.
a = order(60)
b = order(60)
check("first order costs 5,100", a["amount"] == 5100, a)
check("second open order of the same size costs 5,101", b["amount"] == 5101, b)
check("bad minutes refused", requests.post(f"{BASE}/mf/orders", json={"minutes": 3, "name": "x", "email": EMAIL}).status_code == 400)
check("an order needs a name and email", requests.post(f"{BASE}/mf/orders", json={"minutes": 60, "name": "x", "email": "nope"}).json()["error"]["status"] == "mf_bad_contact")

# Screenshots the buyer must redo: wrong amount, wrong receiver, not a receipt.
txn_a = tx(1)
r = shot(a, receipt(5000, txn_a))
check("wrong amount is refused with the reason", r["status"] == "new" and "5,100" in (r["reason"] or ""), r)
check("the order says up to 6,000 is fine", r["max_amount"] == 6000, r)
r = shot(a, receipt(5100, txn_a, receiver="******1234"))
check("wrong receiver is refused", r["status"] == "new" and "နံပါတ်" in (r["reason"] or ""), r)
blank = io.BytesIO()
Image.new("RGB", (600, 800), "#88aaff").save(blank, "PNG")
r = shot(a, blank.getvalue())
check("a picture that isn't a receipt is refused", r["status"] == "new" and r["reason"], r)

# A good screenshot records a claim. It takes independent confirmation to issue a code.
r = shot(a, receipt(5100, txn_a))
check("a good screenshot alone gives no code", r["status"] == "review" and not r["code"], r)
press("ok:" + a["id"])
r = status(a)
check("owner confirmation gives a code", r["status"] == "paid" and r["code"], r)
code = r["code"]
check("the new code has 60 minutes", seconds(code) == 3600, seconds(code))
check("a 60-minute code lasts 30 days", days_left(code) == 30, days_left(code))
check("a paid order ignores more screenshots", shot(a, receipt(5100, tx(9)))["code"] == code)

# The same transaction ID can't pay a second order.
r = shot(b, receipt(5101, txn_a))
check("a used transaction ID is refused", r["status"] == "new" and "သုံးပြီးသား" in (r["reason"] or ""), r)

# Doubtful receipts wait for the owner: no transaction ID, or paid before the order existed.
r = shot(b, receipt(5101, None))
check("no transaction ID → review, no code", r["status"] == "review" and not r["code"], r)
check("the buyer is told it's being checked", "စစ်ပြီး" in (r["reason"] or ""), r)
doubts = next(o for o in requests.get(f"{BASE}/admin/api/shop", headers=ADMIN).json()["orders"] if o["id"] == b["id"])["doubts"]
check("the owner sees why", "Transaction ID" in (doubts or ""), doubts)
check("a stranger's button press is ignored", press("ok:" + b["id"], user=999).ok and status(b)["status"] == "review")
press("ok:" + b["id"])
s = status(b)
check("the owner's ✅ gives the code", s["status"] == "paid" and s["code"], s)
check("pressing ✅ twice gives the minutes once", press("ok:" + b["id"]).ok and seconds(s["code"]) == 3600, seconds(s["code"]))

c = order(30)
r = shot(c, receipt(2970, tx(3), when=datetime.now(MMT) - timedelta(days=1)))
check("a receipt from before the order → review", r["status"] == "review", r)
press("no:" + c["id"])
s = status(c)
check("the owner's ❌ rejects it with a message", s["status"] == "rejected" and not s["code"] and s["reason"], s)
check("a rejected order ignores more screenshots", shot(c, receipt(2970, tx(4)))["status"] == "rejected")

# Undo: the owner finds the money never came; the minutes go back.
press("undo:" + a["id"])
s = status(a)
check("↩️ revokes a paid order", s["status"] == "revoked" and not s["code"], s)
row = admin_code(code)
check("the revoked new code is emptied and switched off", row["balance_ms"] == 0 and row["disabled"] == 1, row)

# Top-up, then undo takes back only the top-up.
keep = s2 = status(b)["code"]
t = order(30, code=keep)
check("top-up order costs 2,970", t["amount"] in (2970, 2971) and t["topup"] == keep, t)
r = pay_through(t, receipt(t["amount"], tx(5)))
check("a top-up adds to the same code", r["status"] == "paid" and r["code"] == keep and seconds(keep) == 5400, (r, seconds(keep)))
check("a smaller top-up doesn't shorten the 30 days", days_left(keep) == 30, days_left(keep))
r = requests.post(f"{BASE}/admin/api/shop/{t['id']}/undo", headers=ADMIN, json={}).json()
check("admin undo of a top-up takes back 30 minutes only", r["status"] == "revoked" and seconds(keep) == 3600 and not admin_code(keep)["disabled"], (r, seconds(keep)))

# A phone notification still approves an order in review.
d = order(30)
r = shot(d, receipt(d["amount"], None))
check("(another order in review)", r["status"] == "review", r)
check("an OTP notification is not counted as money", notify("KBZPay: Your OTP is 123456. Do not share it.").json().get("received") is False)
check("wrong phone link refused", requests.post(f"{BASE}/mf/pay-inbox/wrong-token-0000000", data="x").status_code == 401)
notify(f"KBZPay\nYou have received {d['amount']:,}.00 MMK from AUNG AUNG (09*****321). Transaction No. {tx(6)}")
s = status(d)
check("a matching 'money received' notification pays an order in review", s["status"] == "paid" and s["code"], s)

# Lost codes: email + transaction ID.
rec = lambda email, txn: requests.post(f"{BASE}/mf/recover", json={"email": email, "txn": txn}, timeout=20)
big = order(180)
txn_big = tx(7)
r = pay_through(big, receipt(big["amount"], txn_big))
check("a 3-hour code lasts 90 days", days_left(r["code"]) == 90, days_left(r["code"]))
r2 = rec(EMAIL.upper(), txn_big.lower())
check("email + transaction ID gets the codes back", r2.status_code == 200 and r["code"] in [c["code"] for c in r2.json()["codes"]], r2.text)
check("the right email with a wrong transaction ID gets nothing", rec(EMAIL, "99999999").status_code == 404)
check("someone else's email with a real transaction ID gets nothing", rec("other@example.com", txn_big).status_code == 404)

# Admin page: orders, reasons, and approve / reject from there.
e = order(30)
r = requests.post(f"{BASE}/admin/api/shop/{e['id']}/approve", headers=ADMIN, json={}).json()
check("admin approve gives a code", r.get("ok") and r.get("code") and r["status"] == "paid", r)
shop = requests.get(f"{BASE}/admin/api/shop", headers=ADMIN, timeout=20).json()
mine = {o["id"]: o for o in shop["orders"]}
check("admin sees who paid each order", mine[e["id"]]["paid_by"] == "owner" and mine[d["id"]]["paid_by"] == "phone", (mine[e["id"]]["paid_by"], mine[d["id"]]["paid_by"]))
check("admin sees the phone link", shop["phone_url"].endswith(VARS["PHONE_TOKEN"]))

# Paying a little more is fine; a wrong amount can still be paid for what was sent.
local_sql("UPDATE orders SET net = 'earlier'")  # past the 8-orders-an-hour limit for this network
f = order(60)
r = pay_through(f, receipt(6000, tx(10)))
check("paying up to the next 1,000 Ks gives the ordered minutes", r["status"] == "paid" and seconds(r["code"]) == 3600, (r, r.get("code") and seconds(r["code"])))
g = order(60)
r = shot(g, receipt(7500, tx(11)))
check("7,500 for a 5,1xx order is refused", r["status"] == "new" and "7,500" in (r["reason"] or ""), r)
seen = next(o for o in requests.get(f"{BASE}/admin/api/shop", headers=ADMIN).json()["orders"] if o["id"] == g["id"])["seen"]
check("the owner can see what was paid", '"amount":7500' in (seen or ""), seen)
fair = next(o for o in requests.get(f"{BASE}/admin/api/shop", headers=ADMIN).json()["orders"] if o["id"] == g["id"])["fair"]
check("admin is told the fair minutes for 7,500 (88)", fair == 88, fair)
page = requests.get(f"{BASE}/buy", timeout=20).text
check("the buy page gets the price tiers from the server", "var TIERS = [[180,75],[60,85],[0,99]]" in page)
check("a 3-hour order costs 13,500", order(180)["amount"] in (13500, 13501))
press("paid:" + g["id"])
s = status(g)
check("💵 gives minutes for what was paid (88 at 85 Ks)", s["status"] == "paid" and s["minutes"] == 88 and seconds(s["code"]) == 88 * 60, s)
h = order(60)
r = shot(h, receipt(3000, tx(12)))
check("3,000 for a 5,1xx order is refused", r["status"] == "new", r)
helpme = lambda text: requests.post(f"{BASE}/mf/orders/{h['id']}/help", json={"text": text, "phone": "09 123"}, timeout=30)
check("a message needs some text", helpme("").status_code == 400)
r = helpme("3,000 ပဲ လွှဲမိတယ်")
check("the buyer can write to the owner", r.status_code == 200 and r.json()["help_left"] == 2, r.text)
helpme("2"); helpme("3")
check("at most 3 messages per order", helpme("4").status_code == 429)
r = requests.post(f"{BASE}/admin/api/shop/{h['id']}/approve-paid", headers=ADMIN, json={}).json()
check("admin can also pay for what was sent (30 minutes)", r["status"] == "paid" and seconds(r["code"]) == 30 * 60, r)

# Free trial: once per computer.
device = "test-" + uuid.uuid4().hex
r = requests.post(f"{BASE}/mf/trial", json={"device": device}, timeout=20)
check("free trial gives a 5-minute code", r.status_code == 201 and seconds(r.json()["code"]) == 300, r.text)
check("the free trial lasts 7 days", days_left(r.json()["code"]) == 7, days_left(r.json()["code"]))
check("the same computer can't get a second trial", requests.post(f"{BASE}/mf/trial", json={"device": device}, timeout=20).status_code == 409)
check("the buy page is served", "Code ဝယ်ရန်" in requests.get(f"{BASE}/buy", timeout=20).text)

print("\nall passed" if not failures else f"\n{failures} failed")
sys.exit(1 if failures else 0)
