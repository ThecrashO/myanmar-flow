"""End-to-end test of the shop against a LOCAL server (npx wrangler dev), never the live one:
it makes orders, fake receipts and fake phone notifications.

    server/.dev.vars needs GEMINI_API_KEY, ADMIN_TOKEN and PHONE_TOKEN.
    npx wrangler d1 execute myanmar-flow --local --file schema.sql   (on an empty local database:
    it expects 5,940 to be the first free amount and counts orders per hour)
    npx wrangler dev --port 8799
    .venv/Scripts/python server/tests/shop_test.py http://127.0.0.1:8799

Makes about 8 small Gemini calls.
"""
import io
import sys
import uuid
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8799").rstrip("/")
if not BASE.startswith(("http://127.0.0.1", "http://localhost")):
    sys.exit("shop_test makes fake payments: run it against a local server only.")
VARS = dict(line.split("=", 1) for line in (Path(__file__).parents[1] / ".dev.vars").read_text().splitlines() if "=" in line)
ADMIN = {"Authorization": "Bearer " + VARS["ADMIN_TOKEN"]}
INBOX = f"{BASE}/mf/pay-inbox/{VARS['PHONE_TOKEN']}"
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


def receipt(amount, txn, receiver="******9168", status="Transfer Successful"):
    """A made-up wallet receipt screenshot, for this test only."""
    img = Image.new("RGB", (720, 1280), "#f4f6fb")
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 720, 140), fill="#0b5cab")
    d.text((40, 50), "KBZPay", font=font(44), fill="white")
    d.ellipse((310, 200, 410, 300), fill="#22a35a")
    d.text((330, 222), "OK", font=font(40), fill="white")
    d.text((360, 340), status, font=font(40), fill="#111", anchor="mm")
    d.text((360, 430), f"-{amount:,.2f} Ks", font=font(64), fill="#111", anchor="mm")
    rows = [("Transaction Time", "27/11/2026 22:41:07"), ("Transaction No.", txn), ("Transaction Type", "Transfer"),
            ("Transfer To", f"Thecrasho ({receiver})"), ("Notes", "Myanmar Flow")]
    y = 560
    for k, v in rows:
        d.text((50, y), k, font=font(30), fill="#666")
        d.text((670, y), v, font=font(30), fill="#111", anchor="ra")
        y += 80
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


EMAIL = f"buyer-{uuid.uuid4().hex[:6]}@example.com"


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


def days_left(code):
    """Whole days until the code expires (None if it never does)."""
    from datetime import datetime, timezone
    iso = requests.get(f"{BASE}/mf/balance", headers={"Authorization": f"Bearer {code}"}, timeout=20).json().get("expires_at")
    return None if not iso else round((datetime.fromisoformat(iso.replace("Z", "+00:00")) - datetime.now(timezone.utc)).total_seconds() / 86400)


def seconds(code):
    return requests.get(f"{BASE}/mf/balance", headers={"Authorization": f"Bearer {code}"}, timeout=20).json().get("seconds")


txn_a = "01" + uuid.uuid4().hex[:12].upper()
txn_b = "02" + uuid.uuid4().hex[:12].upper()

# Orders get unique amounts.
a = order(60)
b = order(60)
check("first order costs 5,940", a["amount"] == 5940, a)
check("second open order of the same size costs 5,941", b["amount"] == 5941, b)
check("bad minutes refused", requests.post(f"{BASE}/mf/orders", json={"minutes": 3, "name": "x", "email": EMAIL}).status_code == 400)
check("an order needs a name and email", requests.post(f"{BASE}/mf/orders", json={"minutes": 60, "name": "x", "email": "nope"}).json()["error"]["status"] == "mf_bad_contact")

# Screenshots: wrong amount, wrong receiver, not a receipt, then the right one.
r = shot(a, receipt(5000, txn_a))
check("wrong amount is refused with the reason", r["status"] == "new" and "5,940" in (r["reason"] or ""), r)
r = shot(a, receipt(5940, txn_a, receiver="******1234"))
check("wrong receiver is refused", r["status"] == "new" and "နံပါတ်" in (r["reason"] or ""), r)
blank = io.BytesIO()
Image.new("RGB", (600, 800), "#88aaff").save(blank, "PNG")
r = shot(a, blank.getvalue())
check("a picture that isn't a receipt is refused", r["status"] == "new" and r["reason"], r)
r = shot(a, receipt(5940, txn_a))
check("a good screenshot moves the order to checking", r["status"] == "checking" and not r["code"], r)
check("a screenshot alone gives no code", status(a)["status"] == "checking")

