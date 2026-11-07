import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createAgentExecution } from '../lib/agent-execution.mjs';

function setup(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL)');
  for (const migration of ['008-developer-hub.sql', '009-agent-execution.sql']) db.exec(readFileSync(new URL('../migrations/' + migration, import.meta.url), 'utf8'));
  let at = Date.parse('2026-01-01T10:00:00Z');
  const catalog = { source: { revision: 'test-role-revision' }, sharedInstructions: 'Synthetic shared runtime guidance for isolated tests.', roles: [
    { id: 'product-manager', name: 'PM', instructions: 'Synthetic planner instructions for test execution only.' },
    { id: 'developer', name: 'Developer', instructions: 'Synthetic developer instructions for test execution only.' },
    { id: 'tester', name: 'Tester', instructions: 'Synthetic tester instructions for test execution only.' }
  ] };
  const service = createAgentExecution({ db, roleCatalog: catalog, rolesForOwner: owner => owner === 'alice' ? catalog : { roles: catalog.roles.map(({ id, name }) => ({ id, name })) }, now: () => at });
  const agents = service.ensureAgents('alice').agents;
  function connect(owner = 'alice') {
    const pairing = service.createPairingCode(owner);
    const result = service.pair({ code: pairing.code, name: 'Test Mac', platform: 'darwin', version: 'test' });
    const device = service.authenticateDevice(result.deviceToken);
    beat(device);
    return { ...result, device, pairing };
  }
  const report = { harnesses: [{ id: 'codex', status: 'ready', version: 'test', skills: [], mcp: [] }], projects: [{ id: 'test-project', name: 'Test project' }], activeRuns: [] };
  function beat(device, changes = {}) { return service.heartbeat(device, { ...report, ...changes }); }
  const connected = connect();
  function task(changes = {}) {
    return service.createTask('alice', { requestId: randomUUID(), title: 'Test work', description: 'Carry out the specified test task.', acceptanceCriteria: ['Result can be inspected'], mode: 'manual', agentId: agents.find(agent => agent.roleId === 'developer').id, deviceId: connected.deviceId, projectId: 'test-project', harnessId: 'codex', ...changes });
  }
  function events(runId, values, device = connected.device) { return service.appendEvents(device, runId, { events: values }); }
  return { db, service, agents, connected, connect, beat, task, events, report, advance: ms => at += ms };
}
const event = (seq, kind, data) => ({ seq, kind, data: kind === 'state' && data.state === 'running' ? { threadId: 'thread-test', attemptId: 'attempt-test', ...data } : data });
const started = () => event(1, 'state', { state: 'running' });
const result = seq => event(seq, 'result', { summary: 'Execution completed; acceptance remains pending.', artifacts: [{ name: 'Test report', uri: 'https://example.invalid/results/1' }] });

test('pairing is one-use and expiring, device tokens hashed, ownership and revocation enforced', t => {
  const h = setup(t), { service, connected } = h;
  assert.throws(() => service.pair({ code: connected.pairing.code, name: 'Again', platform: 'darwin' }), { status: 401 });
  const expiry = service.createPairingCode('bob');
  h.advance(600_001);
  assert.throws(() => service.pair({ code: expiry.code, name: 'Late', platform: 'darwin' }), { status: 401 });
  assert.equal(service.listDevices('bob').devices.length, 0);
  const stored = h.db.prepare('SELECT * FROM agent_execution_devices').get();
  assert.notEqual(stored.token_hash, connected.deviceToken);
  assert.equal(JSON.stringify(service.listDevices('alice')).includes(connected.deviceToken), false);
  assert.throws(() => service.revokeDevice('bob', connected.deviceId), { status: 404 });
  service.revokeDevice('alice', connected.deviceId);
  assert.throws(() => service.authenticateDevice(connected.deviceToken), { status: 401 });
  assert.throws(() => h.beat(connected.device), { status: 401 });
});

