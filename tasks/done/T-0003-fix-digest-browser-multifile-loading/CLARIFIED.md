> Parent: T-0002

# CLARIFIED: T-0003 fix digest browser multifile loading

## Why（為什麼開 follow-up）

T-0002 SPEC 第 29 行寫「一次選 1 或 2 個 .md 檔」— 設計是**單次 picker 多選 concat**，沒涵蓋「分次選累加」。

使用者實際操作後追加需求：第二次點 file picker 不應蓋掉第一次的內容，要 stack 累加。並順帶要「清除全部」按鈕作為手動 reset 路徑。

按 CLAUDE.md「Task Patch 流程」開 follow-up，不在原 task 內修 SPEC。

## 範圍

延伸 T-0002 已實作的 `D:\agent-kanban-system\tools\digest-browser\index.html`，補三件事：

1. 分次選累加（picker + drag-drop 兩入口）
2. 同 sid 去重：新覆蓋舊
3. 新增「清除全部」按鈕

不重做 T-0002 已有功能（parser / pagination / search / filter / 18 AC 等）。

## Invariants

沿用 T-0002 全部 INV-1 ~ INV-5（雙擊離線、無外部、source read-only、缺段不 crash、refresh 重來），並補：

- **INV-6 累加狀態僅在 memory**：累加結果不寫 storage（沿 INV-5 精神，refresh 即清空）
- **INV-7 累加不破壞既有 AC**：T-0002 的 18 條 AC 在累加後仍須成立（如倒序、pagination 邊界、search AND filter）

## 累加邏輯（已對齊使用者）

### 入口

- **File picker（`<input type="file" multiple>`）**：使用者每次點選 N 檔 → 把這次選的 N 檔讀完，逐筆 digest **append 到既有 list 後**，再走去重 → 重新 sort → 重算 filtered → renderAll
- **Drag-drop**：行為與 picker **完全一致**（也累加，不取代）

### 去重規則

- **以 sid 為 key**，**新覆蓋舊**（latest wins）
- 同 sid 出現 → 用最新一筆 digest 物件取代舊的，**舊的剔除**
- 比對是 `digest.sid` 字串完全相等（含 synthesized `gen-N` 也算）

### 重複載入同檔案

使用者再選一次同一個 .md 檔 → 等同把該檔所有 sid 重新讀一遍 → 全部觸發「新覆蓋舊」→ 視覺上等同 refresh 該檔（但不影響其他已載入檔）。

### 排序穩定性

累加後重新排序整個 list（沿 T-0002 sortDigestsDesc：timestamp 倒序，tie 用 sid 倒序）。**不保留「載入順序」**作為次序語意 — sort 一律以 digest 自身屬性為準。

## 「清除全部」按鈕

- 位置：toolbar（與 file picker 同一列即可，spec-writer 拍板）
- 行為：點擊 → `appState.digests = []`、filtered 重算（變空）、page 重置 1、search 與 filter 不重置（保留 UI 輸入，但對空 list 無作用）
- 視覺：與其他 toolbar 按鈕風格一致
- 無確認對話框（單擊即清，符合「refresh 即重來」精神）

## Acceptance（雛形，spec-writer 細化）

- [ ] **AC-N1 分次累加（picker）**：先選檔 A（10 筆）→ 顯示 `Total: 10`；再選檔 B（20 筆）→ 顯示 `Total: 30`；list 含 A+B 全部
- [ ] **AC-N2 分次累加（drag-drop）**：拖檔 A 進來（10 筆）→ Total: 10；拖檔 B（20 筆）→ Total: 30
- [ ] **AC-N3 picker + drag 混用**：picker 選 A，drag 放 B → Total = A+B
- [ ] **AC-N4 同 sid 去重新覆蓋舊**：載入檔 X（含 sid `abc123`，timestamp 為 T1）→ 再載入檔 Y（含 sid `abc123`，timestamp 為 T2 ≠ T1）→ list 中該 sid 只剩 1 筆，timestamp = T2
- [ ] **AC-N5 重複載入同檔等同 refresh 該檔**：載入檔 A → 再次載入檔 A（內容未變）→ Total 不變、list 內容不變
- [ ] **AC-N6 累加後排序仍倒序**：累加後第 1 頁第 1 筆 timestamp ≥ 第 2 筆 ≥ ... ≥ 第 20 筆
- [ ] **AC-N7 累加後 pagination 邊界**：累加導致頁數變化（如從 1 頁變 3 頁）後，邊界按鈕 disable 行為仍正確
- [ ] **AC-N8 清除全部按鈕**：點「清除全部」→ Total: 0、list 空、page 1/1、提示「請先選擇 digest md 檔」狀態
- [ ] **AC-N9 清除全部不重置 UI 輸入**：點清除前先打 search query「test」→ 點清除 → search 框內仍是「test」（list 空所以無視覺差異，但 input 值不清）
- [ ] **AC-N10 T-0002 全 18 條 AC 在累加後仍 hold**：spec-writer 標明哪些 AC 需要重驗（如 AC-2 baseline 改成「載入 N 檔後 Total 等於各檔 grep ### 總和」）
- [ ] **AC-N11 INV-2 離線仍 held**：新增 code 不引入任何外部 request

## Out of scope

- 「移除單一檔案」UI（只支援「全部清除」，不支援個別移除）
- 已載入檔案的視覺列表（toolbar 不顯示「目前已載入 A.md、B.md」這類清單 — 若 spec-writer 認為需要可在 SPEC 提，但 CLARIFIED 不硬性要求）
- 累加的 undo / redo
- 累加時的合併衝突 UI（直接 latest-wins 不問）
- 載入順序作為次序語意（一律用 digest 自身 timestamp + sid sort）
- 自動偵測「使用者剛剛載過此檔」並提醒（行為直接是 latest-wins 覆蓋）
- 修改 T-0002 已實作的 AC 行為（如改變 PAGE_SIZE、改變 markdown subset 規則）
- 持久化（INV-5 / INV-6 已明禁）

## 不可委派決策（無）

本 task 無 auth / RBAC / secret / DB migration / 外部 API 契約 / cache / index 設計議題。純前端 state 邏輯，spec-writer 可直接拆 SPEC。

## Open questions（spec-writer 拍板）

| Open | 描述 | spec-writer 拍板提示 |
|---|---|---|
| 累加邏輯內部結構 | 用 `appState.digests` array 直接 push 後去重，還是用 `Map<sid, digest>` 維護 | spec-writer 自決，挑單一 source of truth 即可 |
| 「清除全部」按鈕的視覺位置 | toolbar 哪一段、跟 file picker 距離多近 | spec-writer 自決，符合一致風格即可 |
| Drag-drop 累加時的 visual feedback | 是否在 overlay 顯示「將累加 N 個檔」之類訊息 | spec-writer 自決，極簡 OK |
| 同 sid 去重的 visual feedback | 是否提示「N 筆被覆蓋」 | 預設**不提示**（latest-wins 靜默），若 spec-writer 認為必要可加，CLARIFIED 不硬性要求 |

## 相依

- **Parent**：T-0002（必須先 done — index.html 已存在才能加邏輯）
- **無其他外部 blocker**

## 預估規模

- 預估動到的檔：僅 `tools/digest-browser/index.html`（modify）
- 預估新增 JS 行數：~50-80 行（accumulate / dedup / clear-all button + handler）
- 規模等級：**S-M**（spec-writer 細化）
