# STOP: T-0001-move-correlationid-handler-to-infrastructure

## 觸發條件

**CLARIFIED.md 前提與 disk 事實衝突** — task 描述為「搬遷尚未進行，需從 Common → Infrastructure」，但 et-omniverse repo 當前 disk 狀態顯示**搬遷已實質完成**，所有 INV-1 ~ INV-5 與 Acceptance 1 ~ 5 均已滿足。

無可執行的 refactor 工作 → 不該產 SPEC。

對應 STOP rule：「需求本身就模糊 / 前提錯置 → Acceptance 寫不出可測且尚未滿足的條件」。

---

## Disk 事實（spec-writer 跨 disk 爬出）

### Handler 檔案實體位置（已在 Infrastructure）
- `D:\et-omniverse-code\src\backend\ETOmniverse.Infrastructure\Http\CorrelationIdPropagationHandler.cs`
  - `namespace ETOmniverse.Infrastructure.Http;`
  - 仍 `using Microsoft.AspNetCore.Http;`（IHttpContextAccessor，正當依賴）
- `D:\et-omniverse-code\src\backend\ETOmniverse.Infrastructure\Http\OutboundHttpLoggingHandler.cs`
  - `namespace ETOmniverse.Infrastructure.Http;`

### Common 內已無這兩個 handler
`D:\et-omniverse-code\src\backend\ETOmniverse.Common\` 子目錄完整清單：
- `Http\CorrelationIdConstants.cs`（保留，無 ASP.NET 依賴，非本 task scope）
- `Logging\*`（9 個檔，與本 task 無關）

無 `CorrelationIdPropagationHandler.cs` / `OutboundHttpLoggingHandler.cs`。

### Common.csproj 已無 Microsoft.AspNetCore.* reference
`D:\et-omniverse-code\src\backend\ETOmniverse.Common\ETOmniverse.Common.csproj` PackageReference 僅含：
- `Microsoft.Extensions.Configuration.Abstractions`
- `Microsoft.Extensions.Hosting`
- `Microsoft.Extensions.Logging.Abstractions`
- `Microsoft.Extensions.Options`
- `Serilog.*`

無 `Microsoft.AspNetCore.*` PackageReference / FrameworkReference。→ **INV-1 已滿足**。

### Caller 已全數使用新 namespace
| Caller | 路徑 | 引用方式 |
|---|---|---|
| DI 註冊 | `src\backend\ETOmniverse.Infrastructure\Http\HttpClientRegistrationExtensions.cs` | 同 namespace 直接使用，無 `using` 需要 |
| Test factory | `tests\backend\ETOmniverse.Infrastructure.Tests\HttpOutbound\HttpOutboundTestClientFactory.cs` | `using ETOmniverse.Infrastructure.Http;`（且檔內有註解：「Common.Http retained for CorrelationIdConstants only; handler types now live in Infrastructure.Http.」）|

**CLARIFIED D2 預估的 caller（`ETOmniverse.Api.Program.cs` DI 註冊）與實際不符**：DI 註冊已下放到 Infrastructure 自己的 `HttpClientRegistrationExtensions.AddOutboundHttpClients()`，Api 端不直接 reference 兩個 handler 型別。

### 遺留舊 namespace 引用：0 hit
Grep `ETOmniverse\.Common\.(Http|Logging|Networking)\.(CorrelationIdPropagationHandler|OutboundHttpLoggingHandler)` → 整 repo 0 hit。→ **INV-3 / Acceptance 4 已滿足**。

### Infrastructure.csproj 已有 ASP.NET reference
`FrameworkReference Include="Microsoft.AspNetCore.App"` — handler 內 `Microsoft.AspNetCore.Http` 依賴正當就位。

---

## Acceptance 對照（CLARIFIED 5 條全部已滿足）

| AC | 狀態 | 證據 |
|---|---|---|
| 1. handler 落 Infrastructure，Common 內已刪 | ✅ | Glob 結果 |
| 2. `dotnet build` 全 solution pass | ⚠️ 未實跑 | spec-writer 不執行 build；但 caller / namespace / csproj 三面一致，預期 pass |
| 3. test suite pass | ⚠️ 未實跑 | 同上 |
| 4. `git grep "ETOmniverse.Common.{舊 namespace 段}"` src/ 下 0 hit | ✅ | Grep 結果 |
| 5. `Common.csproj` 移除 ASP.NET ref | ✅ | csproj 內容確認 |

---

## 模糊地帶 / 待澄清項

- **Q1**: 這個 task 是否該標 done？搬遷工作已實質完成，spec-writer 視角無 refactor 可派給 coder。
- **Q2**: 若使用者意圖是「驗證搬遷已完成 + 跑一次 build/test 確認 AC-2/AC-3」，那 task 性質從 refactor 改成 verification — 這是 scope 重定義，超出 spec-writer 權限。
- **Q3**: CLARIFIED 寫 task 在 P1.0 收尾、Identity 還沒掛 — 但 disk 已有 `ETOmniverse.Domain`、`ExternalServices\SampleEcho` 等代碼。CLARIFIED 的 phase 描述可能已過時，task 來源是否仍是 Phase 14 finding？

---

## 建議

1. **主 agent 不要硬產 SPEC** — disk 狀態與 CLARIFIED 前提衝突屬 trust-disk 情境，先回使用者對齊。
2. **回使用者三選一**：
   - (a) 確認搬遷已在某次未追蹤的提交完成 → `git mv tasks/in-progress/T-0001 tasks/done/T-0001`，補一份 closing note 記錄 disk 驗證結果。
   - (b) 仍想跑 AC-2 / AC-3（`dotnet build` + test suite）做最終確認 → 重寫 CLARIFIED 為「verification-only」task（無 file move、只跑 build/test 並截錄結果），重新進 Stage 1。
   - (c) CLARIFIED 是依某個過時 snapshot 寫的，使用者其實要做的是別的事（如把 `CorrelationIdConstants` 也搬走、或處理其他 Phase 14 finding）→ 重寫 CLARIFIED。
3. **附帶觀察（不在 task scope，但可能值得開新 task）**：`CorrelationIdConstants` 仍在 `ETOmniverse.Common.Http`，被 Infrastructure handler、Api middleware、Infrastructure test 三處引用。若未來想徹底淨化 Common 的 Http 子 namespace 可考慮，但需另開 task 並評估 blast radius。
