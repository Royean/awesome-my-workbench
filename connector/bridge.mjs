#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppServer, discover, mcpReady, executionToolConfig, approvalResult, APPROVAL_METHODS } from './app-server.mjs';
import { API, VERSION, Journal, CredentialStore, atomicJSON, readConfig, credentialAccount, defaultConfigFile, workspaceFor, redact } from './storage.mjs';
import { normalizeEventData, eventBatch, collectArtifacts } from './events.mjs';

const terminal = run => ['completed', 'failed', 'cancelled', 'interrupted'].includes(run.phase);
const blocked = run => !terminal(run);
const names = list => (list || []).map(item => typeof item === 'string' ? item : item?.name).filter(Boolean);
const execFileAsync = promisify(execFile);
const deadline = async (promise, ms) => {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })]); }
  finally { clearTimeout(timer); }
};
export const status = (state, message) => process.stdout.write(`${JSON.stringify({ type: 'status', state, message })}\n`);

export class Bridge {
  constructor(config, { api, journal, appFactory, report = status } = {}) {
    this.config = config; this.api = api; this.journal = journal || new Journal(config.stateDir);
    this.config.stateDir = this.journal.dir;
    this.appFactory = appFactory || (cwd => new AppServer({ codexPath: config.codexPath, cwd }));
    this.report = report; this.active = null; this.stopping = false; this.capabilities = null;
  }
  emit(run, kind, data) {
    const safe = redact(data, [...this.config.projects.map(project => project.path), this.config.stateDir, os.homedir(), run.cwd], [this.api.token]);
    return this.journal.event(run, kind, normalizeEventData(kind, safe));
  }
  reportConnection(message) {
    const state = this.active?.requests?.size ? 'approval' : this.active?.run.turnStartSent && !this.active.run.turnCompleted ? 'running' : 'offline';
    this.report(state, message);
  }
  async refreshCapabilities() {
    const app = this.appFactory(this.config.projects[0]?.path || path.dirname(this.config.stateDir));
    try {
      await app.initialize(); this.capabilities = await discover(app, this.config.projects);
      try {
        const { stdout } = await execFileAsync(this.config.codexPath || 'codex', ['--version'], { encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
        this.capabilities.version = stdout.match(/\bcodex-cli\s+([a-zA-Z0-9.+_-]+)/)?.[1] || 'unknown';
      } catch { this.capabilities.version = 'unknown'; }
      this.capabilityCheckedAt = new Date().toISOString();
    } finally { await app.close(); }
  }
  publicHarness() {
    const capabilities = this.capabilities;
    return { id: 'codex', name: 'Codex CLI', version: capabilities?.version || 'unknown', status: capabilities?.status || 'unavailable', skills: (capabilities?.skills || []).slice(0, 100).map(skill => ({ name: skill.name, status: skill.enabled ? 'available' : 'unavailable', checkedAt: this.capabilityCheckedAt })), mcp: (capabilities?.mcp || []).slice(0, 100).map(server => ({ name: server.name, status: mcpReady(server) ? 'available' : 'unavailable', checkedAt: this.capabilityCheckedAt })) };
  }
  async flush() {
    for (const run of Object.values(this.journal.data.runs)) {
      if (run.deliveryBlocked) continue;
      while (run.events.length) {
        try {
          const events = eventBatch(run.events);
          const response = await this.api.post(`device/runs/${encodeURIComponent(run.job.runId)}/events`, { events });
          if (response.ackSeq < events.at(-1).seq) throw new Error('Server did not acknowledge the event batch.');
          if (response.cancelRequested) run.cancelRequested = true;
          this.journal.acknowledge(run, response.ackSeq);
        } catch (error) {
          if (![400, 404, 409, 413, 422].includes(error.status) && !/delivery budget/.test(error.message)) throw error;
          run.deliveryBlocked = { status: error.status || 413, at: new Date().toISOString() };
          this.journal.save(); this.report('attention', 'Workbench rejected a journaled event. New execution is blocked; heartbeat and cancellation remain available.'); break;
        }
      }
    }
  }
  recover() {
    // Losing our process handle also loses trustworthy child/process-group exit evidence.
    // Never infer termination from a missing/recycled PID or replay turn/start.
    for (const run of Object.values(this.journal.data.runs)) if (!terminal(run)) {
      if (run.phase === 'unknown') continue;
      this.markUnknown(run, 'Mac connector restarted without confirmed process termination. This run blocks new execution until its process state is verified.');
    }
  }
  markUnknown(run, message) {
    run.phase = 'unknown';
    this.emit(run, 'state', { state: 'unknown', ...(run.attemptId ? { attemptId: run.attemptId } : {}), ...(run.threadId ? { threadId: run.threadId } : {}), ...(run.turnId ? { turnId: run.turnId } : {}), message });
    this.report('attention', 'Run state is unknown. New execution is blocked until termination is verified.');
  }
  async tick() {
    try { await this.flush(); }
    catch (error) { if ([401, 403].includes(error.status)) throw error; this.reportConnection('Event delivery is waiting to retry. Checking device controls.'); }
    const response = await this.api.post('device/heartbeat', {
      harnesses: [this.publicHarness()], projects: this.config.projects.map(({ id, name }) => ({ id, name })),
      activeRuns: Object.values(this.journal.data.runs).filter(run => blocked(run) || run.deliveryBlocked).map(run => run.job.runId),
    });
    for (const runId of response.cancelRunIds || []) if (this.active?.run.job.runId === runId) await this.cancel();
    for (const decision of response.approvalDecisions || []) this.applyDecision(decision);
    // Unknown run IDs are durable lost claims. Never turn them into a new model call.
    const unknown = (response.runs || []).filter(run => !this.journal.data.runs[run.runId] && !(run.status === 'starting' && run.ackSeq === 0) && !['completed', 'succeeded', 'failed', 'cancelled', 'interrupted', 'awaiting_acceptance'].includes(run.status));
    if (unknown.length) this.report('attention', 'An earlier claim needs review in Workbench. It was not relaunched.');
    const localUnknown = Object.values(this.journal.data.runs).some(run => run.phase === 'unknown' || run.deliveryBlocked);
    if (!this.stopping && !this.active && !unknown.length && !localUnknown && this.capabilities?.status === 'ready' && this.config.projects.length) {
      const { run: job } = await this.api.post('device/claim', {});
      if (job) {
        const run = this.journal.claim(job);
        if (!run) { this.report('attention', 'A previously journaled run was returned; no duplicate execution started.'); return; }
        // claim() fsyncs before any harness call.
        this.active = { run, app: null, requests: new Map() };
        this.active.promise = this.execute(run).catch(error => {
          if (!terminal(run) && run.phase !== 'unknown') {
            if (run.appServer) this.markUnknown(run, 'Harness cleanup could not be verified. New execution is blocked.');
            else { run.phase = 'failed'; this.emit(run, 'error', { message: error.message, code: run.nextSeq === 1 && !run.turnStartSent ? 'SETUP_FAILED' : 'HARNESS_ERROR' }); }
          }
        }).finally(() => { this.active = null; this.report(run.phase === 'unknown' ? 'attention' : 'ready', run.phase === 'unknown' ? 'Process termination needs verification in Workbench.' : 'Connected to Workbench.'); });
      }
    }
  }
  applyDecision(decision) {
    if (this.active?.run.job.runId !== decision.runId) return;
    const { run, app, requests } = this.active;
    const request = requests.get(decision.approvalId);
    if (!request || run.pending[decision.approvalId]?.resolved) return;
    try {
      const result = approvalResult(request, decision);
      // The original live RPC request ID is retained locally; the server cannot replace it.
      app.respond(request.id, result);
      run.pending[decision.approvalId].resolved = true; this.journal.save();
      requests.delete(decision.approvalId);
      if (!requests.size) {
        this.emit(run, 'state', { state: 'running', threadId: run.threadId, attemptId: run.attemptId, ...(run.turnId ? { turnId: run.turnId } : {}), message: 'All current Codex approval requests were answered.' });
        this.report('running', 'Codex resumed after your decision.');
      }
    } catch (error) { this.emit(run, 'progress', { message: error.message }); }
  }
  async cancel() {
    const active = this.active;
    if (!active || terminal(active.run)) return;
    if (active.cancelling) return active.cancelling;
    active.run.cancelRequested = true; this.journal.save();
    this.startAckWake?.();
    active.cancelling = (async () => {
      if (active.run.threadId && active.run.turnId && active.app) {
        await active.app.request('turn/interrupt', { threadId: active.run.threadId, turnId: active.run.turnId }, 5000).catch(() => {});
      }
      if (active.run.turnStartSent && active.done) await deadline(active.done, 8000);
      await active.app?.close();
      // execute() alone emits the terminal state, after both turn and process evidence.
      if (active.promise) await active.promise;
    })();
    return active.cancelling;
  }
  async execute(run) {
    const job = run.job;
    this.report('starting', 'Preparing the registered local project and Codex runtime.');
    if (job.harnessId !== 'codex' || !['plan', 'execute'].includes(job.kind)) throw new Error('Unsupported execution binding.');
    run.cwd = workspaceFor(this.config, job); this.journal.save();
    const app = this.appFactory(run.cwd); this.active.app = app;
    run.appServer = { pid: app.child?.pid || null, startedAt: new Date().toISOString(), instanceId: randomUUID() }; this.journal.save();
    const active = this.active;
    let disconnectReject;
    const disconnected = new Promise((_, reject) => { disconnectReject = reject; });
    // Prevent startup errors from becoming an unhandled rejection before Promise.race.
    disconnected.catch(() => {});
    app.on('disconnect', error => disconnectReject(error));
    const messages = new Map(); let complete;
    const done = new Promise(resolve => { complete = resolve; });
    active.done = done;
    app.on('notification', notification => {
      const params = notification.params || {};
      if (params.threadId && params.threadId !== run.threadId) return;
      if (notification.method === 'item/agentMessage/delta') messages.set(params.itemId, (messages.get(params.itemId) || '') + params.delta);
      if (notification.method === 'item/completed' && params.item?.type === 'agentMessage') messages.set(params.item.id, params.item.text || '');
      if (run.startAcknowledged && notification.method === 'item/started' && params.item?.type !== 'agentMessage') {
        this.emit(run, 'progress', { message: `Codex: ${params.item?.type || 'working'}` });
      }
      if (notification.method === 'turn/started' && params.turn?.id && !run.turnId) {
        run.turnId = params.turn.id; this.journal.save();
        if (run.cancelRequested) app.request('turn/interrupt', { threadId: run.threadId, turnId: run.turnId }, 5000).catch(() => {});
      }
      if (notification.method === 'turn/completed' && (!run.turnId || params.turn?.id === run.turnId)) {
        run.turnCompleted = { id: params.turn.id, status: params.turn.status }; this.journal.save(); complete(params.turn);
      }
    });
    app.on('request', request => {
      if (!run.startAcknowledged || !APPROVAL_METHODS.has(request.method) || (request.params?.threadId && request.params.threadId !== run.threadId)) { app.rejectRequest(request.id); return; }
      const approvalId = `approval-${createHash('sha256').update(`${run.job.runId}:${typeof request.id}:${JSON.stringify(request.id)}`).digest('hex').slice(0, 32)}`;
      active.requests.set(approvalId, request);
      run.pending[approvalId] = { requestId: request.id, method: request.method, resolved: false }; this.journal.save();
      const command = request.params?.command;
      this.emit(run, 'approval', { approvalId, kind: /requestUserInput|elicitation/.test(request.method) ? 'input' : 'approval', message: request.params?.reason || request.params?.message || (Array.isArray(command) ? command.join(' ') : command) || 'Codex needs your decision.', details: { method: request.method, ...request.params } });
      this.report('approval', 'Waiting for your decision in Workbench.');
    });
    let outcome; let executionError; let cleanup;
    try {
      await app.initialize();
      const inventory = await discover(app, [{ path: run.cwd }]);
      if (inventory.status !== 'ready') throw new Error('Sign in to Codex CLI on this Mac first.');
      const selectedSkills = names(job.skills).map(name => {
        const skill = inventory.skills.find(item => item.name === name && item.enabled);
        if (!skill) throw new Error(`Selected skill is unavailable: ${name}`); return skill;
      });
      const selectedMcp = names(job.mcp);
      for (const name of selectedMcp) if (!inventory.mcp.some(server => server.name === name && mcpReady(server))) throw new Error(`Selected MCP is unavailable: ${name}`);
      const localConfig = await app.request('config/read', { includeLayers: false, cwd: run.cwd });
      const scopedTools = executionToolConfig(localConfig.config, inventory.mcp, selectedMcp);
      const config = scopedTools.config;
      const policy = job.kind === 'plan' ? 'read-only' : 'workspace-write';
      const instructions = [
        'Follow the selected role definition and local AGENTS.md. Execute only this assigned task. Never publish, push, merge, send messages, expose credentials, or change files outside the assigned workspace without explicit user approval. Request user approvals through the harness. Do not commit unless the task explicitly asks.',
        `Selected role: ${job.role?.name || job.role?.id || 'Agent'}\n${job.role?.instructions || ''}`,
        `Selected skills: ${selectedSkills.map(skill => skill.name).join(', ') || '(none)'}. Selected MCP servers: ${selectedMcp.join(', ') || '(none)'}. Use only the selected MCP servers.`,
        job.kind === 'plan' ? 'You are planning only. Read local context if needed. Do not implement tasks or call external services that write. Return only the required plan JSON using available Agent IDs, with explicit acceptance criteria and an acyclic dependency graph.' : '',
      ].filter(Boolean).join('\n\n');
      const thread = await app.request('thread/start', { cwd: run.cwd, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: policy, developerInstructions: instructions, config, ...(this.config.model ? { model: this.config.model } : {}) });
      run.threadId = thread.thread.id; run.clientUserMessageId = randomUUID(); run.phase = 'starting'; this.journal.save();
      for (const name of selectedMcp) {
        const end = Date.now() + 15000;
        for (;;) {
          const page = await app.request('mcpServerStatus/list', { threadId: run.threadId, serverName: name, limit: 100, detail: 'full' });
          const server = page.data.find(item => item.name === name);
          if (server && mcpReady(server)) break;
          if (!server || !['starting', 'notStarted'].includes(server.runtimeStatus) || Date.now() >= end) throw new Error(`Selected MCP did not connect on the task thread: ${name}`);
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      this.emit(run, 'state', { state: 'running', threadId: run.threadId, attemptId: run.attemptId, message: 'Codex thread started in the registered local project.' });
      while (run.ackSeq < 1 && !run.cancelRequested && !this.stopping) {
        try { await this.flush(); }
        catch (error) {
          if ([401, 403, 409, 400].includes(error.status) || app.closed) throw error;
          this.report('offline', 'Waiting for Workbench to acknowledge the Codex thread. No model turn has started.');
          await deadline(new Promise(resolve => { this.startAckWake = resolve; }), 2000);
        }
        if (run.deliveryBlocked) throw new Error('Workbench rejected the start binding. No model turn was started.');
      }
      if (run.ackSeq >= 1) { run.startAcknowledged = true; this.journal.save(); }
      if (run.cancelRequested || this.stopping) { run.cancelRequested = true; throw new Error('Cancelled before model turn started.'); }
      run.turnStartSent = true; this.journal.save();
      const turn = await app.request('turn/start', {
        threadId: run.threadId, cwd: run.cwd, approvalPolicy: 'on-request', approvalsReviewer: 'user', clientUserMessageId: run.clientUserMessageId,
        sandboxPolicy: job.kind === 'plan' ? { type: 'readOnly', networkAccess: false } : { type: 'workspaceWrite', writableRoots: [run.cwd], networkAccess: false, excludeSlashTmp: true, excludeTmpdirEnvVar: true },
        disabledPluginIds: scopedTools.disabledPluginIds,
        input: [{ type: 'text', text: `${job.title}\n\n${job.instructions}${job.planningContext ? `\n\nPlanning context:\n${JSON.stringify(job.planningContext)}` : ''}` }, ...selectedSkills.map(skill => ({ type: 'skill', name: skill.name, path: skill.path }))],
        ...(job.kind === 'plan' && job.planningContext?.planSchema ? { outputSchema: job.planningContext.planSchema } : {}),
      });
      run.turnId = turn.turn.id; if (!terminal(run)) run.phase = 'running'; this.journal.save();
      this.emit(run, 'state', { state: 'running', threadId: run.threadId, attemptId: run.attemptId, turnId: run.turnId, message: 'Codex model turn started.' });
      this.report('running', 'Codex is executing the assigned task.');
      const completed = await Promise.race([done, disconnected]);
      if (run.cancelRequested) { executionError = new Error('Cancellation requested.'); }
      if (completed.status !== 'completed') throw new Error(completed.error?.message || `Codex turn ${completed.status}.`);
      const finalItems = (completed.items || []).filter(item => item.type === 'agentMessage').map(item => item.text);
      const summary = (finalItems.length ? finalItems : [...messages.values()]).filter(Boolean).at(-1) || 'Codex completed the task.';
      let plan;
      if (job.kind === 'plan') {
        try { plan = JSON.parse(summary); } catch { throw new Error('Product manager did not return valid plan JSON.'); }
        validatePlan(plan, job.planningContext?.agents || []);
      }
      outcome = normalizeEventData('result', { summary: (plan ? plan.goal : summary).slice(0, 12000), artifacts: [], ...(plan ? { plan } : {}) });
    } catch (error) { executionError = error; }
    finally {
      cleanup = await app.close(); run.cleanup = cleanup || { terminated: false }; this.journal.save();
    }
    if (!cleanup?.terminated) { this.markUnknown(run, 'Codex process-group termination was not confirmed. New execution is blocked.'); return; }
    if (run.deliveryBlocked) { this.markUnknown(run, 'Delivery of the execution identity or event was rejected. Model execution is blocked pending review.'); return; }
    if (run.cancelRequested) {
      if (run.turnStartSent && !['completed', 'failed', 'interrupted'].includes(run.turnCompleted?.status)) { this.markUnknown(run, 'Cancellation did not receive a confirmed terminal turn and process exit. New execution is blocked.'); return; }
      run.phase = 'cancelled'; run.pending = {};
      if (run.nextSeq === 1) this.emit(run, 'error', { code: 'SETUP_FAILED', message: 'Cancelled during setup. No model turn was sent, and process cleanup was confirmed.' });
      else this.emit(run, 'state', { state: 'cancelled', attemptId: run.attemptId, ...(run.threadId ? { threadId: run.threadId } : {}), ...(run.turnId ? { turnId: run.turnId } : {}), message: 'Codex turn termination and process cleanup were confirmed.' }); return;
    }
    if (executionError) {
      if (run.turnStartSent && !run.turnCompleted) { this.markUnknown(run, 'Codex disconnected without a completed turn acknowledgement. New execution is blocked.'); return; }
      run.phase = 'failed'; run.pending = {}; this.emit(run, 'error', { message: executionError.message, code: run.nextSeq === 1 && !run.turnStartSent ? 'SETUP_FAILED' : executionError.code || 'HARNESS_ERROR' }); return;
    }
    outcome.artifacts = await collectArtifacts(run.cwd);
    run.phase = 'completed'; run.pending = {}; this.emit(run, 'result', outcome);
  }
  async run({ once = false } = {}) {
    const unlock = this.journal.lock();
    const stop = () => { this.stopping = true; clearTimeout(this.timer); this.wake?.(); this.cancel().catch(() => {}); };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
    try {
      this.recover();
      try { await this.refreshCapabilities(); } catch { this.report('unavailable', 'Codex CLI is unavailable. Check its local installation and sign-in.'); }
      let failures = 0;
      do {
        if (!this.active && (!this.capabilityCheckedAt || Date.now() - Date.parse(this.capabilityCheckedAt) > 60000)) {
          try { await this.refreshCapabilities(); } catch { this.capabilityCheckedAt = new Date().toISOString(); }
        }
        try {
          await this.tick(); failures = 0;
          if (!this.active) {
            const needsReview = Object.values(this.journal.data.runs).some(run => run.phase === 'unknown' || run.deliveryBlocked);
            this.report(needsReview ? 'attention' : this.capabilities?.status || 'unavailable', needsReview ? 'New execution is blocked pending process or event review.' : this.capabilities?.status === 'ready' ? 'Connected to Workbench.' : 'Sign in to Codex CLI on this Mac.');
          }
        }
        catch (error) {
          failures++; this.reportConnection(error.status === 401 ? 'Device access was revoked. Pair this Mac again.' : 'Connection interrupted. Events remain safely on this Mac.');
          if (error.status === 401 || error.status === 403) { this.stopping = true; await this.cancel(); }
        }
        if (once) { if (this.active) await this.active.promise; await this.flush(); break; }
        if (!this.stopping) await new Promise(resolve => { this.wake = resolve; this.timer = setTimeout(resolve, Math.min(30000, 2500 * 2 ** Math.min(failures, 4))); });
      } while (!this.stopping);
      if (this.active) await this.active.promise;
      await this.flush().catch(() => {});
    } finally { clearTimeout(this.timer); process.off('SIGTERM', stop); process.off('SIGINT', stop); unlock(); }
  }
}

export function validatePlan(plan, agents) {
  if (!plan || typeof plan.goal !== 'string' || !plan.goal.trim() || !Array.isArray(plan.tasks) || plan.tasks.length < 1 || plan.tasks.length > 12) throw new Error('Invalid product manager plan.');
  const ids = new Set(); const agentIds = new Set(agents.map(agent => agent.id));
  for (const task of plan.tasks) {
    if (!task || typeof task.id !== 'string' || !task.id || ids.has(task.id) || !agentIds.has(task.agentId) || typeof task.title !== 'string' || !task.title.trim() || typeof task.description !== 'string' || !task.description.trim() || !Array.isArray(task.dependsOn) || !Array.isArray(task.acceptanceCriteria) || !task.acceptanceCriteria.length || task.acceptanceCriteria.some(item => typeof item !== 'string' || !item.trim())) throw new Error('Invalid product manager task.');
    ids.add(task.id);
  }
  const visited = new Set(); const visiting = new Set();
  const visit = task => {
    if (visiting.has(task.id)) throw new Error('Product manager plan has a dependency cycle.');
    if (visited.has(task.id)) return; visiting.add(task.id);
    for (const id of task.dependsOn) { const dependency = plan.tasks.find(item => item.id === id); if (!dependency) throw new Error('Product manager plan has an unknown dependency.'); visit(dependency); }
    for (const input of task.inputs || []) if (!task.dependsOn.includes(input.taskId) || typeof input.description !== 'string') throw new Error('Invalid product manager task handoff.');
    visiting.delete(task.id); visited.add(task.id);
  };
  plan.tasks.forEach(visit); return plan;
}

export function parseArguments(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (['--pair', '--once', '--unpair'].includes(name)) args[name.slice(2)] = true;
    else if (['--config', '--server', '--code', '--name', '--keychain-helper'].includes(name) && argv[i + 1]) args[name.slice(2)] = argv[++i];
    else throw new Error('Unknown or incomplete bridge argument.');
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv); const file = path.resolve(args.config || defaultConfigFile());
  const credentials = new CredentialStore({ helper: args['keychain-helper'] });
  if (args.pair) {
    if (!args.server || !args.code) throw new Error('Pairing requires --server and --code.');
    let config = { serverUrl: args.server, projects: [] };
    if (fs.existsSync(file)) config = { ...JSON.parse(fs.readFileSync(file, 'utf8')), serverUrl: args.server };
    // Validate URL and local projects before transmitting a single-use pairing secret.
    const temporary = `${file}.${randomUUID()}.validate`;
    let validated;
    try { atomicJSON(temporary, config); validated = readConfig(temporary); } finally { fs.rmSync(temporary, { force: true }); }
    const api = new API(validated);
    const pair = await api.post('pair', { code: args.code, name: args.name || os.hostname(), platform: process.platform, version: VERSION }, false);
    if (typeof pair.deviceId !== 'string' || typeof pair.deviceToken !== 'string') throw new Error('Invalid pairing response.');
    config.deviceId = pair.deviceId; config.serverUrl = validated.serverUrl;
    credentials.store(credentialAccount(config), pair.deviceToken); atomicJSON(file, config);
    status('paired', 'Mac paired with Workbench.'); return;
  }
  const config = readConfig(file);
  if (!config.deviceId) throw new Error('Pair this Mac with Workbench first.');
  if (args.unpair) { credentials.delete(credentialAccount(config)); delete config.deviceId; atomicJSON(file, config); status('unpaired', 'Local device credential removed.'); return; }
  const token = credentials.read(credentialAccount(config));
  if (!token) throw new Error('Device credential was not found in Keychain. Pair this Mac again.');
  const bridge = new Bridge(config, { api: new API(config, token) });
  await bridge.run({ once: args.once });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { status('error', error.message); process.exitCode = 1; });
