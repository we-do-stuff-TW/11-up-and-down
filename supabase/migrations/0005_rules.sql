-- 0005 房間規則：同時叫墩需要一個「別人讀不到」的地方放還沒翻開的數字。
--
-- rooms 是公開狀態（檯面上的牌、分數），而且客端直接訂它的 realtime——
-- 任何放在 rooms 上的欄位，全桌都看得到。同時叫墩的重點就是在翻開之前誰都不知道，
-- 所以那個數字只能放在 hands：那張表 RLS 開著、一條 policy 都沒有，
-- 拿著 anon key 的瀏覽器一列都讀不到，只有 edge function（service_role）進得去。
--
-- rooms.bids 上留的是 -1，意思是「這位放好了」——看得到誰決定了，看不到幾墩。

alter table public.hands add column if not exists bid int;
