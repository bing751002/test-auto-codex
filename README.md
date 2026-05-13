# agent-kanban

個人 multi-agent 開發 kanban — meta-project，**主 session 只規劃、不寫 code**。

> Created: 2026-05-12

## 為什麼存在

單一窗口跟 AI 開發、需求丟進去自動派工、狀態下次 session 能續。

不是要重發明 GSD — GSD 是**手排**（每步驟使用者觸發），這裡要**自排**（使用者只丟需求，agent 自己跑 workflow，遇 checkpoint 才停下來問）。

## 痛點 → 對應

| 真實痛點 | 怎麼接 |
|---|---|
| Context switch 高頻、session 切回來忘記在做什麼 | task 狀態上 disk，下次 session `ls tasks/in-progress/` 直接續 |
| 主 session 寫 code 後 context 被細節塞滿，orchestrate 能力塌掉 | 主 agent 不寫 code，只切 task / 派工 / 追狀態 |
| 用 AI 開發要不斷自己派工、追進度 | 你只丟需求，主 agent 自動切 spec-writer / coder / reviewer subagent 並追結果 |
| **spec 寫完還要手動叫 agent 去執行** | **spec 完成 = trigger，主 agent 自動 spawn coder subagent 接著做** |
| GSD 每步要使用者手動觸發 | 改成「自排」：主 agent 自己跑 workflow，遇 checkpoint 才停下來問 |

## Mental Model

```
你 ──> 主 agent (協調者 / orchestrator)
       │
       │  Stage 0: 釐清模糊地帶 ← 跟你 Q&A，直到無 ambiguity（人工 checkpoint）
       │           輸出：tasks/<id>/CLARIFIED.md（澄清過的需求）
       │
       │  Stage 1: 派 spec-writer subagent
       │           輸入：CLARIFIED.md
       │           輸出：tasks/<id>/SPEC.md（L4 task spec，可執行）
       │
       │  Stage 2: 派 coder subagent（自動 trigger）
       │           輸入：SPEC.md
       │           輸出：commit / PR
       │
       │  Stage 3: 派 reviewer subagent（自動 trigger）
       │           輸入：PR diff
       │           輸出：approve / fail → 回 coder 修
       │
       ▼
   結果回主 agent → 回你
```

### 兩個核心原則

**1. 消除模糊優先於分派工作**

主 agent 的第一職責不是「分派任務」，是「**消除模糊地帶**」。任務分派是消除模糊後的副產品。

> 對應 vault [[ai-autonomous-dev-plan]] 反模式：「AI 寫 spec 給 AI 執行 → 認知套娃」。
> 這條只在「模糊地帶」成立。**已澄清的知識計畫 → 拆成可執行工作**是 AI 可以做的事。
> 紀律：spec-writer 的 input 必須是 CLARIFIED.md，不能是糙需求。

**2. Autonomous trigger（已澄清後）**

Stage 0 過了之後，Stage 1→2→3 自動串接。subagent A 完成 = 主 agent 看到 artifact → 自動 spawn subagent B。你不必每階段手動推進。

### 三條硬規則

1. **主 agent 不寫 code**。它只 plan / orchestrate。違反這條 = 主 session context 被細節污染、後續 orchestrate 能力塌掉。
2. **狀態全部上 disk**。主 session 不擁有工作記憶。task / spec / 進度 → 檔案，下次 session 直接續。
3. **單一主窗口**。使用者只跟主 agent 對話。不開多個並行 session 操作同 task。

### Task Schema

沿用 et-omniverse L1-L4 Task Spec（[`docs/AI-GUIDE.md`](../et-omniverse-code/docs/AI-GUIDE.md) 同款結構），不重發明。

## 已對齊的決策

| 決策 | 結論 | 日期 |
|---|---|---|
| Repo 位置 | 獨立 repo `D:\agent-kanban-system\`（不寄生 et-omniverse、不塞 vault） | 2026-05-12 |
| 視覺化層 | 砍掉，先純文字 kanban | 2026-05-12 |
| 主 agent 角色 | 只 planner / orchestrator，不寫 code | 2026-05-12 |
| Bootstrap 起手 | 主 session 親手寫第一版 spec-writer prompt（避免認知套娃） | 2026-05-12 |
| Stage 0 必須 | 主 agent 跟使用者 Q&A 澄清，產 CLARIFIED.md 才能進 Stage 1 | 2026-05-12 |
| spec-writer 紀律 | 只拆「已澄清的知識計畫」成可執行工作；不在模糊地帶寫 spec | 2026-05-12 |
| 跨 repo 工作模型 | 協調者只讀**結構面**（Glob/Grep/metadata），實作面由 subagent 隔離讀，回報走 artifact 不走 response 文字 | 2026-05-12 |
| Stage 0 前置驗證 | 使用者描述「現有問題」時，協調者必先 spot-check disk 確認 finding 仍成立，disk 與描述衝突時 trust disk 並回報，不寫 CLARIFIED | 2026-05-12 |
| coder v1 紀律 | 不自動 commit / 不擴 scope / 跑 acceptance 限自動驗子集 / 跨 disk 動 code 但回報走 IMPL-NOTES.md artifact 不複述 diff | 2026-05-12 |
| reviewer v1 範圍 | 只驗 SPEC 合規（AC / Invariants / Decisions / Scope / 紅線），不評 code 品質、不評 architecture、不重寫 code、不建議 SPEC 修法（BLOCK + finding 即可）| 2026-05-12 |
| Task patch 流程 | SPEC 漏 / 需求漂移 / reviewer BLOCK 一律開 follow-up task，原 task 收 done + CLOSING.md，不在原 task 內補 amendment | 2026-05-13 |

## 未解的問題

- **半自排 vs 全自排**：checkpoint 切在哪？目前未定
- **subagent 失敗 fallback**：subagent 跑壞了主 agent 怎麼接？未定
- **subagent 結果採信機制**：「read artifact」目前籠統，verify checklist 沒寫死
- **跨 task dependency**：A blocks B 怎麼追？未定
- **Cross-session resume**：中斷狀態判斷（如 in-progress 只有 CLARIFIED.md 沒 SPEC.md = 跑到一半還是 Stage 0 結束？）
- **與 et-omniverse GSD 關係**：agent-kanban 是 GSD 下層 / 平行 / 替代？dogfood T-0001 暴露

## 反模式

- ❌ 主 agent 偷偷自己改 code（即使「比較快」）
- ❌ 用未審 general-purpose subagent 產出核心 agent prompt（bootstrap 套娃）
- ❌ 把 task 狀態存在 session memory（換 session 就消失）
- ❌ 重發明 GSD / Kanban schema
