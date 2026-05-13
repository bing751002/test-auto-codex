# REVIEW: T-0002

## Verdict
APPROVE

## SPEC Compliance

### Acceptance Status
| AC | 狀態 | 備註 |
|---|---|---|
| AC-1 雙擊離線開啟 | manual pending | 視覺/環境驗證；code 側 INV-2 已 held |
| AC-2 60 筆 baseline | manual pending | 依 source 檔即時 grep 計數 |
| AC-3 首頁 20 筆倒序 | passed (code review) | sortDigestsDesc L317-324 + PAGE_SIZE=20 |
| AC-4 pagination 邊界 disable | passed (code review) | L453 `cur<=1`、L475 `cur>=totalPages` |
| AC-5 頁碼點擊 | passed (code review) | gotoPage L499-507 clamp + renderAll |
| AC-6 project filter | manual pending | dropdown 視覺 + 計數 |
| AC-7 search case-insensitive | passed (code review) | L303 query lower + L162 fullText lower |
| AC-8 search + filter = AND | passed (code review) | recomputeFiltered L305-308 兩條件皆需 true |
| AC-9 清空回全集 | passed (code review) | `__ALL__` + 空 q → filter 全 true |
| AC-10 粗體渲染 | manual pending | 視覺 |
| AC-11 列表渲染 | manual pending | 視覺 |
| AC-12 task list checkbox | manual pending | 視覺 |
| AC-13 HTML 註解過濾 | passed (code review) | L219 strip 在 render 前；body 不會再見 sid token |
| AC-14 `---` 不渲染 | passed (code review) | splitter L147-154 trim trailing + renderer L229 skip |
| AC-15 缺段不 crash | passed (code review) | renderer 無 per-section 假設 |
| AC-16 inline code | manual pending | 視覺 |
| AC-17 source 未變動 | passed (code review) | 全程 readAsText，無任何寫操作 |
| AC-18 refresh 不持久化 | passed (code review) | 無 localStorage/sessionStorage/indexedDB |

### Invariants Check
| INV | 狀態 |
|---|---|
| INV-1 雙擊開啟無安裝 | held (code review)；manual confirm 走 AC-1 |
| INV-2 完全離線 | held — 0 matches: `https?://` / `<script src=` / 外部 `<link href=` / `import` / `require(` / `fetch(` / `XMLHttpRequest` / `WebSocket` / CDN host |
| INV-3 source read-only | held — 無 `writeFile` / `createObjectURL` / `download=` / `showSaveFilePicker` |
| INV-4 段落缺漏不 crash | held — renderer 無 per-section 假設；try/catch fallback `<pre>` L422-431 |
| INV-5 refresh 重來不持久 | held — 無任何 storage API |

### Decisions Check
| D | 狀態 |
|---|---|
| Open: 手刻 markdown parser | followed — 無 lib import |
| Open: `<select>` dropdown filter | followed — L68-70 / L327-350 |

### Scope Check
- 越界檔：無（僅 `tools/digest-browser/index.html` + dir）

### 紅線 Check
- 觸及項目：無（未動 SPEC / CLARIFIED / .claude/agents/*）

## Findings
| Severity | Location | Issue |
|---|---|---|
| MINOR | IMPL-NOTES.md L36 vs index.html L285/294 | IMPL-NOTES 描述 sentinel 為 ` CODE<n> `（空白）；實際 code 用 `\x00CODE<n>\x00`（NUL）。功能等價且 NUL 更安全（不可能撞 user markdown），但文件描述失準 |

## Escape 紀律 Audit（SPEC 第 128 行）
- `innerHTML =` 出現 4 處：L333/L377/L437 賦值 `''`（清空，安全）；L425 `body.innerHTML = html`，`html` 來自 `renderMarkdown` → 每行先走 `escapeHtml` 再套標籤包裝，sentinel 為 NUL（非 user 可注入字元）→ **escape 紀律 held**
- header text（ts / chip / sid）均用 `textContent` 賦值 L408/412/416 — 符合 SPEC 紀律

## Build / Test 結果
- 無 build / transpile / install（純 HTML 單檔，符合 INV-1/INV-2）
- Static scan 結果見 Invariants Check（offline / read-only / no-storage 全 0 hit）
- 7 條 manual pending 列在 IMPL-NOTES Manual Verification Steps，已給操作步驟

## Recommendation
- 通知使用者執行 IMPL-NOTES Manual Verification Steps 中的 7 條 manual pending（AC-1/2/6/10/11/12/16）
- 全數視覺通過 → 使用者自行 `git add tools/digest-browser/index.html && git commit`（v1 紀律不自動 commit）
- 可選：請 coder 在後續 patch 時順手對齊 IMPL-NOTES L36 描述（NUL sentinel）— 非阻擋
