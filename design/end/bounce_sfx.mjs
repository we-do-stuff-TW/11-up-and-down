import {spawn} from "node:child_process";
import http from "node:http";
import fs from "node:fs";
const CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = process.argv[2], outFile = process.argv[3];
const PORT = 9300 + Math.floor(Math.random() * 600);   /* 每次隨機一個埠：同時開好幾個 session 的時候不會撞 */
const ch = spawn(CH, ["--headless=new","--remote-debugging-port=" + PORT,"--user-data-dir=/tmp/ud-cdp-gag-" + PORT,"--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--autoplay-policy=no-user-gesture-required","about:blank"], {stdio:"ignore"});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res, rej) => http.get(u, r => { let s=""; r.on("data", d => s += d); r.on("end", () => res(JSON.parse(s))); }).on("error", rej));
try{
  let targets; for(let i=0;i<20;i++){ try{ targets = await getJSON("http://127.0.0.1:" + PORT + "/json"); break; }catch(e){ await sleep(300); } }
  const page = targets.find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if(m.id && pending[m.id]){ pending[m.id](m); delete pending[m.id]; } };
  const send = (method, params) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({id:i, method, params})); });
  await send("Page.enable", {});
  await send("Page.navigate", {url});
  await sleep(2500);
  const expr = `(async()=>{
    if(!window.SFX || !SFX.gag || !window.TOM) return JSON.stringify({err:"no SFX/TOM", sfx:!!window.SFX, gag:!!(window.SFX&&SFX.gag), tom:!!window.TOM});
    const b = await SFX.bounce("gag", [TOM.B, 1, {pan1:0, pan2:-.35, pan3:.35}], TOM.TOTAL + 2);
    const L = b.getChannelData(0), R = b.getChannelData(1), win = Math.round(b.sampleRate * .02), rms = [];
    let peak = 0;
    for(let i = 0; i < L.length; i += win){ let s = 0, p = 0; for(let j = i; j < Math.min(L.length, i + win); j++){ const v = (L[j] + R[j]) / 2; s += v * v; p = Math.max(p, Math.abs(L[j]), Math.abs(R[j])); } rms.push(+Math.sqrt(s / win).toFixed(4)); peak = Math.max(peak, p); }
    return JSON.stringify({sr:b.sampleRate, win:.02, rms, peak, B:TOM.B, TOTAL:TOM.TOTAL});
  })()`;
  const r = await send("Runtime.evaluate", {expression:expr, awaitPromise:true, returnByValue:true});
  const val = r.result && r.result.result && r.result.result.value;
  fs.writeFileSync(outFile, val || JSON.stringify(r));
  console.log(val ? ("ok " + val.slice(0, 120)) : JSON.stringify(r).slice(0, 400));
  ws.close();
}finally{ ch.kill(); }
