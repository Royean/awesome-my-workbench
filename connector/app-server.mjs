import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { VERSION } from './storage.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Newline-delimited JSON-RPC over the official Codex app-server stdio protocol.
export class AppServer extends EventEmitter {
  constructor({ codexPath = 'codex', cwd, spawnProcess = spawn } = {}) {
    super(); this.nextId = 1; this.pending = new Map(); this.closed = false; this.exitObserved = false; this.spawnFailed = false;
    this.exitPromise = new Promise(resolve => { this.resolveExit = resolve; });
    this.ownsProcessGroup = process.platform !== 'win32';
    this.child = spawnProcess(codexPath, ['app-server', '--stdio'], { cwd, detached: this.ownsProcessGroup, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => this.receive(line));
    // Codex stderr may include private paths/configuration. It stays local and is not forwarded.
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', () => this.fail(new Error('Codex app-server input disconnected.')));
    this.child.on('error', () => { this.spawnFailed = !this.child.pid; if (this.spawnFailed) this.resolveExit(); this.fail(new Error('Codex app-server could not start.')); });
    this.child.on('exit', () => { this.exitObserved = true; this.resolveExit(); this.fail(new Error('Codex app-server disconnected.')); });
  }
  send(message) {
    if (this.closed || !this.child.stdin.writable) throw new Error('Codex app-server is disconnected.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  async initialize() {
    const result = await this.request('initialize', { clientInfo: { name: 'workbench_agent_bridge', title: 'Workbench Agent Bridge', version: VERSION }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized' }); return result;
  }
  request(method, params, timeoutMs = 60000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out.`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      try { this.send({ id, method, params }); } catch (error) { clearTimeout(timeout); this.pending.delete(id); reject(error); }
    });
  }
  respond(id, result) { this.send({ id, result }); }
  rejectRequest(id, message = 'This request is not supported by the bridge.') { this.send({ id, error: { code: -32601, message } }); }
  receive(line) {
    let message;
    try { message = JSON.parse(line); } catch { this.fail(new Error('Invalid Codex app-server message.')); return; }
    if (message.method) {
      this.emit(message.id === undefined ? 'notification' : 'request', message); return;
    }
    const request = this.pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout); this.pending.delete(message.id);
    if (message.error) { const error = new Error(message.error.message || 'Codex request failed.'); error.rpcCode = message.error.code; request.reject(error); }
    else request.resolve(message.result);
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(error); }
    this.pending.clear(); this.emit('disconnect', error);
  }
  close({ graceMs = 2500, killMs = 2500 } = {}) {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.shutdown({ graceMs, killMs }); return this.shutdownPromise;
  }
  groupEmpty() {
    if (this.spawnFailed && !this.child.pid) return true;
    if (!this.child.pid || !this.ownsProcessGroup) return false;
    try { process.kill(-this.child.pid, 0); return false; }
    catch (error) { return error.code === 'ESRCH'; }
  }
  signal(signal) {
    try {
      if (this.ownsProcessGroup && this.child.pid) process.kill(-this.child.pid, signal);
      else this.child.kill(signal);
    } catch {}
  }
  async shutdown({ graceMs, killMs }) {
    try { this.child.stdin.end(); } catch {} this.signal('SIGTERM');
    const wait = async ms => {
      const deadline = Date.now() + ms;
      do {
        if ((this.exitObserved || this.spawnFailed) && this.groupEmpty()) return true;
        await pause(25);
      } while (Date.now() < deadline);
      return false;
    };
    let terminated = await wait(graceMs);
    if (!terminated) { this.signal('SIGKILL'); terminated = await wait(killMs); }
    this.fail(new Error('Codex app-server closed.'));
    return { terminated, exitObserved: this.exitObserved, groupEmpty: this.groupEmpty(), spawnFailed: this.spawnFailed };
  }
}

export function mcpReady(server) {
  return server.runtimeStatus === 'connected' && !server.toolsError && ['oAuth', 'bearerToken', 'unsupported'].includes(server.authStatus);
}

export function stripNulls(value) {
  if (Array.isArray(value)) return value.filter(item => item !== null && item !== undefined).map(stripNulls);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined).map(([key, item]) => [key, stripNulls(item)]));
  return value;
}

const MCP_CONFIG_FIELDS = new Set(['command', 'args', 'env', 'env_vars', 'cwd', 'url', 'auth', 'oauth', 'bearer_token_env_var', 'http_headers', 'http_headers_helper', 'env_http_headers', 'enabled', 'required', 'startup_readiness', 'startup_timeout_sec', 'startup_timeout_ms', 'tool_timeout_sec', 'enabled_tools', 'disabled_tools', 'supports_parallel_tool_calls', 'tool_input_schema_max_bytes', 'omit_tools_from', 'default_tools_approval_mode', 'tools', 'scopes', 'oauth_resource', 'environment_id', 'identity']);
const APP_CONFIG_FIELDS = new Set(['enabled', 'destructive_enabled', 'open_world_enabled', 'default_tools_enabled', 'approvals_reviewer', 'default_tools_approval_mode', 'omit_tools_from', 'tools', 'links']);
const supported = (value, keys) => Object.fromEntries(Object.entries(value || {}).filter(([key]) => keys.has(key)));

export function executionToolConfig(effective, inventory, selectedNames) {
  const selected = new Set(selectedNames); const disk = effective.mcp_servers || {};
  const configured = {};
  for (const [name, server] of Object.entries(disk)) {
    if (!server || typeof server !== 'object' || (!server.command && !server.url)) throw new Error(`Cannot safely configure MCP transport: ${name}`);
    configured[name] = stripNulls({ ...supported(server, MCP_CONFIG_FIELDS), enabled: selected.has(name) });
  }
  const plugins = new Map();
  for (const server of inventory) {
    if (server.pluginId) { const list = plugins.get(server.pluginId) || []; list.push(server.name); plugins.set(server.pluginId, list); }
    else if (!Object.hasOwn(disk, server.name) && server.name !== 'codex_apps') throw new Error(`Cannot safely scope runtime-only MCP: ${server.name}`);
  }
  const disabledPluginIds = [];
  for (const [id, servers] of plugins) {
    if (!servers.some(name => selected.has(name))) disabledPluginIds.push(id);
    else if (!servers.every(name => selected.has(name))) throw new Error('MCPs from the same plugin must be selected together so tool access stays explicit.');
  }
  const enableApps = selected.has('codex_apps');
  const apps = { ...(effective.apps || {}), _default: { ...supported(effective.apps?._default, APP_CONFIG_FIELDS), enabled: enableApps } };
  for (const [id, app] of Object.entries(apps)) if (id !== '_default' && app && typeof app === 'object') apps[id] = { ...supported(app, APP_CONFIG_FIELDS), enabled: enableApps && app.enabled !== false };
  // Preserve transport definitions from local config. Runtime/plugin-derived names
  // are never fabricated into mcp_servers tables with no transport.
  return { config: stripNulls({ mcp_servers: configured, apps }), disabledPluginIds };
}

export async function discover(app, projects) {
  const account = await app.request('account/read', { refreshToken: false });
  const skills = await app.request('skills/list', { cwds: projects.map(project => project.path), forceReload: true });
  const listMcp = async threadId => {
    let cursor = null; const servers = [];
    do {
      const page = await app.request('mcpServerStatus/list', { cursor, limit: 100, detail: 'full', ...(threadId ? { threadId } : {}) });
      servers.push(...page.data); cursor = page.nextCursor;
    } while (cursor);
    return servers;
  };
  let mcp = await listMcp();
  if (mcp.length && projects[0]?.path) {
    // No turn is started: this ephemeral read-only thread only connects configured
    // MCPs so availability is verified from a real runtime rather than guessed.
    const probe = await app.request('thread/start', { cwd: projects[0].path, ephemeral: true, sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user' });
    const end = Date.now() + 15000;
    do {
      mcp = await listMcp(probe.thread.id);
      if (!mcp.some(server => ['starting', 'notStarted'].includes(server.runtimeStatus))) break;
      await pause(250);
    } while (Date.now() < end);
  }
  const byName = new Map();
  for (const entry of skills.data || []) for (const skill of entry.skills || []) if (!byName.has(skill.name)) byName.set(skill.name, skill);
  return {
    status: account.account ? 'ready' : 'auth_required', skills: [...byName.values()], skillEntries: skills.data || [], mcp,
  };
}

export function approvalResult(request, decision) {
  const approve = decision.decision === 'approve';
  const method = request.method; const params = request.params || {};
  if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method)) return { decision: approve ? 'accept' : 'decline' };
  if (method === 'item/permissions/requestApproval') return { permissions: approve ? params.permissions : {}, scope: 'turn' };
  if (method === 'execCommandApproval' || method === 'applyPatchApproval') return { decision: approve ? 'approved' : 'denied' };
  if (method === 'mcpServer/elicitation/request') {
    if (!approve) return { action: 'decline', content: null };
    let content = null;
    if (decision.response) { try { content = JSON.parse(decision.response); } catch { throw new Error('MCP form response must contain valid JSON.'); } }
    return { action: 'accept', content };
  }
  if (method === 'item/tool/requestUserInput') {
    const questions = params.questions || [];
    if (!approve) return { answers: {} };
    if (questions.length === 1) return { answers: { [questions[0].id]: { answers: [String(decision.response || '')] } } };
    let answers;
    try { answers = JSON.parse(decision.response); } catch { throw new Error('Multiple questions require a JSON object keyed by question ID.'); }
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('Invalid answers.');
    return { answers: Object.fromEntries(questions.map(question => [question.id, { answers: Array.isArray(answers[question.id]) ? answers[question.id].map(String) : [String(answers[question.id] || '')] }])) };
  }
  throw new Error('Unsupported Codex approval request.');
}

export const APPROVAL_METHODS = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput', 'mcpServer/elicitation/request', 'execCommandApproval', 'applyPatchApproval']);
