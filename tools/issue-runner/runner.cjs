#!/usr/bin/env node
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pollIssues } = require('./lib/core.cjs');
const { readState, writeState } = require('./lib/state.cjs');
const { createGitHubClient, bindRepo } = require('./lib/github.cjs');
const { createExecutor } = require('./lib/executor.cjs');

const command = process.argv[2] || 'status';

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const config = getConfig();
  const github = bindRepo(createGitHubClient(), config.repo);

  if (command === 'status') {
    console.log(`repo: ${config.repo}`);
    console.log(`label: ${config.label}`);
    console.log(`state: ${relative(config.statePath)}`);
    console.log(`execMode: ${config.execMode}`);
    console.log(`gh: ${authLine()}`);
    return;
  }

  if (command === 'ensure-label') {
    github.ensureLabel({ repo: config.repo, label: config.label });
    console.log(`OK: label ensured: ${config.label}`);
    return;
  }

  if (command === 'poll') {
    const state = readState(config.statePath);
    const result = await pollIssues({
      github,
      executor: createExecutor(config),
      repo: config.repo,
      label: config.label,
      state,
      execute: config.execute
    });
    writeState(config.statePath, result.state);
    console.log(`OK: polled ${config.repo} label:${config.label}`);
    return;
  }

  if (command === 'question') {
    const issueNumber = process.argv[3];
    const question = process.argv.slice(4).join(' ').trim();
    if (!issueNumber || !question) {
      throw new Error('Usage: runner question <issue-number> <question>');
    }

    github.commentIssue(
      Number(issueNumber),
      [
        '[agent-kanban] needs-input',
        '',
        question,
        '',
        '請在同一個 issue 回覆：',
        '',
        '```text',
        '/answer <你的答案>',
        '```'
      ].join('\n')
    );
    console.log(`OK: question posted to issue #${issueNumber}`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function getConfig() {
  const repo = getArg('--repo') || process.env.ISSUE_RUNNER_REPO || inferRepoFromGit();
  if (!repo) {
    throw new Error('repo not configured; pass --repo <owner/repo> or set git remote origin');
  }

  return {
    repo,
    label: getArg('--label') || process.env.ISSUE_RUNNER_LABEL || 'agent-kanban',
    statePath: path.resolve(getArg('--state') || process.env.ISSUE_RUNNER_STATE || '.runner/state.json'),
    projectRoot: process.cwd(),
    requestsDir: path.resolve(process.env.ISSUE_RUNNER_REQUESTS_DIR || '.runner/requests'),
    runsDir: path.resolve(process.env.ISSUE_RUNNER_RUNS_DIR || '.runner/runs'),
    execute: getFlag('--no-execute') ? false : process.env.ISSUE_RUNNER_EXECUTE !== '0',
    execMode: getArg('--exec-mode') || process.env.ISSUE_RUNNER_EXEC_MODE || 'dry-run',
    sandbox: process.env.ISSUE_RUNNER_CODEX_SANDBOX || 'workspace-write',
    timeoutMs: Number(process.env.ISSUE_RUNNER_TIMEOUT_MS || 30 * 60 * 1000)
  };
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return '';
  return process.argv[index + 1] || '';
}

function getFlag(name) {
  return process.argv.includes(name);
}

function inferRepoFromGit() {
  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return parseGitHubRepo(remote);
  } catch {
    return '';
  }
}

function parseGitHubRepo(remote) {
  const sshMatch = /^git@github\.com:([^/]+\/[^.]+)(?:\.git)?$/.exec(remote);
  if (sshMatch) return sshMatch[1];

  const httpsMatch = /^https:\/\/github\.com\/([^/]+\/[^.]+)(?:\.git)?$/.exec(remote);
  if (httpsMatch) return httpsMatch[1];

  return '';
}

function authLine() {
  try {
    const output = execFileSync('gh', ['auth', 'status'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return output.split(/\r?\n/).find((line) => line.includes('Logged in'))?.trim() || 'authenticated';
  } catch {
    return 'not authenticated';
  }
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath).replaceAll('\\', '/') || '.';
}
