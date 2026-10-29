"""Myanmar Flow - hold a hotkey, speak Burmese, release, and the text is pasted
into whatever app has focus. Runs in the system tray; uses Google Gemini for
transcription."""

import base64
import contextlib
import ctypes
import io
import json
import logging
import math
import os
import queue
import sys
import threading
import time
import tkinter as tk
import wave
import webbrowser
import winreg
import winsound
from collections import deque
from ctypes import wintypes
from pathlib import Path
from tkinter import ttk

import keyboard
import numpy as np
import pyperclip
import pystray
import requests
import sounddevice as sd
from PIL import Image, ImageDraw, ImageFilter, ImageFont, features

APP_NAME = "Myanmar Flow"
APP_VERSION = "1.0.1"
REPO_URL = "https://github.com/ThecrashO/myanmar-flow"
DATA_DIR = Path(os.environ.get("APPDATA", Path.home())) / "MyanmarFlow"
DATA_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_PATH = DATA_DIR / "config.json"
LOG_PATH = DATA_DIR / "myanmar_flow.log"
SAMPLE_RATE = 16000
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"

logging.basicConfig(filename=LOG_PATH, level=logging.INFO, encoding="utf-8",
                    format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(APP_NAME)

DEFAULT_CONFIG = {
    "api_key": "",
    "model": "gemini-3.5-transcribe",
    # Used only by *-transcribe models (Interactions API).
    "language_codes": ["my-MM"],
    "transcribe_mode": "smart",
    "custom_vocabulary": [],
    "hotkey": "right ctrl",
    "min_seconds": 0.4,
    "sounds": True,
    # Used only by general models (generateContent), e.g. gemini-3.6-flash.
    "prompt": (
        "Transcribe this audio. The speaker mainly speaks Burmese (Myanmar), "
        "possibly mixed with some English words. Write Burmese in standard "
        "Myanmar Unicode script (not Zawgyi) and keep English words in English. "
        "Remove filler sounds (e.g. အာ, အင်း, um) and false starts. Add natural "
        "punctuation using ၊ and ။ for Burmese. Output ONLY the transcribed "
        "text, with no explanations, quotes, or translations. If there is no "
        "speech, output nothing."
    ),
}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    else:
        save_config(cfg)
    cfg["api_key"] = cfg["api_key"] or os.environ.get("GEMINI_API_KEY", "")
    return cfg


def save_config(cfg):
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------- audio / API

class Recorder:
    def __init__(self):
        self.frames = []
        self.stream = None
        self.lock = threading.Lock()
        self.level = 0.0  # 0..1 loudness of the latest chunk, for the waveform

    def start(self):
        with self.lock:
            self.frames = []
            self.level = 0.0
            self.stream = sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", callback=self._callback)
            self.stream.start()

    def _callback(self, indata, frames, time_info, status):
        self.frames.append(indata.copy())
        rms = float(np.sqrt(np.mean(indata.astype(np.float32) ** 2))) / 32768
        self.level = min(1.0, max(0.0, (20 * math.log10(rms + 1e-6) + 52) / 40))

    def stop(self):
        with self.lock:
            if self.stream is None:
                return None
            self.stream.stop()
            self.stream.close()
            self.stream = None
            if not self.frames:
                return None
            return np.concatenate(self.frames)


def to_wav_bytes(audio):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio.tobytes())
    return buf.getvalue()


def transcribe(cfg, wav_bytes):
    if "transcribe" in cfg["model"]:
        return transcribe_interactions(cfg, wav_bytes)
    return transcribe_generate(cfg, wav_bytes)


