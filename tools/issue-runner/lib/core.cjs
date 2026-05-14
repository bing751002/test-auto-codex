async function pollIssues({ github, repo, label, state }) {
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
  }

  return { state: nextState };
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

module.exports = { pollIssues };
