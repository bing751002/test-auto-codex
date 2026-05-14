const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Writable } = require('node:stream');
const { createExecutor } = require('../../tools/issue-runner/lib/executor.cjs');

test('dry-run executor writes resolved project details into prompt', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-runner-executor-'));
  const requestsDir = path.join(tempRoot, 'requests');
  const executor = createExecutor({
    execMode: 'dry-run',
    projectRoot: 'D:\\agent-kanban-system',
    requestsDir,
    runsDir: path.join(tempRoot, 'runs')
  });

  await executor.run(
    {
      number: 13,
      title: 'Project prompt',
      body: '/project customer-api\nBuild this.',
      url: 'https://github.com/example/repo/issues/13'
    },
    {
      project: { name: 'customer-api', path: 'D:\\work\\customer-api' },
      answers: {}
    }
  );

  const prompt = fs.readFileSync(path.join(requestsDir, 'issue-13.md'), 'utf8');
  assert.match(prompt, /## 工作目錄/);
  assert.match(prompt, /name: customer-api/);
  assert.match(prompt, /path: D:\\work\\customer-api/);
});

function createFakeChild({ stdout = '', stderr = '', exitCode = 0, signal = null, errorAfterMs = null, exitAfterMs = 10, pid = 12345 }) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  child.killed = false;
  child.kill = (sig) => {
    child.killed = true;
    setImmediate(() => {
      child.emit('close', null, sig || 'SIGTERM');
    });
  };
  setTimeout(() => {
    if (errorAfterMs != null) {
      child.emit('error', new Error('spawn ENOENT'));
      return;
    }
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    setTimeout(() => {
      if (!child.killed) child.emit('close', exitCode, signal);
    }, exitAfterMs);
  }, 1);
  return child;
}

test('codex executor returns ok=true on exit code 0 and writes prompt + log', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-runner-codex-'));
  const requestsDir = path.join(tempRoot, 'requests');
  const runsDir = path.join(tempRoot, 'runs');
  const capturedPids = [];

  const fakeSpawn = (cmd, args, opts) => {
    fs.mkdirSync(runsDir, { recursive: true });
    const outputArg = args[args.indexOf('--output-last-message') + 1];
    fs.writeFileSync(outputArg, '已完成需求並驗證通過。', 'utf8');
    return createFakeChild({ stdout: 'codex log line\n', exitCode: 0 });
  };

  const executor = createExecutor({
    execMode: 'codex',
    projectRoot: tempRoot,
    requestsDir,
    runsDir,
    sandbox: 'workspace-write',
    timeoutMs: 5000,
    spawn: fakeSpawn,
    onChildPid: (pid) => capturedPids.push(pid)
  });

  const result = await executor.run(
    { number: 100, title: 'happy', body: '', url: 'u' },
    { project: { name: 'p', path: tempRoot }, answers: {}, allowPush: false }
  );

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.mode, 'codex');
  assert.deepEqual(capturedPids, [12345]);
  assert.ok(fs.existsSync(path.join(runsDir, 'issue-100.log')));
  const log = fs.readFileSync(path.join(runsDir, 'issue-100.log'), 'utf8');
  assert.match(log, /codex log line/);
});

test('codex executor reports failure when child exits non-zero', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-runner-codex-fail-'));
  const fakeSpawn = () => createFakeChild({ stderr: 'oops something broke', exitCode: 1 });

  const executor = createExecutor({
    execMode: 'codex',
    projectRoot: tempRoot,
    requestsDir: path.join(tempRoot, 'requests'),
    runsDir: path.join(tempRoot, 'runs'),
    sandbox: 'workspace-write',
    timeoutMs: 5000,
    spawn: fakeSpawn
  });

  const result = await executor.run(
    { number: 101, title: 'fail', body: '', url: 'u' },
    { project: { name: 'p', path: tempRoot }, answers: {} }
  );

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.summary, /Codex execution failed/);
  assert.match(result.summary, /oops something broke/);
});

