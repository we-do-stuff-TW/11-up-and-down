# 0004 — 線上多人：牌點了出不去、喊墩那一欄一直上下跳動點不到

狀態：處理中（10-24 Francis 回「好」：網頁兩半都推上線；資料庫 0008 寫好，套線上要他本人跑）
發現：2026-10-24（Francis 跟朋友打，房號 48DC、五個真人、第 18 局，貼了 `?trace=1` 的 log）
嚴重度：高（中後段整場都可能發生；出牌被吃掉、叫墩按不到）

## 症狀（Francis 原話）

「牌點了但出不去。喊墩數的那一欄一直上下跳動，點不到。」

## 查到什麼

### 畫面一下認得自己、一下認不得（查過：log）

log 每一行尾巴的 `me=` 在 0 與 -1 之間來回跳（-1＝找不到自己的座位）。-1 的時候：
`doPlay! 1-2-13 noseat`（出牌被擋掉），而且每 420ms 一次
`TypeError: can't access property "kind", s is undefined`（ticker 讀 `G.seats[G.turn]` 讀到空的）。
`me` 變 -1 的那一下沒有任何 `row` 那行——log 只在 rev／phase／turn 變了才記列，
所以弄壞它的是一列「rev 沒變」的推播：只有心跳（`game_seen`）會這樣。

### 心跳推來的那一列沒有座位（查過：線上資料庫＋重演）

- rooms 那一列長過約 2KB，Postgres 會把最大的那一欄 jsonb 存到列外（TOAST）。
  48DC 現在（等待房間、計分紀錄是空的）就已經 1748 bytes，座位那一欄壓縮後 709 bytes（五個 Google 頭像網址）。
- `game_seen` 只改 `seen`。存在列外又沒被改到的那一欄，邏輯複寫裡就沒有它；
  線上的 `realtime.apply_rls` 只會從 old_record 補（原文註解：「if unchanged toast, get column name and value from old record」），
  而 rooms 的 REPLICA IDENTITY 是 DEFAULT（`relreplident = d`），old_record 只有主鍵——推出去的那一列就沒有 `seats`。
  supabase-js 2.116.0 的 `convertChangeData` 照收到的 key 轉，沒帶的就是沒有。
- 網頁 `applyRow` 寫的是 `(row.seats||[])`：把「沒帶」當成「桌上沒人」。
- `scripts/toast_probe.ts`（PGlite＝真的 Postgres 17，叫 repo 裡 0007 的 `game_commit`／`game_seen` 原文）重演五人桌 21 局三趟：
  座位從第 1～6 局起就在列外，其中兩趟到第 17、18 局換成計分紀錄（`log`）在列外；心跳之後座位的列外指標沿用＝推播不帶。
  log 裡第 19、20 局沒再出現 `me=-1`，跟「後段換成 log 在列外」對得上（推論：線上那一刻的大小沒留下來）。
- 為什麼一下好一下壞：每一步牌（`game_commit`）把每一欄都重寫一次，推出來是整列，座位回來；
  下一次心跳又沒帶，座位又不見。五個人各自報到，一秒一次上下。

### 喊墩那一欄上下跳（推論：從程式推的，沒在真牌桌上重現）

叫墩那排按鈕只在「輪到我」時畫（`renderStatus`：`G.turn === me`）。`me` 一下 0 一下 -1，
那排就一下有一下沒有，狀態列高度跟著變——他說的「上下跳動、點不到」。

### 同一個病的其他樣子（推論）

- 後段換成 `log` 在列外時，心跳那一列沒帶計分紀錄，計分表會被清空到下一步牌。
- `me=-1` 時 `applyRow` 會 `forgetRoom()`：那一刻重新整理，不會問你要不要回桌。

### 對手的牌出現→消失→再出現（查過：log 與程式；畫面那層沒在真牌桌上看過）

同一份 log：15:20:34 一號、15:20:35 二號的廣播先後畫上桌；15:20:35.756 只寫進一號那張的列（rev 843）到了，
比畫面新就照收，二號那張從桌上消失，15:20:36.790 rev 844 到了才又出現。15:20:47 同一件事發生在一墩的最後一張
（湊滿的一墩退回「還差一張」，rev 850→851）。自己那一手早就會疊回去（`replayPend`），對手的廣播以前收一列就全部作廢。

## 修法

### 網頁（10-24 推上線）

`docs/index.html` 的 `wholeRow()`，`applyRow` 一進來就過：手上那一列有、這一列沒帶的欄位＝沒帶。
- 同一個 rev：照手上那一列補（rev 沒變＝牌局沒動，除了心跳帶來的 `seen`，其他都一樣）。
- rev 變了又缺欄位：不收，比手上新就去問伺服器整列（正常情況不會發生：`game_commit` 每一欄都重寫）。
- `?trace=1` 會記 `row~ rev=… missing=seats fill`，以後再出現看得到。
- `net_test` 二十九段（78→87 項），四刀 tamper 各紅在對的那一條。其他六支測試照跑全綠。

### 對手的廣播疊回去（10-24 推上線）

`INBOX.peers` 記下畫上桌、還沒寫進去的那幾手；新的一列收下來之後 `replayPeers()` 疊回去，跟剛喊過來時共用 `applyPeer()`。
只疊同一墩（不然上一墩那張會跑進下一墩）、六秒內喊的（跟 `INBOX.TTL` 同一個保險絲）；疊完跟收這一列之前同一格就留原本的時間戳（動畫不重演）。
我那一手的回話不疊：成功的一定含著前面每一手，被否決的（409）說的就是「對手那張還沒寫進去」。
`net_test` 三十段（87→95），五刀 tamper 各紅在對的那一條；叫墩也測。

### 資料庫（`supabase/migrations/0008_rooms_full_identity.sql`，線上還沒套）

`alter table public.rooms replica identity full;`——realtime 就能從 old_record 補回沒變的那幾欄，每一列推出來都是整列。
好處：還開著舊網頁的人也一起好、以後別的欄位也不會再缺。代價：每次推播多帶一份舊的那一列（現在約 2.5KB → 5KB）。
可以隨時改回 `replica identity default`。
10-24 Francis 同意改；我用連線器套被自動權限擋下（改線上資料庫要他本人），請他在 Supabase 的 SQL Editor 跑那一行。
驗：`select relreplident from pg_class where oid = 'public.rooms'::regclass;` 要回 `f`。server_test 已經套 0008 跑過。
