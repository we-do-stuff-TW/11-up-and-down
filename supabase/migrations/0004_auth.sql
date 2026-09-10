-- 0004 登入：身分從「localStorage 隨機 token」換成 Google 帳號（Supabase Auth）。
--
-- players 原本用 token 的 sha256 認人。改了之後 user_id 才是主身分，token_hash 留著只為了
-- 一件事：舊裝置第一次登入時，把它原本那一列認領過去，桌上的座位與房主身分才不會斷。
-- 認領完就把 token_hash 清空，同一個 token 不能再被第二個帳號拿去。

alter table public.players add column if not exists user_id uuid unique references auth.users(id) on delete cascade;
alter table public.players add column if not exists name   text;
alter table public.players add column if not exists avatar text;
alter table public.players add column if not exists email  text;
alter table public.players alter column token_hash drop not null;

create index if not exists players_user_id_idx on public.players(user_id);

-- 戰績：一場打完，每個有帳號的座位留一列。
-- 跟 rooms／hands 一樣，只有 edge function（service_role）寫得進來；
-- 這裡多一條 select policy，因為這是唯一「本人該讀得到自己那份」的資料。
create table if not exists public.results (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  code        text        not null,
  finished_at timestamptz not null default now(),
  players     int         not null,
  seat        int         not null,
  score       int         not null,
  rank        int         not null,   -- 1 = 第一名；同分同名次
  hits        int         not null,   -- 叫中幾局
  rounds      int         not null,   -- 這場總共幾局
  opponents   jsonb       not null default '[]'::jsonb
);

alter table public.results enable row level security;

drop policy if exists "讀自己的戰績" on public.results;
create policy "讀自己的戰績" on public.results
  for select to authenticated
  using (auth.uid() = user_id);

-- 同一場只留一列（tick 重送、兩個 client 同時敲最後一局都不會寫成兩筆）
create unique index if not exists results_once on public.results (code, user_id);
create index if not exists results_recent on public.results (user_id, finished_at desc);
