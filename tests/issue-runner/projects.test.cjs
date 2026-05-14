const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { pollConfiguredRepos } = require('../../tools/issue-runner/runner.cjs');
const { pollIssues } = require('../../tools/issue-runner/lib/core.cjs');
const {
  extractProjectDirective,
  ensureProjectDirectory,
  projectConfigForRepo,
  readProjectConfig,
  resolveRepoPlans,
  resolveIssueProject
} = require('../../tools/issue-runner/lib/projects.cjs');

test('extractProjectDirective reads slash project directive from issue body', () => {
  assert.equal(extractProjectDirective('/bot office-pc\n/project customer-api\nDo work.'), 'customer-api');
  assert.equal(extractProjectDirective('No project here.'), '');
});

test('readProjectConfig falls back to current repo when no project config exists', () => {
  const missingPath = path.join(os.tmpdir(), `missing-projects-${Date.now()}.json`);
  const config = readProjectConfig(missingPath, 'D:\\agent-kanban-system');

  assert.equal(config.defaultProject, 'default');
  assert.deepEqual(config.projects.default, { path: 'D:\\agent-kanban-system' });
});

test('resolveIssueProject uses default project when issue does not specify one', () => {
  const result = resolveIssueProject(
    { body: 'Build something.' },
    {
      defaultProject: 'agent-kanban-system',
      projects: {
        'agent-kanban-system': { path: 'D:\\agent-kanban-system' }
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.project.name, 'agent-kanban-system');
  assert.equal(result.project.path, 'D:\\agent-kanban-system');
});

test('resolveRepoPlans polls configured repos and maps each repo to its default project', () => {
  const config = {
    defaultProject: 'agent-kanban-system',
    projects: {
      'agent-kanban-system': { path: 'D:\\agent-kanban-system' },
      'customer-api': { path: 'D:\\work\\customer-api' }
    },
    repos: {
      'bing751002/test-auto-codex': { project: 'agent-kanban-system' },
      'acme/customer-api': { project: 'customer-api' }
    }
  };

  assert.deepEqual(resolveRepoPlans('bing751002/test-auto-codex', config), [
    {
      repo: 'bing751002/test-auto-codex',
      defaultProject: 'agent-kanban-system',
      repoConfig: { project: 'agent-kanban-system' }
    },
    {
      repo: 'acme/customer-api',
      defaultProject: 'customer-api',
      repoConfig: { project: 'customer-api' }
    }
  ]);
});

test('projectConfigForRepo makes repo project the issue default project', () => {
  const config = {
    defaultProject: 'agent-kanban-system',
    projects: {
      'agent-kanban-system': { path: 'D:\\agent-kanban-system' },
      'customer-api': { path: 'D:\\work\\customer-api' }
    },
    repos: {}
  };

  const repoConfig = projectConfigForRepo(config, {
    repo: 'acme/customer-api',
    defaultProject: 'customer-api'
  });
  const result = resolveIssueProject({ body: 'Build from repo issue.' }, repoConfig);

  assert.equal(result.ok, true);
  assert.deepEqual(result.project, { name: 'customer-api', path: 'D:\\work\\customer-api' });
});

test('projectConfigForRepo can derive repo project path from workspace root', () => {
  const config = {
    defaultProject: 'agent-kanban-system',
    workspaceRoot: 'D:\\work',
    cloneIfMissing: true,
    projects: {
      'agent-kanban-system': { path: 'D:\\agent-kanban-system' }
    },
    repos: {}
  };

  const repoConfig = projectConfigForRepo(config, {
    repo: 'acme/customer-api',
    defaultProject: 'customer-api',
    repoConfig: { cloneIfMissing: true }
  });
  const result = resolveIssueProject({ body: 'Build from repo issue.' }, repoConfig);

  assert.equal(result.ok, true);
  assert.deepEqual(result.project, {
    name: 'customer-api',
    path: 'D:\\work\\customer-api',
    repo: 'acme/customer-api',
    cloneIfMissing: true
  });
});

test('ensureProjectDirectory clones configured repo when local folder is missing', async () => {
  const tempRoot = path.join(os.tmpdir(), `issue-runner-clone-${Date.now()}`);
  const projectPath = path.join(tempRoot, 'customer-api');
  const commands = [];

  const result = await ensureProjectDirectory({
    project: {
      name: 'customer-api',
      path: projectPath,
      repo: 'acme/customer-api',
      cloneIfMissing: true
    },
    runCommand: async (command, args) => commands.push({ command, args })
  });

  assert.equal(result.ok, true);
  assert.equal(result.cloned, true);
  assert.deepEqual(commands, [
    { command: 'gh', args: ['repo', 'clone', 'acme/customer-api', projectPath] }
  ]);
});

test('ensureProjectDirectory asks for input when folder is missing and clone is disabled', async () => {
  const result = await ensureProjectDirectory({
    project: {
      name: 'customer-api',
      path: path.join(os.tmpdir(), `missing-project-${Date.now()}`),
      repo: 'acme/customer-api',
      cloneIfMissing: false
    },
    runCommand: async () => {
      throw new Error('should not clone');
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-project-directory');
  assert.match(result.summary, /customer-api/);
});

test('pollIssues can namespace state by repo to avoid issue number collisions', async () => {
  const github = {
    listIssues: async () => [
      {
        number: 1,
        title: 'Repo local issue one',
        body: 'Build this.',
        url: 'https://github.com/acme/customer-api/issues/1'
      }
    ],
    listComments: async () => [],
    commentIssue: async () => {}
  };

  const result = await pollIssues({
    github,
    repo: 'acme/customer-api',
    label: 'agent-kanban',
    state: { issues: {} },
    stateKeyPrefix: 'acme/customer-api'
  });

  assert.equal(result.state.issues['acme/customer-api#1'].status, 'received');
  assert.equal(result.state.issues['1'], undefined);
});

test('pollIssues reuses legacy unprefixed state when adding repo namespace', async () => {
  const posted = [];
  const executed = [];
  const github = {
    listIssues: async () => [
      {
        number: 4,
        title: 'Already completed before namespace',
        body: 'Build this.',
        url: 'https://github.com/acme/customer-api/issues/4'
      }
    ],
    listComments: async () => [],
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const executor = {
    run: async () => {
      executed.push(true);
      return { ok: true, summary: 'done' };
    }
  };

  const result = await pollIssues({
    github,
    executor,
    repo: 'acme/customer-api',
    label: 'agent-kanban',
    state: {
      issues: {
        4: {
          status: 'completed',
          title: 'Already completed before namespace',
          url: 'https://github.com/acme/customer-api/issues/4',
          answers: {},
          acknowledgedAnswerCommentIds: []
        }
      }
    },
    execute: true,
    stateKeyPrefix: 'acme/customer-api'
  });

  assert.equal(result.state.issues['acme/customer-api#4'].status, 'completed');
  assert.deepEqual(executed, []);
  assert.deepEqual(posted, []);
});

test('pollConfiguredRepos polls every configured repo with repo-specific project defaults', async () => {
  const listed = [];
  const seen = [];
  const githubClient = {
    listIssues: async ({ repo }) => {
      listed.push(repo);
      return [
        {
          number: 1,
          title: `Issue in ${repo}`,
          body: 'Build this.',
          url: `https://github.com/${repo}/issues/1`
        }
      ];
    },
    listComments: async () => [],
    commentIssue: async () => {}
  };
  const executor = {
    run: async (issue, issueState) => {
      seen.push(issueState.project);
      return { ok: true, summary: 'done' };
    }
  };

  const result = await pollConfiguredRepos({
    githubClient,
    executor,
    fallbackRepo: 'bing751002/test-auto-codex',
    label: 'agent-kanban',
    runnerId: '',
    state: { issues: {} },
    execute: true,
    projectConfig: {
      defaultProject: 'agent-kanban-system',
      projects: {
        'agent-kanban-system': { path: 'D:\\agent-kanban-system' },
        'customer-api': { path: 'D:\\work\\customer-api' }
      },
      repos: {
        'bing751002/test-auto-codex': { project: 'agent-kanban-system' },
        'acme/customer-api': { project: 'customer-api' }
      }
    },
    ensureProject: async () => ({ ok: true, cloned: false })
  });

  assert.deepEqual(listed, ['bing751002/test-auto-codex', 'acme/customer-api']);
  assert.deepEqual(seen.map(({ name, path }) => ({ name, path })), [
    { name: 'agent-kanban-system', path: 'D:\\agent-kanban-system' },
    { name: 'customer-api', path: 'D:\\work\\customer-api' }
  ]);
  assert.equal(result.state.issues['bing751002/test-auto-codex#1'].status, 'completed');
  assert.equal(result.state.issues['acme/customer-api#1'].status, 'completed');
});

test('pollIssues sends unknown project to needs-input without executing', async () => {
  const posted = [];
  const executed = [];
  const github = {
    listIssues: async () => [
      {
        number: 11,
        title: 'Run in missing project',
        body: '/bot office-pc\n/project missing-app\nBuild this.',
        url: 'https://github.com/example/repo/issues/11'
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
    execute: true,
    projectConfig: {
      defaultProject: 'agent-kanban-system',
      projects: {
        'agent-kanban-system': { path: 'D:\\agent-kanban-system' }
      }
    }
  });

  assert.deepEqual(executed, []);
  assert.equal(result.state.issues['11'].status, 'needs-input');
  assert.equal(result.state.issues['11'].projectError, 'unknown-project');
  assert.match(posted.map((item) => item.body).join('\n'), /\[agent-kanban\] needs-input/);
  assert.doesNotMatch(posted.map((item) => item.body).join('\n'), /\[agent-kanban\] status: received/);
  assert.match(posted.map((item) => item.body).join('\n'), /missing-app/);
  assert.match(posted.map((item) => item.body).join('\n'), /agent-kanban-system/);
});

test('pollIssues passes resolved project to executor', async () => {
  const seen = [];
  const github = {
    listIssues: async () => [
      {
        number: 12,
        title: 'Run in known project',
        body: '/bot office-pc\n/project customer-api\nBuild this.',
        url: 'https://github.com/example/repo/issues/12'
      }
    ],
    listComments: async () => [],
    commentIssue: async () => {}
  };
  const executor = {
    run: async (issue, issueState) => {
      seen.push(issueState.project);
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
    execute: true,
    projectConfig: {
      defaultProject: 'agent-kanban-system',
      projects: {
        'agent-kanban-system': { path: 'D:\\agent-kanban-system' },
        'customer-api': { path: 'D:\\work\\customer-api' }
      }
    },
    ensureProject: async () => ({ ok: true, cloned: false })
  });

  assert.deepEqual(seen.map(({ name, path }) => ({ name, path })), [
    { name: 'customer-api', path: 'D:\\work\\customer-api' }
  ]);
});

test('pollIssues prepares missing repo project before executing', async () => {
  const prepared = [];
  const executed = [];
  const github = {
    listIssues: async () => [
      {
        number: 13,
        title: 'Clone before run',
        body: 'Build this.',
        url: 'https://github.com/acme/customer-api/issues/13'
      }
    ],
    listComments: async () => [],
    commentIssue: async () => {}
  };
  const executor = {
    run: async (issue, issueState) => {
      executed.push(issueState.project.path);
      return { ok: true, summary: 'done' };
    }
  };

  await pollIssues({
    github,
    executor,
    repo: 'acme/customer-api',
    label: 'agent-kanban',
    state: { issues: {} },
    execute: true,
    projectConfig: {
      defaultProject: 'customer-api',
      projects: {
        'customer-api': {
          path: 'D:\\work\\customer-api',
          repo: 'acme/customer-api',
          cloneIfMissing: true
        }
      }
    },
    ensureProject: async (project) => {
      prepared.push(project);
      return { ok: true, cloned: true, path: project.path };
    }
  });

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].repo, 'acme/customer-api');
  assert.deepEqual(executed, ['D:\\work\\customer-api']);
});

test('pollIssues asks for input when repo project folder is missing and cannot be cloned', async () => {
  const posted = [];
  const executed = [];
  const github = {
    listIssues: async () => [
      {
        number: 14,
        title: 'Missing folder',
        body: 'Build this.',
        url: 'https://github.com/acme/customer-api/issues/14'
      }
    ],
    listComments: async () => [],
    commentIssue: async (number, body) => posted.push({ number, body })
  };
  const executor = {
    run: async () => {
      executed.push(true);
      return { ok: true, summary: 'done' };
    }
  };

  const result = await pollIssues({
    github,
    executor,
    repo: 'acme/customer-api',
    label: 'agent-kanban',
    state: { issues: {} },
    execute: true,
    projectConfig: {
      defaultProject: 'customer-api',
      projects: {
        'customer-api': {
          path: 'D:\\work\\customer-api',
          repo: 'acme/customer-api',
          cloneIfMissing: false
        }
      }
    },
    ensureProject: async () => ({
      ok: false,
      reason: 'missing-project-directory',
      summary: '找不到 project `customer-api` 的本機資料夾。'
    })
  });

  assert.deepEqual(executed, []);
  assert.equal(result.state.issues['14'].status, 'needs-input');
  assert.match(posted.map((item) => item.body).join('\n'), /\[agent-kanban\] needs-input/);
});
