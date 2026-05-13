# Task: T-0002 build digest browser (single HTML, File API, offline)

## Why

- 來源：`tasks/in-progress/T-0002-build-digest-browser-html/CLARIFIED.md` 全文
- 使用者要本機可離線瀏覽過去 session digest（vault 中 `session-digests.md` + `session-digests-archive.md`），純文字滾動找麻煩，需 pagination / filter / search

---

## 涉及模組

- 本 repo 新建：`tools/digest-browser/index.html`（單檔，含 inline CSS + JS）
- **不動** `D:\obsidian\ehsn\session-digests.md`、`session-digests-archive.md`（INV-3 read-only）
- **不動** 任何其他既有檔

涉及的 invariant（CLARIFIED 已列）：
- INV-1: 雙擊 `index.html` 即可在 Chrome / Edge / Firefox 開啟，無安裝
- INV-2: 完全離線（**hard constraint** — 無任何外部 request / CDN / npm import）
- INV-3: 不修改 source md 檔
- INV-4: 段落缺漏不能 crash
- INV-5: refresh 即重來，不持久化

---

## Input

### Runtime input（使用者操作）

- `<input type="file" multiple accept=".md">` + drag-drop overlay，使用者一次選 1 或 2 個 `.md` 檔
- 用 `FileReader.readAsText(file, 'utf-8')` 讀檔內容為 string
- 多檔讀完後 concat 成單一 string 進 parser

### Parser input

- 單一 string，UTF-8，內含 0..N 筆 digest
- Digest schema（每筆）：

```
### YYYY-MM-DD HH:MM [project-tag] <!-- sid:HEX -->

**段落標題 1**：內容 / 列表
**段落標題 2**：...
...

---
```

- `###` 行為 digest 起點
- 結尾為下一個 `###` 之前的最後一個 `---` 行（或 EOF）

### Parsed digest object schema

```js
{
  sid: string,            // 從 <!-- sid:xxx --> 抽，若無則 fallback hash(timestamp+index)
  timestamp: string,      // "YYYY-MM-DD HH:MM"（原樣保留供顯示）
  timestampMs: number,    // Date.parse 後的 ms，供排序
  project: string,        // 從 [project-tag] 抽；若無則 "(no-tag)"
  rawBody: string,        // ### 之後到結尾 --- 之前的完整原始文字（含 heading 行）
  fullText: string,       // timestamp + project + rawBody 全部小寫 concat，給 search 用
}
```

---

## Output

### 成功

- 渲染後的 HTML 頁面，含：
  - 頂部 toolbar：file picker、search input、project filter widget、pagination control、digest 計數（filtered/total）
  - 主區：當前頁 digest 卡片列表（每卡片 = 一筆 digest 渲染後）
  - 底部：pagination control（重複頂部那組亦可，最少一組在頂部）
- 每筆 digest 卡片內容：
  - Header: `YYYY-MM-DD HH:MM` + `[project-tag]` chip + `sid` 小字（可選 anchor）
  - Body: rawBody 經 markdown subset renderer 渲染為 HTML

### 失敗

| 錯誤情境 | 行為 |
|---|---|
| 使用者沒選檔就互動 | toolbar 顯示提示「請先選擇 digest md 檔」，list 區空 |
| 選了非 `.md` 副檔名 | 不阻擋（File API 不一定可信副檔名），照樣讀入，parser 找不到 `### ` 起始 → 顯示「未偵測到 digest 格式」 |
| 檔案讀取失敗（FileReader.onerror） | 在 toolbar 區顯示紅字錯誤訊息，已成功讀入的另一檔仍可使用 |
| Parser 對單筆 digest 解析異常 | 該筆顯示為 raw text fallback（用 `<pre>` 包），不中斷其他筆 |
| 0 筆 digest 符合 filter | list 區顯示「沒有符合條件的 digest」，pagination 顯示 0/0 |

---

## Acceptance（每條 = 一個可手動驗證的 test）

