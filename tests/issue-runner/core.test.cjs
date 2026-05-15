const test = require('node:test');
const assert = require('node:assert/strict');
const { pollIssues, heartbeat } = require('../../tools/issue-runner/lib/core.cjs');

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

test('pollIssues reopens completed issues when the user adds a follow-up comment', async () => {
  const posted = [];
  const executed = [];
  const github = {
    listIssues: async () => [
      {
        number: 13,
        title: 'Follow up after answer',
        body: '請先回答一次。',
        url: 'https://github.com/example/repo/issues/13'
      }
    ],
    listComments: async () => [
      {
        id: 1301,
        body: '[agent-kanban] status: completed\n\n第一次回答完成。',
        author: { login: 'github-actions[bot]' },
        createdAt: '2026-05-14T00:10:00Z'
      },
      {
        id: 1302,
        body: '我補充追問：請再說明第二點。',
        author: { login: 'bing751002' },
        createdAt: '2026-05-14T00:15:00Z'
      }
    ],
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const executor = {
    run: async (_issue, issueState) => {
      executed.push({
        status: issueState.status,
        followUp: issueState.answers['1302']?.body
      });
      return { ok: true, summary: 'Follow-up answered.' };
    }
  };
  const state = {
    issues: {
      13: {
        status: 'completed',
        finishedAt: '2026-05-14T00:10:00Z',
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

  assert.deepEqual(executed, [
    {
      status: 'running',
      followUp: '我補充追問：請再說明第二點。'
    }
  ]);
  assert.equal(result.state.issues['13'].status, 'completed');
  assert.equal(result.state.issues['13'].answers['1302'].body, '我補充追問：請再說明第二點。');
  assert.match(posted.map((item) => item.body).join('\n'), /\[agent-kanban\] answer-received/);
  assert.match(posted.map((item) => item.body).join('\n'), /Follow-up answered/);
});

test('pollIssues only records follow-up comments created after the completed run', async () => {
  const executed = [];
  const github = {
    listIssues: async () => [
      {
        number: 14,
        title: 'Follow up with old chatter',
        body: '請先回答一次。',
        url: 'https://github.com/example/repo/issues/14'
      }
    ],
    listComments: async () => [
      {
        id: 1401,
        body: '這是完成前的補充，不應在追問時重送。',
        author: { login: 'bing751002' },
        createdAt: '2026-05-14T00:05:00Z'
      },
      {
        id: 1402,
        body: '[agent-kanban] status: completed\n\n第一次回答完成。',
        author: { login: 'github-actions[bot]' },
        createdAt: '2026-05-14T00:10:00Z'
      },
      {
        id: 1403,
        body: '完成後的新追問。',
        author: { login: 'bing751002' },
        createdAt: '2026-05-14T00:15:00Z'
      }
    ],
    commentIssue: async () => {}
  };
  const executor = {
    run: async (_issue, issueState) => {
      executed.push(Object.keys(issueState.answers).sort());
      return { ok: true, summary: 'Follow-up answered.' };
    }
  };

  const result = await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: {
      issues: {
        14: {
          status: 'completed',
          finishedAt: '2026-05-14T00:10:00Z',
          answers: {},
          acknowledgedAnswerCommentIds: []
        }
      }
    },
    execute: true
  });

  assert.deepEqual(executed, [['1403']]);
  assert.equal(result.state.issues['14'].answers['1401'], undefined);
  assert.equal(result.state.issues['14'].answers['1403'].body, '完成後的新追問。');
});

test('pollIssues executes multiple received issues concurrently when worker limit allows it', async () => {
  const posted = [];
  const started = [];
  let releaseFirst;
  let releaseSecond;
  let resolveBothStarted;
  const firstDone = new Promise((resolve) => { releaseFirst = resolve; });
  const secondDone = new Promise((resolve) => { releaseSecond = resolve; });
  const bothStarted = new Promise((resolve) => { resolveBothStarted = resolve; });
  const github = {
    listIssues: async () => [
      { number: 301, title: 'Slow A', body: 'Build A.', url: 'u301' },
      { number: 302, title: 'Slow B', body: 'Build B.', url: 'u302' }
    ],
    listComments: async () => [],
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const executor = {
    run: async (issue) => {
      started.push(issue.number);
      if (started.length === 2) resolveBothStarted();
      if (issue.number === 301) await firstDone;
      if (issue.number === 302) await secondDone;
      return { ok: true, summary: `done ${issue.number}` };
    }
  };

  const pollPromise = pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: { issues: {} },
    execute: true,
    maxConcurrentIssues: 2
  });

  await waitForSignal(bothStarted, 2000, 'both issue executors should start before either one completes');
  assert.deepEqual(started.sort(), [301, 302]);
  assert.equal(posted.filter((item) => /\[agent-kanban\] status: running/.test(item.body)).length, 2);

  releaseFirst();
  releaseSecond();

  const result = await pollPromise;
  assert.equal(result.state.issues['301'].status, 'completed');
  assert.equal(result.state.issues['302'].status, 'completed');
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

test('pollIssues only handles issues assigned to this runner id', async () => {
  const posted = [];
  const executed = [];
  const github = {
    listIssues: async () => [
      {
        number: 7,
        title: 'For office runner',
        body: '/bot office-pc\nBuild this.',
        url: 'https://github.com/example/repo/issues/7'
      },
      {
        number: 8,
        title: 'For home runner',
        body: '/bot home-pc\nBuild this.',
        url: 'https://github.com/example/repo/issues/8'
      }
    ],
    listComments: async () => [],
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const executor = {
    run: async (issue) => {
      executed.push(issue.number);
      return { ok: true, summary: 'done' };
    }
  };

  const result = await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    runnerId: 'office-pc',
    state: { issues: {} },
    execute: true
  });

  assert.deepEqual(executed, [7]);
  assert.equal(result.state.issues['7'].status, 'completed');
  assert.equal(result.state.issues['8'], undefined);
  assert.equal(posted.some((item) => item.number === 8), false);
});

test('pollIssues passes allowPush to executor when issue explicitly authorizes git upload', async () => {
  const seen = [];
  const github = {
    listIssues: async () => [
      {
        number: 9,
        title: 'Upload changes',
        body: '請完成後 commit 並 push，上傳 git。\n/bot office-pc',
        url: 'https://github.com/example/repo/issues/9'
      }
    ],
    listComments: async () => [],
    commentIssue: async () => {}
  };
  const executor = {
    run: async (issue, issueState) => {
      seen.push(issueState.allowPush);
      return { ok: true, summary: 'done' };
    }
  };

  await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    runnerId: 'office-pc',
    state: { issues: {} },
    execute: true
  });

  assert.deepEqual(seen, [true]);
});

