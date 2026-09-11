// 11 Up & Down — 牌局伺服器
//
// 為什麼整個引擎在這裡而不在瀏覽器：只要發牌發生在某台玩家的裝置上，
// 那台裝置就必然握有全部人的手牌。搬到這裡之後，每個人的回應裡只會有自己那份，
// 別人的牌從頭到尾沒離開過資料庫。這是自己架唯一真正買到的東西。
//
// 身分＝Google 帳號（Supabase Auth）。Authorization 帶的是使用者自己的 access token，
// 不是 anon key——anon key 誰都有，那不叫身分。座位、房主、戰績都認 auth.users.id。
// 舊的「localStorage 隨機 token」只剩一個用途：那台裝置第一次登入時把原本那一列認領過去，
// 座位與房主身分才不會斷（見 resolvePid）。

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { verifyLocal } from "./auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* ════════════ 牌與規則 ════════════ */
type Card = { s: number; r: number; id: string };
type Seat = { name: string; kind: "open" | "human" | "ai"; pid: string | null; av?: string | null };

const PEAK_CAP = 11;
const AFK_MS = 30_000;
/* 鬼牌自成一門「花色」：不屬於任何一門，比王牌還大，整桌固定兩張 */
const JS = 4, JOKER_N = 2;

/* 這一桌的規則。每一項都是獨立的旋鈕，預設就是原本玩的那套；
   房主在等待房間裡改，改完存在 cfg 裡跟著牌局走。 */
type Rules = {
  n: number; decks: number; minRank: number; jokers: number;
  bidMode: "seq" | "sim"; hook: number;
  hit: "plus" | "x10" | "sq"; zero: "flat" | "hand"; miss: "diff" | "x10" | "sq";
};
const RULE_DEFAULTS: Omit<Rules, "n"> = {
  decks: 2, minRank: 7, jokers: 0, bidMode: "seq", hook: 1,
  hit: "plus", zero: "flat", miss: "diff",
};
const ONE_OF = <T extends string>(v: unknown, list: readonly T[], dflt: T): T =>
  list.includes(v as T) ? (v as T) : dflt;
/** 房主送上來的東西一律當成陌生人：只認得的欄位、只認得的值 */
function cleanCfg(raw: unknown, keepN = 0): Rules {
  const c = (raw ?? {}) as Record<string, unknown>;
  return {
    n: Math.max(0, Math.min(10, (c.n as number | undefined) ?? keepN | 0)),
    decks: c.decks === 1 ? 1 : 2,
    minRank: Math.max(2, Math.min(9, Number(c.minRank ?? 7) | 0)),
    jokers: c.jokers ? 1 : 0,
    bidMode: ONE_OF(c.bidMode, ["seq", "sim"] as const, "seq"),
    hook: c.hook === 0 || c.hook === false ? 0 : 1,
    hit: ONE_OF(c.hit, ["plus", "x10", "sq"] as const, "plus"),
    zero: ONE_OF(c.zero, ["flat", "hand"] as const, "flat"),
    miss: ONE_OF(c.miss, ["diff", "x10", "sq"] as const, "diff"),
  };
}

