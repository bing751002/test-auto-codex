# T-0002: Build Session Digest Browser (Static HTML)

- **Stage**: 0 — Clarified（待進 Stage 1）
- **Target repo**: 本 repo（agent-kanban-system）下開新目錄存放輸出檔，建議 `tools/digest-browser/`
- **Source data**:
  - `D:\obsidian\ehsn\session-digests.md`（887 行，現行 digest）
  - `D:\obsidian\ehsn\session-digests-archive.md`（834 行，archive）
  - 兩檔合計 1721 行
  - **Data 不進 repo** — HTML 在 runtime 由使用者用 File API 選兩個檔載入

---

## Why

使用者要一個能瀏覽過去 session digest 的本機網頁，方便回顧、搜尋、依專案分類。目前 digest 累積在 obsidian vault 兩個 md 檔，純文字滾動找不易。

---

## Source data 結構（spec-writer 必須認得這個格式）

每筆 digest 形如：

```
### YYYY-MM-DD HH:MM [project-tag] <!-- sid:xxx -->

**在做什麼**：...

**完成項目**：
- ...

**關鍵決策**：
- ...

**未完成**：
- [ ] ...

**Gotcha**：
- ...

**接續建議**：...

---
```

- `###` 為 digest 起始標題
- `[project-tag]` 為 project 分類 key（例：`pipeline-kit`、`et-omniverse`、`daily-work`、`MyDB-projects-et-omniverse`）
- `<!-- sid:xxx -->` 為 session ID（HTML 註解，可當 anchor）
- `---` 為 digest 結束分隔線
- 內容段落 heading 不固定齊全（**在做什麼** 通常有，其他可選）

---

## Decisions（已對齊，spec-writer 不可推翻）

### D1. 純前端 + 本機開啟 + File API
- ✅ 採用：單一 HTML 檔（含 inline CSS + JS），用 `<input type="file" multiple>` 或 drag-drop 讓使用者每次選 1~2 個 md 檔
- ❌ 不用 build script、不用 local server、不用 fetch
- ❌ 不在 HTML 內嵌 md 內容（資料與程式分離，digest 一直在長）

### D2. 載入兩個 md 檔
- 使用者可一次選 1 個或 2 個檔。檔內容用相同 parser 處理，digest 合併進同一個 list
- 不用區分「哪個來自 main、哪個來自 archive」— 合併後一視同仁

### D3. 分頁模式：pagination
- ✅ 採用：傳統「上一頁 / 下一頁」+ 頁碼，每頁固定筆數
- 預設每頁 **20 筆**（spec-writer 在 SPEC 標 constant，未來易調）
- ❌ 不用 virtual scroll、不用 master-detail 兩欄

### D4. Project 分類：sidebar / dropdown filter
- 從每筆 digest 的 `[project-tag]` 抓 unique tag list
- UI 提供 multi-select 或 dropdown filter（spec-writer 在 SPEC 細化選哪個 widget）
- 選了 project filter 後，pagination 只算 filter 後結果

### D5. 搜尋：full-text，case-insensitive
- 搜尋框輸入字串，比對 digest 全文（含 heading、內容）
- 搜尋與 project filter 是 AND（兩個都要符合）
- 搜尋觸發 = input 變動即 filter（不用按 Enter）

### D6. 排序：時間倒序（新到舊）
- 從 `### YYYY-MM-DD HH:MM` 抓時間戳，倒序排
- 不提供使用者切換排序方向（保持簡單）

### D7. 技術棧：vanilla HTML + CSS + JS，**單檔**
- ❌ 不用 React / Vue / 任何 framework
- ❌ 不用 npm / build / bundler
- ❌ 不引外部 CDN（離線可用）
- ✅ 單一 `index.html`，所有 CSS / JS inline
- 樣式預設極簡（白底黑字 + 邊框 + 基本 hover），不指定設計風格

---

## Invariants

- **INV-1**: 雙擊 `index.html` 即可在 Chrome / Edge / Firefox 開啟，**無需任何安裝**
- **INV-2**: 離線環境可用（無任何外部 request）
- **INV-3**: 不修改 source md 檔（純讀取，使用者選檔後檔案不會被改）
- **INV-4**: Parser 必須容忍 heading 段落缺漏（**未完成** 沒有、**Gotcha** 沒有等情況不能 crash）
- **INV-5**: 重新整理頁面 = 全部重來（使用者要重選檔）— 不寫 localStorage、不持久化

---

## Acceptance（高層級，spec-writer 細化成可測 task）

1. 開啟 `index.html` 後出現「選擇 digest md 檔」入口（input 或 drop zone）
2. 選兩個 md 檔（main + archive）後，畫面顯示第一頁 20 筆 digest，**時間倒序**
3. 上一頁 / 下一頁 / 頁碼可切換，邊界（第 1 頁 / 最後一頁）按鈕正確 disable
4. Project filter 下拉 / 多選可選某個 tag，列表只顯示該 project 的 digest，pagination 重算
5. 搜尋框輸入 keyword，列表即時 filter（與 project 同時生效 = AND）
6. 清空搜尋 + 清空 project filter = 回到全部 digest
7. 每筆 digest 顯示原始 markdown 渲染後的樣子（粗體、列表、`---` 不算內容）
8. 用 `D:\obsidian\ehsn\session-digests.md` + `session-digests-archive.md` 實測，能正確 parse 出該檔內全部 digest（總數需在 SPEC.md 由 spec-writer 用 grep `^### ` 算出寫死）
9. 任一 digest 缺 `**未完成**` 或 `**Gotcha**` 段，不會 crash 且其他段正常顯示
10. 拔網路線 / 離線狀態仍可正常使用（INV-2）

---

## Open（spec-writer 處理）

- Markdown 渲染：要不要引一個小 lib（如 marked.js）內嵌進 HTML，還是手刻簡易 parser（粗體 / 列表 / heading）？傾向手刻最小可用（避免引外部 lib 違反 INV-2），spec-writer 自行判斷複雜度，若手刻成本太高（規模升 L）→ STOP
- Project tag 用 dropdown 還是 multi-select chips？spec-writer 在 SPEC 拍板（不影響 acceptance）
- 響應式：手機 view 要不要？**Out-of-scope**（D2 沒列）— 桌機可用即可
- 暗色模式？**Out-of-scope**

---

## Out of scope

- 編輯 / 新增 / 刪除 digest（純 read-only browser）
- 匯出 / 列印 / 分享連結
- 跨 session 持久化（重整就重來）
- 響應式 / 手機 / 暗色模式
- 任何後端 / server / DB
- Markdown 渲染所有 spec 細節（focus 在 digest 用到的子集：粗體、列表、heading、HTML 註解過濾）

---

## Stage 0 紀律（給 spec-writer 的硬約束）

> spec-writer 跨 disk Read `D:\obsidian\ehsn\session-digests.md` 是允許的（這是 data file，不是 implementation code，可讀來理解結構）。但回報只報 SPEC.md 路徑 + OK/STOP，不複述 digest 內容、不貼 md 段落。所有 parser 細節寫進 SPEC.md。

---

## 不需要進一步 Q&A 的判斷

- 業務規則：無（純工具）
- 邊界：已劃清（read-only、單檔、無 framework、File API）
- Acceptance：可測（雙擊開、選檔、分頁、filter、搜尋、parse 數量）
- 跨模組影響：無（獨立 HTML，不動 vault、不動其他 repo）

→ 可進 Stage 1。
