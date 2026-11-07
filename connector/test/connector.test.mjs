import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Journal, API, CredentialStore, readConfig, atomicJSON, workspaceFor, redact } from '../storage.mjs';
import { AppServer, approvalResult, mcpReady, executionToolConfig, stripNulls } from '../app-server.mjs';
import { normalizeEventData, eventBatch, collectArtifacts, BATCH_BYTES, EVENT_BYTES } from '../events.mjs';
import { Bridge, validatePlan } from '../bridge.mjs';

function directory(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-connector-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return fs.realpathSync(dir); }
function job(overrides = {}) { return { runId: 'run-1', taskId: 'task-1', kind: 'execute', title: 'test', instructions: 'Do the task.', role: { id: 'developer', name: 'Developer', instructions: 'Implement with tests.' }, skills: [], mcp: [], projectId: 'project', harnessId: 'codex', workspaceKey: 'workflow-1', ...overrides }; }
function setup(t) { const dir = directory(t); const project = path.join(dir, 'project'); fs.mkdirSync(project); return { dir, config: { stateDir: path.join(dir, 'state'), serverUrl: 'http://localhost:3232', deviceId: 'device-1', projects: [{ id: 'project', name: 'Project', path: project, isolation: 'directory' }] } }; }
function minimalRuntime({ final = 'Done.', close, initialize, onTurn } = {}) {
  return class extends EventEmitter {
    async initialize() { if (initialize) return initialize(this); }
    async close() { return close ? close(this) : { terminated: true, exitObserved: true, groupEmpty: true }; }
    async request(method, params) {
      if (method === 'account/read') return { account: { type: 'chatgpt' } };
      if (method === 'skills/list') return { data: [] };
      if (method === 'config/read') return { config: {} };
      if (method === 'mcpServerStatus/list') return { data: [], nextCursor: null };
      if (method === 'thread/start') return { thread: { id: 'thread-1' } };
      if (method === 'turn/interrupt') return {};
      if (method === 'turn/start') {
        onTurn?.(params);
        queueMicrotask(() => this.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [{ type: 'agentMessage', text: final }] } } }));
        return { turn: { id: 'turn-1' } };
      }
    }
  };
}

test('journal persists claim before model work, stable spool survives restart and acknowledgements', t => {
  const { dir } = setup(t); const first = new Journal(dir); const run = first.claim(job());
  first.event(run, 'state', { state: 'running' }); first.event(run, 'progress', { message: 'working' });
  const second = new Journal(dir); assert.equal(second.claim(job()), null); assert.deepEqual(second.data.runs['run-1'].events.map(event => event.seq), [1, 2]);
  second.acknowledge(second.data.runs['run-1'], 1); assert.equal(new Journal(dir).data.runs['run-1'].events[0].seq, 2);
  assert.throws(() => second.acknowledge(second.data.runs['run-1'], 99));
});

test('event delivery retries the identical sequence after a lost response', async t => {
  const { config } = setup(t); const seen = []; let fail = true;
  const bridge = new Bridge(config, { api: { token: 'secret', async post(route, body) { seen.push(structuredClone(body)); if (fail) { fail = false; throw new Error('offline'); } return { ackSeq: body.events.at(-1).seq }; } }, report() {} });
  const run = bridge.journal.claim(job()); bridge.emit(run, 'progress', { message: 'safe' });
  await assert.rejects(bridge.flush()); assert.equal(run.events.length, 1); await bridge.flush();
  assert.deepEqual(seen[0], seen[1]); assert.equal(run.events.length, 0);
});

test('restart preserves unknown blocker without inventing termination evidence or replaying turn/start', t => {
  const { config } = setup(t); let starts = 0;
  const bridge = new Bridge(config, { api: { token: 'secret' }, appFactory() { starts++; }, report() {} });
  const run = bridge.journal.claim(job()); run.threadId = 'existing-thread'; run.phase = 'starting'; bridge.journal.save();
  bridge.recover(); assert.equal(starts, 0); assert.equal(run.phase, 'unknown'); assert.equal(run.threadId, 'existing-thread'); assert.equal(run.events.at(-1).data.state, 'unknown');
});

