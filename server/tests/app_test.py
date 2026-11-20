"""Drive the app's own functions (transcribe, rewrite, LiveTranscriber, error
messages) through the code server, as a user with a code would.

Usage: python server/tests/app_test.py [server url] [wav file]
Run it with the app's .venv Python. It reads the app's settings but doesn't change them.
The codes it makes are switched off at the end."""
import os
import sys
import time
import wave
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://myanmar-flow.thecrasho.com").rstrip("/")
WAV = sys.argv[2] if len(sys.argv) > 2 else str(HERE / "speech.wav")


def admin_token():
    token = os.environ.get("MF_ADMIN_TOKEN")
    if not token:
        path = HERE.parent / ".admin-token.txt"
        if not path.exists():
            sys.exit("Set MF_ADMIN_TOKEN or put the token in server/.admin-token.txt")
        token = path.read_text().strip()
    return token


ADMIN = {"authorization": "Bearer " + admin_token()}
os.environ["MF_SERVER"] = BASE
sys.path.insert(0, str(HERE.parents[1]))
import myanmar_flow as mf  # noqa: E402

code = requests.post(BASE + "/admin/api/codes", headers=ADMIN, json={"note": "app_test", "minutes": 3}).json()["code"]
cfg = dict(mf.load_config(), api_key="", pro_code=code, polish=True)
ok = True


def check(name, cond, detail=""):
    global ok
    ok &= bool(cond)
    print(("PASS " if cond else "FAIL ") + name, detail)



check("code mode on", mf.using_code(cfg) and mf.has_credentials(cfg) and mf.api_base(cfg) == BASE)
secs, err = mf.code_balance(code)
check("balance 180 s", secs == 180, err)
wav = open(WAV, "rb").read()
text = mf.transcribe(cfg, wav)
check("batch transcribe", "report" in text.lower(), text[:80])
check("rewrite (clean-up)", mf.rewrite(cfg, text), "")
with wave.open(WAV) as w:
    pcm = w.readframes(w.getnframes())
live = mf.LiveTranscriber(cfg, lambda t: None)
for i in range(0, len(pcm), 3200):
    live.feed(pcm[i:i + 3200]); time.sleep(0.1)
final = live.finish(timeout=15)
check("live transcribe", "report" in final.lower(), final[:80])
time.sleep(2)
secs2, _ = mf.code_balance(code)
print("used seconds:", secs - secs2)
check("charged ~2 clips + 5 s", 20 < secs - secs2 < 26)
_, err = mf.code_balance("MF-AAAA-BBBB")
check("wrong code message", err == "Code မှားနေပါတယ် - Settings မှာစစ်ပါ", err)
empty = requests.post(BASE + "/admin/api/codes", headers=ADMIN, json={"note": "app_test empty", "minutes": 0}).json()["code"]
for name, fn in [("batch", lambda c: mf.transcribe(c, wav)),
                 ("live", lambda c: mf.LiveTranscriber(c, lambda t: None).finish(timeout=10))]:
    try:
        fn(dict(cfg, pro_code=empty)); check(f"empty {name} fails", False)
    except Exception as e:
        check(f"empty {name}: out-of-minutes message", mf.friendly_error(e) == "မိနစ် ကုန်သွားပါပြီ - ငွေဖြည့်ပါ", mf.friendly_error(e))
own = dict(cfg, pro_code="")
check("own key mode unchanged", mf.api_base(own) == mf.GOOGLE_API and "x-goog-api-key" in mf.api_headers(own))
for c in (code, empty):
    requests.post(f"{BASE}/admin/api/codes/{c}/disabled", headers=ADMIN, json={"disabled": True})
print("ALL PASS" if ok else "SOME FAILED")
sys.exit(0 if ok else 1)
