// 牌桌收乾淨的樣品截圖：立體牌桌上「別人的牌、牌庫、王牌、檯面那一墩、贏的墩、骰子」一起縮小，
// 我的手牌不動（Francis 10-09：「牌桌太亂太雜，撲克牌等等需要大幅縮小，手牌不必」）。
//
// docs/index.html 一個字都不改：開頁時在記憶體裡把那份 HTML 打上 PATCHES，再端給無頭 Chrome。
// 每一條補丁都要在原檔裡剛好找到一次，找不到或找到兩次就整支停下來——原檔改過了，樣品就不准照舊拍。
//
//   deno run -A design/table/tidy.ts K=0.55 view=iphone        # K＝桌上東西縮成幾倍，1＝現在
//   deno run -A design/table/tidy.ts K=0.55 KD=0.7 view=ipad   # KD＝骰子另外縮（預設跟 K 一樣）
//
// 拍兩個時刻：叫墩（前兩家叫過、輪到我）、出牌（大家叫完、打了一墩、這一墩三家出過、輪到我）。
// 輸出到 design/table/tidy/<view>-<bid|play>-k<K>.png
//
// ⚠️ 10-09 他挑了「手機七成」，已寫進 docs/index.html（PHONE_TABLE_S）。下面的補丁是對著改之前那份寫的，
// 現在會在第一條就停下來——之後只剩 real=1（拍遊戲現在的樣子）能用：
//   deno run -A design/table/tidy.ts real=1 view=iphone [n=10] [w=760] [anim=1]
// anim=1 另外拍收墩與下一局發牌途中的幾格

const HERE = new URL("./", import.meta.url);
const REPO = new URL("../../", import.meta.url);
const arg = (k: string, d: string) => (Deno.args.find((a) => a.startsWith(k + "=")) ?? `${k}=${d}`).split("=")[1];
const K = Number(arg("K", "1")), KD = Number(arg("KD", String(K)));
const n = Number(arg("n", "6")), ri = Number(arg("ri", "5")), view = arg("view", "iphone");
/* sw/sh＝整台裝置的螢幕（遊戲用它分手機與否，見 isPhone），w/h＝視窗。mac-narrow 是電腦把視窗拉窄，不該當成手機 */
const VIEWS: Record<string, { w: number; h: number; sw: number; sh: number; mobile: boolean }> = {
  iphone: { w: Number(arg("w", "390")), h: 844, sw: 390, sh: 844, mobile: true },
  "iphone-land": { w: 844, h: 390, sw: 844, sh: 390, mobile: true },
  ipad: { w: 820, h: 1180, sw: 820, sh: 1180, mobile: true },
  "ipad-mini": { w: 744, h: 1133, sw: 744, sh: 1133, mobile: true },
  mac: { w: 1440, h: 860, sw: 1440, sh: 900, mobile: false },
  "mac-narrow": { w: 560, h: 860, sw: 1440, sh: 900, mobile: false },
};
const VW = VIEWS[view];
if (!VW) throw new Error("view 只有：" + Object.keys(VIEWS).join("、"));
const tight = arg("tight", "0") === "1";   // 檯面那一墩的半徑也跟著縮：牌小了，一墩才聚得成一墩
const tag = (arg("real", "0") === "1" ? "real" : `k${K}` + (KD !== K ? `d${KD}` : "") + (tight ? "t" : "")) +
  (ri !== 5 ? `-r${ri}` : "") + (n !== 6 ? `-n${n}` : "") + (VW.w !== 390 && view === "iphone" ? `-w${VW.w}` : "");