test('API refuses redirected credential requests and sends only device bearer', async () => {
  let call; const api = new API({ serverUrl: 'https://example.com' }, 'device-token', async (url, init) => { call = { url, init }; return { ok: true, async json() { return { ok: true }; } }; });
  await api.post('device/claim', {}); assert.equal(call.init.redirect, 'error'); assert.equal(call.init.headers.authorization, 'Bearer device-token');
});

test('config permits only secure server URLs and unique explicit local project IDs', t => {
  const { dir, config } = setup(t); const file = path.join(dir, 'config.json');
  atomicJSON(file, config); assert.equal(readConfig(file).projects[0].path, config.projects[0].path);
  atomicJSON(file, { ...config, serverUrl: 'http://example.com' }); assert.throws(() => readConfig(file), /HTTPS/);
  atomicJSON(file, { ...config, serverUrl: 'https://example.com?token=secret' }); assert.throws(() => readConfig(file));
  atomicJSON(file, { ...config, projects: [...config.projects, ...config.projects] }); assert.throws(() => readConfig(file));
});

test('workspace selection ignores server cwd, preserves workflow and verifies Git isolation', t => {
  const { config } = setup(t); delete config.projects[0].isolation;
  const project = config.projects[0].path;
  const git = args => execFileSync('git', ['-C', project, ...args], { stdio: 'ignore' });
  git(['init']); fs.writeFileSync(path.join(project, 'base.txt'), 'base'); git(['add', '.']); git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'initial']);
  const workspace = workspaceFor(config, job({ cwd: '/' })); assert.notEqual(workspace, project);
  fs.writeFileSync(path.join(workspace, 'result.txt'), 'result'); assert.equal(fs.existsSync(path.join(project, 'result.txt')), false);
  assert.equal(workspaceFor(config, job({ runId: 'second-role' })), workspace);
  const alias = path.join(path.dirname(config.stateDir), 'state-alias'); fs.symlinkSync(config.stateDir, alias); config.stateDir = alias;
  assert.equal(workspaceFor(config, job({ runId: 'third-role' })), workspace);
  assert.throws(() => workspaceFor(config, job({ projectId: '../../etc' })), /not registered/);
});

test('config and journal canonicalize aliased state parents before worktree validation', t => {
  const { dir, config } = setup(t); const real = path.join(dir, 'real-parent'); fs.mkdirSync(real); const alias = path.join(dir, 'alias-parent'); fs.symlinkSync(real, alias);
  const file = path.join(dir, 'config.json'); atomicJSON(file, { ...config, stateDir: path.join(alias, 'state') });
  const read = readConfig(file); assert.equal(read.stateDir, path.join(real, 'state')); assert.equal(new Journal(path.join(alias, 'state')).dir, read.stateDir);
});

test('redaction strips device secrets, local home, workspace and arbitrary private paths recursively', () => {
  const data = redact({ command: 'cat /Users/person/secret.txt /private/tmp/example token123', nested: { '/Users/person/key': 'at /workspace/project/file.js' } }, ['/workspace/project'], ['token123']);
  assert.equal(JSON.stringify(data).includes('/Users'), false); assert.equal(JSON.stringify(data).includes('/private'), false); assert.equal(JSON.stringify(data).includes('token123'), false); assert.equal(JSON.stringify(data).includes('/workspace'), false);
});

