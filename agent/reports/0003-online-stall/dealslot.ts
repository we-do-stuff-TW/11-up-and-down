// 重現「我的手牌停在發牌中繼站（dealSlot）」的畫面：3 人、我坐 2 號、第 16 局 5 張、叫墩中。
// 做法：換局那一刻把我手牌上「拿起來翻正」那一段（to.flip===0）的補間拿掉，牌就會停在落桌的位置。
import { Browser } from "./_browser.ts";
const OUT = new URL("./out/", import.meta.url).pathname;
const b = await Browser.start({ gl: true, hooks: true });
try {
  await b.open(`?lang=zh&dim=3&hold=300`);
  await b.until(`return !!(UD.dim && UD.dim() && document.body.classList.contains("is3d") && UD.__3d)`, "立體牌桌起來", 30000);
  await b.eval(`
    const E = UD.engine, T = UD.__t, N = 3, ME = 2;
    const clone = x => JSON.parse(JSON.stringify(x));
    T.MY.pid = "p" + ME;
    const g = E.newGame({n:N});
    for(let i=0;i<N;i++) g.seats[i] = {name:["WeiYu","于子傑","Francis"][i], kind:"human", cid:"p"+i, av:null};
    g.host = "p0";
    for(let i=0;i<16;i++) E.startRound(g);   /* 先停在第 16 局，桌子先擺好 */
    window.__g = g;
    const row = (rev) => clone({code:"3CGE", rev, match:1, cfg:g.cfg, ladder:g.ladder,
      seats:g.seats.map((s,i)=>({name:s.name, kind:"human", pid:"p"+i, av:null})),
      phase:g.phase, ri:g.ri, hs:g.hs, starter:g.starter, trump:g.trump, trump_card:g.trumpCard,
      leader:g.leader, turn:g.turn, led:g.led, played:g.played, trick:g.trick, bids:g.bids, won:g.won,
      score:g.score, log:g.log, host_pid:"p0", seen:{p0:Date.now(),p1:Date.now(),p2:Date.now()}});
    window.__call = () => new Promise(()=>{});
    window.__row = row;
    T.applyRow(row(1), clone(g.hands[ME]));
    document.body.classList.remove("in-lobby"); document.getElementById("lobby").hidden = true; if(UD.onShow) UD.onShow();
    return UD.G.ri + ":" + UD.G.hs + ":" + UD.G.phase + ":" + UD.mySeat();
  `).then((r) => console.log("state", r));
  await b.until(`const d = UD.__3d(); return !!(d.S && d.S.round === 15)`, "第一局擺好", 90000);
  await new Promise((r) => setTimeout(r, 2500));   /* 桌子擺好、停下來 */
  await b.eval(`
    const {S, tweens} = UD.__3d();
    window.__cuts = [];
    const real = Array.prototype.splice;
    tweens.splice = function(i, n){
      for(let k = i; k < i + (n || 0) && k < this.length; k++){
        const w = this[k];
        if(!w || !w.to || w.to.flip !== 0 || w.from) continue;
        let card = null; for(const c of S.cards.values()) if(c.t === w.target) card = c;
        if(card && card.slot.indexOf("hand:") === 0)
          window.__cuts.push({t:Math.round(performance.now()), key:card.key, slot:card.slot, in:Math.round(w.t0 - performance.now()), stack:new Error().stack.split(String.fromCharCode(10)).slice(2, 7).map(s => s.trim()).join(" | ")});
      }
      return real.apply(this, arguments);
    };
    return 1;`);
  await b.eval(`
    const E = UD.engine, T = UD.__t, g = window.__g, ME = 2;
    E.startRound(g);                                 /* 換到第 17 局：5 張，真的發牌動畫 */
    E.applyBid(g, g.turn, 2); E.applyBid(g, g.turn, 1);
    T.applyRow(window.__row(2), JSON.parse(JSON.stringify(g.hands[ME])));
    return UD.G.ri + ":" + UD.G.hs + ":" + UD.G.phase;
  `).then((r) => console.log("state2", r));
  for (let k = 0; k < 4; k++) {
    const dump = await b.eval(`
      const {S, tweens} = UD.__3d(); const now = performance.now();
      const my = []; for(const c of S.cards.values()) if(c.slot.indexOf("hand:") === 0 || c.key.indexOf("c:16:") === 0) my.push(c);
      return {snap:S.snap, round:S.round, n:tweens.length, hand:my.length,
        list: my.slice(0,2).map(c => ({key:c.key, slot:c.slot, flip:+c.t.flip.toFixed(2), rx:+c.t.rx.toFixed(2), z:+c.t.z.toFixed(2),
          tw: tweens.filter(w => w.target === c.t).map(w => ({to:Object.keys(w.to).join(""), flip:w.to.flip, in:Math.round(w.t0 - now), dur:w.dur, from:!!w.from}))}))};`);
    console.log(k, JSON.stringify(dump));
    await new Promise((r) => setTimeout(r, 700));
  }
  const cuts = await b.eval(`return window.__cuts`);
  console.log("CUTS", JSON.stringify(cuts, null, 1));
  await new Promise((r) => setTimeout(r, 9000));   /* 發牌演完（含拿起來翻正） */
  const st = await b.eval(`
    const {S, tweens} = UD.__3d();
    const my = []; for(const c of S.cards.values()) if(c.slot.indexOf("hand:") === 0) my.push({flip:+c.t.flip.toFixed(2), rx:+c.t.rx.toFixed(2), z:+c.t.z.toFixed(2)});
    return {tweens:tweens.length, my};`);
  console.log("RESULT", JSON.stringify(st));
  const shot = await b.cdp("Page.captureScreenshot", { format: "png" }) as { data: string };
  await Deno.writeFile(`${OUT}/${Deno.args[0] || "dealslot"}.png`, Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)));
  console.log("寫出", `${OUT}/${Deno.args[0] || "dealslot"}.png`);
} catch (e) {
  console.error("失敗：", e);
} finally {
  await b.close();
}
