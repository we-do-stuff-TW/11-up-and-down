# 三案共用 _head.html / _tokens.css / _pips.svg / _data.js，各自的 .def 只寫自己的 CSS、HTML 與畫法。
# 用法：python3 build.py            # 全部重組
#       python3 build.py a.def      # 只組一支
import io, glob, re, sys
rd = lambda p: io.open(p, encoding="utf-8").read()
head, tokens, pips, data = rd("_head.html"), rd("_tokens.css"), rd("_pips.svg"), rd("_data.js")
for f in (sys.argv[1:] or sorted(glob.glob("[abc].def"))):
    src = rd(f); name = f[:-4]
    title = re.search(r"/\*\s*TITLE:\s*(.+?)\s*\*/", src).group(1)
    css, rest = src.split("/*==HTML==*/")
    html, js = rest.split("/*==JS==*/")
    out = (head.replace("__TITLE__", title).replace("__TOKENS__", tokens)
           + css + "\n</style>\n</head>\n<body>\n" + pips + html
           + "\n<script>\n" + data + "\n" + js + "\n</script>\n</body>\n</html>\n")
    io.open(name + ".html", "w", encoding="utf-8").write(out)
    print("%-9s %-22s %6d" % (name + ".html", title, len(out)))
