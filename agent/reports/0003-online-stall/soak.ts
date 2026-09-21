// 連線模式 soak：頁面裡放一個假伺服器，照真實時序（HTTP 回應 300ms、realtime 列 ~900ms 後再到一次、
// 每 700ms 一列 idle 心跳列）把一整場 21 局推完。我坐 2 號、不是 ticker（0 號是別的真人）。
// 每局量：heap、tweens、S.cards、S.dead、scene.children、DOM 節點、applyRow 平均耗時、長幀數；
// 並檢查立體桌上我的手牌最後是不是翻正、在手牌位。
//   deno run -A soak.ts [dim=3|2] [rounds=21] [late=0|1]
import { Browser } from "./_browser.ts";

const args = Object.fromEntries(Deno.args.map(a => a.split("=")));
const DIM = args.dim ?? "3";
const ROUNDS = +(args.rounds ?? 21);
const LATE = args.late ?? "1";      // 1：換局那一列先到、手牌 400ms 後才到（非 ticker 真實路徑）
const OUT = new URL("./out/", import.meta.url).pathname;
await Deno.mkdir(OUT, { recursive: true });

const b = await Browser.start({ gl: DIM === "3", hooks: true });
const SRV = `
window.__SRV = (function(){
  const E = UD.engine, T = UD.__t;
  const N = 3, ME = 2;
  const clone = x => JSON.parse(JSON.stringify(x));
  const S = {g:null, rev:0, calls:[], log:[], rounds:[], applyMs:[], longFrames:0, frames:0, lastT:0, fails:[], rt:0};
  T.MY.pid = "p" + ME;
  function row(){
    const g = S.g, seen = {};
    for(let i=0;i<N;i++) seen["p"+i] = Date.now();
    return clone({code:"SOAK", rev:S.rev, match:1, cfg:g.cfg, ladder:g.ladder,
      seats:g.seats.map((s,i)=>({name:"P"+i, kind:"human", pid:"p"+i, av:null})),
      phase:g.phase, ri:g.ri, hs:g.hs, starter:g.starter, trump:g.trump, trump_card:g.trumpCard,
      leader:g.leader, turn:g.turn, led:g.led, played:g.played, trick:g.trick, bids:g.bids, won:g.won,
      score:g.score, log:g.log, host_pid:"p0", seen:seen});
  }
  function bump(){ S.rev++; }
  /* realtime 那一列：沒有手牌 */
  function rt(delay){ const r = row(); setTimeout(()=>{ S.rt++; T.applyRow(r); }, delay == null ? 60 : delay); }
  /* 假伺服器：客端敲過來的 */
  window.__call = function(action, args){
    S.calls.push(action);
    const g = S.g;
    return new Promise(res => setTimeout(()=>{
      let ok = true;
      if(action === "bid"){ ok = E.applyBid(g, ME, args.v); if(ok){ bump(); rt(900); } }
      else if(action === "play"){ ok = E.applyPlay(g, ME, args.card); if(ok){ bump(); rt(900); } }
      else if(action === "state" || action === "tick" || action === "next"){ /* idle */ }
      else ok = false;
      if(!ok){ res({error:"nope"}); return; }
      const d = {ok:true, pid:"p"+ME, room:row(), hand:clone(g.hands[ME])};
      T.applyRow(d.room, d.hand);
      res(d);
    }, 300));
  };
  /* 別人（0、1 號）與節奏：像真的伺服器 tick 一樣自己走 */
  let dealAt = 0;
  function step(){
    const g = S.g; if(!g) return;
    const now = Date.now();
    if(g.phase === "bid"){
      const s = g.turn;
      if(s !== ME && now - g.at > 900){ E.applyBid(g, s, E.aiBid(g, s)); bump(); rt(); }
    }else if(g.phase === "play"){
      const s = g.turn;
      if(s !== ME && now - g.at > 700){ E.applyPlay(g, s, E.aiCard(g, s).id); bump(); rt(); }
    }else if(g.phase === "trickend"){
      if(now - g.at > UD.trickGap()){ E.resolveTrick(g); bump(); rt(); }
    }else if(g.phase === "roundend"){
      if(now - g.at > 2200){
        if(g.ri + 1 >= ROUNDS_LIMIT){ g.phase = "over"; g.at = now; bump(); rt(); return; }
        E.startRound(g); bump(); dealAt = now;
        S.rounds.push({ri:g.ri, hs:g.hs, at:now});
        /* 換局那一列：非 ticker 的人是從 realtime 收到的（沒有手牌），手牌要自己去要 */
        if(LATE){ rt(60); }
        else { const r = row(); setTimeout(()=>T.applyRow(r, clone(g.hands[ME])), 60); }
      }
    }
  }
  /* 我自己：輪到我就叫墩／出牌（照按鈕走） */
  function me(){
    const G = UD.G; if(!G || UD.MODE !== "net") return;
    if(G.phase === "bid" && G.turn === ME && G.bids[ME] === null){
      const btn = document.querySelector("[data-bid]:not([disabled])");
      if(btn) btn.click();
    }else if(G.phase === "play" && G.turn === ME && G.hands[ME] && G.hands[ME].length){
      const legal = UD.legalCards ? UD.legalCards(G.hands[ME], G.led) : null;
      const c = legal && legal.length ? legal[0] : G.hands[ME][0];
      const el = document.querySelector('#hand [data-card="' + c.id + '"]');
      if(el && !el.disabled) UD.doPlay(c.id, el);
    }
  }
  /* idle 心跳列：每 700ms 一列（別人的心跳、ticker 的 idle tick 都會讓 rooms 那一列重寫） */
  setInterval(()=>{ if(S.g && S.g.phase !== "over"){ const r = row(); S.rt++; T.applyRow(r); } }, 700);
  setInterval(step, 120);
  setInterval(me, 250);
  /* 量 applyRow 耗時 */
  const realApply = T.applyRow;
  T.applyRow = function(r, h){ const t0 = performance.now(); const v = realApply(r, h); S.applyMs.push(performance.now() - t0); return v; };
  /* 長幀 */
  (function raf(t){ if(S.lastT && t - S.lastT > 120) S.longFrames++; S.frames++; S.lastT = t; requestAnimationFrame(raf); })(performance.now());
  let ROUNDS_LIMIT = 21;
  return {
    S,
    start(limit){
      ROUNDS_LIMIT = limit || 21;
      const g = E.newGame({n:N});
      for(let i=0;i<N;i++) g.seats[i] = {name:"P"+i, kind:"human", cid:"p"+i, av:null};
      g.host = "p0";
      S.g = g;
      E.startRound(g); bump(); dealAt = Date.now();
      S.rounds.push({ri:g.ri, hs:g.hs, at:Date.now()});
      const r = row();
      T.applyRow(r, clone(g.hands[ME]));   /* 第一局是 join 回來的，帶手牌 */
      return 1;
    },
    /* 現在的量測 */
    probe(){
      const m = performance.memory ? performance.memory.usedJSHeapSize : 0;
      const d3 = UD.__3d ? UD.__3d() : null;
      const S3 = d3 && d3.S;
      const my = [];
      if(S3){
        const ri = UD.G.ri;
        for(const c of S3.cards.values()){
          if(c.key.indexOf("c:" + ri + ":") === 0 && c.slot.indexOf("hand:") === 0)
            my.push({key:c.key, flip:+c.t.flip.toFixed(3), rx:+c.t.rx.toFixed(3), y:+c.t.y.toFixed(3), slot:c.slot});
        }
      }
      const avg = S.applyMs.length ? S.applyMs.reduce((a,b)=>a+b,0) / S.applyMs.length : 0;
      const mx = S.applyMs.length ? Math.max.apply(null, S.applyMs) : 0;
      const out = {
        ri:UD.G.ri, phase:UD.G.phase, rev:UD.G.rev, heapMB:+(m/1048576).toFixed(1),
        tweens:d3 ? d3.tweens.length : -1, cards:S3 ? S3.cards.size : -1, dead:S3 ? S3.dead.length : -1,
        scene:S3 ? S3.scene.children.length : -1, dom:document.getElementsByTagName("*").length,
        geo:S3 ? S3.r.info.memory.geometries : -1, tex:S3 ? S3.r.info.memory.textures : -1,
        progs:S3 ? S3.r.info.programs.length : -1,
        applyN:S.applyMs.length, applyAvg:+avg.toFixed(2), applyMax:+mx.toFixed(1),
        longFrames:S.longFrames, frames:S.frames, rt:S.rt, calls:S.calls.length,
        busy:T.NET.busy, queued:T.NET.queued, myHand:(UD.G.hands[ME]||[]).length, my3d:my,
        fx: UD.fx ? UD.fx() : null
      };
      S.applyMs = []; S.longFrames = 0; S.frames = 0;
      return out;
    }
  };
})(); return 1;`;

