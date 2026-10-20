// 11 Up & Down — 伺服器那一步的測試（supabase/functions/game/index.ts 的 switch，以前一條測試都沒有）
//
// 跑法：deno run -A scripts/server_test.ts
//       BEFORE=1 deno run -A scripts/server_test.ts     ← 同一套劇本打「0007 之前」的伺服器，看它紅在哪
//
// 不抄伺服器：import 本體 index.ts，只換兩個接縫——supabase-js 換成 _fakesb.ts（底下是真的 Postgres，
// PGlite 跑在記憶體裡）、auth.ts 換成「jwt 就是 uid」。接縫找不到就直接報錯。
// 資料庫：0001 不在 repo（線上建的，**沒查到**原文），這裡照 index.ts 讀寫的欄位重建一份；
// 0004–0007 直接跑 repo 裡的檔案——0007 那三支交易函式是這支要驗的東西，不能抄。
// 另外用一份「陣列欄位是 int[]」的變體再跑一次最短的一局：線上欄位型別沒查到，兩種都要過。
//
// 劇本來自 2026-10-17 架構健檢的探針（當時用手寫的假資料庫量到的）：
//   一、鎖屏補敲：輪到的人鎖屏 30 秒，其他人同一刻補敲 tick → 他不可以少一張牌
//   二、兩發 next：好幾個人同時開下一局 → 手牌與王牌必須是同一副，回應裡的手牌必須是資料庫那一副
//   三、同時叫墩：六個人同一刻放骰子 → 每一個拿到 200 的人，數字都要在桌上
// 以及：打完一整場（含報到、戰績、再開一場）、409 帶回真相、報到不吃別人的、房主牌局中離開、權限。
//
// 抓不到的：PostgREST 本身、真的並行鎖等待（PGlite 一次跑一句；請求之間的交錯照樣有，每一句前後亂數延遲）、
// 客端怎麼處理這些回應（那是 net_test 的事）。

import { PG } from "./_fakesb.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const ROOT = new URL("../", import.meta.url);
const SERVER = "supabase/functions/game/index.ts";
/* 0007 之前的最後一版伺服器。BEFORE=1 時拿它跑同一套劇本——那是「改之前會紅」的證據，不是回歸測試 */
const BEFORE_REF = "67a5c79";
const BEFORE = !!Deno.env.get("BEFORE");
/* ONLY=5,6 只跑那幾段（tamper 時省時間） */
const ONLY = Deno.env.get("ONLY")?.split(",");
const part = (n: number) => !ONLY || ONLY.includes(String(n));

const fails: string[] = [];
let checks = 0;
function ok(cond: unknown, msg: string) { checks++; if (!cond) fails.push(msg); }
const t0 = performance.now();

/* ───────── 亂數（有種子：失敗訊息帶著它，SEED=N 照著跑一次就是同一串延遲）───────── */
const SEED = Number(Deno.env.get("SEED") ?? (Date.now() % 100000));
function mulberry(a: number) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const rnd = mulberry(SEED);
PG.jitter = () => rnd() * 3;

/* ───────── 載入伺服器本體 ───────── */
type Handler = (req: Request) => Promise<Response>;
async function loadServer(src: string): Promise<Handler> {
  const fake = new URL("./_fakesb.ts", import.meta.url).href;
  const seams: [string, string][] = [
    [`import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";`,
      `import { createClient, type SupabaseClient } from "${fake}";`],
    [`import { verifyLocal } from "./auth.ts";`, `import { verifyLocal } from "${fake}";`],
  ];
  for (const [a, b] of seams) {
    if (!src.includes(a)) throw new Error("接縫插不進去：index.ts 找不到 " + a);
    src = src.replace(a, b);
  }
  const dir = await Deno.makeTempDir({ prefix: "ud-server-" });
  const file = dir + "/index.ts";
  await Deno.writeTextFile(file, src);
  let h: Handler | null = null;
  const real = Deno.serve;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (f: Handler) => { h = f; return { finished: Promise.resolve(), shutdown: () => Promise.resolve() }; };
  try { await import("file://" + file); } finally { (Deno as unknown as { serve: unknown }).serve = real; }
  if (!h) throw new Error("沒拿到 handler：index.ts 的 Deno.serve 長相變了？");
  return h;
}
Deno.env.set("SUPABASE_URL", "http://test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc");
Deno.env.set("SUPABASE_ANON_KEY", "anon");

