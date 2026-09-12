import io, glob, re, sys
rd = lambda p: io.open(p, encoding="utf-8").read()
R = "../room/"                       # 共用的底沿用開房頁那一份，不要在這裡複製一份色票
head, tokens, base = rd(R+"_head.html"), rd(R+"_tokens.css"), rd(R+"_base.css")
pips, back, av = rd(R+"_pips.svg"), rd(R+"_back.html"), rd(R+"_av.txt").strip()
stage_css, stage_html = rd("_stage.css"), rd("_stage.html")
for f in (sys.argv[1:] or sorted(glob.glob("[abc].def"))):
    src = rd(f); name = f[:-4]
    title = re.search(r"/\*\s*TITLE:\s*(.+?)\s*\*/", src).group(1)
    css, html = src.split("/*==HTML==*/")
    out = (head.replace("__TITLE__", title).replace("__TOKENS__", tokens+"\n"+base+"\n"+stage_css)
           + css + "\n</style>\n</head>\n<body>\n" + pips + back + stage_html + html + "\n</body>\n</html>\n")
    out = out.replace("__AV__", av)
    io.open(name+".html", "w", encoding="utf-8").write(out)
    print("%-9s %-28s %6d" % (name+".html", title, len(out)))