/* [找這一段, 換成這一段]。TABLE_S／DICE_S 是樣品才有的兩個常數，宣告在第一條 */
const PATCHES: [string, string][] = [
  ["const R_SEAT = 4.32, R_PLAY = 1.06, R_FAN = 3.16, R_DECK = 3.66;",
   `const R_SEAT = 4.32, R_PLAY = 1.06, R_FAN = 3.16, R_DECK = 3.66;\nconst TABLE_S = ${K}, DICE_S = ${KD};`],
  // 贏的墩
  ["const R_PILE = 2.42, PILE_S = .70, PILE_SMIN = .46,", "const R_PILE = 2.42, PILE_S = .70 * TABLE_S, PILE_SMIN = .46 * TABLE_S,"],
  // 檯面那一墩
  ["(((i * 37) % 9) - 4) * .014, rz:0, flip:0, s:1};", "(((i * 37) % 9) - 4) * .014, rz:0, flip:0, s:TABLE_S};"],
  // 別人手上的牌：張數多寡照縮，間距也照縮
  ["const room = Math.max(.12, Math.min(gapL(i), gapR(i)) * R_FAN - 1.0);",
   "const room = Math.max(.12, Math.min(gapL(i), gapR(i)) * R_FAN - 1.0 * TABLE_S);"],
  ["const dx = Math.min(.19, 1.45 / Math.max(n, 1), room / Math.max(n - 1, 1));",
   "const dx = Math.min(.19 * TABLE_S, 1.45 * TABLE_S / Math.max(n, 1), room / Math.max(n - 1, 1));"],
  ["ry:a + off * .13, rz:0, flip:Math.PI, s:.74};", "ry:a + off * .13, rz:0, flip:Math.PI, s:.74 * TABLE_S};"],
  // 發牌時先落在我面前桌上的那一疊
  ["const step = Math.min(.20, 1.7 / Math.max(1, n));", "const step = Math.min(.20, 1.7 / Math.max(1, n)) * TABLE_S;"],
  ["ry:a + (k - (n - 1) / 2) * .045, rz:0, flip:Math.PI, s:1};", "ry:a + (k - (n - 1) / 2) * .045, rz:0, flip:Math.PI, s:TABLE_S};"],
  // 牌庫、王牌
  ["ry:d.ry, rz:0, flip:Math.PI, s:1};", "ry:d.ry, rz:0, flip:Math.PI, s:TABLE_S};"],
  ["ry:ds.ry + jit(k, 3) * .022, rz:0, flip:Math.PI, s:1}", "ry:ds.ry + jit(k, 3) * .022, rz:0, flip:Math.PI, s:TABLE_S}"],
  ["z:ds.z, rx:-Math.PI/2, ry:ds.ry, rz:0, s:1};", "z:ds.z, rx:-Math.PI/2, ry:ds.ry, rz:0, s:TABLE_S};"],
  ["kill(c, {x:ds.x, y:Y0 + THICK/2 + stack * THICK, z:ds.z, rx:-Math.PI/2, ry:ds.ry, rz:0, flip:Math.PI, s:1},",
   "kill(c, {x:ds.x, y:Y0 + THICK/2 + stack * THICK, z:ds.z, rx:-Math.PI/2, ry:ds.ry, rz:0, flip:Math.PI, s:TABLE_S},"],
  // 出牌飛出來、收墩聚成一疊
  ["f.s = .96; return f;", "f.s = .96 * TABLE_S; return f;"],
  ["(((k * 53) % 11) - 5) * .028, rz:0, flip:0, s:1};", "(((k * 53) % 11) - 5) * .028, rz:0, flip:0, s:TABLE_S};"],
  ["else from = {x:0, y:Y0 + .22, z:.03, rx:-Math.PI/2, ry:0, rz:0, flip:Math.PI, s:1};",
   "else from = {x:0, y:Y0 + .22, z:.03, rx:-Math.PI/2, ry:0, rz:0, flip:Math.PI, s:TABLE_S};"],
  ...(tight ? [["const p = polarR(Math.max(R_PLAY, .72 / (Math.PI * 2 / n)), a);",
                 "const p = polarR(Math.max(R_PLAY * TABLE_S, .72 * TABLE_S / (Math.PI * 2 / n)), a);"]] as [string, string][] : []),
  // 骰子：邊長、圓角、兩顆並排的間距
  ["const DIE_A = .34, DIE_R = .075;", "const DIE_A = .34 * DICE_S, DIE_R = .075 * DICE_S;"],
  ["const off = (j - (cnt - 1) / 2) * .40;", "const off = (j - (cnt - 1) / 2) * .40 * DICE_S;"],
  ["const off = two ? (k ? .22 : -.22) : 0;", "const off = two ? (k ? .22 : -.22) * DICE_S : 0;"],
];
/* real=1：不打補丁，拍 docs/index.html 現在的樣子（10-09 手機七成已寫進遊戲，之後驗收用這個） */
const real = arg("real", "0") === "1";
function patch(html: string): string {
  if (real) return html;
  for (const [from, to] of PATCHES) {
    const hits = html.split(from).length - 1;
    if (hits !== 1) throw new Error(`補丁對不上（找到 ${hits} 次）：${from}`);
    html = html.replace(from, to);
  }
  return html;
}

