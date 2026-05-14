const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function createExecutor(config) {
  const mode = config.execMode || 'dry-run';
  if (mode === 'codex') {
    return createCodexExecutor(config);
  }
  return createDryRunExecutor(config);
}

function createDryRunExecutor(config) {
  return {
    run: async (issue, issueState) => {
      const promptPath = writePrompt(config.requestsDir, issue, issueState);
      return {
        ok: true,
        mode: 'dry-run',
        promptPath: relative(promptPath),
        summary: [
          'Dry run completed. Codex was not invoked.',
          '',
          `Prompt file: ${relative(promptPath)}`,
          '',
          '若要啟用真正 Codex 執行，設定環境變數：',
          '',
          '```powershell',
          '$env:ISSUE_RUNNER_EXEC_MODE = "codex"',
          '```'
        ].join('\n')
      };
    }
  };
}

function createCodexExecutor(config) {
  return {
    run: async (issue, issueState) => {
      const promptPath = writePrompt(config.requestsDir, issue, issueState);
      const outputPath = path.join(config.runsDir, `issue-${issue.number}-last-message.md`);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      const child = spawnSync(
        codexCommand(),
        [
          '--ask-for-approval',
          'never',
          'exec',
          '--cd',
          config.projectRoot,
          '--sandbox',
          config.sandbox,
          '--output-last-message',
          outputPath,
          '-'
        ],
        {
          input: fs.readFileSync(promptPath, 'utf8'),
          encoding: 'utf8',
          cwd: config.projectRoot,
          timeout: config.timeoutMs,
          shell: process.platform === 'win32'
        }
      );

      const stdout = child.stdout || '';
      const stderr = child.stderr || '';
      const finalMessage = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
      const ok = !child.error && child.status === 0;

      return {
        ok,
        needsInput: detectNeedsInput(finalMessage),
        mode: 'codex',
        exitCode: child.status,
        error: child.error ? child.error.message : '',
        promptPath: relative(promptPath),
        outputPath: relative(outputPath),
        summary: formatCodexSummary({ ok, stdout, stderr, finalMessage, outputPath, error: child.error })
      };
    }
  };
}

function detectNeedsInput(finalMessage) {
  const text = String(finalMessage || '');
  return /需要確認|需要你|請回覆|請提供|請補充|無法判斷/.test(text);
}

function writePrompt(requestsDir, issue, issueState = {}) {
  fs.mkdirSync(requestsDir, { recursive: true });
  const promptPath = path.join(requestsDir, `issue-${issue.number}.md`);
  const body = issue.body || '';
  const prompt = [
    `# GitHub Issue #${issue.number}: ${issue.title}`,
    '',
    `URL: ${issue.url}`,
    '',
    '## 使用者需求',
    body.trim() || '(issue body is empty)',
    '',
    '## 後續回覆',
    formatAnswers(issueState.answers),
    '',
    '## Git 權限',
    issueState.allowPush
      ? [
          '- 使用者已明確授權 commit 並 push。',
          '- 完成實作與驗證後，可以自行執行 `git add`、`git commit`、`git push`。',
          '- commit message 必須簡短描述本 issue 的實作。'
        ].join('\n')
      : [
          '- 使用者尚未明確授權 commit/push。',
          '- 可以修改工作樹並驗證，但不要 commit、不要 push。',
          '- 完成後回報未提交檔案與驗證結果。'
        ].join('\n'),
    '',
    '## 執行規則',
    '- 使用繁體中文回覆。',
    '- 先檢查 repo 現況，再決定下一步。',
    '- 若需求不清楚，只產出需要詢問使用者的問題，不要猜測實作。',
    '- 除非 Git 權限段落明確允許，不要 push。',
    '- 完成後摘要改動、驗證結果與仍需使用者處理的事項。'
  ].join('\n');
  fs.writeFileSync(promptPath, `${prompt}\n`, 'utf8');
  return promptPath;
}

function formatAnswers(answers = {}) {
  const entries = Object.entries(answers);
  if (entries.length === 0) return '(no follow-up comments recorded)';
  return entries
    .map(([id, answer]) => `- comment ${id} by ${answer.author || 'unknown'}: ${answer.body}`)
    .join('\n');
}

function codexCommand() {
  return process.platform === 'win32' ? 'codex.cmd' : 'codex';
}

function formatCodexSummary({ ok, stdout, stderr, finalMessage, outputPath, error }) {
  const lines = [
    ok ? 'Codex execution completed.' : 'Codex execution failed.',
    '',
    `Final message file: ${relative(outputPath)}`
  ];

  if (error) {
    lines.push('', '## spawn error', error.message);
  }

  if (finalMessage.trim()) {
    lines.push('', '## Final Message', finalMessage.trim());
  }

  if (!ok && stderr.trim()) {
    lines.push('', '## stderr', stderr.trim());
  }

  if (!ok && stdout.trim()) {
    lines.push('', '## stdout', stdout.trim());
  }

  return lines.join('\n');
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath).replaceAll('\\', '/') || '.';
}

module.exports = { createExecutor };
