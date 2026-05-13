# IMPL-NOTES: T-0002

## Status
OK

## Files Touched
- `D:\agent-kanban-system\tools\digest-browser\index.html` (new) — 單檔 digest browser，含 inline `<style>` + `<script>`，無外部 request
- `D:\agent-kanban-system\tools\digest-browser\` (new dir) — 容納 index.html

未動：
- `D:\obsidian\ehsn\session-digests.md`（INV-3 read-only）
- `D:\obsidian\ehsn\session-digests-archive.md`（INV-3 read-only）
- 任何其他 repo / vault 檔

## What was done

### 架構
- 單一 HTML 檔，inline CSS + inline IIFE JS（嚴格 `'use strict'`）
- 全部 DOM API、無 framework、無外部資源（無 `<script src>`、無 `<link href>` 到外部、無 fetch、無 import）
- File API：`<input type="file" multiple accept=".md,text/markdown,text/plain">` + 全頁 drag-drop overlay（dragenter/dragover/dragleave/drop window listeners）
- 多檔合併：`FileReader.readAsText(file, 'utf-8')` × N，全部完成才進 parser；單檔失敗顯示紅字 error 但其他檔仍套用

### Parser 決策
- **Digest splitter**：逐行掃 `^### `，把該行起到下一個 `### ` 之前的所有行收集為 body。trailing 空行與 `---` 行剝除（避免 M7 在 renderer 處理時重複過濾）
- **Header parser**：寬鬆 tolerant — 時間戳 `YYYY-MM-DD HH:MM`（允許省略時分，fallback ms=0）；project tag 用 `\[([^\]]+)\]` 抓；sid 用 `<!--\s*sid:([^\s-]+)\s*-->` 抓，缺則 synthesized 為 `gen-N`，project 缺則 `(no-tag)`
- **時間排序**：以 `Date.parse('YYYY-MM-DDTHH:MM:00')`（當地時區）轉 ms，倒序；timestamp 相同則依 sid 倒序，stable

### Markdown subset (M1-M8) 決策
- **Pipeline**：raw body → strip HTML comments (M6) → 逐行分組（list 區塊 / paragraph 區塊 / 跳過 `---` 與空行）→ 每行 inline render
- **Inline render（M1, M2, M5）**：
  1. **先 escape**（`& < > " '`）— 全部 escape 後才操作
  2. 用 sentinel `CODE<n>` 把 `` `code` `` 內容暫存（M2），避免 bold regex 誤觸 backtick 內字串
  3. 對 escape 後的字串套 `**...**` → `<strong>...</strong>` （M1）。`\*\*` 在 escape 後仍是字面 `**`，安全
  4. M5（`**段落名**：`行首）自然被 M1 覆蓋 — 因為它就是 `**...**` 加冒號
  5. 還原 code sentinel 為 `<code>...</code>`（M2）
- **Lists（M3, M4）**：連續 `- ` 起首行收為一個 `<ul>`；行內以 `\[( |x|X)\]` 偵測 task list，輸出 `<input type="checkbox" disabled [checked]>`（不可互動，純顯示）
- **Paragraphs (M8)**：連續非空、非 list、非 `---` 行合併為一個 `<p>`，行間用 `<br>`
- **M7 `---`**：在 digest body 內**單獨成行**才當分隔線剝除；行內 inline 出現的 `---` 保留為純文字（escape 後）

### Escape 紀律
- `body.innerHTML = renderMarkdown(...)` 僅在 `renderMarkdown` 已對所有 inline text 跑過 `escapeHtml` 後才注入。`<strong>`、`<code>`、`<ul>`、`<li>`、`<input type="checkbox" ...>`、`<p>`、`<br>` 是 renderer 自己組的固定 tag。**沒有任何來自 md 的字串走過未 escape 的 `innerHTML` 路徑**
- header text（timestamp / project chip / sid）用 `textContent` 賦值，不走 innerHTML

### Filter / Search / Sort / Pagination
- `recomputeFiltered`：AND 邏輯（project filter + search.toLowerCase indexOf），search 對 `fullText`（lowercase 後預先 concat 過的 timestamp + project + body）做 indexOf — case-insensitive
- 排序在 `splitDigests` 完成後做一次 `sortDigestsDesc`，後續 filter 保留順序
- Pagination：常數 `PAGE_SIZE = 20`，總頁數 ≤ 9 顯示全部頁碼，否則 compact（首/末/cur±1，中間 `...`）。Prev/Next 在邊界 disabled

### State
- `appState = { digests, filtered, page, projectFilter, searchQuery, filesLoaded }`，每次 user 操作後 `recomputeFiltered → renderAll`
- 無 localStorage、無 URL state — refresh 即重置（INV-5）

## Acceptance Status

