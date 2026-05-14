async function pollIssues({ github, repo, label, state, executor, execute = false }) {
  const nextState = normalizeState(state);
  const issues = await github.listIssues({ repo, label });

  for (const issue of issues) {
    const key = String(issue.number);
    if (!nextState.issues[key]) {
      nextState.issues[key] = {
        status: 'received',
        title: issue.title,
        url: issue.url,
        answers: {},
        acknowledgedAnswerCommentIds: []
      };

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

    await recordAnswers({ github, issue, issueState: nextState.issues[key] });
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
    const result = await executor.run(issue);
    issueState.finishedAt = new Date().toISOString();
    issueState.lastRun = result;
    issueState.status = result.ok ? 'completed' : 'failed';

    await github.commentIssue(
      issue.number,
      [
        `[agent-kanban] status: ${issueState.status}`,
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

async function recordAnswers({ github, issue, issueState }) {
  const comments = await github.listComments(issue.number);
  const acknowledged = new Set(issueState.acknowledgedAnswerCommentIds || []);
  issueState.answers = issueState.answers || {};

  for (const comment of comments) {
    const body = String(comment.body || '').trim();
    if (!body.startsWith('/answer')) continue;

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

module.exports = { pollIssues };
