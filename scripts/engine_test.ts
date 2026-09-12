// 11 Up & Down — 牌局引擎測試
//
// 跑法：deno run --allow-read scripts/engine_test.ts [--seed=1]
//
// 這支做的事：把各種規則組合各打完一整場（21 局），每一步都檢查牌局有沒有說謊。
// 檢查用的「誰贏這一墩」「能出哪些牌」「這局幾分」是這裡自己算的一份，
// 刻意不呼叫引擎那份——兩邊算出來不一樣，就是有一邊錯了。
//
// 失敗訊息會帶著種子與規則，照著跑一次就是同一場牌。

import { loadClient, seeded } from "./_engines.ts";

const JS = 4;                         // 鬼牌自成一門「花色」
type Card = { s: number; r: number; id: string };
type Cfg = Record<string, unknown> & { n: number };

const args = new Map(Deno.args.map((a) => a.replace(/^--/, "").split("=") as [string, string]));
const BASE_SEED = Number(args.get("seed") ?? 1) || 1;

const fails: string[] = [];
let ctx = "";
let checks = 0;
function ok(cond: unknown, msg: string) {
  checks++;
  if (!cond && fails.length < 40) fails.push(`${ctx}\n    ${msg}`);
  else if (!cond) fails.push("…（後面的先不列了）");
}

/* ─── 這份測試自己的規則實作，用來對照引擎那一份 ─── */

/** 能出哪些牌：鬼牌永遠出得掉；有跟牌花色就得跟，但鬼牌也算數 */
function myLegal(hand: Card[], led: number | null): Card[] {
  if (led === null || led === undefined || led === JS) return hand.slice();
  const hasLed = hand.some((c) => c.s === led);
  return hasLed ? hand.filter((c) => c.s === led || c.s === JS) : hand.slice();
}

/** 一張牌在這一墩的份量：鬼牌 > 王牌 > 跟牌花色 > 其他。同一階就比點數，同點先出的贏 */
function tier(c: Card, trump: number | null, led: number | null): number {
  if (c.s === JS) return 3;
  if (trump !== null && c.s === trump) return 2;
  if (c.s === led) return 1;
  return 0;
}
function myBeats(a: Card, b: Card, trump: number | null, led: number | null): boolean {
  const ta = tier(a, trump, led), tb = tier(b, trump, led);
  if (ta !== tb) return ta > tb;
  if (ta === 0) return false;          // 兩張都跟不上：後出的不會贏
  if (ta === 3) return false;          // 兩張鬼牌：先出的那張留著
  return a.r > b.r;
}

/** 這一局幾分。三個旋鈕各自獨立，照 README 那張表寫的 */
function myPoints(bid: number, got: number, hs: number, c: Cfg): number {
  const hit = (c.hit ?? "plus") as string, zero = (c.zero ?? "flat") as string,
    miss = (c.miss ?? "diff") as string;
  if (bid === got) {
    if (bid === 0) return zero === "hand" ? 5 + hs : 5;
    return hit === "x10" ? 10 * bid : hit === "sq" ? 10 + bid * bid : 10 + bid;
  }
  const d = Math.abs(got - bid);
  return miss === "x10" ? -10 * d : miss === "sq" ? -(d * d) : -d;
}

const ids = (cs: Card[]) => cs.map((c) => c.id).sort().join(" ");

/* ─── 打完一整場 ─── */

// deno-lint-ignore no-explicit-any
type E = Record<string, any>;
const tally = { games: 0, rounds: 0, tricks: 0, jokerTrump: 0, hooked: 0 };