- [ ] **AC-1 雙擊離線開啟**：在斷網狀態下，雙擊 `tools/digest-browser/index.html`，在 Chrome / Edge 任一可成功打開、UI 渲染完整、Console 無 network error 與 JS error
- [ ] **AC-2 選兩檔載入**：選擇 `D:\obsidian\ehsn\session-digests.md` + `session-digests-archive.md` 兩檔，頁面顯示 `Total: 60 digests`（**baseline 由 grep `^### ` 算出，main 30 + archive 30 = 60**）
- [ ] **AC-3 預設首頁 20 筆 + 時間倒序**：載入後第 1 頁顯示 20 筆，第一筆時間戳 ≥ 第二筆 ≥ ... ≥ 第 20 筆（倒序）
- [ ] **AC-4 pagination 邊界**：第 1 頁時「上一頁」disabled、「下一頁」enabled；最後一頁（60/20 = 第 3 頁）「下一頁」disabled、「上一頁」enabled；中間頁兩鈕皆 enabled
- [ ] **AC-5 頁碼點擊**：點頁碼 `2` 跳第 2 頁，URL 不變，list 替換為第 21~40 筆
- [ ] **AC-6 project filter**：從 project filter widget 選 `daily-work`，list 只顯示 project 為 `daily-work` 的 digest，計數從 `Total: 60` 變為 `Filtered: N / 60`，pagination 依 N 重算
- [ ] **AC-7 search**：search input 輸入 `cherry-pick`（無需按 Enter），list 即時 filter 為含此字串（case-insensitive）的 digest；輸入 `CHERRY-PICK` 結果相同（case-insensitive）
- [ ] **AC-8 search + filter = AND**：先選 project `FaceAI`，再 search `Jenkins`，list 只顯示同時符合兩條件的 digest
- [ ] **AC-9 清空回全集**：清空 search input + 將 project filter 設為「全部」，list 回到 60 筆全集（第 1 頁 20 筆，倒序）
- [ ] **AC-10 markdown 渲染子集（粗體）**：digest body 內 `**在做什麼**` 渲染為 `<strong>` 粗體（視覺驗證）
- [ ] **AC-11 markdown 渲染子集（列表）**：`- item` 行渲染為 `<ul><li>` 列表
- [ ] **AC-12 markdown 渲染子集（task list）**：`- [ ] item` 行渲染為帶 checkbox 視覺（disabled，純顯示）的 `<li>`
- [ ] **AC-13 HTML 註解過濾**：`<!-- sid:xxx -->` 不出現在渲染後文字內容中（可作為 sid attribute 但不顯示原 token）
- [ ] **AC-14 `---` 不算內容**：digest 之間的 `---` 分隔線不渲染進 digest body（每張卡片內不出現多餘水平線）
- [ ] **AC-15 段落缺漏不 crash**：人工構造一筆只有 `### 2026-01-01 00:00 [test] <!-- sid:t1 -->` + `**在做什麼**：x` + `---` 的 digest（無「完成項目」「Gotcha」等），parser 不丟錯，渲染正常顯示僅有的「在做什麼」段
- [ ] **AC-16 inline code 渲染**：`` `git checkout` `` 渲染為 `<code>` tag（monospace 視覺）
- [ ] **AC-17 source 檔未變動**：執行 AC-2 後，比對 `D:\obsidian\ehsn\session-digests.md` 與 `session-digests-archive.md` 的 mtime 與 SHA256，與載入前一致（INV-3）
- [ ] **AC-18 refresh 不持久化**：選檔載入後按 F5，頁面回到「請先選擇 digest md 檔」初始狀態（INV-5）

---

## Markdown subset spec（手刻 parser 要支援的全部 syntax）

只實作下列 8 條規則，其餘 markdown syntax **不支援**（出現時保留原樣字元，不 crash）：

| Rule | Input | Output |
|---|---|---|
| M1 粗體 | `**text**`（同一行內） | `<strong>text</strong>` |
| M2 inline code | `` `code` `` （同一行內） | `<code>code</code>` |
| M3 無序列表 | 以 `- ` 起首的行（連續多行為同一 `<ul>`） | `<ul><li>...</li>...</ul>` |
| M4 task list | 以 `- [ ] ` 或 `- [x] ` 起首的行 | `<li><input type="checkbox" disabled [checked]>...</li>`（仍在 ul 內） |
| M5 段落 heading 標識 | `**段落名**：` 在行首（如 `**在做什麼**：`） | `<strong>段落名</strong>：` + 後續同行內容 |
| M6 HTML 註解過濾 | `<!--` ... `-->`（同行或跨行皆過濾） | 渲染時剝除，但 parser 在抽 sid 時使用 |
| M7 分隔線 | `---` 單獨成行 | digest 邊界訊號，不渲染進 body |
| M8 空行 / 純文字 | 一般行 | `<p>` 包裹，連續純文字行合併為同一 `<p>`（換行用 `<br>`） |