test('approval responses are one request only, grants have turn scope, user input is explicit', () => {
  assert.deepEqual(approvalResult({ method: 'item/commandExecution/requestApproval' }, { decision: 'approve' }), { decision: 'accept' });
  assert.deepEqual(approvalResult({ method: 'item/fileChange/requestApproval' }, { decision: 'deny' }), { decision: 'decline' });
  const permissions = { network: { enabled: true } };
  assert.deepEqual(approvalResult({ method: 'item/permissions/requestApproval', params: { permissions } }, { decision: 'approve' }), { permissions, scope: 'turn' });
  assert.deepEqual(approvalResult({ method: 'item/tool/requestUserInput', params: { questions: [{ id: 'q1' }] } }, { decision: 'approve', response: 'answer' }), { answers: { q1: { answers: ['answer'] } } });
  assert.throws(() => approvalResult({ method: 'unsupported' }, { decision: 'approve' }));
});

test('approval decisions route original RPC ID, cannot resolve twice or another run', t => {
  const { config } = setup(t); const replies = [];
  const bridge = new Bridge(config, { api: { token: 'secret' }, report() {} }); const run = bridge.journal.claim(job());
  run.pending['42'] = { resolved: false }; bridge.active = { run, requests: new Map([['42', { id: 42, method: 'item/commandExecution/requestApproval' }]]), app: { respond: (...args) => replies.push(args) } };
  bridge.applyDecision({ runId: 'other-run', approvalId: '42', decision: 'approve' }); assert.equal(replies.length, 0);
  const decision = { runId: run.job.runId, approvalId: '42', decision: 'approve' }; bridge.applyDecision(decision); bridge.applyDecision(decision);
  assert.deepEqual(replies, [[42, { decision: 'accept' }]]);
});

test('stdio transport correlates responses and handles notifications/requests separately', async t => {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('exit', 0);
  const app = new AppServer({ spawnProcess: () => child }); app.groupEmpty = () => true; t.after(() => app.close());
  const sent = []; child.stdin.on('data', data => sent.push(JSON.parse(data.toString())));
  const requested = app.request('thread/start', { cwd: '/allowed' }); const id = sent[0].id;
  const notifications = []; const approvals = []; app.on('notification', event => notifications.push(event)); app.on('request', event => approvals.push(event));
  child.stdout.write(`${JSON.stringify({ method: 'turn/started', params: {} })}\n`);
  child.stdout.write(`${JSON.stringify({ id: 99, method: 'item/fileChange/requestApproval', params: {} })}\n`);
  child.stdout.write(`${JSON.stringify({ id, result: { thread: { id: 'thread-1' } } })}\n`);
  assert.deepEqual(await requested, { thread: { id: 'thread-1' } }); assert.equal(notifications.length, 1); assert.equal(approvals[0].id, 99);
});

test('fake Codex execution binds role, skill and MCP, journals thread before model start', async t => {
  const { config } = setup(t); let bridge; const calls = [];
  class FakeApp extends EventEmitter {
    async initialize() {}
    async close() { return { terminated: true, exitObserved: true, groupEmpty: true }; }
    rejectRequest() {}
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'account/read') return { account: { type: 'chatgpt' } };
      if (method === 'skills/list') return { data: [{ cwd: params.cwds[0], skills: [{ name: 'coding', enabled: true, path: '/local/skills/coding/SKILL.md' }] }] };
      if (method === 'config/read') return { config: { mcp_servers: { wanted: { command: 'wanted-transport' }, other: { command: 'other-transport' } } } };
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'wanted', authStatus: 'oAuth', runtimeStatus: 'connected' }, { name: 'other', authStatus: 'oAuth', runtimeStatus: 'connected' }], nextCursor: null };
      if (method === 'thread/start') return { thread: { id: 'thread-1' } };
      if (method === 'turn/start') {
        const persisted = JSON.parse(fs.readFileSync(bridge.journal.file, 'utf8')).runs['run-1']; assert.equal(persisted.threadId, 'thread-1'); assert.equal(persisted.phase, 'starting'); assert.equal(persisted.startAcknowledged, true); assert.equal(persisted.ackSeq, 1);
        queueMicrotask(() => this.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [{ type: 'agentMessage', text: 'Done.' }] } } }));
        return { turn: { id: 'turn-1' } };
      }
    }
  }
  bridge = new Bridge(config, { api: { token: 'secret', async post(route, body) { return { ackSeq: body.events.at(-1).seq }; } }, appFactory: () => new FakeApp(), report() {} }); const run = bridge.journal.claim(job({ skills: ['coding'], mcp: ['wanted'] }));
  bridge.active = { run, requests: new Map() }; await bridge.execute(run);
  assert.equal(run.phase, 'completed'); assert.equal(run.events.at(-1).kind, 'result');
  const thread = calls.find(call => call.method === 'thread/start' && !call.params.ephemeral).params; assert.equal(thread.approvalPolicy, 'on-request'); assert.equal(thread.approvalsReviewer, 'user'); assert.equal(thread.sandbox, 'workspace-write'); assert.match(thread.developerInstructions, /Implement with tests/); assert.equal(thread.config.mcp_servers.other.enabled, false); assert.equal(thread.config.mcp_servers.other.command, 'other-transport');
  const probe = calls.find(call => call.method === 'thread/start' && call.params.ephemeral).params; assert.equal(probe.sandbox, 'read-only');
  const turn = calls.find(call => call.method === 'turn/start').params; assert.equal(turn.input[1].type, 'skill'); assert.equal(turn.sandboxPolicy.networkAccess, false); assert.deepEqual(turn.sandboxPolicy.writableRoots, [config.projects[0].path]);
});

