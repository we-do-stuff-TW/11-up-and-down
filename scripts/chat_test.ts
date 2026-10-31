// 11 Up & Down — 聊天室的測試（plan 0008）
//
// 跑法：deno run -A scripts/chat_test.ts
//
// 無頭 Chrome 開真的 docs/index.html，伺服器換成假的（_browser.ts 的接縫：api 走 window.__call、聊天走 window.__chatCall），
// realtime 換成直接叫 chatIn()／chatStatus()——每一句什麼時候到、到幾次，都是這支說了算。
// 守的是「兩段各自正確的程式對不上」的那幾種：
//   · 斷線中別人講話 → 接回來補上、不重複、照順序（id 是全站流水號，自己那句的回話可能比別人更早那句先到）
//   · 自己那句先畫出來 → 回話或推播到了對上，不出現兩次；逾時被標「沒送出去」但伺服器其實收到了 → 推播到了對上
//   · 沒送出去：標在那句底下、手機字幕釘在最下面，點一下重送 → 重送中… → 送到才拿掉
//   · 換房之後舊房的話（推播、還沒回來的補話）不准進來
//   · 聊天不排進牌局那條隊伍：一句話卡住不能拖出牌，出牌卡住也不能拖聊天；送不出去也不准寫進狀態列
//   · 只有你和 AI、沒坐下的人：不顯示、不去拿話
//   · 玩家打的字不翻譯（有人打「計分」，英文版不准變成 Score）
//   · 手機：字幕貼在狀態列上面、打字鈕在右端；點字幕不跳鍵盤、點那顆跳鍵盤；打字時輪到你，打字框上面那顆膠囊
// 抓不到的：realtime 本身推不推（伺服器 policy 由 server_test 十二段驗、推播要上線真人驗）、真機鍵盤（visualViewport 這裡是假的）、
//           立體的暗底判斷（這支只在平面驗；立體只驗「蓋著不准點穿出牌」那一段）。

import { Browser } from "./_browser.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: unknown, msg: string) { checks++; if (!cond) fails.push(msg); }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = performance.now();
const b = await Browser.start({ hooks: true });

/** 頁面裡的小道具：照分享連結進一桌（假伺服器回 join）、當聊天的假伺服器 */
const SETUP = `
window.__C = {
  calls: [], say: null, chat: null, pend: [],
  /* 假伺服器：say／chat 回什麼由測試給。"pending"＝先掛著，由 settle() 放行 */
  install(){
    const C = this;
    UD.__t.MY.pid = "me";
    window.__chatCall = function(a, args){
      C.calls.push([a, JSON.parse(JSON.stringify(args || {})), UD.__t.CHAT.code]);
      const r = a === "say" ? C.say : C.chat;
      if(r === "pending") return new Promise(function(res){ C.pend.push({a:a, args:args, res:res}); });
      const v = typeof r === "function" ? r(args) : r;
      return Promise.resolve(v || (a === "chat" ? {ok:true, chat:[]} : {ok:true, msg:{id:C.nextId++, pid:"me", name:"Francis", body:args.text}}));
    };
  },
  nextId: 500,
  /* 做一桌。humans：除了我以外的真人名字；ai：幾個 AI；me：我坐不坐 */
  row(code, humans, ai, phase, me){
    const n = humans.length + ai + (me === false ? 0 : 1);
    const g = UD.engine.newGame({n:Math.max(2, n)});
    const seats = (me === false ? [] : [{name:"Francis", kind:"human", pid:"me", av:null}])
      .concat(humans.map(function(h, i){ return {name:h, kind:"human", pid:"p" + i, av:null}; }))
      .concat(Array.from({length:ai}, function(_, i){ return {name:"AI " + (i + 1), kind:"ai", pid:null, av:null}; }));
    const seen = {me:Date.now()}; humans.forEach(function(_, i){ seen["p" + i] = Date.now(); });
    return JSON.parse(JSON.stringify({code:code, rev:1, cfg:g.cfg, ladder:g.ladder, seats:seats,
      phase:"lobby", ri:g.ri, hs:g.hs, starter:g.starter, trump:g.trump, trump_card:g.trumpCard, leader:g.leader,
      turn:g.turn, led:g.led, played:g.played, trick:g.trick, bids:g.bids, won:g.won, score:g.score, log:g.log,
      host_pid:"me", seen:seen}));
  },
  /* 開到第 5 局、輪我出牌的那一列 */
  /* full：別人都先出了，最後才輪到我（檯面上 n−1 張，人多時會換行） */
  play(row, full){
    const E = UD.engine, g = E.newGame({n:row.seats.length});
    for(let i = 0; i < 5; i++) E.startRound(g);
    let guard = 0;
    while(g.phase === "bid" && guard++ < 40){ const s = g.turn; E.applyBid(g, s, E.aiBid(g, s)); }
    g.leader = full ? 1 : 0; g.turn = g.leader;
    if(full) for(let s = 1; s < g.cfg.n; s++) E.applyPlay(g, s, UD.legalCards(g.hands[s], g.led)[0].id);
    const r = Object.assign(JSON.parse(JSON.stringify(row)), JSON.parse(JSON.stringify({rev:row.rev + 1, phase:g.phase, ri:g.ri, hs:g.hs,
      starter:g.starter, trump:g.trump, trump_card:g.trumpCard, leader:g.leader, turn:g.turn, led:g.led, played:g.played,
      trick:g.trick, bids:g.bids, won:g.won, score:g.score, log:g.log})));
    return {row:r, hand:g.hands[0]};
  },
  /* 照分享連結進房（假的 join 回這一列） */
  join(row){
    window.__call = function(a){ if(a !== "join") return Promise.resolve(null); UD.__t.applyRow(row, []); return Promise.resolve({room:row, hand:[]}); };
    return UD.__t.offerLink(row.code);
  },
  /* 推播：這一桌來了幾句 */
  hear(code, rows){ UD.__t.chatIn(rows.map(function(r){ return {id:r[0], pid:r[1], name:r[2], body:r[3]}; }), code); },
  list(){ return UD.__t.CHAT.list.map(function(m){ return [m.id || 0, m.body, m.state]; }); },
  dom(sel){ return [].slice.call(document.querySelectorAll(sel)).map(function(e){ return e.textContent; }); }
};
__C.install();
return 1;`;

