import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { fail } from './accounts.mjs';
import { hubRoleCatalog } from './hub-roles.mjs';

const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
const active = new Set(['starting', 'running', 'waiting_approval', 'unknown']);
const hash = value => createHash('sha256').update(value).digest('hex');
const encode = value => JSON.stringify(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const contentHash = value => hash(encode(canonical(value)));
const decode = value => JSON.parse(value);
const iso = value => value == null ? null : new Date(value).toISOString();
const safeId = /^[a-zA-Z0-9_-]{1,100}$/;
const ONLINE_MS = 90_000;
const PLAN_LIMIT = 12;

function text(value, max = 500, required = false) {
  if ((value == null || value === '') && !required) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (required && !value.trim())) throw fail(400, '输入内容格式无效');
  return value.trim();
}
function id(value) {
  const result = text(value, 100, true);
  if (!safeId.test(result)) throw fail(400, '标识格式无效');
  return result;
}
function strings(value, max = 30, length = 1000) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw fail(400, '列表格式无效');
  return value.map(item => text(item, length, true));
}
function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, '请求格式无效');
  return value;
}
function cleanMessage(value, instruction = '') {
  let result = text(value, 12_000);
  if (instruction.length >= 30 && result.includes(instruction)) result = result.replaceAll(instruction, '[private role instructions]');
  return result.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{15,}|github_pat_[A-Za-z0-9_]{15,}|awdev_[A-Za-z0-9_-]+)\b/g, '[credential redacted]')
    .replace(/(authorization\s*[:=]\s*bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/\/(?:Users|home)\/[^\s"'<>]+/g, '[local path]');
}

export function createAgentExecution({ db, roleCatalog = hubRoleCatalog, rolesForOwner = () => roleCatalog, now = Date.now }) {
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const timestamp = () => Number(now());
  const catalog = owner => rolesForOwner(owner) || hubRoleCatalog;
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function ownerId(owner) { return text(owner, 200, true); }
  function taskRow(owner, taskId) {
    const row = get('SELECT * FROM agent_execution_tasks WHERE owner=? AND id=?', ownerId(owner), id(taskId));
    if (!row) throw fail(404, '任务不存在');
    return row;
  }
  function runRow(owner, runId) {
    const row = get('SELECT * FROM agent_execution_runs WHERE owner=? AND id=?', ownerId(owner), id(runId));
    if (!row) throw fail(404, '执行记录不存在');
    return row;
  }
  function saveTask(row, body, state = row.state) {
    run('UPDATE agent_execution_tasks SET state=?,body=?,updated_at=? WHERE owner=? AND id=?', state, encode(body), timestamp(), row.owner, row.id);
  }
  function saveRun(row, body, state = row.state) {
    run('UPDATE agent_execution_runs SET state=?,body=?,updated_at=? WHERE owner=? AND id=?', state, encode(body), timestamp(), row.owner, row.id);
  }
  function presentTask(row) {
    const body = decode(row.body);
    return { ...body, id: row.id, status: row.state, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
  }
  function presentRun(row) {
    const { role, claimPayload, ...body } = decode(row.body);
    const device = get('SELECT last_seen_at,revoked_at FROM agent_execution_devices WHERE owner=? AND id=?', row.owner, row.device_id);
    return { ...body, id: row.id, runId: row.id, taskId: row.task_id, deviceId: row.device_id, status: row.state, ackSeq: row.ack_seq,
      role: { id: role.id, name: role.name, sourceRevision: role.sourceRevision },
      connectionStatus: row.state === 'unknown' || active.has(row.state) && (!device?.last_seen_at || device.revoked_at || timestamp() - device.last_seen_at > ONLINE_MS) ? 'unknown' : 'synced',
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
  }
  function deviceRow(device) {
    const row = device && get('SELECT * FROM agent_execution_devices WHERE owner=? AND id=? AND revoked_at IS NULL', device.owner, device.deviceId);
    if (!row) throw fail(401, '设备授权已失效，请重新配对');
    return row;
  }
  function agentRows(owner) {
    return all("SELECT body FROM developer_hub_entries WHERE owner=? AND kind='agent' ORDER BY rowid", owner).map(row => decode(row.body));
  }
  function ensureAgents(owner) {
    ownerId(owner);
    const existing = agentRows(owner);
    for (const role of catalog(owner).roles) {
      if (existing.some(agent => agent.roleId === role.id)) continue;
      const agentId = randomUUID();
      const agent = { id: agentId, roleId: role.id, name: role.name, environment: 'Codex', skills: [], mcp: [], deviceId: '', harnessId: 'codex', projectId: '', updatedAt: iso(timestamp()), managed: true };
      run("INSERT OR IGNORE INTO developer_hub_entries(owner,kind,id,entry_key,body) VALUES(?,'agent',?,?,?)", owner, agentId, agentId, encode(agent));
      existing.push(agent);
    }
    return { agents: existing };
  }
  function resolveAgent(owner, agentId) {
    const agent = agentRows(owner).find(agent => agent.id === agentId);
    if (!agent) throw fail(400, '委派的 Agent 不存在');
    const role = catalog(owner).roles.find(role => role.id === agent.roleId);
    if (!role) throw fail(400, 'Agent 角色已不可访问');
    const shared = text(catalog(owner).sharedInstructions, 80_000);
    const instructions = text(role.instructions, 40_000);
    if (!instructions) throw fail(409, '角色执行正文尚未配置，请先导入私有角色定义');
    return { agent, role: { id: role.id, name: role.name, instructions: [shared, instructions].filter(Boolean).join('\n\n'), sourceRevision: role.sourceRevision || catalog(owner).source?.revision || '' } };
  }
  function normalizeCapabilities(entries) {
    if (!Array.isArray(entries) || entries.length > 100) throw fail(400, '设备能力列表格式无效');
    const names = new Set();
    return entries.map(entry => {
      requireObject(entry);
      const name = text(entry.name, 100, true);
      if (names.has(name.toLowerCase()) || !['available', 'unavailable', 'unverified'].includes(entry.status)) throw fail(400, '设备能力状态无效');
      names.add(name.toLowerCase());
      return { name, status: entry.status, checkedAt: iso(timestamp()) };
    });
  }
  function normalizeHeartbeat(input) {
    requireObject(input);
    if (!Array.isArray(input.harnesses) || input.harnesses.length > 10 || !Array.isArray(input.projects) || input.projects.length > 50) throw fail(400, '设备环境格式无效');
    const harnessIds = new Set(), projectIds = new Set();
    const harnesses = input.harnesses.map(harness => {
      const harnessId = id(harness.id);
      if (harnessIds.has(harnessId) || !['ready', 'auth_required', 'unavailable'].includes(harness.status)) throw fail(400, '运行环境状态无效');
      harnessIds.add(harnessId);
      return { id: harnessId, name: text(harness.name, 80) || harnessId, version: text(harness.version, 100), status: harness.status, skills: normalizeCapabilities(harness.skills || []), mcp: normalizeCapabilities(harness.mcp || []) };
    });
    const projects = input.projects.map(project => {
      const projectId = id(project.id);
      if (projectIds.has(projectId)) throw fail(400, '重复的项目标识');
      projectIds.add(projectId);
      const name = text(project.name, 100, true);
      if (/[/\\]/.test(name)) throw fail(400, '项目仅提交名称，不提交本机路径');
      return { id: projectId, name };
    });
    return { harnesses, projects, activeRuns: strings(input.activeRuns, 20, 100).map(id) };
  }
  function checkTarget(owner, input, agent) {
    const deviceId = id(input.deviceId || agent.deviceId);
    const projectId = id(input.projectId || agent.projectId);
    const harnessId = id(input.harnessId || agent.harnessId || 'codex');
    if (harnessId !== 'codex') throw fail(400, '当前仅支持 Codex 运行环境');
    const device = get('SELECT * FROM agent_execution_devices WHERE owner=? AND id=? AND revoked_at IS NULL', owner, deviceId);
    if (!device) throw fail(400, '设备不存在或已撤销');
    const config = decode(device.capabilities);
    const harness = config.harnesses?.find(item => item.id === harnessId);
    if (!device.last_seen_at || timestamp() - device.last_seen_at > ONLINE_MS) throw fail(409, '设备离线，请启动本机连接器');
    if (harness?.status !== 'ready') throw fail(409, 'Codex 尚未就绪，请在本机完成安装和登录');
    if (!config.projects?.some(project => project.id === projectId)) throw fail(409, '项目尚未在目标设备登记');
    for (const kind of ['skills', 'mcp']) {
      for (const capability of agent[kind] || []) {
        if (!harness[kind]?.some(item => item.name.toLowerCase() === capability.name.toLowerCase() && item.status === 'available')) throw fail(409, `目标设备缺少已核验的 ${kind === 'mcp' ? 'MCP' : 'Skill'}：${capability.name}`);
      }
    }
    return { deviceId, projectId, harnessId };
  }
  function createRun(owner, taskId, task, kind, retryOf = null, requestId = '') {
    const { agent, role } = resolveAgent(owner, task.agentId);
    const runId = randomUUID(), at = timestamp();
    const body = { kind, agentId: agent.id, agentName: agent.name, role, skills: agent.skills || [], mcp: agent.mcp || [], harnessId: task.harnessId, projectId: task.projectId,
      workspaceKey: task.parentTaskId || taskId, parentTaskId: task.parentTaskId || null, retryOf, requestId, startedAt: null, endedAt: null, cancelRequested: false, result: null };
    run('INSERT INTO agent_execution_runs(id,owner,task_id,device_id,state,created_at,updated_at,body) VALUES(?,?,?,?,?,?,?,?)', runId, owner, taskId, task.deviceId, 'queued', at, at, encode(body));
    return runRow(owner, runId);
  }
  function newTask(owner, body, requestId, requestHash, state) {
    const taskId = randomUUID(), at = timestamp();
    run('INSERT INTO agent_execution_tasks(id,owner,request_id,request_hash,parent_id,state,created_at,updated_at,body) VALUES(?,?,?,?,?,?,?,?,?)', taskId, owner, requestId, requestHash, body.parentTaskId || null, state, at, at, encode(body));
    return taskRow(owner, taskId);
  }
  function createPairingCode(owner) {
    ownerId(owner);
    return transaction(() => {
      const at = timestamp();
      run('DELETE FROM agent_execution_pairings WHERE owner=? OR expires_at<?', owner, at);
      if (get('SELECT count(*) total FROM agent_execution_devices WHERE owner=? AND revoked_at IS NULL', owner).total >= 20) throw fail(409, '最多连接 20 台设备');
      const raw = randomBytes(16).toString('hex').toUpperCase();
      const code = raw.match(/.{1,8}/g).join('-');
      const expiresAt = at + 600_000;
      run('INSERT INTO agent_execution_pairings(code_hash,owner,expires_at,created_at) VALUES(?,?,?,?)', hash(raw), owner, expiresAt, at);
      return { code, expiresAt: iso(expiresAt) };
    });
  }
  function pair(input) {
    requireObject(input);
    const code = text(input.code, 100, true).replaceAll('-', '').toUpperCase();
    const name = text(input.name, 80, true), version = text(input.version, 100);
    if (input.platform !== 'darwin') throw fail(400, '当前连接器仅支持 Mac');
    if (!/^[A-F0-9]{32}$/.test(code)) throw fail(401, '配对码无效或已过期');
    return transaction(() => {
      const at = timestamp(), pairing = get('SELECT * FROM agent_execution_pairings WHERE code_hash=? AND used_at IS NULL AND expires_at>?', hash(code), at);
      if (!pairing) throw fail(401, '配对码无效或已过期');
      const deviceId = randomUUID(), deviceToken = 'awdev_' + randomBytes(32).toString('base64url');
      run('UPDATE agent_execution_pairings SET used_at=? WHERE code_hash=? AND used_at IS NULL', at, hash(code));
      run('INSERT INTO agent_execution_devices(id,owner,token_hash,name,platform,version,created_at) VALUES(?,?,?,?,?,?,?)', deviceId, pairing.owner, hash(deviceToken), name, 'darwin', version, at);
      return { deviceId, deviceToken };
    });
  }
  function authenticateDevice(token) {
    if (typeof token !== 'string' || !/^awdev_[A-Za-z0-9_-]{43}$/.test(token)) throw fail(401, '设备令牌无效');
    const row = get('SELECT id,owner FROM agent_execution_devices WHERE token_hash=? AND revoked_at IS NULL', hash(token));
    if (!row) throw fail(401, '设备令牌无效');
    return { deviceId: row.id, owner: row.owner };
  }
  function listDevices(owner) {
    return { devices: all('SELECT * FROM agent_execution_devices WHERE owner=? ORDER BY created_at DESC', ownerId(owner)).map(row => ({ id: row.id, name: row.name, platform: row.platform, version: row.version, createdAt: iso(row.created_at), lastSeenAt: iso(row.last_seen_at), revokedAt: iso(row.revoked_at), online: !row.revoked_at && !!row.last_seen_at && timestamp() - row.last_seen_at <= ONLINE_MS,
      harnesses: [], projects: [], activeRuns: [], ...decode(row.capabilities), activeRunIds: all("SELECT id FROM agent_execution_runs WHERE owner=? AND device_id=? AND state IN ('starting','running','waiting_approval','unknown')", owner, row.id).map(run => run.id) })) };
  }
  function revokeDevice(owner, deviceId) {
    const at = timestamp();
    if (!run('UPDATE agent_execution_devices SET revoked_at=? WHERE owner=? AND id=? AND revoked_at IS NULL', at, ownerId(owner), id(deviceId)).changes) throw fail(404, '设备不存在');
    // Revocation never changes an uncertain process into success/failure or enqueues a replacement.
    return { ok: true };
  }
  function heartbeat(device, input) {
    const row = deviceRow(device), config = normalizeHeartbeat(input), at = timestamp();
    for (const runId of config.activeRuns) {
      if (!get('SELECT id FROM agent_execution_runs WHERE owner=? AND device_id=? AND id=?', row.owner, row.id, runId)) throw fail(403, '设备不能上报其他执行');
    }
    run('UPDATE agent_execution_devices SET last_seen_at=?,capabilities=? WHERE owner=? AND id=?', at, encode(config), row.owner, row.id);
    const runs = all("SELECT * FROM agent_execution_runs WHERE owner=? AND device_id=? AND state IN ('starting','running','waiting_approval','unknown')", row.owner, row.id);
    const cancelRunIds = runs.filter(row => decode(row.body).cancelRequested).map(row => row.id);
    const approvalDecisions = all("SELECT a.*,r.body AS run_body FROM agent_execution_approvals a JOIN agent_execution_runs r ON r.owner=a.owner AND r.id=a.run_id WHERE a.owner=? AND r.device_id=? AND a.state IN ('approved','denied') AND r.state IN ('starting','running','waiting_approval')", row.owner, row.id).filter(row => !decode(row.run_body).cancelRequested).map(row => ({ runId: row.run_id, approvalId: row.id, ...decode(row.body).decision }));
    return { serverTime: iso(at), cancelRunIds, approvalDecisions, runs: runs.map(row => ({ runId: row.id, status: row.state, ackSeq: row.ack_seq })) };
  }
  function createTask(owner, input) {
    ownerId(owner); requireObject(input); ensureAgents(owner);
    const requestId = id(input.requestId), requestHash = contentHash(input);
    return transaction(() => {
      const existing = get('SELECT * FROM agent_execution_tasks WHERE owner=? AND request_id=?', owner, requestId);
      if (existing) {
        if (existing.request_hash !== requestHash) throw fail(409, '请求标识已用于其他任务');
        return { task: presentTask(existing), run: presentRun(get('SELECT * FROM agent_execution_runs WHERE owner=? AND task_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1', owner, existing.id)) };
      }
      if (get('SELECT count(*) total FROM agent_execution_tasks WHERE owner=? AND parent_id IS NULL', owner).total >= 1000) throw fail(409, '任务数量已达上限');
      const agentId = id(input.agentId), resolved = resolveAgent(owner, agentId);
      if (!['manual', 'automatic'].includes(input.mode)) throw fail(400, '委派方式无效');
      if (input.mode === 'automatic' && resolved.role.id !== 'product-manager') throw fail(400, '自动规划必须委派产品经理 Agent');
      const target = checkTarget(owner, input, resolved.agent);
      const body = { title: text(input.title, 200, true), description: text(input.description, 20_000, true), acceptanceCriteria: strings(input.acceptanceCriteria, 30, 1500), agentId, agentName: resolved.agent.name,
        mode: input.mode, ...target, parentTaskId: null, dependsOn: [], inputs: [], plan: null, latestRunId: null };
      const row = newTask(owner, body, requestId, requestHash, input.mode === 'automatic' ? 'awaiting_plan' : 'queued');
      const execution = createRun(owner, row.id, body, input.mode === 'automatic' ? 'plan' : 'execute');
      body.latestRunId = execution.id;
      saveTask(row, body);
      return { task: presentTask(taskRow(owner, row.id)), run: presentRun(execution) };
    });
  }
  function listTasks(owner) {
    ownerId(owner); ensureAgents(owner);
    return { tasks: all('SELECT * FROM agent_execution_tasks WHERE owner=? ORDER BY created_at DESC,rowid DESC LIMIT 500', owner).map(presentTask) };
  }
  function getTask(owner, taskId) {
    const row = taskRow(owner, taskId);
    return { task: presentTask(row), runs: all('SELECT * FROM agent_execution_runs WHERE owner=? AND task_id=? ORDER BY created_at,rowid', owner, row.id).map(presentRun),
      events: all('SELECT e.* FROM agent_execution_events e JOIN agent_execution_runs r ON e.owner=r.owner AND e.run_id=r.id WHERE e.owner=? AND r.task_id=? ORDER BY e.created_at,e.seq LIMIT 1000', owner, row.id).map(event => ({ runId: event.run_id, seq: event.seq, ...decode(event.body), at: iso(event.created_at) })),
      approvals: all('SELECT a.* FROM agent_execution_approvals a JOIN agent_execution_runs r ON a.owner=r.owner AND a.run_id=r.id WHERE a.owner=? AND r.task_id=? ORDER BY a.created_at', owner, row.id).map(presentApproval),
      children: all('SELECT * FROM agent_execution_tasks WHERE owner=? AND parent_id=? ORDER BY created_at,rowid', owner, row.id).map(presentTask) };
  }
  function retryTask(owner, taskId, input) {
    requireObject(input);
    const requestId = id(input.requestId);
    return transaction(() => {
      const row = taskRow(owner, taskId), body = decode(row.body);
      const duplicate = all('SELECT * FROM agent_execution_runs WHERE owner=? AND task_id=?', owner, row.id).find(execution => decode(execution.body).requestId === requestId);
      if (duplicate) return { task: presentTask(row), run: presentRun(duplicate) };
      const latest = runRow(owner, body.latestRunId);
      if (!['failed', 'interrupted', 'cancelled'].includes(latest.state)) throw fail(409, '只能重试已确认失败、中断或取消的执行');
      if (body.plan) throw fail(409, '计划已生成，请重试失败的子任务');
      if (body.parentTaskId && taskRow(owner, body.parentTaskId).state === 'cancelled') throw fail(409, '整个流程已取消，请新建任务');
      const resolved = resolveAgent(owner, body.agentId);
      checkTarget(owner, body, resolved.agent);
      const execution = createRun(owner, row.id, body, decode(latest.body).kind, latest.id, requestId);
      body.latestRunId = execution.id; delete body.failureReason; delete body.blockedReason;
      saveTask(row, body, decode(latest.body).kind === 'plan' ? 'awaiting_plan' : 'queued');
      if (body.parentTaskId) {
        updateParent(owner, body.parentTaskId);
      }
      return { task: presentTask(taskRow(owner, row.id)), run: presentRun(execution) };
    });
  }
  function cancelTask(owner, taskId) {
    return transaction(() => {
      const root = taskRow(owner, taskId);
      const targets = [root, ...all('SELECT * FROM agent_execution_tasks WHERE owner=? AND parent_id=?', owner, root.id)];
      for (const row of targets) {
        if (row.state === 'completed') continue;
        saveTask(row, decode(row.body), 'cancelled');
        for (const execution of all('SELECT * FROM agent_execution_runs WHERE owner=? AND task_id=?', owner, row.id)) {
          if (terminal.has(execution.state)) continue;
          const body = decode(execution.body);
          body.cancelRequested = true;
          if (execution.state === 'queued') body.endedAt = iso(timestamp());
          saveRun(execution, body, execution.state === 'queued' ? 'cancelled' : execution.state);
          for (const approval of all("SELECT * FROM agent_execution_approvals WHERE owner=? AND run_id=? AND state='pending'", owner, execution.id)) {
            run("UPDATE agent_execution_approvals SET state='cancelled',body=?,decided_at=? WHERE owner=? AND run_id=? AND id=?", encode({ ...decode(approval.body), cancellationReason: 'task_cancelled' }), timestamp(), owner, execution.id, approval.id);
          }
        }
      }
      updateParent(owner, decode(root.body).parentTaskId);
      return { task: presentTask(taskRow(owner, taskId)) };
    });
  }
  function presentApproval(row) {
    return { ...decode(row.body), id: row.id, approvalId: row.id, runId: row.run_id, status: row.state, createdAt: iso(row.created_at), decidedAt: iso(row.decided_at) };
  }
  function validateSchemaValue(value, schema, depth = 0) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 8) throw fail(400, '输入表单定义无效');
    const object = value !== null && typeof value === 'object' && !Array.isArray(value);
    const matches = type => ({ object, array: Array.isArray(value), string: typeof value === 'string', boolean: typeof value === 'boolean', number: typeof value === 'number' && Number.isFinite(value), integer: Number.isSafeInteger(value), null: value === null })[type] === true;
    if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(matches)) throw fail(400, '输入内容与表单字段类型不匹配');
    if (Array.isArray(schema.enum) && !schema.enum.some(entry => encode(canonical(entry)) === encode(canonical(value)))) throw fail(400, '输入内容不在表单允许的选项中');
    if (object) {
      if (Array.isArray(schema.required) && schema.required.some(key => !Object.hasOwn(value, key))) throw fail(400, '输入内容缺少表单必填字段');
      const properties = schema.properties || {};
      if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(properties, key))) throw fail(400, '输入内容包含未声明的表单字段');
      for (const [key, field] of Object.entries(properties)) if (Object.hasOwn(value, key)) validateSchemaValue(value[key], field, depth + 1);
    }
    if (Array.isArray(value)) {
      if (Number.isFinite(schema.minItems) && value.length < schema.minItems || Number.isFinite(schema.maxItems) && value.length > schema.maxItems) throw fail(400, '输入列表长度不符合表单要求');
      if (schema.items) value.forEach(entry => validateSchemaValue(entry, schema.items, depth + 1));
    }
    if (typeof value === 'string' && (Number.isFinite(schema.minLength) && value.length < schema.minLength || Number.isFinite(schema.maxLength) && value.length > schema.maxLength)) throw fail(400, '输入文字长度不符合表单要求');
    if (typeof value === 'number' && (Number.isFinite(schema.minimum) && value < schema.minimum || Number.isFinite(schema.maximum) && value > schema.maximum)) throw fail(400, '输入数值不符合表单要求');
  }
  function validateApprovalResponse(body, decision) {
    if (decision.decision !== 'approve' || body.kind !== 'input') return;
    const method = body.details?.method;
    if (method === 'mcpServer/elicitation/request') {
      let content;
      try { content = JSON.parse(decision.response); } catch { throw fail(400, 'MCP 表单输入必须为有效 JSON'); }
      requireObject(content);
      validateSchemaValue(content, body.details.requestedSchema || { type: 'object' });
    } else if (method === 'item/tool/requestUserInput') {
      const questions = body.details.questions;
      if (!Array.isArray(questions) || !questions.length || questions.length > 50 || questions.some(question => typeof question?.id !== 'string' || !question.id) || new Set(questions.map(question => question.id)).size !== questions.length) throw fail(400, '原始问题定义无效');
      if (questions.length === 1) {
        if (!decision.response.trim()) throw fail(400, '请填写问题答案');
        return;
      }
      let answers;
      try { answers = JSON.parse(decision.response); } catch { throw fail(400, '多个问题需要按问题 ID 填写 JSON 答案'); }
      requireObject(answers);
      const questionIds = new Set(questions.map(question => question.id));
      if (Object.keys(answers).some(key => !questionIds.has(key)) || questions.some(question => !Object.hasOwn(answers, question.id) || !Array.isArray(answers[question.id]) || !answers[question.id].length || answers[question.id].some(answer => typeof answer !== 'string' || !answer.trim()))) throw fail(400, '每个问题 ID 都需要非空文字答案数组');
    } else {
      throw fail(400, '不支持的输入审批类型');
    }
  }
  function decideApproval(owner, runId, approvalId, input) {
    requireObject(input);
    return transaction(() => {
      const execution = runRow(owner, runId);
      const approval = get('SELECT * FROM agent_execution_approvals WHERE owner=? AND run_id=? AND id=?', owner, runId, id(approvalId));
      if (!approval) throw fail(404, '审批请求不存在');
      if (!['approve', 'deny'].includes(input.decision)) throw fail(400, '审批决定无效');
      const decision = { decision: input.decision, response: text(input.response, 8000) }, body = decode(approval.body);
      if (approval.state !== 'pending') {
        if (encode(body.decision) !== encode(decision)) throw fail(409, '审批已处理');
        return { approval: presentApproval(approval) };
      }
      if (terminal.has(execution.state) || execution.state === 'unknown' || decode(execution.body).cancelRequested) throw fail(409, '执行已结束、状态待确认或正在取消');
      validateApprovalResponse(body, decision);
      body.decision = decision;
      run('UPDATE agent_execution_approvals SET state=?,body=?,decided_at=? WHERE owner=? AND run_id=? AND id=?', decision.decision === 'approve' ? 'approved' : 'denied', encode(body), timestamp(), owner, runId, approval.id);
      return { approval: presentApproval(get('SELECT * FROM agent_execution_approvals WHERE owner=? AND run_id=? AND id=?', owner, runId, approval.id)) };
    });
  }
  function dependenciesReady(owner, task) {
    return task.dependsOn.every(taskId => {
      const dependency = taskRow(owner, taskId), latest = decode(dependency.body).latestRunId;
      return dependency.state !== 'cancelled' && latest && runRow(owner, latest).state === 'succeeded';
    });
  }
  function planningContext(owner, task) {
    const agents = agentRows(owner).flatMap(agent => {
      const role = catalog(owner).roles.find(role => role.id === agent.roleId);
      return role?.instructions ? [{ id: agent.id, name: agent.name, roleId: role.id, roleName: role.name, skills: agent.skills || [], mcp: agent.mcp || [] }] : [];
    });
    return { goal: task.description, acceptanceCriteria: task.acceptanceCriteria, agents,
      planSchema: { type: 'object', additionalProperties: false, required: ['goal', 'tasks'], properties: { goal: { type: 'string' }, tasks: { type: 'array', minItems: 1, maxItems: PLAN_LIMIT, items: {
        type: 'object', additionalProperties: false, required: ['id', 'title', 'description', 'agentId', 'dependsOn', 'acceptanceCriteria', 'inputs'], properties: {
          id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, agentId: { type: 'string', enum: agents.map(agent => agent.id) }, dependsOn: { type: 'array', items: { type: 'string' } }, acceptanceCriteria: { type: 'array', minItems: 1, items: { type: 'string' } }, inputs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['taskId', 'description'], properties: { taskId: { type: 'string' }, description: { type: 'string' } } } }
        }
      } } } } };
  }
  function claimPayload(owner, execution, row, task, body) {
    const handoffs = task.dependsOn.map(taskId => {
      const dependency = taskRow(owner, taskId), dependencyTask = decode(dependency.body);
      const output = decode(runRow(owner, dependencyTask.latestRunId).body).result;
      return { taskId, title: dependencyTask.title, result: output };
    });
    return { runId: execution.id, taskId: row.id, parentTaskId: task.parentTaskId, kind: body.kind, title: task.title,
      instructions: [task.description, task.acceptanceCriteria.length ? `验收条件：\n${task.acceptanceCriteria.map(item => '- ' + item).join('\n')}` : '', handoffs.length ? `前置任务交接：\n${encode(handoffs)}` : ''].filter(Boolean).join('\n\n'),
      role: body.role, skills: body.skills, mcp: body.mcp, projectId: body.projectId, harnessId: body.harnessId, workspaceKey: body.workspaceKey,
      ...(body.kind === 'plan' ? { planningContext: planningContext(owner, task) } : {}) };
  }
  function claim(device) {
    const record = deviceRow(device);
    return transaction(() => {
      const occupied = all("SELECT * FROM agent_execution_runs WHERE owner=? AND device_id=? AND state IN ('starting','running','waiting_approval','unknown') ORDER BY created_at,rowid", record.owner, record.id);
      if (occupied.length) {
        const execution = occupied[0], body = decode(execution.body);
        if (occupied.length !== 1 || execution.state !== 'starting' || execution.ack_seq !== 0 || body.cancelRequested) return { run: null };
        const row = taskRow(record.owner, execution.task_id), task = decode(row.body);
        if (row.state === 'cancelled') return { run: null };
        resolveAgent(record.owner, body.agentId);
        if (!catalog(record.owner).roles.some(role => role.id === body.role.id && role.instructions)) throw fail(409, '执行角色已不可访问');
        checkTarget(record.owner, task, { skills: body.skills, mcp: body.mcp });
        // Re-delivery authorizes preparation only. A model turn requires the first-event
        // thread/attempt binding to be acknowledged; a different attempt will get 409.
        return { run: body.claimPayload || null };
      }
      const candidates = all("SELECT * FROM agent_execution_runs WHERE owner=? AND device_id=? AND state='queued' ORDER BY created_at,rowid LIMIT 100", record.owner, record.id);
      for (const execution of candidates) {
        const row = taskRow(record.owner, execution.task_id), task = decode(row.body), body = decode(execution.body);
        if (row.state === 'cancelled' || (task.parentTaskId && taskRow(record.owner, task.parentTaskId).state === 'cancelled') || !dependenciesReady(record.owner, task)) continue;
        try {
          resolveAgent(record.owner, body.agentId);
          if (!catalog(record.owner).roles.some(role => role.id === body.role.id && role.instructions)) throw fail(409, '执行角色已不可访问');
          checkTarget(record.owner, task, { skills: body.skills, mcp: body.mcp });
        }
        catch (error) {
          task.blockedReason = error.message;
          saveTask(row, task);
          continue;
        }
        body.startedAt = iso(timestamp());
        body.claimPayload = claimPayload(record.owner, execution, row, task, body);
        delete task.blockedReason;
        saveRun(execution, body, 'starting');
        saveTask(row, task, 'running');
        return { run: body.claimPayload };
      }
      return { run: null };
    });
  }
  function validatePlan(owner, plan, parent) {
    requireObject(plan);
    if (!Array.isArray(plan.tasks) || !plan.tasks.length || plan.tasks.length > PLAN_LIMIT) throw fail(400, '产品经理计划必须包含 1–12 个子任务');
    const goal = text(plan.goal, 4000, true), keys = new Set();
    const tasks = plan.tasks.map(input => {
      requireObject(input);
      const key = id(input.id);
      if (keys.has(key)) throw fail(400, '计划含重复子任务标识');
      keys.add(key);
      const agentId = id(input.agentId), { agent } = resolveAgent(owner, agentId);
      // Capability availability can change while PM is working. A blocked child remains queued;
      // claim checks actual device capabilities again and never claims an unavailable Agent.
      if (!Array.isArray(input.dependsOn) || !Array.isArray(input.acceptanceCriteria) || !input.acceptanceCriteria.length) throw fail(400, '每个计划子任务必须声明依赖列表与验收条件');
      const dependsOn = strings(input.dependsOn, PLAN_LIMIT, 100).map(id);
      if (new Set(dependsOn).size !== dependsOn.length) throw fail(400, '计划含重复依赖');
      const inputs = input.inputs || [];
      if (!Array.isArray(inputs) || inputs.length > PLAN_LIMIT) throw fail(400, '计划输入格式无效');
      const normalizedInputs = inputs.map(value => ({ taskId: id(value.taskId), description: text(value.description, 1500, true) }));
      if (normalizedInputs.some(value => !dependsOn.includes(value.taskId))) throw fail(400, '交接输入必须来自明确声明的前置任务');
      return { key, title: text(input.title, 200, true), description: text(input.description, 20_000, true), agentId, agentName: agent.name,
        dependsOn, inputs: normalizedInputs, acceptanceCriteria: strings(input.acceptanceCriteria, 30, 1500), deviceId: parent.deviceId, projectId: parent.projectId, harnessId: parent.harnessId, mode: 'manual', plan: null, latestRunId: null };
    });
    for (const task of tasks) if (task.dependsOn.some(key => !keys.has(key) || key === task.key)) throw fail(400, '计划依赖了不存在的任务或任务自身');
    const visiting = new Set(), visited = new Set();
    function visit(key) {
      if (visiting.has(key)) throw fail(400, '计划存在循环依赖');
      if (visited.has(key)) return;
      visiting.add(key);
      for (const dependency of tasks.find(task => task.key === key).dependsOn) visit(dependency);
      visiting.delete(key); visited.add(key);
    }
    tasks.forEach(task => visit(task.key));
    return { goal, tasks };
  }
  function applyPlan(owner, taskRowValue, execution, rawPlan) {
    const parent = decode(taskRowValue.body);
    if (parent.plan) throw fail(409, '该计划已分派');
    const plan = validatePlan(owner, sanitizeDetails(rawPlan, decode(execution.body).role.instructions), parent), mapped = new Map();
    for (const task of plan.tasks) mapped.set(task.key, randomUUID());
    const publicPlan = { goal: plan.goal, tasks: [] };
    for (const entry of plan.tasks) {
      const taskId = mapped.get(entry.key), at = timestamp();
      const { key, ...body } = entry;
      body.parentTaskId = taskRowValue.id;
      body.planTaskId = key;
      body.dependsOn = body.dependsOn.map(key => mapped.get(key));
      body.inputs = body.inputs.map(value => ({ ...value, taskId: mapped.get(value.taskId) }));
      const requestId = `plan-${execution.id}-${key}`;
      run('INSERT INTO agent_execution_tasks(id,owner,request_id,request_hash,parent_id,state,created_at,updated_at,body) VALUES(?,?,?,?,?,?,?,?,?)', taskId, owner, requestId, hash(encode(body)), taskRowValue.id, 'queued', at, at, encode(body));
      const child = createRun(owner, taskId, body, 'execute');
      body.latestRunId = child.id;
      saveTask(taskRow(owner, taskId), body);
      publicPlan.tasks.push({ id: key, taskId, title: body.title, description: body.description, agentId: body.agentId, agentName: body.agentName, dependsOn: entry.dependsOn, acceptanceCriteria: body.acceptanceCriteria, inputs: entry.inputs });
    }
    parent.plan = publicPlan;
    saveTask(taskRowValue, parent, 'running');
    return publicPlan;
  }
  function updateParent(owner, parentId) {
    if (!parentId) return;
    const parent = taskRow(owner, parentId);
    if (parent.state === 'cancelled') return;
    const children = all('SELECT * FROM agent_execution_tasks WHERE owner=? AND parent_id=?', owner, parentId);
    if (!children.length) return;
    const states = children.map(child => child.state === 'cancelled' ? 'cancelled' : runRow(owner, decode(child.body).latestRunId).state);
    const state = states.every(value => value === 'succeeded') ? 'awaiting_acceptance' : states.some(value => ['failed', 'interrupted', 'cancelled', 'unknown'].includes(value)) ? 'blocked' : states.some(value => value === 'waiting_approval') ? 'awaiting_approval' : 'running';
    saveTask(parent, decode(parent.body), state);
  }
  function sanitizeDetails(value, instruction, depth = 0) {
    if (depth > 5) return '[truncated]';
    if (typeof value === 'string') return cleanMessage(value.slice(0, 12_000), instruction);
    if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
    if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeDetails(item, instruction, depth + 1));
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, entry]) => [key, /token|password|secret|authorization|credential/i.test(key) ? '[redacted]' : sanitizeDetails(entry, instruction, depth + 1)]));
    return null;
  }
  function normalizeEvent(event, instructions) {
    requireObject(event); requireObject(event.data);
    if (!Number.isSafeInteger(event.seq) || event.seq < 1 || event.seq > 100_000 || !['state', 'progress', 'approval', 'result', 'error'].includes(event.kind)) throw fail(400, '执行事件格式无效');
    if (encode(event.data).length > 100_000) throw fail(413, '执行事件过大');
    const value = event.data;
    let data;
    if (event.kind === 'state') {
      if (!['running', 'unknown', 'interrupted', 'cancelled'].includes(value.state)) throw fail(400, '执行状态无效');
      data = { state: value.state, message: cleanMessage(value.message, instructions) };
      for (const key of ['threadId', 'turnId', 'attemptId']) {
        if (value[key] === undefined) continue;
        const identifier = text(value[key], 160, true);
        if (!/^[A-Za-z0-9_-]{1,160}$/.test(identifier)) throw fail(400, 'Codex 会话标识格式无效');
        data[key] = identifier;
      }
    } else if (event.kind === 'progress') {
      data = { message: cleanMessage(value.message, instructions) };
    } else if (event.kind === 'error') {
      data = { message: cleanMessage(value.message, instructions) || '运行失败', code: text(value.code, 100) };
    } else if (event.kind === 'approval') {
      if (!['approval', 'input'].includes(value.kind)) throw fail(400, '审批类型无效');
      data = { approvalId: id(value.approvalId), kind: value.kind, message: cleanMessage(value.message, instructions), details: sanitizeDetails(value.details || {}, instructions) };
    } else {
      if (!Array.isArray(value.artifacts || []) || (value.artifacts || []).length > 50) throw fail(400, '执行产物格式无效');
      data = { summary: cleanMessage(value.summary, instructions), artifacts: (value.artifacts || []).map(artifact => {
        const output = { name: cleanMessage(text(artifact.name, 300, true), instructions), kind: text(artifact.kind, 60) };
        if (artifact.uri) {
          let url;
          try { url = new URL(text(artifact.uri, 2000)); } catch { throw fail(400, '产物链接格式无效'); }
          if (url.protocol !== 'https:' || url.username || url.password) throw fail(400, '产物链接仅支持 HTTPS');
          url.search = ''; url.hash = ''; output.uri = url.href;
        }
        return output;
      }) };
      // A plan is validated before persisting; full private prompts or arbitrary fields never become events.
      if (value.plan !== undefined) data.plan = value.plan;
    }
    return { seq: event.seq, kind: event.kind, data };
  }
  function applyEvent(execution, event) {
    const owner = execution.owner, body = decode(execution.body), row = taskRow(owner, execution.task_id), task = decode(row.body);
    if (terminal.has(execution.state)) throw fail(409, '执行已结束，不能追加新的事件');
    if (execution.ack_seq === 0) {
      const startsModel = event.kind === 'state' && event.data.state === 'running' && event.data.threadId && event.data.attemptId;
      const setupFailed = event.kind === 'error' && event.data.code === 'SETUP_FAILED';
      const unknownPreparation = event.kind === 'state' && event.data.state === 'unknown';
      if (!startsModel && !setupFailed && !unknownPreparation) throw fail(409, '首个事件必须确认真实 Codex 会话与执行尝试');
    }
    if (execution.state === 'unknown' && !(event.kind === 'progress' || event.kind === 'state' && ['unknown', 'interrupted', 'cancelled'].includes(event.data.state))) throw fail(409, '未知执行只能在核实原进程终止后结束');
    if (event.kind === 'state' && ['interrupted', 'cancelled'].includes(event.data.state) && execution.state === 'unknown' && body.threadId && (event.data.threadId !== body.threadId || event.data.attemptId !== body.attemptId)) throw fail(409, '结束未知执行必须提供原会话与执行尝试标识');
    if (event.kind === 'state') {
      for (const key of ['threadId', 'turnId', 'attemptId']) {
        if (event.data[key] === undefined) continue;
        if (body[key] && body[key] !== event.data[key]) throw fail(409, '执行已绑定其他 Codex 会话');
        body[key] = event.data[key];
      }
      if (event.data.state === 'running') {
        if (!['starting', 'running', 'waiting_approval'].includes(execution.state)) throw fail(409, '执行尚未领取');
        if (get("SELECT id FROM agent_execution_approvals WHERE owner=? AND run_id=? AND state='pending' LIMIT 1", owner, execution.id)) throw fail(409, '审批尚未处理');
        saveRun(execution, body, 'running');
        if (!body.cancelRequested) saveTask(row, task, 'running');
      } else if (event.data.state === 'unknown') {
        saveRun(execution, body, 'unknown');
        if (!body.cancelRequested) saveTask(row, task, 'blocked');
      } else {
        body.endedAt = iso(timestamp());
        saveRun(execution, body, event.data.state);
        saveTask(row, task, event.data.state === 'cancelled' ? 'cancelled' : 'blocked');
      }
    } else if (event.kind === 'approval') {
      const existing = get('SELECT * FROM agent_execution_approvals WHERE owner=? AND run_id=? AND id=?', owner, execution.id, event.data.approvalId);
      if (existing) throw fail(409, '重复的审批请求标识');
      if (body.cancelRequested) {
        // An approval may already be durably spooled on the Mac when cancellation
        // arrives. Audit/ACK that original sequence without making it actionable.
        run('INSERT INTO agent_execution_approvals(owner,run_id,id,state,body,created_at,decided_at) VALUES(?,?,?,?,?,?,?)', owner, execution.id, event.data.approvalId, 'cancelled', encode({ ...event.data, cancellationReason: 'task_cancelled' }), timestamp(), timestamp());
      } else {
        run('INSERT INTO agent_execution_approvals(owner,run_id,id,state,body,created_at) VALUES(?,?,?,?,?,?)', owner, execution.id, event.data.approvalId, 'pending', encode(event.data), timestamp());
        saveRun(execution, body, 'waiting_approval'); saveTask(row, task, 'awaiting_approval');
      }
    } else if (event.kind === 'result') {
      if (get("SELECT id FROM agent_execution_approvals WHERE owner=? AND run_id=? AND state='pending' LIMIT 1", owner, execution.id)) throw fail(409, '审批尚未完成，不能结束执行');
      body.endedAt = iso(timestamp());
      if (body.cancelRequested) {
        delete event.data.plan;
        body.result = event.data;
        saveRun(execution, body, 'cancelled'); saveTask(row, task, 'cancelled');
      } else {
        let state = 'succeeded';
        if (body.kind === 'plan') {
          try { event.data.plan = applyPlan(owner, row, execution, event.data.plan); }
          catch (error) {
            if (!error.status) throw error;
            state = 'failed';
            event.data = { summary: '产品经理计划未通过校验', artifacts: [], validationError: cleanMessage(error.message) };
            task.failureReason = event.data.validationError;
            saveTask(row, task, 'blocked');
          }
        } else {
          delete event.data.plan;
          saveTask(row, task, 'awaiting_acceptance');
        }
        body.result = event.data;
        saveRun(execution, body, state);
      }
    } else if (event.kind === 'error') {
      body.endedAt = iso(timestamp()); body.error = event.data;
      const state = body.cancelRequested ? 'cancelled' : 'failed';
      saveRun(execution, body, state);
      task.failureReason = event.data.message;
      saveTask(row, task, state === 'cancelled' ? 'cancelled' : 'blocked');
    }
    updateParent(owner, task.parentTaskId);
  }
  function appendEvents(device, runId, input) {
    const record = deviceRow(device);
    requireObject(input);
    if (!Array.isArray(input.events) || input.events.length > 100 || !input.events.length) throw fail(400, '执行事件批次格式无效');
    return transaction(() => {
      let execution = runRow(record.owner, runId);
      if (execution.device_id !== record.id) throw fail(403, '设备不能上报其他设备的执行');
      if (execution.state === 'queued') throw fail(409, '执行尚未领取');
      for (const rawEvent of input.events) {
        requireObject(rawEvent);
        const originalHash = contentHash({ kind: rawEvent.kind, data: rawEvent.data });
        const event = normalizeEvent(rawEvent, decode(execution.body).role.instructions);
        const existing = get('SELECT event_hash FROM agent_execution_events WHERE owner=? AND run_id=? AND seq=?', record.owner, execution.id, event.seq);
        if (existing) {
          if (existing.event_hash !== originalHash) throw fail(409, '同一事件序号的内容不一致');
          continue;
        }
        if (event.seq !== execution.ack_seq + 1) throw fail(409, '事件必须按连续序号补传', { ackSeq: execution.ack_seq });
        applyEvent(execution, event);
        run('INSERT INTO agent_execution_events(owner,run_id,seq,event_hash,body,created_at) VALUES(?,?,?,?,?,?)', record.owner, execution.id, event.seq, originalHash, encode({ kind: event.kind, data: event.data }), timestamp());
        run('UPDATE agent_execution_runs SET ack_seq=? WHERE owner=? AND id=?', event.seq, record.owner, execution.id);
        execution = runRow(record.owner, execution.id);
      }
      return { ackSeq: execution.ack_seq, ...(decode(execution.body).cancelRequested ? { cancelRequested: true } : {}) };
    });
  }
  return { ensureAgents, createPairingCode, pair, authenticateDevice, listDevices, revokeDevice, heartbeat, createTask, listTasks, getTask, retryTask, cancelTask, decideApproval, claim, appendEvents };
}