test('pollIssues does not allow push from unchecked issue form checkbox text', async () => {
  const seen = [];
  const github = {
    listIssues: async () => [
      {
        number: 91,
        title: 'Unchecked push',
        body: [
          '### Git push',
          '',
          '- [ ] /allow-push - 完成後允許 runner commit 並 push'
        ].join('\n'),
        url: 'https://github.com/example/repo/issues/91'
      }
    ],
    listComments: async () => [],
    commentIssue: async () => {}
  };
  const executor = {
    run: async (_issue, issueState) => {
      seen.push(issueState.allowPush);
      return { ok: true, summary: 'done' };
    }
  };

  await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: { issues: {} },
    execute: true
  });

  assert.deepEqual(seen, [false]);
});

test('pollIssues does not duplicate received comment when issue already has runner receipt', async () => {
  const posted = [];
  const executed = [];
  const github = {
    listIssues: async () => [
      {
        number: 10,
        title: 'Already received',
        body: '/bot office-pc\nBuild this.',
        url: 'https://github.com/example/repo/issues/10'
      }
    ],
    listComments: async () => [
      {
        id: 1001,
        body: '[agent-kanban] status: received\n\n已收到此需求。',
        author: { login: 'bing751002' },
        createdAt: '2026-05-14T00:00:00Z'
      }
    ],
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const executor = {
    run: async (issue) => {
      executed.push(issue.number);
      return { ok: true, summary: 'done' };
    }
  };

  const result = await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    runnerId: 'office-pc',
    state: { issues: {} },
    execute: true
  });

  assert.deepEqual(executed, [10]);
  assert.equal(result.state.issues['10'].status, 'completed');
  assert.equal(posted.some((item) => /\[agent-kanban\] status: received/.test(item.body)), false);
  assert.equal(posted.some((item) => /\[agent-kanban\] status: running/.test(item.body)), true);
});

