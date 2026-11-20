"""Use the app with an existing code, the way a user would: check the balance, transcribe
with Live and batch, run AI clean-up, and see what each one cost. Needs no admin token,
so it can run on machines that only hold a code (the GitHub Mac runners).

Usage: MF_TEST_CODE=MF-XXXX-XXXX python server/tests/code_test.py [server url] [wav file]
Uses about 23 seconds of the code's minutes per run."""
import os
import platform
import sys
import time
import wave
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://myanmar-flow.thecrasho.com").rstrip("/")
WAV = sys.argv[2] if len(sys.argv) > 2 else str(HERE / "speech.wav")
CODE = os.environ.get("MF_TEST_CODE", "").strip()
if not CODE:
    sys.exit("Set MF_TEST_CODE to a code with at least a minute left")

os.environ["MF_SERVER"] = BASE
sys.path.insert(0, str(HERE.parents[1]))
import myanmar_flow as mf  # noqa: E402  (also imports this OS's platform module)

ok = True


def check(name, cond, detail=""):
    global ok
    ok &= bool(cond)
    print(("PASS " if cond else "FAIL ") + name, detail)


print(f"{platform.system()} {platform.machine()}, Python {platform.python_version()}, Myanmar Flow {mf.APP_VERSION}")
cfg = dict(mf.DEFAULT_CONFIG, pro_code=CODE, polish=True)  # fresh settings, nothing read or saved
check("code mode on", mf.using_code(cfg) and mf.has_credentials(cfg) and mf.api_base(cfg) == BASE)

before, problem = mf.code_balance(CODE)
check("balance", before is not None, problem or mf.minutes_text(before))
if before is None or before < 30:
    sys.exit("The code needs at least 30 seconds left")

with wave.open(WAV) as w:
    pcm = w.readframes(w.getnframes())
live = mf.LiveTranscriber(cfg, lambda text: None)
for i in range(0, len(pcm), 3200):  # 100 ms of 16 kHz audio, as the microphone sends it
    live.feed(pcm[i:i + 3200])
    time.sleep(0.1)
text = live.finish(timeout=15)
check("live transcribe", "report" in text.lower(), text[:80])

text = mf.transcribe(cfg, open(WAV, "rb").read())
check("batch transcribe", "report" in text.lower(), text[:80])
check("AI clean-up", mf.rewrite(cfg, text))

time.sleep(2)
after, _ = mf.code_balance(CODE)
used = before - after
check("charged two clips + 5 s", 20 < used < 26, f"{used:.1f} s, {mf.minutes_text(after)} left")

_, problem = mf.code_balance("MF-AAAA-BBBB")
check("wrong code message", problem == "Code မှားနေပါတယ် - Settings မှာစစ်ပါ", problem)

print("ALL PASS" if ok else "SOME FAILED")
sys.exit(0 if ok else 1)
