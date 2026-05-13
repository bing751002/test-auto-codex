# IMPL-NOTES: T-0003

## Status
- OK

## Files Touched
- `D:\agent-kanban-system\tools\digest-browser\index.html` (modify) — 累加 + sid 去重 + Clear all 按鈕

## Acceptance Status
- [-] AC-N1..N10: needs-manual-verify (瀏覽器互動 / 視覺驗證，無自動測試 harness)
- [-] AC-N11: needs-manual-verify (DevTools Network 觀察) — 自評：本次新增 code 0 個 `fetch` / `https?://` / `<script src` / `<link href`，INV-2 應 hold

## Deviations from SPEC
- 無。HTML 1 行（button）、JS state 1 行（digestMap）、JS DOM ref 1 行（$clearBtn）、syncDigestsFromMap ~4 行、finishLoad 改 ~4 行差異、clearAll ~16 行（含 dropdown fallback 繞過邏輯）、event wiring 2 行（含 `$fileInput.value=''` AC-N5 hint）。增量約 28 行核心 + 註解，落在 SPEC S（50-70 行）區間下緣

## Build / Test 結果
- 純前端單檔，無 build；未跑瀏覽器互動測試（無自動 harness，需人工驗）

## Next Steps
- 人工開啟 `tools/digest-browser/index.html` 跑 AC-N1..N11
- 確認 T-0002 既有 AC（AC-2/3/4/5/6/7/8/9/18）在累加情境仍 hold
- 人工 review + commit（v1 紀律：不自動 commit）
