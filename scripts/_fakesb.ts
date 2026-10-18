// server_test 用的假 supabase-js：底下是真的 Postgres（PGlite，PostgreSQL 16 編成 WASM，跑在記憶體裡）。
//
// 為什麼不是手寫的假資料庫：這一輪要驗的東西有一半住在 SQL 裡（migrations/0007 那三支函式的交易語意），
// 假資料庫只會驗到「我以為 Postgres 會怎樣」。這裡只假一層：supabase-js 的 query builder → SQL。
// index.ts 呼叫到的寫法才有做（from/select/insert/update/upsert/delete/eq/is/in/maybeSingle/single/rpc），
// 沒做的寫法會直接丟錯，不會安靜地回空。
//
// 抓不到的（寫在這裡讓人知道綠燈的邊界）：
//  · PostgREST 本身（權限、schema cache、回應的序列化）——這裡直接打 SQL
//  · 真的並行：PGlite 一次只跑一句，兩個交易不會同時握著鎖。兩趟請求的「讀→算→寫」照樣會交錯
//    （每一句之間都有亂數延遲），撞頁的邏輯驗得到；鎖等待、死結驗不到
//  · 函式↔資料庫的真實延遲（這裡是 0–3ms 的亂數，只為了打散先後）
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

// deno-lint-ignore no-explicit-any
export type SupabaseClient = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export const PG: { db: PGlite | null; jitter: () => number; log: string[] | null } = {
  db: null,
  jitter: () => 0,
  log: null,
};
const nap = () => {
  const ms = PG.jitter();
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
};
const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error("假 supabase：欄位名不認得 " + s);
  return '"' + s + '"';
};
const cols = (s: string) => s === "*" ? null : s.split(",").map((c) => c.trim()).filter(Boolean);

async function q(sql: string, params: unknown[]): Promise<Row[]> {
  if (!PG.db) throw new Error("假 supabase：PG.db 還沒設");
  await nap();
  try {
    const r = await PG.db.query<Row>(sql, params);
    return r.rows;
  } finally {
    await nap();
  }
}

class Builder {
  kind: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  pick: string[] | null = null;      // select 的欄位；null＝全部
  ret = false;                        // 寫入之後要不要回傳那幾列
  retPick: string[] | null = null;
  one: "" | "maybe" | "single" = "";
  patch: Row | null = null;
  rows: Row[] = [];
  opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  where: [string, string, unknown][] = [];
  constructor(public table: string) { ident(table); }

  select(c = "*") {
    if (this.kind === "select") this.pick = cols(c);
    else { this.ret = true; this.retPick = cols(c); }
    return this;
  }
  insert(r: Row | Row[]) { this.kind = "insert"; this.rows = Array.isArray(r) ? r : [r]; return this; }
  upsert(r: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.kind = "upsert"; this.rows = Array.isArray(r) ? r : [r]; this.opts = o ?? {}; return this;
  }
  update(p: Row) { this.kind = "update"; this.patch = p; return this; }
  delete() { this.kind = "delete"; return this; }
  eq(c: string, v: unknown) { this.where.push(["eq", c, v]); return this; }
  is(c: string, v: unknown) {
    if (v !== null) throw new Error("假 supabase：is() 只做了 null");
    this.where.push(["is", c, v]); return this;
  }
  in(c: string, v: unknown[]) { this.where.push(["in", c, v]); return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  single() { this.one = "single"; return this; }

  #cond(params: unknown[]): string {
    if (!this.where.length) return "";
    return " where " + this.where.map(([op, c, v]) => {
      if (op === "is") return `${ident(c)} is null`;
      if (op === "in") { params.push((v as unknown[]).map(String)); return `${ident(c)}::text = any($${params.length}::text[])`; }
      params.push(String(v));
      return `${ident(c)}::text = $${params.length}::text`;
    }).join(" and ");
  }
  #out(list: string[] | null) {
    return list ? `jsonb_build_object(${list.map((c) => `'${c}', ${ident(c)}`).join(", ")})` : `to_jsonb(t)`;
  }

  async run(): Promise<{ data: unknown; error: { message: string; code?: string } | null; status: number }> {
    const T = "public." + ident(this.table);
    const params: unknown[] = [];
    let sql = "";
    if (this.kind === "select") {
      sql = `select ${this.#out(this.pick)} as j from ${T} t${this.#cond(params)}`;
    } else if (this.kind === "delete") {
      sql = `delete from ${T} t${this.#cond(params)}`;
    } else if (this.kind === "update") {
      const keys = Object.keys(this.patch ?? {});
      params.push(JSON.stringify(this.patch));
      const p = `$${params.length}::jsonb`;
      // 型別照欄位轉（jsonb_populate_record 以那一列為底），只改給了的欄位
      const lhs = keys.length === 1 ? ident(keys[0]) : `(${keys.map(ident).join(", ")})`;
      sql = `update ${T} t set ${lhs} = ` +
        `(select ${keys.map((k) => "x." + ident(k)).join(", ")} from jsonb_populate_record(t, ${p}) x)` +
        `${this.#cond(params)}` +
        (this.ret ? ` returning ${this.#out(this.retPick)} as j` : "");
    } else {
      // insert／upsert：只寫給了的欄位，其他吃預設值（跟 PostgREST 一樣）
      const keys = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
      params.push(JSON.stringify(this.rows));
      sql = `insert into ${T} (${keys.map(ident).join(", ")}) ` +
        `select ${keys.map(ident).join(", ")} from jsonb_populate_recordset(null::${T}, $1::jsonb)`;
      if (this.kind === "upsert") {
        const on = (this.opts.onConflict ?? "").split(",").map((c) => c.trim()).filter(Boolean);
        if (!on.length) throw new Error("假 supabase：upsert 要給 onConflict");
        const rest = keys.filter((k) => !on.includes(k));
        sql += ` on conflict (${on.map(ident).join(", ")}) ` + (this.opts.ignoreDuplicates || !rest.length
          ? "do nothing"
          : `do update set ${rest.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(", ")}`);
      }
      if (this.ret) sql = sql.replace(/^insert into (\S+)/, "insert into $1 as t") + ` returning ${this.#out(this.retPick)} as j`;
    }
    PG.log?.push(sql);
    let rows: Row[];
    try {
      rows = await q(sql, params);
    } catch (e) {
      return { data: null, error: { message: String((e as Error).message ?? e), code: (e as { code?: string }).code }, status: 400 };
    }
    const data = rows.map((r) => r.j);
    if (this.kind !== "select" && !this.ret) return { data: null, error: null, status: 204 };
    if (this.one === "maybe") {
      if (data.length > 1) return { data: null, error: { message: "多於一列" }, status: 406 };
      return { data: data[0] ?? null, error: null, status: 200 };
    }
    if (this.one === "single") {
      if (data.length !== 1) return { data: null, error: { message: `要一列，拿到 ${data.length} 列` }, status: 406 };
      return { data: data[0], error: null, status: 200 };
    }
    return { data, error: null, status: 200 };
  }
  // supabase-js 的 builder 是 thenable：await 它就是送出去
  then<A, B>(ok: (v: Awaited<ReturnType<Builder["run"]>>) => A, no?: (e: unknown) => B) {
    return this.run().then(ok, no);
  }
}

