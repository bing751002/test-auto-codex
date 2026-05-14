const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readState } = require('../../tools/issue-runner/lib/state.cjs');

test('readState accepts UTF-8 BOM JSON files written by Windows PowerShell', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-runner-state-'));
  const statePath = path.join(dir, 'state.json');
  fs.writeFileSync(statePath, '\uFEFF{"version":1,"issues":{}}', 'utf8');

  assert.deepEqual(readState(statePath), { version: 1, issues: {} });
});
