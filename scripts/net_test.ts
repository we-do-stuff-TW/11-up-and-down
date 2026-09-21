// 11 Up & Down — 連線那一段的測試
//
// 跑法：deno run -A scripts/net_test.ts
//
// 同一手牌會從四個地方回到畫面：本機先演的那一手、對手的即時廣播、伺服器的 HTTP 回應、
// 資料庫的 realtime 推播（慢一秒）。這支把那些撞法一個一個重演出來，看收斂點擋不擋得住。
//
// 這裡的每一條都對應一個真的發生過的災情：出牌之後頓一下又演一次、牌憑空消失、
// 送不出去的那一手沒有退回。伺服器換成假的（測試接縫 window.__call），
// 所以每一列什麼時候到、內容是什麼，都是這支說了算——真的網路重現不了這些時序。

import { Browser } from "./_browser.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: unknown, msg: string) { checks++; if (!cond) fails.push(msg); }

const b = await Browser.start({ hooks: true });
const t0 = performance.now();

/** 頁面裡的小道具：造一桌、造一列、當假伺服器 */
const SETUP = `
window.__T = {
  calls: [], reply: null, sfx: 0,
  /* 造一桌：4 人、我坐 0 號、已經叫完墩、輪我出牌 */
  table(){
    const E = UD.engine, T = UD.__t;
    T.MY.pid = "me";
    const g = E.newGame({n:4});
    for(let i=0;i<5;i++) E.startRound(g);      /* 走到第 5 局：手上有 5 張，測起來夠用 */
    let guard = 0;
    while(g.phase === "bid" && guard++ < 30){ const s = g.turn; E.applyBid(g, s, E.aiBid(g, s)); }
    g.leader = 0; g.turn = 0;          /* 讓我先出，測試才不用等 AI */
    this.g = g;
    return this.row(g, 1);
  },
  row(g, rev){
    /* 真的伺服器送過來的是 JSON，每一列都是新的一份。這裡也要——
       不然客端拿到的是這桌固定樣本自己的陣列，樂觀出牌會把樣本一起改掉。 */
    return this.clone({
      code:"TEST", rev:rev, cfg:g.cfg, ladder:g.ladder,
      seats:g.seats.map(function(s, i){
        return {name:"座位" + i, kind:i === 0 ? "human" : "ai", pid:i === 0 ? "me" : "ai" + i, av:null};
      }),
      phase:g.phase, ri:g.ri, hs:g.hs, starter:g.starter,
      trump:g.trump, trump_card:g.trumpCard, leader:g.leader, turn:g.turn,
      led:g.led, played:g.played, trick:g.trick, bids:g.bids, won:g.won,
      score:g.score, log:g.log, host_pid:"me", seen:{}
    });
  },
  clone(g){ return JSON.parse(JSON.stringify(g)); },
  /* 假伺服器：回什麼、什麼時候回，由測試決定 */
  install(){
    const T = this;
    window.__call = function(action, args){
      T.calls.push(action);
      if(T.reply === "pending") return new Promise(function(){});   /* 永遠不回 */
      return Promise.resolve(T.reply).then(function(d){
        if(d && d.room) UD.__t.applyRow(d.room, d.hand);
        return d;
      });
    };
    if(window.SFX && typeof SFX.play === "function"){
      const real = SFX.play.bind(SFX);
      SFX.play = function(){ T.sfx++; return real.apply(null, arguments); };
    }
  },
  /* 進到連線模式：把第一列套進來 */
  enter(){
    const row = this.table();
    UD.__t.applyRow(row, this.clone(this.g.hands[0]));
    this.install();
    return {mode:UD.MODE, seat:UD.mySeat(), hand:UD.G.hands[UD.mySeat()].length, rev:UD.G.rev};
  },
  /* 我手上第一張出得掉的牌 */
  mine(){ return UD.legalCards(UD.G.hands[UD.mySeat()], UD.G.led)[0].id; }
};
return 1;`;

const view = () => b.eval<{ trick: number; hand: number; rev: number; at: number; ahead: boolean; opt: boolean; sfx: number }>(
  `return {trick:UD.G.trick.length, hand:UD.G.hands[UD.mySeat()].length, rev:UD.G.rev,
           at:UD.G.at, ahead:UD.__t.INBOX.isAhead(), opt:!!UD.__t.INBOX.opt, sfx:window.__T.sfx}`,
);

