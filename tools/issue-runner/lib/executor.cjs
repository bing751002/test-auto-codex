const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

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
      const projectRoot = issueState.project?.path || config.projectRoot;
      const promptPath = writePrompt(config.requestsDir, issue, issueState, projectRoot);
      return {
        ok: true,
        mode: 'dry-run',
        promptPath: relative(promptPath),
        summary: [
          'Dry run completed. Codex was not invoked.',
          '',
          `Prompt file: ${relative(promptPath)}`,
          '',
          '若要啟用實際 Codex 執行，請將 runner exec mode 設為 codex。'
        ].join('\n')
      };
    }
  };
}

function createCodexExecutor(config) {
  const spawnImpl = config.spawn || spawn;
  return {
    run: async (issue, issueState) => {
      const projectRoot = issueState.project?.path || config.projectRoot;
      const promptPath = writePrompt(config.requestsDir, issue, issueState, projectRoot);
      const outputPath = path.join(config.runsDir, `issue-${issue.number}-last-message.md`);
      const logPath = path.join(config.runsDir, `issue-${issue.number}.log`);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      const prompt = fs.readFileSync(promptPath, 'utf8');
      const args = [
        '--ask-for-approval', 'never',
        'exec',
        '--cd', projectRoot,
        '--sandbox', config.sandbox,
        '--output-last-message', outputPath,
        '-'
      ];

      const result = await runChildProcess({
        spawnImpl,
        command: codexCommand(),
        args,
        cwd: projectRoot,
        input: prompt,
        timeoutMs: config.timeoutMs,
        logPath,
        onPid: (pid) => {
          if (typeof config.onChildPid === 'function') config.onChildPid(pid);
        }
      });

      const finalMessage = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
      const ok = !result.spawnError && !result.timedOut && result.exitCode === 0;
      const error = result.spawnError
        ? result.spawnError.message
        : result.timedOut
          ? `timed out after ${config.timeoutMs}ms`
          : '';

      return {
        ok,
        needsInput: detectNeedsInput(finalMessage),
        mode: 'codex',
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        pid: result.pid,
        error,
        promptPath: relative(promptPath),
        outputPath: relative(outputPath),
        logPath: relative(logPath),
        summary: formatCodexSummary({
          ok,
          stdout: result.stdout,
          stderr: result.stderr,
          finalMessage,
          outputPath,
          error,
          timedOut: result.timedOut
        })
      };
    }
  };
}

function runChildProcess({ spawnImpl, command, args, cwd, input, timeoutMs, logPath, onPid }) {
  return new Promise((resolve) => {
    let logStream = null;
    if (logPath) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      logStream = fs.createWriteStream(logPath, { flags: 'a' });
      logStream.write(`[${new Date().toISOString()}] spawn ${command} ${args.join(' ')}\n`);
    }

    let child;
    try {
      child = spawnImpl(command, args, {
        cwd,
        shell: process.platform === 'win32',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (spawnError) {
      if (logStream) {
        logStream.write(`[spawn error] ${spawnError.message}\n`);
        logStream.end();
      }
      resolve({
        spawnError,
        timedOut: false,
        exitCode: null,
        signal: '',
        pid: 0,
        stdout: '',
        stderr: ''
      });
      return;
    }

    if (onPid && child.pid) onPid(child.pid);

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError = null;
    let timeoutHandle = null;
    let killHandle = null;

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (logStream) logStream.write(text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr += text;
      if (logStream) logStream.write(`[stderr] ${text}`);
    });
    child.on('error', (err) => {
      spawnError = err;
      if (logStream) logStream.write(`[error] ${err.message}\n`);
    });

    if (timeoutMs && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        if (logStream) {
          logStream.write(`[${new Date().toISOString()}] timeout ${timeoutMs}ms, sending SIGTERM to pid ${child.pid}\n`);
        }
        try { child.kill('SIGTERM'); } catch {}
        killHandle = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch {}
        }, 5000);
        killHandle.unref();
      }, timeoutMs);
      timeoutHandle.unref();
    }

    child.on('close', (code, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (killHandle) clearTimeout(killHandle);
      if (logStream) {
        logStream.write(`[${new Date().toISOString()}] close code=${code} signal=${signal || ''}\n`);
        logStream.end();
      }
      resolve({
        spawnError,
        timedOut,
        exitCode: code,
        signal: signal || '',
        pid: child.pid || 0,
        stdout,
        stderr
      });
    });

    if (child.stdin) {
      child.stdin.on('error', (err) => {
        if (logStream) logStream.write(`[stdin error] ${err.message}\n`);
      });
      if (input != null) child.stdin.write(input);
      child.stdin.end();
    }
  });
}

function detectNeedsInput(finalMessage) {
  const text = String(finalMessage || '');
  return /需要你|需要使用者|需要補充|無法判斷|needs? input|needs? clarification/i.test(text);
}

function writePrompt(requestsDir, issue, issueState = {}, projectRoot = '') {
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
    '## 執行專案',
    issueState.project
      ? [`- name: ${issueState.project.name}`, `- path: ${issueState.project.path}`].join('\n')
      : [`- name: default`, `- path: ${projectRoot || process.cwd()}`].join('\n'),
    '',
    '## 既有回覆',
    formatAnswers(issueState.answers),
    '',
    '## Git 權限',
    issueState.allowPush
      ? [
          '- 使用者已允許這次任務 commit 並 push。',
          '- 如果你完成了可提交的修改，請自行執行 `git add`、`git commit`、`git push`。',
          '- commit message 請清楚描述變更並包含 issue 編號。'
        ].join('\n')
      : [
          '- 使用者尚未允許這次任務 commit/push。',
          '- 可以修改本機檔案與執行測試，但不要 commit，也不要 push。',
          '- 最後請回報修改內容與驗證結果。'
        ].join('\n'),
    '',
    '## 執行規則',
    '- 使用繁體中文回覆使用者。',
    '- 先理解 repo 現況，再進行修改。',
    '- 如果遇到可以自行處理的問題，請自行修正並繼續。',
    '- 只有在缺少必要需求、權限或外部資訊時，才在 issue 回覆需要使用者補充。',
    '- 最後請清楚列出完成內容、驗證方式與任何未完成風險。'
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

function formatCodexSummary({ ok, stdout, stderr, finalMessage, outputPath, error, timedOut }) {
  const lines = [
    ok
      ? 'Codex execution completed.'
      : timedOut
        ? 'Codex execution timed out.'
        : 'Codex execution failed.',
    '',
    `Final message file: ${relative(outputPath)}`
  ];

  if (error) {
    lines.push('', '## error', error);
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