def transcribe_interactions(cfg, wav_bytes):
    """Dedicated speech-to-text models (e.g. gemini-3.5-transcribe) via the Interactions API."""
    transcription_config = {"mode": cfg["transcribe_mode"]}
    if cfg["language_codes"]:
        transcription_config["language_codes"] = cfg["language_codes"]
    if cfg["custom_vocabulary"]:
        transcription_config["custom_vocabulary"] = cfg["custom_vocabulary"]
    body = {
        "model": cfg["model"],
        "input": [{"type": "audio", "data": base64.b64encode(wav_bytes).decode(), "mime_type": "audio/wav"}],
        "generation_config": {"transcription_config": transcription_config},
    }
    resp = requests.post(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        json=body, headers={"x-goog-api-key": cfg["api_key"]}, timeout=60,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini API error {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    if data.get("output_text"):
        return data["output_text"].strip()
    texts = []
    for step in data.get("steps", []) + data.get("outputs", []):
        items = step.get("content", [step])
        texts += [c.get("text", "") for c in items if c.get("type") == "text"]
    return "".join(texts).strip()


def transcribe_generate(cfg, wav_bytes):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{cfg['model']}:generateContent"
    body = {
        "contents": [{
            "parts": [
                {"text": cfg["prompt"]},
                {"inline_data": {"mime_type": "audio/wav", "data": base64.b64encode(wav_bytes).decode()}},
            ]
        }],
        "generationConfig": {"temperature": 0},
    }
    resp = requests.post(url, json=body, headers={"x-goog-api-key": cfg["api_key"]}, timeout=60)
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini API error {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts).strip()


def friendly_error(err):
    """Short Burmese explanation for the floating indicator; details go to the log."""
    msg = str(err).lower()
    if isinstance(err, requests.ConnectionError):
        return "အင်တာနက် ချိတ်မရပါ"
    if isinstance(err, requests.Timeout):
        return "အင်တာနက် နှေးလွန်းပါတယ် - ထပ်စမ်းပါ"
    if "location is not supported" in msg:
        return "ဒီနေရာကနေ Gemini သုံးခွင့်မရှိပါ"
    if "api_key_invalid" in msg or "api key not valid" in msg or "error 401" in msg or "error 403" in msg:
        return "API key မှားနေပါတယ် - Settings မှာစစ်ပါ"
    if "error 429" in msg:
        return "သုံးနိုင်တဲ့ အကြိမ်ရေ ပြည့်သွားပြီ - ခဏစောင့်ပါ"
    if "error 404" in msg:
        return "Model နာမည် မှားနေပါတယ် - Settings မှာစစ်ပါ"
    return "Error - Log ကိုကြည့်ပါ"


def check_api_key(api_key):
    """Returns None if the key works from here, else a Burmese explanation."""
    try:
        resp = requests.get("https://generativelanguage.googleapis.com/v1beta/models",
                            headers={"x-goog-api-key": api_key}, timeout=20)
    except requests.RequestException as e:
        return friendly_error(e)
    if resp.status_code == 200:
        return None
    log.warning("Key check failed %s: %s", resp.status_code, resp.text[:300])
    return friendly_error(RuntimeError(f"Gemini API error {resp.status_code}: {resp.text[:300]}"))


def paste_text(text):
    """Paste via the clipboard (reliable for Myanmar script), then restore the old clipboard."""
    try:
        previous = pyperclip.paste()
    except Exception:
        previous = None
    pyperclip.copy(text)
    time.sleep(0.05)
    keyboard.send("ctrl+v")
    time.sleep(0.3)
    if previous is not None:
        pyperclip.copy(previous)


# ---------------------------------------------------------------- start with Windows

def launch_command():
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}"'
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    return f'"{pythonw}" "{Path(__file__).resolve()}"'


def autostart_enabled():
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            winreg.QueryValueEx(key, APP_NAME)
            return True
    except OSError:
        return False


def set_autostart(enabled):
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, launch_command())
        else:
            try:
                winreg.DeleteValue(key, APP_NAME)
            except OSError:
                pass


# ---------------------------------------------------------------- icons

STATE_COLORS = {
    "idle": "#22a06b",         # on, waiting
    "off": "#8a8f98",          # disabled
    "recording": "#e5484d",
    "transcribing": "#f5a524",
}


