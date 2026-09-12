import subprocess, sys, os, time, threading
CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
def shot(name, q, w=1440, h=900, budget=16000, wait=110):
    if '@' in name: name, wh = name.split('@'); w, h = map(int, wh.split('x'))
    png = f"{name}.png"
    if os.path.exists(png): os.remove(png)
    log = open(f"{name}.log", "w")
    p = subprocess.Popen([CH, "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
        "--hide-scrollbars", f"--window-size={w},{h}", f"--virtual-time-budget={budget}", f"--user-data-dir=/tmp/ud-shot-{name}",
        "--enable-logging=stderr", "--v=0", f"--screenshot={png}", (q if q.startswith("http") else f"http://127.0.0.1:8769/study3.html?{q}")], stdout=log, stderr=log)
    t0 = time.time()
    while time.time() - t0 < wait:
        if os.path.exists(png) and os.path.getsize(png) > 1000 and p.poll() is not None: break
        if os.path.exists(png) and os.path.getsize(png) > 1000:
            time.sleep(1.5); break
        time.sleep(.5)
    if p.poll() is None: p.kill()
    log.close()
    print(name, "ok" if os.path.exists(png) else "MISSING", f"{time.time()-t0:.0f}s")
jobs = [a.split("=", 1) for a in sys.argv[1:]]
ths = [threading.Thread(target=shot, args=(n, q)) for n, q in jobs]
[t.start() for t in ths]; [t.join() for t in ths]