# The phone: a notification that isn't money in, then the real one.
r = notify("KBZPay: Your OTP is 123456. Do not share it.").json()
check("an OTP notification is not counted as money", r.get("received") is False, r)
check("wrong phone link refused", requests.post(f"{BASE}/mf/pay-inbox/wrong-token-0000000", data="x").status_code == 401)
r = notify(f"KBZPay\nYou have received 5,940.00 MMK from AUNG AUNG (09*****321). Transaction No. {txn_a}").json()
check("the money notification is read", r.get("received") is True, r)
s = status(a)
check("screenshot + notification = paid with a new code", s["status"] == "paid" and s["code"], s)
code = s["code"]
check("the new code has 60 minutes", seconds(code) == 3600, seconds(code))
check("a 60-minute code lasts 90 days", days_left(code) == 90, days_left(code))
check("the same notification again is ignored", notify(f"KBZPay\nYou have received 5,940.00 MMK from AUNG AUNG (09*****321). Transaction No. {txn_a}").json().get("duplicate"))

# The same screenshot can't be reused for another order.
r = shot(b, receipt(5941, txn_a))
check("a used transaction ID is refused", r["status"] == "new" and "သုံးပြီးသား" in (r["reason"] or ""), r)

# Top-up, with the notification arriving before the screenshot.
t = order(30, code=code)
check("top-up order costs 2,970", t["amount"] == 2970 and t["topup"] == code, t)
notify(f"WavePay: You received 2,970 Ks from 09xxxxx555. Trans ID: {txn_b}")
r = shot(t, receipt(2970, txn_b))
check("notification first, screenshot second also completes", r["status"] == "paid" and r["code"] == code, r)
check("the code now has 90 minutes", seconds(code) == 5400, seconds(code))
check("a smaller top-up doesn't shorten the 90 days", days_left(code) == 90, days_left(code))
check("top-up for an unknown code is refused", requests.post(
    f"{BASE}/mf/orders", json={"minutes": 30, "code": "MF-ZZZZ-ZZZZ", "name": "x", "email": EMAIL}).status_code == 404)

# A lost code comes back with the email and a transaction ID, not with the email alone.
rec = lambda email, txn: requests.post(f"{BASE}/mf/recover", json={"email": email, "txn": txn}, timeout=20)
r = rec(EMAIL.upper(), txn_b.lower())
check("email + transaction ID gets the code back", r.status_code == 200 and [c["code"] for c in r.json()["codes"]] == [code], r.text)
check("the right email with a wrong transaction ID gets nothing", rec(EMAIL, "99999999").status_code == 404)
check("someone else's email with a real transaction ID gets nothing", rec("other@example.com", txn_a).status_code == 404)

# The owner can approve a stuck order by hand from the admin page.
shop = requests.get(f"{BASE}/admin/api/shop", headers=ADMIN, timeout=20).json()
check("admin sees orders, notifications and the phone link", len(shop["orders"]) >= 3 and shop["payments"] and shop["phone_url"].endswith(VARS["PHONE_TOKEN"]))
r = requests.post(f"{BASE}/admin/api/shop/{b['id']}/approve", headers=ADMIN, json={}, timeout=20).json()
check("manual approve gives a code", r.get("ok") and r.get("code"), r)
big = order(180)
r3 = requests.post(f"{BASE}/admin/api/shop/{big['id']}/approve", headers=ADMIN, json={}, timeout=20).json()
check("a 3-hour code lasts a year", days_left(r3["code"]) == 365, days_left(r3["code"]))
check("manual approve gives the minutes once", seconds(r["code"]) == 3600 and requests.post(
    f"{BASE}/admin/api/shop/{b['id']}/approve", headers=ADMIN, json={}).json()["code"] == r["code"] and seconds(r["code"]) == 3600)

# Free trial: once per computer.
device = "test-" + uuid.uuid4().hex
r = requests.post(f"{BASE}/mf/trial", json={"device": device}, timeout=20)
check("free trial gives a 5-minute code", r.status_code == 201 and seconds(r.json()["code"]) == 300, r.text)
check("the free trial lasts 7 days", days_left(r.json()["code"]) == 7, days_left(r.json()["code"]))
r = requests.post(f"{BASE}/mf/trial", json={"device": device}, timeout=20)
check("the same computer can't get a second trial", r.status_code == 409, r.text)
check("the buy page is served", "Code ဝယ်ရန်" in requests.get(f"{BASE}/buy", timeout=20).text)

print("\nall passed" if not failures else f"\n{failures} failed")
sys.exit(1 if failures else 0)
