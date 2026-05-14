async function pollIssues({ github, repo, label, state, executor, execute = false, runnerId = '' }) {
  const nextState = normalizeState(state);
  const issues = await github.listIssues({ repo, label });

  for (const issue of issues) {
    if (!isAssignedToRunner(issue, runnerId)) continue;

    const key = String(issue.number);
    const comments = await github.listComments(issue.number);
    if (!nextState.issues[key]) {
      const alreadyReceived = hasAgentStatus(comments, 'received');
      nextState.issues[key] = {
        status: 'received',
        title: issue.title,
        url: issue.url,
        runnerId: runnerId || '',
        allowPush: hasPushAuthorization(issue),
        answers: {},
        acknowledgedAnswerCommentIds: []
      };

      if (!alreadyReceived) {
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
    }

    nextState.issues[key].allowPush = nextState.issues[key].allowPush || hasPushAuthorization(issue);
    await recordAnswers({ github, issue, issueState: nextState.issues[key], comments });
    if (execute) {
      await executeIssue({ github, issue, issueState: nextState.issues[key], executor });
    }
  }

  return { state: nextState };
}

async function executeIssue({ github, issue, issueState, executor }) {
  if (!executor) throw new Error('executor is required when execute=true');
  if (issueState.status !== 'received') return;

  issueState.status = 'running';
  issueState.startedAt = new Date().toISOString();
  await github.commentIssue(
    issue.number,
    [
      '[agent-kanban] status: running',
      '',
      '公司電腦已開始處理此 issue。'
    ].join('\n')
  );

  try {
    const result = await executor.run(issue, issueState);
    issueState.finishedAt = new Date().toISOString();
    issueState.lastRun = result;
    issueState.status = statusForResult(result);

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

async function recordAnswers({ github, issue, issueState, comments }) {
  const acknowledged = new Set(issueState.acknowledgedAnswerCommentIds || []);
  issueState.answers = issueState.answers || {};

  for (const comment of comments) {
    const body = String(comment.body || '').trim();
    if (!isAnswerComment({ body, comment, issueState })) continue;

    issueState.answers[String(comment.id)] = {
      body,
      author: comment.author?.login || '',
      createdAt: comment.createdAt || ''
    };

    if (!acknowledged.has(comment.id)) {
      await github.commentIssue(
        issue.number,
        [
          '[agent-kanban] answer-received',
          '',
          `已收到回覆：\`${body}\``
        ].join('\n')
      );
      acknowledged.add(comment.id);
    }
  }

  if (issueState.status === 'needs-input' && acknowledged.size > (issueState.acknowledgedAnswerCommentIds || []).length) {
    issueState.status = 'received';
  }
  issueState.acknowledgedAnswerCommentIds = [...acknowledged].sort((a, b) => a - b);
}

function normalizeState(state) {
  return {
    version: 1,
    issues: { ...(state?.issues || {}) }
  };
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
  return /\/allow-push\b|commit\s*並\s*push|commit\s+and\s+push|上傳\s*git|推送\s*git|git\s*push/i.test(text);
}

function hasAgentStatus(comments, status) {
  const pattern = new RegExp(`^\\[agent-kanban\\]\\s+status:\\s+${status}\\b`, 'i');
  return comments.some((comment) => pattern.test(String(comment.body || '').trim()));
}

function isAnswerComment({ body, comment, issueState }) {
  if (!body || body.startsWith('[agent-kanban]')) return false;
  if (body.startsWith('/answer')) return true;
  if (issueState.status !== 'needs-input') return false;
  return true;
}

module.exports = { pollIssues };