test('manual task idempotency, atomic claim, account scope, event ordering/dedup, pending acceptance', t => {
  const h = setup(t), created = h.task(), original = JSON.parse(h.db.prepare('SELECT body FROM agent_execution_tasks WHERE id=?').get(created.task.id).body);
  const payload = { requestId: 'repeat-request', title: 'Repeat', description: 'One request', acceptanceCriteria: [], mode: 'manual', agentId: original.agentId, deviceId: original.deviceId, projectId: original.projectId, harnessId: 'codex' };
  const first = h.service.createTask('alice', payload), duplicate = h.service.createTask('alice', { ...payload });
  assert.equal(duplicate.run.id, first.run.id);
  assert.throws(() => h.service.createTask('alice', { ...payload, title: 'Different' }), { status: 409 });
  assert.throws(() => h.service.getTask('bob', created.task.id), { status: 404 });
  const claimed = h.service.claim(h.connected.device).run;
  assert.equal(claimed.runId, created.run.id);
  assert.equal(claimed.kind, 'execute');
  assert.match(claimed.role.instructions, /Synthetic developer/);
  assert.deepEqual(h.service.claim(h.connected.device).run, claimed);
  assert.throws(() => h.events(claimed.runId, [event(2, 'progress', { message: 'Out of order' })]), { status: 409 });
  const running = event(1, 'state', { state: 'running' });
  assert.deepEqual(h.events(claimed.runId, [running]), { ackSeq: 1 });
  assert.deepEqual(h.events(claimed.runId, [running]), { ackSeq: 1 });
  assert.throws(() => h.events(claimed.runId, [event(1, 'progress', { message: 'Changed' })]), { status: 409 });
  assert.deepEqual(h.events(claimed.runId, [running, result(2)]), { ackSeq: 2 });
  assert.deepEqual(h.events(claimed.runId, [result(2)]), { ackSeq: 2 });
  const detail = h.service.getTask('alice', created.task.id);
  assert.equal(detail.task.status, 'awaiting_acceptance');
  assert.equal(detail.runs[0].status, 'succeeded');
  assert.equal(detail.events.length, 2);
  assert.equal(JSON.stringify(detail).includes('Synthetic developer'), false);
});

test('offline and lost claim remain unknown and never auto-start or retry', t => {
  const h = setup(t), created = h.task();
  const claim = h.service.claim(h.connected.device).run;
  h.events(claim.runId, [started()]);
  h.advance(120_000);
  const detail = h.service.getTask('alice', created.task.id);
  assert.equal(detail.runs[0].status, 'running');
  assert.equal(detail.runs[0].connectionStatus, 'unknown');
  assert.throws(() => h.service.retryTask('alice', created.task.id, { requestId: 'no-timeout-retry' }), { status: 409 });
  const beat = h.beat(h.connected.device);
  assert.deepEqual(beat.runs, [{ runId: claim.runId, status: 'running', ackSeq: 1 }]);
  assert.equal(h.service.claim(h.connected.device).run, null);
  h.events(claim.runId, [event(2, 'state', { state: 'interrupted', message: 'Original process termination verified' })]);
  const retry = h.service.retryTask('alice', created.task.id, { requestId: 'explicit-retry' });
  assert.notEqual(retry.run.id, claim.runId);
  assert.equal(retry.run.retryOf, claim.runId);
  assert.equal(h.service.retryTask('alice', created.task.id, { requestId: 'explicit-retry' }).run.id, retry.run.id);
  assert.equal(h.service.getTask('alice', created.task.id).runs.length, 2);
});

test('approvals remain bound to run/device, decisions are durable and cancellation reaches process', t => {
  const h = setup(t), created = h.task(), other = h.connect();
  h.service.claim(h.connected.device);
  assert.throws(() => h.events(created.run.id, [event(1, 'progress', { message: 'Wrong device' })], other.device), { status: 403 });
  h.events(created.run.id, [started(), event(2, 'approval', { approvalId: 'request-1', kind: 'approval', message: 'Allow requested command?', details: { command: 'test', token: 'fictional' } })]);
  assert.equal(h.service.getTask('alice', created.task.id).task.status, 'awaiting_approval');
  assert.throws(() => h.events(created.run.id, [result(3)]), { status: 409 });
  assert.throws(() => h.service.decideApproval('bob', created.run.id, 'request-1', { decision: 'approve' }), { status: 404 });
  h.service.decideApproval('alice', created.run.id, 'request-1', { decision: 'deny' });
  assert.equal(h.beat(h.connected.device).approvalDecisions[0].decision, 'deny');
  assert.equal(h.beat(h.connected.device).approvalDecisions[0].decision, 'deny');
  assert.throws(() => h.service.decideApproval('alice', created.run.id, 'request-1', { decision: 'approve' }), { status: 409 });
  h.events(created.run.id, [event(3, 'state', { state: 'running' })]);
  h.service.cancelTask('alice', created.task.id);
  assert.deepEqual(h.beat(h.connected.device).cancelRunIds, [created.run.id]);
  assert.equal(h.service.getTask('alice', created.task.id).runs[0].status, 'running');
  h.events(created.run.id, [event(4, 'state', { state: 'cancelled' })]);
  assert.equal(h.service.getTask('alice', created.task.id).runs[0].status, 'cancelled');
});

