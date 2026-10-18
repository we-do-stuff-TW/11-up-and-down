// 11 Up & Down — 畫面沒變就不動：立體不叫醒 WebGL、平面的細條不重演
//
// 跑法：deno run -A scripts/idle_test.ts
//
// 這一支守的全是「不該發生的事」：沒變的列叫醒了 GPU、高檔的靜止精算被打回 0、
// 顏色明明到了還在轉、出一張牌全桌的細條從 0 再長一次。這些在畫面上一格都看不出來，
// 手機只會變燙、越玩越當——沒發生跟沒測到長得一模一樣，所以要數。
//
// 也守反方向：真的變了一定要畫。sync() 改成「沒動到場景就不叫醒」之後，最怕的是有人
// 繞過 touch() 直接改場景，畫面就停在舊的一格。所以除了每一條劇本各自的斷言，
// 每一段停手之後都整個場景比一次指紋：「最後畫出去的那一格」＝「場景現在的樣子」。
//
// 頁面用 _browser.ts 的 hooks（換掉伺服器、看得到 applyRow 與立體那層的模組作用域），
// 每一列什麼時候到、內容是什麼都由測試決定。畫是真的畫（軟體 WebGL），數的是
// renderer.render 被叫的那幾格。壁爐的火停掉——它本來就每 150ms 要求重畫一格，
// 留著的話「沒變的列」與「火」分不開（火的成本是另一件事，見 plan 0006「不做什麼」）。
// three.js 從 CDN 來，載不到就跳過立體那兩段，不讓測試綁在別人的網路上。

import { Browser } from "./_browser.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: unknown, msg: string) { checks++; if (!cond) fails.push(msg); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = performance.now();
let skipped = "";

/* 假伺服器＋量尺，裝進頁面裡。N 人桌、我坐 ME 號；背景的 state/tick 一律不回。
   數格：包 renderer.render，同一格（document.timeline.currentTime 一樣）只算一次，
   而且那一格當下把場景的指紋記下來——這就是「畫面上現在那一格」。 */