**Escape 紀律**：所有從 md 抽出的 text 必須先 HTML escape（`& < > " '`），再應用 M1-M5 的標籤包裝。**禁用 `innerHTML` 接未 escape 字串**。

---

## Open 段落拍板（spec-writer 決定）

| Open 項 | 決定 |
|---|---|
| Markdown 渲染策略 | **手刻** parser（上方 M1-M8）。不引 marked.js / any lib（違反 INV-2）。預估 JS ≈ 150 行內可完成 |
| Project filter widget | **`<select>` dropdown**（含「全部」選項 + 各 unique tag）。理由：1 個 active filter 即可滿足 AC-6/AC-8；multi-select chips 複雜度高且 CLARIFIED 沒明確需求 |

---

## Out of scope

- 編輯 / 新增 / 刪除 digest（read-only）
- 匯出 / 列印 / 分享
- 跨 session 持久化、localStorage、URL state
- 響應式 / 手機 / 暗色模式
- Markdown 完整 spec（連結、圖片、表格、blockquote、code fence、嵌套列表、heading 1-6 之 #/##/####+ 等）
- 任何後端 / server / API
- 多語系 / i18n
- digest 內 `<!-- sid:xxx -->` 之外的 HTML 註解語意（一律過濾）
- 排序方向切換（CLARIFIED D6 已定死倒序）
- 每頁筆數 UI 切換（常數寫死 20，未來改常數即可）

---

## 預估動到的檔案

- `tools/digest-browser/index.html` (new) — 單檔，含 inline `<style>` + `<script>`
- （無 modify、無 test 檔 — 純前端 single HTML，acceptance 走人工驗證）

可選（不在 acceptance 內，spec-writer 不強制）：
- `tools/digest-browser/README.md`（極短使用說明，純 optional）

---

## 預估規模

- **M（200-500 行）**
- 拆解（單檔內邏輯區塊）：
  - HTML skeleton + toolbar + list + pagination markup: ~40 行
  - Inline CSS（極簡，白底黑字 + 卡片邊框 + chip + button + hover）: ~100 行
  - JS state（`appState = { digests, filtered, page, projectFilter, searchQuery }`）: ~20 行
  - JS file loader（FileReader + drag-drop）: ~50 行
  - JS markdown subset parser（M1-M8）: ~120 行
  - JS digest splitter（從整檔 string 抽 N 筆 digest object）: ~50 行
  - JS filter + search + sort: ~40 行
  - JS pagination + render: ~80 行
  - JS event wiring: ~30 行
- **JS 純行數預估 ≈ 390 行**，HTML + CSS ≈ 140 行，總計 ≈ 530 行
- **CLARIFIED D7 已硬要求單檔（不可拆 .js / .css 出來）**，故 single file 略超 500 屬合理結構性後果，不違反「L 強制拆」精神。Coder 在實作時若 JS 邏輯區塊超出 450 行 → 回報主 agent 評估是否拆 acceptance 子集

---

## Dependencies

- 無前置 task
- 無外部 blocker
- Coder subagent 尚未實作 → Stage 2 暫無法走（CLAUDE.md 已記）

---

## Baseline 數據（測試用，寫死）

- `D:\obsidian\ehsn\session-digests.md`：**30 筆** digest（`grep -c '^### '`）
- `D:\obsidian\ehsn\session-digests-archive.md`：**30 筆** digest（`grep -c '^### '`）
- 合計 **60 筆**，AC-2 期望值
- Baseline 取得日期：2026-05-12
- 注意：source 檔會隨時間增長，未來重跑 AC-2 需重算（acceptance 邏輯為「載入後計數 == grep 計數」而非「載入後計數 == 60」固定值）
