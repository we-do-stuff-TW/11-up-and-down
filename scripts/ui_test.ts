// 11 Up & Down — 手指與畫面的測試
//
// 跑法：deno run -A scripts/ui_test.ts
//
// engine_test 測規則，這一支測「點下去會怎樣」：出牌的入口。
// 開的是真的牌桌（無頭 Chrome），只插兩個接縫把登入那關拿掉，其餘照原樣跑。
//
// 這裡的每一條都對應一個真的發生過的災情：牌是亮的卻點不動、按下與放開之間手牌被重畫、
// 按住不放算不算、手指滑開算不算。平面與立體共用同一份判斷（UD.tap），所以兩條路一起驗。

import { Browser } from "./_browser.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: unknown, msg: string) { checks++; if (!cond) fails.push(msg); }

type St = { phase: string; turn: number; me: number; hand: number; ri: number; bids: number };
const b = await Browser.start();
const t0 = performance.now();

const st = () => b.eval<St>(`return {
  phase: UD.G.phase, turn: UD.G.turn, me: UD.mySeat(), ri: UD.G.ri,
  hand: UD.G.hands[UD.mySeat()] ? UD.G.hands[UD.mySeat()].length : 0,
  bids: document.querySelectorAll("[data-bid]").length }`);

/** 一直等到輪到我出牌；中途輪到我叫墩就叫一個 */
async function myTurn(what: string, ms = 20000) {
  const t = Date.now();
  for (;;) {
    const s = await st();
    if (s.phase === "play" && s.turn === s.me && s.hand > 0) return s;
    if (s.phase === "bid" && s.bids > 0) {
      // 被 the hook 擋掉的那個數字按不動，所以只挑按得動的
      await b.eval(`const x=document.querySelector("[data-bid]:not([disabled])"); if(x) x.click(); return 1`);
    }
    if (Date.now() - t > ms) throw new Error(`等不到輪我出牌（${what}）：${JSON.stringify(s)}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}
/** 手上第一張出得掉的牌：id 與它在畫面上的位置 */
const playableCard = () => b.eval<{ id: string; x: number; y: number } | null>(
  `const e=[...document.querySelectorAll("#hand [data-card]")].find(x=>!x.disabled);
   if(!e) return null; const r=e.getBoundingClientRect();
   return {id:e.dataset.card, x:r.x+r.width/2, y:r.y+r.height/2};`,
);
const anyCard = () => b.eval<{ id: string; x: number; y: number } | null>(
  `const e=document.querySelector("#hand [data-card]"); if(!e) return null;
   const r=e.getBoundingClientRect(); return {id:e.dataset.card, x:r.x+r.width/2, y:r.y+r.height/2};`,
);

try {
  await b.open("?lang=zh&dim=2&pace=1&hold=1");
  await b.eval(`TUNE.roundGap = 150; return 1`);   /* 局與局之間不必等 2.2 秒 */

  /* ── 開一桌自己打 ── */
  await b.eval(`document.getElementById("lbSolo").click(); return 1`);
  await b.until(`!!document.querySelector(".rm-go")`, "開房頁出現");

  /* 叫墩階段：牌是暗的，點了不該有事 */
  await b.eval(`document.querySelector(".rm-go").click(); return 1`);
  await b.until(`UD.G.phase === "bid"`, "發完牌進叫墩");
  const dim = await anyCard();
  if (dim) {
    const before = (await st()).hand;
    await b.click(dim.x, dim.y);
    await new Promise((r) => setTimeout(r, 200));
    ok((await st()).hand === before, "叫墩階段點暗的牌，牌居然出掉了");
    ok(await b.eval(`return UD.tap.playable(${JSON.stringify(dim.id)}) === false`),
      "暗的牌卻被當成出得掉");
  } else ok(false, "叫墩階段找不到手牌按鈕");

  /* ── 按太久不算 ── */
  let s = await myTurn("按太久");
  let c = (await playableCard())!;
  await b.click(c.x, c.y, { hold: 1400 });
  await new Promise((r) => setTimeout(r, 250));
  ok((await st()).hand === s.hand, "按住 1.4 秒放開，牌不該出去（那是猶豫，不是點擊）");

  /* ── 手指滑開不算 ── */
  await b.click(c.x, c.y, { dx: 40 });
  await new Promise((r) => setTimeout(r, 250));
  ok((await st()).hand === s.hand, "手指滑開 40px 才放，牌不該出去");

  /* ── 按下與放開之間手牌被重畫，還是要出得掉（e8f192c 那個災情） ── */
  await b.press(c.x, c.y);
  await b.eval(`const h=document.getElementById("hand"); h.innerHTML = h.innerHTML; return 1`);
  await b.release(c.x, c.y);
  await new Promise((r) => setTimeout(r, 400));
  ok((await st()).hand === s.hand - 1,
    "按下與放開之間手牌被重畫，牌就出不去了——瀏覽器這時候不發 click，決定必須在 pointerup");

  /* ── 兩條路都走同一個地方 ── */
  await b.eval(`window.__plays = 0;
    const real = UD.tap.play.bind(UD.tap);
    UD.tap.play = function(id){ window.__plays++; return real(id); };
    return 1`);

  /* 平面：正常點一下 */
  s = await myTurn("平面點一下");
  c = (await playableCard())!;
  await b.click(c.x, c.y);
  await new Promise((r) => setTimeout(r, 400));
  ok((await st()).hand === s.hand - 1, "平面上好好點一張牌，牌沒有出去");
  ok(await b.eval(`return window.__plays === 1`),
    `平面那一下沒有剛好經過 UD.tap.play 一次（${await b.eval("return window.__plays")} 次）`);

  /* 立體：畫布上的射線命中——這裡直接扮成立體那一層來回答，
     驗的是「換一個回答來源，容差與出牌完全共用同一份」 */
  s = await myTurn("立體那條路");
  c = (await playableCard())!;
  const away = await b.box("#table") ?? { x: 400, y: 300 };
  await b.eval(`UD.tap.hit = function(){ return ${JSON.stringify(c.id)}; }; return 1`);
  await b.click(away.x, away.y, { hold: 1400 });        /* 一樣要吃「按太久」 */
  await new Promise((r) => setTimeout(r, 250));
  ok((await st()).hand === s.hand, "立體那條路沒有吃到「按太久不算」——容差沒有共用");
  await b.click(away.x, away.y, { dx: 40 });            /* 一樣要吃「手指滑開」 */
  await new Promise((r) => setTimeout(r, 250));
  ok((await st()).hand === s.hand, "立體那條路沒有吃到「手指滑開不算」——容差沒有共用");
  await b.click(away.x, away.y);                        /* 好好點：這下要出得掉 */
  await new Promise((r) => setTimeout(r, 400));
  ok((await st()).hand === s.hand - 1, "立體那條路點不動：射線回報了牌，卻沒有出去");
  ok(await b.eval(`return window.__plays === 2`),
    `立體那一下沒有走同一個 UD.tap.play（總共 ${await b.eval("return window.__plays")} 次）`);
  await b.eval(`UD.tap.hit = null; return 1`);

  /* ── 鍵盤：click 沒有座標（detail 0），這條路要留著 ── */
  s = await myTurn("鍵盤");
  c = (await playableCard())!;
  await b.eval(`const e=UD.tap.btn(${JSON.stringify(c.id)}); e.focus(); e.click(); return 1`);
  await new Promise((r) => setTimeout(r, 400));
  ok((await st()).hand === s.hand - 1, "鍵盤（或螢幕閱讀器）送出來的 click 出不了牌");

  /* ── 一下就是一下：不會出兩張 ── */
  s = await myTurn("不會出兩張");
  c = (await playableCard())!;
  const n0 = await b.eval<number>(`return window.__plays`);
  await b.click(c.x, c.y);
  await new Promise((r) => setTimeout(r, 400));
  ok((await st()).hand === s.hand - 1, "點一下應該只出一張");
  ok(await b.eval<boolean>(`return window.__plays === ${n0 + 1}`),
    "點一下卻走了不只一次出牌（pointerup 與 click 都動了手）");
} catch (e) {
  fails.push("測試中途爆掉：" + (e as Error).message);
} finally {
  await b.close();
}

/* ── 立體牌桌：真的開一次，驗那條射線 ──
   上面「立體那條路」是扮的（直接餵一個 id），驗的是容差有沒有共用；
   這裡開真的 WebGL 場景，驗射線本身認不認得出手指底下是哪張牌。
   three.js 從 CDN 來，載不到就跳過——不讓一支測試綁在別人的網路上。 */
let skipped = "";
const g = await Browser.start({ gl: true });
try {
  await g.open("?lang=zh&dim=3&pace=1&hold=1");
  await g.eval(`TUNE.roundGap = 150; return 1`);
  try {
    await g.until(
      `return !!(UD.dim && UD.dim() && UD.tap.hit && document.querySelector("canvas") &&
                 document.body.classList.contains("is3d"))`,
      "立體牌桌起來", 25000);
  } catch {
    skipped = "立體那一段跳過了：three.js 沒載進來（離線？）";
    throw new Error("skip");
  }
  await g.eval(`document.getElementById("lbSolo").click(); return 1`);
  await g.until(`!!document.querySelector(".rm-go")`, "開房頁出現");
  await g.eval(`document.querySelector(".rm-go").click(); return 1`);

  // 等到輪我出牌（叫墩照樣點）
  const t = Date.now();
  for (;;) {
    const s2 = await g.eval<{ phase: string; turn: number; me: number }>(
      `return {phase:UD.G.phase, turn:UD.G.turn, me:UD.mySeat()}`);
    if (s2.phase === "play" && s2.turn === s2.me) break;
    if (s2.phase === "bid") {
      await g.eval(`const x=document.querySelector("[data-bid]:not([disabled])"); if(x) x.click(); return 1`);
    }
    if (Date.now() - t > 30000) throw new Error("立體模式等不到輪我出牌");
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 900));   // 讓牌飛到定位

  // 手牌那層透明按鈕貼在投影後的牌面上，拿它的位置當「手指落點」去問射線
  const spot = await g.eval<{ id: string; x: number; y: number } | null>(
    `const e=[...document.querySelectorAll("#hand [data-card]")].find(x=>!x.disabled);
     if(!e) return null; const r=e.getBoundingClientRect();
     return {id:e.dataset.card, x:r.x+r.width/2, y:r.y+r.height/2};`);
  ok(!!spot, "立體模式下找不到手牌");
  if (spot) {
    const hitId = await g.eval<string | null>(
      `return UD.tap.hit({clientX:${spot.x}, clientY:${spot.y},
                          target:document.querySelector("canvas")})`);
    ok(hitId === spot.id,
      `畫布上的射線認錯牌：手指在 ${spot.id} 上，射線說是 ${hitId}`);
    const before = await g.eval<number>(`return UD.G.hands[UD.mySeat()].length`);
    await g.click(spot.x, spot.y);
    await new Promise((r) => setTimeout(r, 600));
    ok(await g.eval<boolean>(`return UD.G.hands[UD.mySeat()].length === ${before - 1}`),
      "立體牌桌上點一張亮著的牌，牌沒有出去");
  }
  // 切回平面之後那條線要斷乾淨
  await g.eval(`UD.setDim(false); return 1`);
  await new Promise((r) => setTimeout(r, 400));
  ok(await g.eval<boolean>(`return UD.tap.hit({clientX:10, clientY:10, target:document.body}) === null`),
    "切回平面之後，立體那條射線還在回答——平面上點空白處可能會誤出牌");
} catch (e) {
  if ((e as Error).message !== "skip") fails.push("立體那一段爆掉：" + (e as Error).message);
} finally {
  await g.close();
}

const ms = Math.round(performance.now() - t0);
console.log("11 Up & Down — 手指與畫面的測試（無頭 Chrome）");
console.log(`  出牌的入口：暗牌、按太久、手指滑開、重畫、平面、立體（含真的 WebGL 射線）、鍵盤、不重複出牌`);
console.log(`  ${checks} 項，${ms} 毫秒`);
if (skipped) console.log("  ⚠ " + skipped);
if (fails.length) {
  console.log(`\n  ✗ ${fails.length} 項不對：\n`);
  for (const f of fails) console.log("  · " + f);
  Deno.exit(1);
}
console.log("  ✓ 全部通過");
