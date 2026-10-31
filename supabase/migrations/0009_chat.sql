-- 0009 聊天室（plan 0008）：同一桌的人在開房頁、牌局中打字講話。
--
-- 為什麼存進資料庫、不只走頻道的 broadcast：手機的即時頻道常常斷（2026-10-08 房間 5527 二十分鐘重接十次），
-- 斷著那段 broadcast 不會補送；存起來，接回來就能把漏掉的補上，晚坐下的人也看得到前面聊的。
-- 而且 broadcast 的頻道知道房號就接得上，存進表才擋得住「沒坐在這桌的人」。
--
-- 這支只「新增」一張表、三支函式、一條讀取規則，不碰 rooms／hands——
-- 舊版的 game 函式與舊網頁照常跑（沒人用這張表），所以先跑這支、再部署新函式，中間沒有空窗。
--
-- 誰能做什麼：
--   寫：只有 edge function（service_role）透過 chat_say。沒有任何寫入 policy（跟 rooms／hands 同一條路）。
--   讀：edge function 透過 chat_since 補漏掉的；瀏覽器只會經 realtime 收到「新的一句」，
--       realtime 照下面那條 select policy 判斷這一句推不推給你——坐在這一桌（真人座位）的才推。
--
-- 改回去（整支拿掉）：
--   alter publication supabase_realtime drop table public.chat;
--   drop table public.chat; drop function public.chat_seated(text);
--   drop function public.chat_say(text, text, text, text, int); drop function public.chat_since(text, bigint, int);

create table if not exists public.chat (
  id     bigint generated always as identity primary key,
  code   text        not null references public.rooms(code) on delete cascade,
  match  int         not null default 1,          -- 第幾場（「再來一場」同一串，不清空）
  pid    text        not null,
  name   text        not null,                    -- 講的當下座位上的名字
  body   text        not null,
  at     timestamptz not null default now(),
  -- 字數算的是字（code point），不是 JS 的 length：一個 emoji 在 JS 算 2，這裡算 1。
  -- 網頁的 maxlength 是 JS 的 100，所以網頁放行的永遠過得了這裡。
  constraint chat_body_len check (char_length(body) between 1 and 100 and btrim(body) <> '')
);
create index if not exists chat_code_id on public.chat (code, id);

alter table public.chat enable row level security;

-- ── 你坐不坐在這一桌 ──
-- ⚠️ 不能在 policy 裡直接查 players：players 的 RLS 開著、一條 policy 都沒有（2026-10-31 查過線上），
-- 用瀏覽器的身分查永遠是空的＝誰都讀不到。所以包成 security definer（用建立者的權限查），policy 叫這支。
-- 「坐著」跟 index.ts 的 seatOf() 同一個定義：seats 裡有一格 pid 是你、而且 kind 是 human。
-- 牌局中離開的人那一格會變成 open（index.ts leave），從那一刻起就收不到。
create or replace function public.chat_seated(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.players p
      join public.rooms r on r.code = p_code
     where p.user_id = auth.uid()
       and exists (
         select 1 from jsonb_array_elements(r.seats) s
          where s ->> 'pid' = p.pid::text and s ->> 'kind' = 'human'
       )
  )
$$;

drop policy if exists "坐在這桌的人讀得到" on public.chat;
create policy "坐在這桌的人讀得到" on public.chat
  for select to authenticated
  using (public.chat_seated(code));

-- ── 說一句 ──
-- 座位、字數在 edge function 先驗過（它手上有剛讀的那一桌）；這裡只管「太快」與寫入，同一個交易。
-- 同一個人在同一桌：最近 5 秒已經講了 4 句就不收，回 null。
-- advisory lock：同一個人同時送兩句時，第二句要等第一句寫完才數，不然兩句都數到 3、都放行。
create or replace function public.chat_say(p_code text, p_pid text, p_name text, p_body text, p_match int)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.chat;
begin
  perform pg_advisory_xact_lock(hashtext('chat:' || p_code || ':' || p_pid));
  if (select count(*) from public.chat c
       where c.code = p_code and c.pid = p_pid and c.at > clock_timestamp() - interval '5 seconds') >= 4 then
    return null;
  end if;
  insert into public.chat (code, match, pid, name, body, at)
  values (p_code, p_match, p_pid, p_name, p_body, clock_timestamp())
  returning * into v_row;
  return to_jsonb(v_row);
end
$$;

-- ── 某一句之後的話（補漏掉的、剛坐下拿前面的）──
-- 最多回最新的 p_limit 句，由舊到新。斷線太久漏掉超過這個數，更早的那些就不補（畫面上只會少更早的，不會亂序）。
create or replace function public.chat_since(p_code text, p_after bigint, p_limit int)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb)
    from (
      select c.* from public.chat c
       where c.code = p_code and c.id > p_after
       order by c.id desc
       limit greatest(1, least(p_limit, 200))
    ) x
$$;

-- Supabase 預設讓 anon／authenticated 執行 public 底下新建的函式、讀寫新建的表。收回來：
-- chat_say／chat_since 只給 edge function；chat_seated 要給 authenticated（policy 用你的身分執行它）。
revoke all on function public.chat_say(text, text, text, text, int) from public, anon, authenticated;
revoke all on function public.chat_since(text, bigint, int) from public, anon, authenticated;
revoke all on function public.chat_seated(text) from public, anon;
grant execute on function public.chat_say(text, text, text, text, int) to service_role;
grant execute on function public.chat_since(text, bigint, int) to service_role;
grant execute on function public.chat_seated(text) to authenticated, service_role;
revoke all on public.chat from anon, authenticated;
grant select on public.chat to authenticated;
grant all on public.chat to service_role;

-- realtime：新的一句推給這一桌（推不推給你由上面那條 policy 決定）。重跑這支不會報「已經在裡面」。
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat') then
    alter publication supabase_realtime add table public.chat;
  end if;
end
$$;
