// 用無頭 Chrome 開真正的牌桌，靠 CDP 驅動。engine_test 測的是規則，這裡測的是
// 「手指、事件、狀態收斂」那一層——那些非得有瀏覽器才驗得動。
//
// 這台機器沒有 Playwright，但 Node/Deno 內建 WebSocket，CDP 直接講就好。
//
// 頁面是原封不動的 docs/index.html，只插一個測試接縫：把 <head> 那道登入門禁關掉
// （不關的話會被轉去 login.html）。其餘一切照原樣跑——supabase-js 在離線環境載不進來，
// authBoot() 本來就會安靜地退回單人模式，那正好是我們要測的狀態。

const ROOT = new URL("../", import.meta.url);
const CHROME = Deno.env.get("CHROME") ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** 把 docs/ 端起來，index.html 換成插了接縫的那一份 */
async function serve(): Promise<{ port: number; stop: () => Promise<void> }> {
  const docs = new URL("docs/", ROOT);
  let html = await Deno.readTextFile(new URL("index.html", docs));
  // 接縫一：<head> 那道門禁不要把我們轉去 login.html
  const gate = "  if(has || returning) return;";
  // 接縫二：沒有 Google session 時 authBoot 會走 gotoLogin()，一樣會離開牌桌。
  //         這裡讓它什麼都不做，頁面就停在單人牌桌上——那正是要測的狀態。
  const bounce = "function gotoLogin(stale){\n  if(bouncing) return;";
  for (const [what, seam] of [["門禁", gate], ["gotoLogin", bounce]] as [string, string][]) {
    if (!html.includes(seam)) {
      throw new Error(`接縫插不進去：找不到${what}那一段（docs/index.html 改過了？）`);
    }
  }
  html = html.replace(gate, "  if(1) return;   /* 測試接縫：門禁關掉 */")
    .replace(bounce, "function gotoLogin(stale){\n  return;   /* 測試接縫：不跳走 */\n  if(bouncing) return;");

  const types: Record<string, string> = {
    html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css",
    svg: "image/svg+xml", json: "application/json", png: "image/png",
  };
  const srv = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const path = new URL(req.url).pathname;
    if (path === "/" || path === "/index.html") {
      return new Response(html, { headers: { "content-type": types.html } });
    }
    try {
      const body = await Deno.readFile(new URL("." + path, docs));
      const ext = path.split(".").pop() ?? "";
      return new Response(body, { headers: { "content-type": types[ext] ?? "text/plain" } });
    } catch {
      return new Response("404", { status: 404 });
    }
  });
  return { port: srv.addr.port, stop: () => srv.shutdown() };
}

type Msg = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string } };

export class Browser {
  #ws!: WebSocket;
  #id = 0;
  #waits = new Map<number, [(v: Record<string, unknown>) => void, (e: Error) => void]>();
  #proc!: Deno.ChildProcess;
  #profile!: string;
  #stopServer!: () => Promise<void>;
  port = 0;

  static async start(opts: { gl?: boolean } = {}): Promise<Browser> {
    const b = new Browser();
    const { port, stop } = await serve();
    b.port = port; b.#stopServer = stop;
    b.#profile = await Deno.makeTempDir({ prefix: "ud-test-" });
    const flags = [
      "--headless=new", "--no-first-run", "--no-default-browser-check",
      "--disable-extensions", "--disable-background-networking", "--mute-audio",
      "--remote-debugging-port=0", `--user-data-dir=${b.#profile}`,
      "--window-size=1200,860",
    ];
    // 立體模式要有 WebGL：軟體算就夠了，只是慢一點
    if (opts.gl) flags.push("--use-gl=angle", "--use-angle=swiftshader");
    b.#proc = new Deno.Command(CHROME, { args: flags, stdout: "null", stderr: "null" }).spawn();

    const portFile = `${b.#profile}/DevToolsActivePort`;
    let wsPath = "";
    for (let i = 0; i < 100 && !wsPath; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        const [p, path] = (await Deno.readTextFile(portFile)).trim().split("\n");
        wsPath = `ws://127.0.0.1:${p}${path}`;
      } catch { /* 還沒寫出來 */ }
    }
    if (!wsPath) throw new Error("Chrome 起不來（找不到 DevToolsActivePort）");

