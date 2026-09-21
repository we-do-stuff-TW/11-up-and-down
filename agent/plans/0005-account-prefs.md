# 0005 — 設定跟著帳號走、預設立體、拆掉書房鏡頭

狀態:**完成**(2026-09-22)

## 目標

設定頁上的選擇綁在 Google 帳號上:換裝置、重新登入都拿回同一套;新玩家一開頁就是立體牌桌;立體牌桌不再有第二種鏡頭。

## 做法

- **存哪**:`supabase.auth.updateUser({data:{prefs}})` 寫進帳號的 `user_metadata.prefs`。不開表、不改 edge function、不必 deploy。
  Google 再登入時 metadata 是合併不是覆蓋,自訂鍵不會被洗掉。
- **哪些鍵**:`lang` `deck` `dim` `speed` `sfx` `name`(設定頁五排 + 帳號頁的名字)。畫質 `fx` 不跟(Francis 拍板:那是裝置的事);沒有介面的音量不同步。
- **兩份**:localStorage 仍是第一份(這台立刻有反應、離線也在);`adoptUser()` 拿到 user 時 `acctApply()` 把帳號那份蓋回本機,每個 uid 只套一次(`updateUser` 之後 `onAuthStateChange` 會再送一次 user,不能再套回來)。
- **寫回**:設定頁每個 `optRow` 的 onPick 與名字輸入框都叫 `acctPush()`,去抖 0.8 秒送整包。帳號裡還沒有設定的新帳號:把這台現在的選擇傳上去。
- **網址優先**:帶 `?lang=` / `?dim=` 的那一次(截圖、測試)帳號不蓋。
- **預設立體**:3D 層初始化 `saved !== "2"` 就鋪桌(原本 `=== "3"`);沒 WebGL 照舊只有平面。三支無頭測試的 open 明寫 `dim=2`。
- **拆書房**:設定頁「立體鏡頭」那排、`camPref/setCam/UD.onCam`、3D 層 `camView/pitchToBottom` 與 resize 的 study 分支、字典三條。鏡頭只剩俯角 42°(直式 50°)。

## DoD

- [x] `ui_test` `end_test` `net_test` 全過;`i18n_scan`(en / zh / DIM=3)全過。
- [x] 無頭探測 13 項:預設立體、鏡頭那排不見、帳號設定套回本機六個鍵、不反寫、守衛、改設定 0.8 秒後 updateUser 帶整包、新帳號上傳、`?dim=2&lang=zh` 不被蓋。
- [x] 平面／立體都看過截圖(桌機、手機)。
- [ ] 真帳號兩台裝置實測(要 Francis 登入才做得到)。

## 沒做、要注意

- 帳號那份沒有版本或時間戳比對,永遠是「登入時帳號蓋本機、之後本機改就寫回」。兩台同時開著改設定,後寫的贏。