test('real PM result validates DAG, creates children once and enforces dependency handoffs', t => {
  const h = setup(t), pm = h.agents.find(agent => agent.roleId === 'product-manager'), dev = h.agents.find(agent => agent.roleId === 'developer'), tester = h.agents.find(agent => agent.roleId === 'tester');
  const root = h.task({ mode: 'automatic', agentId: pm.id });
  const planning = h.service.claim(h.connected.device).run;
  assert.equal(planning.kind, 'plan');
  assert.equal(planning.planningContext.agents.length, 3);
  assert.deepEqual(h.service.getTask('alice', root.task.id).children, []);
  const planned = event(2, 'result', { summary: 'PM plan', artifacts: [], plan: { goal: 'Deliver the requested result', tasks: [
    { id: 'verify', title: 'Verify result', description: 'Inspect output independently', agentId: tester.id, dependsOn: ['build'], inputs: [{ taskId: 'build', description: 'Implementation and test output' }], acceptanceCriteria: ['Evidence is inspectable'] },
    { id: 'build', title: 'Build result', description: 'Implement requested change', agentId: dev.id, dependsOn: [], acceptanceCriteria: ['Change works'] }
  ] } });
  h.events(root.run.id, [started(), planned]);
  h.events(root.run.id, [started(), planned]);
  const detail = h.service.getTask('alice', root.task.id);
  assert.equal(detail.children.length, 2);
  assert.equal(detail.task.status, 'running');
  const first = h.service.claim(h.connected.device).run;
  assert.equal(first.title, 'Build result');
  h.events(first.runId, [started(), result(2)]);
  const second = h.service.claim(h.connected.device).run;
  assert.equal(second.title, 'Verify result');
  assert.match(second.instructions, /Execution completed/);
  h.events(second.runId, [started(), result(2)]);
  assert.equal(h.service.getTask('alice', root.task.id).task.status, 'awaiting_acceptance');
  assert.equal(h.service.claim(h.connected.device).run, null);
});

test('invalid PM cycle or unknown Agent fails planning without partial child tasks', t => {
  for (const scenario of ['cycle', 'foreign']) {
    const h = setup(t), pm = h.agents.find(agent => agent.roleId === 'product-manager'), dev = h.agents.find(agent => agent.roleId === 'developer');
    const root = h.task({ mode: 'automatic', agentId: pm.id });
    h.service.claim(h.connected.device);
    h.events(root.run.id, [started(), event(2, 'result', { summary: 'Invalid plan', artifacts: [], plan: { goal: 'Test', tasks: [
      { id: 'a', title: 'A', description: 'Do A', agentId: scenario === 'foreign' ? randomUUID() : dev.id, dependsOn: scenario === 'cycle' ? ['b'] : [], acceptanceCriteria: ['A works'] },
      { id: 'b', title: 'B', description: 'Do B', agentId: dev.id, dependsOn: ['a'], acceptanceCriteria: ['B works'] }
    ] } })]);
    const detail = h.service.getTask('alice', root.task.id);
    assert.equal(detail.runs[0].status, 'failed');
    assert.equal(detail.task.status, 'blocked');
    assert.equal(detail.children.length, 0);
  }
});

