// 收桌頒獎（endGag）在真的牌桌上：打完一場 → 收桌 → 停在幾個節拍截圖 → 驗沒有錯、沒有橫向捲軸 → 兩疊也演（直達）、一疊不演
// 跑法：DIM=2 deno run -A gag_test.ts   /  DIM=3（立體）/  PHONE=1（390 寬）
import { Browser } from "./_browser.ts";
const DIM = Deno.env.get("DIM") ?? "2", PHONE = !!Deno.env.get("PHONE");
const OUT = decodeURIComponent(new URL("../design/end/shots/", import.meta.url).pathname);   /* 路徑有空白，不解碼會寫到 11%20Up&Down */
const tag = `live${DIM}${PHONE ? "p" : ""}`;
const b = await Browser.start({ gl: DIM === "3" });
const fails: string[] = [];
const phase = () => b.eval<string>(`return UD.G ? UD.G.phase : "?"`);
async function shot(name: string) {
  const r = await b.cdp("Page.captureScreenshot", { format: "png" }) as { data: string };
  await Deno.writeFile(OUT + name, Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)));
}
async function playOut(ms = 150000) {
  const t = Date.now();
  for (;;) {
    if (await phase() === "over") return;
    await b.eval(`
      const bd = document.querySelector("[data-bid]:not([disabled])"); if(bd){ bd.click(); return 1; }
      const c = [...document.querySelectorAll("#hand [data-card]")].find(x=>!x.disabled); if(c){ c.click(); return 2; }
      const nx = document.getElementById("btnNext"); if(nx){ nx.click(); return 3; } return 0;`);
    if (Date.now() - t > ms) throw new Error("打不完：停在 " + await phase());
    await new Promise((r) => setTimeout(r, 60));
  }
}
try {
  await b.open(`?lang=zh&dim=${DIM}&pace=1&hold=1`);
  if (PHONE) { await b.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await new Promise((r) => setTimeout(r, 300)); }
  await b.eval(`TUNE.roundGap = 120; window.__errs = [];
    addEventListener("error", e => window.__errs.push(e.message));
    addEventListener("unhandledrejection", e => window.__errs.push(String(e.reason))); return 1`);
  await b.eval(`document.getElementById("lbSolo").click(); return 1`);
  await b.until(`!!document.querySelector(".rm-go")`, "開房頁");
  await b.eval(`document.querySelector('[data-room="rules"]').click(); return 1`);
  await b.until(`!!document.querySelector('[data-rule="decks"][data-v="1"]')`, "規則頁");
  await b.eval(`document.querySelector('[data-rule="decks"][data-v="1"]').click(); return 1`);
  await b.eval(`document.querySelector('[data-rule="minRank"][data-v="9"]').click(); return 1`);
  await b.eval(`document.querySelector('[data-room="seats"]').click(); return 1`);
  for (let i = 0; i < 6; i++) { await b.until(`!!document.querySelector('[data-net="addai"]')`, "空位"); await b.eval(`document.querySelector('[data-net="addai"]').click(); return 1`); }
  await b.eval(`document.querySelector(".rm-go").click(); return 1`);
  await b.until(`UD.G.phase !== "lobby"`, "開打");
  await playOut();
  console.log("打完時頁面錯誤數", await b.eval(`return window.__errs.length`), "（頒獎還沒開演）");
  await b.until(`!document.getElementById("endOv").hidden`, "收桌那一頁");
  /* 這種短局常常同分併階；把分數改成十個都不同的值再重開收桌，三疊一定在（只改畫面要讀的那個陣列） */
  await b.eval(`const sc = UD.G.score; [3,7,15,11,9,5,1,2,4,6].forEach((v,i)=>{ if(i < sc.length) sc[i] = v; });
    document.getElementById("endClose2").click(); return 1`);
  await new Promise((r) => setTimeout(r, 250));
  await b.eval(`document.getElementById("btnFinal").click(); return 1`);
  await b.until(`!document.getElementById("endOv").hidden`, "收桌重開");
  const stacks = await b.eval<number>(`return document.querySelectorAll("#endStacks .stack").length`);
  console.log("疊數", stacks, "分數", await b.eval(`return JSON.stringify(UD.G.score)`));
  await new Promise((r) => setTimeout(r, 2600));
  const has = await b.eval<boolean>(`return !!(UD.gag && UD.gag.B && UD.gag.seek)`);
  if (stacks === 3 && !has) fails.push("三疊卻沒有開演（endGag.B 不在）");
  if (has) {
    const B = await b.eval<Record<string, number>>(`return UD.gag.B`);
    for (const [name, plus] of [["rise", .4], ["bump", .05], ["hang", .3], ["reach", .34], ["hop", .3], ["look2", .4], ["present", .6], ["bow", .5], ["fall", .4]] as [string, number][]) {
      await b.eval(`UD.gag.seek(${B[name] + plus}); return 1`);
      await new Promise((r) => setTimeout(r, 160));
      await shot(`${tag}_${name}.png`);
    }
    const scroll = await b.eval<{ sw: number; cw: number; sh: number; ch: number }>(`const m = document.querySelector(".end-mid"); return {sw:m.scrollWidth, cw:m.clientWidth, sh:m.scrollHeight, ch:m.clientHeight}`);
    console.log("end-mid 捲動範圍", JSON.stringify(scroll));
    if (scroll.sw > scroll.cw) fails.push("收桌頁有橫向捲軸 " + JSON.stringify(scroll));
    /* 關掉那一頁要停：動畫取消、seek 沒東西 */
    await b.eval(`document.getElementById("endClose2").click(); return 1`);
    await new Promise((r) => setTimeout(r, 200));
    const stopped = await b.eval<boolean>(`return !UD.gag.stop && document.getElementById("tom").getAnimations().length === 0`);
    if (!stopped) fails.push("關掉收桌頁之後頒獎沒有停");
    /* 再打開：要重新開演 */
    await b.eval(`document.getElementById("btnFinal").click(); return 1`);
    await new Promise((r) => setTimeout(r, 2800));
    const again = await b.eval<number>(`return document.getElementById("tom").getAnimations().length`);
    if (again === 0) fails.push("再打開收桌頁沒有重新開演");
    await b.eval(`UD.gag.seek(${B["present"] + .6}); return 1`);
    await new Promise((r) => setTimeout(r, 160));
    await shot(`${tag}_again.png`);
  } else {
    await shot(`${tag}_noshow.png`);
  }
  /* ── 兩疊（同分併階、或只有兩個人）也要演：起爬的是第二名那疊、走直達（2026-10-21 Francis「兩疊也要」；以前兩疊整段不演）──
     記下每次 animate() 被叫的時間：牌疊晃的第一下要等到撞牌（B.bump）才來。直達沒有 land2，
     那顆計時器沒擋的話 setTimeout(undefined) 會在開演當下就晃第二名那疊。 */
  await b.eval(`document.getElementById("endClose2").click();
    if(!window.__anHooked){ window.__anHooked = 1; const orig = Element.prototype.animate;
      Element.prototype.animate = function(k, o){ (window.__an = window.__an || []).push({t:performance.now(), pile:this.classList.contains("pile"), tom:this.id === "tom"}); return orig.call(this, k, o); }; }
    return 1`);
  await new Promise((r) => setTimeout(r, 250));
  await b.eval(`window.__an = []; const sc = UD.G.score; sc.forEach((v, i) => { sc[i] = i === 1 ? 21 : 15; });
    document.getElementById("btnFinal").click(); return 1`);
  await b.until(`!document.getElementById("endOv").hidden`, "收桌重開（兩疊）");
  const two = await b.eval<number>(`return document.querySelectorAll("#endStacks .stack").length`);
  if (two !== 2) fails.push(`該排出兩疊，排出 ${two} 疊`);
  /* 立體在 headless 收桌後會卡 1～4 秒，Thomas 卡完才上場：等到開演，不要隔固定秒數看一眼（10-21 這樣誤判過「沒演」） */
  const started = await b.until(`document.getElementById("tom").getAnimations().length > 0`, "兩疊開演", 10000).then(() => true, () => false);
  if (!started) fails.push("兩疊沒有開演");
  else {
    const B2 = await b.eval<Record<string, number>>(`return UD.gag.B`);
    if (B2.hop != null || B2.land2 != null) fails.push("兩疊卻繞了第二名（B 裡有 hop／land2）：人已經站在第二名上，該走直達");
    const wob = await b.until(`window.__an.some(a => a.pile)`, "兩疊的牌疊晃", 10000).then(() => true, () => false);
    if (!wob) fails.push("兩疊開演後一直沒有晃牌疊（撞牌那一下）");
    else {
      const lead = await b.eval<number>(`const t0 = window.__an.find(a => a.tom).t; return (window.__an.find(a => a.pile).t - t0) / 1000`);
      console.log("兩疊：開演到第一次晃牌疊", lead.toFixed(2), "秒（撞牌在", B2.bump.toFixed(2), "秒）");
      if (lead < B2.bump - .1) fails.push(`兩疊開演 ${lead.toFixed(2)} 秒就晃了牌疊，撞牌在 ${B2.bump.toFixed(2)} 秒`);
    }
    for (const [name, plus] of [["rise", .4], ["bump", .05], ["hang", .3], ["reach", .34], ["hop1", .28], ["present", .6], ["bow", .5], ["fall", .4]] as [string, number][]) {
      await b.eval(`UD.gag.seek(${B2[name] + plus}); return 1`);
      await new Promise((r) => setTimeout(r, 160));
      await shot(`${tag}_two_${name}.png`);
    }
  }
  /* ── 一疊（全桌同分）照舊不演：沒有別疊可以爬 ── */
  await b.eval(`document.getElementById("endClose2").click(); return 1`);
  await new Promise((r) => setTimeout(r, 250));
  await b.eval(`const sc = UD.G.score; sc.forEach((v, i) => { sc[i] = 15; }); document.getElementById("btnFinal").click(); return 1`);
  await b.until(`!document.getElementById("endOv").hidden`, "收桌重開（一疊）");
  await new Promise((r) => setTimeout(r, 4000));
  const one = await b.eval<{ n: number; anims: number }>(`return {n:document.querySelectorAll("#endStacks .stack").length, anims:document.getElementById("tom").getAnimations().length}`);
  if (one.n !== 1) fails.push(`該排出一疊，排出 ${one.n} 疊`);
  if (one.anims) fails.push("一疊（全桌同分）也開演了");
  const errs = await b.eval<string[]>(`return window.__errs`);
  if (errs.length) fails.push("頁面錯誤：" + errs.join(" | "));
} catch (e) { fails.push(String(e)); } finally { await b.close(); }
console.log(fails.length ? "FAIL\n- " + fails.join("\n- ") : "OK");
Deno.exit(fails.length ? 1 : 0);
