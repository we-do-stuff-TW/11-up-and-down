// 截圖：deno run -A shot.ts a-call.html [b-mahjong.html ...]
// 一律用 390×844（iPhone 直拿）、2 倍密度。headless 的視窗會被夾到最小 500 寬，所以不靠 --window-size，
// 改用 Emulation.setDeviceMetricsOverride（跟 scripts/ 的探針同一招）。輸出到 shots/<名字>.png
const CHROME = Deno.env.get("CHROME") ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HERE = new URL(".", import.meta.url);
const W = Number(Deno.env.get("W") ?? 390), H = Number(Deno.env.get("H") ?? 844);
const profile = await Deno.makeTempDir({ prefix: "ud-shot-" });
const proc = new Deno.Command(CHROME, { args: ["--headless=new", "--no-first-run", "--disable-extensions", "--remote-debugging-port=0",
  `--user-data-dir=${profile}`, "--allow-file-access-from-files", "--hide-scrollbars"], stdout: "null", stderr: "null" }).spawn();
let ws = "";
for (let i = 0; i < 100 && !ws; i++) {
  await new Promise((r) => setTimeout(r, 100));
  try { const [p, path] = (await Deno.readTextFile(`${profile}/DevToolsActivePort`)).trim().split("\n"); ws = `ws://127.0.0.1:${p}${path}`; } catch { /* 還沒 */ }
}
const sock = new WebSocket(ws);
await new Promise((r) => (sock.onopen = r));
let id = 0;
const waits = new Map<number, (v: Record<string, unknown>) => void>();
sock.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { waits.get(m.id)!(m.result ?? {}); waits.delete(m.id); } };
const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
  new Promise<Record<string, unknown>>((ok) => { const i = ++id; waits.set(i, ok); sock.send(JSON.stringify({ id: i, method, params, sessionId })); });
await Deno.mkdir(new URL("shots/", HERE), { recursive: true });
for (const f of Deno.args) {
  const t = await send("Target.createTarget", { url: "about:blank" });
  const a = await send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
  const s = a.sessionId as string;
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true }, s);
  await send("Page.enable", {}, s);
  await send("Page.navigate", { url: new URL(f, HERE).href }, s);
  await new Promise((r) => setTimeout(r, 1500));
  const shot = await send("Page.captureScreenshot", { format: "png" }, s) as { data: string };
  const out = new URL(`shots/${f.replace(/\.html.*$/, "")}${W !== 390 ? "@" + W : ""}.png`, HERE);
  await Deno.writeFile(out, Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)));
  console.log("shot", out.pathname);
}
sock.close(); proc.kill(); await proc.status;
await Deno.remove(profile, { recursive: true });