test('capabilities, private role visibility and project path boundaries block unsafe dispatch', t => {
  const h = setup(t), { service } = h;
  assert.throws(() => h.beat(h.connected.device, { projects: [{ id: 'test', name: '/Users/test/project' }] }), { status: 400 });
  const dev = h.agents.find(agent => agent.roleId === 'developer');
  dev.skills = [{ name: 'Required skill', status: 'configured' }];
  h.db.prepare("UPDATE developer_hub_entries SET body=? WHERE owner='alice' AND id=?").run(JSON.stringify(dev), dev.id);
  assert.throws(() => h.task(), { status: 409 });
  h.beat(h.connected.device, { harnesses: [{ id: 'codex', status: 'ready', skills: [{ name: 'Required skill', status: 'available' }], mcp: [] }] });
  const created = h.task();
  assert.equal(created.run.status, 'queued');
  const bob = h.connect('bob');
  const bobAgent = service.ensureAgents('bob').agents.find(agent => agent.roleId === 'developer');
  assert.throws(() => service.createTask('bob', { requestId: randomUUID(), title: 'No role access', description: 'Test', mode: 'manual', agentId: bobAgent.id, deviceId: bob.deviceId, projectId: 'test-project', harnessId: 'codex' }), { status: 409 });
  assert.throws(() => service.getTask('bob', created.task.id), { status: 404 });
});

test('event persistence strips credentials, local paths and whole private role prompt', t => {
  const h = setup(t), created = h.task(), claim = h.service.claim(h.connected.device).run;
  h.events(created.run.id, [started(), event(2, 'progress', { message: `Local /Users/test/project/file token awdev_${'a'.repeat(43)} ${claim.role.instructions}` }), result(3)]);
  const detail = JSON.stringify(h.service.getTask('alice', created.task.id));
  assert.equal(detail.includes('/Users/test'), false);
  assert.equal(detail.includes('awdev_'), false);
  assert.equal(detail.includes('Synthetic developer'), false);
});

test('failed automatic dependency blocks successor until explicit retry and survives service reconstruction', t => {
  const h = setup(t), pm = h.agents.find(agent => agent.roleId === 'product-manager'), dev = h.agents.find(agent => agent.roleId === 'developer');
  const root = h.task({ mode: 'automatic', agentId: pm.id });
  h.service.claim(h.connected.device);
  h.events(root.run.id, [started(), event(2, 'result', { summary: 'Plan', plan: { goal: 'Test dependency gating', tasks: [
    { id: 'first', title: 'First', description: 'First task', agentId: dev.id, dependsOn: [], acceptanceCriteria: ['First succeeds'] },
    { id: 'second', title: 'Second', description: 'Second task', agentId: dev.id, dependsOn: ['first'], acceptanceCriteria: ['Second succeeds'] }
  ] } })]);
  const first = h.service.claim(h.connected.device).run;
  h.events(first.runId, [started(), event(2, 'error', { message: 'Actual harness failure' })]);
  assert.equal(h.service.getTask('alice', root.task.id).task.status, 'blocked');
  assert.equal(h.service.claim(h.connected.device).run, null);
  const retry = h.service.retryTask('alice', first.taskId, { requestId: 'retry-dependent' });
  assert.equal(h.service.claim(h.connected.device).run.runId, retry.run.id);
  h.events(retry.run.id, [started(), result(2)]);
  const rebuilt = createAgentExecution({ db: h.db });
  assert.equal(rebuilt.getTask('alice', first.taskId).runs.length, 2);
  assert.equal(rebuilt.getTask('alice', first.taskId).runs[1].ackSeq, 2);
  // Explicit cancellation of predecessor blocks its downstream consumer even after process success.
  h.service.cancelTask('alice', first.taskId);
  assert.equal(h.service.getTask('alice', root.task.id).task.status, 'blocked');
  assert.equal(h.service.claim(h.connected.device).run, null);
});

