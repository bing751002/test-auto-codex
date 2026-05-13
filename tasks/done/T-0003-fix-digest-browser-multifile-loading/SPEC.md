# Task: T-0003 fix digest browser multifile loading (累加 + 去重 + clear-all)

> Parent: T-0002（必須先 done）

## Why

- 來源：`tasks/in-progress/T-0003-fix-digest-browser-multifile-loading/CLARIFIED.md` 全文
- T-0002 SPEC 第 29 行寫「一次選 1 或 2 個 .md 檔」設計為**單次 picker 多選 concat**；使用者實操後追加：第二次點 picker / drag-drop 應**累加**不應蓋掉，且需手動「清除全部」reset 路徑
- 走 CLAUDE.md「Task Patch 流程」，不在 T-0002 內改 SPEC

---

## 涉及模組

- 修改：`D:\agent-kanban-system\tools\digest-browser\index.html`（既有 624 行單檔，新增 ~50-80 行 JS + 1 個 button 元素 + 少量 CSS gap）
- **不動** T-0002 全部 18 條 AC 對應邏輯（parser / markdown / pagination / filter / search / sort 不改）
- **不動** `D:\obsidian\ehsn\session-digests.md`、`session-digests-archive.md`（INV-3 沿用）

### Invariants

沿用 T-0002 全部 INV-1 ~ INV-5：

- **INV-1**: 雙擊 `index.html` 在 Chrome / Edge / Firefox 即可開啟，無安裝
- **INV-2**: 完全離線（無 CDN / npm import / fetch / 外部 request）
- **INV-3**: 不修改 source md 檔
- **INV-4**: 段落缺漏不能 crash
- **INV-5**: refresh 即重來，不持久化

新增：

- **INV-6**: 累加狀態僅在 memory（沿 INV-5 精神，refresh 後 `Map` 即空）
- **INV-7**: 累加不破壞 T-0002 既有 AC（具體重驗清單見 AC-N10）

---

## Open 段落拍板（spec-writer 決定）

| Open 項 | 決定 | 理由 |
|---|---|---|
| 累加邏輯內部結構 | **`Map<sid, digest>` 作為單一 source of truth**：新 state `appState.digestMap = new Map()`，取代 `appState.digests` array 的「擁有者」角色 | (1) dedup 邏輯**內建**於 `Map.set(sid, digest)` — latest-wins 是 Map 預設語意，不需先 push 再掃 array splice；(2) O(1) 覆蓋；(3) 渲染時 `Array.from(digestMap.values())` 一次轉 array 後 sort，與既有 `sortDigestsDesc` / `recomputeFiltered` 完全相容（其下游讀 `appState.digests` 不需改），單一同步點 |
| 「清除全部」按鈕視覺位置 | toolbar 內，緊鄰 `<label class="file-label">` 之後（與 file picker 同一列），button label 文字：`Clear all` | 符合 toolbar 一致風格（既有 button class），位置語意上「載入」「清除」相鄰直覺 |
| Drag-drop 累加 visual feedback | **保留現有 overlay 文字** `Drop .md files to load` 不改 | CLARIFIED 提示「極簡 OK」；改成「將累加 N 個檔」需偵測 dragenter 階段 file count（drag 階段 Chrome 不一定可拿到），增實作複雜度但無 acceptance 價值 |
| 同 sid 去重 visual feedback | **靜默**，不提示「N 筆被覆蓋」 | CLARIFIED 預設不提示；視覺差異 = 新 timestamp / 新 body 取代舊，使用者一眼可見 |

---

## Input

### Runtime input（使用者操作）

延伸 T-0002 既有兩個入口：

1. **File picker** `<input type="file" id="file-input" multiple accept=".md,...">`（既有 L64）
   - 使用者每次點選 1..N 檔，每次選都觸發 `change` event → `handleFiles(fileList)`（既有 L601-603）
2. **Drag-drop** 全頁 overlay drop（既有 L592-598 window `drop` listener → `handleFiles(e.dataTransfer.files)`）