function playGame(E: E, cfg: Cfg, label: string) {
  const n = cfg.n;
  const G = E.newGame(cfg);
  tally.games++;

  const size = E.deckSizeOf(G.cfg.decks, G.cfg.minRank, G.cfg.jokers);
  const peak = E.maxHand(size, n);
  ctx = `${label}｜開局`;
  ok(G.deckSize === size, `deckSize 對不上：${G.deckSize} ≠ ${size}`);
  ok(peak >= 1 && peak <= 11, `階梯頂點越界：${peak}`);
  ok(n * peak + 1 <= size, `牌不夠發：${n} 人 × ${peak} 張 + 王牌 > ${size} 張`);
  const want = [...Array(peak).keys()].map((i) => i + 1)
    .concat([...Array(peak - 1).keys()].map((i) => peak - 1 - i));
  ok(G.ladder.join(",") === want.join(","), `階梯不對：${G.ladder.join(",")}`);
  ok(G.score.every((s: number) => s === 0), "開局分數不是 0");

  const deckIds = new Set(E.buildDeck(G.cfg.decks, G.cfg.minRank, G.cfg.jokers).map((c: Card) => c.id));
  ok(deckIds.size === size, `一副牌裡有重複的 id：${deckIds.size} ≠ ${size}`);

  let guard = 0;
  for (;;) {
    E.startRound(G);
    if (G.phase === "over") break;
    if (++guard > 40) { ok(false, "局數停不下來"); break; }
    tally.rounds++;
    ctx = `${label}｜第 ${G.ri + 1} 局（${G.hs} 張）`;

    /* 發牌 */
    const dealt: Card[] = ([] as Card[]).concat(...G.hands);
    ok(G.hands.every((h: Card[]) => h.length === G.hs), `手牌張數不齊：${G.hands.map((h: Card[]) => h.length)}`);
    ok(G.trumpCard, "沒有翻王牌");
    ok(new Set(dealt.map((c) => c.id)).size === n * G.hs, "有人拿到重複的牌");
    ok(dealt.concat([G.trumpCard]).every((c: Card) => deckIds.has(c.id)), "發出了不屬於這副牌的牌");
    ok(G.trump === (G.trumpCard.s === JS ? null : G.trumpCard.s), "王牌花色跟翻出來那張對不上");
    if (G.trumpCard.s === JS) tally.jokerTrump++;
    ok(G.bids.every((b: unknown) => b === null), "開局叫墩不是空的");
    ok(G.won.every((w: number) => w === 0), "開局墩數不是 0");
    ok(G.phase === "bid", `發完牌不是在叫墩：${G.phase}`);

    /* 叫墩 */
    const sim = G.cfg.bidMode === "sim";
    if (sim) {
      const order = [...Array(n).keys()];
      order.forEach((seat, k) => {
        const v = E.aiBid(G, seat);
        ok(v >= 0 && v <= G.hs, `叫墩越界：${v}`);
        ok(E.applyBid(G, seat, v) === true, "同時叫墩被拒絕");
        ok(E.applyBid(G, seat, v) === false, "同一個人放了第二次");
        if (k < n - 1) {
          ok(G.bids.every((b: number | null) => b === null || b === -1), "還沒開就看得到別人的數字");
          ok(G.phase === "bid", "還沒全部放完就開始出牌");
        }
      });
      ok(G.bids.every((b: number, i: number) => b === G.sealed[i]), "翻開的數字跟蓋著的不一樣");
    } else {
      for (let k = 0; k < n; k++) {
        const seat = G.turn;
        ok(seat === (G.starter + k) % n, `叫墩順序不對：輪到 ${seat}`);
        ok(E.applyBid(G, seat, -1) === false, "接受了負的叫墩");
        ok(E.applyBid(G, seat, G.hs + 1) === false, "接受了超過張數的叫墩");
        if (n > 1) ok(E.applyBid(G, (seat + 1) % n, 0) === false, "不是他的回合也叫得動");
        const no = E.hookBlocked(G, seat);
        if (no >= 0) {
          tally.hooked++;
          ok(k === n - 1, `不是最後一位卻被 hook 擋：座位 ${seat}`);
          ok(G.cfg.hook === 1, "沒開 hook 卻擋人");
          ok(E.applyBid(G, seat, no) === false, `hook 沒擋住 ${no}`);
        }
        const v = E.aiBid(G, seat);
        ok(v >= 0 && v <= G.hs, `叫墩越界：${v}`);
        ok(v !== no, "AI 叫了被 hook 擋掉的數字");
        ok(E.applyBid(G, seat, v) === true, "叫墩被拒絕");
        ok(G.bids[seat] === v, "叫墩沒記進去");
      }
      const sum = G.bids.reduce((a: number, b: number) => a + b, 0);
      if (G.cfg.hook === 1) ok(sum !== G.hs, `hook 開著，總叫墩卻剛好等於總墩數（${sum}）`);
    }
    ok(G.phase === "play", `叫完不是進出牌：${G.phase}`);
    ok(G.turn === G.starter && G.leader === G.starter, "出牌不是從該局第一位開始");

    /* 出牌 */
    const played: Card[] = [];
    for (let t = 0; t < G.hs; t++) {
      for (let k = 0; k < n; k++) {
        const seat = G.turn;
        const hand: Card[] = G.hands[seat];
        const legal: Card[] = E.legalCards(hand, G.led);
        ok(ids(legal) === ids(myLegal(hand, G.led)), "「能出哪些牌」兩邊算的不一樣");
        const bad = hand.find((c) => !legal.some((l) => l.id === c.id));
        if (bad) {
          const before = hand.length;
          ok(E.applyPlay(G, seat, bad.id) === false, `不合法的牌居然出得掉：${bad.id}`);
          ok(hand.length === before, "被拒絕的出牌卻少了一張");
        }
        ok(E.applyPlay(G, seat, "沒有這張牌") === false, "不存在的牌居然出得掉");
        // 找一個「不是現在這位、手上還有牌」的人試出牌：最後一墩時有人手已經空了
        const other = [...Array(n).keys()].find((i) => i !== seat && G.hands[i].length > 0);
        if (other !== undefined) {
          ok(E.applyPlay(G, other, G.hands[other][0].id) === false, "不是他的回合也出得動");
        }
        const c: Card = E.aiCard(G, seat);
        ok(legal.some((l) => l.id === c.id), `AI 出了不合法的牌：${c.id}`);
        const before = hand.length;
        ok(E.applyPlay(G, seat, c.id) === true, "合法的牌卻出不掉");
        ok(hand.length === before - 1, "出了牌手上張數沒少");
        played.push(c);
      }
      ok(G.trick.length === n, "一墩沒有收滿");
      ok(G.phase === "trickend", `一墩打完不是 trickend：${G.phase}`);

      let bi = 0;
      for (let i = 1; i < G.trick.length; i++) {
        if (myBeats(G.trick[i].card, G.trick[bi].card, G.trump, G.led)) bi = i;
      }
      const winner = G.trick[bi].p;
      const wonBefore = [...G.won];
      E.resolveTrick(G);
      tally.tricks++;
      ok(G.won[winner] === wonBefore[winner] + 1,
        `贏家算錯：我算 ${winner}（${G.trick.length === 0 ? "已收" : ""}）`);
      ok(G.won.reduce((a: number, b: number) => a + b, 0) ===
         wonBefore.reduce((a: number, b: number) => a + b, 0) + 1, "一墩加了不只一個人");
      if (G.phase === "play") ok(G.leader === winner && G.turn === winner, "下一墩不是贏家先出");
    }

    /* 收局 */
    ok(G.hands.every((h: Card[]) => h.length === 0), "打完了還有人有牌");
    ok(ids(played) === ids(dealt), "檯面上出過的牌跟發出去的對不上");
    ok(G.won.reduce((a: number, b: number) => a + b, 0) === G.hs, "墩數加起來不等於這局張數");
    ok(G.phase === "roundend", `打完不是 roundend：${G.phase}`);
    const cells = G.log[G.log.length - 1].cells;
    for (let i = 0; i < n; i++) {
      const want = myPoints(G.bids[i], G.won[i], G.hs, G.cfg);
      ok(cells[i].pts === want,
        `分數算錯：叫 ${G.bids[i]} 得 ${G.won[i]}（${G.hs} 張）→ 引擎給 ${cells[i].pts}，應該是 ${want}`);
      ok(cells[i].hit === (G.bids[i] === G.won[i]), "叫中沒中的標記不對");
    }
  }

  ctx = `${label}｜收場`;
  ok(G.phase === "over", `打不完：停在 ${G.phase}`);
  ok(G.log.length === G.ladder.length, `局數不對：${G.log.length} ≠ ${G.ladder.length}`);
  for (let i = 0; i < n; i++) {
    const sum = G.log.reduce((a: number, r: { cells: { pts: number }[] }) => a + r.cells[i].pts, 0);
    ok(G.score[i] === sum, `總分跟每局加起來不一樣：${G.score[i]} ≠ ${sum}`);
  }
}

