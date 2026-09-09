# 11 Up & Down

叫墩撲克。局數從每人 1 張爬到 11 張再降回 1 張，共 21 局；每局翻一張王牌，
用骰子宣告自己會贏幾墩，叫中才有分。

- **玩**：https://we-do-stuff-tw.github.io/11-up-and-down/
- **計分**：叫 0 中得 5 分，叫 n 中得 10+n；沒叫中扣 |實際 − 叫的| 分。
- **牌組**：預設兩副 7–A 共 64 張。4 人要走完 1→11→1 至少需要 45 張。

## 結構

```
web/index.html                 前端（單檔，無建置流程）
supabase/functions/game/       牌局伺服器：發牌、驗證出牌、AI
supabase/migrations/           資料表與 RLS
updown.html                    Claude artifact 版（單人）
updown-online.html             Claude artifact 版（組織內多人）
```

## 手牌為什麼藏得住

發牌在 edge function 裡發生，手牌寫進 `hands` 表。那張表 RLS 開著、**一條 policy 都沒有**，
所以任何拿著 anon key 的瀏覽器都讀不到——包含房主的。每個人只會在自己的 API 回應裡
收到自己那份。`rooms` 表是公開狀態（檯面上的牌、叫墩、分數），本來就該所有人看得到，
但同樣沒有寫入 policy：牌局只能透過 edge function 推進。

身分不用 Supabase Auth，是一個存在 localStorage 的隨機 token，伺服器只留 sha256。
所以有連結就能玩，不用註冊。
