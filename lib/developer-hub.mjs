import { randomUUID } from 'node:crypto';
import { fail } from './accounts.mjs';
import { readGitHubIssue, parseGitHubIssueUrl } from './hub-github.mjs';
import { hubRoleCatalog, loadHubRoleCatalog } from './hub-roles.mjs';

const prefix = '/api/developer-hub/';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const maxEntries = 50;

function value(input, max, field, required = false) {
  if (input == null && !required) return '';
  if (typeof input !== 'string' || input.length > max || /[\u0000-\u001f\u007f]/.test(input) || (required && !input.trim())) {
    throw fail(400, `${field}格式无效，最多 ${max} 字符`);
  }
  return input.trim();
}

function sourceLink(input) {
  if (!input) return '';
  try {
    const url = new URL(value(input, 400, '来源链接'));
    if (url.protocol !== 'https:' || url.username || url.password || url.search) throw new Error();
    return url.href;
  } catch {
    throw fail(400, '请使用不带查询参数的 HTTPS 文档链接');
  }
}

function capabilities(input, kind) {
  if (!Array.isArray(input) || input.length > 30) throw fail(400, `每个 Agent 最多登记 30 项 ${kind}`);
  const names = new Set();
  return input.map(entry => {
    const name = value(entry?.name, 100, '能力名称', true);
    const key = name.toLowerCase();
    if (names.has(key)) throw fail(400, `重复的能力名称：${name}`);
    names.add(key);
    if (!['configured', 'unverified'].includes(entry.status)) throw fail(400, '能力状态无效');
    return kind === 'Skills'
      ? { name, status: entry.status, sourceUrl: sourceLink(entry.sourceUrl) }
      : { name, status: entry.status, scope: value(entry.scope, 160, '权限范围') };
  });
}

function agentData(id, input, catalog) {
  const roleId = value(input.roleId, 64, '角色', true);
  if (!catalog.roles.some(role => role.id === roleId)) throw fail(400, '角色不存在');
  return {
    id,
    roleId,
    name: value(input.name, 80, 'Agent 名称', true),
    environment: value(input.environment, 80, '运行环境', true),
    deviceId: value(input.deviceId, 80, '运行设备'),
    harnessId: value(input.harnessId, 80, 'Harness'),
    projectId: value(input.projectId, 80, '项目'),
    skills: capabilities(input.skills, 'Skills'),
    mcp: capabilities(input.mcp, 'MCP'),
    updatedAt: new Date().toISOString()
  };
}

const accountEmail = name => process.env[name]?.trim().toLowerCase();
const matchesEmail = (user, email) => Boolean(email && user?.email.toLowerCase() === email);

export function getRoleCatalogForUser(user, catalog) {
  const email = accountEmail('WORKBENCH_ROLE_CATALOG_ACCOUNT_EMAIL') || accountEmail('WORKBENCH_GITHUB_ACCOUNT_EMAIL');
  if (!user || matchesEmail(user, email)) return catalog;
  return {
    source: null,
    roles: hubRoleCatalog.roles.map(({ id, name, group, description, responsibilities }) => ({
      id, name, group, description, responsibilities, skills: []
    }))
  };
}

function githubConfig(user) {
  const email = accountEmail('WORKBENCH_GITHUB_ACCOUNT_EMAIL');
  const allowed = user ? matchesEmail(user, email) : !email;
  return allowed ? {
    token: process.env.WORKBENCH_GITHUB_TOKEN?.trim(),
    viewerLogin: process.env.WORKBENCH_GITHUB_LOGIN?.trim()
  } : {};
}

