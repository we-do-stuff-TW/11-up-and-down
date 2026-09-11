-- 0006 再開一場：牌局結束不再是死路，會回到原本那間等待房間，房主可以直接再開一場。
--
-- 同一間房因此會打不只一場，戰績那條「同一場只留一列」的唯一鍵就不夠用了
-- （results_once 是 (code, user_id)，第二場會被 ignoreDuplicates 默默吃掉）。
-- 加一個場次編號：rooms.match 每回到等待房間就 +1，results.match 記下那一列屬於第幾場。
-- 既有資料都是第 1 場，預設值 1 就是對的。

alter table public.rooms   add column if not exists match int not null default 1;
alter table public.results add column if not exists match int not null default 1;

drop index if exists results_once;
create unique index if not exists results_once on public.results (code, user_id, match);
