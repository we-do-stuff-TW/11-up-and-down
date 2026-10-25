// 11 Up & Down — 分享連結的測試
//
// 跑法：deno run -A scripts/link_test.ts
//
// 房間頁中央：點房號那四個大字＝複製房號；底下「分享連結」＝手機叫系統分享選單、電腦複製連結。
// 朋友點了連結（?room=ABCD）→ 登入完直接坐進那一桌；進不去就停在大廳、四格填好、講為什麼。
//
// 這支驗的是瀏覽器裡那一段：網址怎麼讀、怎麼擦、進得去／進不去各停在哪、兩顆按鈕各複製什麼，
// 以及「加入被拒時不收那一列」（以前收了，人在大廳、心跳卻每 10 秒去敲別人的桌）。
//
// 抓不到的：
// · authBoot 裡真的有叫 linkRoom——離線時 supabase-js 載不進來，authBoot 一開頭就回去了，
//   所以這裡是自己叫 UD.__t.linkRoom()。接線那一行只有靜態檢查（第六段）。
// · Google 登入那一趟 ?room= 活不活得下來：要真的 OAuth 轉址，這裡重現不了，要真人用無痕視窗走一次。
// · 手機上的系統分享選單長怎樣、LINE 收到什麼：navigator.share 是假的，只驗叫它時帶了什麼。

import { Browser } from "./_browser.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: unknown, msg: string) { checks++; if (!cond) fails.push(msg); }

const b = await Browser.start({ hooks: true });
const t0 = performance.now();

/** 頁面裡的小道具：造一列等待中的房間、假伺服器、假剪貼簿、假分享選單 */
const SETUP = `
window.__L = {
  calls: [], copied: [], shared: [],
  /* 一列等待中的房間。我（pid me）坐不坐在裡面由 seated 決定 */
  row(code, seated){
    const g = UD.engine.newGame({n:2});
    return JSON.parse(JSON.stringify({
      code:code, rev:1, cfg:g.cfg, ladder:g.ladder,
      seats:[{name:"房主", kind:"human", pid:"host", av:null}]
        .concat(seated ? [{name:"我", kind:"human", pid:"me", av:null}] : []),
      phase:"lobby", ri:g.ri, hs:g.hs, starter:g.starter,
      trump:g.trump, trump_card:g.trumpCard, leader:g.leader, turn:g.turn,
      led:g.led, played:g.played, trick:g.trick, bids:g.bids, won:g.won,
      score:g.score, log:g.log, host_pid:"host", seen:{}
    }));
  },
  /* 假伺服器（換掉整支 call）：join 進得去就回那一列，進不去就像 call() 一樣設 NET.err、回 null */
  serve(refuse){
    const L = this;
    UD.__t.MY.pid = "me";
    window.__call = function(action, args){
      L.calls.push(action + ":" + (args && args.code));
      if(action !== "join") return Promise.resolve(null);
      if(refuse){ UD.__t.NET.err = refuse; return Promise.resolve(null); }
      const d = {room:L.row(args.code, true), hand:[]};
      UD.__t.applyRow(d.room, d.hand);
      return Promise.resolve(d);
    };
  },
  clip(){
    const L = this;
    Object.defineProperty(navigator, "clipboard", {configurable:true, value:{
      writeText:function(t){ L.copied.push(t); return Promise.resolve(); }
    }});
  },
  /* 手機：pointer:coarse 成立、有 navigator.share。abort＝叫出選單又按取消 */
  phone(abort){
    const L = this, real = window.matchMedia.bind(window);
    window.matchMedia = function(q){
      return q === "(pointer:coarse)" ? {matches:true, media:q, addEventListener(){}, removeEventListener(){}} : real(q);
    };
    navigator.share = function(o){
      L.shared.push(o);
      return abort ? Promise.reject(new DOMException("取消", "AbortError")) : Promise.resolve();
    };
  },
  view(){
    const code = document.querySelector("#room .rm-code");
    return {
      mode:UD.MODE, net:UD.__t.NET.code || "",
      lobby:!document.getElementById("lobby").hidden,
      room:!document.getElementById("room").hidden,
      inp:document.getElementById("lcIn").value,
      err:document.getElementById("lbErr").hidden ? "" : document.getElementById("lbErr").textContent,
      host:document.getElementById("lbHost").disabled,
      codeTag:code ? code.tagName : "", codeText:code ? code.textContent : "",
      cap:(document.getElementById("rmCap") || {}).textContent || "",
      share:(document.getElementById("rmShare") || {}).textContent || "",
      search:location.search
    };
  }
};
return 1;`;

type View = {
  mode: string; net: string; lobby: boolean; room: boolean; inp: string; err: string; host: boolean;
  codeTag: string; codeText: string; cap: string; share: string; search: string;
};
const view = () => b.eval<View>(`return __L.view()`);