test('pollIssues persists state after each issue and before/after executor runs', async () => {
  const snapshots = [];
  const github = {
    listIssues: async () => [
      { number: 11, title: 'A', url: 'https://github.com/example/repo/issues/11' },
      { number: 12, title: 'B', url: 'https://github.com/example/repo/issues/12' }
    ],
    listComments: async () => [],
    commentIssue: async () => {}
  };
  const executor = {
    run: async (issue, issueState) => {
      snapshots.push({ tag: `executor-running-${issue.number}`, status: issueState.status });
      return { ok: true, summary: 'done' };
    }
  };

  await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: { issues: {} },
    execute: true,
    saveState: async (next) => {
      snapshots.push({
        tag: 'saved',
        keys: Object.keys(next.issues).sort(),
        statuses: Object.fromEntries(
          Object.entries(next.issues).map(([k, v]) => [k, v.status])
        )
      });
    }
  });

  const runningSeenByExecutor = snapshots.find((s) => s.tag === 'executor-running-11');
  assert.equal(runningSeenByExecutor.status, 'running');

  const persistedBeforeIssue12 = snapshots
    .filter((s) => s.tag === 'saved')
    .some((s) => s.keys.includes('11') && !s.keys.includes('12'));
  assert.equal(persistedBeforeIssue12, true, 'state for issue 11 must be persisted before issue 12 is processed');

  const runningPersisted = snapshots
    .filter((s) => s.tag === 'saved')
    .some((s) => s.statuses['11'] === 'running');
  assert.equal(runningPersisted, true, 'running status must be persisted before executor.run completes');
});

test('pollIssues continues to next issue when one issue throws', async () => {
  const posted = [];
  const executed = [];
  const github = {
    listIssues: async () => [
      { number: 20, title: 'Broken', url: 'https://github.com/example/repo/issues/20' },
      { number: 21, title: 'OK', url: 'https://github.com/example/repo/issues/21' }
    ],
    listComments: async (number) => {
      if (number === 20) throw new Error('gh api transient failure');
      return [];
    },
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const executor = {
    run: async (issue) => {
      executed.push(issue.number);
      return { ok: true, summary: 'done' };
    }
  };

  const result = await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: { issues: {} },
    execute: true
  });

  assert.deepEqual(executed, [21]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].issue, 20);
});

test('pollIssues filters issues by allowedAuthors when configured', async () => {
  const executed = [];
  const github = {
    listIssues: async () => [
      { number: 30, title: 'Mine', body: '', author: { login: 'bing751002' }, url: 'https://github.com/example/repo/issues/30' },
      { number: 31, title: 'Stranger', body: '', author: { login: 'random-user' }, url: 'https://github.com/example/repo/issues/31' }
    ],
    listComments: async () => [],
    commentIssue: async () => {}
  };
  const executor = {
    run: async (issue) => {
      executed.push(issue.number);
      return { ok: true, summary: 'done' };
    }
  };

  const result = await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: { issues: {} },
    execute: true,
    allowedAuthors: ['bing751002']
  });

  assert.deepEqual(executed, [30]);
  assert.equal(result.state.issues['31'], undefined);
});

test('pollIssues drops legacy unprefixed state after migrating to repo-namespaced key', async () => {
  const github = {
    listIssues: async () => [
      { number: 4, title: 'Legacy', url: 'https://github.com/example/repo/issues/4' }
    ],
    listComments: async () => [],
    commentIssue: async () => {}
  };
  const state = {
    issues: {
      4: { status: 'completed', title: 'Legacy', allowPush: false }
    }
  };

  const result = await pollIssues({
    github,
    repo: 'example/repo',
    label: 'agent-kanban',
    state,
    stateKeyPrefix: 'example/repo'
  });

  assert.equal(result.state.issues['4'], undefined);
  assert.equal(result.state.issues['example/repo#4'].status, 'completed');
});

