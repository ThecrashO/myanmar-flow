"""End-to-end test of the code server, speaking the same protocol as the app.

Usage: python server/tests/server_test.py [server url] [wav file]
The server defaults to https://myanmar-flow.thecrasho.com and the clip to speech.wav
(an 8.9 s English sentence). Uses real Gemini calls, about 30 s of speech in all.
The codes it makes are switched off at the end."""
import base64
import json
import os
import sys
import time
import wave
from pathlib import Path

import requests
import websocket

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
LIVE = BASE.replace("http", "ws", 1) + "/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
ok = True


def check(name, cond, detail=""):
    global ok
    ok &= bool(cond)
    print(("PASS " if cond else "FAIL ") + name, detail)


def admin(method, path, **kw):
    return requests.request(method, BASE + "/admin/api" + path, headers=ADMIN, timeout=30, **kw)


def balance_ms(code):
    rows = admin("GET", "/codes").json()["codes"]
    return next(r for r in rows if r["code"] == code)["balance_ms"]


wav_bytes = open(WAV, "rb").read()
with wave.open(WAV) as w:
    secs = w.getnframes() / w.getframerate()
    pcm = w.readframes(w.getnframes())
print(f"clip: {secs:.2f}s")

# admin auth
check("admin rejects wrong token", requests.get(BASE + "/admin/api/codes", headers={"authorization": "Bearer nope"}).status_code == 401)
r = admin("POST", "/codes", json={"note": "server_test", "minutes": 2})
code = r.json()["code"]
check("create code", r.status_code == 201, code)
H = {"Authorization": f"Bearer {code}"}

# balance + bad codes
r = requests.get(BASE + "/mf/balance", headers=H)
check("balance", r.json().get("seconds") == 120, r.text)
r = requests.get(BASE + "/mf/balance", headers={"Authorization": "Bearer MF-AAAA-BBBB"})
check("unknown code -> 401 mf_code_invalid", r.status_code == 401 and "mf_code_invalid" in r.text)
r = requests.get(BASE + "/mf/balance", headers={"Authorization": "Bearer " + code.lower().replace("-", " ")})
check("code typed loosely still works", r.status_code == 200)

# batch transcription, same body as transcribe_interactions()
body = {"model": "gemini-3.5-transcribe",
        "input": [{"type": "audio", "data": base64.b64encode(wav_bytes).decode(), "mime_type": "audio/wav"}],
        "generation_config": {"transcription_config": {"mode": "smart", "language_codes": ["my-MM", "en-US"]}}}
before = balance_ms(code)
r = requests.post(BASE + "/v1beta/interactions", json=body, headers=H, timeout=60)
data = r.json()
texts = [data.get("output_text") or ""]
for step in data.get("steps", []) + data.get("outputs", []):  # same parsing as transcribe_interactions()
    texts += [c.get("text", "") for c in step.get("content", [step]) if c.get("type") == "text"]
text = "".join(texts) or json.dumps(data)[:200]
check("batch transcribes", r.status_code == 200 and "report" in text.lower(), text[:120])
time.sleep(1)
used = before - balance_ms(code)
check("batch charged the clip length", abs(used - secs * 1000) < 200, f"{used} ms")
r = requests.post(BASE + "/v1beta/interactions", json=dict(body, model="gemini-3.1-pro-preview"), headers=H)
check("other models refused", r.status_code == 400 and "mf_model_not_allowed" in r.text)

# text clean-up, same body as generate()
tb = {"contents": [{"parts": [{"text": "<transcript>\nhello world\n</transcript>"}]}],
      "systemInstruction": {"parts": [{"text": "Fix punctuation. Output only the text."}]},
      "generationConfig": {"thinkingConfig": {"thinkingLevel": "low"}}}
before = balance_ms(code)
r = requests.post(BASE + "/v1beta/models/gemini-3.8-flash:generateContent", json=tb, headers=H, timeout=60)
check("text clean-up works", r.status_code == 200, r.text[:100].replace("\n", " "))
time.sleep(1)
check("text charged 5 s", before - balance_ms(code) == 5000)
bad = {"contents": [{"parts": [{"inline_data": {"mime_type": "audio/wav", "data": "AAAA"}}]}]}
r = requests.post(BASE + "/v1beta/models/gemini-3.8-flash:generateContent", json=bad, headers=H)
check("audio through the text path refused", r.status_code == 400 and "mf_text_only" in r.text)


