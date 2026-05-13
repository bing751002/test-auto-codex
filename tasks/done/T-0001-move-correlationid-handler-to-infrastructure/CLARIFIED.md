# T-0001: Move CorrelationIdPropagationHandler (+OutboundHttpLoggingHandler) from Common to Infrastructure

- **Stage**: 0 — Clarified（待進 Stage 1）
- **Target repo**: `D:\et-omniverse-code\`（**不是** 本 repo；agent-kanban 只負責規劃 / 派工）
- **Source phase**: ETOmniverse Phase 14（P1.0 foundation 收尾 — tech debt cleanup）
- **Phase 14 finding 編號**: 第 1 條（scope A）

---

## Background — 為什麼搬

### 主因（驅動 trigger）
`ETOmniverse.Common` csproj 出現對 `Microsoft.AspNetCore.Http` 的引用，違反 **「Common 可被任何層引用」** 的核心不變量。Common 是底層 csproj，不該 reference ASP.NET stack。

具體：`CorrelationIdPropagationHandler.cs` 內 `import Microsoft.AspNetCore.Http;` 把 ASP.NET 依賴傳染到 Common。

### 輔因（順帶修正的分層問題）
`HttpClient` `DelegatingHandler` 屬於「跨服務通訊細節」，依職責歸屬應在 Infrastructure，放 Common 是分層錯誤。

---

## Scope

### In-scope（atomic commit 一起搬）
- `CorrelationIdPropagationHandler.cs`
- `OutboundHttpLoggingHandler.cs`

兩個 handler 同檔案夾、同性質、同問題 — Phase 14 scope A 已綁定。

### Out-of-scope
- 不處理 Phase 14 其他 finding（後續 task）
- 不處理同檔案夾下其他非 `DelegatingHandler` 類別（如有）
- 不重構 handler 內部邏輯，只搬位置 + 改 namespace + 修 caller

---

## Decisions（已對齊，spec-writer 不可推翻）

### D1. namespace 改成 `ETOmniverse.Infrastructure.*`
- ✅ 採用：**完整搬遷**，namespace 跟著改
- ❌ 不採用：type-forwarding / Common 別名 / 兩階段遷移

**理由**：
- Phase 14 是 P1.0 foundation 收尾，第一個業務模組（Identity）還沒掛進來 → 外部 consumer 為零 → blast radius 最小時機
- 留「住 Infrastructure 卻叫 Common」會立刻變新 tech debt — Phase 14 目的就是收 tech debt，不該邊收邊長
- 兩階段遷移在「沒外部消費者」前提下 = over-engineering

### D2. 預期 caller 範圍
使用者預估：
- `ETOmniverse.Api.Program.cs` 的 DI 註冊（HttpClient handler builder 鏈）
- 1–2 處 unit test

spec-writer 必須用 Grep 驗證實際 caller 清單，發現超出預估 → 在 SPEC.md 明列、不要靜默吸收。

---

## Invariants（不變量 — Acceptance 必須驗）

- **INV-1**: `ETOmniverse.Common.csproj` 移除 / 保持沒有對 `Microsoft.AspNetCore.*` 的 `PackageReference` 或 `FrameworkReference`
  - 如果搬完後 Common 還有別處 reference ASP.NET → SPEC.md 必須標出，這次搬完還無法移除 ASP.NET ref（task 仍算完成，但留尾巴給後續 finding）
- **INV-2**: 兩個 handler 搬完後 namespace = `ETOmniverse.Infrastructure.{原 subnamespace}`
- **INV-3**: 所有 caller 的 `using` 更新到新 namespace，build pass
- **INV-4**: 既有 unit test（如有）跟著搬到 Infrastructure 對應 test project，namespace 同步更新
- **INV-5**: handler 內部行為 0 改動（pure move + rename，非 refactor）

---

## Acceptance（高層級，spec-writer 細化成可測 task）

1. 兩個 handler 檔案落在 Infrastructure 對應目錄，Common 內已刪除
2. `dotnet build` 全 solution pass
3. 既有 test suite pass（含搬過去的 test）
4. `git grep "ETOmniverse.Common.{舊 namespace 段}"` 在 src/ 下 0 hit
5. `Common.csproj` diff 顯示 ASP.NET reference 處理結果（移除 / 保留 + 理由）

---

## Open（spec-writer 去 et-omniverse repo 自己爬，不回流主 context）

- 兩個 handler 在 Common 的具體子目錄路徑
- Infrastructure 應對應落在哪個子目錄（找同性質 handler 或 networking 相關現有結構）
- 完整原 namespace（`ETOmniverse.Common.???`）
- 實際 caller 清單（Program.cs + test + 可能漏掉的）
- 既有 unit test 位置與 test project 名
- Common.csproj 中 ASP.NET reference 是否唯一被這兩個 handler 引入

---

## Stage 0 紀律（給 spec-writer 的硬約束）

> **artifact 換 context**：spec-writer 跨 disk Read `D:\et-omniverse-code\` 的 source，**不要把讀到的程式碼內容回傳到 main agent**。回傳只報 SPEC.md 路徑與 STOP / OK 狀態。具體 finding / code snippet 全部寫進 SPEC.md。

---

## 不需要進一步 Q&A 的判斷

- 業務規則：無（純技術 refactor）
- 邊界：已劃清（in/out scope 明列）
- Acceptance：可測（build / test / grep）
- 跨模組影響：使用者已預估 + spec-writer 會 grep 驗證

→ 可進 Stage 1。