| AC | 狀態 | 備註 |
|---|---|---|
| AC-1 雙擊離線開啟 | [ ] **needs manual verify** | 程式無任何外部 request；需使用者實機雙擊 Chrome/Edge 驗證 |
| AC-2 選兩檔載入 60 筆 | [ ] **needs manual verify** | parser 對 `^### ` 計數，等同 `grep -c '^### '`；應顯示 `Total: 60 digests` |
| AC-3 首頁 20 筆倒序 | [x] passed by code review | sortDigestsDesc + PAGE_SIZE=20，首頁 slice [0,20) |
| AC-4 pagination 邊界 disable | [x] passed by code review | `disabled: cur <= 1` / `disabled: cur >= totalPages` |
| AC-5 頁碼點擊 | [x] passed by code review | `gotoPage(p)` clamp + renderAll |
| AC-6 project filter | [ ] **needs manual verify** | dropdown 從 unique tags 建立；filter 後重算 pagination |
| AC-7 search case-insensitive | [x] passed by code review | `searchQuery.toLowerCase()` + `fullText` 預 lowercase |
| AC-8 search + filter = AND | [x] passed by code review | `recomputeFiltered` 兩條件都需通過 |
| AC-9 清空回全集 | [x] passed by code review | filter `(all)` + 空 search → 全部 60 筆 |
| AC-10 粗體渲染 | [ ] **needs manual verify** | `<strong>` 視覺；regex `\*\*([^\s*][^*]*?[^\s*]|[^\s*])\*\*` |
| AC-11 列表渲染 | [ ] **needs manual verify** | `<ul><li>` 視覺 |
| AC-12 task list checkbox | [ ] **needs manual verify** | `<input type="checkbox" disabled>` 視覺 |
| AC-13 HTML 註解過濾 | [x] passed by code review | `replace(/<!--[\s\S]*?-->/g, '')` 在 markdown render 前剝除；sid 在 splitter 階段抽出後不會再進 body |
| AC-14 `---` 不渲染進 body | [x] passed by code review | splitter 已剝 trailing `---`；renderer 又對單獨成行 `---` 跳過 |
| AC-15 段落缺漏不 crash | [x] passed by code review | renderer 對缺段無 special handling，純走 paragraph/list 分組；無假設必有 heading |
| AC-16 inline code 渲染 | [ ] **needs manual verify** | `<code>` 視覺；regex `` `([^`]+)` `` |
| AC-17 source 檔未變動 | [x] passed by design | code 全程 `readAsText`（read only），無任何 write 操作 |
| AC-18 refresh 不持久化 | [x] passed by code review | 無 localStorage / sessionStorage / IndexedDB，state 在 IIFE 變數內 |

## Deviations from SPEC

- **規模**：實際 HTML+CSS+JS 624 行，SPEC 預估 ≈530 行，超約 +18%（< +30%）。主要在：
  - JS pagination compact mode（first/last/cur±1 + `...`） — SPEC 沒明列但 AC-4 要邊界、AC-5 要頁碼點擊，必須有頁碼 widget
  - drag-drop overlay 全頁覆蓋 + dragDepth 計數 — CLARIFIED 提到「drop zone」但未細化，採全頁 overlay 提升 UX
  - error display + hint text 額外幾行
- **SPEC Open 拍板**：完全遵守（手刻 parser、`<select>` dropdown）
- **未列在 SPEC 的小決策**：
  - drop overlay：全頁覆蓋（用 `dragenter`/`dragover`/`dragleave`/`drop` window-level，dragDepth 計數避免 leave 誤觸）
  - 排序 stable tie-breaker：用 sid 字典序倒序（同分鐘 digest 也有穩定順序）
  - sid 抽取 regex 排除 `-`：源 schema 為 hex，安全；若未來 sid 含 `-` 會被截短，目前不影響
  - synthesized sid：缺 sid 的 digest 給 `gen-0`、`gen-1`...（不影響 AC，純避免 React-style key warning）

無其他偏離。

## STOP Reason
N/A — Status = OK

## Build / Test 結果

無 build step（純 HTML，無 transpile）。無自動 test（acceptance 全為手動視覺驗證或人工載入測試）。

- 檔案產出：`tools/digest-browser/index.html`，624 lines
- 無執行 `npm install` / `dotnet build` / 其他 build 指令（單檔不需要）

## Manual Verification Steps（給使用者）

### AC-1 (雙擊離線開啟)
1. **拔網路線或關 WiFi**（或 DevTools → Network → Offline）
2. 在檔案總管雙擊 `D:\agent-kanban-system\tools\digest-browser\index.html`
3. 確認在 Chrome / Edge 中頁面 UI 完整出現（標題、toolbar、空狀態提示）
4. 開 DevTools → Console，**無紅色 error**
5. DevTools → Network，**無任何外部 request**（只有 file:// 自身）

### AC-2 (60 筆 baseline)
1. 點 toolbar 的 `Choose .md files`
2. 多選 `D:\obsidian\ehsn\session-digests.md` + `D:\obsidian\ehsn\session-digests-archive.md`
3. 應看到 toolbar 計數顯示 `Total: 60 digests  Page: 1/3`
4. 若數字不對，可在 PowerShell 用 `Select-String -Path "D:\obsidian\ehsn\session-digests.md","D:\obsidian\ehsn\session-digests-archive.md" -Pattern '^### ' | Measure-Object` 重算 baseline（source 檔可能已增長）

### AC-3 (倒序)
- 第一張卡的時間戳應 >= 第二張 >= ... >= 第二十張（YYYY-MM-DD HH:MM 字典序倒序即正確）

### AC-4 (邊界 disable)
- 載入後在第 1 頁，`< Prev` 鈕應為灰（disabled）
- 點到第 3 頁（最後一頁），`Next >` 應 disabled

### AC-5 (頁碼點擊)
- 點 toolbar 的 `2` 鈕（active 黑底白字），list 換成第 21~40 筆

### AC-6 (project filter)
- 從 `Project` dropdown 選 `daily-work`（或其他存在 tag）
- 計數應變為 `Filtered: N / 60`，list 只剩該 project 的 digest

### AC-7 (search)
- search 框輸入 `cherry-pick`，list 即時 filter
- 改輸入 `CHERRY-PICK`，結果應相同（case-insensitive）

### AC-8 (AND)
- 先選 project（如 `FaceAI` 若存在），再搜 `Jenkins`，list 應為兩條件交集

### AC-9 (清空回全集)
- 清空 search input + dropdown 切回 `(all)` → 計數回 `Total: 60`

### AC-10/11/12/16 (markdown 視覺)
- 隨意展開一筆 digest，目測：
  - `**在做什麼**`、`**完成項目**` 等粗體段落名應視覺粗體
  - `- item` 應為項目符號列表
  - `- [ ] item` / `- [x] item` 應為 disabled checkbox + 文字
  - `` `git checkout` `` 應為等寬字體 + 淺灰底

### AC-13 (HTML 註解過濾)
- 任何 digest body 內**不應出現** `<!-- sid:...-->` 原 token 文字（sid 顯示在 header `sid:xxx` 小字，那是抽出後重新組裝的，不算違反）

### AC-14 (--- 不算內容)
- 每張卡片內**不應出現**橫線分隔線（除卡片邊框）

### AC-15 (缺段不 crash)
- 可人工編一個小 .md 檔測試：
  ```
  ### 2026-01-01 00:00 [test] <!-- sid:t1 -->

  **在做什麼**：x

  ---
  ```
- 載入後該 digest 應正常顯示僅有的「在做什麼」段，無 console error

### AC-17 (source 未變動)
- 載入前後對兩個 md 檔取 `Get-FileHash -Algorithm SHA256`，應一致；`Get-ItemPropertyValue ... -Name LastWriteTime` 也應一致

### AC-18 (refresh 不持久化)
- 載入後 F5 → 應回到「Please choose digest .md file(s) to begin.」初始狀態

## Lines of Code

| 區段 | SPEC 預估 | 實際（含註解 / 空行） |
|---|---|---|
| HTML skeleton + toolbar + list + pagination markup | ~40 | ~50 |
| Inline CSS | ~100 | ~60（已精簡） |
| JS state | ~20 | ~14 |
| JS file loader (FileReader + drag-drop) | ~50 | ~80（drag overlay depth 計數較完整） |
| JS markdown subset parser (M1-M8) | ~120 | ~95 |
| JS digest splitter | ~50 | ~60 |
| JS filter + search + sort | ~40 | ~50 |
| JS pagination + render | ~80 | ~135（含 compact page list + 卡片 render） |
| JS event wiring + init | ~30 | ~30 |
| **總計** | **≈530** | **624** |

偏差約 +18%，CLARIFIED D7 硬要求單檔，SPEC 規模段亦預期 single-file 可能略超，符合「結構性後果」非「scope creep」。

## Next Steps（給主 agent + 使用者）

1. **使用者人工驗證**：跑上方 Manual Verification Steps（特別 AC-1 離線、AC-2 計數、AC-10/11/12/16 視覺）
2. **commit**：v1 紀律不自動 commit，使用者自行 `git add tools/digest-browser/index.html && git commit -m "..."`
3. **未來增量**（不在本 task scope）：若 source digest 數量大幅成長導致首頁渲染變慢（>1000 筆），可考慮 virtual scroll；目前 60 筆無此問題
4. **STOP** 觸發條件（未發生，列備查）：若手動驗證發現某條 AC 確實不過，回主 agent 評估是 patch（小修）還是回 Stage 1 修 SPEC
