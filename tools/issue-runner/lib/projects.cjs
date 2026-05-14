const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function readProjectConfig(projectsPath, fallbackRoot) {
  if (!projectsPath || !fs.existsSync(projectsPath)) {
    return {
      defaultProject: 'default',
      workspaceRoot: '',
      cloneIfMissing: false,
      projects: {
        default: { path: fallbackRoot }
      },
      repos: {}
    };
  }

  const parsed = JSON.parse(stripBom(fs.readFileSync(projectsPath, 'utf8')));
  const projects = {};
  for (const [name, value] of Object.entries(parsed.projects || {})) {
    assertSafeProjectName(name);
    const projectPath = typeof value === 'string' ? value : value?.path;
    if (!projectPath) {
      throw new Error(`project "${name}" is missing path`);
    }
    projects[name] = { path: path.resolve(projectPath) };
  }

  const names = Object.keys(projects);
  if (names.length === 0) {
    throw new Error(`no projects configured in ${projectsPath}`);
  }

  const defaultProject = parsed.defaultProject || names[0];
  if (!projects[defaultProject]) {
    throw new Error(`defaultProject "${defaultProject}" is not configured`);
  }

  return {
    defaultProject,
    workspaceRoot: parsed.workspaceRoot ? path.resolve(parsed.workspaceRoot) : '',
    cloneIfMissing: Boolean(parsed.cloneIfMissing),
    projects,
    repos: normalizeRepos(parsed.repos || {})
  };
}

function resolveIssueProject(issue, projectConfig) {
  const requested = extractProjectDirective(issue.body || '');
  const name = requested || projectConfig.defaultProject;
  const project = projectConfig.projects[name];

  if (!project) {
    return {
      ok: false,
      reason: 'unknown-project',
      requested: name,
      available: Object.keys(projectConfig.projects).sort()
    };
  }

  const resolved = {
    ok: true,
    project: {
      name,
      path: project.path
    }
  };
  if (project.repo) resolved.project.repo = project.repo;
  if (project.cloneIfMissing !== undefined) resolved.project.cloneIfMissing = Boolean(project.cloneIfMissing);
  return resolved;
}

function extractProjectDirective(text) {
  const match = String(text).match(/^\s*\/project\s+([A-Za-z0-9_.-]+)\s*$/im);
  return match ? match[1] : '';
}

function resolveRepoPlans(fallbackRepo, projectConfig) {
  const repoEntries = Object.entries(projectConfig.repos || {});
  if (repoEntries.length === 0) {
    return [{ repo: fallbackRepo, defaultProject: projectConfig.defaultProject }];
  }

  return repoEntries
    .map(([repo, value]) => ({
      repo,
      defaultProject: value.project || projectConfig.defaultProject,
      repoConfig: value
    }));
}

function projectConfigForRepo(projectConfig, repoPlan) {
  const projectName = repoPlan.defaultProject || projectConfig.defaultProject;
  const projects = { ...projectConfig.projects };
  if (!projects[projectName]) {
    projects[projectName] = projectFromRepoPlan(projectName, repoPlan, projectConfig);
  }

  return {
    ...projectConfig,
    defaultProject: projectName,
    projects
  };
}

async function ensureProjectDirectory({ project, runCommand = execCommand }) {
  if (fs.existsSync(project.path)) {
    return { ok: true, cloned: false, path: project.path };
  }

  if (!project.cloneIfMissing || !project.repo) {
    return {
      ok: false,
      reason: 'missing-project-directory',
      summary: [
        `找不到 project \`${project.name}\` 的本機資料夾：`,
        '',
        '```text',
        project.path,
        '```',
        '',
        '請建立資料夾、修正 `.runner/projects.json`，或在 repo 設定啟用 `cloneIfMissing`。'
      ].join('\n')
    };
  }

  fs.mkdirSync(path.dirname(project.path), { recursive: true });
  await runCommand('gh', ['repo', 'clone', project.repo, project.path]);
  return { ok: true, cloned: true, path: project.path };
}

function formatProjectNeedsInput(result) {
  const available = result.available.length > 0 ? result.available.map((name) => `- ${name}`).join('\n') : '- (none)';
  return [
    `找不到指定的 project：\`${result.requested}\`。`,
    '',
    '請在 issue 內改用已登記的 project 名稱，或先到 runner 電腦的 `.runner/projects.json` 加入白名單。',
    '',
    '可用 project：',
    available,
    '',
    '格式：',
    '```text',
    '/project <project-name>',
    '```'
  ].join('\n');
}

function assertSafeProjectName(name) {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error(`invalid project name: ${name}`);
  }
}

function normalizeRepos(repos) {
  const normalized = {};
  for (const [repo, value] of Object.entries(repos)) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      throw new Error(`invalid repo name: ${repo}`);
    }
    const repoConfig = typeof value === 'string' ? { project: value } : { ...(value || {}) };
    if (repoConfig.project) assertSafeProjectName(repoConfig.project);
    if (repoConfig.path) repoConfig.path = path.resolve(repoConfig.path);
    normalized[repo] = repoConfig;
  }
  return normalized;
}

function projectFromRepoPlan(projectName, repoPlan, projectConfig) {
  const repoConfig = repoPlan.repoConfig || {};
  const repoName = repoPlan.repo.split('/').pop();
  const projectPath = repoConfig.path || path.join(projectConfig.workspaceRoot || process.cwd(), repoName);
  return {
    path: path.resolve(projectPath),
    repo: repoPlan.repo,
    cloneIfMissing: repoConfig.cloneIfMissing ?? projectConfig.cloneIfMissing
  };
}

function execCommand(command, args) {
  execFileSync(command, args, {
    stdio: 'inherit'
  });
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

module.exports = {
  extractProjectDirective,
  ensureProjectDirectory,
  formatProjectNeedsInput,
  projectConfigForRepo,
  readProjectConfig,
  resolveRepoPlans,
  resolveIssueProject
};
