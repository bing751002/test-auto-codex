# Closing Note: T-0001

- **收法**: 標 done（搬遷已在某次未追蹤的提交於 et-omniverse repo 完成）
- **驗證來源**: spec-writer Stage 1 跨 disk 爬 `D:\et-omniverse-code\`，產出 STOP.md（同目錄）

## Disk 驗證對照（spec-writer 已驗，AC-1/4/5）

| AC | 狀態 | 證據（詳 STOP.md） |
|---|---|---|
| 1. handler 落 Infrastructure，Common 內已刪 | ✅ | `Infrastructure\Http\*Handler.cs` 存在，Common\Http\ 已不含 handler |
| 4. 舊 namespace src/ 下 0 hit | ✅ | Grep 整 repo 0 hit |
| 5. Common.csproj 已移除 ASP.NET ref | ✅ | csproj PackageReference 已無 `Microsoft.AspNetCore.*` |

## 未驗的尾巴（不阻擋收尾）

| AC | 狀態 | 說明 |
|---|---|---|
| 2. `dotnet build` 全 solution pass | ⚠️ 未實跑 | spec-writer 不執行 build；caller / namespace / csproj 三面一致，預期 pass。下次 et-omniverse 跑 build 時順帶確認 |
| 3. test suite pass | ⚠️ 未實跑 | 同上 |

## 附帶觀察（不開新 task，僅留紀錄）

`CorrelationIdConstants` 仍在 `ETOmniverse.Common.Http`，被 Infrastructure handler、Api middleware、Infrastructure test 三處引用。若未來想徹底淨化 Common.Http 子 namespace 可考慮另開 task，但需評估 blast radius。

## 流程觀察（給 agent-kanban 自己用）

- Stage 0 寫的 CLARIFIED 前提（「搬遷尚未進行」）與 disk 事實衝突 → 第一次 dogfood 暴露：**Stage 0 沒有 disk-state 驗證步**
- 主 agent CLAUDE.md 紀律「Glob/Grep metadata 確認結構」如果在 Stage 0 寫 CLARIFIED 前先跑一輪，就會發現搬遷已完成，不會丟到 Stage 1 才被 spec-writer 攔截
- 這是 spec-writer 紀律生效的證據（subagent 攔住前提錯誤、產 STOP 而非硬產 SPEC），不是失敗
