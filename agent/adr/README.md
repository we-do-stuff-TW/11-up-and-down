# ADR 索引 — 架構決策記錄

## 什麼時候寫 ADR

做了一個「未來的自己會問為什麼」的架構/技術決策時(選了 A 不選 B、引入或放棄某依賴、改變資料流)。
一篇一到兩頁,格式照 [`template.md`](template.md)。

## 規則

- 命名:`NNNN-簡短描述.md`,編號循序、不重複使用。
- **已 Accepted 的 ADR 視為不可變**:要推翻就寫一份新的,並在舊的標上 `Superseded by NNNN`。
- 新增 ADR 後在下表加一列。

## 索引

| # | 決策 | 狀態 | 日期 |
|---|---|---|---|
| 0001 | [立體牌桌加一層後處理,並用「不動就不畫」換品質](0001-3d-post-processing.md) | Accepted | 2026-09-14 |

狀態:`Proposed` / `Accepted` / `Deprecated` / `Superseded by NNNN`