/* rpc 的參數型別。PostgREST 是照參數名配；這裡用具名呼叫（p => $1），型別要寫清楚才選得到同一支 */
const SIG: Record<string, [string, string][]> = {
  game_load: [["p_code", "text"]],
  game_commit: [["p_code", "text"], ["p_rev", "bigint"], ["p_patch", "jsonb"], ["p_pid", "text"],
    ["p_now", "bigint"], ["p_hands", "jsonb"]],
  game_seen: [["p_code", "text"], ["p_pid", "text"], ["p_now", "bigint"]],
  touch_seen: [["p_code", "text"], ["p_pid", "text"]],     // 舊版伺服器用的（線上定義沒查到，測試裡的見 server_test）
};
const VOID = new Set(["game_seen", "touch_seen"]);

async function rpc(fn: string, args: Row) {
  const sig = SIG[fn];
  if (!sig) throw new Error("假 supabase：rpc 沒做 " + fn);
  const params = sig.map(([k, t]) => {
    const v = args[k];
    if (v === undefined || v === null) return null;
    return t === "jsonb" ? JSON.stringify(v) : String(v);
  });
  const call = `public.${fn}(${sig.map(([k, t], i) => `${k} => $${i + 1}::${t}`).join(", ")})`;
  const sql = VOID.has(fn) ? `select ${call}` : `select ${call} as v`;
  PG.log?.push(sql);
  try {
    const rows = await q(sql, params);
    return { data: VOID.has(fn) ? null : rows[0]?.v ?? null, error: null, status: 200 };
  } catch (e) {
    return { data: null, error: { message: String((e as Error).message ?? e) }, status: 400 };
  }
}

export function createClient(_url: string, _key: string, _opts?: unknown) {
  return {
    from: (t: string) => new Builder(t),
    rpc: (fn: string, args: Row) => rpc(fn, args ?? {}),
    auth: { getUser: (_jwt: string) => Promise.resolve({ data: { user: null }, error: null }) },
  };
}

/* auth.ts 的替身：jwt 就是使用者的 uuid。驗簽不在這支測試的範圍（auth_test 管）。 */
export type Claims = { sub: string; email?: string; user_metadata?: Record<string, unknown> };
export function verifyLocal(jwt: string, _base: string, _anon: string): Promise<Claims | null> {
  return Promise.resolve(jwt ? { sub: jwt, email: jwt.slice(0, 8) + "@test", user_metadata: { full_name: "P" + jwt.slice(0, 4) } } : null);
}
