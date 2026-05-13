# Codex Stable Coordinator Tooling Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把目前靠文字規則運作的 agent-kanban，補成以 Codex 為前提、可重複執行、可驗證、可 resume 的穩定協調工具鏈。

**Architecture:** 保留既有 `tasks/` artifact 模型與 `.claude/agents/` 角色邊界，但新增 Codex 入口文件、Node.js CLI、模板、驗證器與測試。CLI 不直接取代 Codex agent，而是負責 GSD 類型的機械流程：建立 task、推導 stage、檢查 artifact、產生下一個 agent prompt、顯示 resume 狀態。

**Tech Stack:** Node.js built-in modules only、`node:test`、Git、Codex CLI/agent session、Markdown artifacts。

---

## 目前判斷

現有流程可以滿足「先釐清，後續自動協調」的產品目標，但穩定性仍仰賴主 agent 自律。要變成長期可依賴的 Codex 工作流，需要把以下動作工具化：

- task ID 產生與目錄建立。
- task stage 從 disk artifacts 推導。
- `CLARIFIED.md` / `SPEC.md` / `IMPL-NOTES.md` / `REVIEW.md` 基本格式驗證。
- 下一步 action 與 subagent prompt 產生。
- resume 時能用單一 command 看出目前該做什麼。
- Codex 專用 `AGENTS.md`，避免只靠 `CLAUDE.md`。

## 工具邊界

新增 CLI 名稱暫定為 `ak`，用 `node tools/agent-kanban/ak.cjs <command>` 執行。

CLI 應該做：

- `status`：列出 backlog、in-progress、done，並推導每個 task 的 stage。
- `new`：建立 backlog task 目錄與 `CLARIFIED.md` 草稿。
- `validate`：檢查 task artifact 是否符合目前 stage 的最低要求。
- `next`：根據 artifacts 顯示下一步：問使用者、派 spec-writer、派 coder、派 reviewer、或回報完成。
- `prompt`：輸出給 Codex/subagent 的精簡派工 prompt。

CLI 不應該做：

- 不自動修改 target repo code。
- 不自動 commit 或 push。
- 不替使用者決定不可委派決策。
- 不直接假裝能呼叫 Codex API；Codex agent 仍由目前 session 或支援 subagent 的 harness 派工。

---

## File Structure

Create:

- `AGENTS.md`：Codex 專用入口規則，內容與 `CLAUDE.md` 對齊，但把 Claude-only 語彙改成 Codex 可執行語彙。
- `docs/CODEX-WORKFLOW.md`：使用者與 agent 的穩定操作說明。
- `package.json`：提供 `npm test`、`npm run ak -- <args>`。
- `tools/agent-kanban/ak.cjs`：CLI entrypoint。
- `tools/agent-kanban/lib/tasks.cjs`：task filesystem、ID、stage inference。
- `tools/agent-kanban/lib/validate.cjs`：artifact 驗證。
- `tools/agent-kanban/lib/prompts.cjs`：Codex/subagent prompt 產生。
- `tools/agent-kanban/templates/CLARIFIED.md`：Stage 0 artifact 模板。
- `tools/agent-kanban/templates/SPEC.md`：Stage 1 artifact 格式參考。
- `tools/agent-kanban/templates/IMPL-NOTES.md`：Stage 2 artifact 格式參考。
- `tools/agent-kanban/templates/REVIEW.md`：Stage 3 artifact 格式參考。
- `tests/agent-kanban/tasks.test.cjs`：stage inference 與 task ID 測試。
- `tests/agent-kanban/validate.test.cjs`：artifact 驗證測試。
- `tests/agent-kanban/prompts.test.cjs`：prompt 輸出測試。

Modify:

- `README.md`：加入 Codex-first 快速使用方式。
- `CLAUDE.md`：標註 Claude prompt 仍保留，但 Codex 以 `AGENTS.md` + CLI 為準。
- `.gitignore`：若測試產生暫存 fixture，加入忽略規則。

---

## Chunk 1: Codex 入口與文件

### Task 1: 建立 Codex 專用入口文件

**Files:**
- Create: `AGENTS.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 撰寫 `AGENTS.md`**

內容要包含：

```markdown
# AGENTS.md

你是 agent-kanban 的 Codex 協調者。

## 核心規則
- 預設用繁體中文回覆。
- 主 session 只做協調、規劃、派工、追狀態，不直接寫 target repo implementation code。
- 所有狀態以 `tasks/` disk artifacts 為準，不以 session 記憶為準。
- 使用 `node tools/agent-kanban/ak.cjs status` 取得目前狀態。
- 使用 `node tools/agent-kanban/ak.cjs next` 推導下一步。