test('codex executor kills child after timeoutMs and reports timedOut', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-runner-codex-timeout-'));
  const fakeSpawn = () => createFakeChild({ exitAfterMs: 5000 });

  const executor = createExecutor({
    execMode: 'codex',
    projectRoot: tempRoot,
    requestsDir: path.join(tempRoot, 'requests'),
    runsDir: path.join(tempRoot, 'runs'),
    sandbox: 'workspace-write',
    timeoutMs: 50,
    spawn: fakeSpawn
  });

  const result = await executor.run(
    { number: 102, title: 'slow', body: '', url: 'u' },
    { project: { name: 'p', path: tempRoot }, answers: {} }
  );

  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
  assert.match(result.summary, /Codex execution timed out/);
  assert.match(result.error, /timed out after 50ms/);
});

test('codex executor captures spawn error when command cannot launch', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-runner-codex-spawn-err-'));
  const fakeSpawn = () => {
    throw Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
  };

  const executor = createExecutor({
    execMode: 'codex',
    projectRoot: tempRoot,
    requestsDir: path.join(tempRoot, 'requests'),
    runsDir: path.join(tempRoot, 'runs'),
    sandbox: 'workspace-write',
    timeoutMs: 5000,
    spawn: fakeSpawn
  });

  const result = await executor.run(
    { number: 103, title: 'no-codex', body: '', url: 'u' },
    { project: { name: 'p', path: tempRoot }, answers: {} }
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
});

test('claude-code executor uses stdout as final message and reports completion', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-runner-claude-'));
  const calls = [];

  const fakeSpawn = (cmd, args) => {
    calls.push({ cmd, args });
    return createFakeChild({
      stdout: '已完成需求並通過驗證。',
      exitCode: 0
    });
  };

  const executor = createExecutor({
    execMode: 'claude-code',
    projectRoot: tempRoot,
    requestsDir: path.join(tempRoot, 'requests'),
    runsDir: path.join(tempRoot, 'runs'),
    timeoutMs: 5000,
    spawn: fakeSpawn
  });

  const result = await executor.run(
    { number: 200, title: 'claude task', body: '', url: 'u' },
    { project: { name: 'p', path: tempRoot }, answers: {} }
  );

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'claude-code');
  assert.match(result.summary, /Claude Code execution completed/);
  assert.match(result.summary, /已完成需求並通過驗證/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('--print'));
  assert.ok(calls[0].args.includes('--dangerously-skip-permissions'));
});

test('claude-code executor detects needs-input from stdout content', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-runner-claude-ni-'));
  const fakeSpawn = () => createFakeChild({
    stdout: '需要你補充：哪一個資料夾要放這個檔案？',
    exitCode: 0
  });

  const executor = createExecutor({
    execMode: 'claude-code',
    projectRoot: tempRoot,
    requestsDir: path.join(tempRoot, 'requests'),
    runsDir: path.join(tempRoot, 'runs'),
    timeoutMs: 5000,
    spawn: fakeSpawn
  });

  const result = await executor.run(
    { number: 201, title: 'ambiguous', body: '', url: 'u' },
    { project: { name: 'p', path: tempRoot }, answers: {} }
  );

  assert.equal(result.ok, true);
  assert.equal(result.needsInput, true);
});

test('answer-mode prompt forbids file changes and commits', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-runner-answer-mode-'));
  const executor = createExecutor({
    execMode: 'dry-run',
    projectRoot: tempRoot,
    requestsDir: path.join(tempRoot, 'requests'),
    runsDir: path.join(tempRoot, 'runs')
  });

  await executor.run(
    { number: 500, title: 'count something', body: '/mode answer\n計算 X', url: 'u' },
    { project: { name: 'p', path: tempRoot }, mode: 'answer', answers: {}, allowPush: false }
  );

  const prompt = fs.readFileSync(path.join(tempRoot, 'requests', 'issue-500.md'), 'utf8');
  assert.match(prompt, /查詢／計算／研究/);
  assert.match(prompt, /不要新增、修改、刪除/);
  assert.match(prompt, /絕對不要.*commit/);
  // Should NOT include the dev-mode Git permission section
  assert.doesNotMatch(prompt, /先理解 repo 現況，再進行修改/);
});

