/**
 * 英文版的殘留中文掃描。
 *
 * 開 ?lang=en，把每一頁都走一遍（大廳、開房、規則設定、牌桌、帳號、設定、規則、收桌），
 * 每一站掃一次 DOM：看得到的文字節點與 aria-label／placeholder／title 裡還有沒有中文。
 * 有的話印出「哪一段字、掛在哪個元素上」——那就是字典漏掉的 key。
 *
 * ⚠️ 輸出不要用 tail／head 截。漏翻是偶發的（有些字只在某個時刻出現在畫面上），
 *    失敗那一次印的「哪一段字、掛在哪個元素上」就是唯一的線索，截掉就再也找不回來了。
 *    要跑多輪就整段存檔：`for i in 1 2 3; do deno run -A scripts/i18n_scan.ts; done > scan.log 2>&1`
 *
 *   deno run -A scripts/i18n_scan.ts          # 掃英文版
 *   deno run -A scripts/i18n_scan.ts zh       # 反過來掃中文版有沒有跑出英文（只看字典裡的英文值）
 *   SHOT=1 deno run -A scripts/i18n_scan.ts   # 順手截圖到 design/i18n/
 */
import { Browser } from "./_browser.ts";

/* ---------------- 開瀏覽器之前的靜態檢查 ----------------
   走一遍頁面只看得到「那一刻畫面上有的字」。錯誤分支、少見的狀態、
   要特定規則才出現的句子，走十二站是走不到的。
   所以先做一件不必開瀏覽器的事：把程式裡所有中文字串 literal 抓出來，
   比對有沒有進字典。字串裡是 HTML 片段的話，中文在文字節點與 aria-label 上
   ——那是 i18nDOM 的事，所以拆到那一層再比對。 */
const ALLOW = new Set([
  "中文",          /* 語言那一排，兩個選項各寫自己的語言 */
  "座位",          /* 引擎給空位的預設名，由畫面層的 seatName() 換掉 */
]);
/* console.* 的訊息是寫給開發者看的，永遠不上畫面。認「那一行是不是 console 呼叫」
   而不是把訊息內容寫進白名單——訊息改一個字白名單就失效了。 */
