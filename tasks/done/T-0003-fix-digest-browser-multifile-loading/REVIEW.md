# REVIEW: T-0003

## Verdict
APPROVE

## SPEC Compliance

### Acceptance Status
| AC | 狀態 | 備註 |
|---|---|---|
| AC-N1 picker 累加 | passed (code review) | finishLoad L549 `parsed.forEach(set)` + L551 `+=` 累加 |
| AC-N2 drag-drop 累加 | passed (code review) | drop L626 走同一個 handleFiles → finishLoad |
| AC-N3 picker + drag 混用 | passed (code review) | 兩入口共用 finishLoad，state 單一 |
| AC-N4 同 sid latest-wins | passed (code review) | Map.set L549 覆蓋語意 |
| AC-N5 重複載入同檔 | passed (code review) | L633 `$fileInput.value=''` reset，drop 天然觸發 |
| AC-N6 累加後倒序 | passed (code review) | syncDigestsFromMap L330-333 每次 sort |
| AC-N7 pagination 邊界 | passed (code review) | finishLoad → recomputeFiltered → renderPagination 流程未改 |
| AC-N8 Clear all 空狀態 | passed (code review) | clearAll L562-580 reset map+digests+filtered+page |
| AC-N9 Clear all 保留 UI 輸入 | passed (code review) | clearAll 無動 `$search.value` / `searchQuery`；projectFilter 用 prev 暫存 + 強制覆寫（L564,574-575） |
| AC-N10 T-0002 AC hold | passed (code review) | 既有函式（splitDigests/parseHeader/markdown/recomputeFiltered/renderCounts/renderList/renderPagination）未改動 |
| AC-N11 INV-2 離線 | passed (auto) | grep 0 命中 `https?://` / `fetch(` / `<script src` / `<link href` / `import ` / CDN |

### Invariants Check
| INV | 狀態 |
|---|---|
| INV-1 雙擊開啟 | held |
| INV-2 完全離線 | held |
| INV-3 source read-only | held |
| INV-4 缺漏不 crash | held |
| INV-5 refresh 重來 | held |
| INV-6 累加僅 memory | held（grep 0 命中 localStorage/sessionStorage/indexedDB/cookie） |
| INV-7 T-0002 AC 仍 hold | held |

### Decisions Check
| D | 狀態 |
|---|---|
| Map<sid,digest> 單一 source | followed |
| Clear all 緊鄰 file-label | followed（L66） |
| Drag overlay 文字不改 | followed |
| 同 sid 靜默覆蓋 | followed |

### Scope Check
- 越界檔：無

### 紅線 Check
- 觸及項目：無

## Findings
| Severity | Location | Issue |
|---|---|---|
| - | - | 無 |

## Build / Test 結果
- 純前端單檔；grep 驗 INV-2/INV-6 0 命中；innerHTML 使用點 4 個全為 T-0002 既有，T-0003 增量未新增

## Recommendation
- 告訴使用者 review 通過，請人工開啟 `tools/digest-browser/index.html` 跑 AC-N1..N11 視覺驗收後 commit（v1 紀律：不自動 commit）
