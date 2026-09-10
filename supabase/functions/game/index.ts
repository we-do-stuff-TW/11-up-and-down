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

function buildDeck(decks: number, minRank: number): Card[] {
  const d: Card[] = [];
  for (let n = 0; n < decks; n++)
    for (let s = 0; s < 4; s++)
      for (let r = minRank; r <= 14; r++) d.push({ s, r, id: `${n}-${s}-${r}` });
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
const deckSizeOf = (decks: number, minRank: number) => (15 - minRank) * 4 * decks;
const maxHand = (size: number, n: number) =>
  Math.max(1, Math.min(PEAK_CAP, Math.floor((size - 1) / n)));
function ladderFor(peak: number): number[] {
  const l: number[] = [];
  for (let i = 1; i <= peak; i++) l.push(i);
  for (let i = peak - 1; i >= 1; i--) l.push(i);
  return l;
}
function legalCards(hand: Card[], led: number | null): Card[] {
  if (led === null || led === undefined) return hand.slice();
  const f = hand.filter((c) => c.s === led);
  return f.length ? f : hand.slice();
}
function beats(a: Card, b: Card, trump: number | null, led: number | null): boolean {
  const at = a.s === trump, bt = b.s === trump;
  if (at !== bt) return at;
  if (at) return a.r > b.r;
  if (a.s === led && b.s !== led) return true;
  if (a.s !== led) return false;
  return a.r > b.r; // 同點同花：先出的留著，後出的不算贏
}
function sortHand(h: Card[], trump: number | null) {
  h.sort((a, b) => Number(b.s === trump) - Number(a.s === trump) || a.s - b.s || b.r - a.r);
}
function roundPoints(bid: number, got: number): number {
  if (bid === got) return bid === 0 ? 5 : 10 + bid;
  return -Math.abs(got - bid);
}

/* ════════════ AI ════════════ */
function aiBid(hand: Card[], trump: number | null, hs: number, n: number): number {
  let e = 0;
  for (const c of hand) {
    if (c.s === trump) e += c.r >= 13 ? 0.92 : c.r >= 11 ? 0.68 : c.r >= 9 ? 0.45 : 0.3;
    else e += c.r === 14 ? 0.78 : c.r === 13 ? 0.5 : c.r === 12 ? 0.27 : 0.07;
  }
  e = (e * 4) / n + (Math.random() - 0.5) * 0.5;
  return Math.max(0, Math.min(hs, Math.round(e)));
}
function aiCard(
  hand: Card[], trick: { p: number; card: Card }[],
  led: number | null, trump: number | null, need: number,
): Card {
  const legal = legalCards(hand, led);
  const val = (c: Card) => (c.s === trump ? 100 : 0) + c.r;
  const asc = legal.slice().sort((a, b) => val(a) - val(b));
  if (trick.length === 0) {
    if (need > 0) {
      const tr = asc.filter((c) => c.s === trump);
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
  cfg: { n: number; decks: number; minRank: number };
  ladder: number[]; seats: Seat[];
  phase: string; ri: number; hs: number; starter: number;
  trump: number | null; trump_card: Card | null;
  leader: number; turn: number; led: number | null; played: number;
  trick: { p: number; card: Card }[];
  bids: (number | null)[]; won: number[]; score: number[];
  log: unknown[]; host_pid: string | null;
  seen: Record<string, number>; step_at: number;
};

const PERSIST = [
  "cfg", "ladder", "seats", "phase", "ri", "hs", "starter", "trump", "trump_card",
  "leader", "turn", "led", "played", "trick", "bids", "won", "score", "log",
  "host_pid", "seen", "step_at",
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
async function readHand(sb: SupabaseClient, code: string, ri: number, seat: number): Promise<Card[]> {
  const { data } = await sb.from("hands").select("cards")
    .eq("code", code).eq("ri", ri).eq("seat", seat).maybeSingle();
  return (data?.cards as Card[]) ?? [];
}
async function writeHand(sb: SupabaseClient, code: string, ri: number, seat: number, cards: Card[]) {
  await sb.from("hands").upsert({ code, ri, seat, cards }, { onConflict: "code,ri,seat" });
}

async function deal(sb: SupabaseClient, R: Room) {
  R.ri++;
  if (R.ri >= R.ladder.length) { R.phase = "over"; return; }
  const n = R.ladder[R.ri];
  R.hs = n;
  R.starter = R.ri % R.cfg.n;
  const deck = shuffle(buildDeck(R.cfg.decks, R.cfg.minRank));
  const hands: Card[][] = Array.from({ length: R.cfg.n }, () => []);
  for (let k = 0; k < R.cfg.n; k++) hands[(R.starter + k) % R.cfg.n] = deck.splice(0, n);
  R.trump_card = deck.length ? deck.shift()! : null;
  R.trump = R.trump_card ? R.trump_card.s : null;
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
}

function applyBid(R: Room, seat: number, v: number): boolean {
  if (R.phase !== "bid" || R.turn !== seat) return false;
  if (!(Number.isInteger(v) && v >= 0 && v <= R.hs)) return false;
  R.bids[seat] = v;
  let done = true;
  for (let k = 0; k < R.cfg.n; k++) {
    const s = (R.starter + k) % R.cfg.n;
    if (R.bids[s] === null) { R.turn = s; done = false; break; }
  }
  if (done) { R.phase = "play"; R.turn = R.leader; }
  return true;
}
async function applyPlay(sb: SupabaseClient, R: Room, seat: number, cardId: string): Promise<boolean> {
  if (R.phase !== "play" || R.turn !== seat) return false;
  const hand = await readHand(sb, R.code, R.ri, seat);
  const i = hand.findIndex((c) => c.id === cardId);
  if (i < 0) return false;
  if (!legalCards(hand, R.led).some((c) => c.id === cardId)) return false;
  const card = hand.splice(i, 1)[0];
  await writeHand(sb, R.code, R.ri, seat, hand);
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
      const pts = roundPoints(R.bids[i] as number, R.won[i]);
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

/** auth.users.id → players.pid。第一次登入時認領這台裝置原本的匿名玩家。 */
async function resolvePid(
  sb: SupabaseClient, uid: string, legacyToken: string | undefined, prof: Profile, fresh: boolean,
): Promise<string | null> {
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
    return data.pid;
  }

  // 名字／頭像在 Google 那邊改了就跟著改。但 state／tick 每幾秒就一次，
  // 沒必要每次都寫——只有開頁與入座這種「人剛做了什麼」的時候才更新。
  if (fresh) {
    await sb.from("players")
      .update({ name: prof.name, avatar: prof.avatar, email: prof.email })
      .eq("pid", pid);
  }
  return pid;
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
      user_id: uid, code: R.code, players: R.cfg.n, seat: i,
      score: R.score[i] ?? 0,
      rank: 1 + R.score.filter((v) => v > (R.score[i] ?? 0)).length,   // 同分同名次
      hits, rounds: log.length,
      opponents: names.filter((_, k) => k !== i),
    });
  }
  if (rows.length) {
    await sb.from("results").upsert(rows, { onConflict: "code,user_id", ignoreDuplicates: true });
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
    // 但它沒有 user，getUser 會直接空手回來——所以這一關同時擋掉「只帶 anon key」。
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: au } = await sb.auth.getUser(jwt);
    const user = au?.user;
    if (!user) return json({ error: "請先登入", signin: true }, 401);

    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const prof: Profile = {
      name: String(meta.full_name ?? meta.name ?? (user.email ?? "").split("@")[0] ?? "玩家").slice(0, 40),
      avatar: (String(meta.avatar_url ?? meta.picture ?? "").slice(0, 500) || null),
      email: user.email ?? null,
    };
    const fresh = action === "hello" || action === "create" || action === "sit";
    const pid = await resolvePid(sb, user.id, token, prof, fresh);
    if (!pid) return json({ error: "身分建立失敗，請重新整理" }, 500);

    if (action === "hello") return json({ ok: true, pid, profile: prof });

    /* ---- create ---- */
    if (action === "create") {
      const cfg = (body as { cfg?: Room["cfg"] }).cfg ?? { n: 4, decks: 2, minRank: 7 };
      cfg.n = Math.max(2, Math.min(10, cfg.n | 0));
      cfg.decks = cfg.decks === 1 ? 1 : 2;
      cfg.minRank = Math.max(2, Math.min(9, cfg.minRank | 0));
      const name = String((body as { name?: string }).name || "房主").slice(0, 10);
      const ladder = ladderFor(maxHand(deckSizeOf(cfg.decks, cfg.minRank), cfg.n));
      const seats: Seat[] = Array.from({ length: cfg.n }, (_, i) =>
        i === 0
          ? { name, kind: "human" as const, pid, av: prof.avatar }
          : { name: `座位 ${i + 1}`, kind: "open" as const, pid: null });
      for (let t = 0; t < 6; t++) {
        const code = randCode();
        const { data, error } = await sb.from("rooms").insert({
          code, cfg, ladder, seats, host_pid: pid,
          score: Array(cfg.n).fill(0), bids: [], won: [],
          seen: { [pid]: Date.now() }, step_at: Date.now(),
        }).select().maybeSingle();
        if (data) return json({ ok: true, pid, room: data, hand: [] });
        if (error && !String(error.message).includes("duplicate")) return json({ error: error.message }, 500);
      }
      return json({ error: "房號產生失敗，請再試一次" }, 500);
    }

    /* ---- 以下都需要房間 ---- */
    const code = String((body as { code?: string }).code || "").toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) return json({ error: "房號格式不對" }, 400);
    const { data: row } = await sb.from("rooms").select("*").eq("code", code).maybeSingle();
    if (!row) return json({ error: `找不到房號 ${code}` }, 404);
    const R = row as Room;
    R.seen = R.seen || {};
    R.seen[pid] = Date.now();

    const mine = async () => {
      const s = seatOf(R, pid);
      return s < 0 || R.ri < 0 ? [] : await readHand(sb, code, R.ri, s);
    };
    const ok = async (room: Room | null) =>
      json({ ok: true, pid, room: room ?? R, hand: await mine() });

    switch (action) {
      case "state": {
        await sb.rpc("touch_seen", { p_code: code, p_pid: pid });
        return json({ ok: true, pid, room: R, hand: await mine() });
      }

      case "sit": {
        if (R.phase !== "lobby") return json({ error: "牌局已經開始，等這局結束再入座" }, 409);
        const i = (body as { seat?: number }).seat ?? -1;
        if (i < 0 || i >= R.cfg.n) return json({ error: "沒有這個座位" }, 400);
        const name = String((body as { name?: string }).name || "玩家").slice(0, 10);
        if (R.seats[i].kind === "human" && R.seats[i].pid !== pid)
          return json({ error: "這個位子有人了" }, 409);
        for (const s of R.seats) if (s.pid === pid) { s.pid = null; s.kind = "open"; s.name = "座位"; s.av = null; }
        R.seats[i] = { name, kind: "human", pid, av: prof.avatar };
        return await ok(await persist(sb, R, false));
      }

      case "start": {
        if (R.phase !== "lobby") return json({ error: "已經開始了" }, 409);
        if (!canDirect(R, pid)) return json({ error: "只有房主能開始" }, 403);
        R.seats = R.seats.map((s, i) =>
          s.kind === "human" ? s : { name: `AI ${i + 1}`, kind: "ai" as const, pid: null, av: null });
        await deal(sb, R);
        return await ok(await persist(sb, R));
      }

      case "bid": {
        const seat = seatOf(R, pid);
        if (seat < 0) return json({ error: "你不在座位上" }, 403);
        if (!applyBid(R, seat, (body as { v?: number }).v ?? -1))
          return json({ error: "現在不能叫墩" }, 409);
        return await ok(await persist(sb, R));
      }

      case "play": {
        const seat = seatOf(R, pid);
        if (seat < 0) return json({ error: "你不在座位上" }, 403);
        const cid = String((body as { card?: string }).card || "");
        if (!await applyPlay(sb, R, seat, cid)) return json({ error: "這張牌不能出" }, 409);
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
        await deal(sb, R);
        if (R.phase === "over") await saveResults(sb, R);
        return await ok(await persist(sb, R));
      }

      // AI 的節奏：任何一個 client 都能敲，rev 樂觀鎖讓重複的那些自然落空
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
        if (R.phase === "bid" && aiSeat(R, R.turn) && since > sp * 0.8) {
          const h = await readHand(sb, code, R.ri, R.turn);
          moved = applyBid(R, R.turn, aiBid(h, R.trump, R.hs, R.cfg.n));
        } else if (R.phase === "play" && aiSeat(R, R.turn) && since > playWait) {
          const h = await readHand(sb, code, R.ri, R.turn);
          const need = (R.bids[R.turn] as number) - R.won[R.turn];
          moved = await applyPlay(sb, R, R.turn, aiCard(h, R.trick, R.led, R.trump, need).id);
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
        for (const s of R.seats) if (s.pid === pid) { s.pid = null; s.kind = "open"; s.name = "座位"; s.av = null; }
        return await ok(await persist(sb, R, false));
      }
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
