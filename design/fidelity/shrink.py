#!/usr/bin/env python3
"""shots/ 裡的 png 轉成 1800 寬的 jpg：原始 3200 寬一張 4 MB，整組 100 MB 進不了版控。
並排對照圖（cmp*）也在這裡拼。"""
import glob, os, pathlib
from PIL import Image

HERE = pathlib.Path(__file__).parent / "shots"
PAIRS = [("cmp-AD", "A", "D")] + [(f"cmpV-{v}", f"V-{v}-A", f"V-{v}-D") for v in ("cards", "dice", "chair", "room")]

def load(name):
    for ext in (".png", ".jpg"):
        p = HERE / (name + ext)
        if p.exists(): return Image.open(p).convert("RGB")
    return None

for out, a, b in PAIRS:                      # 全幅並排，不裁切
    ia, ib = load(a), load(b)
    if not ia or not ib: continue
    w, h = ia.size; sw = 1100; sh = int(h * sw / w)
    c = Image.new("RGB", (sw * 2 + 16, sh), (10, 9, 8))
    c.paste(ia.resize((sw, sh), Image.LANCZOS), (0, 0))
    c.paste(ib.resize((sw, sh), Image.LANCZOS), (sw + 16, 0))
    c.save(HERE / (out + ".jpg"), quality=88, optimize=True)
    print(out + ".jpg")

for f in sorted(glob.glob(str(HERE / "*.png"))):
    im = Image.open(f).convert("RGB")
    w, h = im.size
    if w > 1800: im = im.resize((1800, int(h * 1800 / w)), Image.LANCZOS)
    im.save(f[:-4] + ".jpg", quality=88, optimize=True)
    os.remove(f)
    print(os.path.basename(f)[:-4] + ".jpg")
