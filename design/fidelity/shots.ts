// 截這一頁的四個預設：deno run -A shots.ts [埠]
// 無頭 Chrome + swiftshader，靠 CDP 點按鈕、等精算收斂、抓 console 錯誤。
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Deno.args[0] ?? "8791";
const W = 1600, H = 1000;
const profile = await Deno.makeTempDir({ prefix: "fid-" });
const proc = new Deno.Command(CHROME, { args: [
  "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--mute-audio", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
], stdout: "null", stderr: "null" }).spawn();

let ws = "";
for (let i = 0; i < 120 && !ws; i++) {
  await new Promise((r) => setTimeout(r, 100));
  try { const [p, path] = (await Deno.readTextFile(`${profile}/DevToolsActivePort`)).trim().split("\n"); ws = `ws://127.0.0.1:${p}${path}`; } catch { /**/ }
}
const sock = new WebSocket(ws);
await new Promise((ok, no) => { sock.onopen = () => ok(0); sock.onerror = () => no(new Error("連不上")); });
let id = 0; const waits = new Map<number, (v: any) => void>(); const logs: string[] = [];
sock.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { waits.get(m.id)!(m); waits.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type))
    logs.push(m.params.type + ": " + m.params.args.map((a: any) => a.value ?? a.description ?? a.type).join(" "));
  if (m.method === "Runtime.exceptionThrown")
    logs.push("EXC: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") logs.push("LOG: " + m.params.entry.text);
};
let sid = "";
const send = (method: string, params: any = {}, s?: string) => new Promise<any>((ok) => { const i = ++id; waits.set(i, ok); sock.send(JSON.stringify({ id: i, method, params, sessionId: s })); });
const cdp = (m: string, p: any = {}) => send(m, p, sid);
const ev = async (expr: string) => (await cdp("Runtime.evaluate", { expression: `(function(){${expr.includes("return") ? expr : "return (" + expr + ")"}})()`, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const t = await send("Target.createTarget", { url: "about:blank" });
sid = (await send("Target.attachToTarget", { targetId: t.result.targetId, flatten: true })).result.sessionId;
await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Log.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });
await cdp("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html?t=${Date.now()}` });

for (let i = 0; i < 200; i++) { if (await ev(`!!document.querySelector('#pre button')`)) break; await sleep(150); }
await sleep(2500);

await Deno.mkdir("shots", { recursive: true });
async function grab(name: string, wait: number) {
  await sleep(wait);
  const r = await cdp("Page.captureScreenshot", { format: "png" });
  // 存 png，之後用 shrink.py 轉成 1800 寬的 jpg 進版控（原始 3200 寬一張 4 MB）
  await Deno.writeFile(`shots/${name}.png`, Uint8Array.from(atob(r.result.data), (c) => c.charCodeAt(0)));
  console.log(name, "ok", await ev(`document.getElementById('stat').textContent`));
}
const MODE = Deno.args[1] ?? "presets";
if (MODE === "presets") {
  for (const k of ["A", "B", "C", "D"]) {
    await ev(`document.querySelector('#pre button[data-k="${k}"]').click(); return 1`);
    await grab(k, k === "C" || k === "D" ? 9000 : 2200);
  }
} else if (MODE === "views") {
  for (const v of (Deno.args[2] ? Deno.args[2].split(",") : ["cards", "dice", "chair", "room"])) {
    for (const k of ["A", "D"]) {
      await ev(`document.querySelector('#view button[data-k="${v}"]').click(); document.querySelector('#pre button[data-k="${k}"]').click(); return 1`);
      await grab(`V-${v}-${k}`, k === "D" ? 9000 : 2200);
    }
  }
} else {
  // 一層一層單獨開，看每一層自己的貢獻
  const keys = await ev(`return [...document.querySelectorAll('#togs label')].map(l=>l.dataset.k)`) as string[];
  for (const k of keys) {
    await ev(`document.querySelector('#pre button[data-k="A"]').click(); return 1`);
    await sleep(500);
    await ev(`document.querySelector('#togs label[data-k="${k}"] input').click(); return 1`);
    await grab("L-" + k, k === "refine" ? 9000 : 2500);
  }
}
if (logs.length) { console.log("---- console ----"); for (const l of [...new Set(logs)].slice(0, 25)) console.log(l); }
else console.log("console 乾淨");
sock.close(); proc.kill(); await proc.status;
await Deno.remove(profile, { recursive: true }).catch(() => {});
