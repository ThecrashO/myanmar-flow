"""macOS pieces of Crash Flow: the floating pill window, global hotkeys, paste,
beeps, start-at-login, the single-instance lock and the permission checks.

Everything that touches AppKit runs on the main thread (the Tk thread), because
AppKit is not thread-safe. The hotkey listener (pynput) calls back on its own
thread, like the Windows `keyboard` hook does."""

import fcntl
import io
import math
import plistlib
import subprocess
import sys
from pathlib import Path

import AppKit
import numpy as np
import sounddevice as sd
from PIL import Image
from pynput import keyboard as pkb

# ---------------------------------------------------------------- fonts

_SUPP = Path("/System/Library/Fonts/Supplemental")
_FONTS = Path("/System/Library/Fonts")


def font_path(name):
    """Map the Windows font file names the pill uses to fonts every Mac has."""
    candidates = {
        "mmrtext.ttf": [_SUPP / "Myanmar Sangam MN.ttc", _SUPP / "Myanmar MN.ttc", _FONTS / "NotoSansMyanmar.ttc"],
        "segoeui.ttf": [_FONTS / "SFNS.ttf", _FONTS / "Helvetica.ttc", _SUPP / "Arial.ttf"],
        "segoeuib.ttf": [_SUPP / "Arial Bold.ttf", _FONTS / "Helvetica.ttc"],
    }.get(name, [])
    for path in candidates:
        if path.exists():
            return path
    return Path(name)


def render_text(text, px_size, rgb):
    """Render text with macOS's own text engine (CoreText shapes Burmese correctly;
    Pillow's macOS wheels can't). Returns a tight white-on-transparent PIL image."""
    font = (AppKit.NSFont.fontWithName_size_("Myanmar Sangam MN", px_size)
            or AppKit.NSFont.systemFontOfSize_(px_size))
    color = AppKit.NSColor.colorWithSRGBRed_green_blue_alpha_(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1.0)
    string = AppKit.NSAttributedString.alloc().initWithString_attributes_(
        text, {AppKit.NSFontAttributeName: font, AppKit.NSForegroundColorAttributeName: color})
    size = string.size()
    w, h = max(1, math.ceil(size.width) + 2), max(1, math.ceil(size.height) + 2)
    rep = AppKit.NSBitmapImageRep.alloc().initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel_(
        None, w, h, 8, 4, True, False, AppKit.NSDeviceRGBColorSpace, 0, 0)
    ctx = AppKit.NSGraphicsContext.graphicsContextWithBitmapImageRep_(rep)
    AppKit.NSGraphicsContext.saveGraphicsState()
    AppKit.NSGraphicsContext.setCurrentContext_(ctx)
    string.drawAtPoint_((1, 1))
    ctx.flushGraphics()
    AppKit.NSGraphicsContext.restoreGraphicsState()
    png = rep.representationUsingType_properties_(AppKit.NSBitmapImageFileTypePNG, {})
    return Image.open(io.BytesIO(bytes(png))).convert("RGBA")


# ---------------------------------------------------------------- floating pill window