export function createDeveloperHubApi({ db, json, readBody, isAuthorized, readIssue = readGitHubIssue, roleCatalog = loadHubRoleCatalog(), ensureAgents }) {
  const list = db.prepare('SELECT body FROM developer_hub_entries WHERE owner=? AND kind=? ORDER BY rowid DESC');
  const select = db.prepare('SELECT body, entry_key FROM developer_hub_entries WHERE owner=? AND kind=? AND id=?');
  const byKey = db.prepare('SELECT body FROM developer_hub_entries WHERE owner=? AND kind=? AND entry_key=?');
  const count = db.prepare('SELECT count(*) AS total FROM developer_hub_entries WHERE owner=? AND kind=?');
  const insert = db.prepare('INSERT INTO developer_hub_entries(owner,kind,id,entry_key,body) VALUES(?,?,?,?,?)');
  const update = db.prepare('UPDATE developer_hub_entries SET body=? WHERE owner=? AND kind=? AND id=? AND body=?');
  const remove = db.prepare('DELETE FROM developer_hub_entries WHERE owner=? AND kind=? AND id=?');
  const activeReads = new Map();
  let runningReads = 0;

  function assertCapacity(owner, kind) {
    if (count.get(owner, kind).total >= maxEntries) throw fail(409, `最多可保存 ${maxEntries} 条记录`);
  }

  async function fetchIssue(req, owner, user, url) {
    const active = activeReads.get(owner) || 0;
    if (active >= 2 || runningReads >= 8) throw fail(429, 'GitHub 同步较忙，请稍后再试');
    activeReads.set(owner, active + 1);
    runningReads++;
    const { token, viewerLogin } = githubConfig(user);
    try {
      const result = await readIssue(url, token, { viewerLogin });
      if (!isAuthorized(req, user)) throw fail(401, '登录状态已失效，请重新登录');
      return result;
    } finally {
      runningReads--;
      const remaining = activeReads.get(owner) - 1;
      if (remaining) activeReads.set(owner, remaining);
      else activeReads.delete(owner);
    }
  }

  return async function handle(req, res, pathname, user) {
    const resource = pathname.slice(prefix.length);
    const method = req.method;
    const owner = user?.id || 'local';
    const respond = (status, body) => json(res, status, { owner: user?.id ?? null, ...body });
    if (resource === 'roles' && method === 'GET') return respond(200, getRoleCatalogForUser(user, roleCatalog));
    if (resource === 'agents' && method === 'GET') {
      ensureAgents?.(owner);
      return respond(200, { agents: list.all(owner, 'agent').map(row => JSON.parse(row.body)) });
    }
    if (resource === 'issues' && method === 'GET') {
      const { token, viewerLogin } = githubConfig(user);
      return respond(200, {
        issues: list.all(owner, 'issue').map(row => JSON.parse(row.body)),
        github: { authenticated: Boolean(token), viewerLogin: viewerLogin || null }
      });
    }
    if (resource === 'issues' && method === 'POST') {
      const input = await readBody(req, 4096);
      const issueLink = parseGitHubIssueUrl(input.url);
      if (!issueLink) throw fail(400, '请输入完整的 GitHub Issue 链接');
      const existing = byKey.get(owner, 'issue', issueLink.key);
      if (existing) return respond(200, { issue: JSON.parse(existing.body) });
      assertCapacity(owner, 'issue');
      const result = await fetchIssue(req, owner, user, issueLink.url);
      const concurrent = byKey.get(owner, 'issue', issueLink.key);
      if (concurrent) return respond(200, { issue: JSON.parse(concurrent.body) });
      assertCapacity(owner, 'issue');
      const issue = { ...result, id: randomUUID() };
      insert.run(owner, 'issue', issue.id, issueLink.key, JSON.stringify(issue));
      return respond(201, { issue });
    }
    const [resourceType, id, action, ...rest] = resource.split('/');
    const kind = { agents: 'agent', issues: 'issue' }[resourceType];
    if (!['agent', 'issue'].includes(kind) || !uuid.test(id || '') || rest.length) throw fail(404, '接口不存在');
    if (kind === 'agent' && action === undefined && method === 'PUT') {
      const agent = agentData(id, await readBody(req, 32 * 1024), getRoleCatalogForUser(user, roleCatalog));
      const previous = select.get(owner, kind, id);
      if (previous) update.run(JSON.stringify(agent), owner, kind, id, previous.body);
      else {
        assertCapacity(owner, kind);
        insert.run(owner, kind, id, id, JSON.stringify(agent));
      }
      return respond(200, { agent });
    }
    if (action === undefined && method === 'DELETE') {
      await readBody(req, 4096);
      if (!remove.run(owner, kind, id).changes) throw fail(404, '记录不存在');
      return respond(200, { ok: true });
    }
    if (kind === 'issue' && action === 'refresh' && method === 'POST') {
      await readBody(req, 4096);
      const previous = select.get(owner, kind, id);
      if (!previous) throw fail(404, '需求不存在');
      const snapshot = JSON.parse(previous.body);
      const issue = { ...await fetchIssue(req, owner, user, snapshot.url), id };
      if (!update.run(JSON.stringify(issue), owner, kind, id, previous.body).changes) {
        const current = select.get(owner, kind, id);
        if (!current) throw fail(404, '需求不存在');
        return respond(200, { issue: JSON.parse(current.body) });
      }
      return respond(200, { issue });
    }
    throw fail(404, '接口不存在');
  };
}