## 正常流程
1. Stage 0：跟使用者釐清需求。
2. 使用者確認摘要後，建立 `CLARIFIED.md`。
3. 自動推進 spec-writer -> coder -> reviewer。
4. 遇到 STOP/BLOCK/不可委派決策才停下來問使用者。
```

- [ ] **Step 2: 更新 `README.md`**

加入「Codex-first 使用方式」：

````markdown
## Codex-first workflow

每次開工先跑：

```powershell
node tools/agent-kanban/ak.cjs status
node tools/agent-kanban/ak.cjs next
```

使用者丟需求後，協調者先完成 Stage 0。確認摘要後，用 CLI 建 task 並自動推進後續 stage。
````

- [ ] **Step 3: 更新 `CLAUDE.md`**

在開頭加註：

```markdown
> Codex 使用者請優先看 `AGENTS.md` 與 `docs/CODEX-WORKFLOW.md`。本檔保留 Claude Code subagent 語境。
```

- [ ] **Step 4: 驗證文件可讀**

Run:

```powershell
Get-Content -Encoding UTF8 AGENTS.md
Get-Content -Encoding UTF8 README.md
```

Expected: 內容為繁體中文，保留必要英文 artifact 名稱。

- [ ] **Step 5: Commit**

```powershell
git add AGENTS.md README.md CLAUDE.md
git commit -m "docs: add Codex coordinator entrypoint"
```

---

## Chunk 2: CLI Skeleton 與 package scripts

### Task 2: 建立無依賴 Node CLI

**Files:**
- Create: `package.json`
- Create: `tools/agent-kanban/ak.cjs`
- Create: `tools/agent-kanban/lib/tasks.cjs`
- Test: `tests/agent-kanban/tasks.test.cjs`

- [ ] **Step 1: 建立 `package.json`**

```json
{
  "name": "agent-kanban-system",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "ak": "node tools/agent-kanban/ak.cjs",
    "test": "node --test tests/**/*.test.cjs"
  }
}
```

- [ ] **Step 2: 寫 failing test：空 tasks 目錄狀態**

在 `tests/agent-kanban/tasks.test.cjs`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listTasks, inferStage } = require('../../tools/agent-kanban/lib/tasks.cjs');

test('listTasks returns empty stages for new workspace', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-'));
  fs.mkdirSync(path.join(root, 'tasks', 'backlog'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tasks', 'in-progress'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tasks', 'done'), { recursive: true });

  const result = listTasks(root);
  assert.deepEqual(result.backlog, []);
  assert.deepEqual(result.inProgress, []);
  assert.deepEqual(result.done, []);
});

test('inferStage maps artifact combinations to next stage', () => {
  assert.equal(inferStage(['CLARIFIED.md']).nextAction, 'dispatch-spec-writer');
  assert.equal(inferStage(['CLARIFIED.md', 'SPEC.md']).nextAction, 'dispatch-coder');
  assert.equal(inferStage(['CLARIFIED.md', 'SPEC.md', 'IMPL-NOTES.md']).nextAction, 'dispatch-reviewer');
  assert.equal(inferStage(['CLARIFIED.md', 'SPEC.md', 'IMPL-NOTES.md', 'REVIEW.md']).nextAction, 'report-review');
});
```

- [ ] **Step 3: 跑 test 確認失敗**

Run:

```powershell
npm test
```

Expected: FAIL，找不到 `tasks.cjs` 或 export。

- [ ] **Step 4: 實作 `tasks.cjs`**

必要 API：

```js
const fs = require('node:fs');
const path = require('node:path');

const STAGES = [
  ['backlog', 'backlog'],
  ['in-progress', 'inProgress'],
  ['done', 'done']
];

function safeReaddir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listTasks(root = process.cwd()) {
  const tasksRoot = path.join(root, 'tasks');
  const result = { backlog: [], inProgress: [], done: [] };
  for (const [diskName, key] of STAGES) {
    result[key] = safeReaddir(path.join(tasksRoot, diskName)).map((id) => {
      const dir = path.join(tasksRoot, diskName, id);
      const artifacts = fs.readdirSync(dir).filter((name) => !name.startsWith('.')).sort();
      return { id, stage: diskName, dir, artifacts, inference: inferStage(artifacts) };
    });
  }
  return result;
}

function inferStage(artifacts) {
  const set = new Set(artifacts);
  if (!set.has('CLARIFIED.md')) return { state: 'invalid', nextAction: 'needs-clarification-artifact' };
  if (set.has('STOP.md') && !set.has('SPEC.md')) return { state: 'blocked', nextAction: 'resolve-spec-stop' };
  if (!set.has('SPEC.md')) return { state: 'stage-0-complete', nextAction: 'dispatch-spec-writer' };
  if (!set.has('IMPL-NOTES.md')) return { state: 'stage-1-complete', nextAction: 'dispatch-coder' };
  if (!set.has('REVIEW.md')) return { state: 'stage-2-complete', nextAction: 'dispatch-reviewer' };
  return { state: 'stage-3-complete', nextAction: 'report-review' };
}

module.exports = { listTasks, inferStage };
```