test('MCP readiness rejects every unknown/disconnected/auth-failed discovery result', () => {
  const valid = { name: 'mcp', runtimeStatus: 'connected', authStatus: 'oAuth', toolsError: null };
  assert.equal(mcpReady(valid), true); assert.equal(mcpReady({ ...valid, authStatus: 'unsupported' }), true);
  for (const runtimeStatus of [null, undefined, 'notStarted', 'starting', 'cancelled', 'disabled', 'failed', 'authenticationRequired']) assert.equal(mcpReady({ ...valid, runtimeStatus }), false);
  for (const authStatus of ['unknown', 'notLoggedIn', undefined]) assert.equal(mcpReady({ ...valid, authStatus }), false);
  assert.equal(mcpReady({ ...valid, toolsError: 'Discovery failed' }), false);
});

test('scoped MCP config preserves real transports and disables derived plugins/apps without fabricating tables', () => {
  const effective = { mcp_servers: { direct: { command: 'local-command', args: ['server'], env: { TOKEN: 'local-only' } } }, apps: { service: { enabled: true } } };
  const inventory = [{ name: 'direct' }, { name: 'derived', pluginId: 'local-plugin' }, { name: 'codex_apps' }];
  const scoped = executionToolConfig(effective, inventory, []);
  assert.equal(scoped.config.mcp_servers.direct.command, 'local-command'); assert.equal(scoped.config.mcp_servers.direct.enabled, false);
  assert.equal(Object.hasOwn(scoped.config.mcp_servers, 'derived'), false); assert.equal(Object.hasOwn(scoped.config.mcp_servers, 'codex_apps'), false);
  assert.deepEqual(scoped.disabledPluginIds, ['local-plugin']); assert.equal(scoped.config.apps._default.enabled, false); assert.equal(scoped.config.apps.service.enabled, false);
  assert.throws(() => executionToolConfig(effective, [...inventory, { name: 'unknown-dynamic' }], []), /runtime-only/);
});

test('config overrides remove serialized optional nulls and unsupported effective metadata', () => {
  const scoped = executionToolConfig({ mcp_servers: { local: { command: 'local-command', tool_timeout_sec: null, startup_timeout_sec: 0, enabled_tools: [], env: { OPTIONAL: null, REQUIRED: 'value' }, runtime_only_metadata: 'not-config' } }, apps: { _default: { enabled: true, destructive_enabled: null }, app: { enabled: true, tools: null } } }, [{ name: 'local' }], []);
  assert.deepEqual(scoped.config.mcp_servers.local, { command: 'local-command', startup_timeout_sec: 0, enabled_tools: [], env: { REQUIRED: 'value' }, enabled: false });
  assert.deepEqual(scoped.config.apps._default, { enabled: false }); assert.deepEqual(stripNulls({ false: false, zero: 0, empty: [], null: null }), { false: false, zero: 0, empty: [] });
});

