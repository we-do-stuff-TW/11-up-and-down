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
  calls: [], args: {}, reply: null, sfx: 0,
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
      T.calls.push(action); T.args[action] = args;
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
  mine(){ return UD.legalCards(UD.G.hands[UD.mySeat()], UD.G.led)[0].id; },
  /* 丟掉隊伍：前一段故意掛著不回的那一趟永遠不會走到 done()，它記的帳要由測試歸零。
     ⚠️ 只准從這裡清。以前十二處各寫各的三個欄位，api() 多一個 urgent 之後沒有一處知道，
     一趟掛著的出牌就讓後面每一趟背景呼叫都在讓路（plan 0006 撞到的）。 */
  flush(){
    const N = UD.__t.NET;
    N.tail = null; N.queued = 0; N.busy = false; N.urgent = 0; N.ac = null;
    /* 掛著不回的那一趟如果是我出的牌，它那一手也永遠等不到回話：一起作廢。
       ⚠️ 以前不清也沒事，是因為出牌那一手撐不過下一列（疊不回去）——plan 0007 修好之後它疊得回去，
       十一段留下的那一手就一路活到十三段，被當成這一段的牌重演（十三段紅在「逾時之後那一手沒有退回手上」） */
    UD.__t.INBOX.settled();
  },
  /* 一墩剛打完的那一列：全桌每人一張在檯面上。伺服器只在湊滿 n 張時才進 trickend（index.ts applyPlay），
     而且收這一墩的同一步就清掉檯面——trickend 配空的檯面是不可能的狀態。
     以前這裡寫 trick:[]，靠前一段留下的 NET.err 讓狀態列整列換成紅字、沒去讀檯面才沒爆。 */
  trickEnd(r, g){
    r.phase = "trickend";
    r.trick = g.hands.map(function(h, i){ return {p:i, card:h[0]}; });
    r.led = r.trick[0].card.s;
    return r;
  }
};
return 1;`;

const view = () => b.eval<{ trick: number; hand: number; rev: number; at: number; ahead: boolean; opt: boolean; sfx: number }>(
  `return {trick:UD.G.trick.length, hand:UD.G.hands[UD.mySeat()].length, rev:UD.G.rev,
           at:UD.G.at, ahead:UD.__t.INBOX.isAhead(), opt:!!UD.__t.INBOX.opt, sfx:window.__T.sfx}`,
);

try {
  await b.open("?lang=zh&dim=2&pace=1&hold=1");
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
    __T.flush();
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
    __T.flush();
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
    __T.flush();
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
    __T.flush();
    __T.reply = null;
    UD.G.hands[UD.mySeat()].pop();     /* 不管從哪條路歪掉，長出來都是這個形狀：張數對不上 */
    UD.__t.NET.queued = 5;             /* 通道塞住：BG 那道門本來會把這趟 state 丟掉 */
    UD.__t.NET.urgent = 1;             /* 也有玩家的動作排著：「讓路」那道門本來也會把它跳過 */
    __T.calls.length = 0;
    UD.__t.applyRow(__T.row(__T.g4, 60));
    return 1`);
  await new Promise((r) => setTimeout(r, 150));
  ok(await b.eval<boolean>(`return __T.calls.indexOf("state") >= 0`),
    "手牌張數對不上，卻沒有去把真的那一份抓回來（或那一趟被 BG 那道門丟掉了）");
  await b.eval(`__T.flush(); return 1`);

  /* ── 十三、一趟永遠不回，不能把整條隊伍卡死 ──
     api() 是排隊的：fetch 掛著不動（手機切網路）或 getSession 搶不到鎖，後面所有動作全卡在它後面，
     整桌就是「牌亮著卻點不動、一輪結束不會走」。時間到要當它失敗：busy 放掉、出牌那手退回。
     這一段走真的 call()（把假伺服器拿掉），伺服器換成掛著不回的 fetch。 */
  await b.eval(`
    __T.flush();
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
    UD.__t.NET.tmoCall = 12000; UD.__t.NET.tmoTok = 6000; __T.flush(); UD.__t.NET.err = ""; return 1`);

  /* ── 十四、敲的人不在了，別人要補敲 ──
     只有「在座第一位還在線的真人」負責敲 tick／next。他手機鎖了、分頁凍住，他的 seen 還新鮮，
     以前全桌要等 30 秒才遞補——一局打完正是大家低頭看手機的時候。
     現在：這一格停得比該停的久超過 BACKUP_GRACE，其他在線的真人就補敲一發。 */
  await b.eval(`
    __T.reply = {ok:true};
    const r = __T.row(__T.g4, 80);
    r.seats[0] = {name:"別人", kind:"human", pid:"other", av:null};       /* 他排在我前面，他是 ticker */
    r.seats[1] = {name:"我", kind:"human", pid:"me", av:null};
    __T.trickEnd(r, __T.g4);
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
  ok(await b.eval<boolean>(`return !!__T.args.next && __T.args.next.ri === UD.G.ri`),
    "補敲 next 沒帶局數——好幾個人同時開下一局，伺服器分不出那一局開過了沒（兩副牌）");
  await b.eval(`UD.G.at = Date.now(); return 1`);

  /* ── 十五、即時那條線斷了要知道，接回來要補問 ──
     2026-10-08 房間 5527：一晚上即時訂閱重接十幾次，斷著的那段推播不會補送。
     以前客端不聽 subscribe 的狀態，接回來以後畫面停在斷線前那一格——「輪到你」看不到。
     這裡走真的 subscribe()，只把 supabase 的 channel 換成假的，斷線、接上由測試來喊。
     輪到我（活著的真人）出牌，ticker 不會敲，通道上只會有心跳與補問。 */
  const states = () => b.eval<number>(`return __T.calls.filter(function(a){ return a === "state"; }).length`);
  await b.eval(`
    __T.reply = {ok:true};
    __T.flush();
    const r = __T.row(__T.g, 100); r.seen = {me:Date.now()};
    UD.__t.applyRow(r, __T.clone(__T.g.hands[0]));
    __T.subs = []; __T.removed = 0;
    UD.__t.NET.sb = {
      channel:function(){
        const c = {on:function(){ return c; }, send:function(){},
                   subscribe:function(cb){ __T.subs.push(cb); return c; }};
        return c;
      },
      removeChannel:function(){ __T.removed++; }
    };
    UD.__t.subscribe("TEST");
    __T.calls.length = 0;
    return 1`);
  await new Promise((r) => setTimeout(r, 4500));
  ok(await states() >= 2, `還沒接上（斷著）的 4.5 秒裡只問了 ${await states()} 次——斷線時還在等 10 秒一次的心跳`);
  /* 接上的那一刻：就算通道上有東西在排隊，也要問一次（背景那道門不能擋） */
  await b.eval(`__T.calls.length = 0; UD.__t.NET.queued = 1; __T.subs[0]("SUBSCRIBED"); return 1`);
  await new Promise((r) => setTimeout(r, 150));
  ok(await states() === 1, `重新接上之後沒有補問狀態（state ${await states()} 次）——漏掉的那段永遠補不回來`);
  await b.eval(`__T.flush(); __T.calls.length = 0; return 1`);
  await new Promise((r) => setTimeout(r, 3500));
  ok(await states() === 0, `接上之後還在 2 秒一次地問（${await states()} 次）——線是好的就該回到 10 秒`);
  /* 又斷了 */
  await b.eval(`__T.calls.length = 0; __T.subs[0]("CHANNEL_ERROR"); return 1`);
  await new Promise((r) => setTimeout(r, 2500));
  ok(await states() >= 1, "斷線（CHANNEL_ERROR）之後沒有加快問狀態");
  /* 換一條新的：舊的那條被拆掉時回報的 CLOSED 不能把新的標成斷線 */
  const rt = await b.eval<string>(`UD.__t.subscribe("TEST"); __T.subs[1]("SUBSCRIBED"); __T.subs[0]("CLOSED");
    return UD.__t.NET.rt + "/" + __T.removed`);
  ok(rt === "SUBSCRIBED/1", `舊訂閱拆掉時的 CLOSED 蓋到新的那條上了（${rt}）`);
  await b.eval(`UD.__t.NET.sb = null; UD.__t.NET.chan = null; UD.__t.NET.rt = ""; return 1`);

  /* ════ 以下是 plan 0006（2026-10-18）：健檢在真頁面上重現的那幾條，一條一段 ════ */
  /* 走真的 call()：伺服器換成測試給的 fetch（回 JSON 或掛著），token 由假的 session 給 */
  await b.eval(`
    __T.real = function(fetchImpl){
      __T.flush();
      UD.__t.NET.err = ""; UD.__t.NET.bgFail = 0;
      UD.__t.NET.skew = 0; UD.__t.NET.skewRtt = Infinity; UD.__t.NET.skewAt = 0;
      if(!__T.savedCall2) __T.savedCall2 = window.__call;
      if(!__T.savedFetch2) __T.savedFetch2 = window.fetch;
      window.__call = null;
      UD.__t.NET.sb = {auth:{getSession:function(){ return Promise.resolve({data:{session:{access_token:"t", expires_at:Math.floor(Date.now()/1000) + 3600}}}); }}};
      __T.sent = [];
      window.fetch = function(url, o){ const body = JSON.parse(o.body); __T.sent.push(body.action); return fetchImpl(body, o); };
    };
    __T.fake = function(){
      window.__call = __T.savedCall2; window.fetch = __T.savedFetch2; UD.__t.NET.sb = null;
      __T.flush();
      UD.__t.NET.err = ""; UD.__t.NET.bgFail = 0; UD.__t.NET.skew = 0; UD.__t.NET.skewRtt = Infinity;
    };
    __T.json = function(d, status){ return Promise.resolve(new Response(JSON.stringify(d), {status:status || 200, headers:{"content-type":"application/json"}})); };
    __T.hang = function(o){ return new Promise(function(_, rej){ o.signal.addEventListener("abort", function(){ rej(new DOMException("aborted", "AbortError")); }); }); };
    /* 叫墩階段、輪到我（0 號）；sim 為真就是同時叫墩 */
    __T.bidTable = function(rev, sim){
      const g = __T.clone(__T.g3);
      g.phase = "bid"; g.bids = g.bids.map(function(){ return null; }); g.turn = 0; g.starter = 0;
      g.cfg = Object.assign({}, g.cfg, {bidMode:sim ? "sim" : "seq"});
      __T.gb = g;
      UD.__t.applyRow(__T.row(g, rev), __T.clone(g.hands[0]));
      return g;
    };
    __T.bidButtons = function(){ return document.querySelectorAll("#status [data-bid]").length; };
    return 1`);

  /* ── 十六、排在慢請求後面很久：同一格的列不准抹掉還在路上的那一手 ──
     以前保險絲 6 秒從按下去那一刻算。前面一趟 state 慢 5 秒、叫墩又等了幾秒，
     別人報到推來的同 rev 列一到，先演的那一手就被抹掉，人再按一次就被 409（健檢 T4c） */
  await b.eval(`
    __T.flush();
    __T.reply = "pending";
    UD.__t.applyRow(__T.row(__T.g4, 200), __T.clone(__T.full));
    UD.doPlay(__T.mine());
    UD.__t.INBOX.at = Date.now() - 9000;           /* 已經在路上 9 秒了 */
    const r = __T.row(__T.g4, 200); r.seen = {me:Date.now(), x:Date.now()};
    UD.__t.applyRow(r);                            /* 別人報到推來的：同一個 rev */
    return 1`);
  v = await view();
  ok(v.trick === 1 && v.hand === full - 1, `還在路上的那一手被同一格的列抹掉了（檯面=${v.trick} 手牌=${v.hand}）`);
  ok(v.ahead, "那一手還在路上，保險絲卻已經燒斷");
  await b.eval(`UD.__t.INBOX.settled(); return 1`);

  /* ── 十七、同時叫墩：別人先寫進去的那一列先到，我的骰子要疊回去 ──
     以前那一列一收，我的骰子收回、叫墩按鈕又冒出來，人只好再按一次 */
  await b.eval(`
    __T.flush();
    __T.reply = "pending";
    __T.bidTable(300, true);
    UD.__t.doBid(1);
    const g = __T.clone(__T.gb); g.bids[2] = -1;    /* 2 號先寫進去了，裡面還沒有我 */
    UD.__t.applyRow(__T.row(g, 301));
    return 1`);
  const s17 = await b.eval<{ mine: unknown; two: unknown; rev: number; btn: number; ahead: boolean }>(
    `return {mine:UD.G.bids[0], two:UD.G.bids[2], rev:UD.G.rev, btn:__T.bidButtons(), ahead:UD.__t.INBOX.isAhead()}`);
  ok(s17.rev === 301 && s17.two === -1, `比較新的那一列沒有被收下（rev=${s17.rev}）`);
  ok(s17.mine === -1 && s17.btn === 0, `別人的列一到，我的骰子就收回去了（我的=${s17.mine}、按鈕 ${s17.btn} 顆）`);
  ok(s17.ahead, "疊回去之後沒有繼續等回話");
  await b.eval(`const g = __T.clone(__T.gb); g.bids[2] = -1; g.bids[0] = -1;
    UD.__t.applyRow(__T.row(g, 302)); return 1`);       /* 我的那一手寫進去了 */
  ok(!(await b.eval<boolean>(`return UD.__t.INBOX.isAhead() || !!UD.__t.INBOX.pend`)), "我那一手寫進去了，記號卻還在");

  /* ── 十八、房主不在線：叫墩按鈕照樣要在 ──
     09-09 第一版是房主在自己手機上跑引擎，那時房主不在牌局就真的停了。引擎搬到伺服器以後
     那道門只剩把按鈕收掉：房主鎖屏 30 秒，其他人全部叫不了墩（健檢 T1） */
  await b.eval(`
    __T.reply = {ok:true};
    const g = __T.bidTable(400, false);
    const r = __T.row(g, 401);
    r.seats[1] = {name:"房主", kind:"human", pid:"host", av:null};
    r.host_pid = "host"; r.seen = {me:Date.now(), host:Date.now() - 60000};
    UD.__t.applyRow(r, __T.clone(g.hands[0]));
    return 1`);
  ok(await b.eval<number>(`return __T.bidButtons()`) > 0, "房主離線，輪到我叫墩卻沒有按鈕（「房主已離線」那道門還在）");

  /* ── 十九、背景那一趟斷一次不算數；就算真的斷線了，按鈕也不准收 ── */
  /* 結果在那一趟的 promise 裡當場讀：心跳 10 秒一次，隔幾百毫秒再看的話偶爾會被它多算一次 */
  const e1 = await b.eval<{ err: string; btn: number }>(`
    __T.real(function(){ return Promise.reject(new TypeError("Failed to fetch")); });
    return UD.__t.api("state", {code:"TEST"}).then(function(){ return {err:UD.__t.NET.err, btn:__T.bidButtons()}; })`);
  ok(!e1.err, `心跳斷一次就掛紅字了（${e1.err}）`);
  ok(e1.btn > 0, "心跳斷一次，叫墩按鈕就不見了");
  const e2 = await b.eval<{ err: string; btn: number }>(`
    return UD.__t.api("state", {code:"TEST"}).then(function(){ return {err:UD.__t.NET.err, btn:__T.bidButtons()}; })`);
  ok(!!e2.err, "連斷兩次還是一聲不吭——真的斷線了要讓人知道");
  ok(e2.btn > 0, "說了連不上，順手把叫墩按鈕收掉了（錯誤只該換掉那一句話）");

  /* ── 二十、玩家的動作插隊：背景那一趟掛著，叫墩照樣馬上送出去 ── */
  await b.eval(`
    __T.real(function(body, o){
      if(body.action === "state") return __T.hang(o);
      return __T.json({ok:true, pid:"me", room:__T.row(__T.gb, 450), hand:__T.clone(__T.gb.hands[0]), now:Date.now()});
    });
    UD.__t.NET.tmoCall = 3000;
    __T.bidTable(440, false);
    UD.__t.api("state", {code:"TEST"});              /* 背景那一趟：掛著 */
    __T.t20 = Date.now();
    return 1`);
  await new Promise((r) => setTimeout(r, 50));
  await b.eval(`UD.__t.doBid(0); return 1`);
  await new Promise((r) => setTimeout(r, 300));
  const s20 = await b.eval<{ sent: string[]; err: string; rev: number }>(
    `return {sent:__T.sent.slice(), err:UD.__t.NET.err, rev:UD.G.rev}`);
  ok(s20.sent.indexOf("bid") >= 0, `叫墩排在掛著的背景呼叫後面，300ms 還沒送出去（送了：${s20.sent.join(",")}）`);
  ok(s20.rev === 450, `叫墩送出去了，回來的那一列卻沒收（rev=${s20.rev}）`);
  ok(!s20.err, `背景那一趟讓路被當成連線錯誤（${s20.err}）`);
  /* 同一個 task 裡：背景那一趟剛排進去、還沒開跑（沒有東西可以放掉），玩家就按下去了。
     輪到它時要跳過，不然叫墩排在它後面，等它掛到逾時 */
  const s20b = await b.eval<{ sent: string[] }>(`
    __T.real(function(body, o){
      if(body.action === "state") return __T.hang(o);
      return __T.json({ok:true, pid:"me", room:__T.row(__T.gb, 470), hand:__T.clone(__T.gb.hands[0]), now:Date.now()});
    });
    __T.bidTable(465, false);
    UD.__t.api("state", {code:"TEST"});
    UD.__t.doBid(0);
    return new Promise(function(r){ setTimeout(function(){ r({sent:__T.sent.slice()}); }, 300); })`);
  ok(s20b.sent.indexOf("bid") >= 0 && s20b.sent.indexOf("state") < 0,
    `還沒開跑的背景呼叫沒有讓路，叫墩排在它後面（送了：${s20b.sent.join(",")}）`);
  /* 被放掉的那一趟不算一次斷線：前一趟心跳剛斷過一次，這時玩家按下去把背景那趟放掉——
     不准因此湊滿兩次，在玩家那一趟回來之前閃一下「連不上」（回來之後會被蓋掉，所以要在途中看） */
  const s20c = await b.eval<{ err: string }>(`
    __T.real(function(body, o){
      if(body.action === "state") return __T.hang(o);
      return new Promise(function(r){ setTimeout(r, 400); }).then(function(){
        return __T.json({ok:true, pid:"me", room:__T.row(__T.gb, 480), hand:__T.clone(__T.gb.hands[0]), now:Date.now()});
      });
    });
    __T.bidTable(475, false);
    UD.__t.NET.bgFail = 1;
    UD.__t.api("state", {code:"TEST"});
    return new Promise(function(r){ setTimeout(r, 50); }).then(function(){
      UD.__t.doBid(0);
      return new Promise(function(r){ setTimeout(function(){ r({err:UD.__t.NET.err}); }, 150); });
    })`);
  ok(!s20c.err, `背景那一趟讓路被算成一次斷線，湊滿兩次閃出「${s20c.err}」`);
  await new Promise((r) => setTimeout(r, 400));
  await b.eval(`UD.__t.NET.tmoCall = 12000; return 1`);

  /* ── 二十一、被打回票時帶回來的那一列照收：退回的是真相，不是按之前那一格 ── */
  await b.eval(`
    __T.real(function(body){
      const g = __T.clone(__T.g4); g.turn = 2;           /* 伺服器那邊：早就不是我的回合了 */
      return __T.json({error:"這張牌不能出", pid:"me", room:__T.row(g, 520), hand:__T.clone(__T.full), now:Date.now()}, 409);
    });
    UD.__t.applyRow(__T.row(__T.g4, 510), __T.clone(__T.full));
    UD.doPlay(__T.mine());
    return 1`);
  await new Promise((r) => setTimeout(r, 300));
  const s21 = await b.eval<{ rev: number; turn: number; trick: number; ahead: boolean; err: string }>(
    `return {rev:UD.G.rev, turn:UD.G.turn, trick:UD.G.trick.length, ahead:UD.__t.INBOX.isAhead(), err:UD.__t.NET.err}`);
  ok(s21.rev === 520 && s21.turn === 2, `409 帶回來的那一列沒收，畫面退回按之前那一格（rev=${s21.rev} turn=${s21.turn}）`);
  ok(s21.trick === 0 && !s21.ahead, "被打回票了，那張牌還留在檯面上");
  ok(!!s21.err, "被打回票卻一聲不吭");

  /* ── 二十二、手機時鐘快 40 秒：不會覺得全桌都離線 ── */
  await b.eval(`
    __T.real(function(){
      const r = __T.row(__T.g4, 600); r.seen = {me:Date.now() - 40000, x:Date.now() - 40000};
      return __T.json({ok:true, pid:"me", room:r, hand:__T.clone(__T.full), now:Date.now() - 40000});
    });
    return 1`);
  ok(await b.eval<boolean>(`return UD.__t.api("state", {code:"TEST"}, true).then(function(){ return UD.__t.isLive("x") && UD.__t.isLive("me"); })`),
    "伺服器時鐘慢 40 秒（＝手機快 40 秒），剛報到的人被當成離線了");
  await b.eval(`__T.fake(); return 1`);

  /* ── 二十三、補敲錯開：第二個補敲的人再晚 1.5 秒 ── */
  await b.eval(`
    __T.reply = {ok:true};
    const r = __T.row(__T.g4, 700);
    r.seats[0] = {name:"ticker", kind:"human", pid:"other", av:null};
    r.seats[1] = {name:"先補", kind:"human", pid:"x", av:null};
    r.seats[2] = {name:"我", kind:"human", pid:"me", av:null};
    __T.trickEnd(r, __T.g4);
    r.seen = {other:Date.now(), x:Date.now(), me:Date.now()};
    UD.__t.applyRow(r);
    __T.due = UD.trickGap();
    return UD.mySeat()`).then((s) => ok(s === 2, `座位排錯了（我在 ${s}）`));
  const due = await b.eval<number>(`return __T.due`);
  if (due > 0) {
    await b.eval(`UD.G.at = Date.now() - (__T.due + 4000 + 600); __T.calls.length = 0; return 1`);
    await new Promise((r) => setTimeout(r, 900));
    ok(await b.eval<boolean>(`return __T.calls.indexOf("tick") < 0`), "排第二個補敲的人跟第一個同一刻就敲了（沒有錯開）");
    await b.eval(`UD.G.at = Date.now() - (__T.due + 4000 + 1500 + 600); __T.calls.length = 0; return 1`);
    await new Promise((r) => setTimeout(r, 900));
    ok(await b.eval<boolean>(`return __T.calls.indexOf("tick") >= 0`), "排第二個補敲的人等過了自己那一格還是沒敲");
  } else ok(false, "trickGap 量出來不是正數，補敲錯開這段沒驗");
  await b.eval(`UD.G.at = Date.now(); return 1`);

  /* ── 二十四、離開之後，舊頻道進來的列不准把我拉回去 ── */
  await b.eval(`
    __T.handlers = [];
    UD.__t.NET.sb = {
      channel:function(){
        const c = {on:function(type, f, cb){ __T.handlers.push({type:type, cb:cb, ch:c}); return c; }, send:function(){},
                   subscribe:function(){ return c; }};
        return c;
      },
      removeChannel:function(){}
    };
    UD.__t.subscribe("TEST");
    const old = __T.handlers.filter(function(h){ return h.type === "postgres_changes"; })[0];
    UD.__t.subscribe("OTHR");
    const r = __T.row(__T.g4, 900);                 /* 舊房 TEST 的一列，rev 很新 */
    old.cb({new:r});
    const code = UD.__t.NET.code;
    UD.__t.NET.sb = null; UD.__t.NET.chan = null; UD.__t.NET.rt = "";
    return code`).then((c) => ok(c === "OTHR", `已經換到別桌了，舊頻道的列把我拉回 ${c}`));

  /* ── 二十五、舊伺服器搶頁輸了回 200＋一列沒有我那一手的：不准把那一手疊回去 ──
     新伺服器的回話一定含著那一手（不行的話是 409），走不到這裡；但上線那段時間新網頁會配到舊伺服器。
     疊回去的話骰子擺在桌上、按鈕收起來，伺服器上卻沒有——等下一列推來才突然消失，人以為自己叫過了。 */
  const s25 = await b.eval<{ mine: unknown; btn: number }>(`
    __T.real(function(){
      const g = __T.clone(__T.gb); g.bids[1] = -1;    /* 1 號先寫進去的那一列：裡面沒有我的骰子 */
      return __T.json({ok:true, pid:"me", room:__T.row(g, 1002), hand:__T.clone(g.hands[0])});
    });
    __T.bidTable(1000, true);             /* rev 要比二十四留下的 900 新：整支的 rev 從上到下只增不減 */
    UD.__t.doBid(2);
    return new Promise(function(r){ setTimeout(function(){ r({mine:UD.G.bids[0], btn:__T.bidButtons()}); }, 300); })`);
  ok((s25.mine === null || s25.mine === undefined) && s25.btn > 0,
    `舊伺服器回 200 卻沒寫進去，我的骰子還擺在桌上（我的=${s25.mine}、按鈕 ${s25.btn} 顆）——人會以為叫過了`);
  await b.eval(`__T.fake(); return 1`);

  /* ════ 以下是 plan 0007（2026-10-21）：對手剛出、我馬上跟的那一下 ════
     劇本來自 10-21 兩人桌的 ?trace=1：對手的廣播約 0.05 秒到，他那一手寫進資料庫的列要 0.7–1.9 秒才到。
     我在中間出牌，那一列就夾在「我先演的那一手」與「伺服器回我的話」之間。 */
  /* 輪到 3 號、他廣播出牌、我馬上跟（伺服器掛著不回）。回傳那張牌 */
  await b.eval(`
    __T.follow = function(rev){
      __T.flush();
      const g = __T.clone(__T.g4); g.leader = 3; g.turn = 3; g.trick = []; g.led = null;
      UD.__t.applyRow(__T.row(g, rev), __T.clone(g.hands[0]));
      const c = g.hands[3][0];
      UD.__t.peerMove({t:"play", seat:3, card:{s:c.s, r:c.r, id:c.id}});
      const after = __T.clone(g); UD.engine.applyPlay(after, 3, c.id);
      __T.peerAfter = after;                              /* 他那一手寫進去之後的伺服器桌面 */
      __T.my = __T.mine(); UD.doPlay(__T.my);
      return g;
    };
    return 1`);
  const look = () => b.eval<{ rev: number; turn: number; trick: string; mineOnTable: number; inHand: boolean; hand: number; ahead: boolean }>(`
    return {rev:UD.G.rev, turn:UD.G.turn, trick:UD.G.trick.map(function(t){ return t.p; }).join(","),
            mineOnTable:UD.G.trick.filter(function(t){ return t.card.id === __T.my; }).length,
            inHand:UD.G.hands[0].some(function(c){ return c.id === __T.my; }), hand:UD.G.hands[0].length,
            ahead:UD.__t.INBOX.isAhead()}`);
  const nFull = await b.eval<number>(`return __T.full.length`);

  /* ── 二十六、對手那一列（不帶手牌、裡面還沒有我）比我的回話先到：我那張要疊回去 ──
     以前：出牌時那張已經從手牌陣列裡拿掉了，疊回去要再出一次卻找不到它，就放棄（log 的 pend play noreplay）。
     畫面上檯面、手上都沒有那張，狀態列又說輪到我，手上其他牌亮著——再點一張就是第二次出牌。
     接著張數對帳以為手牌壞了，多排一趟 state（hand! want=N got=N-1）。 */
  await b.eval(`__T.reply = "pending"; __T.follow(1100); __T.q26 = UD.__t.NET.queued;
    UD.__t.applyRow(__T.row(__T.peerAfter, 1101)); return 1`);
  const s26 = await look();
  ok(s26.rev === 1101 && s26.trick === "3,0" && s26.mineOnTable === 1,
    `對手那一列先到，我那張從檯面上消失了（rev=${s26.rev}、檯面座位=${s26.trick || "空"}）`);
  ok(!s26.inHand && s26.hand === nFull - 1, `我那張疊回去之後手牌不對（還在手上=${s26.inHand}、${s26.hand} 張，該是 ${nFull - 1}）`);
  ok(s26.ahead && s26.turn !== 0, `疊回去了，卻沒有繼續等回話，或狀態列又說輪到我（turn=${s26.turn}）`);
  ok(await b.eval<boolean>(`return UD.__t.NET.queued === __T.q26`), "張數對帳以為手牌壞了，多排了一趟 state");
  /* 疊回去之後伺服器才否決（回話比那一列舊）：退回的是那一列＋那張在手上，不是那張不見了的樣子 */
  ok(await b.eval<boolean>(`const o = UD.__t.INBOX.opt; return !!o && o.hand.some(function(c){ return c.id === __T.my; })`),
    "疊回去之後的退路裡沒有那張牌——被否決時會退成牌不見了");

  /* ── 二十七、含著我那一手的列先到（realtime 比 HTTP 回話快）：那張不准回到手上 ──
     疊回去的那條路如果不看「這一墩我出過沒有」，牌會同時在手上與檯面上 */
  await b.eval(`__T.reply = "pending"; __T.follow(1200);
    const g = __T.clone(__T.peerAfter); UD.engine.applyPlay(g, 0, __T.my);
    UD.__t.applyRow(__T.row(g, 1201)); return 1`);
  const s27 = await look();
  ok(s27.rev === 1201 && s27.mineOnTable === 1 && !s27.inHand && s27.hand === nFull - 1,
    `含著我那一手的列先到，牌被重演或放回手上（檯面上 ${s27.mineOnTable} 張我的、還在手上=${s27.inHand}、手牌 ${s27.hand}）`);
  /* 我的回話更慢：那一墩已經收掉、下一墩又輪到我（同一局、多打了一墩）——這一列是我那一手還在路上時直接到的。
     那張早就出掉了，不准放回手上、也不准在新的一墩再出一次 */
  await b.eval(`__T.reply = "pending"; __T.follow(1250);
    const g = __T.clone(__T.peerAfter);
    g.trick = []; g.led = null; g.played = __T.peerAfter.played + 1; g.leader = 0; g.turn = 0;
    UD.__t.applyRow(__T.row(g, 1251)); return 1`);
  const s27b = await look();
  ok(s27b.rev === 1251 && !s27b.inHand && s27b.hand === nFull - 1 && s27b.trick === "",
    `下一墩又輪到我，已經出掉的那張被放回手上或又出了一次（還在手上=${s27b.inHand}、手牌 ${s27b.hand}、檯面座位=${s27b.trick || "空"}）`);

  /* ── 二十八、伺服器否決我那一手、帶回同一個 rev 的桌面：照收 ──
     伺服器等不到前一家（他的廣播是真的、但那一手沒寫進去）就回 409「還沒輪到你」，帶的那一列 rev 跟畫面一樣。
     以前同 rev ＋「已經演到下一格」一律不收（log 的 row! drop rev=833 … +hand same），
     退回的是按之前那一格：對手那張還沒寫進去的牌照樣在桌上、狀態列說輪到我——字卻說還沒輪到我 */
  await b.eval(`
    __T.real(function(){
      const g = __T.clone(__T.g4); g.leader = 3; g.turn = 3; g.trick = []; g.led = null;
      return __T.json({error:"還沒輪到你", pid:"me", room:__T.row(g, 1300), hand:__T.clone(__T.full), now:Date.now()}, 409);
    });
    __T.follow(1300);
    return 1`);
  await new Promise((r) => setTimeout(r, 300));
  const s28 = await look();
  const err28 = await b.eval<string>(`return UD.__t.NET.err`);
  ok(s28.rev === 1300 && s28.turn === 3 && s28.trick === "",
    `409 帶回來的同 rev 真相沒收：還留著對手沒寫進去的牌或我那張（turn=${s28.turn}、檯面座位=${s28.trick || "空"}）`);
  ok(s28.inHand && s28.hand === nFull && !s28.ahead, `被否決之後我那張沒回到手上（${s28.hand} 張，該是 ${nFull}）`);
  ok(!!err28, "被否決卻一聲不吭");
  /* 比畫面舊的否決照樣不收：那一列早就過時了，收了就是倒退 */
  await b.eval(`
    __T.real(function(){
      return __T.json({error:"還沒輪到你", pid:"me", room:__T.row(__T.peerAfter, 1399), hand:__T.clone(__T.full), now:Date.now()}, 409);
    });
    __T.follow(1400);
    return 1`);
  await new Promise((r) => setTimeout(r, 300));
  ok((await look()).rev === 1400, "比畫面舊的那一列跟著否決一起被收進來了（rev 倒退）");
  await b.eval(`__T.fake(); return 1`);

  /* ── 二十九、realtime 推來的列缺欄位：沒帶的那一欄是「沒變」，不是「空的」 ──
     2026-10-24 五人桌 48DC 第 18 局：rooms 那一列長過 2KB，Postgres 把 seats 存到列外（TOAST）。
     之後只改 seen 的心跳（game_seen）不碰 seats，邏輯複寫裡就沒有那一欄，realtime 推出來的那一列也就沒有 seats。
     以前 (row.seats||[]) 把「沒帶」當成「桌上沒人」：認不得自己（log 的 me=-1）→ 出牌被 noseat 擋掉、
     叫墩那排按鈕跟著每一次心跳消失又冒出來、ticker 每 420ms 一次 TypeError。
     存在列外的是哪一欄看那一刻誰最大（scripts/toast_probe.ts 重演三趟：seats 從第 1～6 局起，兩趟到第 17、18 局換成 log），所以兩欄都測。 */
  await b.eval(`__T.flush(); __T.reply = "pending";
    const g = __T.clone(__T.g); g.phase = "bid"; g.bids = g.bids.map(function(){ return null; });
    g.turn = 0; g.trick = []; g.led = null; g.played = 0;
    g.log = [{size:1, trump:0, cells:g.seats.map(function(){ return {bid:0, got:0, pts:10, hit:true}; })}];
    __T.g29 = g;
    UD.__t.applyRow(__T.row(g, 1500), __T.clone(g.hands[0]));
    return 1`);
  /* 心跳那一列：rev 不變、seen 換新、drop 那幾欄沒帶 */
  const beat = (rev: number, drop: string[], seen: number) => b.eval(`
    const r = __T.row(__T.g29, ${rev}); r.seen = {me:${seen}};
    ${JSON.stringify(drop)}.forEach(function(k){ delete r[k]; });
    try{ UD.__t.applyRow(r); }catch(e){ __T.err29 = String(e); }   /* 以前這裡會在畫座位時爆掉：照樣往下驗 */
    return 1`);
  const s29 = () => b.eval<{ seat: number; n: number; seen: number; log: number; btn: number; rev: number }>(`
    return {seat:UD.mySeat(), n:UD.G.seats.length, seen:UD.G.seen.me, log:UD.G.log.length, rev:UD.G.rev,
            btn:document.querySelectorAll("#status .bidbtn").length}`);
  ok((await s29()).btn > 0, "二十九段的前提不成立：輪到我叫墩，狀態列卻沒有叫墩按鈕");
  await beat(1500, ["seats"], 777);
  await new Promise((r) => setTimeout(r, 120));
  let v29 = await s29();
  ok(v29.seat === 0 && v29.n === 4, `心跳那一列沒帶座位，畫面就認不得我（座位=${v29.seat}、桌上 ${v29.n} 人）`);
  ok(v29.btn > 0, "心跳那一列一到，叫墩那排按鈕就不見了");
  ok(v29.seen === 777, "心跳那一列帶來的報到沒收（缺欄位的列整列丟掉，別人在不在線就停在舊的）");
  await beat(1500, ["log"], 778);
  v29 = await s29();
  ok(v29.log === 1, `心跳那一列沒帶計分紀錄，計分表就被清空（${v29.log} 局）`);
  ok(v29.seen === 778, "沒帶計分紀錄的那一列，帶來的報到沒收");
  /* rev 變了的那一列缺欄位：那一欄在中間可能改過，拿手上那份補是猜——不收，去問伺服器 */
  await b.eval(`__T.calls.length = 0; return 1`);
  await beat(1501, ["seats"], 779);
  v29 = await s29();
  const asked = await b.eval<boolean>(`return __T.calls.indexOf("state") >= 0`);
  ok(v29.rev === 1500 && v29.n === 4, `rev 變了又缺欄位的那一列被拿舊的補上收進來了（rev=${v29.rev}）`);
  ok(asked, "rev 變了又缺欄位的那一列丟掉了，卻沒有去問伺服器真的那一列");
  const err29 = await b.eval<string>(`return __T.err29 || ""`);
  ok(!err29, `缺欄位的那一列一套進來畫面就爆掉：${err29}`);
} catch (e) {
  fails.push("測試中途爆掉：" + (e as Error).message);
} finally {
  await b.close();
}

const ms = Math.round(performance.now() - t0);
console.log("11 Up & Down — 連線那一段的測試（無頭 Chrome ＋ 假伺服器）");
console.log("  樂觀先走、遲到的同一格、真的那一列、過期、保險絲、打回票、對手廣播、亂喊、收斂點、手牌對帳、逾時、補敲、斷線補問");
console.log("  plan 0006：飛行中的那一手、同時叫墩重放、房主離線照樣有按鈕、背景斷一次不嚷、玩家動作插隊、409 帶回房間、手機時鐘快、補敲錯開、舊頻道的列、舊伺服器的假成功");
console.log("  plan 0007：對手那一列先到時疊回我那張、含著我那一手的列不重演、否決我那一手的同 rev 真相照收");
console.log("  issue 0004：realtime 推來的列缺欄位（TOAST）——同 rev 照手上那列補、rev 變了不收去問伺服器");
console.log(`  ${checks} 項，${ms} 毫秒`);
if (fails.length) {
  console.log(`\n  ✗ ${fails.length} 項不對：\n`);
  for (const f of fails) console.log("  · " + f);
  Deno.exit(1);
}
console.log("  ✓ 全部通過");