- [ ] **Step 5: 實作 `ak.cjs status`**

最小 CLI：

```js
#!/usr/bin/env node
const { listTasks } = require('./lib/tasks.cjs');

const command = process.argv[2] || 'status';

if (command === 'status') {
  const tasks = listTasks(process.cwd());
  for (const [label, items] of Object.entries(tasks)) {
    console.log(`${label}:`);
    if (items.length === 0) console.log('  - empty');
    for (const item of items) {
      console.log(`  - ${item.id}: ${item.inference.state} -> ${item.inference.nextAction}`);
    }
  }
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(1);
```

- [ ] **Step 6: 跑測試與 status**

Run:

```powershell
npm test
npm run ak -- status
```

Expected: tests PASS；status 能列出目前 backlog/in-progress/done。

- [ ] **Step 7: Commit**

```powershell
git add package.json tools/agent-kanban tests/agent-kanban
git commit -m "feat: add agent-kanban CLI skeleton"
```

---

## Chunk 3: Artifact 驗證器

### Task 3: 建立 `validate` command

**Files:**
- Create: `tools/agent-kanban/lib/validate.cjs`
- Modify: `tools/agent-kanban/ak.cjs`
- Test: `tests/agent-kanban/validate.test.cjs`

- [ ] **Step 1: 寫 failing tests**

測試項目：

- `CLARIFIED.md` 必須有標題與需求摘要。
- `SPEC.md` 必須有 `## Acceptance`。
- `IMPL-NOTES.md` 必須有 `## Status` 且包含 `OK` / `PARTIAL` / `STOP`。
- `REVIEW.md` 必須有 `## Verdict` 且包含 `APPROVE` / `REQUEST_CHANGES` / `BLOCK`。

- [ ] **Step 2: 實作 `validateTask(taskDir)`**

回傳格式：

```js
{
  ok: boolean,
  errors: [{ file: 'SPEC.md', message: 'missing ## Acceptance' }]
}
```

驗證只做結構檢查，不做語意 review。

- [ ] **Step 3: 實作 CLI**

```powershell
npm run ak -- validate tasks/done/T-0003-fix-digest-browser-multifile-loading
```

Expected: 若現有 artifact 符合最低格式，exit 0；否則列出具體缺口。

- [ ] **Step 4: Commit**

```powershell
git add tools/agent-kanban/lib/validate.cjs tools/agent-kanban/ak.cjs tests/agent-kanban/validate.test.cjs
git commit -m "feat: validate task artifacts"
```

---

## Chunk 4: Task 建立與模板

### Task 4: 實作 `new` command 與模板

**Files:**
- Create: `tools/agent-kanban/templates/CLARIFIED.md`
- Create: `tools/agent-kanban/templates/SPEC.md`
- Create: `tools/agent-kanban/templates/IMPL-NOTES.md`
- Create: `tools/agent-kanban/templates/REVIEW.md`
- Modify: `tools/agent-kanban/lib/tasks.cjs`
- Modify: `tools/agent-kanban/ak.cjs`
- Test: `tests/agent-kanban/tasks.test.cjs`

- [ ] **Step 1: 寫 failing tests**

測試 `createTask(root, slug, options)`：

- 會找出下一個 `T-XXXX`。
- 會建立 `tasks/backlog/T-XXXX-<slug>/CLARIFIED.md`。
- 不覆蓋既有 task。
- slug 只允許小寫英數與 `-`。

- [ ] **Step 2: 實作模板**

`CLARIFIED.md` 至少包含：

```markdown
# CLARIFIED: {{TASK_ID}}

## 需求摘要
- 

## 已確認決策
- 

## Acceptance 草案
- [ ] 

## Out of scope
- 

## 自動推進授權
- 使用者已確認 Stage 0 摘要後，協調者可自動推進 Stage 1 -> 2 -> 3。
```

- [ ] **Step 3: 實作 `new` command**

用法：

```powershell
npm run ak -- new codex-stable-tooling
```

Expected output:

```text
Created: tasks/backlog/T-0004-codex-stable-tooling/CLARIFIED.md
Next: complete CLARIFIED.md, then run `npm run ak -- next`
```

- [ ] **Step 4: Commit**

```powershell
git add tools/agent-kanban tests/agent-kanban
git commit -m "feat: create tasks from templates"
```

---

## Chunk 5: Next Action 與 Prompt 產生

### Task 5: 實作 `next` 與 `prompt`

**Files:**
- Create: `tools/agent-kanban/lib/prompts.cjs`
- Modify: `tools/agent-kanban/ak.cjs`
- Test: `tests/agent-kanban/prompts.test.cjs`

