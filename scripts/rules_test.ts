// 11 Up & Down — 兩份規則對照
//
// 跑法：deno run --allow-read scripts/rules_test.ts
//
// 規則有兩份：畫面一份（docs/index.html）、伺服器一份（supabase/functions/game/index.ts），
// 手抄的、沒有共用程式。這支把同樣的輸入餵給兩邊，比對輸出——改漏一邊，這裡會當場說。
//
// 不在比對範圍裡（伺服器刻意獨有的）：斷線 30 秒 AI 接手、把房主送上來的規則夾回合理範圍、
// 用真亂數洗牌，以及碰資料庫的那一整段。

import { loadClient, loadServer, seeded } from "./_engines.ts";

const JS = 4;
type Card = { s: number; r: number; id: string };

const diffs: string[] = [];
let ctx = "";
let checks = 0;
function same(a: unknown, b: unknown, what: string) {
  checks++;
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y && diffs.length < 30) diffs.push(`${ctx}\n    ${what}\n    畫面：${x}\n    伺服器：${y}`);
  else if (x !== y) diffs.push("…（後面的先不列了）");
}

const { engine: C, setRng } = await loadClient();
const S = await loadServer();
const ids = (cs: Card[]) => cs.map((c) => c.id).join(" ");
const t0 = performance.now();

/* ── 一、牌組與階梯 ── */
ctx = "牌組與階梯";
for (const decks of [1, 2]) {
  for (let minRank = 2; minRank <= 9; minRank++) {
    for (const jokers of [0, 1]) {
      const a = C.buildDeck(decks, minRank, jokers), b = S.buildDeck(decks, minRank, jokers);
      same(ids(a), ids(b), `buildDeck(${decks}, ${minRank}, ${jokers}) 發出來的牌`);
      same(C.deckSizeOf(decks, minRank, jokers), S.deckSizeOf(decks, minRank, jokers),
        `deckSizeOf(${decks}, ${minRank}, ${jokers})`);
      for (let n = 2; n <= 10; n++) {
        const size = C.deckSizeOf(decks, minRank, jokers);
        same(C.maxHand(size, n), S.maxHand(size, n), `maxHand(${size}, ${n})`);
        same(C.ladderFor(C.maxHand(size, n)), S.ladderFor(S.maxHand(size, n)),
          `ladderFor：${decks} 副 · 最小 ${minRank} · ${n} 人`);
      }
    }
  }
}

/* ── 二、誰贏這一墩 ── */
ctx = "誰贏這一墩（beats）";
const CARDS: Card[] = [];
for (let s = 0; s < 4; s++) for (const r of [7, 10, 13, 14]) CARDS.push({ s, r, id: `0-${s}-${r}` });
CARDS.push({ s: JS, r: 15, id: "j-0" }, { s: JS, r: 15, id: "j-1" });
for (const trump of [null, 0, 1]) {
  for (const led of [0, 1, JS]) {
    for (const a of CARDS) {
      for (const b of CARDS) {
        same(C.beats(a, b, trump, led), S.beats(a, b, trump, led),
          `beats(${a.id}, ${b.id}, 王牌=${trump}, 跟=${led})`);
      }
    }
  }
}

/* ── 三、能出哪些牌 ── */
ctx = "能出哪些牌（legalCards）";
const rng = seeded(99);
const pick = () => CARDS[Math.floor(rng() * CARDS.length)];
for (let t = 0; t < 400; t++) {
  const hand = Array.from({ length: 1 + Math.floor(rng() * 6) }, pick);
  for (const led of [null, 0, 1, 2, JS]) {
    same(ids(C.legalCards(hand, led)), ids(S.legalCards(hand, led)),
      `legalCards([${ids(hand)}], 跟=${led})`);
  }
}

/* ── 四、手牌排序 ── */
ctx = "手牌排序（sortHand）";
for (let t = 0; t < 200; t++) {
  const hand = Array.from({ length: 2 + Math.floor(rng() * 8) }, pick);
  for (const trump of [null, 0, 2]) {
    const a = hand.slice(), b = hand.slice();
    C.sortHand(a, trump); S.sortHand(b, trump);
    same(ids(a), ids(b), `sortHand([${ids(hand)}], 王牌=${trump}）`);
  }
}

/* ── 五、計分 ── */
ctx = "計分（roundPoints）";
for (const hit of ["plus", "x10", "sq"]) {
  for (const zero of ["flat", "hand"]) {
    for (const miss of ["diff", "x10", "sq"]) {
      const cc = { hit, zero, miss }, sc = S.cleanCfg({ n: 4, hit, zero, miss });
      for (let hs = 1; hs <= 11; hs++) {
        for (let bid = 0; bid <= hs; bid++) {
          for (let got = 0; got <= hs; got++) {
            same(C.roundPoints(bid, got, hs, cc), S.roundPoints(bid, got, hs, sc),
              `叫 ${bid} 得 ${got}（${hs} 張）· ${hit}/${zero}/${miss}`);
          }
        }
      }
    }
  }
}

