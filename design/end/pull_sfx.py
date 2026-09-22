#!/usr/bin/env python3
"""把 docs/index.html 的音效層（那個 <script> 整段）原封不動抄成 _sfx.js.part，
尾巴多掛一行 SFX._prim 把合成原件露出來，G 案的頒獎音效才能用同一套原件寫。
docs/index.html 改過之後重跑：python3 pull_sfx.py && python3 build.py g.def"""
import io, re, pathlib
src = io.open(pathlib.Path(__file__).parent / "../../docs/index.html", encoding="utf-8").read()
i = src.index("11 Up & Down — 音效層")
a = src.rfind("<script>", 0, i) + len("<script>")
b = src.index("</script>", i)
js = src[a:b]
hook = 'window.SFX = SFX;\n})();'
assert js.count(hook) == 1, "音效層尾巴長得不一樣了，pull_sfx.py 要跟著改"
prim = ('/* 原型用：把原件露出來給 G 案的頒獎音效（正式版是寫在這個 IIFE 裡面，不需要這一行） */\n'
        'SFX._prim = {grain:grain, thump:thump, rhodes:rhodes, cardLand:cardLand, cardSlide:cardSlide, pack:pack, sweep:sweep,\n'
        '  out:out, now:now, live:live, rnd:rnd, N:N, ctx:function(){ return ctx; }, unlock:unlock};\n')
js = js.replace(hook, prim + hook)
io.open("_sfx.js.part", "w", encoding="utf-8").write(js)
print("_sfx.js.part  %d KB（docs/index.html 第 %d 行起）" % (len(js) // 1024, src.count("\n", 0, a) + 1))