test('Codex thread and turn identity is preserved, validated, immutable and device scoped', t => {
  const h = setup(t), created = h.task(), other = h.connect();
  h.service.claim(h.connected.device);
  const running = event(1, 'state', { state: 'running', threadId: 'thread-test-123', turnId: '0' });
  assert.throws(() => h.events(created.run.id, [running], other.device), { status: 403 });
  h.events(created.run.id, [running]);
  let detail = h.service.getTask('alice', created.task.id);
  assert.equal(detail.runs[0].threadId, 'thread-test-123');
  assert.equal(detail.runs[0].turnId, '0');
  assert.equal(detail.events[0].data.threadId, 'thread-test-123');
  assert.throws(() => h.events(created.run.id, [event(2, 'state', { state: 'running', threadId: 'different-thread' })]), { status: 409 });
  assert.throws(() => h.events(created.run.id, [event(2, 'state', { state: 'running', turnId: '/Users/test/path' })]), { status: 400 });
  assert.throws(() => h.events(created.run.id, [event(2, 'state', { state: 'running', turnId: 'a'.repeat(161) })]), { status: 400 });
  h.events(created.run.id, [result(2)]);
  detail = h.service.getTask('alice', created.task.id);
  assert.equal(detail.runs[0].threadId, 'thread-test-123');
  assert.equal(detail.runs[0].turnId, '0');
});

test('lost claim redelivers one immutable job until thread+attempt ACK and rejects competing starts', t => {
  const h = setup(t), created = h.task();
  const original = h.service.claim(h.connected.device).run;
  assert.deepEqual(h.service.claim(h.connected.device).run, original);
  assert.throws(() => h.events(created.run.id, [{ seq: 1, kind: 'state', data: { state: 'running', threadId: 'thread-only' } }]), { status: 409 });
  assert.throws(() => h.events(created.run.id, [event(1, 'progress', { message: 'Not authorized to turn/start yet' })]), { status: 409 });
  assert.throws(() => h.events(created.run.id, [result(1)]), { status: 409 });
  const accepted = event(1, 'state', { state: 'running', threadId: 'actual-thread', attemptId: 'durable-attempt-a' });
  assert.deepEqual(h.events(created.run.id, [accepted]), { ackSeq: 1 });
  assert.deepEqual(h.events(created.run.id, [accepted]), { ackSeq: 1 });
  assert.throws(() => h.events(created.run.id, [event(1, 'state', { state: 'running', threadId: 'competing-thread', attemptId: 'durable-attempt-b' })]), { status: 409 });
  assert.equal(h.service.claim(h.connected.device).run, null);
  const run = h.service.getTask('alice', created.task.id).runs[0];
  assert.equal(run.attemptId, 'durable-attempt-a');
  assert.equal(run.threadId, 'actual-thread');
  assert.equal(JSON.stringify(h.service.getTask('alice', created.task.id)).includes('claimPayload'), false);
});

test('unknown is durable and blocks starts/retries until same device verifies original termination', t => {
  const h = setup(t), created = h.task();
  h.service.claim(h.connected.device);
  h.events(created.run.id, [started(), event(2, 'state', { state: 'unknown', threadId: 'thread-test', attemptId: 'attempt-test', message: 'Cancellation could not confirm process exit' })]);
  const detail = h.service.getTask('alice', created.task.id);
  assert.equal(detail.runs[0].status, 'unknown');
  assert.equal(detail.runs[0].connectionStatus, 'unknown');
  assert.equal(detail.runs[0].endedAt, null);
  assert.equal(h.beat(h.connected.device).runs[0].status, 'unknown');
  h.task({ title: 'Queued behind unknown run' });
  assert.equal(h.service.claim(h.connected.device).run, null);
  assert.throws(() => h.service.retryTask('alice', created.task.id, { requestId: 'unsafe-retry' }), { status: 409 });
  assert.throws(() => h.events(created.run.id, [result(3)]), { status: 409 });
  assert.throws(() => h.events(created.run.id, [event(3, 'state', { state: 'running' })]), { status: 409 });
  assert.throws(() => h.events(created.run.id, [event(3, 'state', { state: 'interrupted' })]), { status: 409 });
  h.events(created.run.id, [event(3, 'state', { state: 'interrupted', threadId: 'thread-test', attemptId: 'attempt-test', message: 'Original harness process group confirmed terminated' })]);
  assert.equal(h.service.getTask('alice', created.task.id).runs[0].status, 'interrupted');
});