class Overlay:
    """A borderless, click-through panel that floats above every app (and full-screen
    spaces) without taking focus, so the paste still goes to the user's app."""

    def __init__(self):
        style = AppKit.NSWindowStyleMaskBorderless | AppKit.NSWindowStyleMaskNonactivatingPanel
        self.panel = AppKit.NSPanel.alloc().initWithContentRect_styleMask_backing_defer_(
            AppKit.NSMakeRect(0, 0, 10, 10), style, AppKit.NSBackingStoreBuffered, False)
        self.panel.setOpaque_(False)
        self.panel.setBackgroundColor_(AppKit.NSColor.clearColor())
        self.panel.setHasShadow_(False)  # the pill draws its own shadow
        self.panel.setIgnoresMouseEvents_(True)
        self.panel.setLevel_(AppKit.NSStatusWindowLevel)
        self.panel.setHidesOnDeactivate_(False)
        self.panel.setCollectionBehavior_(AppKit.NSWindowCollectionBehaviorCanJoinAllSpaces
                                          | AppKit.NSWindowCollectionBehaviorStationary
                                          | AppKit.NSWindowCollectionBehaviorFullScreenAuxiliary)
        self.view = AppKit.NSImageView.alloc().initWithFrame_(AppKit.NSMakeRect(0, 0, 10, 10))
        self.view.setImageScaling_(AppKit.NSImageScaleAxesIndependently)
        self.panel.setContentView_(self.view)
        self.screen_top = 0.0
        self.visible = False

    def locate(self):
        """Top centre of the visible area (below the menu bar) of the screen the user
        is working on. Returns (centre x, top y from the screen's top, scale)."""
        screen = AppKit.NSScreen.mainScreen() or AppKit.NSScreen.screens()[0]
        frame, vis = screen.frame(), screen.visibleFrame()
        self.screen_top = frame.origin.y + frame.size.height
        top_gap = self.screen_top - (vis.origin.y + vis.size.height)  # menu bar height
        return (vis.origin.x + vis.size.width / 2, top_gap, float(screen.backingScaleFactor()))

    def present(self, img, anchor, alpha):
        """Show a PIL RGBA image (drawn at the screen's pixel scale) with its top centre
        at the anchor."""
        cx, top, scale = anchor
        drop = (1 - alpha) * 10  # slight drop while fading in
        w, h = img.width / scale, img.height / scale
        buf = io.BytesIO()
        img.save(buf, format="PNG", compress_level=1)
        data = AppKit.NSData.dataWithBytes_length_(buf.getvalue(), len(buf.getvalue()))
        image = AppKit.NSImage.alloc().initWithData_(data)
        image.setSize_((w, h))
        y = self.screen_top - top - drop - h  # Cocoa measures y from the bottom
        self.panel.setFrame_display_(AppKit.NSMakeRect(cx - w / 2, y, w, h), False)
        self.view.setFrame_(AppKit.NSMakeRect(0, 0, w, h))
        self.view.setImage_(image)
        self.panel.setAlphaValue_(alpha)
        if not self.visible:
            self.panel.orderFrontRegardless()
            self.visible = True

    def hide(self):
        if self.visible:
            self.panel.orderOut_(None)
            self.visible = False


# ---------------------------------------------------------------- hotkeys

KEY_NAMES = {
    "right option": pkb.Key.alt_r, "right alt": pkb.Key.alt_r,
    "left option": pkb.Key.alt_l, "left alt": pkb.Key.alt_l,
    "right command": pkb.Key.cmd_r, "right cmd": pkb.Key.cmd_r,
    "left command": pkb.Key.cmd_l, "left cmd": pkb.Key.cmd_l,
    "right ctrl": pkb.Key.ctrl_r, "right control": pkb.Key.ctrl_r,
    "left ctrl": pkb.Key.ctrl_l, "left control": pkb.Key.ctrl_l,
    "right shift": pkb.Key.shift_r, "caps lock": pkb.Key.caps_lock,
}
KEY_NAMES.update({f"f{n}": getattr(pkb.Key, f"f{n}") for n in range(1, 21) if hasattr(pkb.Key, f"f{n}")})


def valid_hotkey(name):
    return name.strip().lower() in KEY_NAMES


class HotkeyListener:
    """Calls on_press(mode) / on_release(mode) for the configured keys, and
    on_other() when any other key goes down (so Option+letter or Command+C
    while the hotkey is held can cancel a recording that wasn't meant)."""

    def __init__(self, on_press, on_release, on_other):
        self.on_press, self.on_release, self.on_other = on_press, on_release, on_other
        self.keys = {}
        self.listener = None

    def bind(self, hotkeys):
        """hotkeys: [(mode, name)]."""
        self.keys = {KEY_NAMES[name.lower()]: mode for mode, name in hotkeys if name and valid_hotkey(name)}
        if self.listener is None:
            self.listener = pkb.Listener(on_press=self._press, on_release=self._release)
            self.listener.daemon = True
            self.listener.start()

    def _press(self, key):
        mode = self.keys.get(key)
        if mode:
            self.on_press(mode)
        else:
            self.on_other()

    def _release(self, key):
        mode = self.keys.get(key)
        if mode:
            self.on_release(mode)

    def stop(self):
        if self.listener:
            self.listener.stop()


