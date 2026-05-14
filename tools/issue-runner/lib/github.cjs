const { execFileSync } = require('node:child_process');

function createGitHubClient() {
  return {
    listIssues({ repo, label }) {
      const output = gh([
        'issue',
        'list',
        '--repo',
        repo,
        '--label',
        label,
        '--state',
        'open',
        '--json',
        'number,title,body,url'
      ]);
      return JSON.parse(output || '[]');
    },

    listComments(number, { repo } = {}) {
      if (!repo) throw new Error('repo is required for listComments');
      const output = gh([
        'api',
        `repos/${repo}/issues/${number}/comments`,
        '--paginate'
      ]);
      const comments = JSON.parse(output || '[]');
      return comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        author: { login: comment.user?.login || '' },
        createdAt: comment.created_at
      }));
    },

    commentIssue(number, body, { repo } = {}) {
      if (!repo) throw new Error('repo is required for commentIssue');
      gh(['issue', 'comment', String(number), '--repo', repo, '--body', body]);
    },

    ensureLabel({ repo, label }) {
      try {
        gh([
          'label',
          'create',
          label,
          '--repo',
          repo,
          '--description',
          'Requests handled by the local Codex issue runner',
          '--color',
          '5319e7'
        ]);
      } catch (error) {
        if (!String(error.message).includes('already exists')) throw error;
      }
    }
  };
}

function bindRepo(client, repo) {
  return {
    listIssues: (options) => client.listIssues(options),
    listComments: (number) => client.listComments(number, { repo }),
    commentIssue: (number, body) => client.commentIssue(number, body, { repo }),
    ensureLabel: (options) => client.ensureLabel(options)
  };
}

function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

module.exports = { createGitHubClient, bindRepo };