/* ── 六、the hook ── */
ctx = "the hook（hookBlocked／bidSum）";
for (const bidMode of ["seq", "sim"]) {
  for (const hook of [1, 0]) {
    for (let n = 2; n <= 6; n++) {
      for (let hs = 1; hs <= 5; hs++) {
        for (let starter = 0; starter < n; starter++) {
          for (let t = 0; t < 6; t++) {
            const bids = Array.from({ length: n }, () => {
              const r = rng();
              return r < .2 ? null : r < .3 ? -1 : Math.floor(rng() * (hs + 1));
            });
            const cfg = { ...C.RULE_DEFAULTS, n, hook, bidMode };
            for (const phase of ["bid", "play"]) {
              const G = { cfg, bids, hs, starter, phase };
              same(C.bidSum(G), S.bidSum(G), `bidSum([${bids}])`);
              for (let seat = 0; seat < n; seat++) {
                same(C.hookBlocked(G, seat), S.hookBlocked(G, seat),
                  `hookBlocked(座位 ${seat}／${n} 人 ${hs} 張 ${bidMode} hook=${hook} ${phase}／叫墩 [${bids}]）`);
              }
            }
          }
        }
      }
    }
  }
}

/* ── 七、AI 叫墩 ── */
// 兩邊都在最後抖一下亂數（(Math.random()-.5)*.5）。把兩邊的亂數同時釘成同一個值，
// 抖動就一樣，剩下的差別才是真的差別。
ctx = "AI 叫墩（aiBid）";
const realRandom = Math.random;
for (const jitter of [0, .25, .5, .75, .999]) {
  setRng(() => jitter);
  Math.random = () => jitter;
  for (let n = 2; n <= 8; n += 2) {
    for (let hs = 1; hs <= 8; hs += 2) {
      for (const trump of [null, 0, 2]) {
        for (let t = 0; t < 12; t++) {
          const hand = Array.from({ length: hs }, pick);
          for (const no of [-1, 0, 1, hs]) {
            const G = {
              cfg: { ...C.RULE_DEFAULTS, n, hook: no >= 0 ? 1 : 0, bidMode: "seq" },
              hands: [hand], bids: Array(n).fill(null), hs, starter: 0, phase: "bid", trump,
            };
            // 客端的 aiBid 自己去問 hookBlocked，所以把狀態擺成「最後一位、其他人都叫完了」
            if (no >= 0) {
              G.bids = Array.from({ length: n }, (_, i) => (i === 0 ? null : 0));
              G.starter = 1; G.hs = Math.max(hs, no);
            }
            const cno = C.hookBlocked(G, 0);
            same(C.aiBid(G, 0), S.aiBid(hand, trump, G.hs, n, cno),
              `aiBid（${n} 人 ${G.hs} 張 王牌=${trump} 擋=${cno} 抖動=${jitter}）手牌 [${ids(hand)}]`);
          }
        }
      }
    }
  }
}
Math.random = realRandom;
setRng(realRandom);

/* ── 八、AI 出牌 ── */
ctx = "AI 出牌（aiCard）";
for (let t = 0; t < 600; t++) {
  const n = 2 + Math.floor(rng() * 5);
  const trump = [null, 0, 1, 2, 3][Math.floor(rng() * 5)];
  const hand = Array.from({ length: 1 + Math.floor(rng() * 7) }, pick);
  const tn = Math.floor(rng() * n);
  const trick = Array.from({ length: tn }, (_, i) => ({ p: i, card: pick() }));
  const led = tn ? trick[0].card.s : null;
  const need = Math.floor(rng() * 4) - 1;
  const G = {
    cfg: { ...C.RULE_DEFAULTS, n }, hands: [hand], trick, led, trump,
    bids: [Math.max(0, need)], won: [0], hs: 5, phase: "play", turn: 0, starter: 0,
  };
  G.bids[0] = need; G.won[0] = 0;
  same(C.aiCard(G, 0).id, S.aiCard(hand, trick, led, trump, need).id,
    `aiCard（王牌=${trump} 跟=${led} 還差 ${need} 墩）手牌 [${ids(hand)}] 檯面 [${ids(trick.map((x) => x.card))}]`);
}

/* ── 九、誰贏這一墩：整墩的版本 ── */
ctx = "整墩的贏家（trickBest）";
for (let t = 0; t < 400; t++) {
  const n = 2 + Math.floor(rng() * 5);
  const trick = Array.from({ length: n }, (_, i) => ({ p: i, card: pick() }));
  const R = { trick, trump: [null, 0, 1][Math.floor(rng() * 3)], led: trick[0].card.s };
  same(C.trickBest(R), S.trickBest(R), `trickBest([${ids(trick.map((x) => x.card))}]）`);
}

/* ── 結果 ── */
const ms = Math.round(performance.now() - t0);
const N = (x: number) => x.toLocaleString("en-US");
console.log("11 Up & Down — 兩份規則對照（畫面 vs 伺服器）");
console.log(`  比了 ${N(checks)} 組輸入：牌組、階梯、誰贏這一墩、能出哪些牌、手牌排序、計分、the hook、AI 叫墩、AI 出牌`);
console.log(`  ${ms} 毫秒`);
if (diffs.length) {
  console.log(`\n  ✗ 兩邊有 ${diffs.length} 處說法不一樣：\n`);
  for (const d of diffs) console.log("  · " + d);
  Deno.exit(1);
}
console.log("  ✓ 兩份規則目前完全一致");
