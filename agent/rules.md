# rules.md — 行為規則與鐵則

> 這個檔案由 CLAUDE.md 用 `@agent/rules.md` 自動載入,每個 session 都會生效。
> 只放「違反了就出事」的規則。風格偏好、參考資訊放別的檔案。

## 鐵則(絕對不做)

- 未經 Francis 確認,不 `git push --force`、不刪除任何檔案或分支。
- 不把密鑰、token、個資寫進任何會進版控的檔案。
- `agent/PRD.md` 已凍結:不修改。若認為需要改,先開 issue 討論。
- 動手改功能前,先看 `agent/ARCHITECTURE.md`「架構不變量」,確認要改的東西真的存在。
- **平面／立體牌桌同改**:改牌面、牌桌行為、動畫、燈光時,2D 與 3D 兩種模式都要改、都要實際看過,不能只做一邊。

## 與 Francis 協作的方式

- **每次設計完,給 Francis 一份 HTML 展示**(截圖或可開的頁面),Francis 要用看的,不要只用文字描述結果。
- 中大型改動先寫 plan(見 `agent/conventions.md`),經確認再動手。
- 完成一個 DoD 里程碑後,更新 `agent/PROGRESS.md` 與對應 plan 的狀態。
- 有不確定的決策,列出選項與 trade-off 問 Francis,不要自己猜。

## 回應風格

<!-- TODO: 範例: -->
- 用繁體中文(台灣用語)。
- 先講結論,再講理由。