test('pollIssues keeps terminal local state idle when there is no user follow-up comment', async () => {
  let listCommentsCalled = false;
  const github = {
    listIssues: async () => [
      { number: 41, title: 'Done already', url: 'https://github.com/example/repo/issues/41' }
    ],
    listComments: async () => {
      listCommentsCalled = true;
      return [
        {
          id: 4101,
          body: '[agent-kanban] status: completed\n\ndone',
          author: { login: 'github-actions[bot]' },
          createdAt: '2026-05-14T00:00:00Z'
        }
      ];
    },
    commentIssue: async () => {}
  };

  const result = await pollIssues({
    github,
    repo: 'example/repo',
    label: 'agent-kanban',
    stateKeyPrefix: 'example/repo',
    state: {
      issues: {
        'example/repo#41': { status: 'completed', title: 'Done already' }
      }
    },
    execute: true,
    executor: {
      run: async () => {
        throw new Error('should not execute completed issue');
      }
    }
  });

  assert.equal(listCommentsCalled, true);
  assert.equal(result.state.issues['example/repo#41'].status, 'completed');
});

test('heartbeat posts still-running comment for stale running issues', async () => {
  const posted = [];
  const github = {
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const now = new Date('2026-05-14T14:00:00Z');
  const startedAt = new Date(now.getTime() - 12 * 60 * 1000).toISOString();
  const state = {
    issues: {
      'bing751002/test-auto-codex#5': {
        status: 'running',
        startedAt
      }
    }
  };

  const result = await heartbeat({
    github,
    state,
    stalenessMs: 5 * 60 * 1000,
    intervalMs: 10 * 60 * 1000,
    now: () => now
  });

  assert.equal(posted.length, 1);
  assert.equal(posted[0].number, 5);
  assert.match(posted[0].body, /\[agent-kanban\] status: still-running/);
  assert.match(posted[0].body, /已執行約 12 分鐘/);
  assert.equal(result.state.issues['bing751002/test-auto-codex#5'].lastHeartbeatAt, now.toISOString());
});

test('heartbeat does not repeat within intervalMs', async () => {
  const posted = [];
  const github = {
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const now = new Date('2026-05-14T14:00:00Z');
  const state = {
    issues: {
      'r#7': {
        status: 'running',
        startedAt: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
        lastHeartbeatAt: new Date(now.getTime() - 4 * 60 * 1000).toISOString()
      }
    }
  };

  await heartbeat({
    github,
    state,
    stalenessMs: 5 * 60 * 1000,
    intervalMs: 10 * 60 * 1000,
    now: () => now
  });

  assert.equal(posted.length, 0);
});

test('heartbeat only posts for matching repo prefix when configured', async () => {
  const posted = [];
  const github = {
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const now = new Date('2026-05-14T14:00:00Z');
  const startedAt = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
  const state = {
    issues: {
      'owner/a#1': { status: 'running', startedAt },
      'owner/b#2': { status: 'running', startedAt }
    }
  };

  await heartbeat({
    github,
    state,
    stateKeyPrefix: 'owner/b',
    stalenessMs: 5 * 60 * 1000,
    intervalMs: 10 * 60 * 1000,
    now: () => now
  });

  assert.deepEqual(posted.map((item) => item.number), [2]);
});

test('pollIssues records /engine directive on issueState at creation time', async () => {
  const captured = [];
  const github = {
    listIssues: async () => [
      { number: 40, title: 'Use claude', body: '/engine claude-code\n做這個事', url: 'u40' },
      { number: 41, title: 'Use codex', body: '/engine codex\n做那個事', url: 'u41' },
      { number: 42, title: 'No engine', body: '預設引擎', url: 'u42' }
    ],
    listComments: async () => [],
    commentIssue: async () => {}
  };
  const executor = {
    run: async (issue, issueState) => {
      captured.push({ n: issue.number, engine: issueState.engine });
      return { ok: true, summary: 'done' };
    }
  };

  await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: { issues: {} },
    execute: true
  });

  const byNumber = Object.fromEntries(captured.map((c) => [c.n, c.engine]));
  assert.equal(byNumber[40], 'claude-code');
  assert.equal(byNumber[41], 'codex');
  assert.equal(byNumber[42], '');
});

test('received comment surfaces engine, mode, project, allow-push, runner', async () => {
  const posted = [];
  const github = {
    listIssues: async () => [
      {
        number: 70,
        title: 'show plan',
        body: '/bot office-pc\n/engine claude-code\n/mode answer\n/allow-push\n做這個事',
        url: 'u70'
      }
    ],
    listComments: async () => [],
    commentIssue: async (number, body) => posted.push({ number, body })
  };

  await pollIssues({
    github,
    repo: 'example/repo',
    label: 'agent-kanban',
    runnerId: 'office-pc',
    state: { issues: {} }
  });

  const received = posted.find((p) => /\[agent-kanban\] status: received/.test(p.body));
  assert.ok(received, 'expected a received comment');
  assert.match(received.body, /Engine: claude-code/);
  assert.match(received.body, /Mode: answer/);
  assert.match(received.body, /Allow push: yes/);
  assert.match(received.body, /Runner: office-pc/);
});

test('running comment includes engine and mode', async () => {
  const posted = [];
  const github = {
    listIssues: async () => [
      { number: 71, title: 'running label', body: '/engine claude-code\n/mode answer\n做', url: 'u71' }
    ],
    listComments: async () => [],
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const executor = { run: async () => ({ ok: true, summary: 'done' }) };

  await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: { issues: {} },
    execute: true
  });

  const running = posted.find((p) => /\[agent-kanban\] status: running/.test(p.body));
  assert.ok(running);
  assert.match(running.body, /engine=claude-code/);
  assert.match(running.body, /mode=answer/);
});

