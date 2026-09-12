// 把兩邊的規則引擎從原始檔裡「借」出來跑，不改動任何產品程式。
//
// 為什麼是用切的、不是 import：牌局引擎住在 docs/index.html 裡（那是刻意的——前端單檔、
// 沒有建置流程），伺服器那份則跟 Deno.serve 綁在同一個檔。兩邊都沒有可以直接 import 的出口，
// 但兩邊都有清楚的區段標記，所以這裡照標記切出「純計算」那一段，在沙箱裡求值。
//
// 切壞了會怎樣：找不到標記就直接丟例外（下面每一個 cut 都會），不會安靜地少測一塊。

const ROOT = new URL("../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, ROOT));

/** 從 src 取出 a 與 b 兩個標記之間那一段；任一個找不到就報哪一個找不到 */
function cut(src: string, a: string, b: string, from = 0): string {
  const i = src.indexOf(a, from);
  if (i < 0) throw new Error(`原始檔裡找不到起始標記：${a}`);
  const j = src.indexOf(b, i + a.length);
  if (j < 0) throw new Error(`原始檔裡找不到結束標記：${b}`);
  return src.slice(i, j);
}

/** 可重播的亂數。同一顆種子＝同一場牌，測失敗時能原樣再跑一次 */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

export type Card = { s: number; r: number; id: string };
// deno-lint-ignore no-explicit-any
export type Engine = Record<string, any>;

/**
 * 客端引擎（docs/index.html）。
 * 回傳的東西以 UD.engine 那份名單為準——那是引擎唯一對外的窗口，
 * 名單上多了一支而這裡沒測到，engine_test 會當場說。
 */
export async function loadClient(): Promise<
  { engine: Engine; exported: string[]; setRng: (f: () => number) => void }
> {
  const html = await read("docs/index.html");

  // 「牌」這個標記在 CSS 裡也有一個，所以從主程式那支 script 之後才開始找
  const scriptAt = html.indexOf("window.TUNE = TUNE;");
  if (scriptAt < 0) throw new Error("找不到主程式的起點（window.TUNE = TUNE;）");
  const src = cut(
    html,
    "/* ================= 牌 ================= */",
    "/* ================= 執行環境 ================= */",
    scriptAt,
  );

  // UD.engine 的名單：這份測試要走的就是這扇門
  const block = cut(html, "  engine:{", "  }\n};");
  const exported = [...block.matchAll(/(\w+)\s*:\s*\w+/g)].map((m) => m[1]);
  if (exported.length < 10) throw new Error("UD.engine 的名單看起來不對：" + exported.join(","));

  // 引擎本身不碰畫面，但同一段裡有幾行在啟動時摸 DOM（把花色路徑塞進 <symbol>），
  // 所以給它一組什麼都沒有的替身；真的多摸了別的東西會在這裡爆掉，不會靜靜跳過。
  const doc = {
    querySelector: () => null,
    getElementById: () => null,
    body: { classList: { contains: () => false } },
  };
  const win = { matchMedia: () => ({ matches: false }) };

  const extras = ["legalCards", "sortHand", "rules", "RULE_DEFAULTS", "JS", "JOKER_N",
                  "ladderFor", "trickBest", "isJoker", "shuffle"];
  const names = [...new Set([...exported, ...extras])];
  const body = `"use strict";\n${src}\nreturn {${names.join(",")}};`;

  // 引擎裡的洗牌與 AI 都吃 Math.random。把 Math 當參數傳進去（函式裡的 Math 就是這個），
  // 換成可重播的亂數之後，同一顆種子＝同一場牌。
  let rnd: () => number = Math.random;
  const M: Math = Object.create(Math);
  (M as { random: () => number }).random = () => rnd();
  const setRng = (f: () => number) => { rnd = f; };

  const make = new Function("window", "document", "Math", body) as
    (w: unknown, d: unknown, m: unknown) => Engine;
  const engine = make(win, doc, M);
  for (const n of exported) {
    if (typeof engine[n] !== "function") throw new Error(`UD.engine 上的 ${n} 沒有被切進來`);
  }
  return { engine, exported, setRng };
}

/**
 * 伺服器引擎（supabase/functions/game/index.ts）的純計算那一段。
 * 只到「手牌」之前為止——再下去就是碰資料庫的 async，那些不在這份對照的範圍裡。
 */
export async function loadServer(): Promise<Engine> {
  const ts = await read("supabase/functions/game/index.ts");
  const src = cut(
    ts,
    "/* ════════════ 牌與規則 ════════════ */",
    "/* ════════════ 手牌（只有這裡碰得到）════════════ */",
  );
  const names = ["cleanCfg", "buildDeck", "deckSizeOf", "maxHand", "ladderFor", "legalCards",
                 "beats", "sortHand", "roundPoints", "bidSum", "hookBlocked", "aiBid", "aiCard",
                 "trickBest", "RULE_DEFAULTS", "JS", "JOKER_N", "PEAK_CAP"];
  const mod = `${src}\nexport { ${names.join(", ")} };\n`;
  const url = "data:application/typescript;charset=utf-8," + encodeURIComponent(mod);
  return await import(url) as Engine;
}

/** 讓伺服器那份的亂數也可重播（它用 crypto.getRandomValues 洗牌） */
export function seedCrypto(rng: () => number): () => void {
  const real = crypto.getRandomValues.bind(crypto);
  // deno-lint-ignore no-explicit-any
  (crypto as any).getRandomValues = (arr: any) => {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(rng() * 4294967296);
    return arr;
  };
  // deno-lint-ignore no-explicit-any
  return () => { (crypto as any).getRandomValues = real; };
}
