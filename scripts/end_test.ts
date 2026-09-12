// 11 Up & Down — 收桌與離開遊戲
//
// 跑法：deno run -A scripts/end_test.ts
//
// ui_test 測「點下去會出得了牌嗎」，這一支測一場牌的兩個出口：
//   · 打完：台上站前三名（同分同名次）、自己沒上台要補一行、三顆按鈕在該在的位置
//   · 再來一局：同一桌同一批人直接發牌，不經過房間，分數歸零
//   · 離開遊戲：設定頁最下面那顆要按兩下才走，走完回到大廳、桌子退回空桌
// 開的是真的牌桌（無頭 Chrome），只插 _browser.ts 那兩個登入接縫。
// 一場十個人、二十四張牌＝三局，所以打得完。

import { Browser } from "./_browser.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: unknown, msg: string) { checks++; if (!cond) fails.push(msg); }

const b = await Browser.start();
const t0 = performance.now();
/* 要看畫面時 SHOT=1 跑，png 落在當下的資料夾 */
const SHOT = !!Deno.env.get("SHOT");
async function shot(name: string) {
  if (!SHOT) return;
  const r = await b.cdp("Page.captureScreenshot", { format: "png" }) as { data: string };
  await Deno.writeFile(name, Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)));
}
const phase = () => b.eval<string>(`return UD.G ? UD.G.phase : "?"`);

/** 一直點到牌局結束 */
async function playOut(ms = 120000) {
  const t = Date.now();
  for (;;) {
    const p = await phase();
    if (p === "over") return;
    await b.eval(`
      const bd = document.querySelector("[data-bid]:not([disabled])");
      if(bd){ bd.click(); return 1; }
      const c = [...document.querySelectorAll("#hand [data-card]")].find(x=>!x.disabled);
      if(c){ c.click(); return 2; }
      const nx = document.getElementById("btnNext");
      if(nx){ nx.click(); return 3; }
      return 0;`);
    if (Date.now() - t > ms) throw new Error("打不完：停在 " + p);
    await new Promise((r) => setTimeout(r, 60));
  }
}