/* ─── 開跑 ─── */

const { engine: E, exported, setRng } = await loadClient();
const t0 = performance.now();

// 一、規則組合掃過一遍：每一種組合都打完一整場
const AXES = {
  bidMode: ["seq", "sim"],
  hook: [1, 0],
  jokers: [0, 1],
  decks: [2, 1],
  hit: ["plus", "x10", "sq"],
  zero: ["flat", "hand"],
  miss: ["diff", "x10", "sq"],
};
let combos: Cfg[] = [{ n: 4 }];
for (const [k, vs] of Object.entries(AXES)) {
  combos = combos.flatMap((c) => vs.map((v) => ({ ...c, [k]: v })));
}
combos.forEach((cfg, i) => {
  setRng(seeded(BASE_SEED + i));
  playGame(E, cfg, `規則 ${JSON.stringify(cfg)}／種子 ${BASE_SEED + i}`);
});

// 二、人數 2–10 人，各打一場（鬼牌開著，順便讓鬼牌多出場）
for (let n = 2; n <= 10; n++) {
  const cfg = { n, jokers: 1 };
  setRng(seeded(BASE_SEED + 1000 + n));
  playGame(E, cfg, `${n} 人局／種子 ${BASE_SEED + 1000 + n}`);
}

// 三、牌組大小的邊角：最小點數與副數
for (const minRank of [2, 4, 7, 9]) {
  for (const decks of [1, 2]) {
    for (const n of [3, 6, 10]) {
      const cfg = { n, minRank, decks, jokers: 1 };
      const seed = BASE_SEED + 2000 + minRank * 100 + decks * 10 + n;
      setRng(seeded(seed));
      playGame(E, cfg, `最小點數 ${minRank}／${decks} 副／${n} 人／種子 ${seed}`);
    }
  }
}