try {
  /* ── 一、網址怎麼讀、怎麼擦 ── */
  await b.open("?lang=zh&dim=2&room=ab2c");
  await b.eval(SETUP);
  const c1 = await b.eval<string>(`return UD.__t.linkRoom()`);
  ok(c1 === "AB2C", `?room=ab2c 讀出來是「${c1}」，應該轉大寫成 AB2C`);
  let v = await view();
  ok(!/room=/.test(v.search), `房號讀完沒從網址擦掉（${v.search}）——離開房間後一重新整理又會被拉回去`);
  ok(/lang=zh/.test(v.search) && /dim=2/.test(v.search), `擦房號時把別的參數一起擦掉了（${v.search}）`);
  const c2 = await b.eval<string>(`return UD.__t.linkRoom()`);
  ok(c2 === "", `擦掉之後再讀一次還讀得到房號「${c2}」`);
  /* 五個字的房號是壞掉的連結：截成四個字可能剛好是別人的桌 */
  const c3 = await b.eval<string>(`history.replaceState(null, "", "?room=AB2CD"); return UD.__t.linkRoom()`);
  ok(c3 === "", `五個字的房號被當成「${c3}」——不准截長度`);
  ok(!/room=/.test(await b.eval<string>(`return location.search`)), "壞掉的房號沒有從網址擦掉");

  /* ── 二、進得去：直接坐進那一桌，房間頁打開 ── */
  await b.eval(`__L.serve(null); return UD.__t.offerLink("AB2C").then(function(){ return 1; })`);
  v = await view();
  ok(await b.eval<boolean>(`return __L.calls.indexOf("join:AB2C") >= 0`), "沒有拿連結上的房號去 join");
  ok(v.mode === "net" && v.net === "AB2C", `進房之後 MODE=${v.mode}、NET.code=${v.net}`);
  ok(!v.lobby && v.room, `進得去卻沒有離開大廳、打開房間頁（大廳=${v.lobby}、房間=${v.room}）`);

  /* ── 三、房間頁中央：房號是按鈕、底下是分享連結；電腦上兩顆都是複製 ── */
  ok(v.codeTag === "BUTTON" && v.codeText === "AB2C", `房號不是一顆按鈕（${v.codeTag}「${v.codeText}」）`);
  ok(v.share === "分享連結", `房號底下那顆寫的是「${v.share}」`);
  const aria = await b.eval<string>(`return document.querySelector("#room .rm-code").getAttribute("aria-label") || ""`);
  ok(/AB2C/.test(aria), `房號按鈕的名字是「${aria}」——蓋掉了按鈕上的房號，螢幕閱讀器念不到是哪一桌`);
  await b.eval(`__L.clip(); document.querySelector("#room .rm-code").click(); return 1`);
  await b.until(`__L.copied.length === 1`, "點房號之後剪貼簿沒收到東西");
  ok(await b.eval<string>(`return __L.copied[0]`) === "AB2C", "點房號複製的不是房號");
  ok((await view()).cap === "複製好了", "點房號之後沒有在原地說複製好了");
  await b.eval(`document.querySelector("#room [data-room=share]").click(); return 1`);
  await b.until(`__L.copied.length === 2`, "電腦上按分享連結之後剪貼簿沒收到東西");
  const link = await b.eval<string>(`return __L.copied[1]`);
  const origin = await b.eval<string>(`return location.origin`);
  ok(link === origin + "/?room=AB2C", `電腦上複製的連結是「${link}」，應該是牌桌網址加 ?room=AB2C（自己的 lang、dim 不跟著傳）`);
  ok((await view()).share === "複製好了", "按分享連結之後沒有在原地說複製好了");
  ok(await b.eval<number>(`return __L.shared.length`) === 0, "電腦上叫了系統分享選單");

  /* ── 四、手機：叫系統分享選單，不碰剪貼簿；按取消什麼都不做 ── */
  await b.eval(`__L.phone(false); document.querySelector("#room [data-room=share]").click(); return 1`);
  await b.until(`__L.shared.length === 1`, "手機上按分享連結沒有叫系統分享選單");
  const sh = await b.eval<{ url: string; text: string }>(`return __L.shared[0]`);
  ok(sh.url === origin + "/?room=AB2C", `手機分享出去的連結是「${sh.url}」`);
  ok(/AB2C/.test(sh.text || ""), `手機分享的那句話沒帶房號（${sh.text}）——點不開連結的人要打得出來`);
  ok(await b.eval<number>(`return __L.copied.length`) === 2, "手機叫了分享選單又去複製");
  await b.eval(`__L.phone(true); document.querySelector("#room [data-room=share]").click(); return 1`);
  await b.until(`__L.shared.length === 2`, "第二次按分享連結沒有叫選單");
  await new Promise((r) => setTimeout(r, 200));
  ok(await b.eval<number>(`return __L.copied.length`) === 2, "叫出分享選單又按取消，卻跑去複製了——取消不算失敗");

  /* ── 四之二、失敗不准自己消失：先成功一次（排了 1.8 秒後換回），馬上再按一次、剪貼簿拒絕 ──
     「複製不了」要一直停著，前一次成功排的換回不准把它蓋掉 */
  await b.eval(`document.querySelector("#room .rm-code").click(); return 1`);
  await b.until(`__L.copied.length === 3`, "第三次點房號剪貼簿沒收到東西");
  await b.eval(`Object.defineProperty(navigator, "clipboard", {configurable:true, value:{
      writeText:function(){ return Promise.reject(new Error("拒絕")); }}});
    document.querySelector("#room .rm-code").click(); return 1`);
  await new Promise((r) => setTimeout(r, 2200));
  const capFail = (await view()).cap;
  ok(capFail === "複製不了", `複製失敗 2.2 秒後那行字是「${capFail}」——失敗的訊息自己消失了`);

  /* ── 五、進不去：停在大廳、四格填好、照伺服器的話講 ── */
  await b.open("?lang=zh&dim=2");
  await b.eval(SETUP);
  const msg = "牌局已經開始，等這局結束再進來";
  await b.eval(`__L.serve(${JSON.stringify(msg)}); return UD.__t.offerLink("AB2C").then(function(){ return 1; })`);
  v = await view();
  ok(v.lobby && !v.room, `進不去卻離開了大廳（大廳=${v.lobby}、房間=${v.room}）`);
  ok(v.inp === "AB2C", `進不去時四格沒填好房號（「${v.inp}」）`);
  ok(v.err === msg, `進不去時大廳講的是「${v.err}」，應該照伺服器的話講`);
  ok(!v.host, "進不去之後大廳的按鈕還鎖著（lbLock 沒放開）");

  /* ── 六、加入被拒走真的 call()：那一列是別人的桌，不准收 ──
     以前收了：MODE 變 net、NET.code 變成那一桌，人在大廳、心跳每 10 秒去敲那一桌的 state。
     這段要走真的 call()（不裝 __call），所以假的是 fetch 與 session。 */
  await b.open("?lang=zh&dim=2");
  await b.eval(SETUP);
  const refused = await b.eval<{ mode: string; net: string; err: string; fetched: number }>(`
    const N = UD.__t.NET; let fetched = 0;
    UD.__t.MY.pid = "me";
    N.sb = {auth:{getSession:function(){
      return Promise.resolve({data:{session:{access_token:"t", expires_at:Date.now() / 1000 + 3600}}});
    }}};
    window.fetch = function(){
      fetched++;
      const room = __L.row("ZZ9Z", false); room.phase = "bid";
      return Promise.resolve(new Response(JSON.stringify({error:${JSON.stringify(msg)}, room:room, hand:null, pid:"me"}), {status:409}));
    };
    return UD.__t.api("join", {code:"ZZ9Z"}).then(function(){
      return {mode:UD.MODE, net:N.code || "", err:N.err, fetched:fetched};
    });`);
  ok(refused.fetched === 1, `假的 fetch 沒被打到（${refused.fetched} 次）——這一段沒有走到真的 call()`);
  ok(refused.err === msg, `被拒的理由沒有留在 NET.err（「${refused.err}」）`);
  ok(refused.mode !== "net" && refused.net === "",
    `加入被拒，卻把別人那一桌收進來了（MODE=${refused.mode}、NET.code=${refused.net}）——心跳會每 10 秒去敲那一桌`);

  /* ── 七、接線：authBoot 有叫 linkRoom，而且排在 offerReturn 前面 ── */
  const src = await Deno.readTextFile(new URL("../docs/index.html", import.meta.url));
  const boot = src.indexOf("async function authBoot(){");
  const bootEnd = src.indexOf("\n}\n", boot);
  ok(boot >= 0 && bootEnd > boot, "找不到 authBoot（改名了？這一段的掃描窗要跟著改）");
  const body = src.slice(boot, bootEnd).replace(/\/\*[\s\S]*?\*\//g, "");
  const iLink = body.indexOf("linkRoom()"), iRet = body.indexOf("offerReturn()");
  const iSess = body.indexOf("getSession()");
  ok(iLink >= 0 && iRet >= 0 && iLink < iRet, "authBoot 沒有在 offerReturn 之前讀連結上的房號");
  ok(iSess >= 0 && iSess < iLink, "authBoot 在確認 session 之前就讀（擦）了網址——鑰匙過期去重新登入時房號會丟");
} catch (e) {
  fails.push("測試中途爆掉：" + (e as Error).message);
} finally {
  await b.close();
}

const ms = Math.round(performance.now() - t0);
console.log("11 Up & Down — 分享連結的測試（無頭 Chrome ＋ 假伺服器）");
console.log("  讀網址與擦網址、進得去、房號＝複製鈕、分享連結（電腦複製／手機選單／取消）、進不去留在大廳、加入被拒不收別人的桌、authBoot 接線");
console.log(`  ${checks} 項，${ms} 毫秒`);
if (fails.length) {
  console.log(`\n  ✗ ${fails.length} 項不對：\n`);
  for (const f of fails) console.log("  · " + f);
  Deno.exit(1);
}
console.log("  ✓ 全部通過");