test('pre-model setup failure is terminal but uncertain preparation stays blocked without start authorization', t => {
  const h = setup(t), created = h.task();
  h.service.claim(h.connected.device);
  assert.throws(() => h.events(created.run.id, [event(1, 'error', { code: 'HARNESS_ERROR', message: 'Not an explicit pre-model failure attestation' })]), { status: 409 });
  h.events(created.run.id, [event(1, 'error', { code: 'SETUP_FAILED', message: 'No turn/start was sent; setup cleanup verified' })]);
  assert.equal(h.service.getTask('alice', created.task.id).runs[0].status, 'failed');
  const retry = h.service.retryTask('alice', created.task.id, { requestId: 'setup-retry' });
  h.service.claim(h.connected.device);
  h.events(retry.run.id, [event(1, 'state', { state: 'unknown', message: 'Cannot verify startup process cleanup' })]);
  assert.equal(h.service.claim(h.connected.device).run, null);
  assert.throws(() => h.events(retry.run.id, [event(2, 'state', { state: 'running' })]), { status: 409 });
  assert.throws(() => h.service.retryTask('alice', created.task.id, { requestId: 'not-safe' }), { status: 409 });
});

test('MCP form response validation leaves invalid inputs pending until schema matches', t => {
  const h = setup(t), created = h.task();
  h.service.claim(h.connected.device);
  h.events(created.run.id, [started(), event(2, 'approval', { approvalId: 'mcp-form', kind: 'input', message: 'Fill requested form', details: { method: 'mcpServer/elicitation/request', requestedSchema: { type: 'object', required: ['name', 'count'], properties: { name: { type: 'string', minLength: 1 }, count: { type: 'integer' } }, additionalProperties: false } } })]);
  for (const response of ['not JSON', '{}', '{"name":"Test","count":"two"}', '{"name":"Test","count":2,"extra":true}']) {
    assert.throws(() => h.service.decideApproval('alice', created.run.id, 'mcp-form', { decision: 'approve', response }), { status: 400 });
    assert.equal(h.service.getTask('alice', created.task.id).approvals[0].status, 'pending');
    assert.deepEqual(h.beat(h.connected.device).approvalDecisions, []);
  }
  h.service.decideApproval('alice', created.run.id, 'mcp-form', { decision: 'approve', response: '{"name":"Test","count":2}' });
  assert.equal(h.service.getTask('alice', created.task.id).approvals[0].status, 'approved');
});

test('multiple-question approval requires complete known question IDs and nonempty string arrays', t => {
  const h = setup(t), created = h.task();
  h.service.claim(h.connected.device);
  h.events(created.run.id, [started(), event(2, 'approval', { approvalId: 'question-form', kind: 'input', message: 'Answer two questions', details: { method: 'item/tool/requestUserInput', questions: [{ id: 'q1' }, { id: 'q2' }] } })]);
  for (const response of ['not JSON', '{}', '{"q1":["A"]}', '{"q1":["A"],"q2":[]}', '{"q1":["A"],"q2":[""]}', '{"q1":["A"],"q2":"B"}', '{"q1":["A"],"q2":["B"],"unknown":["C"]}']) {
    assert.throws(() => h.service.decideApproval('alice', created.run.id, 'question-form', { decision: 'approve', response }), { status: 400 });
    assert.equal(h.service.getTask('alice', created.task.id).approvals[0].status, 'pending');
  }
  h.service.decideApproval('alice', created.run.id, 'question-form', { decision: 'approve', response: '{"q1":["A"],"q2":["B"]}' });
  assert.equal(h.beat(h.connected.device).approvalDecisions[0].decision, 'approve');
});

test('unsupported states and new terminal transitions are rejected while exact retransmission deduplicates', t => {
  const h = setup(t), created = h.task();
  h.service.claim(h.connected.device);
  assert.throws(() => h.events(created.run.id, [event(1, 'state', { state: 'succeeded' })]), { status: 400 });
  h.events(created.run.id, [started(), result(2)]);
  assert.deepEqual(h.events(created.run.id, [result(2)]), { ackSeq: 2 });
  assert.throws(() => h.events(created.run.id, [event(3, 'state', { state: 'cancelled' })]), { status: 409 });
  assert.throws(() => h.events(created.run.id, [result(3)]), { status: 409 });
  assert.equal(h.service.getTask('alice', created.task.id).runs[0].status, 'succeeded');
});