// 四、寫在 README 上的那幾個數字
ctx = "README 說的階梯頂點";
ok(E.deckSizeOf(2, 7, 0) === 64, "預設牌組不是 64 張");
ok(E.maxHand(64, 6) === 10, "64 張 6 人不是到 10 張");
ok(E.maxHand(64, 8) === 7, "64 張 8 人不是到 7 張");
ok(E.maxHand(64, 10) === 6, "64 張 10 人不是到 6 張");
ok(E.maxHand(45, 4) === 11, "45 張 4 人走不完 1→11→1");
ok(E.maxHand(44, 4) === 10, "44 張 4 人卻還能到 11");
ok(E.deckSizeOf(2, 7, 1) === 66, "加了鬼牌不是 66 張（兩張，不隨副數加倍）");
ok(E.deckSizeOf(1, 7, 1) === 34, "單副加鬼牌不是 34 張");

ctx = "計分那三個旋鈕";
for (const [cfg, bid, got, hs, want] of [
  [{}, 3, 3, 5, 13], [{ hit: "x10" }, 3, 3, 5, 30], [{ hit: "sq" }, 3, 3, 5, 19],
  [{}, 0, 0, 5, 5], [{ zero: "hand" }, 0, 0, 5, 10],
  [{}, 3, 1, 5, -2], [{ miss: "x10" }, 3, 1, 5, -20], [{ miss: "sq" }, 3, 1, 5, -4],
] as [Cfg, number, number, number, number][]) {
  const got2 = E.roundPoints(bid, got, hs, cfg);
  ok(got2 === want, `${JSON.stringify(cfg)} 叫 ${bid} 得 ${got}：引擎 ${got2}，應該 ${want}`);
}

ctx = "鬼牌";
const J1 = { s: JS, r: 15, id: "j-0" }, J2 = { s: JS, r: 15, id: "j-1" };
const trumpA = { s: 0, r: 14, id: "0-0-14" }, plainA = { s: 1, r: 14, id: "0-1-14" };
ok(E.beats(J1, trumpA, 0, 1) === true, "鬼牌沒有比王牌大");
ok(E.beats(trumpA, J1, 0, 1) === false, "王牌居然壓過鬼牌");
ok(E.beats(J2, J1, 0, 1) === false, "兩張鬼牌不是先出的贏");
ok(E.beats(J1, plainA, null, 1) === true, "無王時鬼牌沒有最大");
const hand = [{ s: 1, r: 9, id: "a" }, { s: 2, r: 9, id: "b" }, J1];
ok(ids(E.legalCards(hand, JS)) === ids(hand), "鬼牌領出時沒有全部放行");
ok(ids(E.legalCards(hand, 1)) === ids([hand[0], J1]), "有跟牌花色時鬼牌不算數");
ok(ids(E.legalCards(hand, 3)) === ids(hand), "跟不上時沒有全部放行");
const dupA = { s: 0, r: 14, id: "1-0-14" };
ok(E.beats(dupA, trumpA, 0, 0) === false, "雙副牌同點同花不是先出的贏");

ctx = "UD.engine 的名單";
ok(exported.length === 14, `名單長度變了（${exported.length}）——有新東西沒被測到？`);

/* ─── 結果 ─── */
const ms = Math.round(performance.now() - t0);
const N = (x: number) => x.toLocaleString("en-US");
console.log("11 Up & Down — 牌局引擎測試");
console.log(`  規則組合 ${N(combos.length)} 種、人數 2–10 人、牌組邊角 24 種，各打完一整場`);
console.log(`  打了 ${N(tally.games)} 場、${N(tally.rounds)} 局、${N(tally.tricks)} 墩，` +
  `檢查 ${N(checks)} 次（其中 ${N(tally.hooked)} 次被 hook 擋、${N(tally.jokerTrump)} 局翻到鬼牌當王牌）`);
console.log(`  ${ms} 毫秒`);
if (fails.length) {
  console.log(`\n  ✗ ${fails.length} 個地方不對：\n`);
  for (const f of fails) console.log("  · " + f);
  console.log(`\n  重跑同一批：deno run --allow-read scripts/engine_test.ts --seed=${BASE_SEED}`);
  Deno.exit(1);
}
console.log("  ✓ 全部通過");