test('unknown restart state blocks claims even when server would offer another job', async t => {
  const { config } = setup(t); const routes = [];
  const bridge = new Bridge(config, { api: { token: 'secret', async post(route, body) { routes.push(route); return route.endsWith('/events') ? { ackSeq: body.events.at(-1).seq } : { runs: [], approvalDecisions: [], cancelRunIds: [] }; } }, report() {} });
  bridge.capabilities = { status: 'ready', skills: [], mcp: [] }; const run = bridge.journal.claim(job()); bridge.recover();
  assert.equal(run.phase, 'unknown'); assert.equal(run.events[0].data.state, 'unknown'); await bridge.tick(); assert.deepEqual(routes, ['device/runs/run-1/events', 'device/heartbeat']);
});

test('cancellation requires interrupted notification AND verified process cleanup before terminal', async t => {
  const { config } = setup(t); let finishTurn; let finishCleanup; let interruptSent;
  class FakeApp extends EventEmitter {
    async initialize() {}
    async request(method, params) {
      if (method === 'account/read') return { account: { type: 'chatgpt' } };
      if (method === 'skills/list') return { data: [] };
      if (method === 'config/read') return { config: {} };
      if (method === 'mcpServerStatus/list') return { data: [], nextCursor: null };
      if (method === 'thread/start') return { thread: { id: 'thread-1' } };
      if (method === 'turn/start') { finishTurn = () => this.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted', items: [] } } }); return { turn: { id: 'turn-1' } }; }
      if (method === 'turn/interrupt') { interruptSent = true; return {}; }
    }
    close() { return this.cleanup ||= new Promise(resolve => { finishCleanup = () => resolve({ terminated: true, exitObserved: true, groupEmpty: true }); }); }
  }
  const bridge = new Bridge(config, { api: { token: 'secret', async post(route, body) { return { ackSeq: body.events.at(-1).seq }; } }, appFactory: () => new FakeApp(), report() {} });
  const run = bridge.journal.claim(job()); const active = bridge.active = { run, requests: new Map() }; active.promise = bridge.execute(run);
  while (!run.turnId) await new Promise(resolve => setImmediate(resolve));
  const cancellation = bridge.cancel(); while (!interruptSent) await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(run.phase, 'cancelled'); finishTurn();
  while (!finishCleanup) await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(run.phase, 'cancelled'); finishCleanup(); await cancellation; await active.promise;
  assert.equal(run.phase, 'cancelled'); assert.equal(run.events.at(-1).data.state, 'cancelled');
});

test('completed turn with unverified process cleanup remains unknown and cannot retry', async t => {
  const { config } = setup(t);
  class FakeApp extends EventEmitter {
    async initialize() {}
    async close() { return { terminated: false, exitObserved: true, groupEmpty: false }; }
    async request(method) {
      if (method === 'account/read') return { account: { type: 'chatgpt' } };
      if (method === 'skills/list') return { data: [] };
      if (method === 'config/read') return { config: {} };
      if (method === 'mcpServerStatus/list') return { data: [], nextCursor: null };
      if (method === 'thread/start') return { thread: { id: 'thread-1' } };
      if (method === 'turn/start') { queueMicrotask(() => this.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [{ type: 'agentMessage', text: 'Done.' }] } } })); return { turn: { id: 'turn-1' } }; }
    }
  }
  const bridge = new Bridge(config, { api: { token: 'secret', async post(route, body) { return { ackSeq: body.events.at(-1).seq }; } }, appFactory: () => new FakeApp(), report() {} });
  const run = bridge.journal.claim(job()); bridge.active = { run, requests: new Map() }; await bridge.execute(run);
  assert.equal(run.phase, 'unknown'); assert.equal(run.events.some(event => event.kind === 'result'), false); assert.equal(run.events.at(-1).data.state, 'unknown');
});