- [ ] **Step 1: 寫 failing tests**

測試：

- 對只有 `CLARIFIED.md` 的 task，`next` 回傳 `dispatch-spec-writer`。
- `prompt spec-writer <task>` 包含明確 read path 與 write path。
- `prompt coder <task>` 包含 `SPEC.md` read path 與 `IMPL-NOTES.md` write path。
- `prompt reviewer <task>` 包含 `SPEC.md`、`IMPL-NOTES.md` read path 與 `REVIEW.md` write path。

- [ ] **Step 2: 實作 prompt 產生器**

`spec-writer` prompt 格式：

```text
你是 spec-writer subagent。
讀取：tasks/in-progress/<id>/CLARIFIED.md
產出：tasks/in-progress/<id>/SPEC.md
若仍有模糊地帶，產出：tasks/in-progress/<id>/STOP.md
回報限制：只回 artifact path + Status，不貼實作內容。
```

`coder` / `reviewer` 依同樣模式產生。

- [ ] **Step 3: 實作 `next`**

`next` 要輸出：

```text
Task: T-0004-codex-stable-tooling
State: stage-0-complete
Next action: dispatch-spec-writer
Command: npm run ak -- prompt spec-writer tasks/in-progress/T-0004-codex-stable-tooling
```

- [ ] **Step 4: Commit**

```powershell
git add tools/agent-kanban tests/agent-kanban
git commit -m "feat: generate coordinator next actions"
```

---

## Chunk 6: Codex Workflow Runbook

### Task 6: 寫穩定操作手冊

**Files:**
- Create: `docs/CODEX-WORKFLOW.md`
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: 撰寫 runbook**

必須涵蓋：

- 新 session 啟動流程。
- 使用者丟需求時如何做 Stage 0。
- 何時建立 task。
- 如何從 `ak status` / `ak next` 判斷下一步。
- 如何派 Codex subagent 或在無 subagent 時手動使用 `prompt`。
- `STOP` / `BLOCK` / `REQUEST_CHANGES` 處理規則。
- 不自動 commit 的原因。

- [ ] **Step 2: README 加快速入口**

加入：

````markdown
## Quick start

```powershell
npm test
npm run ak -- status
npm run ak -- next
```
````

- [ ] **Step 3: Commit**

```powershell
git add docs/CODEX-WORKFLOW.md README.md AGENTS.md
git commit -m "docs: document Codex coordinator workflow"
```

---

## Chunk 7: Dogfood 驗證

### Task 7: 用目前專案自測

**Files:**
- Modify only if defects are found in previous chunks.

- [ ] **Step 1: 跑完整測試**

Run:

```powershell
npm test
```

Expected: all tests PASS。

- [ ] **Step 2: 跑現有 task 驗證**

Run:

```powershell
npm run ak -- status
npm run ak -- validate tasks/done/T-0002-build-digest-browser-html
npm run ak -- validate tasks/done/T-0003-fix-digest-browser-multifile-loading
```

Expected: status 正確列出 done tasks；validate 若抓到舊 artifact 格式不完整，要決定是放寬 validator 還是補 migration 說明，不要偷偷改歷史 artifacts。

- [ ] **Step 3: 建立 dry-run task**

Run:

```powershell
npm run ak -- new codex-tooling-dry-run
npm run ak -- status
npm run ak -- next
```

Expected: 建立 `tasks/backlog/T-XXXX-codex-tooling-dry-run/CLARIFIED.md`；`status` 能推導它仍在 Stage 0。

- [ ] **Step 4: 清理 dry-run task**

若 dry-run task 不要保留，使用 git 檢查後刪除該新目錄；若要保留，補 `CLOSING.md` 說明這是工具驗證 task。

- [ ] **Step 5: 最終 commit**

```powershell
git status --short
git add <final changed files>
git commit -m "test: dogfood Codex coordinator tooling"
```

---

## 成功標準

- `npm test` 全部通過。
- `npm run ak -- status` 可以從 disk artifacts 推導目前狀態。
- `npm run ak -- next` 可以給出下一步。
- `npm run ak -- prompt <role> <task>` 可以產生可貼給 Codex/subagent 的派工 prompt。
- `AGENTS.md` 成為 Codex 的主要入口規則。
- 使用者仍只需要丟需求；Stage 0 確認後，協調者能依 CLI 結果穩定推進後續流程。

## 風險與取捨

- 先做本地 CLI，不做 Codex API 整合：穩、簡單、可審；缺點是派工仍由 agent session 操作。
- 使用 Node built-in modules：避免依賴安裝；缺點是 CLI parser 與模板處理較陽春。
- 不修改歷史 artifacts：保留事實；若 validator 對舊 artifacts 太嚴，應調整 validator 或提供 migration，而不是重寫 done task。