def make_icon(color, size=64):
    """A round badge with a microphone glyph."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((2, 2, size - 2, size - 2), fill=color)
    s = size / 64
    w = (255, 255, 255, 255)
    d.rounded_rectangle((25 * s, 12 * s, 39 * s, 38 * s), radius=7 * s, fill=w)
    d.arc((18 * s, 22 * s, 46 * s, 46 * s), 0, 180, fill=w, width=max(2, int(3 * s)))
    d.line((32 * s, 46 * s, 32 * s, 52 * s), fill=w, width=max(2, int(3 * s)))
    d.line((24 * s, 52 * s, 40 * s, 52 * s), fill=w, width=max(2, int(3 * s)))
    return img


# ---------------------------------------------------------------- floating indicator

WS_POPUP = 0x80000000
WS_EX_LAYERED = 0x00080000
WS_EX_TRANSPARENT = 0x00000020
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_NOACTIVATE = 0x08000000
WS_EX_TOPMOST = 0x00000008

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
user32.CreateWindowExW.restype = wintypes.HWND
user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
                                   ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                   wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID]
user32.GetDC.restype = wintypes.HDC
user32.GetDC.argtypes = [wintypes.HWND]
user32.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
user32.GetForegroundWindow.restype = wintypes.HWND
user32.MonitorFromWindow.restype = wintypes.HMONITOR
user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                                ctypes.c_int, ctypes.c_int, wintypes.UINT]
user32.UpdateLayeredWindow.argtypes = [wintypes.HWND, wintypes.HDC, ctypes.c_void_p, ctypes.c_void_p,
                                       wintypes.HDC, ctypes.c_void_p, wintypes.COLORREF, ctypes.c_void_p,
                                       wintypes.DWORD]
gdi32.CreateCompatibleDC.restype = wintypes.HDC
gdi32.CreateCompatibleDC.argtypes = [wintypes.HDC]
gdi32.CreateDIBSection.restype = wintypes.HBITMAP
gdi32.CreateDIBSection.argtypes = [wintypes.HDC, ctypes.c_void_p, wintypes.UINT,
                                   ctypes.POINTER(ctypes.c_void_p), wintypes.HANDLE, wintypes.DWORD]
gdi32.SelectObject.restype = wintypes.HGDIOBJ
gdi32.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
gdi32.DeleteObject.argtypes = [wintypes.HGDIOBJ]
gdi32.DeleteDC.argtypes = [wintypes.HDC]
try:
    user32.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
    user32.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
except AttributeError:  # Windows older than 10 1607
    pass


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
                ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
                ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD)]


class BLENDFUNCTION(ctypes.Structure):
    _fields_ = [("BlendOp", ctypes.c_ubyte), ("BlendFlags", ctypes.c_ubyte),
                ("SourceConstantAlpha", ctypes.c_ubyte), ("AlphaFormat", ctypes.c_ubyte)]


class MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT),
                ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]


@contextlib.contextmanager
def dpi_aware():
    """Talk to Win32 in real pixels so the overlay is crisp on scaled displays."""
    old = None
    try:
        old = user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))  # per-monitor v2
    except AttributeError:
        pass
    try:
        yield
    finally:
        if old:
            user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(old))


FONTS_DIR = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
HAS_RAQM = features.check("raqm")  # complex-script shaping, needed to draw Burmese
SUPERSAMPLE = 3
BARS = 21
PILL_BG = (20, 20, 23)
PILL_BORDER = (58, 58, 64)
WHITE = (245, 245, 247)
MUTED = (150, 150, 158)
DIM = (92, 92, 100)
RED = (229, 72, 77)
ORANGE = (245, 165, 36)
GREEN = (34, 160, 107)


def mix(fg, bg, t):
    """Blend fg over bg by t (ImageDraw overwrites alpha instead of blending)."""
    return tuple(int(b + (f - b) * t) for f, b in zip(fg, bg)) + (255,)


class Indicator:
    """Wispr-style pill near the bottom of the screen: live waveform and timer
    while recording, a spinner while transcribing, a check when done.

    Drawn with Pillow (anti-aliased, soft shadow) into a per-pixel-alpha layered
    window that is click-through and never takes focus, so the paste still goes
    to the user's app."""

    H = 40        # pill height, logical px
    MARGIN = 14   # room around the pill for the shadow

    def __init__(self, root, level_fn):
        self.root = root
        self.level_fn = level_fn
        self.mode = None
        self.text = ""
        self.alpha = 0.0
        self.target = 0.0
        self.hide_at = None
        self.started = 0.0
        self.smoothed = 0.0
        self.levels = deque([0.0] * BARS, maxlen=BARS)
        self.visible = False
        self.anchor = (0, 0, 1.0)  # centre x, bottom y (physical px), scale
        self.bases = {}
        self.fonts = {}
        with dpi_aware():
            self.hwnd = user32.CreateWindowExW(
                WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST,
                "STATIC", None, WS_POPUP, 0, 0, 1, 1, None, None, None, None)
        self.root.after(30, self.tick)

    # --- state

    def set_state(self, state, text=None):
        now = time.time()
        if state in ("recording", "transcribing", "done") or text:
            if self.target == 0.0:
                self.locate()
            self.target = 1.0
            self.hide_at = None
        if state == "recording":
            self.mode, self.started = "recording", now
            self.levels.extend([0.0] * BARS)
        elif state == "transcribing":
            self.mode, self.started = "transcribing", now
        elif state == "done":
            self.mode, self.started, self.hide_at = "done", now, now + 0.7
        elif text:
            self.mode, self.text, self.hide_at = "error", text, now + 3.5
        else:
            self.target = 0.0

    def locate(self):
        """Bottom centre of the work area of the monitor the user is typing on."""
        with dpi_aware():
            mon = user32.MonitorFromWindow(user32.GetForegroundWindow(), 2)  # MONITOR_DEFAULTTONEAREST
            info = MONITORINFO()
            info.cbSize = ctypes.sizeof(MONITORINFO)
            user32.GetMonitorInfoW(mon, ctypes.byref(info))
            dpi_x, dpi_y = ctypes.c_uint(96), ctypes.c_uint(96)
            try:
                ctypes.windll.shcore.GetDpiForMonitor(mon, 0, ctypes.byref(dpi_x), ctypes.byref(dpi_y))
            except (AttributeError, OSError):
                pass
        scale = dpi_x.value / 96
        r = info.rcWork
        self.anchor = ((r.left + r.right) // 2, r.bottom - int(24 * scale), scale)

    # --- animation loop (Tk thread)

    def tick(self):
        now = time.time()
        if self.hide_at and now >= self.hide_at:
            self.target, self.hide_at = 0.0, None
        if self.mode == "recording" and self.target:
            self.smoothed = max(self.level_fn(), self.smoothed * 0.62)
            self.levels.append(self.smoothed)
        self.alpha += (self.target - self.alpha) * 0.3
        if abs(self.target - self.alpha) < 0.02:
            self.alpha = self.target
        if self.alpha <= 0.0:
            if self.visible:
                user32.ShowWindow(self.hwnd, 0)  # SW_HIDE
                self.visible = False
            self.root.after(80, self.tick)
            return
        try:
            self.present(self.compose(now, self.anchor[2]))
        except Exception:
            log.exception("indicator")
        self.root.after(25, self.tick)

    # --- drawing

    def font(self, name, size, k):
        key = (name, size, k)
        if key not in self.fonts:
            engine = ImageFont.Layout.RAQM if HAS_RAQM else ImageFont.Layout.BASIC
            try:
                self.fonts[key] = ImageFont.truetype(str(FONTS_DIR / name), max(1, int(size * k)), layout_engine=engine)
            except OSError:
                self.fonts[key] = ImageFont.load_default(max(1, int(size * k)))
        return self.fonts[key]

    def width(self, k):
        if self.mode == "error":
            text_w = self.font("mmrtext.ttf", 13, k).getlength(self.text) / k if HAS_RAQM else 0
            return int(52 + text_w + 18)
        return 204

    def base(self, w, k):
        """Shadow + pill background, cached per size."""
        key = (w, k)
        if key not in self.bases:
            if len(self.bases) > 8:
                self.bases.clear()
            m, h = self.MARGIN, self.H
            size = (int((w + 2 * m) * k), int((h + 2 * m) * k))
            img = Image.new("RGBA", size, (0, 0, 0, 0))
            ImageDraw.Draw(img).rounded_rectangle((m * k, (m + 4) * k, (m + w) * k, (m + h + 4) * k),
                                                  radius=h / 2 * k, fill=(0, 0, 0, 120))
            img = img.filter(ImageFilter.GaussianBlur(7 * k))
            d = ImageDraw.Draw(img)
            d.rounded_rectangle((m * k, m * k, (m + w) * k, (m + h) * k), radius=h / 2 * k, fill=PILL_BORDER + (255,))
            d.rounded_rectangle(((m + 1) * k, (m + 1) * k, (m + w - 1) * k, (m + h - 1) * k),
                                radius=(h / 2 - 1) * k, fill=PILL_BG + (255,))
            self.bases[key] = img
        return self.bases[key]

    def compose(self, now, scale):
        k = scale * SUPERSAMPLE
        w = self.width(k)
        img = self.base(w, k).copy()
        d = ImageDraw.Draw(img)
        ox, cy = self.MARGIN * k, (self.MARGIN + self.H / 2) * k

        def at(x):
            return ox + x * k

        def bars(heights, color):
            for i, h in enumerate(heights):
                x = 36 + i * 6
                d.rounded_rectangle((at(x), cy - h / 2 * k, at(x + 3), cy + h / 2 * k), radius=1.5 * k, fill=color)

        t = now - self.started
        if self.mode == "recording":
            pulse = 0.55 + 0.45 * (0.5 + 0.5 * math.cos(t * 5))
            d.ellipse((at(20 - 5), cy - 5 * k, at(20 + 5), cy + 5 * k), fill=mix(RED, PILL_BG, pulse))
            bars([3 + lvl * 21 for lvl in self.levels], WHITE + (255,))
            d.text((at(w - 18), cy), f"{int(t) // 60}:{int(t) % 60:02d}",
                   font=self.font("segoeui.ttf", 12, k), fill=MUTED + (255,), anchor="rm")
        elif self.mode == "transcribing":
            start = (t * 400) % 360
            d.arc((at(20 - 7), cy - 7 * k, at(20 + 7), cy + 7 * k), start, start + 260,
                  fill=ORANGE + (255,), width=max(1, int(2.2 * k)))
            bars([3 + 7 * (0.5 + 0.5 * math.sin(t * 7 - i * 0.45)) for i in range(BARS)], DIM + (255,))
        elif self.mode == "done":
            d.ellipse((at(20 - 8), cy - 8 * k, at(20 + 8), cy + 8 * k), fill=GREEN + (255,))
            d.line([(at(16), cy), (at(19), cy + 3 * k), (at(24.5), cy - 3.5 * k)],
                   fill=WHITE + (255,), width=max(1, int(2.2 * k)), joint="curve")
            fade = max(0.0, 1 - t / 0.3)
            bars([3 + 4 * fade] * BARS, mix(DIM, PILL_BG, 0.7))
        elif self.mode == "error":
            d.ellipse((at(20 - 8), cy - 8 * k, at(20 + 8), cy + 8 * k), fill=RED + (255,))
            d.text((at(20), cy), "!", font=self.font("segoeuib.ttf", 12, k), fill=WHITE + (255,), anchor="mm")
            if HAS_RAQM:
                d.text((at(38), cy), self.text, font=self.font("mmrtext.ttf", 13, k), fill=WHITE + (255,), anchor="lm")

        final = (round(img.width / SUPERSAMPLE), round(img.height / SUPERSAMPLE))
        return img.resize(final, Image.LANCZOS)

    def present(self, img):
        """Push a premultiplied BGRA bitmap to the layered window (UpdateLayeredWindow)."""
        cx, bottom, scale = self.anchor
        w, h = img.size
        x = cx - w // 2
        y = bottom - h + int((1 - self.alpha) * 10 * scale)  # slight rise while fading in
        rgba = np.asarray(img, dtype=np.uint16)
        a = rgba[..., 3]
        bgra = np.dstack([rgba[..., 2] * a // 255, rgba[..., 1] * a // 255, rgba[..., 0] * a // 255, a])
        data = np.ascontiguousarray(bgra, dtype=np.uint8).tobytes()

        header = BITMAPINFOHEADER(biSize=ctypes.sizeof(BITMAPINFOHEADER), biWidth=w, biHeight=-h,
                                  biPlanes=1, biBitCount=32, biCompression=0)
        with dpi_aware():
            screen = user32.GetDC(None)
            mem = gdi32.CreateCompatibleDC(screen)
            bits = ctypes.c_void_p()
            bmp = gdi32.CreateDIBSection(mem, ctypes.byref(header), 0, ctypes.byref(bits), None, 0)
            ctypes.memmove(bits, data, len(data))
            old = gdi32.SelectObject(mem, bmp)
            blend = BLENDFUNCTION(0, 0, int(255 * self.alpha), 1)  # AC_SRC_OVER, AC_SRC_ALPHA
            user32.UpdateLayeredWindow(self.hwnd, screen, ctypes.byref(wintypes.POINT(x, y)),
                                       ctypes.byref(wintypes.SIZE(w, h)), mem,
                                       ctypes.byref(wintypes.POINT(0, 0)), 0, ctypes.byref(blend), 2)  # ULW_ALPHA
            if not self.visible:
                user32.ShowWindow(self.hwnd, 4)  # SW_SHOWNOACTIVATE
                user32.SetWindowPos(self.hwnd, wintypes.HWND(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
                self.visible = True
            gdi32.SelectObject(mem, old)
            gdi32.DeleteObject(bmp)
            gdi32.DeleteDC(mem)
            user32.ReleaseDC(None, screen)


# ---------------------------------------------------------------- settings window

class SettingsWindow:
    def __init__(self, app):
        self.app = app
        cfg = app.cfg
        self.win = tk.Toplevel(app.root)
        self.win.title(f"{APP_NAME} - Settings")
        self.win.resizable(False, False)
        self.win.attributes("-topmost", True)
        frm = ttk.Frame(self.win, padding=16)
        frm.pack(fill="both", expand=True)

        self.vars = {
            "api_key": tk.StringVar(value=cfg["api_key"]),
            "hotkey": tk.StringVar(value=cfg["hotkey"]),
            "model": tk.StringVar(value=cfg["model"]),
            "language_codes": tk.StringVar(value=", ".join(cfg["language_codes"])),
            "transcribe_mode": tk.StringVar(value=cfg["transcribe_mode"]),
            "custom_vocabulary": tk.StringVar(value=", ".join(cfg["custom_vocabulary"])),
        }
        self.sounds = tk.BooleanVar(value=cfg["sounds"])
        self.autostart = tk.BooleanVar(value=autostart_enabled())

        rows = [
            ("Gemini API key", ttk.Entry(frm, textvariable=self.vars["api_key"], show="•", width=44)),
            ("Hotkey (ဖိထားပြီးပြောရန်)", ttk.Entry(frm, textvariable=self.vars["hotkey"], width=44)),
            ("Model", ttk.Combobox(frm, textvariable=self.vars["model"], width=42,
                                   values=["gemini-3.5-transcribe", "gemini-3.6-flash", "gemini-3.1-pro-preview"])),
            ("Language codes", ttk.Entry(frm, textvariable=self.vars["language_codes"], width=44)),
            ("Mode", ttk.Combobox(frm, textvariable=self.vars["transcribe_mode"], width=42,
                                  values=["smart", "verbatim"], state="readonly")),
            ("Custom words (, ခြား)", ttk.Entry(frm, textvariable=self.vars["custom_vocabulary"], width=44)),
        ]
        for i, (label, widget) in enumerate(rows):
            ttk.Label(frm, text=label).grid(row=i, column=0, sticky="w", pady=4, padx=(0, 10))
            widget.grid(row=i, column=1, sticky="we", pady=4)
        n = len(rows)
        link = ttk.Label(frm, text="API key ယူရန် → aistudio.google.com/apikey", foreground="#2f6feb", cursor="hand2")
        link.grid(row=n, column=1, sticky="w")
        link.bind("<Button-1>", lambda e: webbrowser.open("https://aistudio.google.com/apikey"))
        ttk.Checkbutton(frm, text="Beep sounds", variable=self.sounds).grid(row=n + 1, column=1, sticky="w", pady=(8, 0))
        ttk.Checkbutton(frm, text="Windows စဖွင့်ရင် အလိုလိုဖွင့်မယ်", variable=self.autostart).grid(
            row=n + 2, column=1, sticky="w")
        btns = ttk.Frame(frm)
        btns.grid(row=n + 3, column=0, columnspan=2, sticky="e", pady=(14, 0))
        ttk.Button(btns, text="Cancel", command=self.win.destroy).pack(side="right", padx=(6, 0))
        ttk.Button(btns, text="Save", command=self.save).pack(side="right")

        self.win.update_idletasks()
        sw, sh = self.win.winfo_screenwidth(), self.win.winfo_screenheight()
        self.win.geometry(f"+{(sw - self.win.winfo_width()) // 2}+{(sh - self.win.winfo_height()) // 3}")
        self.win.focus_force()

    def save(self):
        split = lambda s: [x.strip() for x in s.split(",") if x.strip()]
        cfg = dict(self.app.cfg)
        cfg["api_key"] = self.vars["api_key"].get().strip()
        cfg["hotkey"] = self.vars["hotkey"].get().strip() or DEFAULT_CONFIG["hotkey"]
        cfg["model"] = self.vars["model"].get().strip() or DEFAULT_CONFIG["model"]
        cfg["language_codes"] = split(self.vars["language_codes"].get())
        cfg["transcribe_mode"] = self.vars["transcribe_mode"].get()
        cfg["custom_vocabulary"] = split(self.vars["custom_vocabulary"].get())
        cfg["sounds"] = self.sounds.get()
        try:
            keyboard.parse_hotkey(cfg["hotkey"])
        except Exception:
            tk.messagebox.showerror(APP_NAME, f"Hotkey '{cfg['hotkey']}' ကို မသိပါ။", parent=self.win)
            return
        try:
            set_autostart(self.autostart.get())
        except OSError as e:
            log.warning("autostart: %s", e)
        save_config(cfg)
        self.app.apply_config(cfg)
        self.win.destroy()


# ---------------------------------------------------------------- first-run wizard

def run_in_background(widget, func, on_done):
    """Run func() on a thread and hand its result (or exception) to on_done on the UI thread."""
    result = {}

    def work():
        try:
            result["value"] = func()
        except Exception as e:
            result["error"] = e

    thread = threading.Thread(target=work, daemon=True)
    thread.start()

    def poll():
        if thread.is_alive():
            widget.after(100, poll)
        elif widget.winfo_exists():
            on_done(result.get("value"), result.get("error"))

    widget.after(100, poll)


class SetupWizard:
    """Three steps in Burmese: API key -> microphone test -> how to use."""

    def __init__(self, app):
        self.app = app
        self.cfg = dict(app.cfg)
        self.recorder = Recorder()
        self.recording = False
        self.win = tk.Toplevel(app.root)
        self.win.title(f"{APP_NAME} - Setup")
        self.win.resizable(False, False)
        self.win.attributes("-topmost", True)
        self.win.protocol("WM_DELETE_WINDOW", self.close)
        self.body = ttk.Frame(self.win, padding=22)
        self.body.pack(fill="both", expand=True)
        self.footer = ttk.Frame(self.win, padding=(22, 0, 22, 18))
        self.footer.pack(fill="x")
        self.step_key()
        sw, sh = self.win.winfo_screenwidth(), self.win.winfo_screenheight()
        self.win.geometry(f"520x400+{(sw - 520) // 2}+{(sh - 400) // 3}")
        self.win.focus_force()

    def clear(self, step):
        for frame in (self.body, self.footer):
            for child in frame.winfo_children():
                child.destroy()
        ttk.Label(self.body, text=f"အဆင့် {step} / 3", foreground="#6b7280").pack(anchor="w")

    def title(self, text):
        ttk.Label(self.body, text=text, font=("Segoe UI", 15, "bold")).pack(anchor="w", pady=(4, 10))

    def para(self, text, **kw):
        label = ttk.Label(self.body, text=text, wraplength=470, justify="left", **kw)
        label.pack(anchor="w", pady=3)
        return label

    # --- step 1: API key

    def step_key(self):
        self.clear(1)
        self.title("Myanmar Flow မှ ကြိုဆိုပါတယ် 👋")
        self.para("မြန်မာလို ပြောလိုက်တာကို စာအဖြစ် ချက်ချင်းရိုက်ပေးဖို့ Google Gemini API key တစ်ခု လိုပါတယ်။ "
                  "အခမဲ့ ယူလို့ရပါတယ်။")
        self.para("① အောက်က ခလုတ်ကိုနှိပ်ပြီး Google account နဲ့ ဝင်ပါ\n"
                  "② \"Create API key\" ကိုနှိပ်ပြီး key ကို Copy ကူးပါ\n"
                  "③ ဒီအောက်က အကွက်ထဲ Paste လုပ်ပြီး \"စစ်ဆေးမယ်\" နှိပ်ပါ")
        ttk.Button(self.body, text="🔑  API key ယူရန် (aistudio.google.com)",
                   command=lambda: webbrowser.open("https://aistudio.google.com/apikey")).pack(anchor="w", pady=8)
        self.key_var = tk.StringVar(value=self.cfg["api_key"])
        entry = ttk.Entry(self.body, textvariable=self.key_var, show="•", width=60)
        entry.pack(anchor="w", fill="x")
        entry.focus_set()
        self.key_status = self.para("")
        self.check_btn = ttk.Button(self.footer, text="စစ်ဆေးမယ် →", command=self.check_key)
        self.check_btn.pack(side="right")
        entry.bind("<Return>", lambda e: self.check_key())

    def check_key(self):
        key = self.key_var.get().strip()
        if not key:
            self.key_status.configure(text="Key ကို အရင် Paste လုပ်ပါ", foreground="#e5484d")
            return
        self.check_btn.configure(state="disabled")
        self.key_status.configure(text="စစ်နေပါတယ်...", foreground="#6b7280")

        def done(problem, error):
            self.check_btn.configure(state="normal")
            problem = problem or (friendly_error(error) if error else None)
            if problem:
                hint = ""
                if "သုံးခွင့်မရှိ" in problem:
                    hint = "\n(Google က ဒီနိုင်ငံ/ဒေသကို Gemini ခွင့်မပြုသေးပါ)"
                self.key_status.configure(text=f"❌ {problem}{hint}", foreground="#e5484d")
                return
            self.cfg["api_key"] = key
            save_config(self.cfg)
            self.app.apply_config(self.cfg)
            self.step_mic()

        run_in_background(self.win, lambda: check_api_key(key), done)

    # --- step 2: microphone test

    def step_mic(self):
        self.clear(2)
        self.title("✅ Key အဆင်ပြေပါတယ်။ Mic စမ်းကြည့်ရအောင်")
        self.para("\"စပြောမယ်\" ကိုနှိပ်ပြီး \"မင်္ဂလာပါ\" လို့ ပြောကြည့်ပါ။ ပြီးရင် \"ရပ်မယ်\" ကိုနှိပ်ပါ။")
        self.mic_btn = ttk.Button(self.body, text="🎙  စပြောမယ်", command=self.toggle_mic)
        self.mic_btn.pack(anchor="w", pady=10)
        self.mic_result = self.para("", font=("Segoe UI", 12))
        ttk.Button(self.footer, text="ရှေ့ဆက်မယ် →", command=self.step_done).pack(side="right")
        ttk.Button(self.footer, text="ကျော်မယ်", command=self.step_done).pack(side="right", padx=6)

    def toggle_mic(self):
        if not self.recording:
            try:
                self.recorder.start()
            except Exception as e:
                log.error("Mic test: %s", e)
                self.mic_result.configure(text="❌ Mic ကို ဖွင့်လို့မရပါ။ Windows Settings → Privacy → Microphone ကို စစ်ပါ",
                                          foreground="#e5484d")
                return
            self.recording = True
            self.mic_btn.configure(text="⏹  ရပ်မယ်")
            self.mic_result.configure(text="နားထောင်နေတယ်...", foreground="#e5484d")
            return
        self.recording = False
        audio = self.recorder.stop()
        self.mic_btn.configure(text="🎙  စပြောမယ်", state="disabled")
        if audio is None or int(np.abs(audio).max()) < 300:
            self.mic_btn.configure(state="normal")
            self.mic_result.configure(text="❌ အသံ မကြားရပါ။ Mic ချိတ်ထားလား၊ အသံတိုးနေလား စစ်ပါ", foreground="#e5484d")
            return
        self.mic_result.configure(text="စာပြောင်းနေတယ်...", foreground="#f5a524")

        def done(text, error):
            self.mic_btn.configure(state="normal")
            if error:
                log.error("Mic test: %s", error)
                self.mic_result.configure(text=f"❌ {friendly_error(error)}", foreground="#e5484d")
            elif not text:
                self.mic_result.configure(text="စကားသံ မတွေ့ပါ။ ထပ်ပြောကြည့်ပါ", foreground="#e5484d")
            else:
                self.mic_result.configure(text=f"✅ \"{text}\"", foreground="#22a06b")

        run_in_background(self.win, lambda: transcribe(self.cfg, to_wav_bytes(audio)), done)

    # --- step 3: how to use

    def step_done(self):
        if self.recording:
            self.recording = False
            self.recorder.stop()
        self.clear(3)
        self.title("🎉 အဆင်သင့်ဖြစ်ပါပြီ")
        hotkey = self.cfg["hotkey"]
        self.para(f"ဘယ် app မှာမဆို (Facebook, Messenger, Word, Gmail ...) စာရိုက်ချင်တဲ့နေရာကို နှိပ်ထားပြီး\n\n"
                  f"     ⌨  [{hotkey}] ကို ဖိထား  →  🎙 ပြော  →  လွှတ်လိုက်\n\n"
                  "ပြောတာတွေ စာအဖြစ် အလိုလို ဝင်လာပါမယ်။")
        self.para("နာရီဘေးက 🟢 icon ကိုနှိပ်ရင် ဖွင့်/ပိတ် လုပ်လို့ရပါတယ်။ Right-click နှိပ်ရင် Settings နဲ့ အကူအညီ ရှိပါတယ်။",
                  foreground="#6b7280")
        self.autostart = tk.BooleanVar(value=True)
        ttk.Checkbutton(self.body, text="Windows စဖွင့်ရင် အလိုလိုဖွင့်မယ်", variable=self.autostart).pack(anchor="w", pady=8)
        ttk.Button(self.footer, text="ပြီးပါပြီ ✓", command=self.finish).pack(side="right")

    def finish(self):
        try:
            set_autostart(self.autostart.get())
        except OSError as e:
            log.warning("autostart: %s", e)
        self.close()

    def close(self):
        if self.recording:
            self.recording = False
            self.recorder.stop()
        self.win.destroy()


# ---------------------------------------------------------------- app

class App:
    def __init__(self):
        self.cfg = load_config()
        self.recorder = Recorder()
        self.enabled = True
        self.recording = False
        self.started_at = 0.0
        self.ui = queue.Queue()
        self.hook = None
        self.scan_codes = set()
        self.settings = None
        self.wizard = None

        self.root = tk.Tk()
        self.root.withdraw()
        self.root.report_callback_exception = lambda *exc: log.error("UI error", exc_info=exc)
        self.indicator = Indicator(self.root, lambda: self.recorder.level)
        self.icons = {k: make_icon(c) for k, c in STATE_COLORS.items()}
        self.tray = pystray.Icon(APP_NAME, self.icons["idle"], APP_NAME, menu=pystray.Menu(
            pystray.MenuItem(lambda _: "ပိတ်ရန် (Turn off)" if self.enabled else "ဖွင့်ရန် (Turn on)",
                             self.toggle_enabled, default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Settings...", lambda: self.ui.put(("settings",))),
            pystray.MenuItem("Setup wizard...", lambda: self.ui.put(("wizard",))),
            pystray.MenuItem("အကူအညီ (Help)", lambda: webbrowser.open(f"{REPO_URL}#readme")),
            pystray.MenuItem("ပြဿနာတင်ပြရန် (Report a problem)", lambda: webbrowser.open(f"{REPO_URL}/issues")),
            pystray.MenuItem("Log ဖိုင်ဖွင့်ရန်", lambda: os.startfile(LOG_PATH)),
            pystray.MenuItem(f"Version {APP_VERSION}", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self.quit),
        ))

    # --- state

    def set_state(self, state, text=None):
        """state: idle | off | recording | transcribing | done; text = error to show."""
        tray_state = "idle" if state == "done" else state
        self.tray.icon = self.icons[tray_state]
        hotkey = self.cfg["hotkey"]
        self.tray.title = {
            "idle": f"{APP_NAME} - On  ([{hotkey}] ဖိပြီးပြောပါ)",
            "off": f"{APP_NAME} - Off",
            "recording": f"{APP_NAME} - Recording...",
            "transcribing": f"{APP_NAME} - Transcribing...",
        }[tray_state]
        self.ui.put(("indicator", state, text))

    def beep(self, freq, ms):
        if self.cfg["sounds"]:
            threading.Thread(target=winsound.Beep, args=(freq, ms), daemon=True).start()

    def toggle_enabled(self, *_):
        self.enabled = not self.enabled
        if not self.enabled and self.recording:
            self.recording = False
            self.recorder.stop()
        self.set_state("idle" if self.enabled else "off")
        self.tray.update_menu()

    def apply_config(self, cfg):
        self.cfg = cfg
        self.bind_hotkey()
        self.set_state("idle" if self.enabled else "off")

    def bind_hotkey(self):
        # One global hook filtered by scan code: keyboard.on_press_key/on_release_key
        # share an internal entry per key, so unhooking both raises KeyError.
        if self.hook:
            keyboard.unhook(self.hook)
        self.scan_codes = set(keyboard.key_to_scan_codes(self.cfg["hotkey"]))
        self.hook = keyboard.hook(self.on_key)

    # --- hotkey handlers (keyboard hook thread)

    def on_key(self, event):
        # Match by name too: "right ctrl" shares scan code 29 with left ctrl.
        if event.scan_code not in self.scan_codes or (event.name or "").lower() != self.cfg["hotkey"].lower():
            return
        if event.event_type == keyboard.KEY_DOWN:
            self.on_press(event)
        else:
            self.on_release(event)

    def on_press(self, _event):
        if not self.enabled or self.recording:
            return
        if not self.cfg["api_key"]:
            self.ui.put(("wizard",))
            return
        self.recording = True
        self.started_at = time.time()
        try:
            self.recorder.start()
        except Exception as e:
            self.recording = False
            log.error("Microphone error: %s", e)
            self.set_state("idle", "Mic ဖွင့်လို့မရပါ")
            return
        self.beep(880, 70)
        self.set_state("recording")

    def on_release(self, _event):
        if not self.recording:
            return
        self.recording = False
        audio = self.recorder.stop()
        self.beep(600, 70)
        if audio is None or time.time() - self.started_at < self.cfg["min_seconds"]:
            self.set_state("idle")
            return
        self.set_state("transcribing")
        threading.Thread(target=self.process, args=(audio,), daemon=True).start()

    def process(self, audio):
        try:
            text = transcribe(self.cfg, to_wav_bytes(audio))
        except Exception as e:
            log.error("%s", e)
            self.beep(300, 250)
            self.set_state("idle", friendly_error(e))
            return
        if text:
            log.info("Transcribed: %s", text)
            paste_text(text)
        self.set_state(("done" if text else "idle") if self.enabled else "off")

    # --- UI thread

    def pump_ui(self):
        try:
            while True:
                msg = self.ui.get_nowait()
                if msg[0] == "indicator":
                    self.indicator.set_state(msg[1], msg[2])
                elif msg[0] == "settings":
                    self.open_settings()
                elif msg[0] == "wizard":
                    self.open_wizard()
                elif msg[0] == "quit":
                    self.root.destroy()
                    return
        except queue.Empty:
            pass
        self.root.after(50, self.pump_ui)

    def open_settings(self):
        if self.settings and self.settings.win.winfo_exists():
            self.settings.win.lift()
            self.settings.win.focus_force()
            return
        self.settings = SettingsWindow(self)

    def open_wizard(self):
        if self.wizard and self.wizard.win.winfo_exists():
            self.wizard.win.lift()
            self.wizard.win.focus_force()
            return
        self.wizard = SetupWizard(self)

    def quit(self, *_):
        self.tray.stop()
        keyboard.unhook_all()
        self.ui.put(("quit",))

    def run(self):
        self.bind_hotkey()
        self.tray.run_detached()
        self.set_state("idle")
        if not self.cfg["api_key"]:
            self.ui.put(("wizard",))
        else:
            self.tray.notify(f"[{self.cfg['hotkey']}] ကို ဖိထားပြီး ပြောပါ။", APP_NAME)
        self.root.after(50, self.pump_ui)
        self.root.mainloop()


def already_running():
    ctypes.windll.kernel32.CreateMutexW(None, False, "MyanmarFlowSingleInstance")
    return ctypes.windll.kernel32.GetLastError() == 183  # ERROR_ALREADY_EXISTS


def main():
    import tkinter.messagebox  # noqa: F401  (used by SettingsWindow)
    if already_running():
        ctypes.windll.user32.MessageBoxW(None, "Myanmar Flow က ဖွင့်ထားပြီးသားပါ (tray မှာကြည့်ပါ)။", APP_NAME, 0x40)
        return
    log.info("Starting %s %s (burmese text shaping: %s)", APP_NAME, APP_VERSION, HAS_RAQM)
    try:
        App().run()
    except Exception:
        log.exception("Fatal error")
        raise


if __name__ == "__main__":
    main()
