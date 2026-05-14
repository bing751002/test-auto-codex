# agent-kanban-system

這個專案是給 Codex 使用的「協調者 / issue runner」控制台。目標是讓你在 GitHub issue 描述需求，放在公司電腦上的 runner 會定期讀取 issue，依照指定的本機專案資料夾啟動 Codex 執行工作，並把狀態回覆在同一個 issue。

## 目前支援的流程

1. 在控制 repo 開 GitHub issue，套用 `Agent Kanban Request` template。
2. issue 加上 `agent-kanban` label。
3. 用 `/bot <runner-id>` 指定哪台電腦處理。
4. runner 依照 issue 所在 repo 找到對應的本機資料夾。
5. 如果資料夾不存在，而且設定允許 `cloneIfMissing`，runner 會先 clone repo。
6. 需要覆蓋預設資料夾時，可用 `/project <project-name>` 指定白名單 project。
7. runner poll 到 issue 後會回覆：
   - `[agent-kanban] status: received`
   - `[agent-kanban] status: running`
   - `[agent-kanban] status: completed`
   - `[agent-kanban] status: failed`
   - `[agent-kanban] needs-input`
8. 如果 Codex 需要補充資訊，你可以直接在同一個 issue 回覆，runner 下一輪會接續執行。

## Issue 指令

### 指定處理電腦

```text
/bot LAPTOP-2PECR7ML
```

沒有 `/bot` 時，任何正在 poll 這個 repo 的 runner 都可能接走 issue。若你有兩台電腦都在跑，建議一定要指定。

### 覆蓋本機專案資料夾

```text
/project agent-kanban-system
```

一般情況不需要寫 `/project`。issue 從哪個 repo 來，runner 會用 `.runner/projects.json` 裡的 `repos` 設定推導本機資料夾。

`/project` 是進階覆蓋用，不是任意路徑，而是 `.runner/projects.json` 裡登記過的 project 名稱。這樣可以避免 issue 誤寫路徑，或讓 runner 跑到未授權的公司資料夾。

若 issue 指定不存在的 project，runner 會在 issue 回覆 `[agent-kanban] needs-input`，並列出目前可用 project。

### 允許 commit / push

預設 runner 只允許 Codex 修改工作樹與回報結果，不會要求 Codex commit 或 push。

如果你要讓 Codex commit 並 push，需要在 issue 寫明：

```text
/allow-push
```

或在需求中明確寫：

```text
commit 並 push
上傳 git
git push
```

## Repo / Project 設定

實際設定檔放在本機：

```text
.runner/projects.json
```

這個檔案被 `.gitignore` 忽略，不會上傳到 git，適合放公司電腦的本機路徑。

範例：

```json
{
  "defaultProject": "agent-kanban-system",
  "workspaceRoot": "D:\\work",
  "cloneIfMissing": true,
  "projects": {
    "agent-kanban-system": {
      "path": "D:\\agent-kanban-system"
    }
  },
  "repos": {
    "bing751002/test-auto-codex": {
      "project": "agent-kanban-system",
      "path": "D:\\agent-kanban-system",
      "cloneIfMissing": false
    },
    "company/customer-api": {
      "project": "customer-api"
    }
  }
}
```

設定意義：

- `repos`：runner 每輪會 poll 的 GitHub repo 清單。
- `project`：該 repo 預設對應的本機 project 名稱。
- `path`：明確指定本機資料夾。若省略，會使用 `workspaceRoot + repo 名稱`，例如 `D:\work\customer-api`。
- `cloneIfMissing`：資料夾不存在時是否允許 runner 執行 `gh repo clone <repo> <path>`。
- `projects`：手動 `/project` 覆蓋時可使用的白名單。

repo 內也有可提交的範例檔：

```text
tools/issue-runner/projects.example.json
```

## 多 repo issue

runner 支援同一次 poll 依序查多個 repo。你可以直接在目標 repo 開 issue，例如 `company/customer-api`，runner 會依 `repos` 設定進到對應的本機資料夾執行。

狀態 key 會使用 `repo#issueNumber`，例如：

```text
company/customer-api#12
company/web-admin#12
```

所以不同 repo 都有 issue `#12` 時不會互相覆蓋。

## Runner 指令

查看狀態：

```powershell
node tools/issue-runner/runner.cjs status
```

建立 label：

```powershell
node tools/issue-runner/runner.cjs ensure-label
```

手動 poll 一次：

```powershell
node tools/issue-runner/runner.cjs poll --exec-mode dry-run
```

## Windows 排程

安裝隱藏執行的排程：

```powershell
powershell -ExecutionPolicy Bypass -File tools/issue-runner/install-scheduled-task.ps1 -ExecMode codex -RunnerId LAPTOP-2PECR7ML -ExecutionLimitMinutes 120
```

手動啟動一次：

```powershell
Start-ScheduledTask -TaskName AgentKanbanIssueRunner
```

移除排程：

```powershell
powershell -ExecutionPolicy Bypass -File tools/issue-runner/uninstall-scheduled-task.ps1
```

排程會透過 `wscript.exe` 隱藏 PowerShell 視窗，避免每分鐘跳出小黑框。log 會寫到 `.runner/logs/`。

## 狀態與輸出

本機 runner 狀態：

```text
.runner/state.json
```

Codex prompt：

```text
.runner/requests/issue-<number>.md
```

Codex 最後回覆：

```text
.runner/runs/issue-<number>-last-message.md
```

大型產出檔案建議放：

```text
artifacts/issue-<number>/
```

若是不適合進 git 的敏感或本機輸出，放：

```text
.runner/artifacts/issue-<number>/
```