    b.#ws = new WebSocket(wsPath);
    await new Promise((res, rej) => {
      b.#ws.onopen = () => res(null);
      b.#ws.onerror = () => rej(new Error("連不上 Chrome 的除錯埠"));
    });
    b.#ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data) as Msg;
      if (m.id && b.#waits.has(m.id)) {
        const [ok, no] = b.#waits.get(m.id)!;
        b.#waits.delete(m.id);
        m.error ? no(new Error(m.error.message)) : ok(m.result ?? {});
      }
    };
    return b;
  }

  #send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    const id = ++this.#id;
    return new Promise<Record<string, unknown>>((ok, no) => {
      this.#waits.set(id, [ok, no]);
      this.#ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  #session = "";
  /** 開一個分頁、附上去、載入牌桌，等到程式準備好 */
  async open(query = ""): Promise<void> {
    const t = await this.#send("Target.createTarget", { url: "about:blank" });
    const a = await this.#send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
    this.#session = a.sessionId as string;
    await this.cdp("Page.enable");
    await this.cdp("Runtime.enable");
    await this.cdp("Page.navigate", { url: `http://127.0.0.1:${this.port}/index.html${query}` });
    await this.until("!!(window.UD && window.UD.engine)", "程式沒有起來");
  }

  cdp(method: string, params: Record<string, unknown> = {}) {
    return this.#send(method, params, this.#session);
  }

  /** 在頁面裡求值，回傳 JSON 化的結果 */
  async eval<T = unknown>(expr: string): Promise<T> {
    const r = await this.cdp("Runtime.evaluate", {
      expression: `(function(){ ${expr.includes("return") ? expr : "return (" + expr + ")"} })()`,
      returnByValue: true, awaitPromise: true,
    }) as { result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } };
    if (r.exceptionDetails) {
      throw new Error("頁面裡出錯：" + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    }
    return r.result.value;
  }

  /** 等某個條件成立（頁面裡求值），逾時就報出等的是什麼 */
  async until(expr: string, what: string, ms = 8000): Promise<void> {
    const t0 = Date.now();
    for (;;) {
      if (await this.eval<boolean>(expr)) return;
      if (Date.now() - t0 > ms) throw new Error(`等不到：${what}（${expr}）`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** 元素在畫面上的位置（中心點）；找不到回 null */
  box(sel: string) {
    return this.eval<{ x: number; y: number; w: number; h: number } | null>(
      `const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null;
       const r=e.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2, w:r.width, h:r.height};`,
    );
  }

  /* ── 手指 ── */
  async touchDown(x: number, y: number) {
    await this.cdp("Input.dispatchTouchEvent", {
      type: "touchStart", touchPoints: [{ x, y, id: 1 }],
    });
  }
  async touchMove(x: number, y: number) {
    await this.cdp("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x, y, id: 1 }],
    });
  }
  async touchUp(x: number, y: number) {
    await this.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  /** 完整的一指：按下、（可選）移動、放開 */
  async tap(x: number, y: number, o: { dx?: number; dy?: number; hold?: number } = {}) {
    await this.touchDown(x, y);
    if (o.hold) await new Promise((r) => setTimeout(r, o.hold));
    if (o.dx || o.dy) await this.touchMove(x + (o.dx ?? 0), y + (o.dy ?? 0));
    await this.touchUp(x + (o.dx ?? 0), y + (o.dy ?? 0));
  }
  /* ── 滑鼠：按下、移動、放開拆開來，才驗得到「按太久」「手指移開」那幾條 ── */
  press(x: number, y: number) {
    return this.cdp("Input.dispatchMouseEvent", {
      type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1,
    });
  }
  move(x: number, y: number) {
    return this.cdp("Input.dispatchMouseEvent", {
      type: "mouseMoved", x, y, button: "left", buttons: 1,
    });
  }
  release(x: number, y: number) {
    return this.cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0,
    });
  }
  /** 完整的一下：按下、（可選）移動或按住、放開 */
  async click(x: number, y: number, o: { dx?: number; dy?: number; hold?: number } = {}) {
    await this.press(x, y);
    if (o.hold) await new Promise((r) => setTimeout(r, o.hold));
    const x2 = x + (o.dx ?? 0), y2 = y + (o.dy ?? 0);
    if (o.dx || o.dy) await this.move(x2, y2);
    await this.release(x2, y2);
  }

  async close() {
    try { this.#ws.close(); } catch { /* ignore */ }
    try { this.#proc.kill(); await this.#proc.status; } catch { /* ignore */ }
    await this.#stopServer();
    try { await Deno.remove(this.#profile, { recursive: true }); } catch { /* ignore */ }
  }
}