function buildDeck(decks: number, minRank: number, jokers: number): Card[] {
  const d: Card[] = [];
  for (let n = 0; n < decks; n++)
    for (let s = 0; s < 4; s++)
      for (let r = minRank; r <= 14; r++) d.push({ s, r, id: `${n}-${s}-${r}` });
  if (jokers) for (let j = 0; j < JOKER_N; j++) d.push({ s: JS, r: 15, id: `j-${j}` });
  return d;
}
function shuffle<T>(a: T[]): T[] {
  // crypto 亂數：這是賭勝負的牌，Math.random 的品質不該拿來發牌
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const deckSizeOf = (decks: number, minRank: number, jokers: number) =>
  (15 - minRank) * 4 * decks + (jokers ? JOKER_N : 0);
const maxHand = (size: number, n: number) =>
  Math.max(1, Math.min(PEAK_CAP, Math.floor((size - 1) / n)));
function ladderFor(peak: number): number[] {
  const l: number[] = [];
  for (let i = 1; i <= peak; i++) l.push(i);
  for (let i = peak - 1; i >= 1; i--) l.push(i);
  return l;
}
function legalCards(hand: Card[], led: number | null): Card[] {
  // 鬼牌不屬於任何花色：它永遠出得掉，別人領它出來時桌上也沒有花色要跟
  if (led === null || led === undefined || led === JS) return hand.slice();
  const f = hand.filter((c) => c.s === led || c.s === JS);
  return f.some((c) => c.s === led) ? f : hand.slice();
}
function beats(a: Card, b: Card, trump: number | null, led: number | null): boolean {
  // 鬼牌比王牌還大；同一墩兩張鬼牌，先出的（b）留著
  if (a.s === JS || b.s === JS) return a.s === JS && b.s !== JS;
  const at = a.s === trump, bt = b.s === trump;
  if (at !== bt) return at;
  if (at) return a.r > b.r;
  if (a.s === led && b.s !== led) return true;
  if (a.s !== led) return false;
  return a.r > b.r; // 同點同花：先出的留著，後出的不算贏
}
function sortHand(h: Card[], trump: number | null) {
  h.sort((a, b) =>
    Number(b.s === JS) - Number(a.s === JS) ||
    Number(b.s === trump) - Number(a.s === trump) || a.s - b.s || b.r - a.r);
}
/* 計分是三個獨立的旋鈕：叫中怎麼算、叫 0 怎麼算、沒中罰多少 */
function roundPoints(bid: number, got: number, hs: number, C: Rules): number {
  if (bid === got) {
    if (bid === 0) return C.zero === "hand" ? 5 + hs : 5;
    return C.hit === "x10" ? 10 * bid : C.hit === "sq" ? 10 + bid * bid : 10 + bid;
  }
  const d = Math.abs(got - bid);
  return C.miss === "x10" ? -10 * d : C.miss === "sq" ? -(d * d) : -d;
}
/** 已經公開的叫墩加總（-1 是同時叫墩裡「放好了還蓋著」，不算數） */
function bidSum(R: Room): number {
  let t = 0;
  for (let i = 0; i < R.cfg.n; i++) { const b = R.bids[i]; if (typeof b === "number" && b >= 0) t += b; }
  return t;
}
/** the hook：最後一位不得讓總叫墩數等於總墩數。回傳被擋掉的那個數，沒有就 -1 */
function hookBlocked(R: Room, seat: number): number {
  if (!R.cfg.hook || R.cfg.bidMode === "sim" || R.phase !== "bid") return -1;
  if (seat !== (R.starter + R.cfg.n - 1) % R.cfg.n) return -1;
  for (let i = 0; i < R.cfg.n; i++)
    if (i !== seat && (R.bids[i] === null || R.bids[i] === undefined)) return -1;
  const left = R.hs - bidSum(R);
  return left >= 0 && left <= R.hs ? left : -1;
}

/* ════════════ AI ════════════ */
function aiBid(hand: Card[], trump: number | null, hs: number, n: number, no = -1): number {
  let e = 0;
  for (const c of hand) {
    if (c.s === JS) e += 0.97;   // 鬼牌幾乎是一墩現金
    else if (c.s === trump) e += c.r >= 13 ? 0.92 : c.r >= 11 ? 0.68 : c.r >= 9 ? 0.45 : 0.3;
    else e += c.r === 14 ? 0.78 : c.r === 13 ? 0.5 : c.r === 12 ? 0.27 : 0.07;
  }
  e = (e * 4) / n + (Math.random() - 0.5) * 0.5;
  let v = Math.max(0, Math.min(hs, Math.round(e)));
  // 被 hook 擋下來就往旁邊挪一格
  if (v === no) v = (v + 1 <= hs && (e >= v || v === 0)) ? v + 1 : Math.max(0, v - 1);
  return v;
}
function aiCard(
  hand: Card[], trick: { p: number; card: Card }[],
  led: number | null, trump: number | null, need: number,
): Card {
  const legal = legalCards(hand, led);
  const val = (c: Card) => (c.s === JS ? 200 : c.s === trump ? 100 : 0) + c.r;
  const asc = legal.slice().sort((a, b) => val(a) - val(b));
  if (trick.length === 0) {
    if (need > 0) {
      const tr = asc.filter((c) => c.s === trump || c.s === JS);
      return tr.length ? tr[tr.length - 1] : asc[asc.length - 1];
    }
    return asc[0];
  }
  let best = trick[0].card;
  for (const t of trick) if (beats(t.card, best, trump, led)) best = t.card;
  const win = asc.filter((c) => beats(c, best, trump, led));
  const lose = asc.filter((c) => !beats(c, best, trump, led));
  if (need > 0) return win.length ? win[0] : asc[0];
  return lose.length ? lose[lose.length - 1] : asc[0];
}

/* ════════════ 房間狀態 ════════════ */
type Room = {
  code: string; rev: number;
  cfg: Rules;
  ladder: number[]; seats: Seat[];
  phase: string; ri: number; hs: number; starter: number;
  trump: number | null; trump_card: Card | null;
  leader: number; turn: number; led: number | null; played: number;
  trick: { p: number; card: Card }[];
  bids: (number | null)[]; won: number[]; score: number[];
  log: unknown[]; host_pid: string | null;
  seen: Record<string, number>; step_at: number;
  // 同一間房打第幾場。打完可以回到等待房間再開一場，戰績要分得出是哪一場。
  match: number;
};

const PERSIST = [
  "cfg", "ladder", "seats", "phase", "ri", "hs", "starter", "trump", "trump_card",
  "leader", "turn", "led", "played", "trick", "bids", "won", "score", "log",
  "host_pid", "seen", "step_at", "match",
] as const;

function trickBest(R: Room): number {
  let bi = 0;
  for (let i = 1; i < R.trick.length; i++)
    if (beats(R.trick[i].card, R.trick[bi].card, R.trump, R.led)) bi = i;
  return bi;
}
function isLive(R: Room, pid: string | null): boolean {
  if (!pid) return false;
  return Date.now() - (R.seen[pid] || 0) < AFK_MS;
}
/** 這個座位現在由 AI 代打？（空位、AI、或斷線超過 30 秒的人） */
function aiSeat(R: Room, i: number): boolean {
  const s = R.seats[i];
  if (s.kind !== "human") return true;
  return !isLive(R, s.pid);
}
function seatOf(R: Room, pid: string): number {
  return R.seats.findIndex((s) => s.pid === pid && s.kind === "human");
}
/** 房主，或房主不在時的任一在座玩家 */
function canDirect(R: Room, pid: string): boolean {
  if (R.host_pid === pid) return true;
  if (isLive(R, R.host_pid)) return false;
  return seatOf(R, pid) >= 0;
}

/* ════════════ 手牌（只有這裡碰得到）════════════ */
/* 這一回合的手牌，進來的時候跟房間同一趟並行抓齊。之後誰要用就從這裡拿——
   同一個請求裡讀第二次，不該再飛一趟新加坡。
   只有「拿得到」才算數：裡面沒有的座位一律回去查資料庫。這樣萬一抓手牌的時候
   剛好有人在發下一局（ri 對不上），最壞也只是慢一趟，不會把空手牌當成真的。 */
type Hands = { ri: number; rows: Map<number, Card[]> };

async function readHand(
  sb: SupabaseClient, code: string, ri: number, seat: number, H?: Hands,
): Promise<Card[]> {
  if (H && H.ri === ri) {
    const hit = H.rows.get(seat);
    if (hit) return hit;
  }
  const { data } = await sb.from("hands").select("cards")
    .eq("code", code).eq("ri", ri).eq("seat", seat).maybeSingle();
  const cards = (data?.cards as Card[]) ?? [];
  if (H && H.ri === ri && data) H.rows.set(seat, cards);
  return cards;
}
async function writeHand(
  sb: SupabaseClient, code: string, ri: number, seat: number, cards: Card[], H?: Hands,
) {
  if (H && H.ri === ri) H.rows.set(seat, cards);
  await sb.from("hands").upsert({ code, ri, seat, cards }, { onConflict: "code,ri,seat" });
}

async function deal(sb: SupabaseClient, R: Room, H?: Hands) {
  R.ri++;
  if (R.ri >= R.ladder.length) { R.phase = "over"; return; }
  const n = R.ladder[R.ri];
  R.hs = n;
  R.starter = R.ri % R.cfg.n;
  const deck = shuffle(buildDeck(R.cfg.decks, R.cfg.minRank, R.cfg.jokers));
  const hands: Card[][] = Array.from({ length: R.cfg.n }, () => []);
  for (let k = 0; k < R.cfg.n; k++) hands[(R.starter + k) % R.cfg.n] = deck.splice(0, n);
  R.trump_card = deck.length ? deck.shift()! : null;
  // 翻到鬼牌：這局無王，但那兩張鬼牌照樣最大
  R.trump = R.trump_card && R.trump_card.s !== JS ? R.trump_card.s : null;
  for (const h of hands) sortHand(h, R.trump);
  R.bids = Array(R.cfg.n).fill(null);
  R.won = Array(R.cfg.n).fill(0);
  R.trick = []; R.led = null; R.played = 0;
  R.leader = R.starter; R.turn = R.starter;
  R.phase = "bid";
  await sb.from("hands").delete().eq("code", R.code);
  await sb.from("hands").insert(
    hands.map((cards, seat) => ({ code: R.code, ri: R.ri, seat, cards })),
  );
  // 剛發的這份就是現在的手牌，進來時抓的那份作廢
  if (H) { H.ri = R.ri; H.rows = new Map(hands.map((cards, seat) => [seat, cards])); }
}

async function applyBid(sb: SupabaseClient, R: Room, seat: number, v: number): Promise<boolean> {
  if (R.phase !== "bid") return false;
  if (!(Number.isInteger(v) && v >= 0 && v <= R.hs)) return false;

  if (R.cfg.bidMode === "sim") {
    // 同時叫墩：數字先寫進 hands（那張表 RLS 開著、一條 policy 都沒有，誰都讀不到），
    // rooms 上只留一個 -1 表示「這位放好了」。全桌放完才一次翻開。
    if (R.bids[seat] !== null && R.bids[seat] !== undefined) return false;
    await sb.from("hands").update({ bid: v })
      .eq("code", R.code).eq("ri", R.ri).eq("seat", seat);
    R.bids[seat] = -1;
    for (let i = 0; i < R.cfg.n; i++) if (R.bids[i] === null || R.bids[i] === undefined) return true;
    const { data } = await sb.from("hands").select("seat,bid").eq("code", R.code).eq("ri", R.ri);
    const sealed = new Map((data ?? []).map((r: { seat: number; bid: number | null }) => [r.seat, r.bid]));
    for (let i = 0; i < R.cfg.n; i++) {
      const b = sealed.get(i);
      R.bids[i] = typeof b === "number" && b >= 0 && b <= R.hs ? b : 0;
    }
    R.phase = "play"; R.turn = R.leader;
    return true;
  }

  if (R.turn !== seat) return false;
  if (v === hookBlocked(R, seat)) return false;
  R.bids[seat] = v;
  let done = true;
  for (let k = 0; k < R.cfg.n; k++) {
    const s = (R.starter + k) % R.cfg.n;
    if (R.bids[s] === null) { R.turn = s; done = false; break; }
  }
  if (done) { R.phase = "play"; R.turn = R.leader; }
  return true;
}

/** 幾個人在座就幾個人玩：座位一動，人數、階梯、分數欄一起跟上 */
function reseat(R: Room) {
  const old = R.score ?? [];
  R.cfg.n = R.seats.length;
  R.ladder = ladderFor(maxHand(
    deckSizeOf(R.cfg.decks, R.cfg.minRank, R.cfg.jokers), Math.max(1, R.cfg.n)));
  R.score = R.seats.map((_, i) => old[i] ?? 0);
  R.bids = R.seats.map(() => null);
  R.won = R.seats.map(() => 0);
}
async function applyPlay(
  sb: SupabaseClient, R: Room, seat: number, cardId: string, H?: Hands,
): Promise<boolean> {
  if (R.phase !== "play" || R.turn !== seat) return false;
  const hand = (await readHand(sb, R.code, R.ri, seat, H)).slice();
  const i = hand.findIndex((c) => c.id === cardId);
  if (i < 0) return false;
  if (!legalCards(hand, R.led).some((c) => c.id === cardId)) return false;
  const card = hand.splice(i, 1)[0];
  await writeHand(sb, R.code, R.ri, seat, hand, H);
  if (R.trick.length === 0) R.led = card.s;
  R.trick.push({ p: seat, card });
  if (R.trick.length === R.cfg.n) R.phase = "trickend";
  else R.turn = (seat + 1) % R.cfg.n;
  return true;
}
function resolveTrick(R: Room) {
  const w = R.trick[trickBest(R)].p;
  R.won[w]++; R.played++;
  R.trick = []; R.led = null; R.leader = w; R.turn = w;
  if (R.played >= R.hs) {
    const cells = [];
    for (let i = 0; i < R.cfg.n; i++) {
      const pts = roundPoints(R.bids[i] as number, R.won[i], R.hs, R.cfg);
      R.score[i] += pts;
      cells.push({ bid: R.bids[i], got: R.won[i], pts, hit: R.bids[i] === R.won[i] });
    }
    R.log.push({ size: R.hs, trump: R.trump, cells });
    R.phase = "roundend";
  } else R.phase = "play";
}

/* ════════════ 存回去（樂觀鎖）════════════ */
async function persist(sb: SupabaseClient, R: Room, bumpStep = true) {
  const patch: Record<string, unknown> = { rev: R.rev + 1, updated_at: new Date().toISOString() };
  for (const k of PERSIST) patch[k] = (R as unknown as Record<string, unknown>)[k];
  if (bumpStep) patch.step_at = Date.now();
  const { data } = await sb.from("rooms").update(patch)
    .eq("code", R.code).eq("rev", R.rev).select().maybeSingle();
  return data as Room | null;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ════════════ 身分 ════════════ */
type Profile = { name: string; avatar: string | null; email: string | null };

/* uid → pid 這件事一旦成立就不會再變，但以前每一個動作都回頭問一次資料庫。
   isolate 還活著就記著（它本來就會被重複用到）。fresh 的那幾個動作要順便更新
   名字與頭像，所以照樣走完整條路。 */
const PID = new Map<string, string>();

/** auth.users.id → players.pid。第一次登入時認領這台裝置原本的匿名玩家。 */
async function resolvePid(
  sb: SupabaseClient, uid: string, legacyToken: string | undefined, prof: Profile, fresh: boolean,
): Promise<string | null> {
  if (!fresh) {
    const hit = PID.get(uid);
    if (hit) return hit;
  }
  const got = await sb.from("players").select("pid").eq("user_id", uid).maybeSingle();
  let pid = got.data?.pid as string | undefined;

  // 這台裝置以前匿名玩過：把那一列接過來，桌上的座位、房主身分都留著。
  // 條件是那一列還沒被任何帳號認領過——同一個 token 不能被第二個人拿去。
  if (!pid && legacyToken && legacyToken.length >= 16) {
    const th = await sha256(legacyToken);
    const { data: claimed } = await sb.from("players")
      .update({ user_id: uid, token_hash: null })
      .eq("token_hash", th).is("user_id", null)
      .select("pid").maybeSingle();
    if (claimed) pid = claimed.pid;
  }

  if (!pid) {
    const { data, error } = await sb.from("players")
      .insert({ user_id: uid, name: prof.name, avatar: prof.avatar, email: prof.email })
      .select("pid").single();
    if (error || !data) return null;
    remember(uid, data.pid);
    return data.pid;
  }

  // 名字／頭像在 Google 那邊改了就跟著改。但 state／tick 每幾秒就一次，
  // 沒必要每次都寫——只有開頁與入座這種「人剛做了什麼」的時候才更新。
  if (fresh) {
    await sb.from("players")
      .update({ name: prof.name, avatar: prof.avatar, email: prof.email })
      .eq("pid", pid);
  }
  remember(uid, pid);
  return pid;
}
function remember(uid: string, pid: string) {
  if (PID.size > 500) PID.clear();   // isolate 活很久的話不要無限長大
  PID.set(uid, pid);
}

/* ════════════ 戰績 ════════════ */
/** 一場打完，每個有帳號的座位留一列。同一場重複呼叫只會留下第一次寫進去的那份。 */
async function saveResults(sb: SupabaseClient, R: Room) {
  const pids = R.seats.filter((s) => s.kind === "human" && s.pid).map((s) => s.pid as string);
  if (!pids.length) return;
  const { data: ps } = await sb.from("players").select("pid,user_id").in("pid", pids);
  const uidOf = new Map((ps ?? []).map((p: { pid: string; user_id: string | null }) => [p.pid, p.user_id]));

  const log = R.log as { cells: { hit: boolean }[] }[];
  const names = R.seats.map((s, i) => (s.kind === "human" ? s.name : `AI ${i + 1}`));
  const rows = [];
  for (let i = 0; i < R.cfg.n; i++) {
    const s = R.seats[i];
    const uid = s.kind === "human" && s.pid ? uidOf.get(s.pid) : null;
    if (!uid) continue;
    let hits = 0;
    for (const row of log) if (row?.cells?.[i]?.hit) hits++;
    rows.push({
      user_id: uid, code: R.code, match: R.match ?? 1, players: R.cfg.n, seat: i,
      score: R.score[i] ?? 0,
      rank: 1 + R.score.filter((v) => v > (R.score[i] ?? 0)).length,   // 同分同名次
      hits, rounds: log.length,
      opponents: names.filter((_, k) => k !== i),
    });
  }
  if (rows.length) {
    await sb.from("results").upsert(rows, { onConflict: "code,user_id,match", ignoreDuplicates: true });
  }
}

/* ════════════ 進入點 ════════════ */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...CORS, "Content-Type": "application/json" },
    });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const body = await req.json().catch(() => ({}));
    const { action, token } = body as { action?: string; token?: string };
    if (!action) return json({ error: "no action" }, 400);

    // Authorization 必須是使用者自己的 access token。anon key 也是一個合法 JWT，
    // 但它的 role 是 anon、沒有 user——兩條路都會把它擋在外面。
    // 先自己驗簽（純運算，見 auth.ts），驗不了才問 Auth 伺服器（那一趟 0.23 秒）。
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const base = Deno.env.get("SUPABASE_URL")!;
    const claims = await verifyLocal(jwt, base, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    let uid = claims?.sub ?? null;
    let email = claims?.email ?? null;
    let meta = (claims?.user_metadata ?? {}) as Record<string, unknown>;
    if (!uid) {
      const { data: au } = await sb.auth.getUser(jwt);
      if (au?.user) {
        uid = au.user.id;
        email = au.user.email ?? null;
        meta = (au.user.user_metadata ?? {}) as Record<string, unknown>;
      }
    }
    if (!uid) return json({ error: "請先登入", signin: true }, 401);

    const prof: Profile = {
      name: String(meta.full_name ?? meta.name ?? (email ?? "").split("@")[0] ?? "玩家").slice(0, 40),
      avatar: (String(meta.avatar_url ?? meta.picture ?? "").slice(0, 500) || null),
      email: email,
    };
    const fresh = action === "hello" || action === "create" || action === "sit";

    /* 身分、房間、手牌，三件事誰也不等誰——以前是一趟等一趟等一趟。
       函式在東京、資料庫在新加坡，每一趟都是 0.07～0.09 秒。 */
    const code = String((body as { code?: string }).code || "").toUpperCase();
    const needRoom = action !== "hello" && action !== "create";
    if (needRoom && !/^[A-Z0-9]{4}$/.test(code)) return json({ error: "房號格式不對" }, 400);
    const [pid, roomRes, handRes] = await Promise.all([
      resolvePid(sb, uid, token, prof, fresh),
      needRoom ? sb.from("rooms").select("*").eq("code", code).maybeSingle() : null,
      needRoom ? sb.from("hands").select("ri,seat,cards").eq("code", code) : null,
    ]);
    if (!pid) return json({ error: "身分建立失敗，請重新整理" }, 500);

    if (action === "hello") return json({ ok: true, pid, profile: prof });

    /* ---- create ---- */
    if (action === "create") {
      // 開房的時候桌上只有房主。人數不是設定出來的，是進來幾個人就幾個人。
      const cfg = cleanCfg((body as { cfg?: unknown }).cfg);
      cfg.n = 1;
      const name = String((body as { name?: string }).name || "房主").slice(0, 10);
      const ladder = ladderFor(maxHand(deckSizeOf(cfg.decks, cfg.minRank, cfg.jokers), 1));
      const seats: Seat[] = [{ name, kind: "human", pid, av: prof.avatar }];
      for (let t = 0; t < 6; t++) {
        const code = randCode();
        const { data, error } = await sb.from("rooms").insert({
          code, cfg, ladder, seats, host_pid: pid,
          score: [0], bids: [null], won: [0],
          seen: { [pid]: Date.now() }, step_at: Date.now(),
        }).select().maybeSingle();
        if (data) return json({ ok: true, pid, room: data, hand: [] });
        if (error && !String(error.message).includes("duplicate")) return json({ error: error.message }, 500);
      }
      return json({ error: "房號產生失敗，請再試一次" }, 500);
    }

    /* ---- 以下都需要房間（上面那一趟已經抓好了）---- */
    const row = roomRes?.data;
    if (!row) return json({ error: `找不到房號 ${code}` }, 404);
    const R = row as Room;
    R.seen = R.seen || {};
    R.seen[pid] = Date.now();

    /* 剛剛順便抓回來的手牌。只收得上這一回合的——抓的當下要是有人在發下一局，
       ri 就對不上，那些座位一律回去查資料庫（readHand 自己會處理）。 */
    const H: Hands = { ri: R.ri, rows: new Map() };
    for (const h of (handRes?.data ?? []) as { ri: number; seat: number; cards: Card[] }[]) {
      if (h.ri === R.ri) H.rows.set(h.seat, h.cards);
    }

    const mine = async () => {
      const s = seatOf(R, pid);
      return s < 0 || R.ri < 0 ? [] : await readHand(sb, code, R.ri, s, H);
    };
    /* persist 寫不進去有兩種，以前混為一談，兩種都回 `room ?? R`——
       把記憶體裡那份「沒有存進去」的狀態當成真的送回客端。客端的 applyRow 只擋
       `cur > inc`（比較舊的那一列），rev 沒變的話 `cur === inc` 就照單全收：
       畫面顯示成功、資料庫沒有這回事，重新整理就打回原形。
       （2026-09-11 就是這樣：migration 還沒跑，「再來一場」整條路假裝成功。）

       現在回頭讀一次，把兩種分開：
       · 別人先寫了（rev 被搶走，兩個客端同時敲 tick 很常見）——良性，
         把資料庫裡那份真的送回去，客端跟上就好。不帶 hand：那一份是照 R.ri 讀的，
         局數要是已經換了會被 applyRow 貼上新的 ri 標籤，變成拿舊手牌當新的；
         不帶的話 applyRow 自己會去補一次 state。
       · rev 沒動——那就是真的寫失敗（欄位不存在、約束擋下來）。老實回錯誤，
         客端該退回的退回、該說話的說話。 */
    const ok = async (room: Room | null) => {
      if (room) return json({ ok: true, pid, room, hand: await mine() });
      const { data } = await sb.from("rooms").select("*").eq("code", R.code).maybeSingle();
      const fresh = data as Room | null;
      if (fresh && (fresh.rev ?? 0) > R.rev) return json({ ok: true, pid, room: fresh });
      return json({ error: "這一步沒有寫進去，再試一次" }, 409);
    };

    switch (action) {
      case "state": {
        await sb.rpc("touch_seen", { p_code: code, p_pid: pid });
        return json({ ok: true, pid, room: R, hand: await mine() });
      }

      // 舊版客端還在用 sit（挑座位）。部署函式與推前端之間一定有一小段空窗，
      // 這條別名讓那段時間線上的舊頁面照樣坐得下來——座位改成動態之後，
      // 「挑第幾號位子」已經沒有意義，一律當成 join。
      case "sit":
      // 幾個人進來就幾個人玩：不必挑位子，來了就多一張椅子
      case "join": {
        if (seatOf(R, pid) >= 0) return json({ ok: true, pid, room: R, hand: await mine() });
        if (R.phase !== "lobby") return json({ error: "牌局已經開始，等這局結束再進來" }, 409);
        if (R.seats.length >= 10) return json({ error: "這桌滿了（最多 10 人）" }, 409);
        const name = String((body as { name?: string }).name || "玩家").slice(0, 10);
        R.seats.push({ name, kind: "human", pid, av: prof.avatar });
        reseat(R);
        return await ok(await persist(sb, R, false));
      }

      case "addai": {
        if (R.phase !== "lobby") return json({ error: "牌局已經開始" }, 409);
        if (!canDirect(R, pid)) return json({ error: "只有房主能加人" }, 403);
        if (R.seats.length >= 10) return json({ error: "這桌滿了（最多 10 人）" }, 409);
        R.seats.push({ name: `AI ${R.seats.length + 1}`, kind: "ai", pid: null, av: null });
        reseat(R);
        return await ok(await persist(sb, R, false));
      }

      case "unseat": {
        if (R.phase !== "lobby") return json({ error: "牌局已經開始" }, 409);
        if (!canDirect(R, pid)) return json({ error: "只有房主能移除座位" }, 403);
        const i = (body as { seat?: number }).seat ?? -1;
        if (i < 0 || i >= R.seats.length) return json({ error: "沒有這個座位" }, 400);
        if (R.seats[i].pid && R.seats[i].pid === R.host_pid)
          return json({ error: "房主不能把自己移掉" }, 409);
        R.seats.splice(i, 1);
        reseat(R);
        return await ok(await persist(sb, R, false));
      }

      // 規則只有房主改得動，而且只在開打之前。改完存進 cfg，跟著這一桌走。
      case "cfg": {
        if (R.phase !== "lobby") return json({ error: "開打之後不能改規則" }, 409);
        if (!canDirect(R, pid)) return json({ error: "只有房主能改規則" }, 403);
        R.cfg = cleanCfg((body as { cfg?: unknown }).cfg, R.seats.length);
        reseat(R);
        return await ok(await persist(sb, R, false));
      }

      case "start": {
        if (R.phase !== "lobby") return json({ error: "已經開始了" }, 409);
        if (!canDirect(R, pid)) return json({ error: "只有房主能開始" }, 403);
        if (R.seats.length < 2) return json({ error: "至少要兩個人，可以加 AI 湊" }, 409);
        R.seats = R.seats.map((s, i) =>
          s.kind === "human" ? s : { name: s.name || `AI ${i + 1}`, kind: "ai" as const, pid: null, av: null });
        reseat(R);
        R.score = Array(R.cfg.n).fill(0);
        await deal(sb, R, H);
        return await ok(await persist(sb, R));
      }

      case "bid": {
        const seat = seatOf(R, pid);
        if (seat < 0) return json({ error: "你不在座位上" }, 403);
        if (!await applyBid(sb, R, seat, (body as { v?: number }).v ?? -1))
          return json({ error: "現在不能叫墩" }, 409);
        return await ok(await persist(sb, R));
      }

      case "play": {
        const seat = seatOf(R, pid);
        if (seat < 0) return json({ error: "你不在座位上" }, 403);
        const cid = String((body as { card?: string }).card || "");
        if (!await applyPlay(sb, R, seat, cid, H)) return json({ error: "這張牌不能出" }, 409);
        return await ok(await persist(sb, R));
      }

      case "next": {
        if (R.phase !== "roundend" && R.phase !== "over")
          return json({ error: "這局還沒結束" }, 409);
        if (seatOf(R, pid) < 0) return json({ error: "你不在座位上" }, 403);
        if (R.ri + 1 >= R.ladder.length) {
          R.phase = "over";
          await saveResults(sb, R);
          return await ok(await persist(sb, R));
        }
        await deal(sb, R, H);
        if (R.phase === "over") await saveResults(sb, R);
        return await ok(await persist(sb, R));
      }

      // AI 的節奏：任何一個 client 都能敲，rev 樂觀鎖讓重複的那些自然落空
      // 打完了要回到等待房間再開一場。座位、規則、房主都留著，牌局的東西全部歸零。
      // 誰都可以按（跟 next 一樣）——最先按到的那個人讓整桌回到等待狀態。
      case "again": {
        if (R.phase !== "over") return json({ error: "這一場還沒打完" }, 409);
        if (seatOf(R, pid) < 0) return json({ error: "你不在座位上" }, 403);
        R.phase = "lobby";
        R.ri = -1;              // 下一次 deal() 會 ++ 成 0，跟剛開房時一樣
        R.hs = 0; R.starter = 0;
        R.trump = null; R.trump_card = null;
        R.leader = 0; R.turn = 0; R.led = null; R.played = 0;
        R.trick = []; R.log = [];
        R.score = R.seats.map(() => 0);   // 先歸零再 reseat：reseat 會沿用 score
        R.match = (R.match ?? 1) + 1;
        reseat(R);
        await sb.from("hands").delete().eq("code", R.code);
        return await ok(await persist(sb, R));
      }

      case "tick": {
        const raw = (body as { speed?: number }).speed ?? 520;
        const sp = Math.max(200, Math.min(1200, raw));
        // 一墩打完要定格多久由客端說（它才知道玩家把 TUNE 調成什麼），但夾在合理範圍內：
        // 太短看不清楚是誰贏的，太長會被一個亂送的 client 把整桌卡住
        const rawGap = (body as { gap?: number }).gap ?? 0;
        const gap = Math.max(2000, sp * 1.9, Math.min(12000, rawGap));
        const since = Date.now() - (R.step_at || 0);
        // 叫完到第一張牌之間多停一下：客端立體桌上叫墩的收場判詞要讀得完，牌才飛進來
        const firstPlay = R.phase === "play" && R.played === 0 && !R.trick.length;
        const playWait = firstPlay ? Math.max(sp * 0.9, 2800) : sp * 0.9;
        let moved = false;
        if (R.phase === "bid" && since > sp * 0.8) {
          // 同時叫墩沒有「輪到誰」：挑一個還沒放好的 AI，一次放一個，節奏跟依序叫一樣
          const seat = R.cfg.bidMode === "sim"
            ? R.seats.findIndex((_, i) => aiSeat(R, i) && (R.bids[i] === null || R.bids[i] === undefined))
            : (aiSeat(R, R.turn) ? R.turn : -1);
          if (seat >= 0) {
            const h = await readHand(sb, code, R.ri, seat, H);
            moved = await applyBid(sb, R, seat, aiBid(h, R.trump, R.hs, R.cfg.n, hookBlocked(R, seat)));
          }
        } else if (R.phase === "play" && aiSeat(R, R.turn) && since > playWait) {
          const h = await readHand(sb, code, R.ri, R.turn, H);
          const need = (R.bids[R.turn] as number) - R.won[R.turn];
          moved = await applyPlay(sb, R, R.turn, aiCard(h, R.trick, R.led, R.trump, need).id, H);
        } else if (R.phase === "trickend" && since > gap) {
          // 贏的那張推出來停在檯面上，定格夠久了才收
          resolveTrick(R); moved = true;
        }
        if (!moved) {
          await sb.rpc("touch_seen", { p_code: code, p_pid: pid });
          return json({ ok: true, pid, room: R, hand: await mine(), idle: true });
        }
        return await ok(await persist(sb, R));
      }

      case "leave": {
        if (R.phase === "lobby") {
          const i = R.seats.findIndex((s) => s.pid === pid);
          if (i >= 0) { R.seats.splice(i, 1); reseat(R); }
          // 房主走了，房主身分交給還在座的第一個真人
          if (R.host_pid === pid)
            R.host_pid = R.seats.find((s) => s.kind === "human" && s.pid)?.pid ?? null;
        } else {
          // 牌局中不能抽掉椅子（位序會整排位移），交給 AI 代打
          for (const s of R.seats) if (s.pid === pid) { s.pid = null; s.kind = "open"; s.name = "座位"; s.av = null; }
        }
        return await ok(await persist(sb, R, false));
      }
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