test('heartbeat uses engine name from issueState instead of hardcoded Codex', async () => {
  const posted = [];
  const github = {
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const now = new Date('2026-05-14T14:00:00Z');
  const startedAt = new Date(now.getTime() - 12 * 60 * 1000).toISOString();
  const state = {
    issues: {
      'r#5': { status: 'running', startedAt, engine: 'claude-code' }
    }
  };

  await heartbeat({
    github,
    state,
    stalenessMs: 5 * 60 * 1000,
    intervalMs: 10 * 60 * 1000,
    now: () => now
  });

  assert.equal(posted.length, 1);
  assert.match(posted[0].body, /claude-code 仍在處理中/);
});

test('pollIssues maps executor timedOut to timed-out status separately from failed', async () => {
  const posted = [];
  const github = {
    listIssues: async () => [
      { number: 90, title: 'long task', body: '', url: 'u90' }
    ],
    listComments: async () => [],
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const executor = {
    run: async () => ({
      ok: false,
      timedOut: true,
      summary: '## Final Message\n答案 ...（內容寫到一半 timeout）'
    })
  };

  const result = await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: { issues: {} },
    execute: true
  });

  assert.equal(result.state.issues['90'].status, 'timed-out');
  const bodies = posted.map((p) => p.body).join('\n');
  assert.match(bodies, /\[agent-kanban\] status: timed-out/);
  assert.match(bodies, /Final Message/);
});

test('pollIssues records /mode directive and Task type form section', async () => {
  const captured = [];
  const formBody = [
    '### Runner',
    '',
    'office-pc',
    '',
    '### Task type',
    '',
    'answer (查詢／計算／研究)'
  ].join('\n');
  const github = {
    listIssues: async () => [
      { number: 80, title: 'slash mode', body: '/bot office-pc\n/mode answer\n計算多少個', url: 'u80' },
      { number: 81, title: 'form mode', body: formBody, url: 'u81' },
      { number: 82, title: 'default mode', body: '/bot office-pc\n做這個', url: 'u82' },
      { number: 83, title: 'dev explicit', body: '/bot office-pc\n/mode dev\n做開發', url: 'u83' }
    ],
    listComments: async () => [],
    commentIssue: async () => {}
  };
  const executor = {
    run: async (issue, issueState) => {
      captured.push({ n: issue.number, mode: issueState.mode });
      return { ok: true, summary: 'done' };
    }
  };

  await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    runnerId: 'office-pc',
    state: { issues: {} },
    execute: true
  });

  const byNumber = Object.fromEntries(captured.map((c) => [c.n, c.mode]));
  assert.equal(byNumber[80], 'answer');
  assert.equal(byNumber[81], 'answer');
  assert.equal(byNumber[82], '');
  assert.equal(byNumber[83], 'dev');
});

