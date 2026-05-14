const { ensureProjectDirectory, formatProjectNeedsInput, resolveIssueProject } = require('./projects.cjs');

async function pollIssues({
  github,
  repo,
  label,
  state,
  executor,
  execute = false,
  runnerId = '',
  projectConfig,
  stateKeyPrefix = '',
  ensureProject = (project) => ensureProjectDirectory({ project }),
  saveState = async () => {},
  allowedAuthors = []
}) {
  const nextState = normalizeState(state);
  const issues = await github.listIssues({ repo, label });
  const persist = () => saveState(nextState);
  const errors = [];

  for (const issue of issues) {
    if (!isAssignedToRunner(issue, runnerId)) continue;
    if (!isAllowedAuthor(issue, allowedAuthors)) {
      console.warn(`skip issue #${issue.number}: author "${issue.author?.login || ''}" not in allowedAuthors`);
      continue;
    }

    try {
      await processIssue({
        github,
        issue,
        state: nextState,
        stateKeyPrefix,
        runnerId,
        projectConfig,
        execute,
        executor,
        ensureProject,
        persist
      });
    } catch (error) {
      errors.push({ issue: issue.number, error: error.message || String(error) });
      console.error(`error processing issue #${issue.number}: ${error.message || String(error)}`);
      await persist();
    }
  }

  return { state: nextState, errors };
}

async function processIssue({
  github,
  issue,
  state,
  stateKeyPrefix,
  runnerId,
  projectConfig,
  execute,
  executor,
  ensureProject,
  persist
}) {
  const key = issueStateKey(issue.number, stateKeyPrefix);
  const legacyKey = String(issue.number);
  const comments = await github.listComments(issue.number);
  const projectResult = projectConfig ? resolveIssueProject(issue, projectConfig) : null;

  if (!state.issues[key] && stateKeyPrefix && state.issues[legacyKey]) {
    state.issues[key] = state.issues[legacyKey];
    delete state.issues[legacyKey];
    await persist();
  }

  if (!state.issues[key]) {
    state.issues[key] = createIssueState(issue, runnerId);
    reconstructStatusFromComments(state.issues[key], comments);
    await persist();

    if (!state.issues[key].recoveredFromComments && (!projectResult || projectResult.ok)) {
      await commentReceivedOnce({ github, issue, comments });
    }
  }

  const issueState = state.issues[key];

  if (projectResult && !projectResult.ok) {
    await markUnknownProject({ github, issue, issueState, comments, projectResult });
    await persist();
    return;
  }

  if (projectResult?.ok) {
    issueState.project = projectResult.project;
    issueState.projectError = '';
  }

  issueState.allowPush = issueState.allowPush || hasPushAuthorization(issue);
  await recordAnswers({ github, issue, issueState, comments });

  if (execute && issueState.status === 'received' && issueState.project) {
    const prepared = await ensureProject(issueState.project);
    if (!prepared.ok) {
      await markProjectNeedsInput({ github, issue, issueState, comments, prepared });
      await persist();
      return;
    }
    issueState.project.preparedAt = new Date().toISOString();
    issueState.project.cloned = Boolean(prepared.cloned);
  }

  if (execute) {
    await executeIssue({ github, issue, issueState, executor, persist });
  }

  await persist();
}

async function heartbeat({
  github,
  state,
  stateKeyPrefix = '',
  stalenessMs = 5 * 60 * 1000,
  intervalMs = 10 * 60 * 1000,
  now = () => new Date(),
  saveState = async () => {}
}) {
  const nextState = normalizeState(state);
  const current = now();
  const posted = [];

  for (const [key, issueState] of Object.entries(nextState.issues)) {
    if (stateKeyPrefix && !String(key).startsWith(`${stateKeyPrefix}#`)) continue;
    if (issueState.status !== 'running') continue;
    if (!issueState.startedAt) continue;

    const started = Date.parse(issueState.startedAt);
    if (Number.isNaN(started)) continue;

    const elapsedMs = current.getTime() - started;
    if (elapsedMs < stalenessMs) continue;

    const lastBeat = issueState.lastHeartbeatAt ? Date.parse(issueState.lastHeartbeatAt) : 0;
    if (lastBeat && current.getTime() - lastBeat < intervalMs) continue;

    const issueNumber = parseIssueNumberFromKey(key);
    if (!issueNumber) continue;

    const minutes = Math.round(elapsedMs / 60000);
    await github.commentIssue(
      issueNumber,
      [
        '[agent-kanban] status: still-running',
        '',
        `已執行約 ${minutes} 分鐘，Codex 仍在處理中。`,
        '',
        '若需要中止，請在同一個 issue 留言 `/cancel`。'
      ].join('\n')
    );
    issueState.lastHeartbeatAt = current.toISOString();
    posted.push({ key, minutes });
  }

  if (posted.length > 0) await saveState(nextState);
  return { state: nextState, posted };
}