新增第三個入口：

3. **`Clear all` button**（新增）
   - 點擊 → 清空 `digestMap` + reset page + filter UI 值保留 + 重渲染

### Parser input

不變（沿用 T-0002 `splitDigests(fullText)` 與 `parseHeader(line)`）。新增累加層在 `splitDigests` **下游**操作（拿回 parsed digest array → 逐筆塞進 `digestMap`）。

### Parsed digest object schema

不變（沿用 T-0002 第 53-62 行 schema：`sid, timestamp, timestampMs, project, headerRaw, rawBody, fullText`）。

---

## Output

### State 結構變更

`appState`（既有 L92-99）新增 / 改動：

```js
const appState = {
  digestMap: new Map(), // 新增：key = sid (string), value = digest object（單一 source of truth）
  digests: [],          // 保留：每次操作後從 digestMap.values() 同步出來，供下游 sort/filter/render 不變
  filtered: [],         // 不變
  page: 1,              // 不變
  projectFilter: ALL_PROJECTS,  // 不變
  searchQuery: '',      // 不變
  filesLoaded: 0,       // 語意改為「累計成功讀入的檔次數」（每次 handleFiles 成功時 +N，clear 時歸 0）
};
```

`digests` array 不刪除（下游 `recomputeFiltered` / `renderList` / `rebuildProjectOptions` 都讀它），但**寫入點只剩一處**：`syncDigestsFromMap()`（新增函式，從 Map 拍出 sort 後 array）。

### 成功

- 累加後：toolbar `counts` 顯示 `Total: <map.size> digests  Page: <p>/<totalPages>`（既有 `renderCounts` L360-374 邏輯不變，自動反映新 size）
- 清除後：`counts` 回到 `No files loaded` 狀態（既有 L361-364）、list 區顯示空狀態提示「Please choose digest .md file(s) to begin.」（既有 L378-384）

### 失敗

| 錯誤情境 | 行為 |
|---|---|
| picker / drop 選了非 .md / parse 出 0 筆 | 既有 `showError('No digest entries detected...')` L547 行為不變；**既有 digestMap 不受影響**（不清空舊累加） |
| 單檔 `FileReader.onerror` | 既有 L525-531 顯示紅字錯誤 + 其他成功檔仍 merge；累加層在 `finishLoad` 之後 — 不變更其錯誤路徑語意 |
| 點 Clear all 時 digestMap 已空 | no-op（仍重渲染回空狀態，不報錯） |

---

## Acceptance（每條 = 一個可手動驗證的 test）

### 累加（新增 AC）

- [ ] **AC-N1 分次累加（picker）**：開啟乾淨頁面 → 點 `Choose .md files` 選 `session-digests.md`（baseline N1 筆）→ 等待渲染完成、`counts` 顯示 `Total: N1 digests` → 再次點 `Choose .md files` 選 `session-digests-archive.md`（baseline N2 筆）→ `counts` 應顯示 `Total: N1+N2 digests`（前提：兩檔無 sid 重複；若有重複以 AC-N4 為準）
- [ ] **AC-N2 分次累加（drag-drop）**：開啟乾淨頁面 → 拖 `session-digests.md` 進來 → `Total: N1` → 拖 `session-digests-archive.md` 進來 → `Total: N1+N2`
- [ ] **AC-N3 picker + drag 混用**：picker 選 `session-digests.md` → `Total: N1` → drag-drop `session-digests-archive.md` → `Total: N1+N2`；反向（先 drag 後 picker）結果相同
- [ ] **AC-N4 同 sid 去重新覆蓋舊（latest wins）**：人工準備兩個小 .md 檔：
  - 檔 X 含 `### 2026-01-01 00:00 [test] <!-- sid:abc123 -->` + body 「v1」+ `---`
  - 檔 Y 含 `### 2026-02-02 12:00 [test] <!-- sid:abc123 -->` + body 「v2」+ `---`
  - 載入 X → `Total: 1`，卡片顯示 `2026-01-01 00:00` + body 「v1」
  - 再載入 Y → `Total: 1`（不是 2），唯一卡片顯示 `2026-02-02 12:00` + body 「v2」
