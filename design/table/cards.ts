// 從真的遊戲（平面模式）把牌面截成透明底 PNG，給方向示意圖用——牌面是 Francis 說「一定要留」的那一套
import { Browser } from "/Users/lc/11 Up&Down/scripts/_browser.ts";
const OUT = decodeURIComponent(new URL("./_raw/", import.meta.url).pathname);  // 截出來的 PNG；再用 README 的 cwebp 那行轉進 cards/
const b = await Browser.start({ hooks: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const C = (s: number, r: number) => ({ s, r, id: `0-${s}-${r}` });
const hand = [C(0,13), C(1,10), C(1,7), C(2,12), C(3,9), C(0,5), C(3,14), C(2,4), C(1,13), C(0,9), C(3,6)];
const trick = [C(2,14), C(2,10), C(3,12)];
const trump = C(0,11);
try {
  await Deno.mkdir(OUT, { recursive: true });
  await b.open(`?lang=zh&dim=2&hold=1`);
  await b.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 2200, deviceScaleFactor: 3, mobile: false });
  const all = [...hand, ...trick, trump];
  // 用頁面自己的 cardHTML：從 2D 手牌那一區的渲染結果複製出來太繞，直接叫 UD 裡露出來的東西
  const has = await b.eval(`return typeof UD.cardHTML + "/" + Object.keys(UD).join(",")`);
  console.log(has);
  // 讓牌桌畫一手牌：單人模式下把我的手牌換掉後重畫
  await b.eval(`UD.__t.MY.pid="me"; document.body.classList.remove("in-lobby"); document.getElementById("lobby").hidden=true; if(UD.onShow) UD.onShow(); window.__call=function(){return new Promise(function(){})}; return 1`);
  const E = "UD.engine";
  await b.eval(`const E=${E}; const g=E.newGame({n:6}); E.startRound(g); E.startRound(g); E.startRound(g); E.startRound(g); E.startRound(g);
    g.hands[0]=${JSON.stringify(hand)}; g.phase="play"; g.bids=[1,0,2,1,1,0]; g.turn=0; g.leader=3;
    g.trick=${JSON.stringify(trick)}.map(function(c,i){return {p:3+i,card:c}}); g.led=2; g.trumpCard=${JSON.stringify(trump)}; g.trump=0; g.hs=11;
    const seats=g.seats.map(function(s,i){return {name:"P"+i,kind:"human",pid:i===0?"me":"p"+i,av:null}});
    const row={code:"5527",rev:30,cfg:g.cfg,ladder:g.ladder,seats:seats,phase:g.phase,ri:g.ri,hs:g.hs,starter:g.starter,trump:g.trump,trump_card:g.trumpCard,
      leader:g.leader,turn:g.turn,led:g.led,played:0,trick:g.trick,bids:g.bids,won:[0,0,0,0,0,0],score:[0,0,0,0,0,0],log:[],host_pid:"me",seen:{},match:1};
    UD.__t.applyRow(JSON.parse(JSON.stringify(row)), JSON.parse(JSON.stringify(g.hands[0]))); return 1`);
  await b.eval(`return Promise.resolve(UD.courtsReady()).then(function(){return 1})`);
  await sleep(2500);
  const n = await b.eval<number>(`return document.querySelectorAll(".card").length`);
  console.log("cards on page", n);
  // 每一張牌依 aria-label 複製一份，排在固定的容器裡，牌寬 240px
  const labels = await b.eval<string[]>(`
    const seen={}, out=[];
    const cap=document.createElement("div"); cap.id="cap";
    cap.style.cssText="position:fixed;left:0;top:0;z-index:2147483647;display:flex;flex-wrap:wrap;gap:40px;padding:30px;width:1560px;background:transparent;--cw:240px;--ch:336px";
    document.querySelectorAll(".card").forEach(function(el){
      const k=el.getAttribute("aria-label"); if(!k||seen[k]) return; seen[k]=1;
      const c=el.cloneNode(true); c.className=el.className.replace(/\\b(legal|is-dealt|trump-mark|lift|sel)\\b/g,""); c.removeAttribute("style");
      c.style.cssText="position:relative;transform:none;translate:none;rotate:none;opacity:1;filter:none;animation:none;margin:0";
      c.setAttribute("data-cap", k); cap.appendChild(c); out.push(k);
    });
    const bw=document.createElement("div"); bw.style.cssText="position:relative;width:240px;height:336px"; bw.setAttribute("data-cap","back");
    const bk=document.createElement("div"); bk.className="back"; bw.appendChild(bk); cap.appendChild(bw); out.push("back");
    document.body.appendChild(cap);
    return out;`);
  console.log(labels.join(" | "));
  await b.cdp("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  // 把頁面其他東西藏起來，只留容器
  await b.eval(`document.body.style.background="transparent"; document.documentElement.style.background="transparent";
    return 1`);
  await sleep(400);
  const boxes = await b.eval<{ k: string; x: number; y: number; w: number; h: number }[]>(`
    return Array.from(document.querySelectorAll("#cap [data-cap]")).map(function(e){ const r=e.getBoundingClientRect(); return {k:e.getAttribute("data-cap"),x:r.x,y:r.y,w:r.width,h:r.height}; })`);
  for (const bx of boxes) {
    const s = await b.cdp("Page.captureScreenshot", { format: "png", clip: { x: bx.x, y: bx.y, width: bx.w, height: bx.h, scale: 1 } }) as { data: string };
    const name = bx.k.replace(/[^\w一-鿿]+/g, "_");
    await Deno.writeFile(`${OUT}${name}.png`, Uint8Array.from(atob(s.data), (c) => c.charCodeAt(0)));
  }
  console.log("saved", boxes.length);
} finally { await b.close(); }
