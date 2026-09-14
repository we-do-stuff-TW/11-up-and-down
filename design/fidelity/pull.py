#!/usr/bin/env python3
"""把 docs/index.html 裡「已經在跑的」那幾段抄進原型，基準線才是真的。

抄的是三段：貼圖與噪訊（mulberry32…ringTex）、書房（buildRoom）、骰子（DIE_A…dieMesh）。
靠函式名找邊界，不寫行號——docs/index.html 天天在動。
抄完的 .part 檔不要手改，改了下次 pull 就沒了；要改行為請改 _scene.js 裡的覆寫。
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = (ROOT / "docs/index.html").read_text()
HERE = pathlib.Path(__file__).parent

BLOCKS = {
    "_tex.js.part":  ("function mulberry32(a){",          "/* ================= 書房 ================= */"),
    "_room.js.part": ("function buildRoom(r, scene){",    "/* 每個座位一張椅子"),
    "_dice.js.part": ("const DIE_A = .34, DIE_R = .075;", "function bidRing(r0, r1"),
}

for name, (a, b) in BLOCKS.items():
    i = SRC.find(a)
    j = SRC.find(b, i + 1)
    if i < 0 or j < 0:
        sys.exit(f"抄不到 {name}：找不到「{a if i<0 else b}」——docs/index.html 改過了")
    (HERE / name).write_text(SRC[i:j].rstrip() + "\n")
    print(f"{name}  {SRC[i:j].count(chr(10))} 行")