test('pollIssues parses GitHub Issue Form section bodies for runner/engine/push', async () => {
  const captured = [];
  const formBody = [
    '### Runner',
    '',
    'office-pc',
    '',
    '### Engine',
    '',
    'claude-code',
    '',
    '### 需求內容',
    '',
    '做這個事',
    '',
    '### Git push',
    '',
    '- [x] /allow-push - 完成後允許 runner commit 並 push'
  ].join('\n');
  const skippedFormBody = [
    '### Runner',
    '',
    'office-pc',
    '',
    '### Engine',
    '',
    'Default',
    '',
    '### Git push',
    '',
    '- [ ] /allow-push - 完成後允許 runner commit 並 push'
  ].join('\n');
  const github = {
    listIssues: async () => [
      { number: 60, title: 'form A', body: formBody, url: 'u60' },
      { number: 61, title: 'form B (default engine, no push)', body: skippedFormBody, url: 'u61' }
    ],
    listComments: async () => [],
    commentIssue: async () => {}
  };
  const executor = {
    run: async (issue, issueState) => {
      captured.push({ n: issue.number, engine: issueState.engine, allowPush: issueState.allowPush });
      return { ok: true, summary: 'done' };
    }
  };

  await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    runnerId: 'office-pc',
    state: { issues: {} },
    execute: true
  });

  const byNumber = Object.fromEntries(captured.map((c) => [c.n, c]));
  assert.equal(byNumber[60].engine, 'claude-code');
  assert.equal(byNumber[60].allowPush, true);
  assert.equal(byNumber[61].engine, '');
  assert.equal(byNumber[61].allowPush, false);
});

test('pollIssues recovers status from GitHub comments when local state is lost', async () => {
  const executed = [];
  const posted = [];
  const github = {
    listIssues: async () => [
      { number: 5, title: 'Stuck running', body: 'do thing', url: 'https://github.com/example/repo/issues/5' }
    ],
    listComments: async () => [
      { id: 9001, body: '[agent-kanban] status: received', author: { login: 'bot' }, createdAt: '2026-05-14T13:00:00Z' },
      { id: 9002, body: '[agent-kanban] status: running\n\n開始執行此 issue。', author: { login: 'bot' }, createdAt: '2026-05-14T13:05:00Z' }
    ],
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const executor = {
    run: async (issue) => { executed.push(issue.number); return { ok: true, summary: 'done' }; }
  };

  const result = await pollIssues({
    github,
    executor,
    repo: 'example/repo',
    label: 'agent-kanban',
    state: { issues: {} },
    execute: true
  });

  assert.deepEqual(executed, []);
  assert.equal(result.state.issues['5'].status, 'running');
  assert.equal(result.state.issues['5'].recoveredFromComments, true);
  assert.equal(posted.some((item) => /\[agent-kanban\] status: running/.test(item.body)), false);
});

test('heartbeat skips non-running issues', async () => {
  const posted = [];
  const github = {
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const now = new Date('2026-05-14T14:00:00Z');
  const state = {
    issues: {
      'r#8': { status: 'completed', startedAt: '2026-05-14T13:00:00Z' },
      'r#9': { status: 'received' }
    }
  };

  await heartbeat({ github, state, now: () => now });

  assert.equal(posted.length, 0);
});

async function waitForSignal(signal, timeoutMs, message) {
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new assert.AssertionError({ message })), timeoutMs);
  });
  try {
    await Promise.race([signal, timeout]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}