async function executeIssue({ github, issue, issueState, executor, persist = async () => {} }) {
  if (!executor) throw new Error('executor is required when execute=true');
  if (issueState.status !== 'received') return;

  issueState.status = 'running';
  issueState.startedAt = new Date().toISOString();
  issueState.lastHeartbeatAt = '';
  await persist();

  await github.commentIssue(
    issue.number,
    [
      '[agent-kanban] status: running',
      '',
      '開始執行此 issue。'
    ].join('\n')
  );

  try {
    const result = await executor.run(issue, issueState);
    issueState.finishedAt = new Date().toISOString();
    issueState.lastRun = result;
    issueState.status = statusForResult(result);
    await persist();

    await github.commentIssue(
      issue.number,
      [
        issueState.status === 'needs-input'
          ? '[agent-kanban] needs-input'
          : `[agent-kanban] status: ${issueState.status}`,
        '',
        truncate(result.summary || '', 4000)
      ].join('\n').trim()
    );
  } catch (error) {
    const summary = error.message || String(error);
    issueState.finishedAt = new Date().toISOString();
    issueState.status = 'failed';
    issueState.lastRun = { ok: false, summary };
    await persist();

    await github.commentIssue(
      issue.number,
      [
        '[agent-kanban] status: failed',
        '',
        truncate(summary, 4000)
      ].join('\n')
    );
  }
}

async function markProjectNeedsInput({ github, issue, issueState, comments, prepared }) {
  issueState.status = 'needs-input';
  issueState.projectError = prepared.reason || 'project-not-ready';
  issueState.lastRun = {
    ok: true,
    needsInput: true,
    summary: prepared.summary || 'project is not ready'
  };

  if (hasAgentNeedsInput(comments, prepared.summary || issueState.projectError)) return;

  await github.commentIssue(
    issue.number,
    [
      '[agent-kanban] needs-input',
      '',
      truncate(prepared.summary || 'project is not ready', 4000)
    ].join('\n')
  );
}

async function markUnknownProject({ github, issue, issueState, comments, projectResult }) {
  const summary = formatProjectNeedsInput(projectResult);
  issueState.status = 'needs-input';
  issueState.projectError = projectResult.reason;
  issueState.project = null;
  issueState.lastRun = {
    ok: true,
    needsInput: true,
    summary
  };

  if (hasAgentNeedsInputForProject(comments, projectResult.requested)) return;

  await github.commentIssue(issue.number, ['[agent-kanban] needs-input', '', summary].join('\n'));
}

async function recordAnswers({ github, issue, issueState, comments }) {
  const acknowledged = new Set(issueState.acknowledgedAnswerCommentIds || []);
  issueState.answers = issueState.answers || {};

  for (const comment of comments) {
    const body = String(comment.body || '').trim();
    if (!isAnswerComment({ body, issueState })) continue;

    issueState.answers[String(comment.id)] = {
      body,
      author: comment.author?.login || '',
      createdAt: comment.createdAt || ''
    };

    if (!acknowledged.has(comment.id)) {
      await github.commentIssue(issue.number, ['[agent-kanban] answer-received', '', `已收到你的回覆：\`${body}\``].join('\n'));
      acknowledged.add(comment.id);
    }
  }

  if (issueState.status === 'needs-input' && acknowledged.size > (issueState.acknowledgedAnswerCommentIds || []).length) {
    issueState.status = 'received';
  }
  issueState.acknowledgedAnswerCommentIds = [...acknowledged].sort((a, b) => a - b);
}

function createIssueState(issue, runnerId) {
  return {
    status: 'received',
    title: issue.title,
    url: issue.url,
    runnerId: runnerId || '',
    engine: extractEngineDirective(issue.body || ''),
    allowPush: hasPushAuthorization(issue),
    answers: {},
    acknowledgedAnswerCommentIds: []
  };
}