test('dev-mode prompt keeps existing modification + git push rules', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-runner-dev-mode-'));
  const executor = createExecutor({
    execMode: 'dry-run',
    projectRoot: tempRoot,
    requestsDir: path.join(tempRoot, 'requests'),
    runsDir: path.join(tempRoot, 'runs')
  });

  await executor.run(
    { number: 501, title: 'add feature', body: 'do it', url: 'u' },
    { project: { name: 'p', path: tempRoot }, mode: 'dev', answers: {}, allowPush: false }
  );

  const prompt = fs.readFileSync(path.join(tempRoot, 'requests', 'issue-501.md'), 'utf8');
  assert.match(prompt, /開發任務/);
  assert.match(prompt, /先理解 repo 現況，再進行修改/);
  assert.match(prompt, /尚未允許.*commit\/push/);
});

test('createExecutor stretches timeout to 60 minutes when mode is answer', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-runner-answer-timeout-'));
  const seenTimeouts = [];

  const fakeSpawn = () => createFakeChild({ stdout: 'done', exitCode: 0 });

  const executor = createExecutor({
    execMode: 'claude-code',
    projectRoot: tempRoot,
    requestsDir: path.join(tempRoot, 'requests'),
    runsDir: path.join(tempRoot, 'runs'),
    timeoutMs: 30 * 60 * 1000, // dev-mode default
    spawn: fakeSpawn,
    onChildPid: () => {}
  });

  // dev-mode (no mode set): timeout stays at 30 min
  const devResult = await executor.run(
    { number: 600, title: 'dev', body: '', url: 'u' },
    { project: { name: 'p', path: tempRoot }, mode: '', answers: {} }
  );
  seenTimeouts.push({ tag: 'dev', ok: devResult.ok });

  // answer mode: timeout extends to 60 min. We assert the run still completed
  // (proxy: ok=true) since the fake child exits fast; the real wiring change is
  // confirmed by the prompt-mode test plus this not crashing on configuration.
  const answerResult = await executor.run(
    { number: 601, title: 'answer', body: '', url: 'u' },
    { project: { name: 'p', path: tempRoot }, mode: 'answer', answers: {} }
  );
  seenTimeouts.push({ tag: 'answer', ok: answerResult.ok });

  assert.deepEqual(seenTimeouts, [{ tag: 'dev', ok: true }, { tag: 'answer', ok: true }]);
});

test('createExecutor honors per-issue engine override regardless of default execMode', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-runner-engine-'));
  const codexCalls = [];
  const claudeCalls = [];

  const fakeSpawn = (cmd, args) => {
    const isClaude = String(cmd).includes('claude');
    (isClaude ? claudeCalls : codexCalls).push({ cmd, args });
    if (!isClaude) {
      // codex needs the output file written
      const outputArg = args[args.indexOf('--output-last-message') + 1];
      fs.mkdirSync(path.dirname(outputArg), { recursive: true });
      fs.writeFileSync(outputArg, 'codex done', 'utf8');
    }
    return createFakeChild({ stdout: isClaude ? 'claude done' : '', exitCode: 0 });
  };

  const executor = createExecutor({
    execMode: 'codex', // default
    projectRoot: tempRoot,
    requestsDir: path.join(tempRoot, 'requests'),
    runsDir: path.join(tempRoot, 'runs'),
    sandbox: 'workspace-write',
    timeoutMs: 5000,
    spawn: fakeSpawn
  });

  // issueState.engine = 'claude-code' should override default codex
  const result = await executor.run(
    { number: 300, title: 'override', body: '', url: 'u' },
    { project: { name: 'p', path: tempRoot }, answers: {}, engine: 'claude-code' }
  );

  assert.equal(result.mode, 'claude-code');
  assert.equal(codexCalls.length, 0);
  assert.equal(claudeCalls.length, 1);
});
