const fs = require('node:fs');
const path = require('node:path');

function readState(statePath) {
  if (!fs.existsSync(statePath)) {
    return { version: 1, issues: {} };
  }

  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(`${statePath}.tmp`, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(`${statePath}.tmp`, statePath);
}

module.exports = { readState, writeState };