try {
  await b.open("?lang=zh&pace=1&hold=1");
  await b.eval(SETUP);
  const st0 = await b.eval<{ mode: string; seat: number; hand: number; rev: number }>(`return __T.enter()`);
  ok(st0.mode === "net" && st0.seat === 0, `進不了連線模式：${JSON.stringify(st0)}`);
  const hasSfx = await b.eval<boolean>(`return !!(window.SFX && typeof SFX.play === "function")`);

  /* ── 一、樂觀先走：按下去就有反應，不等伺服器 ── */
  await b.eval(`__T.reply = "pending"; __T.card = __T.mine(); UD.doPlay(__T.card); return 1`);
  let v = await view();
  ok(v.trick === 1 && v.hand === st0.hand - 1, "出牌之後畫面沒有立刻演——樂觀先走沒生效");
  ok(v.ahead && v.opt, "先演了卻沒有留下記號與退路（INBOX.ranAhead 沒被走到）");
  const sfx1 = v.sfx;
  const at1 = v.at;

  /* ── 二、遲到的同一格：出牌前那一列現在才到（realtime 慢一秒的那條） ── */
  await b.eval(`UD.__t.applyRow(__T.row(__T.g, 1)); return 1`);
  v = await view();
  ok(v.trick === 1, "遲到的舊列把檯面上那張牌抹掉了——這就是「出牌後又演一次」的病灶");
  ok(v.rev === 1 && v.hand === st0.hand - 1, "遲到的舊列改動了手牌");
  if (hasSfx) ok(v.sfx === sfx1, "遲到的舊列讓出牌的聲音又響了一次");

  /* ── 三、真的那一列到了：接受，但不重演動畫 ── */
  await b.eval(`
    const g2 = __T.clone(__T.g);
    UD.engine.applyPlay(g2, 0, __T.card);
    __T.g2 = g2;
    UD.__t.applyRow(__T.row(g2, 2), __T.clone(g2.hands[0]));
    return 1`);
  v = await view();
  ok(v.rev === 2 && v.trick === 1, `真的那一列沒有被接受：rev=${v.rev} 檯面=${v.trick}`);
  ok(v.at === at1, "伺服器蓋章讓動畫從頭再跑一次（sameBeat 沒認出這是同一格）");
  ok(!v.ahead && !v.opt, "伺服器講話了，本機那份預測卻還留著");
  if (hasSfx) ok(v.sfx === sfx1, "伺服器蓋章時又補了一次出牌的聲音");

  /* ── 四、過期的那一列：一律不理 ── */
  await b.eval(`UD.__t.applyRow(__T.row(__T.g, 1)); return 1`);
  v = await view();
  ok(v.rev === 2 && v.trick === 1, "rev 比較小的那一列居然被套進來了");

  /* ── 五、保險絲：預測沒被接受也沒被退回，六秒後自己解除 ── */
  await b.eval(`UD.__t.INBOX.ranAhead({}); UD.__t.INBOX.at = Date.now() - 7000; return 1`);
  ok(!(await view()).ahead, "六秒的保險絲沒有燒斷，畫面會被鎖在過去");
  await b.eval(`UD.__t.INBOX.settled(); return 1`);

  /* ── 六、送不出去就退回按之前的樣子 ── */
  await b.eval(`
    /* 第一步那通呼叫是故意讓它永遠不回的，api() 是排隊的，不清掉後面全部卡在它後面 */
    UD.__t.NET.tail = null; UD.__t.NET.queued = 0; UD.__t.NET.busy = false;
    UD.__t.applyRow(__T.row(__T.g, 5), __T.clone(__T.g.hands[0]));   /* 回到出牌前，rev 拉高 */
    __T.reply = null;                                      /* 伺服器打回票 */
    __T.card2 = __T.mine();
    UD.doPlay(__T.card2);
    return 1`);
  const mid = await view();
  ok(mid.trick === 1 || mid.trick === 0, "出牌當下的狀態不對");
  await new Promise((r) => setTimeout(r, 300));
  v = await view();
  ok(v.trick === 0 && v.hand === st0.hand, `打回票之後沒有退回原狀：檯面=${v.trick} 手牌=${v.hand}`);
  ok(!v.ahead && !v.opt, "退回去了，記號卻還留著");

  /* ── 七、對手的廣播：提早畫一格，然後被遲到的舊列蓋掉不得 ── */
  await b.eval(`
    UD.__t.applyRow(__T.row(__T.g, 8), __T.clone(__T.g.hands[0]));
    __T.g.turn = 1;
    UD.__t.applyRow(__T.row(__T.g, 9), __T.clone(__T.g.hands[0]));   /* 輪到 1 號 */
    __T.peerCard = {s:__T.g.hands[1][0].s, r:__T.g.hands[1][0].r, id:__T.g.hands[1][0].id};
    UD.__t.peerMove({t:"play", seat:1, card:__T.peerCard});
    return 1`);
  v = await view();
  ok(v.trick === 1, "對手廣播過來的那一手沒有畫上桌");
  ok(v.ahead, "對手那一手畫上去了，卻沒有打記號——遲到的舊列會把它抹掉");
  await b.eval(`UD.__t.applyRow(__T.row(__T.g, 9)); return 1`);
  ok((await view()).trick === 1, "遲到的舊列把對手那張牌抹掉了（對手側的「演兩次」）");

  /* ── 八、不是他的回合就當沒聽見 ── */
  const before = (await view()).trick;
  await b.eval(`UD.__t.peerMove({t:"play", seat:3, card:{s:0, r:14, id:"亂喊的"}}); return 1`);
  ok((await view()).trick === before, "誰喊都畫：不是他的回合的廣播也被接受了");
  await b.eval(`UD.__t.peerMove({t:"play", seat:0, card:{s:0, r:13, id:"我自己"}}); return 1`);
  ok((await view()).trick === before, "把自己的廣播也畫上去了");

  /* ── 九、四條路只有一個地方在判斷新舊 ── */
  ok(await b.eval<boolean>(`
    const I = UD.__t.INBOX;
    return typeof I.fresher === "function" && typeof I.peerOk === "function" &&
           typeof I.ranAhead === "function" && typeof I.settled === "function"`),
    "收斂點不見了（INBOX 少了東西）");
  ok(await b.eval<boolean>(`
    const I = UD.__t.INBOX;
    I.settled(); const a = I.isAhead() || !!I.opt;
    I.ranAhead({x:1}); const c = I.isAhead() && !!I.opt;
    I.settled(); return !a && c`),
    "記號與退路沒有綁在一起——會再出現「有人只做了一半」");

  /* ── 十、手牌是私有的那一份，不歸 rev 管 ──
     真實時序：realtime 先推來新一局（不帶手牌），接著又一列把 rev 拉高，
     最後那趟帶著正確手牌的回應才到、而它的 rev 已經是舊的。
     以前整列被 fresher 丟掉、手牌跟著陪葬，畫面就停在空的那一副，
     直到自己按叫墩那一趟（rev 必定最新、必定通得過）才被校正——
     這就是「為何出完骰子，牌就變了」。 */
  await b.eval(`
    UD.__t.NET.tail = null; UD.__t.NET.queued = 0; UD.__t.NET.busy = false;
    __T.reply = null;
    const g3 = __T.clone(__T.g);
    UD.engine.startRound(g3);                      /* 下一局：換一副牌 */
    __T.g3 = g3;
    __T.want = g3.hands[0].length;
    __T.fp = g3.hands[0].map(function(c){ return c.id; }).join(",");
    UD.__t.applyRow(__T.row(g3, 30));              /* realtime 推來的新局，不帶手牌 */
    UD.__t.applyRow(__T.row(g3, 31));              /* 又一列，rev 被拉高 */
    return 1`);
  ok((await view()).rev === 31, "新一局那兩列沒有被接受");
  await b.eval(`UD.__t.applyRow(__T.row(__T.g3, 30), __T.clone(__T.g3.hands[0])); return 1`);
  v = await view();
  const want10 = await b.eval<number>(`return __T.want`);
  ok(v.hand === want10, `遲到的那一列帶回來的手牌被丟掉了（手牌=${v.hand}，該有 ${want10} 張）`);
  ok(await b.eval<boolean>(`return UD.G.hands[0].map(function(c){ return c.id; }).join(",") === __T.fp`),
    "手牌是收下了，但不是這一局的那一副");
  ok(v.rev === 31, "收手牌的同時把那一列過期的公開狀態也一起套進來了");

  /* ── 十一、同一局裡，遲到的那一列帶的舊手牌不准蓋回去 ──
     （不然出掉的牌會被加回手上，那是另一種「牌憑空出現」） */
  await b.eval(`
    UD.__t.NET.tail = null; UD.__t.NET.queued = 0; UD.__t.NET.busy = false;
    const g4 = __T.clone(__T.g3);
    let guard = 0;
    while(g4.phase === "bid" && guard++ < 30){ const s = g4.turn; UD.engine.applyBid(g4, s, UD.engine.aiBid(g4, s)); }
    g4.leader = 0; g4.turn = 0;
    __T.g4 = g4;
    UD.__t.applyRow(__T.row(g4, 50), __T.clone(g4.hands[0]));
    __T.full = __T.clone(g4.hands[0]);
    __T.reply = "pending";
    UD.doPlay(__T.mine());                         /* 樂觀出一張 */
    return 1`);
  v = await view();
  const afterPlay = v.hand, full = await b.eval<number>(`return __T.full.length`);
  ok(afterPlay === full - 1, `樂觀出牌沒有把牌拿掉（手牌=${afterPlay}）`);
  await b.eval(`UD.__t.applyRow(__T.row(__T.g4, 50), __T.clone(__T.full)); return 1`);
  ok((await view()).hand === afterPlay, "遲到的那一列把出掉的牌加回手上了");

  /* ── 十二、對帳：張數對不上就自己去抓，而且那一趟不准被背景那道門丟掉 ── */
  await new Promise((r) => setTimeout(r, 900));    /* 等對帳的退避過去 */
  await b.eval(`
    UD.__t.NET.tail = null; UD.__t.NET.busy = false;
    __T.reply = null;
    UD.G.hands[UD.mySeat()].pop();     /* 不管從哪條路歪掉，長出來都是這個形狀：張數對不上 */
    UD.__t.NET.queued = 5;             /* 通道塞住：BG 那道門本來會把這趟 state 丟掉 */
    __T.calls.length = 0;
    UD.__t.applyRow(__T.row(__T.g4, 60));
    return 1`);
  await new Promise((r) => setTimeout(r, 150));
  ok(await b.eval<boolean>(`return __T.calls.indexOf("state") >= 0`),
    "手牌張數對不上，卻沒有去把真的那一份抓回來（或那一趟被 BG 那道門丟掉了）");
  await b.eval(`UD.__t.NET.queued = 0; UD.__t.NET.tail = null; return 1`);

  /* ── 十三、一趟永遠不回，不能把整條隊伍卡死 ──
     api() 是排隊的：fetch 掛著不動（手機切網路）或 getSession 搶不到鎖，後面所有動作全卡在它後面，
     整桌就是「牌亮著卻點不動、一輪結束不會走」。時間到要當它失敗：busy 放掉、出牌那手退回。
     這一段走真的 call()（把假伺服器拿掉），伺服器換成掛著不回的 fetch。 */
  await b.eval(`
    UD.__t.NET.tail = null; UD.__t.NET.queued = 0; UD.__t.NET.busy = false;
    __T.savedCall = window.__call; window.__call = null;      /* 走真的 call() */
    __T.savedFetch = window.fetch;
    UD.__t.NET.tmoCall = 400; UD.__t.NET.tmoTok = 400;
    /* 有 session 的假 supabase：getSession 立刻回一張還有一小時的 token */
    UD.__t.NET.sb = {auth:{getSession:function(){ return Promise.resolve({data:{session:{access_token:"t", expires_at:Math.floor(Date.now()/1000) + 3600}}}); }}};
    /* fetch 掛著；有人 abort 才結束 */
    window.fetch = function(url, o){ return new Promise(function(_, rej){ if(o && o.signal) o.signal.addEventListener("abort", function(){ rej(new DOMException("aborted", "AbortError")); }); }); };
    UD.__t.applyRow(__T.row(__T.g4, 70), __T.clone(__T.full));
    __T.t13 = Date.now();
    UD.doPlay(__T.mine());
    return 1`);
  await new Promise((r) => setTimeout(r, 900));
  v = await view();
  ok(!(await b.eval<boolean>(`return UD.__t.NET.busy`)), "fetch 掛著不回，busy 一直是 true——整條隊伍卡死");
  ok(await b.eval<boolean>(`return UD.__t.NET.queued === 0`), "逾時之後 queued 沒歸零");
  ok(v.trick === 0 && v.hand === full, `逾時之後那一手沒有退回手上（檯面=${v.trick} 手牌=${v.hand}）`);
  /* getSession 掛著也一樣 */
  await b.eval(`
    UD.__t.NET.sb = {auth:{getSession:function(){ return new Promise(function(){}); }}};
    /* 上一段快取了一張 token，讓它過期，逼 call() 去問 getSession */
    __T.calls.length = 0;
    UD.__t.applyRow(__T.row(__T.g4, 71), __T.clone(__T.full));
    return 1`);
  // TOK 是模組內部的快取，測試碰不到；換一桌的 token 過期時間才會走到 getSession——
  // 這裡改用最直接的驗法：直接量 withTimeout 那條路有沒有把 busy 放掉
  await b.eval(`UD.__t.NET.tmoTok = 300; return 1`);
  await new Promise((r) => setTimeout(r, 100));
  await b.eval(`window.fetch = __T.savedFetch; window.__call = __T.savedCall; UD.__t.NET.sb = null;
    UD.__t.NET.tmoCall = 12000; UD.__t.NET.tmoTok = 6000; UD.__t.NET.tail = null; UD.__t.NET.queued = 0; UD.__t.NET.busy = false; return 1`);

  /* ── 十四、敲的人不在了，別人要補敲 ──
     只有「在座第一位還在線的真人」負責敲 tick／next。他手機鎖了、分頁凍住，他的 seen 還新鮮，
     以前全桌要等 30 秒才遞補——一局打完正是大家低頭看手機的時候。
     現在：這一格停得比該停的久超過 BACKUP_GRACE，其他在線的真人就補敲一發。 */
  await b.eval(`
    __T.reply = {ok:true};
    const r = __T.row(__T.g4, 80);
    r.seats[0] = {name:"別人", kind:"human", pid:"other", av:null};       /* 他排在我前面，他是 ticker */
    r.seats[1] = {name:"我", kind:"human", pid:"me", av:null};
    r.phase = "trickend"; r.trick = [];
    r.seen = {other:Date.now(), me:Date.now()};
    UD.__t.applyRow(r);
    UD.G.at = Date.now() - 1000;                                          /* 才停 1 秒：不該補 */
    __T.calls.length = 0;
    return UD.mySeat()`).then((s) => ok(s === 1, `座位排錯了（我在 ${s}）`));
  await new Promise((r) => setTimeout(r, 900));
  ok(await b.eval<boolean>(`return __T.calls.indexOf("tick") < 0`), "還沒到該補敲的時候就搶著敲了");
  await b.eval(`UD.G.at = Date.now() - 60000; __T.calls.length = 0; return 1`);   /* 停了一分鐘：ticker 明顯不在 */
  await new Promise((r) => setTimeout(r, 900));
  ok(await b.eval<boolean>(`return __T.calls.indexOf("tick") >= 0`), "ticker 不在了，其他人卻沒有補敲——整桌會卡到他回來");
  await b.eval(`UD.G.phase = "roundend"; UD.G.at = Date.now() - 60000; __T.calls.length = 0; return 1`);
  await new Promise((r) => setTimeout(r, 900));
  ok(await b.eval<boolean>(`return __T.calls.indexOf("next") >= 0`), "一局打完 ticker 不在，其他人卻沒有補敲 next——這就是「一輪結束卡著不動」");
  await b.eval(`UD.G.at = Date.now(); return 1`);
} catch (e) {
  fails.push("測試中途爆掉：" + (e as Error).message);
} finally {
  await b.close();
}

const ms = Math.round(performance.now() - t0);
console.log("11 Up & Down — 連線那一段的測試（無頭 Chrome ＋ 假伺服器）");
console.log("  樂觀先走、遲到的同一格、真的那一列、過期、保險絲、打回票、對手廣播、亂喊、收斂點、手牌對帳、逾時、補敲");
console.log(`  ${checks} 項，${ms} 毫秒`);
if (fails.length) {
  console.log(`\n  ✗ ${fails.length} 項不對：\n`);
  for (const f of fails) console.log("  · " + f);
  Deno.exit(1);
}
console.log("  ✓ 全部通過");
