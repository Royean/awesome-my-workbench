import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGitHubIssueUrl, readGitHubIssue } from '../lib/hub-github.mjs';

const issueUrl = 'https://github.com/Example/Workbench/issues/22';
const issuePath = '/repos/Example/Workbench/issues/22';
const pullPath = '/repos/Example/Workbench/pulls/23';
const sha = 'a'.repeat(40);
const agentId = 'bd5cb982-41f3-4a7f-91a2-1fb23e7d967e';
const issue = { number: 22, title: '测试需求', body: '', state: 'open', comments: 0, author_association: 'OWNER' };

function fakeGithub(responses, calls = []) {
  return async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'GET');
    assert.ok(options.signal instanceof AbortSignal);
    calls.push([url.pathname, options.headers]);
    const response = responses[url.pathname];
    if (response instanceof Response) return response;
    return response ? Response.json(response) : new Response('', { status: 404 });
  };
}

test('issue identity is normalized without accepting credentials, normalized paths, encoded separators or other hosts', () => {
  assert.deepEqual(parseGitHubIssueUrl(issueUrl + '/?foo=bar#issuecomment-1'), {
    owner: 'Example', repo: 'Workbench', number: 22, url: issueUrl, key: 'example/workbench/22'
  });
  for (const bad of [
    'https://github.com@evil.example/Example/Workbench/issues/22',
    'https://github.com:443/Example/Workbench/issues/22',
    'https://github.com/old/../Example/Workbench/issues/22',
    'https://github.com/Example/Workbench/%2e%2e/Workbench/issues/22',
    'https://github.com/Example/Workbench/issues/9007199254740992',
    'https://github.com/Example/Workbench/pull/22'
  ]) assert.equal(parseGitHubIssueUrl(bad), null, bad);
});

test('explicit Issue facts, related entities, PR and exact commit checks retain distinct provenance', async () => {
  const calls = [];
  const result = await readGitHubIssue(issueUrl, 'fictional-token', {
    viewerLogin: 'reader',
    fetchImpl: fakeGithub({
      [issuePath]: {
        ...issue,
        body: [
          '- **当前阶段**：待测试验收', '阻塞：无', '下一步: 验证空状态',
          '组件: `file-preview`、status-card', '关联 Agent: ' + agentId, 'PR #23'
        ].join('\n'),
        assignees: [{ login: 'Reader' }], labels: [{ name: 'P1' }], comments: 1
      },
      [issuePath + '/timeline']: [{
        event: 'cross-referenced', source: { issue: {
          author_association: 'MEMBER', pull_request: { html_url: 'https://github.com/Example/Workbench/pull/23' }
        } }
      }],
      [issuePath + '/comments']: [{ id: 9, body: '## 独立验收\n\n验证空状态通过。', user: { login: 'tester' }, author_association: 'COLLABORATOR' }],
      [pullPath]: { number: 23, title: '需求变更', state: 'closed', merged: true, head: { sha } },
      [`/repos/Example/Workbench/commits/${sha}/check-runs`]: { check_runs: [{ name: 'Web Test', status: 'completed', conclusion: 'success' }] },
      [`/repos/Example/Workbench/commits/${sha}/status`]: { state: 'pending', statuses: [] }
    }, calls)
  });
  assert.equal(result.stage, '待验收');
  assert.equal(result.priority, 'P1');
  assert.equal(result.needsMe, true);
  assert.equal(result.blocked, false);
  assert.equal(result.isDelivered, false);
  assert.equal(result.isInProgress, true);
  assert.equal(result.nextStep, '验证空状态');
  assert.deepEqual(result.agentIds, [agentId]);
  assert.deepEqual(result.componentIds, ['file-preview', 'status-card']);
  const [pull] = result.evidence.pullRequests;
  assert.equal(pull.state, 'merged');
  assert.equal(pull.source, 'Issue 时间线');
  assert.equal(pull.checks.sha, sha);
  assert.equal(pull.checks.incomplete, false);
  assert.deepEqual(pull.checks.values.map(check => check.state), ['success']);
  assert.equal(result.evidence.acceptance[0].url, issueUrl + '#issuecomment-9');
  assert.equal(result.evidence.acceptance[0].author, 'tester');
  assert.deepEqual(result.evidence.delivery, []);
  assert.ok(calls.every(([, headers]) => headers.Authorization === 'Bearer fictional-token'));
});