/* 測試用的瀏覽器照 scripts/_browser.ts 那一份，只多一個口子讓上面的補丁進得去。
   不另存一份拷貝：每次跑都現讀、現改、寫進暫存檔 */
let src = await Deno.readTextFile(new URL("scripts/_browser.ts", REPO));
const seams: [string, string][] = [
  [`const ROOT = new URL("../", import.meta.url);`, `const ROOT = new URL(${JSON.stringify(REPO.href)});`],
  [`  const types: Record<string, string> = {`,
   `  html = ((globalThis as any).__PATCH ?? ((h: string) => h))(html);\n  const types: Record<string, string> = {`],
];
for (const [a, b] of seams) {
  if (!src.includes(a)) throw new Error("scripts/_browser.ts 改過了，找不到：" + a);
  src = src.replace(a, b);
}
const tmp = await Deno.makeTempFile({ suffix: ".ts" });
await Deno.writeTextFile(tmp, src);
(globalThis as any).__PATCH = patch;
const { Browser } = await import("file://" + tmp);

const OUT = new URL("tidy/", HERE);
await Deno.mkdir(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SETUP = `
window.__T = {
  /* 固定種子：每個 K 拍到的是同一副牌、同一墩，對照圖才比得出只有大小不同。
     洗牌與電腦出牌之前各重設一次——中間那幾秒骰子動畫也會抽亂數，抽幾次跟畫面幀數有關 */
  seed(a){ Math.random = function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; },
  base(n, ri){
    this.seed(20261009);
    const E = UD.engine; const g = E.newGame({n:n}); for(let i=0;i<ri;i++) E.startRound(g); this.g = g; },
  row(rev){
    const g = this.g, now = Date.now(), seen = {};
    const names = ["Francis","WeiYu","Tom","阿明","Kelly","小美","Ben","Ivy","Leo","Amy"];
    const seats = g.seats.map(function(s, i){ const pid = i === 0 ? "me" : "p" + i; seen[pid] = now;
      return {name:names[i], kind:"human", pid:pid, av:null}; });
    return JSON.parse(JSON.stringify({
      code:"5527", rev:rev, cfg:g.cfg, ladder:g.ladder, seats:seats,
      phase:g.phase, ri:g.ri, hs:g.hs, starter:g.starter, trump:g.trump, trump_card:g.trumpCard,
      leader:g.leader, turn:g.turn, led:g.led, played:g.played, trick:g.trick||[], bids:g.bids, won:g.won,
      score:g.score, log:g.log, host_pid:"me", seen:seen, match:1
    }));
  },
  install(){
    UD.__t.MY.pid = "me";
    document.body.classList.remove("in-lobby"); document.getElementById("lobby").hidden = true; if(UD.onShow) UD.onShow();
    window.__call = function(){ return new Promise(function(){}); };
  }
};
return 1;`;
const shot = async (b: any, name: string) => {
  const s = await b.cdp("Page.captureScreenshot", { format: "png" }) as { data: string };
  await Deno.writeFile(new URL(`${view}-${name}-${tag}.png`, OUT), Uint8Array.from(atob(s.data), (c) => c.charCodeAt(0)));
};
const b = await Browser.start({ hooks: true, gl: true });
try {
  await b.open(`?lang=zh&dim=3&hold=1`);
  await b.cdp("Emulation.setDeviceMetricsOverride", { width: VW.w, height: VW.h, deviceScaleFactor: 2, mobile: VW.mobile,
    screenWidth: VW.sw, screenHeight: VW.sh });
  console.log("screen", await b.eval(`return screen.width + "x" + screen.height`));
  await b.until(`return !!(UD.dim && UD.dim() && UD.sync3d && document.body.classList.contains("is3d"))`, "立體牌桌起來", 40000);
  await b.eval(SETUP);
  await b.eval(`__T.install(); __T.base(${n}, ${ri}); const g=__T.g; g.phase="bid"; g.bids=Array(${n}).fill(null);
    g.starter=${n}-2; g.leader=g.starter; g.bids[${n}-2]=2; g.bids[${n}-1]=1; g.turn=0;
    UD.__t.applyRow(__T.row(20), JSON.parse(JSON.stringify(g.hands[0]))); return 1`);
  /* anim=1：發牌途中、收墩途中各拍幾格，看縮小後的東西在動的時候有沒有穿幫 */
  const anim = arg("anim", "0") === "1";
  await sleep(6000);
  await shot(b, "bid");
  const r = await b.eval(`__T.seed(1009); const E=UD.engine, g=__T.g; for(let i=0;i<${n};i++){ if(g.bids[i]==null) g.bids[i]=(i%3); }
    g.phase="play"; g.turn=g.leader;
    let guard=0; while(guard++<400){
      if(g.phase==="trickend"){ E.resolveTrick(g); continue; }
      if(g.phase!=="play") break;
      if(g.turn===0 && g.played>=1 && g.trick.length>=3) break;
      const c=E.aiCard(g,g.turn); E.applyPlay(g,g.turn,c.id); }
    UD.__t.applyRow(__T.row(40), JSON.parse(JSON.stringify(g.hands[0]))); return g.turn+"/"+(g.trick||[]).length`);
  await sleep(6000);
  await shot(b, "play");
  if (anim) {
    /* 這一墩打完、還沒收：引擎停在 trickend，桌上演「贏的那張亮金線 → 聚成一疊 → 飛向贏家」 */
    await b.eval(`const E=UD.engine, g=__T.g; let guard=0;
      while(guard++<40 && g.phase==="play"){ const c=E.aiCard(g,g.turn); E.applyPlay(g,g.turn,c.id); }
      UD.__t.applyRow(__T.row(60), JSON.parse(JSON.stringify(g.hands[0]))); return g.phase`);
    let t = 0;
    for (const ms of [400, 1300, 2200, 3200]) { await sleep(ms - t); t = ms; await shot(b, `gather${ms}`); }
    /* 發牌只在「換局」那一刻演：第一次擺上桌（人數從預設變成 6）會 relayout、直接定位不演，所以要接著開下一局才看得到 */
    await sleep(3000);
    await b.eval(`const E=UD.engine, g=__T.g; E.startRound(g); g.bids=Array(g.cfg.n).fill(null); g.turn=g.starter;
      UD.__t.applyRow(__T.row(80), JSON.parse(JSON.stringify(g.hands[0]))); return g.ri`);
    t = 0;
    for (const ms of [250, 600, 1000, 1500, 2200, 3200]) { await sleep(ms - t); t = ms; await shot(b, `deal${ms}`); }
  }
  console.log("ok", view, tag, "play state", r);
} finally { await b.close(); }