test('live owned process group cleanup requires observed exit and disappearance', async t => {
  if (process.platform === 'win32') return;
  const app = new AppServer({ spawnProcess: (_, __, options) => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options) });
  t.after(() => app.close()); const evidence = await app.close();
  assert.equal(evidence.terminated, true); assert.equal(evidence.exitObserved, true); assert.equal(evidence.groupEmpty, true);
});

test('model start waits for first binding ACK and cancel flag in ACK prevents any turn', async t => {
  const { config } = setup(t); let ack; let turnCount = 0; let firstEvent;
  const Runtime = minimalRuntime({ onTurn() { turnCount++; } });
  const bridge = new Bridge(config, { api: { token: 'secret', async post(route, body) { firstEvent = body.events[0]; return new Promise(resolve => { ack = resolve; }); } }, appFactory: () => new Runtime(), report() {} });
  const run = bridge.journal.claim(job()); bridge.active = { run, requests: new Map() }; const executing = bridge.execute(run);
  while (!ack) await new Promise(resolve => setImmediate(resolve));
  assert.equal(turnCount, 0); assert.equal(firstEvent.kind, 'state'); assert.equal(firstEvent.data.threadId, 'thread-1'); assert.equal(firstEvent.data.attemptId, run.attemptId);
  ack({ ackSeq: 1, cancelRequested: true }); await executing; assert.equal(turnCount, 0); assert.equal(run.phase, 'cancelled');
});

test('cancellation during initialization uses SETUP_FAILED before any model binding', async t => {
  const { config } = setup(t); let rejectInitialize;
  const Runtime = minimalRuntime({ initialize() { return new Promise((_, reject) => { rejectInitialize = reject; }); }, close() { rejectInitialize(new Error('Runtime closed.')); return { terminated: true, exitObserved: true, groupEmpty: true }; } });
  const bridge = new Bridge(config, { api: { token: 'secret' }, appFactory: () => new Runtime(), report() {} });
  const run = bridge.journal.claim(job()); const active = bridge.active = { run, requests: new Map() }; active.promise = bridge.execute(run);
  await bridge.cancel(); assert.equal(run.phase, 'cancelled'); assert.equal(run.turnStartSent, undefined); assert.equal(run.events[0].kind, 'error'); assert.equal(run.events[0].data.code, 'SETUP_FAILED');
});

test('late cancellation after observed completed turn and verified cleanup does not become unknown', async t => {
  const { config } = setup(t); let releaseCleanup;
  const Runtime = minimalRuntime({ close(app) { return app.cleanup ||= new Promise(resolve => { releaseCleanup = () => resolve({ terminated: true, exitObserved: true, groupEmpty: true }); }); } });
  const bridge = new Bridge(config, { api: { token: 'secret', async post(route, body) { return { ackSeq: body.events.at(-1).seq }; } }, appFactory: () => new Runtime(), report() {} });
  const run = bridge.journal.claim(job()); const active = bridge.active = { run, requests: new Map() }; active.promise = bridge.execute(run);
  while (!releaseCleanup) await new Promise(resolve => setImmediate(resolve)); assert.equal(run.turnCompleted.status, 'completed');
  const cancellation = bridge.cancel(); releaseCleanup(); await cancellation; assert.equal(run.phase, 'cancelled');
});

test('large approval details are explicitly truncated before journal and UTF-8 batches stay below budget', () => {
  const details = normalizeEventData('approval', { message: 'Review', details: { method: 'item/fileChange/requestApproval', patch: '很'.repeat(100000) } });
  assert.equal(details.details.truncated, true); assert.match(details.details.notice, /Review the original/); assert.ok(Buffer.byteLength(JSON.stringify(details)) < EVENT_BYTES);
  const events = Array.from({ length: 30 }, (_, i) => ({ seq: i + 1, kind: 'progress', data: normalizeEventData('progress', { message: '很'.repeat(12000) }) }));
  const batch = eventBatch(events); assert.ok(batch.length < 30); assert.ok(Buffer.byteLength(JSON.stringify({ events: batch })) <= BATCH_BYTES);
});

