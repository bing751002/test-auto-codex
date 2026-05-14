#!/usr/bin/env node
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pollIssues, heartbeat } = require('./lib/core.cjs');
const { readState, writeState } = require('./lib/state.cjs');
const { createGitHubClient, bindRepo } = require('./lib/github.cjs');
const { createExecutor } = require('./lib/executor.cjs');
const { projectConfigForRepo, readProjectConfig, resolveRepoPlans } = require('./lib/projects.cjs');

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

async function main() {
  const command = process.argv[2] || 'status';
  const config = getConfig();
  const githubClient = createGitHubClient();

  if (command === 'status') {
    const repoPlans = resolveRepoPlans(config.repo, config.projectConfig);
    console.log(`repo: ${config.repo}`);
    console.log(`pollRepos: ${repoPlans.map((plan) => plan.repo).join(', ')}`);
    console.log(`label: ${config.label}`);
    console.log(`runnerId: ${config.runnerId || '(any)'}`);
    console.log(`state: ${relative(config.statePath)}`);
    console.log(`projects: ${relative(config.projectsPath)}`);
    console.log(`defaultProject: ${config.projectConfig.defaultProject}`);
    console.log(`availableProjects: ${Object.keys(config.projectConfig.projects).sort().join(', ')}`);
    console.log(`execMode: ${config.execMode}`);
    console.log(`allowedAuthors: ${config.allowedAuthors.length === 0 ? '(any)' : config.allowedAuthors.join(', ')}`);
    console.log(`gh: ${authLine()}`);
    return;
  }

  if (command === 'ensure-label') {
    for (const repoPlan of resolveRepoPlans(config.repo, config.projectConfig)) {
      githubClient.ensureLabel({ repo: repoPlan.repo, label: config.label });
      console.log(`OK: label ensured: ${repoPlan.repo} ${config.label}`);
    }
    return;
  }

  if (command === 'poll') {
    const state = readState(config.statePath);
    const saveState = async (nextState) => writeState(config.statePath, nextState);
    const result = await pollConfiguredRepos({
      githubClient,
      executor: createExecutor(config),
      fallbackRepo: config.repo,
      label: config.label,
      runnerId: config.runnerId,
      state,
      execute: config.execute,
      projectConfig: config.projectConfig,
      saveState,
      allowedAuthors: config.allowedAuthors
    });
    await saveState(result.state);
    console.log(`OK: polled ${result.polledRepos.join(', ')} label:${config.label}`);
    return;
  }

  if (command === 'heartbeat') {
    const state = readState(config.statePath);
    const saveState = async (nextState) => writeState(config.statePath, nextState);
    const repoPlans = resolveRepoPlans(config.repo, config.projectConfig);
    const totals = { posted: 0 };
    for (const repoPlan of repoPlans) {
      const boundGithub = bindRepo(githubClient, repoPlan.repo);
      const repoState = filterStateForRepo(state, repoPlan.repo);
      const result = await heartbeat({
        github: boundGithub,
        state: repoState,
        stalenessMs: config.heartbeatStalenessMs,
        intervalMs: config.heartbeatIntervalMs,
        saveState: async (next) => {
          mergeStateForRepo(state, repoPlan.repo, next);
          await saveState(state);
        }
      });
      totals.posted += result.posted.length;
    }
    console.log(`OK: heartbeat posted ${totals.posted} comment(s)`);
    return;
  }

  if (command === 'question') {
    const issueNumber = process.argv[3];
    const question = process.argv.slice(4).join(' ').trim();
    if (!issueNumber || !question) {
      throw new Error('Usage: runner question <issue-number> <question>');
    }

    bindRepo(githubClient, config.repo).commentIssue(
      Number(issueNumber),
      [
        '[agent-kanban] needs-input',
        '',
        question,
        '',
        '請在同一個 issue 回覆：',
        '',
        '```text',
        '/answer <你的回覆>',
        '```'
      ].join('\n')
    );
    console.log(`OK: question posted to issue #${issueNumber}`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function pollConfiguredRepos({
  githubClient,
  executor,
  fallbackRepo,
  label,
  runnerId,
  state,
  execute,
  projectConfig,
  ensureProject,
  saveState = async () => {},
  allowedAuthors = []
}) {
  const repoPlans = resolveRepoPlans(fallbackRepo, projectConfig);
  let nextState = state;
  const polledRepos = [];

  for (const repoPlan of repoPlans) {
    const result = await pollIssues({
      github: bindRepo(githubClient, repoPlan.repo),
      executor,
      repo: repoPlan.repo,
      label,
      runnerId,
      state: nextState,
      execute,
      projectConfig: projectConfigForRepo(projectConfig, repoPlan),
      stateKeyPrefix: repoPlan.repo,
      ensureProject,
      saveState,
      allowedAuthors
    });
    nextState = result.state;
    polledRepos.push(repoPlan.repo);
  }

  return { state: nextState, polledRepos };
}

function filterStateForRepo(state, repo) {
  const issues = {};
  for (const [key, value] of Object.entries(state?.issues || {})) {
    if (key.startsWith(`${repo}#`) || /^\d+$/.test(key)) {
      issues[key] = value;
    }
  }
  return { ...state, issues };
}

function mergeStateForRepo(state, repo, partialState) {
  for (const [key, value] of Object.entries(partialState?.issues || {})) {
    if (key.startsWith(`${repo}#`) || /^\d+$/.test(key)) {
      state.issues[key] = value;
    }
  }
}

function getConfig() {
  const repo = getArg('--repo') || process.env.ISSUE_RUNNER_REPO || inferRepoFromGit();
  if (!repo) {
    throw new Error('repo not configured; pass --repo <owner/repo> or set git remote origin');
  }
  const projectRoot = process.cwd();
  const projectsPath = path.resolve(getArg('--projects') || process.env.ISSUE_RUNNER_PROJECTS || '.runner/projects.json');

  return {
    repo,
    label: getArg('--label') || process.env.ISSUE_RUNNER_LABEL || 'agent-kanban',
    runnerId: getArg('--runner-id') || process.env.ISSUE_RUNNER_ID || '',
    statePath: path.resolve(getArg('--state') || process.env.ISSUE_RUNNER_STATE || '.runner/state.json'),
    projectRoot,
    projectsPath,
    projectConfig: readProjectConfig(projectsPath, projectRoot),
    requestsDir: path.resolve(process.env.ISSUE_RUNNER_REQUESTS_DIR || '.runner/requests'),
    runsDir: path.resolve(process.env.ISSUE_RUNNER_RUNS_DIR || '.runner/runs'),
    execute: getFlag('--no-execute') ? false : process.env.ISSUE_RUNNER_EXECUTE !== '0',
    execMode: getArg('--exec-mode') || process.env.ISSUE_RUNNER_EXEC_MODE || 'dry-run',
    sandbox: process.env.ISSUE_RUNNER_CODEX_SANDBOX || 'workspace-write',
    timeoutMs: Number(process.env.ISSUE_RUNNER_TIMEOUT_MS || 30 * 60 * 1000),
    allowedAuthors: parseAllowedAuthors(getArg('--allowed-authors') || process.env.ISSUE_RUNNER_ALLOWED_AUTHORS || ''),
    heartbeatStalenessMs: Number(process.env.ISSUE_RUNNER_HEARTBEAT_STALENESS_MS || 5 * 60 * 1000),
    heartbeatIntervalMs: Number(process.env.ISSUE_RUNNER_HEARTBEAT_INTERVAL_MS || 10 * 60 * 1000)
  };
}

function parseAllowedAuthors(raw) {
  return String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
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

module.exports = { pollConfiguredRepos };