let srcNow = await Deno.readTextFile(new URL(SERVER, ROOT));
if (BEFORE) {
  const out = await new Deno.Command("git", { args: ["show", `${BEFORE_REF}:${SERVER}`], cwd: ROOT, stdout: "piped" }).output();
  if (!out.success) throw new Error("git show 拿不到 " + BEFORE_REF);
  srcNow = new TextDecoder().decode(out.stdout);
}
const SRV = await loadServer(srcNow);

/* ───────── 資料庫 ───────── */
/* 0001–0003 的重建（線上原文沒查到）：只照 index.ts 讀寫過的欄位與預設值。
   `ints` 為真時，數字陣列欄位用 int[]——線上是 jsonb 還是 int[] 沒查到，兩種都跑。 */
function baseSchema(ints: boolean) {
  const arr = (d: string) => ints ? `int[] not null default '{}'` : `jsonb not null default '${d}'`;
  return `
create schema if not exists auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create table public.players (
  pid uuid primary key default gen_random_uuid(),
  token_hash text not null,
  created_at timestamptz not null default now()
);
create table public.rooms (
  code text primary key, rev int not null default 0,
  cfg jsonb not null, ladder ${arr("[]")}, seats jsonb not null default '[]',
  phase text not null default 'lobby', ri int not null default -1, hs int not null default 0,
  starter int not null default 0, trump int, trump_card jsonb,
  leader int not null default 0, turn int not null default 0, led int, played int not null default 0,
  trick jsonb not null default '[]', bids ${ints ? "int[] not null default '{}'" : "jsonb not null default '[]'"},
  won ${arr("[]")}, score ${arr("[]")}, log jsonb not null default '[]',
  host_pid uuid, seen jsonb not null default '{}', step_at bigint not null default 0,
  updated_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.hands (
  code text not null references public.rooms(code) on delete cascade,
  ri int not null, seat int not null, cards jsonb not null,
  primary key (code, ri, seat)
);
alter table public.rooms enable row level security;
alter table public.hands enable row level security;
alter table public.players enable row level security;
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant select on public.rooms to anon, authenticated;
-- 0002 touch_seen：線上定義沒查到。這裡放「只改 seen、不動 rev」那一種（健檢推測線上是這一種）。
-- 只有舊版伺服器（BEFORE=1）會叫它。
create function public.touch_seen(p_code text, p_pid text) returns void language sql as $f$
  update public.rooms set seen = seen || jsonb_build_object(p_pid, (extract(epoch from clock_timestamp()) * 1000)::bigint)
  where code = p_code
$f$;
`;
}
async function freshDb(ints = false): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(baseSchema(ints));
  for (const m of ["0004_auth.sql", "0005_rules.sql", "0006_again.sql", "0007_one_step.sql"]) {
    await db.exec(await Deno.readTextFile(new URL("supabase/migrations/" + m, ROOT)));
  }
  await db.exec(`grant all on all tables in schema public to service_role;`);
  PG.db = db;
  return db;
}