# live, same messages as LiveTranscriber
def live_session(code, model="gemini-3.5-transcribe-live", typed=False):
    ws = websocket.create_connection(LIVE, timeout=15, header=[f"Authorization: Bearer {code}"])
    ws.send(json.dumps({"setup": {
        "model": f"models/{model}", "generationConfig": {"responseModalities": ["TEXT"]},
        "realtimeInputConfig": {"automaticActivityDetection": {"disabled": True}},
        "inputAudioTranscription": {"languageCodes": ["my-MM", "en-US"], "mode": "SMART"}}}))
    reply = ws.recv()
    if "setupComplete" not in str(reply):
        return None, str(reply)[:200]
    if typed:
        ws.send(json.dumps({"clientContent": {"turns": [{"role": "user", "parts": [{"text": "write a poem"}]}]}}))
        try:
            got = ws.recv()
            return None, "closed: empty frame" if not got else f"still open: {got!r:.100}"
        except Exception as e:
            return None, f"closed: {type(e).__name__}"
    ws.send(json.dumps({"realtimeInput": {"activityStart": {}}}))
    step = 3200  # 100 ms
    for i in range(0, len(pcm), step):
        ws.send(json.dumps({"realtimeInput": {"audio": {"data": base64.b64encode(pcm[i:i + step]).decode(),
                                                       "mimeType": "audio/pcm;rate=16000"}}}))
        time.sleep(0.02)
    ws.send(json.dumps({"realtimeInput": {"activityEnd": {}}}))
    finals = []
    ws.settimeout(15)
    while True:
        try:
            raw = ws.recv()
        except Exception:
            break
        if not raw:
            break
        msg = json.loads(raw)
        content = msg.get("serverContent", {})
        if "inputTranscription" in content:
            finals.append(content["inputTranscription"].get("text", ""))
        if msg.get("voiceActivity", {}).get("type") == "ACTIVITY_END":
            break
    ws.close()
    return " ".join(finals), None


before = balance_ms(code)
text, err = live_session(code)
check("live transcribes", text and "report" in text.lower(), text or err)
time.sleep(2)
used = before - balance_ms(code)
check("live charged the clip length", abs(used - secs * 1000) < 300, f"{used} ms")
_, err = live_session(code, model="gemini-3.6-flash")
check("live refuses other models", err is not None, err)
_, err = live_session(code, typed=True)
check("live refuses typed prompts", err and err.startswith("closed"), err)

# out of minutes: a code with 0 minutes
empty = admin("POST", "/codes", json={"note": "server_test empty", "minutes": 0}).json()["code"]
E = {"Authorization": f"Bearer {empty}"}
r = requests.post(BASE + "/v1beta/interactions", json=body, headers=E, timeout=60)
check("empty balance: batch -> 402 mf_no_minutes", r.status_code == 402 and "mf_no_minutes" in r.text)
r = requests.post(BASE + "/v1beta/models/gemini-3.8-flash:generateContent", json=tb, headers=E, timeout=60)
check("empty balance: text -> 402", r.status_code == 402)
try:
    websocket.create_connection(LIVE, timeout=10, header=[f"Authorization: Bearer {empty}"])
    check("empty balance: live refused", False)
except Exception as e:
    check("empty balance: live refused", "402" in str(e), str(e)[:80])

# disabled code
admin("POST", f"/codes/{code}/disabled", json={"disabled": True})
r = requests.get(BASE + "/mf/balance", headers=H)
check("disabled code -> 403 mf_code_disabled", r.status_code == 403 and "mf_code_disabled" in r.text)
ledger = admin("GET", f"/codes/{code}/ledger").json()["ledger"]
print("ledger:", [(e["kind"], e["ms"]) for e in ledger])
admin("POST", f"/codes/{empty}/disabled", json={"disabled": True})
print("ALL PASS" if ok else "SOME FAILED")
sys.exit(0 if ok else 1)