# ---------------------------------------------------------------- clipboard and paste

_controller = pkb.Controller()


def copy_text(text):
    board = AppKit.NSPasteboard.generalPasteboard()
    board.clearContents()
    board.setString_forType_(text, AppKit.NSPasteboardTypeString)


def clipboard_text():
    return AppKit.NSPasteboard.generalPasteboard().stringForType_(AppKit.NSPasteboardTypeString)


def send_paste():
    with _controller.pressed(pkb.Key.cmd):
        _controller.press("v")
        _controller.release("v")


# ---------------------------------------------------------------- beeps

def beep(freq, ms):
    """A short soft sine tone (macOS has no winsound.Beep)."""
    rate = 44100
    t = np.arange(int(rate * ms / 1000)) / rate
    tone = 0.18 * np.sin(2 * np.pi * freq * t)
    fade = min(len(t) // 4, int(rate * 0.008))
    if fade:
        ramp = np.linspace(0, 1, fade)
        tone[:fade] *= ramp
        tone[-fade:] *= ramp[::-1]
    try:
        sd.play(tone.astype(np.float32), rate, blocking=True)
    except Exception:
        pass


# ---------------------------------------------------------------- start at login

# The id is from when the app was called Myanmar Flow. It stays, like the app's bundle id,
# so macOS keeps the microphone and Accessibility permissions people already gave.
AGENT_PATH = Path.home() / "Library" / "LaunchAgents" / "com.thecrasho.myanmarflow.plist"


def _launch_args():
    if getattr(sys, "frozen", False):
        return [sys.executable]
    return [sys.executable, str(Path(sys.argv[0]).resolve())]


def autostart_enabled():
    return AGENT_PATH.exists()


def set_autostart(enabled):
    if enabled:
        AGENT_PATH.parent.mkdir(parents=True, exist_ok=True)
        AGENT_PATH.write_bytes(plistlib.dumps({
            "Label": "com.thecrasho.myanmarflow",
            "ProgramArguments": _launch_args(),
            "RunAtLoad": True,
            "ProcessType": "Interactive",
        }))
    elif AGENT_PATH.exists():
        AGENT_PATH.unlink()


def move_autostart():
    """Point "start at login" at this copy (the app was renamed in 1.4, so it may have moved)."""
    if AGENT_PATH.exists() and plistlib.loads(AGENT_PATH.read_bytes()).get("ProgramArguments") != _launch_args():
        set_autostart(True)


# ---------------------------------------------------------------- single instance, files, dialogs

_lock_file = None


def already_running(data_dir):
    global _lock_file
    _lock_file = open(data_dir / ".lock", "w")
    try:
        fcntl.flock(_lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return False
    except OSError:
        return True


def open_file(path):
    subprocess.Popen(["open", str(path)])


def alert(title, message):
    AppKit.NSApplication.sharedApplication()
    box = AppKit.NSAlert.alloc().init()
    box.setMessageText_(title)
    box.setInformativeText_(message)
    box.runModal()


def bring_to_front():
    """A menu-bar app isn't active while its menu is used; activate it so new
    windows (Settings, wizard) open in front."""
    AppKit.NSApplication.sharedApplication().activateIgnoringOtherApps_(True)


def hide_dock_icon():
    """Run as a menu-bar app (no Dock icon) even when started from source."""
    AppKit.NSApplication.sharedApplication().setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory)


def has_accessibility(prompt=False):
    """Hotkeys and pasting need Accessibility permission. With prompt=True macOS
    shows its own dialog that leads to System Settings."""
    try:
        from ApplicationServices import AXIsProcessTrustedWithOptions, kAXTrustedCheckOptionPrompt
        return bool(AXIsProcessTrustedWithOptions({kAXTrustedCheckOptionPrompt: prompt}))
    except Exception:
        return True  # can't tell; don't block the user


def open_privacy_settings(pane="Accessibility"):
    subprocess.Popen(["open", f"x-apple.systempreferences:com.apple.preference.security?Privacy_{pane}"])