/* ───────── 呼叫與觀察 ───────── */
// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any };
async function hit(uid: string, body: Record<string, unknown>): Promise<Res> {
  const res = await SRV(new Request("http://test/game", {
    method: "POST",
    headers: { Authorization: "Bearer " + uid, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}
/** ms 毫秒之後再做 */
const later = <T>(ms: number, f: () => Promise<T>) => new Promise<T>((r) => setTimeout(() => r(f()), ms));
const USERS: string[] = [];
async function users(n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = crypto.randomUUID();
    await PG.db!.query(`insert into auth.users (id) values ($1)`, [id]);
    USERS.push(id); out.push(id);
  }
  return out;
}
// deno-lint-ignore no-explicit-any
async function room(code: string): Promise<any> {
  const r = await PG.db!.query<{ j: unknown }>(`select to_jsonb(r) j from public.rooms r where code = $1`, [code]);
  return r.rows[0]?.j;
}
async function hands(code: string): Promise<Map<number, { ri: number; cards: { id: string; s: number; r: number }[] }>> {
  const r = await PG.db!.query<{ seat: number; ri: number; cards: { id: string; s: number; r: number }[] }>(
    `select seat, ri, cards from public.hands where code = $1`, [code]);
  return new Map(r.rows.map((x) => [x.seat, { ri: x.ri, cards: x.cards }]));
}
async function pidOf(uid: string): Promise<string> {
  const r = await PG.db!.query<{ pid: string }>(`select pid::text pid from public.players where user_id = $1`, [uid]);
  return r.rows[0].pid;
}
/** 讓這一格「停得夠久了」：tick 看的是 step_at */
const age = (code: string, ms = 20000) =>
  PG.db!.query(`update public.rooms set step_at = step_at - $2 where code = $1`, [code, ms]);
/** 讓某人看起來離線 31 秒（不經過伺服器，直接改那一格） */
const afk = (code: string, pid: string) =>
  PG.db!.query(`update public.rooms set seen = jsonb_set(seen, array[$2], to_jsonb($3::bigint)) where code = $1`,
    [code, pid, Date.now() - 31000]);

/** 帳：每個座位手上幾張、所有牌 id 不重複（手牌＋檯面＋王牌）。回傳不對的地方 */
async function ledger(code: string): Promise<string[]> {
  const R = await room(code), H = await hands(code);
  const bad: string[] = [];
  if (!["bid", "play", "trickend", "roundend"].includes(R.phase)) return bad;
  const ids = new Map<string, string>();
  const see = (id: string, where: string) => {
    if (ids.has(id)) bad.push(`牌 ${id} 同時在 ${ids.get(id)} 與 ${where}`);
    ids.set(id, where);
  };
  if (R.trump_card) see(R.trump_card.id, "王牌");
  for (const t of R.trick) see(t.card.id, "檯面");
  for (let i = 0; i < R.cfg.n; i++) {
    const h = H.get(i);
    const want = R.hs - R.played - (R.trick.some((t: { p: number }) => t.p === i) ? 1 : 0);
    if (R.seats[i].kind === "human" || R.seats[i].kind === "ai" || R.seats[i].kind === "open") {
      const got = h && h.ri === R.ri ? h.cards.length : 0;
      if (got !== want) bad.push(`座位 ${i} 手上 ${got} 張、應該 ${want} 張（第 ${R.ri + 1} 局、已打 ${R.played} 墩）`);
    }
    for (const c of h?.cards ?? []) see(c.id, `座位 ${i}`);
  }
  return bad;
}

/* ───────── 開一桌 ───────── */
async function table(nHuman: number, nAi = 0, cfg: Record<string, unknown> = {}) {
  const us = await users(nHuman);
  const c = await hit(us[0], { action: "create", name: "房主", cfg });
  if (c.status !== 200) throw new Error("開房失敗 " + JSON.stringify(c.body));
  const code = c.body.room.code as string;
  for (let i = 1; i < nHuman; i++) {
    const j = await hit(us[i], { action: "join", code, name: "P" + i });
    if (j.status !== 200) throw new Error("入座失敗 " + JSON.stringify(j.body));
  }
  for (let i = 0; i < nAi; i++) await hit(us[0], { action: "addai", code });
  const s = await hit(us[0], { action: "start", code });
  if (s.status !== 200) throw new Error("開打失敗 " + JSON.stringify(s.body));
  const pids = await Promise.all(us.map(pidOf));
  return { code, us, pids };
}
/** 座位 → 那個座位的使用者（AI 回 null） */
async function seatUser(code: string, us: string[], pids: string[], seat: number) {
  const R = await room(code);
  const pid = R.seats[seat]?.pid;
  const k = pids.indexOf(pid);
  return k >= 0 ? us[k] : null;
}
/** 依序叫墩：照 turn 一位一位叫，被 hook 擋到就換一個數 */
async function bidAll(code: string, us: string[], pids: string[]) {
  for (let guard = 0; guard < 40; guard++) {
    const R = await room(code);
    if (R.phase !== "bid") return;
    const u = await seatUser(code, us, pids, R.turn);
    if (!u) { await age(code); await hit(us[0], { action: "tick", code }); continue; }
    for (const v of [0, 1, 2]) {
      const r = await hit(u, { action: "bid", code, v });
      if (r.status === 200) break;
    }
  }
}
/** 打完這一局：真人出第一張能出的、AI 用 tick；一墩打完 tick 收墩 */
async function playRound(code: string, us: string[], pids: string[]) {
  for (let guard = 0; guard < 400; guard++) {
    const R = await room(code);
    if (R.phase === "roundend" || R.phase === "over") return;
    if (R.phase === "bid") { await bidAll(code, us, pids); continue; }
    if (R.phase === "trickend") { await age(code); await hit(us[0], { action: "tick", code }); continue; }
    const u = await seatUser(code, us, pids, R.turn);
    if (!u) { await age(code); await hit(us[0], { action: "tick", code }); continue; }
    const st = await hit(u, { action: "state", code });
    const hand = st.body.hand as { id: string; s: number }[];
    const led = R.led;
    const legal = led === null || led === 4 || !hand.some((c) => c.s === led) ? hand : hand.filter((c) => c.s === led || c.s === 4);
    await hit(u, { action: "play", code, card: legal[0].id });
  }
  throw new Error("這一局打不完");
}

try {
  /* ════════ 一、鎖屏補敲：不可以少一張牌 ════════ */
  await freshDb();
  if (part(1)) {
    let broke = 0, trials = 0, extra = 0;
    const why: string[] = [];
    for (let t = 0; t < 16; t++) {
      const n = t % 2 ? 6 : 4;
      const { code, us, pids } = await table(n);
      // 走到第 3 局（每人 3 張）：第 1 局手上只有一張，扣掉就沒了，「少一張」根本撞不出來
      for (let r = 0; r < 2; r++) {
        await playRound(code, us, pids);
        await hit(us[0], { action: "next", code, ri: (await room(code)).ri });
      }
      await bidAll(code, us, pids);
      const R0 = await room(code);
      const turnPid = R0.seats[R0.turn].pid as string;
      await afk(code, turnPid);
      await age(code);
      const others = us.filter((_, i) => pids[i] !== turnPid);
      // 不是同一個瞬間：補敲是各台自己的 420ms 迴圈，散在一小段時間裡。
      // 全部同一刻送的話大家讀到同一份、扣同一張，反而撞不出來——要有人「讀在別人寫了一半的時候」
      await Promise.all(others.map((u) => later(rnd() * 18, () => hit(u, { action: "tick", code, speed: 520 }))));
      const R1 = await room(code);
      const bad = await ledger(code);
      trials++;
      if (bad.length) { broke++; if (why.length < 3) why.push(`${n} 人：${bad[0]}`); }
      if (R1.trick.length !== R0.trick.length + 1) extra++;
    }
    ok(broke === 0, `鎖屏補敲：${trials} 桌裡有 ${broke} 桌帳對不上（${why.join("；")}）`);
    ok(extra === 0, `鎖屏補敲：${extra} 桌的檯面不是剛好多一張（同一刻好幾發替他出牌，應該只有一發算數）`);
  }

  /* ════════ 二、兩發 next：同一副牌 ════════ */
  if (part(2)) {
    let broke = 0, mism = 0, trials = 0, deals = 0;
    const why: string[] = [];
    for (let t = 0; t < 16; t++) {
      const { code, us, pids } = await table(4);
      await playRound(code, us, pids);
      const R0 = await room(code);
      if (R0.phase !== "roundend") throw new Error("劇本二：沒走到局末");
      // 一半的桌模擬舊網頁（不帶 ri），一半模擬新網頁（帶 ri）
      const withRi = t % 2 === 0;
      const rs = await Promise.all(us.map((u) => later(rnd() * 18, () => hit(u, { action: "next", code, ...(withRi ? { ri: R0.ri } : {}) }))));
      const R1 = await room(code), H = await hands(code);
      trials++;
      const bad = await ledger(code);
      if (bad.length || R1.ri !== R0.ri + 1) {
        broke++;
        if (why.length < 3) why.push(bad[0] ?? `局數從 ${R0.ri} 跳到 ${R1.ri}`);
      }
      for (let k = 0; k < us.length; k++) {
        const r = rs[k];
        if (r.status !== 200 || !Array.isArray(r.body.hand) || r.body.room?.ri !== R1.ri) continue;
        const seat = R1.seats.findIndex((s: { pid: string }) => s.pid === pids[k]);
        const db = (H.get(seat)?.cards ?? []).map((c) => c.id).join(",");
        if (r.body.hand.map((c: { id: string }) => c.id).join(",") !== db) mism++;
      }
      deals += R1.rev - R0.rev;
    }
    ok(broke === 0, `兩發 next：${trials} 桌裡有 ${broke} 桌手牌與桌面不是同一副（${why.join("；")}）`);
    ok(mism === 0, `兩發 next：有 ${mism} 個回應帶回的手牌跟資料庫那一副不一樣（使用者看的是假牌）`);
    ok(deals === trials, `兩發 next：${trials} 桌一共發了 ${deals} 次牌，應該一桌一次`);
  }

  /* ════════ 三、同時叫墩：200 就是寫進去了 ════════ */
  if (part(3)) {
    let swallowed = 0, sent = 0, refused = 0, stuck = 0;
    for (let t = 0; t < 12; t++) {
      const { code, us, pids } = await table(6, 0, { bidMode: "sim" });
      const R0 = await room(code);
      const want = us.map(() => Math.floor(rnd() * (R0.hs + 1)));
      const rs = await Promise.all(us.map((u, k) => later(rnd() * 18, () => hit(u, { action: "bid", code, v: want[k] }))));
      const R1 = await room(code);
      if (R1.phase !== "play") stuck++;
      for (let k = 0; k < us.length; k++) {
        sent++;
        if (rs[k].status !== 200 || rs[k].body.error) { refused++; continue; }
        const seat = R1.seats.findIndex((s: { pid: string }) => s.pid === pids[k]);
        const onTable = R1.phase === "play" ? R1.bids[seat] === want[k] : R1.bids[seat] === -1;
        if (!onTable) swallowed++;
      }
    }
    ok(swallowed === 0, `同時叫墩：${sent} 次叫墩裡有 ${swallowed} 次回 200 卻沒寫進去（被吞）`);
    ok(refused === 0, `同時叫墩：${refused} 次被打回（六個人各叫一次，每一次都該寫得進去）`);
    ok(stuck === 0, `同時叫墩：${stuck} 桌全部叫完了還停在叫墩`);
  }

  /* ════════ 四、打完一整場：兩個真人＋兩個 AI，夾著心跳 ════════ */
  if (part(4)) {
    const { code, us, pids } = await table(2, 2);
    let rounds = 0, badAt = "";
    for (let guard = 0; guard < 100; guard++) {   // 21 局 × （打一局＋開下一局）
      const R = await room(code);
      if (R.phase === "over") break;
      // 心跳跟動作一起到：報到不可以把別人的那一步吃掉，也不可以被吃掉
      const beat = hit(us[1], { action: "state", code });
      if (R.phase === "roundend") {
        await Promise.all([beat, hit(us[0], { action: "next", code, ri: R.ri }), hit(us[1], { action: "next", code, ri: R.ri })]);
        rounds++;
        continue;
      }
      await Promise.all([beat, playRound(code, us, pids)]);
      const bad = await ledger(code);
      if (bad.length && !badAt) badAt = `第 ${R.ri + 1} 局：${bad[0]}`;
    }
    const R = await room(code);
    ok(R.phase === "over", `整場：打了 ${rounds} 局還沒收桌（phase=${R.phase}）`);
    ok(!badAt, `整場：帳對不上——${badAt}`);
    ok(R.log.length === R.ladder.length, `整場：計分表 ${R.log.length} 局、階梯 ${R.ladder.length} 局`);
    const res = await PG.db!.query<{ n: number }>(`select count(*)::int n from public.results where code = $1`, [code]);
    ok(res.rows[0].n === 2, `整場：戰績應該是兩個真人各一列，拿到 ${res.rows[0].n} 列`);
    const again = await hit(us[1], { action: "again", code });
    const R2 = await room(code), H2 = await hands(code);
    ok(again.status === 200 && R2.phase === "lobby" && R2.match === 2 && H2.size === 0,
      `再開一場：phase=${R2.phase} match=${R2.match} 手牌還剩 ${H2.size} 列`);
    const s2 = await hit(us[0], { action: "start", code });
    ok(s2.status === 200 && (await ledger(code)).length === 0, "再開一場之後發不了牌，或帳對不上");
  }

  if (!BEFORE) {
    /* ════════ 五、409 帶回真相 ════════ */
    if (part(5)) {
      const { code, us, pids } = await table(3);
      await bidAll(code, us, pids);
      const R = await room(code);
      const u = (await seatUser(code, us, pids, R.turn))!;
      const r = await hit(u, { action: "play", code, card: "沒有這張" });
      const H = await hands(code);
      ok(r.status === 409 && r.body.error, `出一張不存在的牌應該 409，拿到 ${r.status}`);
      ok(r.body.room?.rev === R.rev, `409 帶回來的房間不是資料庫那一列（rev ${r.body.room?.rev} vs ${R.rev}）`);
      ok((r.body.hand ?? []).map((c: { id: string }) => c.id).join(",") === (H.get(R.turn)?.cards ?? []).map((c) => c.id).join(","),
        "409 帶回來的手牌不是資料庫那一副");
      ok(typeof r.body.now === "number", "回應裡沒有伺服器時間 now（客端判斷誰在線要用它）");
      const other = us.find((x) => x !== u)!;
      const nr = await hit(other, { action: "next", code, ri: R.ri - 1 });
      ok(nr.status === 200 && nr.body.idle, `next 帶的 ri 已經過去了應該是 idle，拿到 ${nr.status} ${JSON.stringify(nr.body.error ?? "")}`);
    }

    /* ════════ 六、報到只動自己那一格、不動 rev、4 秒內不重寫 ════════ */
    if (part(6)) {
      const { code, us, pids } = await table(2);
      await PG.db!.query(`update public.rooms set seen = jsonb_set(seen, array[$2], to_jsonb($3::bigint)) where code = $1`,
        [code, pids[1], Date.now() - 10000]);
      const R0 = await room(code);
      const u0 = (await seatUser(code, us, pids, R0.turn))!;
      const u1 = us.find((x) => x !== u0)!, p1 = pids[us.indexOf(u1)], p0 = pids[us.indexOf(u0)];
      const t = Date.now();
      await Promise.all([hit(u0, { action: "bid", code, v: 0 }), hit(u1, { action: "state", code })]);
      const R1 = await room(code);
      ok(R1.seen[p1] >= t, `一邊叫墩、一邊報到：報到被叫墩那一筆蓋掉了（seen 停在 ${t - R1.seen[p1]}ms 之前）`);
      ok(R1.seen[p0] >= t, "叫墩的人自己的報到沒有寫進去");
      ok(R1.rev === R0.rev + 1, `報到不該動 rev（叫墩一次，rev 從 ${R0.rev} 到 ${R1.rev}）`);
      const s1 = R1.seen[p1];
      await hit(u1, { action: "state", code });
      ok((await room(code)).seen[p1] === s1, "4 秒內又報到一次，還是寫了一次 rooms（每一次寫都是一列推給全桌）");
    }

    /* ════════ 七、房主牌局中離開：房主交給還在的人 ════════ */
    if (part(7)) {
      const { code, us, pids } = await table(3);
      const r = await hit(us[0], { action: "leave", code });
      const R = await room(code);
      ok(r.status === 200 && R.host_pid && R.host_pid !== pids[0] && pids.includes(R.host_pid),
        `房主牌局中離開，host_pid 還是 ${R.host_pid === pids[0] ? "他" : R.host_pid}`);
    }

    /* ════════ 八、三支函式只給伺服器 ════════ */
    if (part(8)) {
      const denied: string[] = [];
      for (const sql of [`select public.game_load('XXXX')`, `select public.game_seen('XXXX', 'x', 0)`,
        `select public.game_commit('XXXX', 0, '{}'::jsonb, null, 0, null)`]) {
        // 只認「函式本身不准執行」。被擋在表的權限上（anon 讀不到 hands）不算——
        // 第一版就是這樣假綠的：把 revoke 拿掉照樣全過，因為 anon 卡在後面那張表
        try {
          await PG.db!.exec(`set role anon; ${sql}; reset role;`);
        } catch (e) {
          await PG.db!.exec(`reset role;`);
          if (/permission denied for function/.test(String((e as Error).message))) denied.push(sql);
        }
      }
      ok(denied.length === 3, `anon 叫得動 ${3 - denied.length} 支只給伺服器的函式`);
    }

    /* ════════ 九、陣列欄位是 int[] 的資料庫：最短的一局照樣打得完 ════════ */
    if (part(9)) await freshDb(true);
    if (part(9)) {
      const { code, us, pids } = await table(3, 1);
      await playRound(code, us, pids);
      const R = await room(code);
      const n = await hit(us[0], { action: "next", code, ri: R.ri });
      ok(R.phase === "roundend" && n.status === 200 && (await ledger(code)).length === 0,
        `int[] 欄位：第一局打不完或發不了下一局（phase=${R.phase}、next ${n.status} ${n.body.error ?? ""}）`);
    }
  }

  /* ════════ 十一、早到的那一手：前一家還在路上，我先到（plan 0007） ════════
     手機是聽到對手的廣播（約 0.05 秒）就讓你出的；對手那一手寫進資料庫要 0.7–1.9 秒（2026-10-21 兩人桌 15 次）。
     我的請求先到，伺服器眼裡就還輪對手。以前馬上 409「這張牌不能出」——牌是合法的，理由是錯的，人只好再點一次。
     要的：等前一家寫進去再做；真的等不到才說「還沒輪到你」；重送、牌不在手上的不必等。 */
  if (!BEFORE && part(11)) {
    const legal = (hand: { id: string; s: number }[], led: number | null) =>
      led === null || led === 4 || !hand.some((c) => c.s === led) ? hand : hand.filter((c) => c.s === led || c.s === 4);
    const handOf = async (code: string, seat: number) => (await hands(code)).get(seat)!.cards;

    // a. 前一家晚 0.3 秒才到：兩張都要在桌上
    {
      const { code, us, pids } = await table(2);
      await bidAll(code, us, pids);
      const R = await room(code);
      const uL = (await seatUser(code, us, pids, R.turn))!, uO = us.find((x) => x !== uL)!;
      const sO = (R.turn + 1) % 2;
      const cL = (await handOf(code, R.turn))[0];
      const cO = legal(await handOf(code, sO), cL.s)[0];
      const [rO, rL] = await Promise.all([
        hit(uO, { action: "play", code, card: cO.id }),
        later(300, () => hit(uL, { action: "play", code, card: cL.id })),
      ]);
      const R2 = await room(code);
      ok(rO.status === 200 && rL.status === 200,
        `早到：我先到、前一家晚 0.3 秒——我拿到 ${rO.status} ${rO.body.error ?? ""}、前一家 ${rL.status} ${rL.body.error ?? ""}`);
      ok(R2.trick.map((t: { card: { id: string } }) => t.card.id).join(",") === [cL.id, cO.id].join(","),
        `早到：桌上的牌不是「前一家、我」（${R2.trick.map((t: { p: number }) => t.p).join(",") || "空"}）`);
      ok((await ledger(code)).length === 0, "早到：帳對不上");
    }

    // b. 前一家一直不出：等到上限才 409，字是「還沒輪到你」，桌面沒被動到
    //    手牌直接擺好（第一局每人只有一張，下面 c 的「這一墩出過還重送」「不跟花色」走不到）：
    //    輪到的人拿 0、1 兩門各一張；下一家拿 0、2 兩門各一張——0 門被領出時，2 門那張就不合規則
    {
      const { code, us, pids } = await table(2);
      await bidAll(code, us, pids);
      const R = await room(code);
      const uL = (await seatUser(code, us, pids, R.turn))!, uO = us.find((x) => x !== uL)!;
      const sL = R.turn, sO = (R.turn + 1) % 2;
      const used = new Set<string>([R.trump_card?.id, ...[...(await hands(code)).values()].flatMap((h) => h.cards.map((c) => c.id))]);
      const pick = (suit: number) => {
        for (const d of [0, 1]) for (let r = 7; r <= 14; r++) {
          const id = `${d}-${suit}-${r}`;
          if (!used.has(id)) { used.add(id); return { id, s: suit, r }; }
        }
        throw new Error("擺不出手牌");
      };
      const hL = [pick(0), pick(1)], hO = [pick(0), pick(2)];
      const put = (seat: number, cards: unknown) =>
        PG.db!.query(`update public.hands set cards = $3::jsonb where code = $1 and seat = $2`, [code, seat, JSON.stringify(cards)]);
      await put(sL, hL); await put(sO, hO);

      const t = performance.now();
      const r = await hit(uO, { action: "play", code, card: hO[0].id });
      const ms = performance.now() - t;
      ok(r.status === 409 && r.body.error === "還沒輪到你",
        `前一家一直不出：應該 409「還沒輪到你」，拿到 ${r.status} ${JSON.stringify(r.body.error ?? "")}`);
      ok(ms >= 2500 && ms < 6000, `前一家一直不出：等了 ${Math.round(ms)}ms（該是 3 秒左右）`);
      ok((await room(code)).rev === R.rev && r.body.room?.rev === R.rev, "前一家一直不出：等完被打回，桌面卻被動過了，或帶回來的不是這一刻");

      // c. 不必等的：牌不在手上、這一墩已經出過（重送、連點）
      const t2 = performance.now();
      const r2 = await hit(uO, { action: "play", code, card: "沒有這張" });
      ok(r2.status === 409 && performance.now() - t2 < 1500, `牌不在手上也等了 ${Math.round(performance.now() - t2)}ms`);
      const rL = await hit(uL, { action: "play", code, card: hL[0].id });
      ok(rL.status === 200, `擺好的手牌出不去：${rL.status} ${rL.body.error ?? ""}`);
      const t3 = performance.now();
      const r3 = await hit(uL, { action: "play", code, card: hL[1].id });
      ok(r3.status === 409 && performance.now() - t3 < 1500, `這一墩已經出過還重送，也等了 ${Math.round(performance.now() - t3)}ms`);
      // 輪到你但不跟花色：字還是「這張牌不能出」，不是「還沒輪到你」
      const r4 = await hit(uO, { action: "play", code, card: hO[1].id });
      ok(r4.status === 409 && r4.body.error === "這張牌不能出", `輪到你但不跟花色：${r4.status} ${JSON.stringify(r4.body.error)}`);
    }

    // d. 依序叫墩：下一家先到、輪到的人晚 0.3 秒
    {
      const { code, us, pids } = await table(3);
      const R = await room(code);
      const uA = (await seatUser(code, us, pids, R.turn))!;
      const uB = (await seatUser(code, us, pids, (R.turn + 1) % 3))!;
      const [rB, rA] = await Promise.all([
        hit(uB, { action: "bid", code, v: 0 }),
        later(300, () => hit(uA, { action: "bid", code, v: 0 })),
      ]);
      const R2 = await room(code);
      ok(rA.status === 200 && rB.status === 200 && R2.bids[R.turn] === 0 && R2.bids[(R.turn + 1) % 3] === 0,
        `依序叫墩早到：下一家 ${rB.status} ${rB.body.error ?? ""}、輪到的人 ${rA.status}（桌上 ${JSON.stringify(R2.bids)}）`);
    }

    // e. 最後一家的叫墩還在路上，莊家就先出牌了
    {
      const { code, us, pids } = await table(2);
      const R = await room(code);
      const uS = (await seatUser(code, us, pids, R.turn))!, uLast = us.find((x) => x !== uS)!;
      await hit(uS, { action: "bid", code, v: 0 });
      const c = (await handOf(code, R.starter))[0];
      const lastBid = async () => {
        for (const v of [0, 1, 2]) {
          const r = await hit(uLast, { action: "bid", code, v });
          if (r.status === 200) return r;
        }
        return null;
      };
      const [rP, rB] = await Promise.all([
        hit(uS, { action: "play", code, card: c.id }),
        later(300, lastBid),
      ]);
      const R2 = await room(code);
      ok(rB?.status === 200 && rP.status === 200 && R2.trick.some((t: { card: { id: string } }) => t.card.id === c.id),
        `叫墩還在路上時莊家先出牌：出牌 ${rP.status} ${rP.body.error ?? ""}、叫墩 ${rB?.status}`);
    }
  }

  /* ════════ 十、不准長出第二道門：牌局的寫入只走 game_commit ════════
     上面九段驗的是「走 game_commit 的那幾條路」；這一段釘的是「沒有別條路」。
     0007 之前的病根就是第二道門：手牌的寫入直接打 hands 表，在 rooms 的樂觀鎖外面。
     以後誰在 index.ts 加一句 from("hands") 或拿 from("rooms") 做 update，同樣的病就回來了，而上面九段多半照綠
     （新那條路沒有劇本）。靜態掃描抓不到的：用別的寫法拼出表名、或另開一支函式檔去寫。 */
  if (part(10)) {
    const code = srcNow.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const fromHands = [...code.matchAll(/\.from\(\s*["'`]hands["'`]\s*\)/g)].length;
    const fromRooms = [...code.matchAll(/\.from\(\s*["'`]rooms["'`]\s*\)\s*\.(\w+)/g)].map((m) => m[1]);
    const rpcs = [...code.matchAll(/\.rpc\(\s*["'`](\w+)["'`]/g)].map((m) => m[1]);
    ok(fromHands === 0, `index.ts 直接碰 hands 表 ${fromHands} 處——手牌只准經 game_load／game_commit`);
    /* create 開新房那一句是唯一的例外（新的一列，沒有人跟它搶）；它要找得到，找不到＝這段掃描自己壞了 */
    ok(fromRooms.length >= 1 && fromRooms.every((v) => v === "insert"),
      `index.ts 直接 ${fromRooms.filter((v) => v !== "insert").join("、") || "（一處都沒掃到，掃描壞了）"} rooms 表——牌局只准經 game_load 讀、game_commit 寫（讀也要同一個快照）`);
    const allowed = new Set(["game_load", "game_commit", "game_seen"]);
    ok(rpcs.includes("game_commit") && rpcs.every((f) => allowed.has(f)),
      `index.ts 叫了 ${rpcs.filter((f) => !allowed.has(f)).join("、") || "（沒掃到 game_commit）"}——只准這三支`);
  }
} catch (e) {
  fails.push("測試中途爆掉：" + ((e as Error).stack ?? e));
}

const ms = Math.round(performance.now() - t0);
console.log(`11 Up & Down — 伺服器那一步的測試（本體 index.ts ＋ 真的 Postgres）${BEFORE ? `【改之前：${BEFORE_REF}】` : ""}`);
console.log("  鎖屏補敲、兩發 next、同時叫墩、整場、409 帶真相、報到、房主離開、權限、int[] 欄位、沒有第二道門、早到的那一手");
console.log(`  ${checks} 項，${ms} 毫秒，SEED=${SEED}`);
if (fails.length) {
  console.log(`\n  ✗ ${fails.length} 項不對：\n`);
  for (const f of fails) console.log("  · " + f);
  Deno.exit(1);
}
console.log("  ✓ 全部通過");
