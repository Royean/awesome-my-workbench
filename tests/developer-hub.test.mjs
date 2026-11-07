import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createDeveloperHubApi } from '../lib/developer-hub.mjs';
import { hubRoleCatalog, loadHubRoleCatalog } from '../lib/hub-roles.mjs';

const id = '0c021261-1457-42de-a91c-676f750ce2da';
const alice = { id: 'alice', email: 'alice@example.invalid' };
const bob = { id: 'bob', email: 'bob@example.invalid' };
const issueURL = 'https://github.com/example/workbench/issues/123';
const agent = {
  roleId: 'developer', name: '工程 Agent', environment: 'Codex',
  skills: [{ name: '本地验证', status: 'configured', sourceUrl: 'https://example.org/skill' }],
  mcp: [{ name: '测试连接', status: 'unverified', scope: '只读' }]
};

function setup(t, options = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  db.exec(readFileSync(new URL('../migrations/008-developer-hub.sql', import.meta.url), 'utf8'));
  const handle = createDeveloperHubApi({
    db,
    json: (_, status, body) => ({ status, body }),
    readBody: async req => req.body || {},
    isAuthorized: () => true,
    readIssue: async url => ({ url, title: '示例需求' }),
    roleCatalog: {
      source: { status: 'snapshot', revision: 'a'.repeat(40) },
      roles: hubRoleCatalog.roles.map(role => ({
        ...role, sourceUrl: 'https://example.invalid/roles/' + 'a'.repeat(40) + '/' + role.id
      }))
    },
    ...options
  });
  return (user, method, resource, body) => handle({ method, body }, {}, '/api/developer-hub/' + resource, user);
}

test('role snapshot links to a pinned version and Agent records are isolated by account', async t => {
  const req = setup(t);
  const { body: roles } = await req(null, 'GET', 'roles');
  assert.equal(roles.source.status, 'snapshot');
  assert.equal(roles.roles.length, 11);
  assert.ok(roles.roles.every(role => role.sourceUrl.includes(roles.source.revision)));
  const { body: sharedRoles } = await req(bob, 'GET', 'roles');
  assert.equal(sharedRoles.source, null);
  assert.ok(sharedRoles.roles.every(role => !role.sourceUrl && !role.skills.length));
  const saved = await req(alice, 'PUT', 'agents/' + id, { ...agent, credentials: 'fictional' });
  assert.equal(saved.body.owner, alice.id);
  assert.equal(saved.body.agent.credentials, undefined);
  assert.deepEqual(saved.body.agent.mcp, agent.mcp);
  assert.equal((await req(alice, 'GET', 'agents')).body.agents.length, 1);
  assert.deepEqual((await req(bob, 'GET', 'agents')).body.agents, []);
  await assert.rejects(req(bob, 'DELETE', 'agents/' + id), { status: 404 });
  await assert.rejects(req(alice, 'PUT', 'agents/' + id, {
    ...agent, skills: [{ ...agent.skills[0], sourceUrl: 'javascript:alert(1)' }]
  }), { status: 400 });
  await assert.rejects(req(alice, 'PUT', 'agents/' + id, {
    ...agent, mcp: [{ ...agent.mcp[0], status: 'connected' }]
  }), { status: 400 });
  assert.equal((await req(alice, 'DELETE', 'agents/' + id)).status, 200);
});

test('Issue tracking is idempotent, isolated, and retains a snapshot after refresh failure', async t => {
  let reads = 0;
  const req = setup(t, {
    readIssue: async url => {
      reads++;
      if (reads > 1) throw Object.assign(new Error('GitHub unavailable'), { status: 502 });
      return { url, title: '示例需求' };
    }
  });
  const added = await req(alice, 'POST', 'issues', { url: issueURL });
  const duplicate = await req(alice, 'POST', 'issues', { url: issueURL.toUpperCase().replace('/ISSUES/', '/issues/') });
  assert.equal(added.status, 201);
  assert.equal(duplicate.body.issue.id, added.body.issue.id);
  assert.equal(reads, 1);
  await assert.rejects(req(alice, 'POST', 'issues/' + added.body.issue.id + '/refresh'), { status: 502 });
  assert.deepEqual((await req(alice, 'GET', 'issues')).body.issues, [added.body.issue]);
  assert.deepEqual((await req(bob, 'GET', 'issues')).body.issues, []);
  await assert.rejects(req(bob, 'POST', 'issues/' + added.body.issue.id + '/refresh'), { status: 404 });
  await assert.rejects(req(bob, 'POST', 'issues', { url: 'https://example.invalid/example/workbench/issues/123' }), { status: 400 });
});

test('authorization is checked again after waiting for GitHub', async t => {
  const req = setup(t, { isAuthorized: () => false });
  await assert.rejects(req(alice, 'POST', 'issues', { url: issueURL }), { status: 401 });
  assert.deepEqual((await req(alice, 'GET', 'issues')).body.issues, []);
});


test('private role catalog loads from a separate file and rejects malformed catalogs', t => {
  const directory = mkdtempSync(join(tmpdir(), 'hub-role-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = directory + '/roles.json';
  writeFileSync(file, JSON.stringify(hubRoleCatalog));
  assert.deepEqual(loadHubRoleCatalog(file), hubRoleCatalog);
  assert.equal(loadHubRoleCatalog(''), hubRoleCatalog);
  writeFileSync(file, JSON.stringify({ roles: [{ ...hubRoleCatalog.roles[0], sourceUrl: 'javascript:alert(1)' }] }));
  assert.throws(() => loadHubRoleCatalog(file), /角色目录配置文件无法读取/);
  writeFileSync(file, '{');
  assert.throws(() => loadHubRoleCatalog(file), /角色目录配置文件无法读取/);
});
