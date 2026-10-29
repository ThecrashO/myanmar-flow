# Myanmar Flow 🎙️

**မြန်မာလို ပြောလိုက်တာကို ဘယ် app မှာမဆို စာအဖြစ် ချက်ချင်း ရိုက်ပေးတဲ့ Windows tool။**

Key တစ်ခုကို ဖိထား → မြန်မာလို ပြော → လွှတ်လိုက် → စာဝင်လာပြီ။
Facebook, Messenger, Word, Gmail, Notepad... cursor ရှိတဲ့နေရာတိုင်းမှာ သုံးလို့ရပါတယ်။

*Voice dictation for Burmese on Windows — hold a key, speak, release, and the text is typed wherever your cursor is. Powered by Google Gemini. [English below](#english).*

---

## ⬇️ ဒေါင်းလုဒ်

**[👉 Releases စာမျက်နှာမှ နောက်ဆုံး version ကို ဒေါင်းပါ](https://github.com/ThecrashO/myanmar-flow/releases/latest)**

| ဖိုင် | ဘယ်သူ့အတွက်လဲ |
|---|---|
| `MyanmarFlow-Setup.exe` | **အများစုအတွက် ဒါကိုယူပါ။** Install လုပ်ပြီး Start menu မှာ ပေါ်လာမယ် |
| `MyanmarFlow.exe` | Install မလုပ်ချင်သူ — double-click နှိပ်ရုံပဲ |

Windows 10 / 11 လိုပါတယ်။ Python စတာတွေ ထည့်စရာမလိုပါ။

## 🚀 စတင်အသုံးပြုနည်း (၃ မိနစ်)

1. **`MyanmarFlow-Setup.exe` ကိုဖွင့်ပါ။**
   အပြာရောင် **"Windows protected your PC"** box ပေါ်လာရင် → **More info** → **Run anyway** ကိုနှိပ်ပါ။
   (App က အခမဲ့ open-source ဖြစ်လို့ Microsoft certificate မဝယ်ထားတာကြောင့်ပါ။ Code အားလုံးကို ဒီမှာ ကြည့်လို့ရပါတယ်။)
2. **Setup wizard က မြန်မာလို လမ်းပြပေးပါမယ်:**
   - "API key ယူရန်" ကိုနှိပ် → Google account နဲ့ဝင် → **Create API key** → Copy ကူး → Paste လုပ် → **စစ်ဆေးမယ်**
   - Mic စမ်းကြည့်ပါ
3. **ပြီးပါပြီ!** စာရိုက်ချင်တဲ့နေရာကို နှိပ်ပြီး **ညာဘက် `Ctrl`** ကို ဖိထားပြီး ပြောပါ။ လွှတ်လိုက်ရင် စာဝင်လာပါမယ်။

> 💡 API key က အခမဲ့ free tier နဲ့ ရပါတယ်။ ကိုယ့် key ကို ဘယ်သူ့ကိုမှ မပေးပါနဲ့။ Key က သင့်ကွန်ပျူတာထဲမှာပဲ သိမ်းထားပြီး Google ကိုပဲ ပို့ပါတယ်။

## ⌨️ သုံးနည်းများ

| လုပ်ချင်တာ | နှိပ်ရမှာ |
|---|---|
| မြန်မာလို ရိုက်မယ် | **ညာဘက် `Ctrl`** ဖိထား → ပြော → လွှတ် |
| မြန်မာလိုပြောပြီး **English** လို ရိုက်မယ် | **ညာဘက် `Alt`** ဖိထား → မြန်မာလို ပြော → လွှတ် |
| စာရှည်ရှည် လက်မလိုဘဲ ပြောမယ် | Key ကို **၂ ချက်ဆက်နှိပ်** → ပြော → **တစ်ချက်နှိပ်** ပြီးရင် |

- **AI စာပြင်:** ပြောပြီးတာကို AI က ထပ်စစ်ပြီး အကြားမှားတဲ့စာလုံး၊ စာလုံးပေါင်း၊ ပုဒ်ဖြတ်တွေ ပြင်ပေးပါတယ်။ ၁-၃ စက္ကန့် ပိုကြာပါတယ်။ Settings မှာ ပိတ်လို့ရပါတယ်။
- တစ်ခါပြောရင် အများဆုံး ၅ မိနစ်ပါ။
- Version အသစ်ထွက်ရင် notification နဲ့ အသိပေးပါမယ်။

## 🟢 Tray icon

နာရီဘေး (မမြင်ရရင် `^` ကိုနှိပ်) မှာ icon လေး ရှိပါတယ်:

| အရောင် | အဓိပ္ပာယ် |
|---|---|
| 🟢 အစိမ်း | ဖွင့်ထားတယ် — သုံးလို့ရပြီ |
| ⚪ မီးခိုး | ပိတ်ထားတယ် |
| 🔴 အနီ | နားထောင်နေတယ် (screen အောက်က pill မှာ 🔴 = မြန်မာ၊ 🔵 EN = English၊ ■ = လက်မလို mode — တစ်ချက်နှိပ်ရင် ရပ်) |
| 🟠 လိမ္မော် | စာပြောင်းနေတယ် |

- **Icon ကို တစ်ချက်နှိပ်** → ဖွင့်/ပိတ်
- **Right-click** → Settings (hotkey ပြောင်းရန်၊ model၊ စကားလုံးအထူးများ), Setup wizard, အကူအညီ, ပြဿနာတင်ပြရန်

## 🛠️ ပြဿနာဖြေရှင်းနည်း

Error တက်ရင် screen အောက်နားမှာ မြန်မာလို ပြပါတယ်:

| ပြတဲ့စာ | ဘာလုပ်ရမလဲ |
|---|---|
| **အင်တာနက် ချိတ်မရပါ** | Internet ချိတ်ထားလား စစ်ပါ |
| **ဒီနေရာကနေ Gemini သုံးခွင့်မရှိပါ** | Google က သင့်နိုင်ငံ/ဒေသမှာ Gemini API ကို ခွင့်မပြုသေးပါ ([စာရင်း](https://ai.google.dev/gemini-api/docs/available-regions))။ ⚠️ **မြန်မာနိုင်ငံ ဒီစာရင်းထဲ မပါသေးပါ** |
| **API key မှားနေပါတယ်** | Right-click → Setup wizard နဲ့ key ပြန်ထည့်ပါ |
| **သုံးနိုင်တဲ့ အကြိမ်ရေ ပြည့်သွားပြီ** | Google က သင့် API key အတွက် သတ်မှတ်ထားတဲ့ limit ပြည့်တာပါ (app က ကန့်သတ်ထားတာ မဟုတ်ပါ)။ ခဏစောင့်ပြီး ပြန်စမ်းပါ။ မကြာခဏဖြစ်ရင် Settings မှာ "AI နဲ့ စာပြင်ပေးမယ်" ကိုပိတ်ပါ (တစ်ခါပြောတိုင်း API ၂ ကြိမ်ကနေ ၁ ကြိမ် ဖြစ်သွားမယ်) ဒါမှမဟုတ် [AI Studio](https://aistudio.google.com) မှာ billing ဖွင့်ပါ |
| **ဘာသာပြန်လို့မရလို့ မြန်မာလိုပဲ ထည့်ထားပါတယ်** | English ဘာသာပြန်တာ မအောင်မြင်လို့ မြန်မာလို ထည့်ပေးထားတာပါ။ ပြန်စမ်းပါ |
| **Model နာမည် မှားနေပါတယ်** | Settings → Model ကို `gemini-3.5-transcribe` ပြန်ထားပါ |
| ဘာမှ မဖြစ်ဘူး | Icon အစိမ်းရောင်လား စစ်ပါ။ Admin app တွေထဲမှာ မရရင် Myanmar Flow ကို "Run as administrator" နဲ့ဖွင့်ပါ |
| Mic မရဘူး | Windows Settings → Privacy & security → Microphone → Desktop apps ကို ဖွင့်ပါ |

**မရသေးရင်:** Right-click → **ပြဿနာတင်ပြရန်** နှိပ်ပြီး [Issue](https://github.com/ThecrashO/myanmar-flow/issues/new) ဖွင့်ပါ။ Right-click → **Log ဖိုင်ဖွင့်ရန်** ထဲက error စာကြောင်းကို ထည့်ပေးပါ (API key မပါအောင် သတိထားပါ)။

## 🔒 Privacy

- ပြောတဲ့အသံကို Hotkey ဖိထားချိန်မှာပဲ ဖမ်းပြီး **သင့်ကိုယ်ပိုင် API key နဲ့ Google Gemini ဆီကိုပဲ** ပို့ပါတယ်။ တခြား server မရှိပါ။
- Settings နဲ့ key ကို `%APPDATA%\MyanmarFlow\config.json` မှာ သိမ်းပါတယ်။ Uninstall လုပ်ရင် ဖျက်ပေးပါတယ်။

---

## English

**Myanmar Flow** is a small Windows tray app for Burmese voice dictation, similar in spirit to Wispr Flow (which doesn't support Burmese).

- Hold **Right Ctrl**, speak, release — the transcript is pasted into the focused app.
- Hold **Right Alt** to speak Burmese and get English text. Double-tap either key for hands-free dictation (tap again to stop, 5-minute cap).
- Optional AI polish pass (`gemini-3.6-flash`) fixes misheard words, spelling and punctuation; falls back to the raw transcript if it fails.
- Transcripts are never written to the log. Checks GitHub for new releases once a day (can be turned off).
- Uses Google's [`gemini-3.5-transcribe`](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe) speech-to-text model with the `my-MM` language hint and "smart" formatting. General Gemini models (e.g. `gemini-3.6-flash`) also work via a prompt.
- Bring your own free [Gemini API key](https://aistudio.google.com/apikey); a Burmese setup wizard walks you through it.
- ⚠️ The Gemini API is only available in [these regions](https://ai.google.dev/gemini-api/docs/available-regions) — Myanmar is currently not one of them.

### Build from source

```bash
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\pythonw myanmar_flow.py
```

`build.bat` builds `dist\MyanmarFlow.exe` with PyInstaller. `installer.iss` builds the installer with [Inno Setup](https://jrsoftware.org/isinfo.php). Pushing a `v*` tag builds both on GitHub Actions and publishes a release.

License: [MIT](LICENSE)