const isDevLog = (src: string, at: number) =>
  /console\.(log|warn|error|info|debug)\s*\($/.test(
    src.slice(Math.max(0, at - 80), at).split("\n").pop() ?? "",
  );
function staticCheck(): string[] {
  const src = Deno.readTextFileSync("docs/index.html");
  const dict = src.match(/window\.I18N_EN = \{[\s\S]*?\n\};/);
  if (!dict) throw new Error("找不到字典（window.I18N_EN）");
  // deno-lint-ignore no-explicit-any
  const D = new Function("return " + dict[0].replace("window.I18N_EN = ", ""))() as Record<string, any>;
  const known = new Set<string>(Object.keys(D));
  for (const v of Object.values(D)) if (v && typeof v === "object" && v.zh) known.add(v.zh);
  const dictAt = src.indexOf(dict[0]), dictEnd = dictAt + dict[0].length;

  const CJK = /[㐀-鿿豈-﫿＀-￯]/;
  const hits: string[] = [];
  const blocks = /<script(?: type="module")?>([\s\S]*?)<\/script>/g;
  let b: RegExpExecArray | null;
  while ((b = blocks.exec(src))) {
    const at = b.index + b[0].indexOf(b[1]), text = b[1];
    if (at < dictEnd && at + text.length > dictAt) continue;      /* 字典自己跳過 */
    let i = 0, mode = "code", quote = "", buf = "", bufAt = 0;
    while (i < text.length) {
      const c = text[i], c2 = text[i + 1];
      if (mode === "code") {
        if (c === "/" && c2 === "/") { mode = "lc"; i += 2; continue; }
        if (c === "/" && c2 === "*") { mode = "bc"; i += 2; continue; }
        if (c === '"' || c === "'" || c === "`") { mode = "str"; quote = c; buf = ""; bufAt = at + i; i++; continue; }
        i++; continue;
      }
      if (mode === "lc") { if (c === "\n") mode = "code"; i++; continue; }
      if (mode === "bc") { if (c === "*" && c2 === "/") { mode = "code"; i += 2; continue; } i++; continue; }
      if (c === "\\") { buf += text.substr(i, 2); i += 2; continue; }
      if (c === quote) {
        if (CJK.test(buf) && !known.has(buf)) {
          const segs: string[] = [];
          buf.replace(/\\"/g, '"')
            .replace(/(aria-label|placeholder|title|alt)="([^"]*)"/g, (_m, _a, v) => { segs.push(v); return " "; })
            .replace(/<[^>]*>/g, "\u0001")
            .split("\u0001").forEach((t) => segs.push(t));
          /* 字串從屬性中間開始時，拆出來的第一段會帶著 "> 之類的殘渣，剝掉再比 */
          const bad = segs.map((t) => t.replace(/^[\s"'>\/]+/, "").trim())
            .filter((t) => t && CJK.test(t) && !known.has(t) && !ALLOW.has(t));
          if (bad.length && !isDevLog(src, bufAt)) {
            hits.push("docs/index.html:" + src.slice(0, bufAt).split("\n").length + "  " + bad.join(" ／ "));
          }
        }
        mode = "code"; quote = ""; i++; continue;
      }
      if (quote !== "`" && c === "\n") { mode = "code"; quote = ""; i++; continue; }
      buf += c; i++;
    }
  }
  return hits;
}

const LANG = Deno.args[0] === "zh" ? "zh" : "en";
const SHOT = Deno.env.get("SHOT") === "1";
/* DIM=3 走立體牌桌：座位名、骰子計數環、狀態列在那邊仍然是疊在畫布上的 DOM，
   一樣要跟著語言走，所以兩種牌桌都要掃過。 */
const DIM = Deno.env.get("DIM") === "3" ? "3" : "2";
/* console.warn 那幾句是寫給開發者看的，不上畫面，所以靜態檢查只在英文那一輪跑一次就好 */
const stat = staticCheck();
if (stat.length) {
  console.log("\n靜態檢查：程式裡有中文字串沒進字典");
  for (const h of stat) console.log("   · " + h);
  console.log("  （console.warn 之類不上畫面的，加進 i18n_scan.ts 的 ALLOW）");
  Deno.exitCode = 1;
}

const b = await Browser.start({ gl: true });

/* 中文版要反過來檢查：畫面上不該出現字典裡的任何一句英文。
   純 ASCII 的東西（房號、分數、AI 1、the hook）本來就到處都是，所以不是「有英文就算」，
   而是「跟字典的某個英文值一字不差」——那才真的是沒翻回來。 */
const SCAN_EN = `
  const vals = new Set(Object.values(window.I18N_EN || {})
    .map(v => typeof v === "string" ? v : (v && v.en))
    .filter(v => typeof v === "string" && v.trim().length > 2)
    .map(v => v.replace(/<[^>]*>/g, "").replace(/%\\d/g, "").trim())
    .filter(Boolean));
  const out = [], seen = new Set();
  const OK = new Set(["the hook"]);   /* 規則的名字，中文版也這樣寫 */
  const skip = {SCRIPT:1, STYLE:1, CANVAS:1, TEXTAREA:1};
  const show = el => {
    for(let n = el; n && n.nodeType === 1; n = n.parentElement){
      if(n.hidden) return false;
      const st = getComputedStyle(n);
      if(st.display === "none" || st.visibility === "hidden") return false;
    }
    return true;
  };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while((n = w.nextNode())){
    const t = (n.nodeValue || "").trim();
    if(!t || !vals.has(t) || OK.has(t)) continue;
    const el = n.parentElement;
    if(!el || skip[el.nodeName] || !show(el)) continue;
    if(seen.has(t)) continue;
    seen.add(t);
    out.push(t + "   ← <" + el.nodeName.toLowerCase() + (el.className ? " class=\\"" + el.className + "\\"" : "") + ">");
  }
  return out;
`;

const SCAN = `
  const CJK = /[\\u3400-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]/;
  const out = [];
  const seen = new Set();
  /* 故意留著中文的：語言那一排，兩個選項各寫自己的語言 */
  const OK = new Set(["\u4e2d\u6587"]);
  const skip = {SCRIPT:1, STYLE:1, CANVAS:1, TEXTAREA:1};
  const show = el => {
    for(let n = el; n && n.nodeType === 1; n = n.parentElement){
      if(n.hidden) return false;
      const st = getComputedStyle(n);
      if(st.display === "none" || st.visibility === "hidden") return false;
    }
    return true;
  };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while((n = w.nextNode())){
    const t = (n.nodeValue || "").trim();
    if(!t || !CJK.test(t) || OK.has(t)) continue;
    const el = n.parentElement;
    if(!el || skip[el.nodeName] || !show(el)) continue;
    const k = t + "|" + el.nodeName + "." + el.className;
    if(seen.has(k)) continue;
    seen.add(k);
    out.push(t + "   ← <" + el.nodeName.toLowerCase() + (el.className ? " class=\\"" + el.className + "\\"" : "") + ">");
  }
  for(const a of ["aria-label","placeholder","title","alt"]){
    for(const el of document.querySelectorAll("[" + a + "]")){
      const v = el.getAttribute(a) || "";
      if(!CJK.test(v) || !show(el)) continue;
      const k = v + "|" + a;
      if(seen.has(k)) continue;
      seen.add(k);
      out.push(v + "   ← " + a + " on <" + el.nodeName.toLowerCase() + ">");
    }
  }
  return out;
`;

const found: Record<string, string[]> = {};
async function scan(where: string) {
  const rows = await b.eval<string[]>(LANG === "en" ? SCAN : SCAN_EN);
  if (rows.length) {
    found[where] = rows;
    /* 偶發的漏翻往往只中一次，沒有當下那張畫面就定位不了。失敗就一定留一張。 */
    await Deno.mkdir("design/i18n", { recursive: true });
    const bad = await b.cdp("Page.captureScreenshot", { format: "png" }) as { data: string };
    await Deno.writeFile(
      `design/i18n/_fail-${LANG}-${DIM}d-${where}.png`,
      Uint8Array.from(atob(bad.data), (c) => c.charCodeAt(0)),
    );
  }
  if (SHOT) {
    /* 等淡入淡出走完再按快門，不然會拍到兩頁疊在一起的那一格 */
    await new Promise((r) => setTimeout(r, 450));
    await Deno.mkdir("design/i18n", { recursive: true });
    const png = await b.cdp("Page.captureScreenshot", { format: "png" }) as { data: string };
    await Deno.writeFile(
      `design/i18n/${LANG}-${DIM}d-${where}.png`,
      Uint8Array.from(atob(png.data), (c) => c.charCodeAt(0)),
    );
  }
}

try {
  await b.open(`?lang=${LANG}&dim=${DIM}&pace=1&hold=1`);
  await b.eval(`TUNE.roundGap = 120; return 1`);
  await b.until(`!document.getElementById("lobby").hidden`, "大廳出現");
  await scan("lobby");

  /* 大廳 → 設定／規則那一疊 */
  await b.eval(`document.getElementById("lbPref").click(); return 1`);
  await b.until(`!document.getElementById("pg").hidden`, "設定頁出現");
  await scan("pref");
  await b.eval(`document.querySelector('[data-pg="me"]').click(); return 1`);
  await scan("account");
  await b.eval(`document.querySelector('[data-pg="rules"]').click(); return 1`);
  await scan("rules");
  await b.eval(`document.getElementById("pgX").click(); return 1`);

  /* 一個人打 → 開房頁 → 規則視窗 */
  await b.eval(`document.getElementById("lbSolo").click(); return 1`);
  await b.until(`!!document.querySelector(".rm-go")`, "開房頁出現");
  await scan("room");
  await b.eval(`document.querySelector('[data-room="rules"]').click(); return 1`);
  await b.until(`!!document.querySelector('[data-rule="decks"]')`, "規則視窗出現");
  await scan("room-rules");
  /* 這一場打短一點：單副、9 以上，十個人＝三局 */
  await b.eval(`document.querySelector('[data-rule="decks"][data-v="1"]').click(); return 1`);
  await b.eval(`document.querySelector('[data-rule="minRank"][data-v="9"]').click(); return 1`);
  await b.eval(`document.querySelector('[data-room="seats"]').click(); return 1`);
  for (let i = 0; i < 6; i++) {
    await b.until(`!!document.querySelector('[data-net="addai"]')`, "空位還在");
    await b.eval(`document.querySelector('[data-net="addai"]').click(); return 1`);
  }
  await b.eval(`document.querySelector('[data-net="begin"], .rm-go').click(); return 1`);

  /* 叫墩那一刻、出牌那一刻各掃一次 */
  await b.until(`UD.G && UD.G.phase === "bid"`, "開始叫墩");
  await scan("table-bid");
  for (;;) {
    const p = await b.eval<string>(`return UD.G.phase`);
    if (p === "play") break;
    if (p === "over") break;
    await b.eval(`const x = document.querySelector("[data-bid]:not([disabled])"); if(x) x.click(); return 1`);
    await new Promise((r) => setTimeout(r, 60));
  }
  await scan("table-play");

  /* 來回切一趟。?lang= 驗的是開機那條路，這裡驗的是設定頁那顆按鈕：
     靜態 HTML 由 i18nDOM 就地換、動態的那幾塊各自重畫，切回來不能走味。 */
  const other = LANG === "en" ? "zh" : "en";
  await b.eval(`document.getElementById("btnPref").click(); return 1`);
  await b.until(`!!document.querySelector('#optLang [data-v="${other}"]')`, "語言那一排");
  await b.eval(`document.querySelector('#optLang [data-v="${other}"]').click(); return 1`);
  await b.eval(`document.getElementById("pgX").click(); return 1`);
  const back = await b.eval<string[]>(other === "en" ? SCAN : SCAN_EN);
  if (back.length) found["switched-to-" + other] = back;
  await b.eval(`document.getElementById("btnPref").click(); return 1`);
  await b.until(`!!document.querySelector('#optLang [data-v="${LANG}"]')`, "語言那一排");
  await b.eval(`document.querySelector('#optLang [data-v="${LANG}"]').click(); return 1`);
  await b.eval(`document.getElementById("pgX").click(); return 1`);
  await scan("switched-back");

  /* 牌桌開著的時候設定頁長得不一樣（多一顆「離開遊戲」） */
  await b.eval(`document.getElementById("btnPref").click(); return 1`);
  await b.until(`!document.getElementById("pg").hidden`, "牌局中的設定頁");
  await b.eval(`document.getElementById("btnQuit").click(); return 1`);
  await scan("pref-in-game");
  await b.eval(`document.getElementById("quitNo").click(); document.getElementById("pgX").click(); return 1`);

  /* 打完 → 收桌 */
  const t0 = Date.now();
  for (;;) {
    const p = await b.eval<string>(`return UD.G.phase`);
    if (p === "over") break;
    if (Date.now() - t0 > 120000) throw new Error("打不完，停在 " + p);
    await b.eval(`
      const bd = document.querySelector("[data-bid]:not([disabled])");
      if(bd){ bd.click(); return 1; }
      const c = [...document.querySelectorAll("#hand [data-card]")].find(x=>!x.disabled);
      if(c){ c.click(); return 2; }
      const nx = document.getElementById("btnNext");
      if(nx){ nx.click(); return 3; }
      return 0;`);
    await new Promise((r) => setTimeout(r, 50));
  }
  await b.until(`!document.getElementById("endOv").hidden`, "收桌那一頁");
  await scan("end");

  const pages = Object.keys(found);
  console.log(`\n11 Up & Down — 殘留中文掃描（lang=${LANG}，${DIM === "3" ? "立體" : "平面"}牌桌）`);
  if (!pages.length) {
    console.log(LANG === "en"
      ? "  走過 12 站，看得到的字裡一個中文都沒有"
      : "  走過 12 站，看得到的字裡沒有一句是字典裡的英文");
    console.log("  ✓ 全部通過\n");
  } else {
    let n = 0;
    for (const p of pages) {
      console.log(`\n  [${p}]`);
      for (const r of found[p]) { console.log("   · " + r); n++; }
    }
    console.log(`\n  ✗ ${n} 處沒有跟著語言走（失敗那一站的畫面留在 design/i18n/_fail-*.png）\n`);
    Deno.exitCode = 1;
  }
} finally {
  await b.close();
}