- [ ] **AC-N5 重複載入同檔等同 refresh 該檔**：載入 `session-digests.md` → `Total: N1` → **同一檔再選一次 / 拖一次**（內容未變）→ `Total: N1`（所有 sid 全部被相同內容覆蓋，視覺等同無變化）
- [ ] **AC-N6 累加後排序仍倒序**：執行 AC-N1 結束後（N1+N2 筆）→ 第 1 頁第 1 筆 timestamp ≥ 第 2 筆 ≥ ... ≥ 第 20 筆（沿 T-0002 AC-3 規則，但驗的是「累加後」非「單批載入」）
- [ ] **AC-N7 累加後 pagination 邊界**：累加導致頁數變化（如從 1 頁 → 多頁）後，邊界按鈕 disable / enable 仍符合 T-0002 AC-4 規則（第 1 頁 `< Prev` disabled、最後一頁 `Next >` disabled）。具體：先載一個只含 5 筆 digest 的小檔 → 在第 1 頁 `Next >` disabled（因 5 < 20）；再載入 `session-digests.md`（N1 筆）→ 頁數變多 → `Next >` 變 enabled
- [ ] **AC-N8 Clear all 清空狀態**：在已載入累加狀態（任意 `Total > 0`）下點 `Clear all` button → (a) `counts` 顯示 `No files loaded`；(b) list 區顯示「Please choose digest .md file(s) to begin.」空狀態；(c) `digestMap.size === 0`（DevTools 內部觀察，非必要但可作為實作 hint）；(d) `appState.page === 1`
- [ ] **AC-N9 Clear all 不重置 UI 輸入**：先打 search input 「test」+ 從 project dropdown 選某個 project P → 點 `Clear all` → search 輸入框值仍是「test」、dropdown 選擇仍是 P（list 為空所以無視覺結果差異，但 input value / select value 不變）
- [ ] **AC-N10 T-0002 既有 AC 在累加後 hold**：以下 T-0002 AC 須**重驗於累加情境**：
  - **AC-2（重新定義 baseline）**：載入 N 檔後 `Total` 應等於「各檔內 `grep -c '^### '` 之和」**減去**「跨檔同 sid 重複數」。對使用者實際的 `session-digests.md` + `session-digests-archive.md` 兩檔，若兩檔無 sid 交集（v1 假設），等同 T-0002 AC-2 的 60 筆
  - **AC-3 倒序**：累加後仍倒序（同 AC-N6）
  - **AC-4 pagination 邊界**：累加後新 totalPages 下邊界 disable 正確（同 AC-N7）
  - **AC-5 頁碼點擊**：累加導致頁數增減後，點頁碼仍正確跳轉並 slice 對應筆數
  - **AC-6 project filter**：累加後 project dropdown 重建（既有 `rebuildProjectOptions` L327-350 已涵蓋），filter 對累加後 list 仍正確
  - **AC-7 search**：累加後 search 對全部 `digestMap` 內容仍 case-insensitive 命中
  - **AC-8 search + filter = AND**：累加後仍 AND
  - **AC-9 清空回全集**：累加後清空 search + filter 回 `(all)`，list 回到 `Total: <map.size>` 全集
  - **AC-18 refresh 不持久化**：F5 後 `digestMap` 應為空（INV-6）
  - **不受累加影響、不需重驗**：AC-1（離線開啟）、AC-10/11/12/16（markdown 視覺）、AC-13（HTML 註解過濾）、AC-14（`---` 不渲染）、AC-15（缺段不 crash）、AC-17（source 未變動 — code 仍只走 `readAsText`）
- [ ] **AC-N11 INV-2 離線仍 hold**：新增的累加 / Clear all 邏輯不引入任何外部 request（DevTools Network 0 外部 request；grep code 無 `https?://` / `fetch(` / `<script src=` / `<link href=` 外部資源新增）

---

## 動到 index.html 的具體位置

