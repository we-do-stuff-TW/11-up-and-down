# headless 截圖。用法：python3 shot.py shots/a=a.html shots/b10=b.html?n=10
# 手機寬度不要用 --window-size=390：Chrome 會夾到最小 500px，媒體查詢不會觸發。
# 要看手機就開 phone.html（裡面是幾個 390 寬的 iframe，iframe 有自己的 viewport）。
import subprocess, sys, os, time, threading
CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = int(__import__("os").environ.get("PORT", 8771))
def shot(name, q, w=1440, h=900, budget=20000, wait=90):
    if '@' in name: name, wh = name.split('@'); w, h = map(int, wh.split('x'))
    png = f"{name}.png"
    os.makedirs(os.path.dirname(png) or ".", exist_ok=True)
    if os.path.exists(png): os.remove(png)
    log = open(f"{name}.log", "w")
    url = q if q.startswith("http") else f"http://127.0.0.1:{PORT}/{q}"
    p = subprocess.Popen([CH, "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", f"--window-size={w},{h}",
        f"--virtual-time-budget={budget}", f"--user-data-dir=/tmp/ud-seat-{os.path.basename(name)}",
        f"--screenshot={png}", url], stdout=log, stderr=log)
    t0 = time.time()
    while time.time() - t0 < wait:
        if os.path.exists(png) and os.path.getsize(png) > 1000 and p.poll() is not None: break
        if os.path.exists(png) and os.path.getsize(png) > 1000: time.sleep(1.2); break
        time.sleep(.4)
    if p.poll() is None: p.kill()
    log.close(); os.remove(f"{name}.log")
    print(name, "ok" if os.path.exists(png) else "MISSING", f"{time.time()-t0:.0f}s")
jobs = [a.split("=", 1) for a in sys.argv[1:]]
ths = [threading.Thread(target=shot, args=(n, q)) for n, q in jobs]
[t.start() for t in ths]; [t.join() for t in ths]