test('permanent event rejection preserves journal and still heartbeats for cancellation', async t => {
  const { config } = setup(t); const routes = [];
  const bridge = new Bridge(config, { api: { token: 'secret', async post(route) { routes.push(route); if (route.endsWith('/events')) { const error = new Error('Rejected'); error.status = 413; throw error; } return { runs: [], approvalDecisions: [], cancelRunIds: [] }; } }, report() {} });
  const run = bridge.journal.claim(job()); bridge.emit(run, 'progress', { message: 'Historical event' }); bridge.capabilities = { status: 'ready', skills: [], mcp: [] };
  await bridge.tick(); assert.equal(run.deliveryBlocked.status, 413); assert.equal(run.events.length, 1); assert.deepEqual(routes, ['device/runs/run-1/events', 'device/heartbeat']);
  await bridge.tick(); assert.equal(routes.filter(route => route.endsWith('/events')).length, 1); assert.equal(routes.at(-1), 'device/heartbeat');
});

test('oversized PM plan becomes clear terminal error after real turn and cleanup', async t => {
  const { config } = setup(t); const plan = { goal: 'Goal', tasks: [{ id: 'task', title: 'Task', description: 'x'.repeat(90000), agentId: 'developer', dependsOn: [], acceptanceCriteria: ['Done'] }] };
  const Runtime = minimalRuntime({ final: JSON.stringify(plan) });
  const bridge = new Bridge(config, { api: { token: 'secret', async post(route, body) { return { ackSeq: body.events.at(-1).seq }; } }, appFactory: () => new Runtime(), report() {} });
  const run = bridge.journal.claim(job({ kind: 'plan', planningContext: { agents: [{ id: 'developer' }] } })); bridge.active = { run, requests: new Map() }; await bridge.execute(run);
  assert.equal(run.phase, 'failed'); assert.equal(run.events.at(-1).kind, 'error'); assert.equal(run.events.at(-1).data.code, 'EVENT_TOO_LARGE'); assert.equal(run.events.some(event => event.kind === 'result'), false);
});

test('artifact collector returns bounded relative changed and untracked filenames', async t => {
  const { config } = setup(t); const root = config.projects[0].path; const git = args => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  git(['init']); fs.writeFileSync(path.join(root, 'tracked.txt'), 'before'); git(['add', '.']); git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'initial']);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'after'); fs.writeFileSync(path.join(root, 'new.txt'), 'new');
  assert.deepEqual(await collectArtifacts(root), [{ name: 'new.txt', kind: 'file' }, { name: 'tracked.txt', kind: 'file' }]);
});

test('PM plan rejects unknown Agents, missing acceptance criteria and cycles', () => {
  const task = { id: 'a', title: 'Task', description: 'Implement', agentId: 'developer', dependsOn: [], acceptanceCriteria: ['Works'] };
  const agents = [{ id: 'developer' }]; assert.ok(validatePlan({ goal: 'Goal', tasks: [task] }, agents));
  assert.throws(() => validatePlan({ goal: 'Goal', tasks: [{ ...task, agentId: 'not-owned' }] }, agents));
  assert.throws(() => validatePlan({ goal: 'Goal', tasks: [{ ...task, dependsOn: ['a'] }] }, agents), /cycle/);
  assert.throws(() => validatePlan({ goal: 'Goal', tasks: [{ ...task, acceptanceCriteria: [] }] }, agents));
});

test('file credentials cannot be accidentally enabled in production', t => {
  const { dir } = setup(t); const original = process.env.NODE_ENV; delete process.env.NODE_ENV;
  try { assert.throws(() => new CredentialStore({ testSecretFile: path.join(dir, 'secrets.json') }), /only supported in tests/); }
  finally { if (original === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original; }
});