const RIG = (n: number, me: number) => `
window.__I = (function(){
  const E = UD.engine, T = UD.__t, N = ${n}, ME = ${me};
  const clone = x => JSON.parse(JSON.stringify(x));
  const W = {g:null, rev:0};
  T.MY.pid = "p" + ME;
  window.__call = function(){ return Promise.resolve(null); };
  function row(){
    const g = W.g, seen = {};
    for(let i=0;i<N;i++) seen["p"+i] = Date.now();      /* 心跳列唯一會變的就是這個 */
    return clone({code:"IDLE", rev:W.rev, match:1, cfg:g.cfg, ladder:g.ladder,
      seats:g.seats.map((s,i)=>({name:"P"+i, kind:"human", pid:"p"+i, av:null})),
      phase:g.phase, ri:g.ri, hs:g.hs, starter:g.starter, trump:g.trump, trump_card:g.trumpCard,
      leader:g.leader, turn:g.turn, led:g.led, played:g.played, trick:g.trick, bids:g.bids, won:g.won,
      score:g.score, log:g.log, host_pid:"p0", seen:seen});
  }
  const push = withHand => T.applyRow(row(), withHand ? clone(W.g.hands[ME]) : undefined);
  function bidAll(g){ let k = 0; while(g.phase === "bid" && k++ < 50){ const s = g.turn; E.applyBid(g, s, E.aiBid(g, s)); } }
  function playOut(g){
    let k = 0;
    while(g.phase !== "roundend" && g.phase !== "over" && k++ < 2000){
      if(g.phase === "bid") bidAll(g);
      else if(g.phase === "play"){ const s = g.turn; E.applyPlay(g, s, E.aiCard(g, s).id); }
      else if(g.phase === "trickend") E.resolveTrick(g);
    }
  }
  const RC = {frames:0, lastFT:-1, last:""};
  function d3(){ return UD.__3d ? UD.__3d() : null; }
  /* 場景指紋：看得見的每個網格／燈的世界矩陣、材質（顏色、發光、透明度、貼圖）、幾何，加上鏡頭。
     刻意不放鏡頭的投影矩陣——高檔精算每格把視錐抖半個畫素（setViewOffset），放進來每格都不一樣。
     數值四捨五入到 1e-5：1e-12 的浮點尾差不是畫面上的差別。 */
  function digest(){
    const S = d3().S;
    S.scene.updateMatrixWorld();
    let h = 2166136261 >>> 0;
    const mix = v => { h ^= (v | 0); h = Math.imul(h, 16777619) >>> 0; };
    const num = x => mix(Math.round(x * 1e5));
    S.scene.traverseVisible(function(o){
      if(!(o.isMesh || o.isLight || o.isLine || o.isPoints || o.isSprite)) return;
      mix(o.id);
      const e = o.matrixWorld.elements; for(let i = 0; i < 16; i++) num(e[i]);
      if(o.isLight){ num(o.intensity); num(o.color.r); num(o.color.g); num(o.color.b); return; }
      if(o.geometry) mix(o.geometry.id);
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for(const m of ms){
        if(!m) continue;
        mix(m.id); num(m.opacity); mix(m.visible ? 1 : 0);
        mix(m.map ? m.map.id : 0); mix(m.emissiveMap ? m.emissiveMap.id : 0);
        for(const k of ["color", "emissive", "sheenColor"]) if(m[k]){ num(m[k].r); num(m[k].g); num(m[k].b); }
        if(m.emissiveIntensity !== undefined) num(m.emissiveIntensity);
      }
    });
    num(S.scene.environmentIntensity);
    const c = S.camera; for(const x of c.matrixWorld.elements) num(x); num(c.fov); num(c.aspect);
    return h.toString(16);
  }
  return {
    W, RC, digest,
    start(scene, rounds){
      /* 洗牌、AI 出牌都用 Math.random：換成有種子的，每次跑都是同一副牌、同一個先手 */
      let a = 20261018;
      Math.random = function(){ a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      const g = E.newGame({n:N});
      for(let i=0;i<N;i++) g.seats[i] = {name:"P"+i, kind:"human", cid:"p"+i, av:null};
      g.host = "p0";
      W.g = g;
      for(let r = 0; r < (rounds || 0); r++){ E.startRound(g); playOut(g); }
      E.startRound(g);
      bidAll(g);
      if(scene === "lead-other"){
        /* 叫完墩、檯面空的、輪到別人先出：下一列再把先手交給我（leadMe） */
        if(g.turn === ME){ g.turn = g.leader = (ME + 1) % N; }
      }else{
        let k = 0; while(g.phase === "play" && g.turn === ME && k++ < 5) E.applyPlay(g, ME, E.aiCard(g, ME).id);
      }
      W.rev = 5;
      push(true);
      document.body.classList.remove("in-lobby"); document.getElementById("lobby").hidden = true;
      if(UD.onShow) UD.onShow();
      return {phase:g.phase, turn:g.turn, trick:g.trick.length};
    },
    hook(){
      const d = d3(), S = d.S, r = S.r, orig = r.render.bind(r);
      r.render = function(sc, cam){
        if(sc === S.scene){
          const ft = document.timeline.currentTime;
          if(ft !== RC.lastFT){ RC.lastFT = ft; RC.frames++; RC.last = digest(); }
        }
        return orig(sc, cam);
      };
      /* 火停在現在這一格（理由在檔頭） */
      S.room.last = 1e15;
      return 1;
    },
    /* 停手了沒：沒有補間、沒有顏色過場、dirty 歸零、沒有金線或閃燈、叫墩的環不在收場中、高檔精算疊完 */
    quiet(){
      const d = d3(), S = d.S, B = S.bid, FX = d.FX;
      return d.tweens.length === 0 && d.fades.length === 0 && S.dirty === 0 && !S.glowCue && !S.flash &&
        !(FX.comp && FX.tier === "high" && !UD.REDUCED && FX.accN < 24) &&
        !(B && (B.state === "closing" || B.state === "verdict" || B.goneAt));
    },
    /* 「最後畫出去的那一格」是不是「場景現在的樣子」 */
    fresh(){ return RC.last === digest(); },
    same(){ push(false); },                                       /* 同一列再來一次：rev 不動，只有 seen 換了 */
    play(){ const g = W.g, s = g.turn; E.applyPlay(g, s, E.aiCard(g, s).id); W.rev++; push(s === ME); return s; },
    toMe(){ const g = W.g; let k = 0; while(g.phase === "play" && g.turn !== ME && k++ < 10){ const s = g.turn; E.applyPlay(g, s, E.aiCard(g, s).id); W.rev++; push(false); } return g.turn; },
    leadMe(){ const g = W.g; if(g.trick.length) return false; g.turn = g.leader = ME; W.rev++; push(false); return true; },
    /* 桌色的色相：黑桃、梅花一組，紅心、方塊一組（TABLE_HUE）。換到另一組，桌布才一定會轉色 */
    trump(){ const g = W.g; g.trump = (g.trump === 1 || g.trump === 2) ? 0 : 1; W.rev++; push(false); return g.trump; },
    bid(){ const g = W.g; if(g.phase !== "bid") return false; const s = g.turn; E.applyBid(g, s, E.aiBid(g, s)); W.rev++; push(false); return true; },
    nextRound(){ const g = W.g; playOut(g); E.startRound(g); W.rev += 5; push(true); return g.ri; }
  };
})(); return 1;`;