test('closed Issue and unavailable evidence do not become delivery or passing checks', async () => {
  const calls = [];
  const result = await readGitHubIssue(issueUrl, undefined, { fetchImpl: fakeGithub({
    [issuePath]: { ...issue, state: 'closed', state_reason: 'completed', body: 'PR #23\n阶段：待发布\n发布：未上线', comments: 2 },
    [pullPath]: { number: 23, title: '需求变更', state: 'closed', merged: true, head: { sha } }
  }, calls) });
  assert.equal(result.state, 'closed');
  assert.equal(result.isDelivered, false);
  assert.equal(result.isInProgress, false);
  assert.deepEqual(result.evidence.sourceAvailable, { timeline: false, comments: false });
  assert.equal(result.evidence.pullRequests[0].checks.incomplete, true);
  assert.deepEqual(result.evidence.pullRequests[0].checks.values, []);
  assert.ok(calls.every(([, headers]) => !('Authorization' in headers)));
});

test('a delivery heading is shown as an attributed source claim, and unsafe or non-Issue responses fail clearly', async () => {
  const result = await readGitHubIssue(issueUrl, '', { fetchImpl: fakeGithub({
    [issuePath]: { ...issue, state: 'closed', body: '## 已交付\n\n交付版本 1.2。\n\n```\n组件: not-real\n```' },
    [issuePath + '/timeline']: []
  }) });
  assert.equal(result.isDelivered, true);
  assert.equal(result.evidence.delivery[0].url, issueUrl);
  assert.deepEqual(result.componentIds, []);
  await assert.rejects(readGitHubIssue(issueUrl, '', { fetchImpl: fakeGithub({
    [issuePath]: { ...issue, pull_request: {} }
  }) }), { status: 400, code: 'github_link_is_pull_request', expose: true });
  await assert.rejects(readGitHubIssue(issueUrl, '', { fetchImpl: fakeGithub({}) }),
    { status: 404, code: 'github_issue_unavailable', expose: true });
  await assert.rejects(readGitHubIssue(issueUrl, '', { fetchImpl: fakeGithub({
    [issuePath]: new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
  }) }), { status: 429, code: 'github_rate_limit' });
});

test('Issue Form headings provide metadata and untrusted authors cannot assert delivery, acceptance or linked PRs', async () => {
  const calls = [];
  const result = await readGitHubIssue(issueUrl, '', { fetchImpl: fakeGithub({
    [issuePath]: {
      ...issue, comments: 1,
      body: '### 阶段\n\n开发中\n\n### 下一步\n\n先跑浏览器检查。\n再更新截图。\n\n### 组件\n\nfile-preview'
    },
    [issuePath + '/timeline']: [{
      event: 'cross-referenced', source: { issue: {
        author_association: 'NONE', pull_request: { html_url: 'https://github.com/Example/Workbench/pull/23' }
      } }
    }],
    [issuePath + '/comments']: [{
      id: 9, body: '发布：已上线\n\n### 验收结果\n\n通过。\n\nPR #23', author_association: 'NONE', user: { login: 'untrusted' }
    }]
  }, calls) });
  assert.equal(result.stage, '开发中');
  assert.equal(result.nextStep, '先跑浏览器检查。\n再更新截图。');
  assert.deepEqual(result.componentIds, ['file-preview']);
  assert.equal(result.isDelivered, false);
  assert.equal(result.isInProgress, true);
  assert.deepEqual(result.evidence.delivery, []);
  assert.deepEqual(result.evidence.acceptance, []);
  assert.deepEqual(result.evidence.pullRequests, []);
  assert.ok(calls.every(([path]) => !path.includes('/pulls/')));

  const untrustedIssue = await readGitHubIssue(issueUrl, '', { fetchImpl: fakeGithub({
    [issuePath]: { ...issue, author_association: 'NONE', body: '### 阶段\n\n已交付\n\n## 已上线\n\n已验收。' },
    [issuePath + '/timeline']: []
  }) });
  assert.equal(untrustedIssue.isDelivered, false);
  assert.deepEqual(untrustedIssue.evidence.delivery, []);
});
