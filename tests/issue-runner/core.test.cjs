const test = require('node:test');
const assert = require('node:assert/strict');
const { pollIssues } = require('../../tools/issue-runner/lib/core.cjs');

test('pollIssues acknowledges new labeled issues once', async () => {
  const posted = [];
  const github = {
    listIssues: async () => [
      { number: 1, title: 'Build a thing', url: 'https://github.com/example/repo/issues/1' }
    ],
    listComments: async () => [],
    commentIssue: async (number, body) => posted.push({ number, body })
  };

  const first = await pollIssues({
    github,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: { issues: {} }
  });

  assert.equal(posted.length, 1);
  assert.equal(posted[0].number, 1);
  assert.match(posted[0].body, /\[agent-kanban\] status: received/);
  assert.equal(first.state.issues['1'].status, 'received');

  const second = await pollIssues({
    github,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: first.state
  });

  assert.equal(posted.length, 1);
  assert.equal(second.state.issues['1'].status, 'received');
});

test('pollIssues records slash answers and acknowledges them once', async () => {
  const posted = [];
  const github = {
    listIssues: async () => [
      { number: 2, title: 'Needs clarification', url: 'https://github.com/example/repo/issues/2' }
    ],
    listComments: async () => [
      {
        id: 101,
        body: '/answer 1',
        author: { login: 'bing751002' },
        createdAt: '2026-05-14T00:00:00Z'
      }
    ],
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const state = {
    issues: {
      2: {
        status: 'needs-input',
        answers: {},
        acknowledgedAnswerCommentIds: []
      }
    }
  };

  const first = await pollIssues({
    github,
    repo: 'example/repo',
    label: 'agent-kanban',
    state
  });

  assert.equal(first.state.issues['2'].answers['101'].body, '/answer 1');
  assert.equal(first.state.issues['2'].answers['101'].author, 'bing751002');
  assert.deepEqual(first.state.issues['2'].acknowledgedAnswerCommentIds, [101]);
  assert.equal(posted.length, 1);
  assert.match(posted[0].body, /\[agent-kanban\] answer-received/);

  const second = await pollIssues({
    github,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: first.state
  });

  assert.equal(posted.length, 1);
  assert.deepEqual(second.state.issues['2'].acknowledgedAnswerCommentIds, [101]);
});

test('pollIssues executes received issues and reports completion once', async () => {
  const posted = [];
  const executed = [];
  const github = {
    listIssues: async () => [
      {
        number: 3,
        title: 'Run Codex',
        body: 'Please inspect the project.',
        url: 'https://github.com/example/repo/issues/3'
      }
    ],
    listComments: async () => [],
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const executor = {
    run: async (issue) => {
      executed.push(issue);
      return { ok: true, summary: 'Codex completed dry run.' };
    }
  };

  const first = await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: { issues: {} },
    execute: true
  });

  assert.equal(executed.length, 1);
  assert.equal(executed[0].number, 3);
  assert.equal(first.state.issues['3'].status, 'completed');
  assert.equal(first.state.issues['3'].lastRun.ok, true);
  assert.match(posted.map((item) => item.body).join('\n'), /\[agent-kanban\] status: running/);
  assert.match(posted.map((item) => item.body).join('\n'), /\[agent-kanban\] status: completed/);

  await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: first.state,
    execute: true
  });

  assert.equal(executed.length, 1);
});

test('pollIssues reports failed execution and stores error summary', async () => {
  const posted = [];
  const github = {
    listIssues: async () => [
      {
        number: 4,
        title: 'Broken run',
        body: 'Trigger failure.',
        url: 'https://github.com/example/repo/issues/4'
      }
    ],
    listComments: async () => [],
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const executor = {
    run: async () => ({ ok: false, summary: 'Command exited with code 1.' })
  };

  const result = await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: { issues: {} },
    execute: true
  });

  assert.equal(result.state.issues['4'].status, 'failed');
  assert.equal(result.state.issues['4'].lastRun.ok, false);
  assert.match(posted.map((item) => item.body).join('\n'), /\[agent-kanban\] status: failed/);
  assert.match(posted.map((item) => item.body).join('\n'), /Command exited with code 1/);
});

test('pollIssues reports needs-input when executor asks the user a question', async () => {
  const posted = [];
  const github = {
    listIssues: async () => [
      {
        number: 5,
        title: 'Ambiguous request',
        body: 'Build a page.',
        url: 'https://github.com/example/repo/issues/5'
      }
    ],
    listComments: async () => [],
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const executor = {
    run: async () => ({ ok: true, needsInput: true, summary: '需要確認：頁面要放在哪裡？' })
  };

  const result = await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: { issues: {} },
    execute: true
  });

  assert.equal(result.state.issues['5'].status, 'needs-input');
  assert.equal(result.state.issues['5'].lastRun.needsInput, true);
  assert.match(posted.map((item) => item.body).join('\n'), /\[agent-kanban\] needs-input/);
});

test('pollIssues resumes needs-input issues from plain user comments', async () => {
  const posted = [];
  const executed = [];
  const github = {
    listIssues: async () => [
      {
        number: 6,
        title: 'Continue from answer',
        body: 'Build a page.',
        url: 'https://github.com/example/repo/issues/6'
      }
    ],
    listComments: async () => [
      {
        id: 601,
        body: '新增獨立靜態頁，能用瀏覽器開啟',
        author: { login: 'bing751002' },
        createdAt: '2026-05-14T00:05:00Z'
      }
    ],
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const executor = {
    run: async (issue, issueState) => {
      executed.push(issueState.answers['601'].body);
      return { ok: true, summary: 'Implemented.' };
    }
  };
  const state = {
    issues: {
      6: {
        status: 'needs-input',
        finishedAt: '2026-05-14T00:00:00Z',
        answers: {},
        acknowledgedAnswerCommentIds: []
      }
    }
  };

  const result = await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    state,
    execute: true
  });

  assert.deepEqual(executed, ['新增獨立靜態頁，能用瀏覽器開啟']);
  assert.equal(result.state.issues['6'].status, 'completed');
  assert.match(posted.map((item) => item.body).join('\n'), /\[agent-kanban\] answer-received/);
});