/** 等到立體那層停手（連兩次都安靜才算）。
    高檔停手要疊滿 24 格精算，軟體 WebGL 一格幾百毫秒，機器忙的時候一格一秒多——逾時抓寬 */
async function settle(b: Browser, what: string, ms = 90000) {
  const t = Date.now();
  let n = 0;
  for (;;) {
    if (await b.eval<boolean>(`return __I.quiet()`)) { if (++n >= 2) return; } else n = 0;
    if (Date.now() - t > ms) throw new Error(`等不到立體牌桌停手（${what}）`);
    await sleep(150);
  }
}
const frames = (b: Browser) => b.eval<number>(`return __I.RC.frames`);
const zero = (b: Browser) => b.eval(`__I.RC.frames = 0; return 1`);
const accN = (b: Browser) => b.eval<number>(`return UD.__3d().FX.accN`);

/** 開一桌立體、裝好量尺；three 載不到回 false */
async function open3d(b: Browser, q: string, scene: string, reduced = false): Promise<boolean> {
  await b.open(q);
  if (reduced) {
    // UD.REDUCED 是載入那一刻讀的，所以先設好再重載
    await b.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await b.cdp("Page.reload", {});
    await b.until("!!(window.UD && window.UD.engine)", "重載後程式沒起來", 15000);
  }
  try {
    await b.until(`return !!(UD.dim && UD.dim() && document.body.classList.contains("is3d") && UD.__3d && UD.sync3d)`,
      "立體牌桌起來", 40000);
  } catch {
    return false;
  }
  await b.eval(RIG(3, 2));
  await b.eval(`return __I.start(${JSON.stringify(scene)}, 3)`);   /* 第 4 局：每人 4 張 */
  await b.eval(`return __I.hook()`);
  return true;
}

