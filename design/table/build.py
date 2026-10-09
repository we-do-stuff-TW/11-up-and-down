# 把 compare.src.html 的 IMG_* 換成 shots/*.webp 的 data URI，產生可以直接發佈的 compare.html
import base64, pathlib
here = pathlib.Path(__file__).parent
s = (here / "compare.src.html").read_text()
imgs = {"IMG_NOW": "now", "IMG_A": "a-call", "IMG_B": "b-mahjong", "IMG_C": "c-flap", "IMG_D": "d-canon"}
for k, f in imgs.items():
    s = s.replace(f'data-zoom="{k}"', "data-zoom")
    uri = "data:image/webp;base64," + base64.b64encode((here / "shots" / f"{f}.webp").read_bytes()).decode()
    assert k in s, k
    s = s.replace(k, uri)
(here / "compare.html").write_text(s)
print("compare.html", len(s) // 1024, "KB")