function extractEngineDirective(text) {
  const match = String(text).match(/^\s*\/engine\s+(codex|claude-code|claude|dry-run)\s*$/im);
  if (!match) return '';
  const value = match[1].toLowerCase();
  return value === 'claude' ? 'claude-code' : value;
}

function reconstructStatusFromComments(issueState, comments) {
  let recovered = '';
  let runningCommentAt = '';
  for (const comment of comments) {
    const body = String(comment.body || '').trim();
    const match = body.match(/^\[agent-kanban\]\s+(?:status:\s+(running|completed|failed|cancelled)|(needs-input))\b/i);
    if (!match) continue;
    recovered = (match[1] || match[2]).toLowerCase();
    if (recovered === 'running' && comment.createdAt) runningCommentAt = comment.createdAt;
  }
  if (!recovered) return;
  issueState.status = recovered;
  issueState.recoveredFromComments = true;
  if (recovered === 'running' && runningCommentAt) {
    issueState.startedAt = runningCommentAt;
  }
}

function normalizeState(state) {
  return { version: 1, issues: { ...(state?.issues || {}) } };
}

function truncate(value, maxLength) {
  const text = String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 20)}\n...[truncated]`;
}

function statusForResult(result) {
  if (!result.ok) return 'failed';
  if (result.needsInput) return 'needs-input';
  return 'completed';
}

function issueStateKey(issueNumber, prefix) {
  return prefix ? `${prefix}#${issueNumber}` : String(issueNumber);
}

function parseIssueNumberFromKey(key) {
  const match = String(key).match(/(?:^|#)(\d+)$/);
  return match ? Number(match[1]) : null;
}

function isAssignedToRunner(issue, runnerId) {
  if (!runnerId) return true;
  const requested = extractBotDirective(issue.body || '');
  if (!requested) return true;
  return requested.toLowerCase() === runnerId.toLowerCase();
}

function extractBotDirective(text) {
  const match = String(text).match(/^\s*\/bot\s+([A-Za-z0-9_.-]+)\s*$/im);
  return match ? match[1] : '';
}

function hasPushAuthorization(issue) {
  const text = `${issue.title || ''}\n${issue.body || ''}`;
  return /\/allow-push\b|commit\s*(?:並|and)?\s*push|上傳\s*git|git\s*push/i.test(text);
}

function hasAgentStatus(comments, status) {
  const pattern = new RegExp(`^\\[agent-kanban\\]\\s+status:\\s+${status}\\b`, 'i');
  return comments.some((comment) => pattern.test(String(comment.body || '').trim()));
}

function hasAgentNeedsInputForProject(comments, requestedProject) {
  return comments.some((comment) => {
    const body = String(comment.body || '').trim();
    return body.startsWith('[agent-kanban] needs-input') && body.includes(`\`${requestedProject}\``);
  });
}

function hasAgentNeedsInput(comments, text) {
  const marker = String(text || '').slice(0, 80);
  return comments.some((comment) => {
    const body = String(comment.body || '').trim();
    return body.startsWith('[agent-kanban] needs-input') && (!marker || body.includes(marker));
  });
}

function isAnswerComment({ body, issueState }) {
  if (!body || body.startsWith('[agent-kanban]')) return false;
  if (body.startsWith('/answer')) return true;
  if (issueState.status !== 'needs-input') return false;
  return true;
}

function isAllowedAuthor(issue, allowedAuthors) {
  if (!allowedAuthors || allowedAuthors.length === 0) return true;
  const author = String(issue.author?.login || '').toLowerCase();
  if (!author) return false;
  return allowedAuthors.some((name) => String(name).toLowerCase() === author);
}

async function commentReceivedOnce({ github, issue, comments }) {
  if (hasAgentStatus(comments, 'received')) return;
  await github.commentIssue(
    issue.number,
    [
      '[agent-kanban] status: received',
      '',
      '已收到此需求。公司電腦上的 issue runner 已建立本機追蹤狀態。',
      '',
      '後續如果需要你補充資訊，runner 會在同一個 issue 留下 `[agent-kanban] needs-input`。'
    ].join('\n')
  );
}

module.exports = { pollIssues, heartbeat };