const rows: Record<string, unknown>[] = [];
try {
  await b.open(`?lang=zh&dim=${DIM}&hold=300`);
  if (DIM === "3") {
    await b.until(`return !!(UD.dim && UD.dim() && document.body.classList.contains("is3d") && UD.__3d)`, "立體牌桌起來", 30000);
  }
  await b.eval(SRV);
  await b.eval(`__SRV.start(${ROUNDS}); return 1`);
  await b.until(`return document.getElementById("lobby").hidden || UD.MODE === "net"`, "進連線模式", 5000);
  await b.eval(`document.body.classList.remove("in-lobby"); document.getElementById("lobby").hidden = true; if(UD.onShow) UD.onShow(); return 1`);
  // 每局：等到叫墩階段開始 + 6 秒（發牌演完），量一次
  let lastRi = -1;
  const t0 = Date.now();
  for (;;) {
    const st = await b.eval<{ ri: number; phase: string; n: number }>(`return {ri:UD.G.ri, phase:UD.G.phase, n:__SRV.S.rounds.length}`);
    if (st.phase === "over") break;
    if (st.ri !== lastRi && st.phase !== "roundend") {
      lastRi = st.ri;
      await new Promise((r) => setTimeout(r, 6500));
      const p = await b.eval<Record<string, unknown>>(`return __SRV.probe()`);
      rows.push(p);
      const my = p.my3d as { flip: number; rx: number }[];
      const bad = DIM === "3" && my.some((c) => Math.abs(c.flip) > 0.05 || Math.abs(c.rx + 1.04) > 0.05);
      const line = `ri=${p.ri} hs=${(p as { myHand: number }).myHand} heap=${p.heapMB}MB tweens=${p.tweens} cards=${p.cards} dead=${p.dead} scene=${p.scene} dom=${p.dom} geo=${p.geo} tex=${p.tex} progs=${p.progs} apply=${p.applyN}x avg ${p.applyAvg}ms max ${p.applyMax}ms long=${p.longFrames}/${p.frames} busy=${p.busy} q=${p.queued}${bad ? "  ⚠️ 手牌沒翻正/不在手牌位" : ""}`;
      console.log(line);
      if (bad) {
        console.log("   my3d=" + JSON.stringify(my));
        const shot = await b.cdp("Page.captureScreenshot", { format: "png" }) as { data: string };
        await Deno.writeFile(`${OUT}/bad-ri${p.ri}.png`, Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)));
      }
    }
    if (Date.now() - t0 > 25 * 60 * 1000) { console.log("超時"); break; }
    await new Promise((r) => setTimeout(r, 300));
  }
  const shot = await b.cdp("Page.captureScreenshot", { format: "png" }) as { data: string };
  await Deno.writeFile(`${OUT}/final-dim${DIM}.png`, Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)));
  await Deno.writeTextFile(`${OUT}/soak-dim${DIM}-late${LATE}.json`, JSON.stringify(rows, null, 1));
  console.log(`完成 ${rows.length} 局，${((Date.now() - t0) / 1000).toFixed(0)}s`);
} catch (e) {
  console.error("失敗：", e);
  try {
    const shot = await b.cdp("Page.captureScreenshot", { format: "png" }) as { data: string };
    await Deno.writeFile(`${OUT}/error-dim${DIM}.png`, Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)));
  } catch { /* ignore */ }
} finally {
  await b.close();
}