> Coder 改動時嚴格只動下列區塊，**不擾動** T-0002 其他既有邏輯（parser / markdown / pagination / sort / filter 全保留）。

### A. CSS（小）

- **新增**：`#clear-all-btn` 不需特殊樣式，沿用 `.toolbar button`（既有 L18-20）— 0 行 CSS 修改即可（純複用 class）
- 可選：toolbar 內 button 與 file-label 之間若視覺擠，加 1 處 margin — coder 視實機判斷，**非強制**

### B. HTML toolbar（L61-73 內）

- **新增 1 行**：在既有 `<label class="file-label">...</label>` 結束標籤（L65）之後、`<input type="search" id="search-input" ...>`（L66）之前**插入**：
  ```html
  <button type="button" id="clear-all-btn">Clear all</button>
  ```
- 不改既有任何 toolbar 元素的 id / class

### C. JS state（L87-99 內）

- **新增** `digestMap` field（如 Output 段所述）
- `digests` 欄位**保留**（下游讀它，避免大改）；改為「derived from digestMap」

### D. JS DOM refs（L101-111 內）

- **新增 1 行**：
  ```js
  const $clearBtn = document.getElementById('clear-all-btn');
  ```

### E. 新增函式 `syncDigestsFromMap()`（建議放在「Filter / search / sort」區塊 L301 之前 或 緊跟 `sortDigestsDesc` 之後）

行為：
```
appState.digests = Array.from(appState.digestMap.values());
sortDigestsDesc(appState.digests);
```

### F. 修改 `finishLoad(texts, anyError)`（既有 L536-551）

當前邏輯（L538-542）：
```
const parsed = splitDigests(merged);
sortDigestsDesc(parsed);
appState.digests = parsed;
appState.filesLoaded = texts.filter(Boolean).length;
appState.page = 1;
```

改為：
```
const parsed = splitDigests(merged);
// 累加 + 去重：逐筆塞進 digestMap（latest wins by sid）
parsed.forEach(function (d) { appState.digestMap.set(d.sid, d); });
syncDigestsFromMap();                              // digests = Array.from(map.values()) + sort
appState.filesLoaded += texts.filter(Boolean).length;  // 累加計次（不重置）
appState.page = 1;
```

- `appState.filesLoaded` 由「覆蓋賦值」改為「`+=`」，語意為「累計成功讀入檔次數」（drives `renderCounts` 的「No files loaded」判斷 — 任何 > 0 即非空狀態）
- 其餘 L544-550（`rebuildProjectOptions` / `recomputeFiltered` / `showError` / `$hint.hidden` / `renderAll`）**不變**

### G. 新增函式 `clearAll()`

行為（建議放在 `finishLoad` 之後 或 「File loading」區塊內）：
```
appState.digestMap.clear();
appState.digests = [];
appState.filtered = [];
appState.filesLoaded = 0;
appState.page = 1;
// 注意：appState.searchQuery / projectFilter 故意不重置（AC-N9）
rebuildProjectOptions();   // dropdown 重建為只剩 (all)，但保留 select value（若舊值已不存在，rebuildProjectOptions 既有 L344-348 已處理 fallback 到 ALL）
recomputeFiltered();
$hint.hidden = false;      // 重新顯示 "Tip: select one or both..." 提示
clearError();
renderAll();
```

**保留 search input UI value 不清**：不寫 `$search.value = ''`、不寫 `appState.searchQuery = ''`、不寫 `appState.projectFilter = ALL_PROJECTS`（這是 AC-N9 的硬要求 — UI 輸入保留）。