const C = <T = unknown>(js: string) => b.eval<T>(js);
type Item = [number, string, string];

try {
  await b.open("?lang=zh&dim=2&pace=1&hold=1");
  await b.cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await C(SETUP);

  /* ── 三、進房：坐下、桌上有別的真人 → 拿一次前面的話，右欄出現聊天 ── */
  await C(`__C.calls = []; __C.chat = {ok:true, chat:[{id:3, pid:"p0", name:"小周", body:"今天打幾場？"}]};
    window.__room = __C.row("AB2C", ["小周"], 2); __C.join(window.__room); return 1`);
  await wait(500);
  const r3 = await C<{ calls: [string, { after: number }, string][]; room: boolean; list: Item[]; bubbles: string[] }>(
    `return {calls:__C.calls, room:!document.getElementById("chRoom").hidden, list:__C.list(), bubbles:__C.dom("#chRoom .ch-m")}`);
  ok(r3.calls.some((c) => c[0] === "chat" && c[2] === "AB2C"), `進房沒有去拿前面的話：${JSON.stringify(r3.calls)}`);
  ok(r3.calls.every((c) => c[0] !== "chat" || c[1].after === 0), `補話不是拿最新一批（after 要是 0）：${JSON.stringify(r3.calls)}`);
  ok(r3.room && r3.bubbles.join() === "今天打幾場？", `開房頁右欄沒有聊天或沒畫出前面的話：${JSON.stringify(r3)}`);

  /* ── 四、同一句只收一次（推播與補話重疊） ── */
  await C(`__C.hear("AB2C", [[3, "p0", "小周", "今天打幾場？"], [4, "p0", "小周", "先一場"]]); __C.hear("AB2C", [[4, "p0", "小周", "先一場"]]); return 1`);
  const r4 = await C<{ list: Item[]; bubbles: string[] }>(`return {list:__C.list(), bubbles:__C.dom("#chRoom .ch-m")}`);
  ok(r4.list.length === 2 && r4.bubbles.length === 2, `同一句收了兩次：${JSON.stringify(r4)}`);

  /* ── 十三、電腦：沒在打字時按 Enter 跳到打字框；打字框裡 Enter 送出、Esc 離開 ── */
  await C(`document.activeElement && document.activeElement.blur(); return 1`);
  await b.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await b.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  const f13 = await C<boolean>(`return document.activeElement === document.querySelector("#chRoom input")`);
  ok(f13, "沒在打字時按 Enter，焦點沒有跳到聊天的打字框");
  await b.cdp("Input.insertText", { text: "按 Enter 送" });
  await b.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await b.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await wait(50);
  const r13 = await C<{ last: string; val: string; focus: boolean }>(
    `return {last:__C.list().at(-1)[1], val:document.querySelector("#chRoom input").value, focus:document.activeElement === document.querySelector("#chRoom input")}`);
  ok(r13.last === "按 Enter 送" && r13.val === "" && r13.focus, `打字框裡按 Enter 沒送出、沒清空或焦點跑掉：${JSON.stringify(r13)}`);
  await b.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await b.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  const r13b = await C<{ focus: boolean; room: boolean }>(`return {focus:document.activeElement === document.querySelector("#chRoom input"), room:!document.getElementById("room").hidden}`);
  ok(!r13b.focus && r13b.room, `打字框裡按 Esc 沒有離開打字框（或把開房頁關了）：${JSON.stringify(r13b)}`);

  /* ── 五、開局：聊天從右欄搬到計分表下半，話都在 ── */
  await C(`const p = __C.play(window.__room); window.__game = p; UD.__t.applyRow(p.row, p.hand); return 1`);
  await wait(800);
  const r5 = await C<{ ledger: boolean; has: boolean; bubbles: string[]; scrollH: number; chatH: number }>(
    `return {ledger:!document.getElementById("chLedger").hidden, has:document.querySelector(".ledger").classList.contains("has-chat"),
             bubbles:__C.dom("#chLedger .ch-m"), scrollH:document.querySelector(".ledger-scroll").clientHeight, chatH:document.getElementById("chLedger").clientHeight}`);
  ok(r5.ledger && r5.has && r5.bubbles.includes("今天打幾場？") && r5.bubbles.includes("先一場"), `開局後計分表下半沒有聊天：${JSON.stringify(r5)}`);
  ok(Math.abs(r5.scrollH - r5.chatH) < r5.chatH * 0.35, `計分表與聊天沒有大約對半：計分表 ${r5.scrollH}、聊天 ${r5.chatH}`);

  /* ── 六、自己那句：先畫出來，回話到了對上，不出現兩次 ── */
  await C(`__C.say = "pending"; UD.__t.chatSend("  我叫 2\\n好了 "); return 1`);
  const r6a = await C<{ list: Item[]; me: string[] }>(`return {list:__C.list(), me:__C.dom("#chLedger .ch-m.me")}`);
  ok(r6a.me.at(-1) === "我叫 2 好了" && r6a.list.at(-1)?.[2] === "sending", `送出的那句沒有先畫出來（換行收成一個空白）：${JSON.stringify(r6a)}`);
  await C(`const p = __C.pend.shift(); p.res({ok:true, msg:{id:40, pid:"me", name:"Francis", body:p.args.text}}); return 1`);
  await wait(50);
  const r6b = await C<{ list: Item[]; me: string[] }>(`return {list:__C.list(), me:__C.dom("#chLedger .ch-m.me")}`);
  ok(r6b.me.filter((t) => t === "我叫 2 好了").length === 1 && r6b.list.some((m) => m[0] === 40 && m[2] === "sent"),
    `回話到了，自己那句沒對上或出現兩次：${JSON.stringify(r6b)}`);
  // 推播比回話先到
  await C(`UD.__t.chatSend("再一句"); __C.hear("AB2C", [[41, "me", "Francis", "再一句"]]); return 1`);
  await C(`const p = __C.pend.shift(); p.res({ok:true, msg:{id:41, pid:"me", name:"Francis", body:"再一句"}}); return 1`);
  await wait(50);
  const r6c = await C<{ me: string[]; list: Item[] }>(`return {me:__C.dom("#chLedger .ch-m.me"), list:__C.list()}`);
  ok(r6c.me.filter((t) => t === "再一句").length === 1 && r6c.list.filter((m) => m[1] === "再一句").length === 1,
    `推播比回話先到時，自己那句出現兩次：${JSON.stringify(r6c)}`);

  /* ── 七、斷線中別人講話 → 接回來補上、不重複、照 id 排 ── */
  await C(`__C.chat = {ok:true, chat:[{id:3, pid:"p0", name:"小周", body:"今天打幾場？"}, {id:4, pid:"p0", name:"小周", body:"先一場"},
            {id:38, pid:"p0", name:"小周", body:"斷線時講的一"}, {id:39, pid:"p0", name:"小周", body:"斷線時講的二"},
            {id:40, pid:"me", name:"Francis", body:"我叫 2 好了"}, {id:41, pid:"me", name:"Francis", body:"再一句"}]};
    __C.calls = []; UD.__t.chatStatus("SUBSCRIBED"); return 1`);
  await wait(80);
  const r7 = await C<{ list: Item[]; calls: number }>(`return {list:__C.list(), calls:__C.calls.filter(c => c[0] === "chat").length}`);
  const ids7 = r7.list.map((m) => m[0]);
  ok(r7.calls === 1, `接回來沒有去補話（${r7.calls} 趟）`);
  ok(ids7.join() === "3,4,38,39,40,41,500", `補回來的話重複或順序不對（要照 id 排、斷線時那兩句排在我那兩句前面）：${ids7.join()}`);

  /* ── 八、沒送出去：標在那句底下、字幕釘在最下面；點一下重送 → 重送中… → 送到才拿掉 ── */
  await C(`__C.say = {error:"x"}; UD.__t.chatSend("我先去拿個飲料"); return 1`);
  await wait(50);
  await C(`__C.hear("AB2C", [[60, "p0", "小周", "好"], [61, "p0", "小周", "快回來"]]); return 1`);
  const r8 = await C<{ fail: string[]; cap: string[]; capBad: boolean; status: string; err: string }>(
    `return {fail:__C.dom("#chLedger .ch-fail"), cap:__C.dom("#chCap .ch-l span"), capBad:!!document.querySelector("#chCap .ch-l.bad:last-child"),
             status:document.getElementById("status").textContent, err:UD.__t.NET.err}`);
  ok(r8.fail.join() === "沒送出去 · 點一下重送", `沒送出去沒有標在那句底下：${JSON.stringify(r8.fail)}`);
  ok(r8.cap.at(-1) === "我先去拿個飲料" && r8.capBad && r8.cap.length === 2, `字幕沒有把沒送出去那句釘在最下面：${JSON.stringify(r8.cap)}`);
  ok(!r8.err && !/沒送出去|連不上/.test(r8.status), `聊天送不出去寫進了狀態列：「${r8.status}」 NET.err=${r8.err}`);
  // 用真的滑鼠點那一行
  await C(`__C.say = "pending"; return 1`);
  const fb = await b.box("#chLedger .ch-fail");
  if (fb) await b.click(fb.x, fb.y);
  await wait(80);
  const r8b = await C<{ fail: string[]; calls: number }>(`return {fail:__C.dom("#chLedger .ch-fail"), calls:__C.pend.length}`);
  ok(fb && r8b.fail.join() === "重送中…" && r8b.calls === 1, `點「沒送出去」沒有重送、或沒有改成重送中…：${JSON.stringify(r8b)}`);
  await C(`const p = __C.pend.shift(); p.res({ok:true, msg:{id:62, pid:"me", name:"Francis", body:p.args.text}}); return 1`);
  await wait(50);
  const r8c = await C<{ fail: number; bad: number; capBad: number }>(
    `return {fail:document.querySelectorAll("#chLedger .ch-fail").length, bad:document.querySelectorAll("#chLedger .ch-m.bad").length,
             capBad:document.querySelectorAll("#chCap .ch-l.bad").length}`);
  ok(r8c.fail === 0 && r8c.bad === 0 && r8c.capBad === 0, `重送成功之後「沒送出去」沒拿掉：${JSON.stringify(r8c)}`);

  /* ── 九、逾時被標沒送出去，但伺服器其實收到了：推播到了對上，不出現兩次 ── */
  await C(`__C.say = {error:"timeout"}; UD.__t.chatSend("其實有送到"); return 1`);
  await wait(50);
  await C(`__C.hear("AB2C", [[70, "me", "Francis", "其實有送到"]]); return 1`);
  const r9 = await C<{ list: Item[]; fail: number }>(`return {list:__C.list().filter(m => m[1] === "其實有送到"), fail:document.querySelectorAll("#chLedger .ch-fail").length}`);
  ok(r9.list.length === 1 && r9.list[0][2] === "sent" && r9.fail === 0, `逾時但伺服器收到了的那句沒對上：${JSON.stringify(r9)}`);

  /* ── 十、不排進牌局那條隊伍：出牌掛著，聊天照樣送；聊天掛著，出牌照樣送 ── */
  await C(`__C.say = "pending"; __C.pend = []; window.__apiCalls = [];
    window.__call = function(a){ window.__apiCalls.push(a); return new Promise(function(){}); };
    UD.doPlay(UD.legalCards(UD.G.hands[UD.mySeat()], UD.G.led)[0].id); UD.__t.chatSend("出牌卡住也要能講"); return 1`);
  await wait(50);
  const r10 = await C<{ api: string[]; pend: number }>(`return {api:window.__apiCalls, pend:__C.pend.length}`);
  ok(r10.api.includes("play") && r10.pend === 1, `出牌掛著時聊天送不出去（或出牌沒送）：${JSON.stringify(r10)}`);
  await C(`UD.__t.NET.tail = null; UD.__t.NET.queued = 0; UD.__t.NET.busy = false; UD.__t.NET.urgent = 0; UD.__t.NET.ac = null;
    UD.__t.INBOX.settled(); window.__apiCalls = []; UD.__t.api("state", {code:"AB2C"}, true); return 1`);
  await wait(50);
  const r10b = await C<string[]>(`return window.__apiCalls`);
  ok(r10b.includes("state"), `聊天掛著時牌局的請求出不去：${JSON.stringify(r10b)}`);
  await C(`__C.pend.splice(0).forEach(function(p){ p.res({ok:true, msg:{id:__C.nextId++, pid:"me", name:"Francis", body:p.args.text}}); }); __C.say = null; return 1`);

  /* ── 十二、玩家打的字不翻譯；介面字跟著換英文 ── */
  /* 「設定」是字典裡的一格（頂列那顆），英文會變 Settings——拿字典裡沒有的字測，拿掉 translate="no" 也照綠（弄壞驗證抓到的） */
  /* 切語言時聊天會在整頁翻譯之後自己重畫一次（onLang），所以只切語言測不出 translate="no" 有沒有用（弄壞驗證抓到的）。
     切完再跑一次整頁翻譯：任何一次整頁掃描都不准動玩家的字 */
  await C(`__C.chat = null; __C.hear("AB2C", [[95, "p0", "小周", "設定"]]); setLang("en"); i18nDOM(document.body); return 1`);
  await wait(200);
  const r12 = await C<{ bubble: string[]; ph: string; hd: string; send: string }>(
    `return {bubble:__C.dom("#chLedger .ch-m"), ph:document.querySelector("#chLedger input").placeholder,
             hd:document.querySelector("#chLedger .ch-hd").textContent, send:document.querySelector("#chLedger .ch-send").textContent}`);
  ok(r12.bubble.includes("設定") && !r12.bubble.includes("Settings"), `玩家打的「設定」被翻成英文了：${JSON.stringify(r12.bubble)}`);
  ok(await C<boolean>(`return document.getElementById("btnPref").textContent === "Settings"`), "（量尺）頂列的「設定」沒換成 Settings——這條測不出玩家的字有沒有被翻");
  ok(r12.ph === "Say something" && r12.hd === "Chat" && r12.send === "Send", `聊天的介面字沒換英文：${JSON.stringify(r12)}`);
  await C(`setLang("zh"); return 1`);

  /* ── 十一、換房：舊房的推播、還沒回來的補話，一律不收 ── */
  await C(`__C.chat = "pending"; UD.__t.chatStatus("SUBSCRIBED"); return 1`);   // 舊房的補話掛著
  await C(`__C.chat = null; window.__room2 = __C.row("ZZ9Z", ["阿德"], 1); const p = __C.play(window.__room2); UD.__t.applyRow(p.row, p.hand); return 1`);
  await wait(300);
  await C(`__C.hear("AB2C", [[90, "p0", "小周", "舊房的話"]]);
    __C.pend.filter(p => p.a === "chat").forEach(function(p){ p.res({ok:true, chat:[{id:91, pid:"p0", name:"小周", body:"舊房補來的話"}]}); });
    return 1`);
  await wait(80);
  const r11 = await C<{ code: string; list: Item[]; bubbles: string[] }>(`return {code:UD.__t.CHAT.code, list:__C.list(), bubbles:__C.dom("#chLedger .ch-m")}`);
  ok(r11.code === "ZZ9Z" && !r11.list.some((m) => /舊房/.test(m[1])) && !r11.bubbles.some((t) => /舊房/.test(t)),
    `換房之後舊房的話跑進來了：${JSON.stringify(r11)}`);
  ok(!r11.list.some((m) => m[1] === "今天打幾場？") && !r11.bubbles.includes("今天打幾場？"), `換房之後，舊房原本的話還留在新房：${JSON.stringify(r11.list)}`);

  /* ── 一、只有你和 AI：不顯示、不去拿話 ── */
  await C(`__C.calls = []; const p = __C.play(__C.row("AIAI", [], 3)); UD.__t.applyRow(p.row, p.hand); return 1`);
  await wait(400);
  const ai = await C<{ calls: number; ledger: boolean; has: boolean; cap: boolean }>(
    `return {calls:__C.calls.length, ledger:!document.getElementById("chLedger").hidden,
             has:document.querySelector(".ledger").classList.contains("has-chat"), cap:!document.getElementById("chCap").hidden}`);
  ok(ai.calls === 0, `只有你和 AI 卻去拿了聊天（${ai.calls} 趟）`);
  ok(!ai.ledger && !ai.has && !ai.cap, `只有你和 AI 卻顯示了聊天（計分表該是整欄）：${JSON.stringify(ai)}`);

  /* ── 二、觀戰（桌上沒有你）：不顯示、不去拿話 ── */
  await C(`__C.calls = []; const p = __C.play(__C.row("WTCH", ["小周", "阿凱"], 0, "lobby", false)); UD.__t.applyRow(p.row, []); return 1`);
  await wait(300);
  const sp = await C<{ calls: number; ledger: boolean }>(`return {calls:__C.calls.length, ledger:!document.getElementById("chLedger").hidden}`);
  ok(sp.calls === 0 && !sp.ledger, `沒坐下的人看得到聊天或去拿了話：${JSON.stringify(sp)}`);
  // 坐下的那一刻（同一桌、下一列有你了）：前面聊的補回來、聊天出現
  await C(`const r = __C.row("WTCH", ["小周", "阿凱"], 0); const p = __C.play(r); p.row.rev = 9; UD.__t.applyRow(p.row, p.hand); return 1`);
  await wait(200);
  const sp2 = await C<{ calls: string[]; ledger: boolean }>(`return {calls:__C.calls.map(c => c[0] + "@" + c[2]), ledger:!document.getElementById("chLedger").hidden}`);
  ok(sp2.calls.includes("chat@WTCH") && sp2.ledger, `坐下的那一刻沒有去補前面的話、或聊天沒出現：${JSON.stringify(sp2)}`);

  /* ── 十四、手機：字幕貼在狀態列上面、打字鈕在右端；點字幕不跳鍵盤、點那顆跳鍵盤 ── */
  await b.cdp("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
  await b.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await C(`const p = __C.play(__C.row("PH0N", ["小周"], 2)); UD.__t.applyRow(p.row, p.hand);
    __C.hear("PH0N", [[1, "p0", "小周", "我手上一張王牌都沒有"], [2, "p0", "小周", "等我一下，我去倒個水，順便看一下剛剛那局到底是誰叫錯了"]]); return 1`);
  await wait(900);
  const g14 = await C<{ cap: number[] | null; btn: number[] | null; st: number[]; lines: number; bubbleShown: boolean }>(
    `const r = function(id){ const e = document.getElementById(id); if(!e || getComputedStyle(e).display === "none") return null; const q = e.getBoundingClientRect(); return [q.left, q.top, q.right, q.bottom]; };
     const s = document.getElementById("status").getBoundingClientRect();
     return {cap:r("chCap"), btn:r("chBtn"), st:[s.left, s.top, s.right, s.bottom], lines:document.querySelectorAll("#chCap .ch-l").length,
             bubbleShown:document.getElementById("chLedger").getClientRects().length > 0}`);
  ok(g14.cap && Math.abs(g14.cap[3] - (g14.st[1] - 4)) <= 1, `手機字幕的底沒有貼在狀態列上面 4px：字幕 ${JSON.stringify(g14.cap)}、狀態列 ${JSON.stringify(g14.st)}`);
  ok(g14.btn && Math.abs(g14.btn[2] - (393 - 12)) <= 1 && Math.abs(g14.btn[3] - g14.cap![3]) <= 1, `打字鈕不在字幕右端、底沒對齊：${JSON.stringify(g14.btn)}`);
  ok(g14.lines === 2 && !g14.bubbleShown, `手機字幕不是兩行、或電腦那份也露出來：${JSON.stringify(g14)}`);
  // 點字幕：打開、不跳鍵盤
  const cb = await b.box("#chCap");
  // ⚠️ 無頭 Chrome 的觸控（dispatchTouchEvent）不會合成 click（查過：只到 pointer／touch 事件），手機這段一律用滑鼠點
  if (cb) await b.click(cb.x - 60, cb.y);
  await wait(100);
  const r14a = await C<{ open: boolean; focus: boolean; hist: boolean; capHidden: boolean }>(
    `return {open:!document.getElementById("chSheet").hidden, focus:document.activeElement === document.getElementById("chIn"),
             hist:!document.getElementById("chHist").classList.contains("none"), capHidden:document.getElementById("chCap").hidden}`);
  ok(r14a.open && !r14a.focus && r14a.hist && r14a.capHidden, `點字幕沒有打開、或跳了鍵盤、或沒列出紀錄：${JSON.stringify(r14a)}`);
  // 點暗處收起來
  await b.click(196, 120);
  await wait(100);
  ok(await C<boolean>(`return document.getElementById("chSheet").hidden && !document.getElementById("chCap").hidden`), "點暗處沒有收起來、字幕沒回來");
  // 點那顆：打開、跳鍵盤；輪到我時打字框上面有那顆膠囊
  const bb = await b.box("#chBtn");
  if (bb) await b.click(bb.x, bb.y);
  await wait(100);
  const r14b = await C<{ focus: boolean; turn: boolean; turnText: string; fld: number; turnB: number }>(
    `const t = document.getElementById("chTurn");
     return {focus:document.activeElement === document.getElementById("chIn"), turn:t.classList.contains("on"), turnText:t.textContent,
             fld:document.getElementById("chFld").getBoundingClientRect().top, turnB:t.getBoundingClientRect().bottom}`);
  ok(r14b.focus, "點打字鈕沒有跳鍵盤（焦點不在打字框）");
  ok(r14b.turn && r14b.turnText === "輪到你出牌" && r14b.turnB <= r14b.fld, `打字時輪到你，打字框上面沒有「輪到你出牌」那顆：${JSON.stringify(r14b)}`);
  // 送出：Enter，焦點留著（鍵盤不收）
  await b.cdp("Input.insertText", { text: "手機講一句" });
  await b.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await b.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await wait(60);
  const r14c = await C<{ last: string; focus: boolean; inSheet: string[] }>(
    `return {last:__C.list().at(-1)[1], focus:document.activeElement === document.getElementById("chIn"), inSheet:__C.dom("#chHist .ch-m.me")}`);
  ok(r14c.last === "手機講一句" && r14c.focus && r14c.inSheet.includes("手機講一句"), `手機送出沒成功、或鍵盤收起來了：${JSON.stringify(r14c)}`);
  // 點「送出」鈕：送出、焦點留在打字框（鍵盤不收，像 LINE）
  await b.cdp("Input.insertText", { text: "點送出鈕" });
  const sb = await b.box("#chSend");
  if (sb) await b.click(sb.x, sb.y);
  await wait(60);
  const r14d = await C<{ last: string; focus: boolean }>(`return {last:__C.list().at(-1)[1], focus:document.activeElement === document.getElementById("chIn")}`);
  ok(sb && r14d.last === "點送出鈕" && r14d.focus, `點送出鈕沒送出、或焦點離開打字框（鍵盤會收起來）：${JSON.stringify(r14d)}`);
  // 點那顆膠囊：收起鍵盤、回牌桌
  const tb = await b.box("#chTurn");
  if (tb) await b.click(tb.x, tb.y);
  await wait(100);
  ok(await C<boolean>(`return document.getElementById("chSheet").hidden && document.activeElement !== document.getElementById("chIn")`), "點「輪到你出牌」那顆沒有回牌桌");
  // 點開著的時候視窗拉寬到電腦（右欄出現）：那層收起來，換成計分表下半那份
  await C(`UD.__t.chatOpen(false); return 1`);
  await b.cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await wait(300);
  ok(await C<boolean>(`return document.getElementById("chSheet").hidden && document.getElementById("chLedger").getClientRects().length > 0`),
    "手機點開那層開著時視窗拉寬，那層沒收起來（電腦的右欄已經有打字框）");
  await b.cdp("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
  await wait(300);

  /* ── 十五、手機：人多時字幕墊暗底，照「放不放得下兩行」決定（不照人數寫死） ── */
  for (const n of [3, 5, 9]) {
    await C(`const r = __C.row("P${n}X", Array.from({length:${n}}, (_, i) => "人" + i), 0);
      const p = __C.play(r, true); UD.__t.applyRow(p.row, p.hand);
      __C.hear("P${n}X", [[1, "p0", "人0", "一"], [2, "p1", "人1", "二"]]); return 1`);
    await wait(700);
    const r15 = await C<{ pad: boolean; free: number; capH: number }>(
      `return {pad:document.getElementById("chCap").classList.contains("pad"), free:UD.__t.CHAT.free, capH:document.getElementById("chCap").offsetHeight}`);
    ok(typeof r15.free === "number" && (r15.free >= 52 || r15.pad), `${n + 1} 人桌：空位 ${r15.free}px 放不下兩行，卻沒墊暗底`);
    if (n === 3) ok(!r15.pad, `平面 4 人桌（量到 ${r15.free}px）墊了暗底——樣品裡 4 人桌是不墊的`);
    if (n === 5) ok(r15.pad, `平面 6 人桌、檯面上 5 張（量到 ${r15.free}px）沒墊暗底——樣品量到只剩 24px`);
  }
} catch (e) {
  fails.push("測試中途爆掉：" + (e as Error).message);
} finally {
  await b.close();
}

/* ── 十六、立體、手機：聊天（或計分表）蓋在手牌上時，點下去不准把底下的牌出掉 ──
   立體的牌是 WebGL 畫的，「點到哪張」是從手指往桌面射一條線找（UD.tap.hit）。以前不看最上面蓋著什麼：
   點字幕打開聊天、點在紀錄或「點一下重送」上，射線穿過去把底下那張能出的牌出掉（驗收員用觸控重播出來的）。
   用觸控（pointer 事件）點，正反兩面都驗：蓋著不出、沒蓋著照出。 */
const b3 = await Browser.start({ hooks: true, gl: true });
try {
  await b3.open("?lang=zh&dim=3&pace=1&hold=1");
  await b3.cdp("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
  await b3.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await b3.eval(SETUP);
  await b3.eval(`window.__room = __C.row("AB2C", ["小周", "阿凱", "Mia"], 0); return __C.join(window.__room).then(() => 1)`);
  await wait(800);
  await b3.eval(`__C.hear("AB2C", [[1, "p0", "小周", "換你了啦"], [2, "p1", "阿凱", "快"], [3, "p2", "Mia", "我叫 1 是不是太保守"], [4, "p0", "小周", "嗯"]]);
    const p = __C.play(window.__room); UD.__t.applyRow(p.row, p.hand); return 1`);
  await b3.until(`UD.__3d && UD.__3d().S && document.getElementById("stage") && !document.getElementById("stage").hidden && document.getElementById("stage").clientHeight > 0`, "立體牌桌", 20000);
  await wait(6000);
  await b3.eval(`window.__apiCalls = []; window.__call = function(a){ window.__apiCalls.push(a); return new Promise(function(){}); }; return 1`);
  // 找一點：最上面是畫布、射線打得到一張能出的牌
  // 牌桌剛鋪好時有幾格牌的材質還沒就緒，射線會丟錯（遊戲本身點牌時 TAP.begin 有接住）：搜不到就隔一秒再試
  let P: { x: number; y: number; id: string } | null = null;
  for (let k = 0; k < 15 && !P; k++) {
    P = await b3.eval<{ x: number; y: number; id: string } | null>(`
      const cv = document.getElementById("stage");
      try{
        for(let y = innerHeight - 20; y > innerHeight / 2; y -= 6) for(let x = 30; x < innerWidth - 30; x += 6){
          if(document.elementFromPoint(x, y) !== cv) continue;
          const id = UD.tap.hit({clientX:x, clientY:y, target:cv});
          if(id && UD.tap.playable(id)) return {x:x, y:y, id:id};
        }
      }catch(e){}
      return null`);
    if (!P) await wait(1000);
  }
  ok(P, "立體桌上找不到一個點得到能出的牌的位置（量尺壞了，這一段測不出東西）");
  if (P) {
    const hand0 = await b3.eval<number>(`return UD.G.hands[UD.mySeat()].length`);
    // 聊天打開（點字幕那種：不跳鍵盤），點在同一個位置
    await b3.eval(`UD.__t.chatOpen(false); return 1`);
    await wait(300);
    const top1 = await b3.eval<boolean>(`return !!document.elementFromPoint(${P.x}, ${P.y}).closest("#chSheet")`);
    await b3.tap(P.x, P.y);
    await wait(300);
    const r16a = await b3.eval<{ api: string[]; hand: number }>(`return {api:window.__apiCalls, hand:UD.G.hands[UD.mySeat()].length}`);
    ok(top1 && !r16a.api.includes("play") && r16a.hand === hand0, `聊天蓋在手牌上，點下去把底下那張牌出掉了：${JSON.stringify(r16a)}`);
    // 計分表浮層蓋著也一樣（遊戲原本就有的同一個毛病）
    await b3.eval(`UD.__t.chatClose(); document.getElementById("btnScore").click(); return 1`);
    await wait(400);
    const top2 = await b3.eval<boolean>(`return document.body.classList.contains("score-open") && !!document.elementFromPoint(${P.x}, ${P.y}).closest(".ledger")`);
    await b3.tap(P.x, P.y);
    await wait(300);
    const r16b = await b3.eval<{ api: string[]; hand: number }>(`return {api:window.__apiCalls, hand:UD.G.hands[UD.mySeat()].length}`);
    ok(top2 && !r16b.api.includes("play") && r16b.hand === hand0, `計分表蓋在手牌上，點下去把底下那張牌出掉了：${JSON.stringify(r16b)}（浮層開著 ${top2}）`);
    // 沒蓋著：照樣點得出牌（射線這條路沒被一起關掉）
    await b3.eval(`document.getElementById("scoreClose").click(); return 1`);
    await wait(400);
    await b3.tap(P.x, P.y);
    await wait(300);
    /* 看手上少沒少一張，不看送出去的請求：假伺服器把前一趟（報到）掛著不回，出牌那趟排在它後面 */
    const r16c = await b3.eval<number>(`return UD.G.hands[UD.mySeat()].length`);
    ok(r16c === hand0 - 1, `沒有東西蓋著時，點手牌出不了牌：手上 ${hand0} → ${r16c}`);
  }
} catch (e) {
  fails.push("立體那段中途爆掉：" + (e as Error).message);
} finally {
  await b3.close();
}

const ms = Math.round(performance.now() - t0);
console.log("11 Up & Down — 聊天室的測試（無頭 Chrome ＋ 假伺服器，plan 0008）");
console.log("  只有 AI、觀戰、進房補話、不重複、搬到計分表、自己那句對上、斷線補話照順序、沒送出去與重送、逾時其實送到、不排隊、換房、不翻譯、Enter／Esc、手機字幕與點開、拉寬收起、人多墊暗底、立體蓋著不准點穿出牌");
console.log(`  ${checks} 項，${ms} 毫秒`);
if (fails.length) {
  console.log(`\n  ✗ ${fails.length} 項不對：\n`);
  for (const f of fails) console.log("  · " + f);
  Deno.exit(1);
}
console.log("  ✓ 全部通過");
