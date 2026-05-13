# 釐清後全自動協調者設計

日期：2026-05-13
狀態：使用者已確認

## 目標

這個專案要支援單一對話窗口的工作流：使用者丟進需求後，協調者先釐清規格內容；規格釐清完成後，協調者自行串接後續 agent pipeline，不需要使用者手動推進每個 stage。

理想操作模型是「先釐清，再自動」：Stage 0 保持互動，因為模糊需求不能被委派；但 Stage 0 完成後，協調者要負責 stage 切換、subagent 派工、artifact 檢查與狀態回報。

## 採用方案

沿用既有的 `CLARIFIED.md` 作為自動化分界線。

在 `CLARIFIED.md` 產生前，協調者可以問問題、檢查 disk 現況、摘要自己的理解。使用者確認 Stage 0 摘要後，協調者寫入 `CLARIFIED.md`，並自動執行：

1. 將 task 從 `tasks/backlog/` 移到 `tasks/in-progress/`。
2. 派 `spec-writer` 產出 `SPEC.md`。
3. 若 `SPEC.md` 成功產出，派 `coder` 實作並產出 `IMPL-NOTES.md`。
4. 若實作狀態是 `OK` 或 `PARTIAL`，派 `reviewer` 產出 `REVIEW.md`。
5. 將最終狀態回報給使用者，附 artifact 路徑與必要人工動作，通常是人工驗收與 commit。

## 人工 checkpoint

正常流程只有一個固定 checkpoint：

- Stage 0 結束時，協調者先摘要已釐清的需求，請使用者確認；確認後才寫入 `CLARIFIED.md` 並啟動自動 pipeline。

只有遇到例外狀況時，協調者才停下來問使用者：

- subagent 回傳 `STOP`。
- reviewer 回傳 `BLOCK`。
- task 涉及不可委派決策，例如 auth、RBAC、secret、不可逆 DB migration、外部 API contract、cache 或 index 設計，或尚未拍板的架構 trade-off。
- disk 現況與使用者描述的現況矛盾。
- task 規模超出允許範圍，必須拆分。

## 元件

- 協調者：負責 Stage 0、task 建立、stage 切換、subagent 派工、artifact 驗證與使用者回報。協調者不寫實作 code。
- `spec-writer`：將 `CLARIFIED.md` 轉成 `SPEC.md`，或回傳 `STOP.md`。
- `coder`：依 `SPEC.md` 在 target working tree 實作，並寫入 `IMPL-NOTES.md`。不自動 commit。
- `reviewer`：依 `SPEC.md` 驗收實作，重跑可自動驗的 acceptance，並寫入 `REVIEW.md`。
- task artifacts：跨 session resume 的持久事實來源。

## 資料流

1. 使用者需求進入協調者。
2. 若需求依賴現況判斷，協調者先 spot-check disk。
3. 協調者只問必要問題，直到模糊地帶被消除。
4. 協調者請使用者確認已釐清的需求摘要。
5. 協調者建立 `tasks/backlog/T-XXXX-<slug>/CLARIFIED.md`。
6. 協調者將 task 移到 `tasks/in-progress/`。
7. 後續 stage artifacts 累積在同一個 task 目錄：`SPEC.md`、`IMPL-NOTES.md`、`REVIEW.md`。
8. 協調者讀 artifact 決定下一步，不採信 subagent 的口頭宣稱。
9. 協調者回報最終狀態，等待必要的人工驗收或 commit。

## 錯誤處理

- `spec-writer` 回傳 `STOP.md`：回到 Stage 0，詢問具體未釐清項目。
- `coder` 回傳 status = `STOP` 的 `IMPL-NOTES.md`：檢查原因，依狀況回 Stage 0、回 Stage 1，或進入例外 checkpoint。
- `coder` 回傳 `PARTIAL`：若 review 仍有意義，繼續派 reviewer，然後回報剩餘人工驗收項目。
- `reviewer` 回傳 `REQUEST_CHANGES`：再次派 `coder`，並把 `REVIEW.md` 當作額外唯讀 input。
- `reviewer` 回傳 `BLOCK`：停下來問使用者要開 follow-up task、放棄 task，或修正需求。
- artifact 缺失或格式錯誤：停下來回報壞在哪個 stage，不從 subagent response 文字推論成功。

## Resume 規則

每次新 session 啟動時，協調者必須檢查 `tasks/backlog/`、`tasks/in-progress/`、`tasks/done/`，再從 disk artifacts 推導實際 stage。

若沒有例外 checkpoint，協調者應自動恢復下一個確定 stage。例如：

- 只有 `CLARIFIED.md`：派 `spec-writer`。
- 有 `CLARIFIED.md` 與 `SPEC.md`：派 `coder`。
- 有 `CLARIFIED.md`、`SPEC.md`、`IMPL-NOTES.md`：除非 implementation status 是 `STOP`，否則派 `reviewer`。
- 四個 artifacts 都存在：回報 verdict 與下一步。

## 測試策略

正式廣泛使用前，應先用 dogfood tasks 驗證：

- 一個正常小 task，能一路到 `APPROVE`。
- 一個 `spec-writer` 會回傳 `STOP` 的 task。
- 一個 reviewer 回傳 `REQUEST_CHANGES` 後，協調者能再派 `coder` 修正的 task。
- 一個 reviewer 回傳 `BLOCK`，協調者能提出或建立 follow-up task 的案例。
- 一個跨 session resume 案例，協調者能從 disk artifacts 恢復並接續正確 stage。

## 非目標

- 本設計不做視覺化 kanban UI。
- 不自動 commit 或 push。
- 不跳過模糊需求的 Stage 0。
- 協調者不改實作 code。
- 不取代既有 `spec-writer`、`coder`、`reviewer` 的角色邊界。
