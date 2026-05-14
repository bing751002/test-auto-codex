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