> 細節：`rebuildProjectOptions` 在 `digestMap` 空時會建出只有 `(all)` 的 dropdown；若使用者先前選了某 project P 而清除後 P 已不存在，既有 L344-348 fallback 會把 `appState.projectFilter` 重置為 ALL_PROJECTS — **這違反 AC-N9 的「dropdown 選擇不重置」**。Coder 需在 `clearAll` 中**繞過此 fallback**：用 `$projectSel.innerHTML = ''` + append `(all)` 但**不再呼叫 `rebuildProjectOptions`**（因為它會把已不存在的 P 重置）；或在 `clearAll` 中暫存 `appState.projectFilter` 並在 rebuild 後強制 `$projectSel.value = <暫存值>`（即使 option 不存在 — 瀏覽器會 fallback 顯示但不觸發 change event，state 仍保留）。**Coder 拍板實作細節，AC-N9 驗 select.value 字串相等舊值即可**。

### H. JS event wiring（既有 L600-617 區塊末尾加 1 處 + handleFiles 開頭微改）

- **新增** `$clearBtn` 的 click listener：
  ```js
  $clearBtn.addEventListener('click', clearAll);
  ```
- `handleFiles(fileList)`（L510-534）**不需改動**內部邏輯 — `finishLoad` 的變更已涵蓋累加；只需確認 `$fileInput.value` 在 `change` 後是否需 reset 以允許「再選同一檔」觸發 change event：HTML5 `<input type="file">` 若使用者再選**同一檔案**，部分瀏覽器（如 Chrome）的 `change` event **不會觸發**。為支援 AC-N5（重複載入同檔），**coder 需在 `handleFiles` 結尾 / 或在 `$fileInput change` listener 處理完後加** `$fileInput.value = ''` 來 reset picker 狀態。Drag-drop 路徑不受此影響（每次 drop 都觸發新 event）

---

## Out of scope

- 「移除單一檔案」UI（CLARIFIED 明禁，只支援 Clear all）
- 已載入檔案的視覺列表（toolbar 不顯示「目前已載入 A.md、B.md」）
- 累加的 undo / redo
- 累加時的合併衝突 UI（latest-wins 靜默）
- 載入順序作為次序語意（一律 timestamp + sid sort）
- 自動偵測「使用者剛剛載過此檔」並提醒（直接 latest-wins）
- 修改 T-0002 已實作的任何 AC 行為（PAGE_SIZE、markdown subset 規則、parser tolerance 等）
- 持久化（INV-5 / INV-6 明禁）
- 變更累加狀態的 visual feedback（如「N 筆被覆蓋」toast — CLARIFIED 預設不要）

---

## 預估動到的檔案

- `tools/digest-browser/index.html` (modify) — 新增約 50-70 行 JS / 1 行 HTML / 0 行 CSS（複用既有 class）

---

## 預估規模

- **S（< 200 行增量）** — confirm CLARIFIED 的 S-M 區間，實際 ~50-70 行 JS：
  - HTML toolbar button: 1 行
  - JS state field `digestMap` + `$clearBtn` ref: 2 行
  - `syncDigestsFromMap()`: ~3 行
  - `finishLoad` 改動: ~3 行差異
  - `clearAll()`: ~10 行（含 dropdown 處理細節）
  - `handleFiles` / `change` listener 加 `$fileInput.value = ''`: 1 行
  - event wiring: 1 行
  - 註解 / 空行 / 防呆: ~10-15 行
  - **總計**: ~30-40 行核心 + 註解 ~15-25 行 ≈ 50-70 行
- 不觸發「L 強制拆」門檻

---

## Dependencies

- **Parent**: T-0002（必須先 done — `index.html` 624 行已存在，本 task 為 patch）
- **無其他外部 blocker**
- **無 OPEN-ITEMS**（CLARIFIED 4 條 open 已在「Open 段落拍板」處理完畢）

---

## Baseline 數據（測試用）

- `session-digests.md`：30 筆（T-0002 SPEC L194 baseline，2026-05-12）
- `session-digests-archive.md`：30 筆（T-0002 SPEC L195 baseline）
- 兩檔 sid 是否有交集：**未驗證**；若無交集則 AC-N1/N10 的 N1+N2 = 60；若有交集則 < 60。Coder / 使用者實測時若發現 < 60，需用 `Select-String '<!-- sid:' | sort -u | wc -l` 算 union 數作為新 baseline，**這不算 AC fail**（latest-wins 是預期行為）
