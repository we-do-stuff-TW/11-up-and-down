# CLAUDE.md

11 Up & Down:叫墩撲克：局數從每人 1 張爬到 11 張再降回 1 張，共 21 局；用骰子叫墩，叫中才有分。線上多人、Google 登入、平面／立體牌桌。

@agent/rules.md

## 要查什麼 → 看哪

| 要查 | 看哪 |
|---|---|
| **行為規則 / 鐵則 / 與 Francis 協作** | [`agent/rules.md`](agent/rules.md)(已自動載入) |
| 工作流程 / plan / 狀態 / DoD | [`agent/conventions.md`](agent/conventions.md) + [`agent/plans/INDEX.md`](agent/plans/INDEX.md) |
| 技術棧 / 系統怎麼組成 / 有什麼功能、沒什麼 | [`agent/ARCHITECTURE.md`](agent/ARCHITECTURE.md) |
| ⚠️ **容易誤以為「有」、其實沒有的功能**(動手前先看,免做白工) | [`agent/ARCHITECTURE.md`](agent/ARCHITECTURE.md) §「架構不變量」 |
| 改某功能的程式去哪 | [`agent/ARCHITECTURE.md`](agent/ARCHITECTURE.md) §「去哪改 X」 |
| 怎麼跑 / 跑測試 / 常用指令 | [`README.md`](README.md)「測試」(前端是單檔 `docs/index.html`,無建置流程) |
| 為什麼這樣設計(產品定位) | [`agent/PRD.md`](agent/PRD.md)(凍結) |
| 當初為什麼這樣決定(架構決策) | [`agent/adr/`](agent/adr/)(索引:[`agent/adr/README.md`](agent/adr/README.md)) |
| 現在做到哪(哪些 ship 了 / 時間軸) | [`agent/PROGRESS.md`](agent/PROGRESS.md) |
| 開放 bug / 設計議題 · 量測報告 / 交付物 | [`agent/issues/`](agent/issues/) · [`agent/reports/INDEX.md`](agent/reports/INDEX.md) |
| 其他沒列到的 → 完整檔案 / 資料夾清冊 | [`README.md`](README.md)「結構」 |

<!--
維護原則(給 Francis,也給 Claude):
1. 這個檔案是「路由表」,不是「內容」。細節寫進被指到的檔案,這裡只加一列。
2. 全檔保持 200 行以下。新增一列前先問:拿掉它,Claude 會不會做錯事?不會就別加。
3. 文件系統全部收在 agent/,專案根目錄只有本檔(與 README、程式碼)。
4. 本專案特有的中樞檔(例如 intake 流程、vault 說明)→ 建在 agent/ 底下,並在表格加一列指過去。
-->
