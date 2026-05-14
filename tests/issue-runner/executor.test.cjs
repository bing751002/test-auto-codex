const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
  assert.match(prompt, /## 執行專案/);
  assert.match(prompt, /name: customer-api/);
  assert.match(prompt, /path: D:\\work\\customer-api/);
});