/* ── 一、高檔（桌機的預設）：沒變的列不畫、精算不被打掉；真的變了照畫 ── */
const A = await Browser.start({ gl: true, hooks: true });
try {
  if (!(await open3d(A, "?lang=zh&dim=3&fx=high", "play"))) {
    skipped = "立體那兩段跳過了：three.js 沒載進來（離線？）";
    throw new Error("skip");
  }
  ok(await A.eval(`return UD.fx().refine && UD.REDUCED === false`), "高檔那段沒有開到精算（?fx=high 沒生效？）");
  await settle(A, "開局發牌");

  /* 同一列進來五次（心跳列：rev 不動、只換 seen）：一格都不該畫，精算停在 24 */
  const acc0 = await accN(A);
  await zero(A);
  for (let i = 0; i < 5; i++) { await A.eval(`__I.same(); return 1`); await sleep(250); }
  await sleep(700);
  ok(await frames(A) === 0, `高檔：同一列進來 5 次，WebGL 卻被叫醒畫了 ${await frames(A)} 格（應該 0）`);
  ok(acc0 >= 24 && await accN(A) === acc0,
    `高檔：靜止精算被沒變的列打掉了（之前 ${acc0}、之後 ${await accN(A)}，應該停在 24）`);

  /* sync3d 直接連叫兩次：同一個狀態 sync 兩次＝不叫醒 */
  await zero(A);
  await A.eval(`UD.sync3d(); UD.sync3d(); return 1`);
  await sleep(600);
  ok(await frames(A) === 0, `高檔：同一個狀態 sync 兩次，第二次還是畫了（${await frames(A)} 格）`);

  /* 只有補間的變化：先手交給我、檯面空的，每張都能出——牌只是浮上來（slot 變了 → 補間），
     沒有生牌、沒有壓暗，sync() 一筆 touch 都沒記，叫醒全靠 frame() 看到補間在跑。
     再假裝下一格卡了 5 秒（手機上 GC、著色器編譯就是這樣）——補間在同一格裡從頭跑到尾，
     終點那一格還是要畫出去。
     ⚠️ 卡住要用「把補間的起點往前挪」做，不能在頁面裡空轉：rAF 給 frame() 的時間是那一格排定的時間，
     空轉完才跑的那一格拿到的常常是空轉中間的時間，補間只跑了一點點、照樣在動，就測不到（試過，綠得沒有理由） */
  await zero(A);
  const lead = await A.eval<{ ok: boolean; touched: number; tw: number }>(`
    const d = UD.__3d(), S = d.S, c0 = S.chg;
    if(!__I.leadMe()) return {ok:false, touched:-1, tw:0};
    for(const w of d.tweens) w.t0 -= 5000;
    return {ok:true, touched:S.chg - c0, tw:d.tweens.length};`);
  ok(lead.ok && lead.touched === 0 && lead.tw > 0, `高檔：「只有補間」那條的劇本沒生效（${JSON.stringify(lead)}）`);
  await settle(A, "輪到我先出");
  ok(await frames(A) > 0 && await A.eval(`return __I.fresh()`),
    "高檔：輪到我先出、牌浮上來（只有補間），那一格卡住之後終點沒畫出去");

  /* 出一張牌（我先出）：要畫，而且停手後畫面上那一格就是現在的場景 */
  let d0 = await A.eval<string>(`return __I.digest()`);
  await zero(A);
  await A.eval(`return __I.play()`);
  await settle(A, "出一張牌");
  ok(await frames(A) > 0, "高檔：出了一張牌，WebGL 一格都沒畫");
  ok(await A.eval<string>(`return __I.digest()`) !== d0, "高檔：出牌那一列沒有改到場景（劇本沒生效）");
  ok(await A.eval(`return __I.fresh()`), "高檔：出牌之後畫面停在舊的一格（最後畫的那格≠現在的場景）");

  /* 只有壓暗變了：直接改材質、沒有補間，最容易被漏掉的那一種。
     G.turn 換成我、但平面那層不重畫——手牌按鈕全是 disabled，每張都「輪到你但不能出」→ 全部壓暗，
     slot 一個字都沒變（沒有 jump、沒有補間），叫醒只能靠 shade() 那筆 touch() */
  const turn0 = await A.eval<number>(`return UD.G.turn`);
  ok(turn0 !== 2, "高檔：壓暗那條的前提不成立（本來就輪到我）");
  await zero(A);
  await A.eval(`UD.G.turn = 2; UD.sync3d(); return 1`);
  await settle(A, "只有壓暗");
  ok(await A.eval(`return [...UD.__3d().S.cards.values()].some(c => c.slot.indexOf("hand:") === 0 && c.shade < 1)`),
    "高檔：壓暗那條的劇本沒生效（手牌沒有一張被壓暗）");
  ok(await frames(A) > 0, "高檔：只有手牌壓暗了，WebGL 卻沒被叫醒");
  ok(await A.eval(`return __I.fresh()`), "高檔：手牌壓暗之後畫面停在舊的一格");
  await zero(A);
  await A.eval(`UD.G.turn = ${turn0}; UD.sync3d(); return 1`);
  await settle(A, "壓暗收回");
  ok(await frames(A) > 0 && await A.eval(`return __I.fresh()`), "高檔：壓暗收回來那一下沒有畫出去");

  /* 換王牌換色：桌布 900ms 轉過去。收尾必須剛好落在目標色——
     故意把這段過場的起點換成「x + (to − x) ≠ to」的那種數，以前 lerp(…, 1) 收尾會留 1e-17 的尾差，
     下一列就再開一段幽靈過場（健檢量到靜止後連三列各一次） */
  await zero(A);
  await A.eval(`return __I.trump()`);
  const rig = await A.eval<{ ok: boolean; why?: string }>(`
    const d = UD.__3d(), col = d.S.feltMat.color, f = d.fades.find(x => x.col === col);
    if(!f) return {ok:false, why:"換王牌之後桌布沒有開始轉色"};
    const bad = t => { for(let x = t + .1, i = 0; i < 4000; i++, x += .00731) if(x + (t - x) !== t) return x; return null; };
    const xs = [bad(f.to.r), bad(f.to.g), bad(f.to.b)];
    if(xs.some(x => x === null)) return {ok:false, why:"找不到會留尾差的起點"};
    f.from.r = xs[0]; f.from.g = xs[1]; f.from.b = xs[2];
    window.__to = f.to.clone();
    return {ok:true};`);
  ok(rig.ok, "高檔：換王牌的劇本沒生效：" + (rig.why ?? ""));
  await settle(A, "換王牌轉色");
  ok(await frames(A) > 0, "高檔：換了王牌，桌布轉色卻一格都沒畫");
  ok(await A.eval(`const c = UD.__3d().S.feltMat.color, t = window.__to; return !!t && c.r === t.r && c.g === t.g && c.b === t.b`),
    "高檔：桌布轉色收尾沒有剛好落在目標色（lerp 的尾差留下來了，下一列會再轉一次）");
  await zero(A);
  for (let i = 0; i < 3; i++) { await A.eval(`__I.same(); return 1`); await sleep(300); }
  await sleep(600);
  ok(await frames(A) === 0 && await A.eval(`return UD.__3d().fades.length === 0`),
    `高檔：桌布轉完色之後，沒變的列又開了一段幽靈過場（畫了 ${await frames(A)} 格）`);

  /* 比顏色要容許誤差：差 1e-12 不是「顏色不一樣」 */
  await zero(A);
  await A.eval(`const c = UD.__3d().S.feltMat.color; c.r += 1e-12; c.g -= 1e-12; UD.sync3d(); return 1`);
  await sleep(600);
  ok(await A.eval(`return UD.__3d().fades.length === 0`) && await frames(A) === 0,
    "高檔：桌布色只差 1e-12 就被當成要轉色（比顏色沒有容許誤差）");

  /* 轉到一半進來一列（出牌階段每張牌都是一列）：已經在往同一個顏色轉的那段要讓它走完，
     不准從半路重開 900ms（Francis 10-18 拍板）。看的是「那一段過場還是不是同一個物件」——
     舊寫法每一列都丟掉舊的、推一段新的；只比起點時間的話，同一個 task 裡兩次 now 可能一樣，會假綠 */
  const near = (a: string, b: string) => `(Math.abs(${a}.r-${b}.r) < 1e-6 && Math.abs(${a}.g-${b}.g) < 1e-6 && Math.abs(${a}.b-${b}.b) < 1e-6)`;
  const midway = await A.eval<{ ok: boolean; why: string }>(`
    __I.trump();
    const d = UD.__3d(), col = d.S.feltMat.color, f = d.fades.find(x => x.col === col);
    if(!f) return {ok:false, why:"換王牌之後桌布沒有開始轉色"};
    f.t0 -= 400;                                   /* 走到一半 */
    window.__f = f; const t0 = f.t0;
    __I.same(); __I.same();                        /* 同一個目標的列進來兩次 */
    const g = d.fades.find(x => x.col === col);
    return {ok:g === f && g.t0 === t0, why:g === f ? "起點被改了" : g ? "被換成新的一段" : "那一段不見了"};`);
  ok(midway.ok, `高檔：桌布轉到一半，同一個目標的列一進來就從半路重開（${midway.why}）`);
  await settle(A, "轉到一半進來的列");
  ok(await A.eval(`return ${near("UD.__3d().S.feltMat.color", "window.__f.to")} && __I.fresh()`),
    "高檔：轉到一半進來列之後，桌布沒有停在目標色（或最後一格不是現在的樣子）");

  /* 一格之內王牌換過去又換回來：最後要停在換回來的那個顏色。
     先問「已經是這個顏色了嗎」再清舊的那段，就會留下往中間色的過場，桌布停在錯的顏色 */
  await A.eval(`window.__c0 = UD.__3d().S.feltMat.color.clone(); __I.trump(); __I.trump(); return 1`);
  await settle(A, "換過去又換回來");
  ok(await A.eval(`return ${near("UD.__3d().S.feltMat.color", "window.__c0")} && __I.fresh()`),
    "高檔：王牌換過去又馬上換回來，桌布停在中間那個顏色（往中間色的那段過場沒清掉）");

  /* 換牌面：等字型與圖到齊才換貼圖（await 之後，不在 sync 裡），要自己叫醒 */
  const deck0 = await A.eval<string>(`return UD.deck().id`);
  const back0 = await A.eval<number>(`return UD.__3d().S.backMat.map.id`);
  await zero(A);
  await A.eval(`UD.setDeck(UD.DECK_ORDER.find(id => id !== ${JSON.stringify(deck0)})); return 1`);
  await A.until(`return UD.__3d().S.backMat.map.id !== ${back0}`, "換牌面之後牌背貼圖換掉", 30000);
  await settle(A, "換牌面");
  ok(await frames(A) > 0 && await A.eval(`return __I.fresh()`),
    "高檔：換了牌面，畫面停在舊牌面（換貼圖之後沒有叫醒重畫）");

  /* 量到太慢自己降檔：換了管線（牌底下的接觸陰影跟著打開），要再畫一次——
     降檔是在畫完那一格之後才判斷的，不叫醒的話畫面停在舊管線畫的那一格 */
  await zero(A);
  await A.eval(`const d = UD.__3d(); d.FX.forced = false; d.FX.frames = 31; d.FX.ms = 1000; d.S.dirty = 1; return 1`);
  await A.until(`return UD.fx().tier === "mid"`, "自己降檔到中檔", 10000);
  await settle(A, "自己降檔");
  ok(await frames(A) > 1 && await A.eval(`return __I.fresh()`),
    "高檔：量到太慢自己降到中檔之後，畫面停在舊管線畫的那一格");

  /* 中、低檔：沒有精算，一樣不能被沒變的列叫醒 */
  for (const tier of ["mid", "low"]) {
    await A.eval(`UD.fx(${JSON.stringify(tier)}); return 1`);
    await settle(A, `換到${tier}`);
    await zero(A);
    for (let i = 0; i < 5; i++) { await A.eval(`__I.same(); return 1`); await sleep(250); }
    await sleep(700);
    ok(await frames(A) === 0, `${tier} 檔：同一列進來 5 次，WebGL 卻被叫醒畫了 ${await frames(A)} 格`);
  }
} catch (e) {
  if ((e as Error).message !== "skip") fails.push("高檔那一段爆掉：" + (e as Error).message);
} finally {
  await A.close();
}

