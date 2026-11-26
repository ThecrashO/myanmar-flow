# Myanmar Flow

![Myanmar Flow: voice typing for laptops](docs/images/cover.jpg)

**မြန်မာလို ပြောလိုက်ရုံနဲ့ ဘယ် app မှာမဆို စာဝင်တဲ့ Windows နဲ့ Mac program**
*Burmese voice typing for Windows and macOS · [English](#english)*

![Myanmar Flow pill](docs/images/pill-states.png)

<p align="center">
  <a href="https://github.com/ThecrashO/myanmar-flow/releases/latest"><b>⬇️ Download (Windows · Mac · အခမဲ့)</b></a>
  &nbsp;·&nbsp;
  <a href="docs/GUIDE.md"><b>📘 အသုံးပြုနည်း လမ်းညွှန်</b></a>
</p>

---

## စသုံးနည်း

1. **Install** — `MyanmarFlow-Setup.exe` ကို ဖွင့်ပါ။ အပြာရောင် box ပေါ်ရင် **More info → Run anyway** ([ဘာလို့လဲ?](docs/GUIDE.md#s3))
2. **API key ထည့်** — Wizard က မြန်မာလို လမ်းပြပေးပါမယ်။ Google account နဲ့ အခမဲ့ ယူရပါတယ် ([အသေးစိတ်](docs/GUIDE.md#s4))။ Key မယူချင်ရင် **Myanmar Flow Code** နဲ့လည်း သုံးလို့ရ ([အသေးစိတ်](docs/GUIDE.md#code))
3. **ပြော** — စာရိုက်မယ့်နေရာ နှိပ် → **ညာဘက် `Ctrl`** ဖိထား → ပြော → လွှတ်

| လုပ်ချင်တာ | လုပ်ရမှာ |
|---|---|
| မြန်မာလို ရိုက်မယ် | **ညာ `Ctrl`** ဖိ → ပြော → လွှတ် |
| မြန်မာလိုပြော၊ English ထွက် | **ညာ `Alt`** ဖိ → ပြော → လွှတ် |
| စာရှည် လက်မလိုဘဲ | Key **၂ ချက်** နှိပ် → ပြော → **၁ ချက်** နှိပ်ရင် ရပ် |
| Settings / အကူအညီ | နာရီဘေးက icon ကို **Right-click** |

> 🍎 **Mac** — `MyanmarFlow-mac.zip` ကို download လုပ်ပါ (Intel Mac ဆိုရင် `MyanmarFlow-mac-intel.zip`)။ ပထမဆုံးဖွင့်တဲ့အခါ "Apple could not verify…" ပေါ်ရင် **Move to Trash** မနှိပ်ဘဲ **Done** နှိပ် → **System Settings → Privacy & Security → Open Anyway**။ Key က **ညာ `Option`** (English က **ညာ `Command`**)။ [Mac လမ်းညွှန် →](docs/GUIDE.md#mac)

> 🛡️ **သတိပေးစာ ပေါ်လာရင် စိတ်မပူပါနဲ့ — သတိပေးချက်ပဲဖြစ်ပြီး ဘာမှ မဖြစ်စေပါဘူး။** Windows ရဲ့ အပြာရောင် box နဲ့ Mac ရဲ့ "Apple could not verify…" က Apple နဲ့ Microsoft ကို ပိုက်ဆံပေးပြီး လက်မှတ်မထိုးထားတဲ့ app တိုင်းမှာ ပေါ်တာပါ။ App ထဲမှာ virus တွေ့လို့ ပြတာ မဟုတ်ပါဘူး။ Code အားလုံး ဒီ repo မှာ ကြည့်လို့ရပြီး app တွေကိုလည်း ဒီ code ကနေ GitHub ပေါ်မှာ တိုက်ရိုက် build လုပ်ထားတာပါ ([release workflow](.github/workflows/release.yml))။ တစ်ခါပဲ ခွင့်ပြုရပါတယ်။

## ဘာတွေ လုပ်ပေးလဲ

- **ပြောနေတုန်း စာပေါ်** — key လွှတ်တာနဲ့ စာ ချက်ချင်းဝင်
- **AI စာပြင်** (Settings မှာ ဖွင့်ရန်) — အကြားမှားတဲ့ စာလုံး၊ စာလုံးပေါင်း၊ ၊ ။ တွေကို အလိုလို ပြင်
- **English ဘာသာပြန်** — မြန်မာလို ပြောပြီး English စာ ထွက်
- **Shortcut** — "ငါ့လိပ်စာ" လို့ ပြောရင် လိပ်စာအပြည့် ဝင်
- **Dashboard** — အချိန် ဘယ်လောက် သက်သာလဲ၊ ခုနက ပြောခဲ့တဲ့စာ ပြန်ယူ
- **Privacy** — ကိုယ်ပိုင် API key နဲ့ Google ဆီပဲ ပို့၊ ပြောတဲ့စာ ဘယ်မှာမှ မသိမ်း (Code သုံးရင် Myanmar Flow server ကနေ ဖြတ်သွားပေမယ့် မိနစ်ပဲ မှတ်ပြီး စာကို မသိမ်းပါ)

## သိထားရန်

- **Internet** လိုပါတယ်။ Free API key မှာ **တစ်ရက် limit** ရှိပါတယ် ([အသေးစိတ်](docs/GUIDE.md#s12))။
- Google က **မြန်မာနိုင်ငံထဲမှာ Gemini API ကို ခွင့်မပြုသေးပါ** ([စာရင်း](https://ai.google.dev/gemini-api/docs/available-regions))။ မြန်မာပြည်ထဲကနေ **ကိုယ်ပိုင် key** နဲ့ သုံးရင် **VPN ဖွင့်ထားရပါမယ်** (key ယူတုန်းရော သုံးနေတုန်းပါ)။ **Code** နဲ့ သုံးရင်တော့ VPN မလိုပါ ([အသေးစိတ်](docs/GUIDE.md#code))။

**အကူအညီ:** [ပြဿနာဖြေရှင်းနည်း](docs/GUIDE.md#s14) · [FAQ](docs/GUIDE.md#s15) · [ပြဿနာ / အကြံ တင်ရန်](https://github.com/ThecrashO/myanmar-flow/issues/new/choose) (မြန်မာလို ရေးလို့ရ)

---

<a name="english"></a>

## English

**Myanmar Flow** is a small tray / menu-bar app for Burmese voice typing on Windows and macOS (Apple Silicon and Intel). Hold **Right Ctrl** (Mac: **Right Option**), speak, release, and the text is pasted into whatever app has focus. Hold **Right Alt** (Mac: **Right Command**) to speak Burmese and get English. Double-tap either key for hands-free dictation. On a Mac, allow Microphone and Accessibility when asked.

**First launch shows a warning. It's only a warning and does no harm.** The app isn't paid-signed by Microsoft or notarized by Apple, so Windows shows a blue SmartScreen box and macOS says "Apple could not verify…". Nothing was found in the app; every unsigned app gets this. All the code is in this repo, and the installers are built from it on GitHub Actions ([release workflow](.github/workflows/release.yml)). Windows: **More info → Run anyway**. Mac: **Done**, then **System Settings → Privacy & Security → Open Anyway**. You only do this once.

It uses your own free [Gemini API key](https://aistudio.google.com/apikey). The Gemini API is [not available in Myanmar](https://ai.google.dev/gemini-api/docs/available-regions) yet, so inside Myanmar an own key needs a VPN. A Myanmar Flow Code works without one.

<details>
<summary><b>How it works and building from source</b></summary>

- Streams audio to `gemini-3.5-transcribe-live` and shows the words while you speak; falls back to batch `gemini-3.5-transcribe` (`my-MM`, `en-US`) if streaming fails.
- Optional clean-up pass (off by default, to save the free quota) with `gemini-3.8-flash` fixes only words that are certainly misheard (it leaves correct text alone), then fixes common Burmese look-alikes (၀/ဝ, ၇/ရ, ဥ/ဉ) and mark order.
- Voice shortcuts, personal word fixes, and a dashboard of time saved. Transcripts are never logged; history stays in memory.

```bash
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\pythonw myanmar_flow.py
```

Platform code lives in `platform_win.py` and `platform_mac.py`. `build.bat` builds `dist\MyanmarFlow.exe` with PyInstaller, and `installer.iss` builds the installer with [Inno Setup](https://jrsoftware.org/isinfo.php). Pushing a `v*` tag builds the Windows installer and the two Mac zips (Apple Silicon and Intel) on GitHub Actions and publishes a release.

</details>

License: [MIT](LICENSE) · Full guide (Burmese): [docs/GUIDE.md](docs/GUIDE.md)
