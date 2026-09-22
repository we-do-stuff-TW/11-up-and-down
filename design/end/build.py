import io, glob, re, sys
rd = lambda p: io.open(p, encoding="utf-8").read()
R = "../room/"                       # 色票與零件沿用開房頁那一份，不在這裡複製第二份
head, tokens, base, av = rd(R+"_head.html"), rd(R+"_tokens.css"), rd(R+"_base.css"), rd(R+"_av.txt").strip()
stage_css, top, bottom = rd("_stage.css"), rd("_top.html"), rd("_bottom.html")
for f in (sys.argv[1:] or sorted(glob.glob("[a-f].def"))):
    src = rd(f); name = f[:-4]
    title = re.search(r"/\*\s*TITLE:\s*(.+?)\s*\*/", src).group(1)
    css, html = src.split("/*==HTML==*/")
    out = (head.replace("__TITLE__", title).replace("__TOKENS__", tokens+"\n"+base+"\n"+stage_css)
           + css + "\n</style>\n</head>\n<body>\n" + top + html + bottom + "\n</body>\n</html>\n")
    out = out.replace("__AV__", av).replace("__V__", name.upper())
    if "/*==SFX==*/" in out:                 # G 案：音效層原封不動抄自 docs/index.html（pull_sfx.py）
        out = out.replace("/*==SFX==*/", rd("_sfx.js.part"))
    io.open(name+".html", "w", encoding="utf-8").write(out)
    print("%-9s %-28s %6d" % (name+".html", title, len(out)))
