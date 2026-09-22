#!/usr/bin/env python3
"""把 build 好的原型（g.html…）轉成可以發成 claude.ai Artifact 的單檔：
   · 只留 <title>／<link>／<style> 與 body 的內容（Artifact 自己會包 html/head/body）
   · 頭像 _tom.jpg 縮到 256px 內嵌成 data URI（Artifact 私人、給 Francis 自己看的；照片仍然不進版控）
   · 拿掉切換器裡連到其他案的 <a>（在 Artifact 裡是死連結），切換器改成會換行（手機）
   用法：python3 artifact.py g.html /path/out.html"""
import re, io, sys, base64, pathlib
from PIL import Image
here = pathlib.Path(__file__).parent
src = io.open(here / sys.argv[1], encoding="utf-8").read()
head = src[src.index("<head>") + 6 : src.index("</head>")]
body = src[src.index("<body>") + 6 : src.rindex("</body>")]
title = re.search(r"<title>.*?</title>", head, re.S).group(0)
links = "\n".join(l for l in re.findall(r"<link[^>]*>", head) if "stylesheet" in l or "preconnect" in l)
styles = "\n".join(re.findall(r"<style>.*?</style>", head, re.S))
im = Image.open(here / "_tom.jpg").convert("RGB").resize((256, 256), Image.LANCZOS)
buf = io.BytesIO(); im.save(buf, "JPEG", quality=84, optimize=True)
uri = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
body = body.replace('src="_tom.jpg"', 'src="' + uri + '"')
body = re.sub(r'<a href="[a-z]\.html"[^>]*>.*?</a>', "", body)
body = re.sub(r'(<nav class="dev" id="dev">)\s*(<i></i>)+', r"\1", body)
extra = ("<style>\n.dev{flex-wrap:wrap;justify-content:center;max-width:calc(100% - 24px);border-radius:16px;"
         "top:calc(10px + env(safe-area-inset-top,0px))}\n.dev>i{display:none}\n</style>")
out = title + "\n" + links + "\n" + styles + "\n" + extra + "\n" + body
io.open(sys.argv[2], "w", encoding="utf-8").write(out)
print(sys.argv[2], len(out) // 1024, "KB")
