# 第二輪三案。共用的 _head.html / _tokens.css / _pips.svg / _data.js 都在上一層，不另外抄一份。
# 用法：python3 build.py            # 全部重組
#       python3 build.py a.def      # 只組一支
import io, glob, re, sys, os
rd = lambda p: io.open(p, encoding="utf-8").read()
up = lambda p: rd(os.path.join("..", p))
head, tokens, pips, data = up("_head.html"), up("_tokens.css"), up("_pips.svg"), up("_data.js")
BASE, SHARED = rd("_base.css"), rd("_shared.js")
for f in (sys.argv[1:] or sorted(glob.glob("[abc].def"))):
    src = rd(f); name = f[:-4]
    title = re.search(r"/\*\s*TITLE:\s*(.+?)\s*\*/", src).group(1)
    css, rest = src.split("/*==HTML==*/")
    html, js = rest.split("/*==JS==*/")
    out = (head.replace("__TITLE__", title).replace("__TOKENS__", tokens + "\n" + BASE)
           + css + "\n</style>\n</head>\n<body>\n" + pips + html
           + "\n<script>\n" + data + "\n" + SHARED + "\n" + js + "\n</script>\n</body>\n</html>\n")
    io.open(name + ".html", "w", encoding="utf-8").write(out)
    print("%-9s %-22s %6d" % (name + ".html", title, len(out)))