/* ── 二、動畫減量（系統的「減少動態效果」）：所有變化都是當場到位、沒有補間——
   frame() 一點都看不出來，叫醒全靠 sync() 記到的那幾筆 ── */
if (!skipped) {
  const B = await Browser.start({ gl: true, hooks: true });
  try {
    if (!(await open3d(B, "?lang=zh&dim=3&fx=low", "lead-other", true))) throw new Error("立體牌桌在動畫減量下起不來");
    ok(await B.eval(`return UD.REDUCED === true`), "動畫減量那段沒有生效（UD.REDUCED 不是 true）");
    await settle(B, "開局");

    await zero(B);
    for (let i = 0; i < 5; i++) { await B.eval(`__I.same(); return 1`); await sleep(200); }
    await sleep(600);
    ok(await frames(B) === 0, `動畫減量：同一列進來 5 次，WebGL 卻畫了 ${await frames(B)} 格`);

    /* 先手交給我、檯面是空的：每張牌都能出，只有 slot 變了（瞬間跳到浮起的位置），沒有生牌、沒有壓暗 */
    await zero(B);
    ok(await B.eval(`return __I.leadMe()`), "動畫減量：先手交給我的劇本沒生效（檯面不是空的）");
    await settle(B, "先手交給我");
    ok(await frames(B) > 0, "動畫減量：輪到我先出（能出的牌跳上來），WebGL 卻沒被叫醒");
    ok(await B.eval(`return __I.fresh()`), "動畫減量：輪到我先出之後畫面停在舊的一格");

    /* 我出、別人跟：生牌、收牌、壓暗全是當場到位 */
    const d1 = await B.eval<string>(`return __I.digest()`);
    await zero(B);
    await B.eval(`__I.play(); __I.play(); return 1`);
    await settle(B, "出牌");
    ok(await frames(B) > 0, "動畫減量：出了兩張牌，WebGL 一格都沒畫");
    ok(await B.eval<string>(`return __I.digest()`) !== d1, "動畫減量：出牌那兩列沒有改到場景（劇本沒生效）");
    ok(await B.eval(`return __I.fresh()`), "動畫減量：出牌之後畫面停在舊的一格");

    /* 換王牌：動畫減量時桌布是直接換色，不經過 fades */
    await zero(B);
    await B.eval(`return __I.trump()`);
    await settle(B, "換王牌");
    ok(await frames(B) > 0, "動畫減量：換了王牌，桌布換色卻沒有畫出去");
    ok(await B.eval(`return __I.fresh()`), "動畫減量：換王牌之後畫面停在舊的一格");

    /* 換局：整副牌收掉、重發、叫墩的環重刻 */
    await zero(B);
    await B.eval(`return __I.nextRound()`);
    await settle(B, "換局");
    ok(await frames(B) > 0 && await B.eval(`return __I.fresh()`), "動畫減量：換局之後畫面停在舊的一格");
  } catch (e) {
    fails.push("動畫減量那一段爆掉：" + (e as Error).message);
  } finally {
    await B.close();
  }
}

