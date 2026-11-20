"""Cross-platform smoke test: show the real pill (recording + live words), screenshot it,
and check the text helpers. Usage: smoke.py <repo dir> <out.png>"""
import sys
import tkinter as tk

sys.path.insert(0, sys.argv[1])
import myanmar_flow as mf  # noqa: E402

out = sys.argv[2]
assert mf.normalize_burmese("၁ဝ") == "၁၀"
assert mf.plat.valid_hotkey(mf.DEFAULT_CONFIG["hotkey"]), mf.DEFAULT_CONFIG["hotkey"]
assert mf.plat.valid_hotkey(mf.DEFAULT_CONFIG["translate_hotkey"])
for name in ("mmrtext.ttf", "segoeui.ttf", "segoeuib.ttf"):
    print(name, "->", mf.plat.font_path(name), mf.plat.font_path(name).exists())
assert mf.CAN_SHAPE, "can't draw Burmese text"
print("raqm:", mf.HAS_RAQM, "shape:", mf.CAN_SHAPE, "hotkeys:", mf.DEFAULT_CONFIG["hotkey"], "/", mf.DEFAULT_CONFIG["translate_hotkey"])

root = tk.Tk()
root.withdraw()
ind = mf.Indicator(root, lambda: 0.6)
ind.set_state("recording")
root.after(500, lambda: ind.set_live("မင်္ဂလာပါ ဒီနေ့ ညနေ ခြောက်နာရီမှာ တွေ့ကြမယ်"))


def grab(out=out):
    from PIL import ImageGrab
    print("anchor", ind.anchor)
    if mf.IS_MAC:
        import subprocess
        subprocess.run(["screencapture", "-x", out], check=False)
    else:
        with mf.plat.dpi_aware():
            cx, top, scale = ind.anchor
            w = int(700 * scale)
            ImageGrab.grab(bbox=(cx - w // 2, max(0, top - 10), cx + w // 2, top + int(150 * scale)),
                           all_screens=True).save(out)


def done_state():
    grab()
    ind.set_state("done", "Copy ကူးထားပြီး — စာဝင်ပါပြီ")
    root.after(700, lambda: (grab(out.replace(".png", "-done.png")), root.destroy()))


root.after(1800, done_state)
root.mainloop()
print("ok")
