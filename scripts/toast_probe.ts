// 跑法：deno run -A scripts/toast_probe.ts
// 不是測試（沒有斷言、亂數沒種子），是 issue 0004 的重演：線上那一列長怎樣不能拿來實驗，這裡造一列一樣大的。
/* 桌上探針：一場 5 人、21 局的牌局，rooms 那一列在第幾局開始把 seats 存到 TOAST 外面？
   用 PGlite（真的 Postgres 17，跑在 WASM）建同型別的表，叫 repo 裡 0007 的 game_commit／game_seen 原文。
   量的是 pg_column_toast_chunk_id：不是 null＝存在外面。存在外面而這一次 UPDATE 沒改它＝
   邏輯複寫裡沒有這一欄（REPLICA IDENTITY DEFAULT），realtime 推出去的那一列就沒有 seats。 */
import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
const MIG = Deno.readTextFileSync(Deno.args[0] ?? new URL("../supabase/migrations/0007_one_step.sql", import.meta.url));
const db = new PGlite();
await db.exec(`
create table public.rooms (code text primary key, rev int8 default 0, cfg jsonb, ladder jsonb, seats jsonb default '[]',
 phase text default 'lobby', ri int4 default -1, hs int4 default 0, starter int4 default 0, trump int4, trump_card jsonb,
 leader int4 default 0, turn int4 default 0, led int4, played int4 default 0, trick jsonb default '[]', bids jsonb default '[]',
 won jsonb default '[]', score jsonb default '[]', log jsonb default '[]', host_pid uuid, seen jsonb default '{}',
 step_at int8 default 0, updated_at timestamptz default now(), created_at timestamptz default now(), match int4 default 1);
create table public.hands (code text, ri int, seat int, cards jsonb, bid int);
create role service_role; create role anon; create role authenticated;`);
await db.exec(MIG.replace(/notify pgrst.*$/m, ""));

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const rnd = (n: number) => Array.from({ length: n }, () => B64[Math.floor(Math.random() * 64)]).join("");
const uuid = () => crypto.randomUUID();
/* 線上 48DC 的形狀：名字 7/10/5/7/9 位元組、頭像 96/96/100/97/98 位元組（lh3.googleusercontent.com 開頭）*/
const NAME = [7, 10, 5, 7, 9], AV = [96, 96, 100, 97, 98];
const PFX = "https://lh3.googleusercontent.com/a/";
const seats = NAME.map((n, i) => ({ name: rnd(n), kind: "human", pid: uuid(), av: PFX + rnd(AV[i] - PFX.length) }));
const cfg = { n: 5, hit: "x10", hook: 0, miss: "x10", zero: "hand", decks: 2, jokers: 1, bidMode: "seq", minRank: 5 };
const ladder = [1,2,3,4,5,6,7,8,9,10,11,10,9,8,7,6,5,4,3,2,1];
const seen: Record<string, number> = {};
for (const s of seats) seen[s.pid] = Date.now();
await db.query(`insert into public.rooms (code, cfg, ladder, seats, host_pid, seen) values ('48DC',$1,$2,$3,$4,$5)`,
  [cfg, ladder, seats, seats[0].pid, seen]);

const R: any = { cfg, ladder, seats, phase: "bid", ri: 0, hs: 1, starter: 0, trump: 1, trump_card: { s: 1, r: 9, id: "0-1-9" },
  leader: 0, turn: 0, led: null, played: 0, trick: [], bids: [null,null,null,null,null], won: [0,0,0,0,0],
  score: [0,0,0,0,0], log: [], host_pid: seats[0].pid, step_at: 0, match: 1 };
let rev = 0;
const ext = async () => (await db.query<any>(`select pg_column_toast_chunk_id(seats) as seats, pg_column_toast_chunk_id(log) as log,
  pg_column_toast_chunk_id(seen) as seen, pg_column_toast_chunk_id(score) as score, pg_column_toast_chunk_id(trick) as trick,
  pg_column_size(r.*) as row from public.rooms r where code='48DC'`)).rows[0];
async function commit(pid: string) {
  R.step_at = Date.now();
  const r = await db.query<any>(`select public.game_commit('48DC', $1, $2, $3, $4, null) as v`, [rev, R, pid, Date.now()]);
  if (!r.rows[0].v) throw new Error("commit lost");
  rev++;
}
const card = () => ({ s: Math.floor(Math.random() * 4), r: 5 + Math.floor(Math.random() * 10), id: `${Math.floor(Math.random()*2)}-${Math.floor(Math.random()*4)}-${5 + Math.floor(Math.random()*10)}` });
const out: string[] = [];
for (let ri = 0; ri < 21; ri++) {
  R.ri = ri; R.hs = ladder[ri]; R.phase = "bid"; R.bids = [null,null,null,null,null]; R.won = [0,0,0,0,0]; R.played = 0; R.trick = [];
  R.trump = Math.floor(Math.random() * 4); R.trump_card = card();
  await commit(seats[0].pid);
  for (let i = 0; i < 5; i++) { R.bids[i] = Math.floor(Math.random() * (R.hs + 1)); R.turn = (i + 1) % 5; await commit(seats[i].pid); }
  R.phase = "play";
  for (let t = 0; t < R.hs; t++) {
    for (let i = 0; i < 5; i++) { R.trick.push({ p: i, card: card() }); await commit(seats[i].pid); }
    R.won[Math.floor(Math.random() * 5)]++; R.played++; R.trick = [];
    R.phase = R.played >= R.hs ? "roundend" : "play";
    await commit(seats[0].pid);
  }
  const cells = R.bids.map((b: number, i: number) => { const hit = b === R.won[i]; const pts = hit ? 10 + b * 10 : -10 * Math.abs(b - R.won[i]); R.score[i] += pts; return { bid: b, got: R.won[i], pts, hit }; });
  R.log.push({ size: R.hs, trump: R.trump, cells });
  await commit(seats[0].pid);
  /* 這一局中途的樣子（出牌中、檯面有兩張）：game_commit 寫完 → 心跳 game_seen 只改 seen */
  const a = await ext();
  await db.query(`select public.game_seen('48DC', $1, $2)`, [seats[2].pid, Date.now() + 10000 * (ri + 1)]);
  const b = await ext();
  out.push(`第 ${String(ri + 1).padStart(2)} 局後  log ${R.log.length} 筆  列 ${a.row}B  seats ${a.seats ? "外面" : "列內"}  log ${a.log ? "外面" : "列內"}  seen ${a.seen ? "外面" : "列內"}  score ${a.score ? "外面" : "列內"}` +
    `  ｜心跳後 seats 指標${a.seats && a.seats === b.seats ? "沿用（UPDATE 沒改它＝推播不帶）" : a.seats ? "換了" : "—"}`);
}
console.log(out.join("\n"));
