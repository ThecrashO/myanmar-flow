"""Windows pieces of Crash Flow: the floating pill window, global hotkeys, paste,
beeps, start-with-Windows, the single-instance mutex and dialogs.
platform_mac.py has the same functions for macOS."""

import contextlib
import ctypes
import os
import sys
import winreg
import winsound
from ctypes import wintypes
from pathlib import Path

import keyboard
import numpy as np
import pyperclip

# ---------------------------------------------------------------- fonts

FONTS_DIR = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"


def font_path(name):
    return FONTS_DIR / name


# ---------------------------------------------------------------- Win32

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


# ---------------------------------------------------------------- floating pill window

class Overlay:
    """A per-pixel-alpha layered window that is click-through and never takes focus,
    so the paste still goes to the user's app."""

    def __init__(self):
        self.visible = False
        with dpi_aware():
            self.hwnd = user32.CreateWindowExW(
                WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST,
                "STATIC", None, WS_POPUP, 0, 0, 1, 1, None, None, None, None)

    def locate(self):
        """Top centre of the work area of the monitor the user is typing on.
        Returns (centre x, top y, scale) in physical pixels."""
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
        return ((r.left + r.right) // 2, r.top, scale)

    def present(self, img, anchor, alpha):
        """Push a premultiplied BGRA bitmap to the layered window (UpdateLayeredWindow)."""
        cx, top, scale = anchor
        w, h = img.size
        x = cx - w // 2
        y = top - int((1 - alpha) * 10 * scale)  # slight drop while fading in
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
            blend = BLENDFUNCTION(0, 0, int(255 * alpha), 1)  # AC_SRC_OVER, AC_SRC_ALPHA
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

    def hide(self):
        if self.visible:
            user32.ShowWindow(self.hwnd, 0)  # SW_HIDE
            self.visible = False


# ---------------------------------------------------------------- hotkeys

def valid_hotkey(name):
    try:
        keyboard.key_to_scan_codes(name)
        return True
    except Exception:
        return False


def mask_alt_menu():
    """Tap an unassigned key (vk 0xE8) while Alt is down, so releasing Alt doesn't
    open the focused app's menu bar and swallow the paste."""
    user32.keybd_event(0xE8, 0, 0, 0)
    user32.keybd_event(0xE8, 0, 2, 0)  # KEYEVENTF_KEYUP


class HotkeyListener:
    """Calls on_press(mode) / on_release(mode) for the configured keys from the
    keyboard hook thread. on_other is unused on Windows."""

    def __init__(self, on_press, on_release, on_other=None):
        self.on_press, self.on_release = on_press, on_release
        self.hotkeys = {}
        self.hook = None

    def bind(self, hotkeys):
        """hotkeys: [(mode, name)]."""
        # One global hook: keyboard.on_press_key/on_release_key share an internal
        # entry per key, so unhooking both raises KeyError.
        if self.hook:
            keyboard.unhook(self.hook)
        self.hotkeys = {}
        for mode, key in hotkeys:
            try:
                if key:
                    self.hotkeys[key.lower()] = (mode, set(keyboard.key_to_scan_codes(key)))
            except ValueError:
                pass
        self.hook = keyboard.hook(self.on_key)

    def on_key(self, event):
        # Match by name too: "right ctrl" shares scan code 29 with left ctrl.
        name = (event.name or "").lower()
        match = self.hotkeys.get(name)
        if not match or event.scan_code not in match[1]:
            return
        if event.event_type == keyboard.KEY_DOWN:
            if "alt" in name:
                mask_alt_menu()
            self.on_press(match[0])
        else:
            self.on_release(match[0])

    def stop(self):
        keyboard.unhook_all()


# ---------------------------------------------------------------- clipboard and paste

def copy_text(text):
    pyperclip.copy(text)


def clipboard_text():
    return pyperclip.paste()


def foreground_window():
    return user32.GetForegroundWindow()


def send_paste():
    keyboard.send("ctrl+v")


# ---------------------------------------------------------------- beeps

def beep(freq, ms):
    winsound.Beep(freq, ms)


# ---------------------------------------------------------------- start with Windows

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
APP_KEY = "Crash Flow"
OLD_APP_KEY = "Myanmar Flow"  # the app's name before 1.4


def launch_command():
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}"'
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    return f'"{pythonw}" "{Path(sys.argv[0]).resolve()}"'


def autostart_enabled():
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            winreg.QueryValueEx(key, APP_KEY)
            return True
    except OSError:
        return False


def set_autostart(enabled):
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, APP_KEY, 0, winreg.REG_SZ, launch_command())
        else:
            try:
                winreg.DeleteValue(key, APP_KEY)
            except OSError:
                pass


def move_autostart():
    """If an older copy (or this one in another folder) starts with Windows, start this one instead."""
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_QUERY_VALUE | winreg.KEY_SET_VALUE) as key:
        was = False
        try:
            winreg.QueryValueEx(key, OLD_APP_KEY)
            winreg.DeleteValue(key, OLD_APP_KEY)
            was = True
        except OSError:
            pass
        try:
            was = was or winreg.QueryValueEx(key, APP_KEY)[0] != launch_command()
        except OSError:
            pass
        if was:
            winreg.SetValueEx(key, APP_KEY, 0, winreg.REG_SZ, launch_command())


# ---------------------------------------------------------------- single instance, files, dialogs

def already_running(data_dir=None):
    # The old name on purpose: an old Myanmar Flow and a new Crash Flow never run together.
    ctypes.windll.kernel32.CreateMutexW(None, False, "MyanmarFlowSingleInstance")
    return ctypes.windll.kernel32.GetLastError() == 183  # ERROR_ALREADY_EXISTS


def open_file(path):
    os.startfile(path)


def alert(title, message):
    user32.MessageBoxW(None, message, title, 0x40)


def hide_dock_icon():
    pass


def has_accessibility(prompt=False):
    return True


def open_privacy_settings(pane="Microphone"):
    os.startfile("ms-settings:privacy-microphone")




def bring_to_front():
    pass
