import io,glob,re,sys
rd=lambda p: io.open(p,encoding="utf-8").read()
head,tokens,base,pips,back=rd("_head.html"),rd("_tokens.css"),rd("_base.css"),rd("_pips.svg"),rd("_back.html")
av=rd("_av.txt").strip()
for f in (sys.argv[1:] or sorted(glob.glob("[abc].def"))):
    src=rd(f); name=f[:-4]
    title=re.search(r"/\*\s*TITLE:\s*(.+?)\s*\*/",src).group(1)
    css,html=src.split("/*==HTML==*/")
    out=(head.replace("__TITLE__",title).replace("__TOKENS__",tokens+"\n"+base)
         +css+"\n</style>\n</head>\n<body>\n"+pips+back+html+"\n</body>\n</html>\n")
    out=out.replace("__AV__",av)
    io.open(name+".html","w",encoding="utf-8").write(out)
    print("%-9s %-26s %6d" % (name+".html",title,len(out)))