/* ── 三、平面：「手上剩幾張」的細條演過就不演 ──
   六人第 10 局（每人 10 張，細條最多的時候）。數 animationstart 的 spread-in。 */
const C = await Browser.start({ hooks: true });
try {
  await C.open("?lang=zh&dim=2");
  await C.eval(`window.__AS = 0; document.addEventListener("animationstart", e => { if(e.animationName === "spread-in") __AS++; }, true); return 1`);
  await C.eval(RIG(6, 2));
  const take = () => C.eval<number>(`const n = __AS; __AS = 0; return n`);
  const bars = () => C.eval<number>(`return document.querySelectorAll("#seats .spread i").length`);
  /* 前 9 局打完、第 10 局叫完墩，送第一列（帶手牌） */
  await C.eval(`return __I.start("play", 9)`);
  await sleep(900);
  const n1 = await bars();
  ok(n1 >= 50, `平面：第 10 局的細條數不對（${n1}），劇本沒擺好`);
  ok(await take() === n1, "平面：進牌桌那一刻細條應該全部長出來一次（發牌照演）");

  await C.eval(`__I.same(); return 1`); await sleep(200);
  await C.eval(`__I.same(); return 1`); await sleep(600);
  ok(await take() === 0, "平面：心跳列（什麼都沒變）讓細條重演了");

  await C.eval(`__I.play(); return 1`); await sleep(500);
  await C.eval(`__I.play(); return 1`); await sleep(600);
  const n3 = await take();
  ok(await bars() === n1 - 2, "平面：出了兩張牌，細條沒有少兩條（劇本沒生效）");
  ok(n3 === 0, `平面：出一張牌，全桌的細條又從 0 長了一次（兩列出牌列之後 spread-in ${n3} 次，應該 0）`);

  /* 換局：新的一局整排重新長出來 */
  await C.eval(`return __I.nextRound()`);
  await sleep(150);
  const n4 = await bars();
  /* 發牌後 150ms 又來一列會改到座位區的（叫墩）：正在長的那幾條要接著長，不是重頭、也不是直接跳到滿 */
  const mid = await C.eval<number[]>(`
    if(!__I.bid()) return [];
    return [...document.querySelectorAll("#seats .spread i")].map(e => {
      const a = e.getAnimations().find(x => x.animationName === "spread-in");
      return a ? a.effect.getComputedTiming().progress : -1;
    });`);
  await sleep(700);
  const n4b = await take();
  ok(n4 > 0 && n4b >= n4, `平面：換局發牌，新的細條沒有長出來（${n4} 條、spread-in ${n4b} 次）`);
  ok(mid.length === n4 && mid.every((p) => p >= .12 && p < .97),
    "平面：發牌時細條還在長，座位區被重寫——細條應該接著長，結果是重頭長或直接跳到滿（進度 " +
    mid.map((p) => p.toFixed(2)).join(",") + "）");

  /* 平面的桌色是 CSS 的 --felt 過場（820ms）：轉到一半進來一列，寫進去的是同一個值，過場不准重新起步。
     立體那支 fade() 的同一題；CSS 本來就是這樣，這裡釘住，免得以後有人改成「每列先清掉再設」 */
  const css = await C.eval<{ ok: boolean; why: string }>(`
    const pick = () => document.documentElement.getAnimations().find(a => a.transitionProperty === "--felt");
    __I.trump();
    const a = pick();
    if(!a) return {ok:false, why:"換王牌之後 --felt 沒有開始過場"};
    __I.same(); __I.same();
    const b = pick();
    return {ok:b === a, why:b ? "被換成新的一段" : "那一段不見了"};`);
  ok(css.ok, `平面：桌色轉到一半，同一個目標的列一進來就重新起步（${css.why}）`);
} catch (e) {
  fails.push("平面細條那一段爆掉：" + (e as Error).message);
} finally {
  await C.close();
}

const ms = Math.round(performance.now() - t0);
console.log("11 Up & Down — 畫面沒變就不動（無頭 Chrome，立體用軟體 WebGL）");
console.log("  立體：沒變的列不叫醒（高／中／低檔）、精算不被打掉、幽靈換色；真的變了照畫（只有補間且卡一格、出牌、只有壓暗、換王牌、換牌面、自己降檔、動畫減量）；桌布轉到一半進來的列不重開、換過去又換回來停在對的顏色；平面桌色同一題");
console.log("  平面：細條演過就不演（心跳、出牌不重演；發牌、換局照演；被打斷接著演）");
console.log(`  ${checks} 項，${ms} 毫秒`);
if (skipped) console.log("  ⚠ " + skipped);
if (fails.length) {
  console.log(`\n  ✗ ${fails.length} 項不對：\n`);
  for (const f of fails) console.log("  · " + f);
  Deno.exit(1);
}
console.log("  ✓ 全部通過");