test('first model-start ACK signals cancellation atomically, including lost ACK retransmission', t => {
  const h = setup(t), created = h.task();
  h.service.claim(h.connected.device);
  h.service.cancelTask('alice', created.task.id);
  const running = started();
  assert.deepEqual(h.events(created.run.id, [running]), { ackSeq: 1, cancelRequested: true });
  assert.deepEqual(h.events(created.run.id, [running]), { ackSeq: 1, cancelRequested: true });
  assert.equal(h.service.getTask('alice', created.task.id).task.status, 'cancelled');
  // Connector sees cancellation in ACK, starts no model turn, verifies cleanup, then reports cancellation.
  assert.deepEqual(h.events(created.run.id, [event(2, 'state', { state: 'cancelled' })]), { ackSeq: 2, cancelRequested: true });
  assert.equal(h.service.getTask('alice', created.task.id).runs[0].status, 'cancelled');
});

test('cancel accepts already-spooled approvals as nonactionable audit events and drains terminal sequence', t => {
  const h = setup(t), created = h.task();
  h.service.claim(h.connected.device);
  h.events(created.run.id, [started()]);
  const spooledApproval = event(2, 'approval', { approvalId: 'in-flight-approval', kind: 'approval', message: 'Previously journaled command approval', details: { method: 'item/commandExecution/requestApproval', command: 'test command' } });
  h.service.cancelTask('alice', created.task.id);
  assert.deepEqual(h.events(created.run.id, [spooledApproval]), { ackSeq: 2, cancelRequested: true });
  assert.deepEqual(h.events(created.run.id, [spooledApproval]), { ackSeq: 2, cancelRequested: true });
  let detail = h.service.getTask('alice', created.task.id);
  assert.equal(detail.approvals[0].status, 'cancelled');
  assert.equal(detail.approvals[0].cancellationReason, 'task_cancelled');
  assert.equal(detail.task.status, 'cancelled');
  assert.deepEqual(h.beat(h.connected.device).approvalDecisions, []);
  assert.throws(() => h.service.decideApproval('alice', created.run.id, 'in-flight-approval', { decision: 'approve' }), { status: 409 });
  assert.deepEqual(h.events(created.run.id, [event(3, 'state', { state: 'cancelled' })]), { ackSeq: 3, cancelRequested: true });
  detail = h.service.getTask('alice', created.task.id);
  assert.equal(detail.runs[0].status, 'cancelled');
  assert.equal(detail.events.length, 3);
});

test('cancel invalidates pending approvals and prevents delivering prior approval decisions', t => {
  for (const decideBeforeCancel of [false, true]) {
    const h = setup(t), created = h.task();
    h.service.claim(h.connected.device);
    h.events(created.run.id, [started(), event(2, 'approval', { approvalId: 'approval-before-cancel', kind: 'approval', message: 'An already-uploaded approval', details: { method: 'item/fileChange/requestApproval' } })]);
    if (decideBeforeCancel) h.service.decideApproval('alice', created.run.id, 'approval-before-cancel', { decision: 'approve' });
    h.service.cancelTask('alice', created.task.id);
    assert.deepEqual(h.beat(h.connected.device).approvalDecisions, []);
    assert.equal(h.service.getTask('alice', created.task.id).approvals[0].status, decideBeforeCancel ? 'approved' : 'cancelled');
    h.events(created.run.id, [event(3, 'state', { state: 'cancelled' })]);
    assert.equal(h.service.getTask('alice', created.task.id).runs[0].status, 'cancelled');
  }
});

test('PM structured output schema requires every object property recursively for Codex strict mode', t => {
  const h = setup(t), pm = h.agents.find(agent => agent.roleId === 'product-manager');
  h.task({ mode: 'automatic', agentId: pm.id });
  const schema = h.service.claim(h.connected.device).run.planningContext.planSchema;
  function verify(node) {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      Object.values(node.properties).forEach(verify);
    }
    if (node.type === 'array') verify(node.items);
  }
  verify(schema);
  assert.ok(schema.properties.tasks.items.required.includes('inputs'));
});
