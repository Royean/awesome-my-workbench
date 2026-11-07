import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startServer, freePort, repoRoot } from './helpers.mjs';

test('execution HTTP scopes pairing, claims and approvals to full sessions and one active account/device', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'execution-http-'));
  const email = 'execution-owner@example.invalid';
  const password = 'Fictional-execution-password-92';
  const file = join(directory, 'roles.json');
  await writeFile(file, JSON.stringify({
    source: null,
    roles: [{ id: 'developer', name: '开发工程师', group: '开发协作', description: '执行测试任务', skills: [], instructions: 'Follow this assigned test task inside its isolated workspace.' }]
  }));
  const setup = spawnSync(process.execPath, ['scripts/account-admin.mjs', 'create-admin', '--email', email], {
    cwd: repoRoot, input: password + '\n', encoding: 'utf8', env: { ...process.env, HEALTH_DATA_DIR: directory }
  });
  assert.equal(setup.status, 0, setup.stderr);
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const server = await startServer({ env: {
    NODE_ENV: 'test', AUTH_REQUIRED: '1', APP_ORIGIN: base, PORT: String(port), HEALTH_DATA_DIR: directory,
    WORKBENCH_ROLE_CATALOG_FILE: file, WORKBENCH_ROLE_CATALOG_ACCOUNT_EMAIL: email
  } });
  t.after(async () => { await server.stop(); await rm(directory, { recursive: true, force: true }); });
  let session;
  async function request(route, { method = 'GET', body, actor = session, headers = {}, native = false } = {}) {
    const response = await fetch(base + route, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(!native ? { Origin: base } : {}),
        ...(actor ? { Cookie: actor.cookie, 'X-Workbench-Owner': actor.id } : {}),
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const root = '/api/agent-execution';
  assert.equal((await request(root + '/tasks', { actor: null })).status, 401);
  const login = await request('/api/auth/login', { method: 'POST', actor: null, body: { email, password } });
  assert.equal(login.status, 200);
  session = { id: login.body.user.id, cookie: login.cookie };
  assert.equal((await request(root + '/devices', { headers: { 'X-Workbench-Owner': 'wrong-owner' } })).status, 409);

  const token = await request('/api/auth/tokens', { method: 'POST', body: { name: 'Data-only token' } });
  assert.equal(token.status, 201);
  const patHeaders = { Authorization: 'Bearer ' + token.body.token, 'X-Workbench-Owner': session.id };
  for (const [route, method, body] of [
    [root + '/tasks', 'GET'],
    [root + '/pairing-codes', 'POST', {}],
    [root + '/tasks', 'POST', {}],
    [root + '/runs/fake/approvals/fake', 'POST', { decision: 'approve' }]
  ]) {
    const denied = await request(route, { actor: null, native: true, method, body, headers: patHeaders });
    assert.equal(denied.status, 403, route);
    assert.equal(denied.body.code, 'token_forbidden');
  }

  const code = await request(root + '/pairing-codes', { method: 'POST', body: {} });
  assert.equal(code.status, 201);
  const paired = await request(root + '/pair', {
    method: 'POST', actor: null, native: true, body: { code: code.body.code, name: 'Fictional Mac', platform: 'darwin', version: '1.0' }
  });
  assert.equal(paired.status, 201);
  const deviceToken = paired.body.deviceToken;
  const deviceHeaders = { Authorization: 'Bearer ' + deviceToken };
  const device = (route, body) => request(root + '/device/' + route, { method: 'POST', actor: null, native: true, body, headers: deviceHeaders });
  assert.equal((await request('/api/state', { actor: null, native: true, headers: deviceHeaders })).status, 401);
  assert.equal((await device('heartbeat', {
    harnesses: [{ id: 'codex', name: 'Codex', version: 'test', status: 'ready', skills: [], mcp: [] }],
    projects: [{ id: 'fictional-project', name: '测试项目' }], activeRuns: []
  })).status, 200);
  const agents = await request('/api/developer-hub/agents');
  assert.equal(agents.status, 200);
  const agent = agents.body.agents.find(record => record.roleId === 'developer');
  assert.ok(agent);
  const patEdit = await request('/api/developer-hub/agents/' + agent.id, {
    actor: null, native: true, method: 'PUT', headers: patHeaders, body: { ...agent, deviceId: paired.body.deviceId }
  });
  assert.equal(patEdit.status, 403);

  const created = await request(root + '/tasks', { method: 'POST', body: {
    requestId: randomUUID(), title: '验证任务', description: '只验证派发协议。',
    agentId: agent.id, deviceId: paired.body.deviceId, harnessId: 'codex',
    projectId: 'fictional-project', mode: 'manual', acceptanceCriteria: ['真实执行记录可追溯']
  } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const claimed = await device('claim', {});
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.run.taskId, created.body.task.id);
  const started = await device('runs/' + claimed.body.run.runId + '/events', {
    events: [{ seq: 1, kind: 'state', data: { state: 'running', threadId: 'test-thread', attemptId: randomUUID() } }]
  });
  assert.equal(started.status, 200, JSON.stringify(started.body));

  const invitation = await request('/api/auth/invitations', {
    method: 'POST', body: { email: 'execution-member@example.invalid', name: 'Other account' }
  });
  const accepted = await request('/api/auth/accept-invitation', {
    actor: null, method: 'POST', body: { token: invitation.body.token, password }
  });
  const member = { id: accepted.body.user.id, cookie: accepted.cookie };
  assert.deepEqual((await request(root + '/devices', { actor: member })).body.devices, []);
  assert.equal((await request(root + '/tasks/' + created.body.task.id, { actor: member })).status, 404);

  const database = new DatabaseSync(join(directory, 'health.sqlite'));
  database.prepare('UPDATE users SET disabled=1 WHERE id=?').run(session.id);
  database.close();
  assert.equal((await device('heartbeat', { harnesses: [], projects: [], activeRuns: [] })).status, 401);
});
