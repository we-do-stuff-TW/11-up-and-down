# conventions.md — 工作流程與慣例

## 工作流程

1. **Plan**:中大型任務先在 `agent/plans/` 開一份 plan 檔,寫清楚目標、步驟、DoD,並在 `agent/plans/INDEX.md` 登記。
2. **Do**:照 plan 執行。過程中發現 plan 需要改,先改 plan 再繼續。
3. **Verify**:對照 DoD 逐項確認(能跑測試就跑測試)。
4. **Record**:更新 plan 狀態與 `agent/PROGRESS.md`;有架構層級的決策就補一份 ADR(`agent/adr/`)。

## Plan 檔案慣例

- 命名:`NNNN-簡短描述.md`(例:`0003-migrate-db.md`),編號循序、不重複使用。
- 每份 plan 必含:目標(一句話)、步驟、DoD、狀態。
- 狀態標記:`草稿` → `進行中` → `完成` / `擱置` / `作廢`。

## Definition of Done(DoD)

<!-- TODO: 定義這個專案「做完」的通用標準。範例: -->
- 功能可跑、既有測試全過。
- `agent/PROGRESS.md` 已更新。
- 有新的架構決策 → ADR 已補。

## Issue 慣例

- 一個 issue 一個檔,放 `agent/issues/`,命名 `NNNN-簡短描述.md`。
- 檔案開頭標明:狀態(開放/處理中/已解決)、發現日期、嚴重度。
- 解決後不刪檔,改狀態留紀錄。

## Report 慣例

- 量測報告、交付物放 `agent/reports/`,並在 `agent/reports/INDEX.md` 登記一列。
