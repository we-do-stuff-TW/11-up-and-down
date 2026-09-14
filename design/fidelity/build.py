#!/usr/bin/env python3
"""_page.html ＋ _scene.js ＋ 三段抄過來的 .part → index.html（單檔，可直接開）

    python3 pull.py      # 先從 docs/index.html 重抄一次（偶爾做）
    python3 build.py     # 產生 index.html
"""
import pathlib, sys

HERE = pathlib.Path(__file__).parent
page = (HERE / "_page.html").read_text()
scene = (HERE / "_scene.js").read_text()

for mark, part in (("/*==TEX==*/", "_tex.js.part"),
                   ("/*==ROOM==*/", "_room.js.part"),
                   ("/*==DICE==*/", "_dice.js.part")):
    if mark not in scene:
        sys.exit(f"_scene.js 少了 {mark}")
    scene = scene.replace(mark, (HERE / part).read_text().rstrip())

if "/*==JS==*/" not in page:
    sys.exit("_page.html 少了 /*==JS==*/")
out = page.replace("/*==JS==*/", scene)
(HERE / "index.html").write_text(out)
print(f"index.html  {len(out)//1024} KB")

# Artifact 版：claude.ai 會自己包 <!doctype>/<head>/<body>，所以把這三行前綴切掉
art = out.split("<title>", 1)
art = "<title>" + art[1]
(HERE / "artifact.html").write_text(art)
print(f"artifact.html  {len(art)//1024} KB")
