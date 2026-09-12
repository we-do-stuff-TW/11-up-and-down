# 把 index / table / phone 三頁的外部 css、js 全部塞回檔案裡，出到 dist/。
# 為什麼要這一步：原型拆成 _seat.css / _seat.js 共用，用 file:// 直接點開會因為
# 同源政策抓不到那幾支；dist/ 這份是自帶一切的單檔，雙擊就能看。
# phone.html 的 iframe 也一併換成 srcdoc，整包只剩 Google Fonts 要連外。
import io, os, re, html
rd = lambda p: io.open(p, encoding="utf-8").read()
os.makedirs("dist", exist_ok=True)
page, seat, js = rd("_page.css"), rd("_seat.css"), rd("_seat.js")

def inline(src):
    s = rd(src)
    s = s.replace('<link rel="stylesheet" href="_page.css">', "<style>\n" + page + "\n</style>")
    s = s.replace('<link rel="stylesheet" href="_seat.css">', "<style>\n" + seat + "\n</style>")
    s = s.replace('<script src="_seat.js"></script>', "<script>\n" + js + "\n</script>")
    return s

table = inline("table.html")
out = {"index.html": inline("index.html"), "table.html": table}

phone = inline("phone.html")
def srcdoc(m):
    q = m.group(1)                      # table.html?k=…
    doc = table.replace("</head>", '<base href="about:blank">\n</head>', 1)
    # iframe 裡讀不到自己的網址列，所以把 ?k= 直接寫死成一個全域
    doc = doc.replace("const only = new URLSearchParams(location.search).get(\"k\");",
                      'const only = ' + repr(q.split("k=")[1]).replace("'", '"') + ';')
    return 'srcdoc="' + html.escape(doc, quote=True) + '"'
phone = re.sub(r'src="(table\.html\?k=[^"]+)"', srcdoc, phone)
out["phone.html"] = phone

for n, s in out.items():
    io.open("dist/" + n, "w", encoding="utf-8").write(s)
    print("dist/%-12s %7d" % (n, len(s)))
