-- 0007 一步牌局：一步＝一個交易。
--
-- 以前伺服器的一步是：rooms 與 hands 各讀一趟（不是同一刻）→ 算規則 → 先寫 hands → 再用 rev 樂觀鎖寫 rooms。
-- hands 的寫入全在鎖外：搶頁輸了 rooms 沒動，hands 卻已經改了。2026-10-17 架構健檢的探針重演出：
--   · 補敲撞在一起 → 有人手上少一張牌 → 那局最後一墩整桌永久卡死
--   · 兩發 next 撞在一起 → hands 是一副、rooms 上的王牌是另一副
--   · 整份 seen 跟著牌局覆寫 → 別人剛報的到被蓋回舊值
-- 這支 migration 只「新增」三支函式，不改任何既有的表、函式、權限——
-- 舊版的 game 函式照常跑（它不叫這三支），所以先跑這支、再部署新函式，中間沒有空窗。
--
-- 三支都只給 service_role（edge function）。rooms／hands 的 RLS 不變。

-- 0005 加的欄位。線上應該已經有了；沒有的話 game_load 會整支報錯，所以這裡再保證一次（冪等）。
alter table public.hands add column if not exists bid int;

-- ── 讀：房間＋這一桌全部手牌，一句 SELECT ──
-- READ COMMITTED 底下，同一句 SQL（含子查詢）看到的是同一個快照。
-- 以前是兩句並行，房間可能是新的、手牌可能是舊的（或反過來）——那正是「少一張牌」的入口之一。
-- 找不到房間回 null。
create or replace function public.game_load(p_code text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'room', to_jsonb(r),
    'hands', coalesce((
      select jsonb_agg(jsonb_build_object('ri', h.ri, 'seat', h.seat, 'cards', h.cards, 'bid', h.bid))
      from public.hands h
      where h.code = r.code
    ), '[]'::jsonb)
  )
  from public.rooms r
  where r.code = p_code
$$;

-- ── 寫：鎖 rev → 改房間 → 改手牌，同一個交易 ──
-- p_rev   ：讀的時候那一列的 rev。對不上＝別人先寫了，回 null，**房間與手牌一筆都不寫**。
-- p_patch ：要寫的牌局欄位（edge function 的 PERSIST）。沒給的欄位保持原值；給了 null 就寫 null。
--           刻意不含 seen——seen 由下面 p_pid 合併「自己那一格」，不再整份覆寫。
-- p_hands ：null＝這一步沒碰手牌。否則 {reset, rows:[{ri, seat, cards, bid}]}：
--           reset 為真（發新的一局、回到等待房間）先清掉這一桌全部手牌再寫 rows。
-- 回傳寫完的那一列（跟 select * 同一個形狀）。
-- 兩個人同時提交：第二個會等第一個的列鎖，鎖放掉之後 PostgreSQL 用新的那一列重新檢查 where，
-- rev 已經對不上 → 0 列 → 回 null。手牌的寫入在房間那一句之後，所以輸家碰不到手牌。
create or replace function public.game_commit(
  p_code  text,
  p_rev   bigint,
  p_patch jsonb,
  p_pid   text,
  p_now   bigint,
  p_hands jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_room jsonb;
  v_h    record;
begin
  update public.rooms r
     set (cfg, ladder, seats, phase, ri, hs, starter, trump, trump_card,
          leader, turn, led, played, trick, bids, won, score, log,
          host_pid, step_at, match) =
         (select x.cfg, x.ladder, x.seats, x.phase, x.ri, x.hs, x.starter, x.trump, x.trump_card,
                 x.leader, x.turn, x.led, x.played, x.trick, x.bids, x.won, x.score, x.log,
                 x.host_pid, x.step_at, x.match
            from jsonb_populate_record(r, p_patch) x),
         rev = r.rev + 1,
         updated_at = now(),
         seen = case when p_pid is null then r.seen
                     else coalesce(r.seen::jsonb, '{}'::jsonb) || jsonb_build_object(p_pid, p_now) end
   where r.code = p_code and r.rev = p_rev
  returning to_jsonb(r) into v_room;

  if v_room is null then
    return null;
  end if;

  if p_hands is not null then
    if coalesce((p_hands ->> 'reset')::boolean, false) then
      delete from public.hands where code = p_code;
    end if;
    -- 不用 on conflict：線上 hands 的唯一鍵長怎樣沒查到（0001 不在 repo），先改再補不依賴它
    for v_h in
      select * from jsonb_to_recordset(coalesce(p_hands -> 'rows', '[]'::jsonb))
        as x(ri int, seat int, cards jsonb, bid int)
    loop
      update public.hands h
         set cards = v_h.cards, bid = v_h.bid
       where h.code = p_code and h.ri = v_h.ri and h.seat = v_h.seat;
      if not found then
        insert into public.hands (code, ri, seat, cards, bid)
        values (p_code, v_h.ri, v_h.seat, v_h.cards, v_h.bid);
      end if;
    end loop;
  end if;

  return v_room;
end
$$;

-- ── 報到：只合併自己那一格，不動 rev ──
-- 心跳（state）與沒事做的 tick 都走這裡。4 秒內報過就不寫：ticker 每 420ms 敲一次 tick，
-- 以前每一發都寫一次 rooms，每一次寫都是一列 realtime 推給全桌每一台（人越多推越多）。
-- 判斷離線的門檻是 30 秒，少記 4 秒內的那幾次不影響。
create or replace function public.game_seen(p_code text, p_pid text, p_now bigint)
returns void
language sql
set search_path = ''
as $$
  update public.rooms r
     set seen = coalesce(r.seen::jsonb, '{}'::jsonb) || jsonb_build_object(p_pid, p_now)
   where r.code = p_code
     and coalesce((r.seen ->> p_pid)::numeric, 0) < p_now - 4000
$$;

-- Supabase 預設讓 anon／authenticated 執行 public 底下新建的函式。這三支只給 edge function。
revoke all on function public.game_load(text) from public, anon, authenticated;
revoke all on function public.game_commit(text, bigint, jsonb, text, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.game_seen(text, text, bigint) from public, anon, authenticated;
grant execute on function public.game_load(text) to service_role;
grant execute on function public.game_commit(text, bigint, jsonb, text, bigint, jsonb) to service_role;
grant execute on function public.game_seen(text, text, bigint) to service_role;

-- PostgREST 要重新讀一次 schema 才找得到新函式（Supabase 通常會自己重讀，這句是保險）
notify pgrst, 'reload schema';