try {
  await b.open("?pace=1&hold=1");
  await b.eval(`TUNE.roundGap = 120; return 1`);
  /* 這一整場裡頁面頂層丟出來的錯，最後一條一起驗 */
  await b.eval(`window.__errs = [];
    addEventListener("error", function(e){ window.__errs.push(e.message); });
    addEventListener("unhandledrejection", function(e){ window.__errs.push(String(e.reason)); });
    return 1`);

  /* 一個人打 → 房間 → 把牌組調小、人加到十個，這一場只有三局 */
  await b.eval(`document.getElementById("lbSolo").click(); return 1`);
  await b.until(`!!document.querySelector(".rm-go")`, "開房頁出現");
  await b.eval(`document.querySelector('[data-room="rules"]').click(); return 1`);
  await b.until(`!!document.querySelector('[data-rule="decks"][data-v="1"]')`, "規則頁出現");
  await b.eval(`document.querySelector('[data-rule="decks"][data-v="1"]').click(); return 1`);
  await b.eval(`document.querySelector('[data-rule="minRank"][data-v="9"]').click(); return 1`);
  await b.eval(`document.querySelector('[data-room="seats"]').click(); return 1`);
  for (let i = 0; i < 6; i++) {
    await b.until(`!!document.querySelector('[data-net="addai"]')`, "空位還在");
    await b.eval(`document.querySelector('[data-net="addai"]').click(); return 1`);
  }
  ok(await b.eval(`return UD.G.seats.length`) === 10, "加到十個位子");
  ok(await b.eval(`return UD.G.ladder ? UD.G.ladder.length : 0`) === 3, "十個人二十四張牌＝三局");

  await b.eval(`document.querySelector(".rm-go").click(); return 1`);
  await b.until(`UD.G.phase !== "lobby"`, "開打");
  await playOut();

  /* ── 收桌：台上只有前三名 ── */
  await b.until(`!document.getElementById("endOv").hidden`, "收桌浮層");
  const end = await b.eval<{ rows: number; first: string; buttons: string[]; mine: string; sub: string }>(`
    const li = [...document.querySelectorAll("#endTop li")];
    return {
      rows: li.length,
      first: li[0] ? li[0].className + "|" + li[0].querySelector(".pl").textContent : "",
      buttons: [...document.querySelectorAll("#endOv .sheet-actions button")]
                 .filter(x=>!x.hidden).map(x=>x.textContent),
      mine: document.getElementById("endMine").hidden ? "" : document.getElementById("endMine").textContent,
      sub: document.getElementById("endSub").textContent };`);
  ok(end.rows === 3, "台上三個人，實際 " + end.rows);
  ok(end.first.startsWith("p1|1"), "第一名那一列是 p1／名次 1，實際 " + end.first);
  ok(end.buttons.join("／") === "看計分表／返回房間／再來一局", "三顆按鈕：" + end.buttons.join("／"));
  ok(/不記戰績/.test(end.sub), "單人局要說不記戰績：" + end.sub);
  /* 十個人，自己幾乎一定不在前三 */
  const meTop = await b.eval<boolean>(`
    const sc = UD.G.score, me = UD.mySeat();
    return sc.filter(v => v > sc[me]).length < 3;`);
  ok(meTop || /你第/.test(end.mine), "沒進前三要補一行自己的：" + JSON.stringify(end.mine));
  await shot("end_podium.png");

  /* ── 再來一局：直接發牌，不經過房間 ── */
  await b.eval(`document.getElementById("endAgain").click(); return 1`);
  await b.until(`UD.G.phase === "bid" || UD.G.phase === "play"`, "再來一局直接開始", 15000);
  ok(await b.eval(`return document.getElementById("endOv").hidden`), "再來一局之後浮層要收掉");
  ok(await b.eval(`return document.getElementById("room").hidden`), "再來一局不經過房間");
  ok(await b.eval(`return UD.G.ri === 0 && UD.G.score.every(v => v === 0)`), "分數歸零、從第一局開始");

  /* ── 設定頁最下面：離開遊戲 ── */
  await b.eval(`document.getElementById("btnPref").click(); return 1`);
  await b.until(`!document.getElementById("pg").hidden`, "設定頁打開");
  ok(await b.eval(`return !document.getElementById("prefQuit").hidden`), "牌局中看得到離開遊戲");
  ok(await b.eval(`return document.getElementById("quitSay").hidden`), "還沒按就不該有那句話");
  await shot("pref_quit.png");
  await b.eval(`document.getElementById("btnQuit").click(); return 1`);
  const asked = await b.eval<{ say: boolean; no: boolean; txt: string }>(`
    return {say: !document.getElementById("quitSay").hidden,
            no: !document.getElementById("quitNo").hidden,
            txt: document.getElementById("btnQuit").textContent};`);
  ok(asked.say && asked.no, "第一下要長出確認");
  ok(asked.txt === "確定離開", "按鈕改口：" + asked.txt);
  await shot("pref_quit_ask.png");
  /* 按「留下」要收回去 */
  await b.eval(`document.getElementById("quitNo").click(); return 1`);
  ok(await b.eval(`return document.getElementById("quitSay").hidden`), "留下就收回確認");

  /* 再按一次，這次走完 */
  await b.eval(`document.getElementById("btnQuit").click(); return 1`);
  await b.eval(`document.getElementById("btnQuit").click(); return 1`);
  await b.until(`!document.getElementById("lobby").hidden`, "回到大廳", 10000);
  ok(await b.eval(`return document.getElementById("pg").hidden`), "設定頁要關掉");
  ok(await b.eval(`return document.getElementById("endOv").hidden`), "收桌浮層要關掉");
  ok(await b.eval(`return UD.G.phase === "lobby" && !UD.G.trump`), "桌子退回空桌");
  /* 桌色是有過場的，等它走完再看：石板灰是色相 250 */
  await b.until(`getComputedStyle(document.body).getPropertyValue("--felt").indexOf("250") > 0`,
                "桌子退回石板灰", 4000);

  /* ── 大廳裡不該有「離開遊戲」 ── */
  await b.eval(`document.getElementById("lbPref").click(); return 1`);
  await b.until(`!document.getElementById("pg").hidden`, "大廳的設定頁");
  ok(await b.eval(`return document.getElementById("prefQuit").hidden`), "大廳不該有離開遊戲");

  const err = await b.eval<string>(`return (window.__errs||[]).join(" / ")`);
  ok(!err, "頁面沒有丟錯：" + err);
} finally {
  await b.close();
}

console.log("11 Up & Down — 收桌與離開遊戲（無頭 Chrome）");
console.log("  打完一整場：前三名、再來一局直接發牌、離開遊戲要按兩下");
console.log(`  ${checks} 項，${Math.round(performance.now() - t0)} 毫秒`);
if (fails.length) { console.log("  ✗"); fails.forEach((f) => console.log("   · " + f)); Deno.exit(1); }
console.log("  ✓ 全部通過");
