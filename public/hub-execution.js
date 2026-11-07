const API = '/api/agent-execution';
const HUB = '/api/developer-hub';
const TERMINAL = new Set(['failed', 'cancelled', 'interrupted', 'awaiting_acceptance', 'accepted', 'completed', 'succeeded']);
const LABELS = {
  queued: '排队中', blocked: '受阻', awaiting_plan: '等待产品规划', starting: '已领取', waiting_dependencies: '等待依赖', planning: '规划中', running: '执行中',
  awaiting_approval: '等待批准', waiting_approval: '等待批准', awaiting_input: '等待输入',
  awaiting_acceptance: '待验收', accepted: '已验收', completed: '已完成', succeeded: '已完成',
  failed: '失败', cancelled: '已取消', interrupted: '已中断', pending: '待处理', unknown: '执行状态待确认',
  approved: '已批准', denied: '已拒绝', approve: '已批准', deny: '已拒绝',
  ready: '可用', auth_required: '需要登录', unavailable: '不可用', available: '已核验', unverified: '待核验', configured: '已登记',
};
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const array = value => Array.isArray(value) ? value : [];
const status = value => LABELS[value] || value || '尚未上报';

export function createExecutionUI(ctx) {
  const { esc, icon } = ctx;
  let state;
  let mounted;
  let timer;
  let controller;
  let generation = 0;
  const scope = () => ctx.accountScope ?? ctx.userId ?? 'local';
  function stop() {
    clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
    generation++;
  }
  function current() {
    if (state?.scope !== scope()) {
      stop();
      mounted = undefined;
      state = { scope: scope(), devices: [], tasks: [], agents: [], roles: [], catalogLoaded: new Set(), loaded: false, loading: false, error: '', refreshedAt: '', details: new Map(), retries: new Map(), approvalDrafts: new Map(), pendingApprovals: new Set(), filter: 'all', pairing: null };
    }
    return state;
  }
  function owner(snapshot, value) {
    if (current() !== snapshot) return false;
    if (value?.owner != null && value.owner !== ctx.userId) throw new Error('登录账号已变化，请重新加载。');
    return true;
  }
  function active(snapshot) {
    return current() === snapshot && mounted?.panel?.isConnected;
  }
  function repaint(snapshot) {
    if (active(snapshot)) ctx.render();
  }
  function button(label, action, { value = '', primary = false, danger = false, disabled = false } = {}) {
    return `<button type="button" class="btn${primary ? ' primary' : ''}${danger ? ' danger' : ''}" data-execution-action="${action}" data-execution-value="${esc(value)}"${disabled ? ' disabled' : ''}>${esc(label)}</button>`;
  }
  function time(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '尚未上报';
    return `<time datetime="${esc(value)}">${esc(timeFormat.format(new Date(value)))}</time>`;
  }
  function badge(value) {
    return `<span class="execution-badge" data-status="${esc(value)}">${esc(status(value))}</span>`;
  }
  function empty(title, message, action = '') {
    return `<div class="execution-empty"><span class="execution-mark">${icon('activity', 22)}</span><h3>${esc(title)}</h3><p>${esc(message)}</p>${action}</div>`;
  }
  function navigate(path) { ctx.navigate(path); }
  function taskPath(id) { return `${mounted?.baseRoute || 'development/tasks'}/${id}`; }
  function person(snapshot, id) { return snapshot.agents.find(item => item.id === id); }
  function device(snapshot, id) { return snapshot.devices.find(item => item.id === id); }
  function publishedProjects(entry) { return array(entry?.projects); }
  function harnesses(entry) { return array(entry?.harnesses); }
  function runtimeName(entry, id) { return harnesses(entry).find(item => item.id === id)?.name || id || '未绑定'; }
  function projectName(entry, id) { return publishedProjects(entry).find(item => item.id === id)?.name || id || '未绑定'; }
  function agentSummary(agent) {
    const snapshot = current();
    const entry = device(snapshot, agent.deviceId);
    return `<span class="execution-agent-summary">${esc(entry?.name || (agent.deviceId ? '已绑定设备' : '未绑定设备'))}${agent.harnessId ? ` · ${esc(runtimeName(entry, agent.harnessId))}` : ''}${entry ? `<i class="execution-dot${entry.online && !entry.revokedAt ? ' is-online' : ''}" aria-label="${entry.online && !entry.revokedAt ? '设备在线' : '设备离线'}"></i>` : ''}</span>`;
  }

  async function refresh(snapshot = current(), detailId = mounted?.taskId) {
    if (snapshot.loading || !active(snapshot)) return;
    snapshot.loading = true;
    const token = generation;
    const abort = controller ||= new AbortController();
    try {
      const jobs = [
        ['devices', API + '/devices'], ['tasks', API + '/tasks'],
        ...(!snapshot.catalogLoaded.has('agents') ? [['agents', HUB + '/agents']] : []),
        ...(!snapshot.catalogLoaded.has('roles') ? [['roles', HUB + '/roles']] : []),
        ...(detailId ? [['detail', API + '/tasks/' + encodeURIComponent(detailId)]] : []),
      ];
      const results = await Promise.allSettled(jobs.map(async ([kind, url]) => [kind, await ctx.api(url, { signal: abort.signal })]));
      if (token !== generation || !active(snapshot)) return;
      let errorMessage = '';
      let received = false;
      for (let index = 0; index < results.length; index++) {
        const result = results[index];
        if (result.status === 'rejected') {
          errorMessage ||= result.reason?.message || '暂时无法读取执行状态。';
          continue;
        }
        const [kind, payload] = result.value;
        if (!owner(snapshot, payload)) return;
        received = true;
        if (kind === 'detail') snapshot.details.set(detailId, payload);
        else { snapshot[kind] = array(payload[kind]); if (kind === 'agents' || kind === 'roles') snapshot.catalogLoaded.add(kind); }
      }
      snapshot.loaded ||= received;
      snapshot.error = errorMessage;
      if (received) snapshot.refreshedAt = new Date().toISOString();
    } catch (error) {
      if (token === generation && active(snapshot)) snapshot.error = error.message;
    } finally {
      if (token === generation) snapshot.loading = false;
      if (token === generation && active(snapshot)) {
        // Form controls and a user's typed approval response must survive polling.
        if (!mounted.panel.querySelector('textarea:focus, input:focus, select:focus')) repaint(snapshot);
        schedule(snapshot);
      }
    }
  }
  function schedule(snapshot) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!active(snapshot)) { stop(); return; }
      if (document.visibilityState === 'hidden') { schedule(snapshot); return; }
      void refresh(snapshot);
    }, snapshot.error ? 15000 : 7000);
  }

  function capabilityRows(entries, label) {
    const records = array(entries);
    return `<div class="execution-verification"><strong>${esc(label)}</strong>${records.length ? records.map(entry => `<span>${esc(entry.name)} ${badge(entry.status)}${entry.checkedAt ? `<small>${time(entry.checkedAt)}</small>` : ''}</span>`).join('') : '<span class="execution-muted">尚未上报核验结果</span>'}</div>`;
  }
  function deviceCards(snapshot) {
    if (!snapshot.devices.length) return empty('连接你的第一台 Mac', '在 Mac 上运行连接器，将生成的配对码输入连接器。连接器上报后，这里会显示 Codex、项目和能力状态。', button('生成配对码', 'pairing', { primary: true }));
    return `<div class="execution-device-grid">${snapshot.devices.map(entry => `<article class="execution-card execution-device">
      <header><div><h3>${esc(entry.name)}</h3><p>${esc(entry.platform || '设备')}${entry.version ? ` · 连接器 ${esc(entry.version)}` : ''}</p></div><span class="execution-connect"><i class="execution-dot${entry.online && !entry.revokedAt ? ' is-online' : ''}"></i>${entry.revokedAt ? '已撤销' : entry.online ? '在线' : '离线'}</span></header>
      <dl class="execution-facts"><div><dt>最近心跳</dt><dd>${time(entry.lastSeenAt)}</dd></div><div><dt>当前运行</dt><dd>${array(entry.activeRunIds).length} 项</dd></div></dl>
      ${harnesses(entry).length ? harnesses(entry).map(harness => `<section class="execution-harness"><div class="execution-inline"><h4>${esc(harness.name || harness.id)}</h4>${harness.version ? `<code>${esc(harness.version)}</code>` : ''}${badge(harness.status)}</div>${capabilityRows(harness.skills, 'Skills')}${capabilityRows(harness.mcp, 'MCP')}</section>`).join('') : '<p class="execution-note">尚未收到 Harness 检查结果。连接器需要检测 Codex 并确认登录状态。</p>'}
      <section><h4>已发布项目</h4>${publishedProjects(entry).length ? `<div class="execution-projects">${publishedProjects(entry).map(project => `<span>${icon('file', 13)}${esc(project.name)}</span>`).join('')}</div>` : '<p class="execution-note">在连接器中添加本地项目后，创建任务时即可选择。</p>'}</section>
      ${entry.revokedAt ? '' : `<footer>${button('撤销连接', 'revoke', { value: entry.id })}</footer>`}
    </article>`).join('')}</div>`;
  }
  function pairingInstructions(snapshot) {
    const pairing = snapshot.pairing;
    return `<p><a class="btn" href="/download/Workbench-Agent-Bridge-1.0.0-macos-arm64.zip">下载 Mac 连接程序</a></p><section class="execution-card execution-enrollment"><div><h3>让这台 Mac 接收任务</h3><ol><li>打开 Mac 上的 Workbench Agent Bridge，填写此工作台的地址。</li><li>点击「生成配对码」，将配对码输入 Mac 应用并完成配对。</li><li>在 Mac 应用中添加本地项目并启动连接器，完成 Codex 登录与能力检查。</li></ol><p class="execution-note">项目路径和登录凭据保留在设备上。网页只接收项目名称、能力检查和执行事件。</p></div>
      <div class="execution-pairing">${pairing ? `<span>一次性配对码</span><code>${esc(pairing.code)}</code><small>有效期至 ${time(pairing.expiresAt)}</small>` : '<span>配对码有效 10 分钟，仅使用一次。</span>'}${button(pairing ? '重新生成' : '生成配对码', 'pairing', { primary: true })}</div>
    </section>`;
  }

  function tasksList(snapshot, { agentId = '', compact = false } = {}) {
    let entries = snapshot.tasks.filter(item => !agentId || item.agentId === agentId);
    const all = entries;
    if (snapshot.filter !== 'all' && !compact) entries = entries.filter(item => snapshot.filter === 'active' ? !TERMINAL.has(item.status) : snapshot.filter === 'approval' ? ['awaiting_approval', 'waiting_approval', 'awaiting_input'].includes(item.status) : snapshot.filter === 'failed' ? item.status === 'failed' || !!item.failureReason : item.status === snapshot.filter);
    const filters = compact ? '' : `<div class="execution-filters" role="group" aria-label="任务状态">${[['all', '全部'], ['active', '进行中'], ['approval', '待我批准'], ['awaiting_acceptance', '待验收'], ['failed', '失败']].map(([key, label]) => `<button type="button" data-execution-action="filter" data-execution-value="${key}" aria-pressed="${snapshot.filter === key}">${label}${key === 'all' ? ` ${all.length}` : ''}</button>`).join('')}</div>`;
    return `${filters}${entries.length ? `<div class="execution-task-list">${entries.map(task => {
      const assigned = person(snapshot, task.agentId);
      const selectedDevice = device(snapshot, task.deviceId);
      return `<button class="execution-task-row" type="button" data-execution-action="detail" data-execution-value="${esc(task.id)}"><span class="execution-mark">${icon(task.mode === 'automatic' ? 'sparkles' : 'task', 18)}</span><span class="execution-task-name"><strong>${esc(task.title)}</strong><small>${esc(assigned?.name || task.agentName || '未指定 Agent')} · ${esc(selectedDevice?.name || '设备待上报')}${task.parentTaskId ? ' · 子任务' : task.mode === 'automatic' ? ' · 自动规划' : ' · 手动分配'}</small>${task.currentMessage || task.progressMessage || task.blockedReason || task.failureReason ? `<span>${esc(task.currentMessage || task.progressMessage || task.blockedReason || task.failureReason)}</span>` : ''}</span><span class="execution-task-meta">${badge(task.status)}<small>${time(task.updatedAt || task.createdAt)}</small></span>${icon('arrow', 15)}</button>`;
    }).join('')}</div>` : empty(agentId ? '这个 Agent 还没有任务' : '还没有符合条件的任务', '任务创建后，会显示设备实际回传的运行状态与交付记录。', button('创建任务', 'new-task', { value: agentId, primary: true }))}`;
  }
  function taskFacts(snapshot, task) {
    const entry = device(snapshot, task.deviceId);
    const agent = person(snapshot, task.agentId);
    return `<dl class="execution-facts">${[
      ['负责 Agent', agent?.name || task.agentName || task.agentId], ['执行设备', entry?.name || task.deviceId],
      ['运行环境', runtimeName(entry, task.harnessId)], ['项目', projectName(entry, task.projectId)],
      ['创建时间', time(task.createdAt), true], ['最近更新', time(task.updatedAt), true],
    ].map(([label, value, html]) => `<div><dt>${label}</dt><dd>${html ? value : esc(value || '未指定')}</dd></div>`).join('')}</dl>`;
  }
  function artifacts(detail) {
    const records = [...array(detail.runs).flatMap(run => array(run.result?.artifacts || run.artifacts)), ...array(detail.events).filter(event => event.kind === 'result').flatMap(event => array(event.data?.artifacts))];
    const unique = [...new Map(records.map(record => [JSON.stringify([record.name, record.uri]), record])).values()];
    return unique.length ? `<ul class="execution-artifacts">${unique.map(record => {
      let href = '';
      try { const url = new URL(record.uri); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) href = url.href; } catch { /* Device-local artifacts are displayed as paths. */ }
      return `<li>${icon('file', 16)}<div>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(record.name || '交付文件')}${icon('arrow', 12)}</a>` : `<strong>${esc(record.name || '交付文件')}</strong>`}${record.uri && !href ? `<code>${esc(record.uri)}</code>` : ''}${record.kind ? `<small>${esc(record.kind)}</small>` : ''}</div></li>`;
    }).join('')}</ul>` : '<p class="execution-note">尚未回传交付物。</p>';
  }
  function approvals(detail) {
    const records = array(detail.approvals);
    return records.length ? `<div class="execution-approvals">${records.map(approval => {
      const pending = !approval.decision && (!approval.status || approval.status === 'pending');
      const decision = typeof approval.decision === 'object' ? approval.decision?.decision : approval.decision;
      const response = approval.decision?.response || approval.response;
      const key = `${approval.runId}:${approval.id || approval.approvalId}`;
      const disabled = current().pendingApprovals.has(key) ? ' disabled' : '';
      const draft = current().approvalDrafts.get(key) || '';
      return `<form class="execution-approval${pending ? ' is-pending' : ''}" data-execution-approval="${esc(approval.id || approval.approvalId)}" data-run-id="${esc(approval.runId)}"><header><strong>${approval.kind === 'input' ? 'Agent 需要你的输入' : '操作批准请求'}</strong>${badge(decision || approval.status || 'pending')}</header><p>${esc(approval.message || approval.data?.message || '请查看请求内容。')}</p>${approval.details ? `<details><summary>查看操作详情</summary><pre>${esc(typeof approval.details === 'string' ? approval.details : JSON.stringify(approval.details, null, 2))}</pre></details>` : ''}${pending ? `<label>回复${approval.kind === 'input' ? '（必填）' : '（可选）'}<textarea name="response" rows="2" maxlength="8000"${approval.kind === 'input' ? ' required' : ''} placeholder="给 Agent 的补充说明">${esc(draft)}</textarea></label><div class="execution-actions"><button type="submit" name="decision" value="approve" class="btn primary"${disabled}>${approval.kind === 'input' ? '发送回复' : '批准'}</button><button type="submit" name="decision" value="deny" class="btn" formnovalidate${disabled}>拒绝</button></div><p class="execution-form-error" role="alert"></p>` : response ? `<p class="execution-note">回复：${esc(response)}</p>` : ''}</form>`;
    }).join('')}</div>` : '<p class="execution-note">没有收到需要批准的操作。</p>';
  }
  function eventList(detail) {
    const events = array(detail.events);
    if (!events.length) return '<p class="execution-note">连接器尚未回传事件。任务排队期间不会生成执行进度。</p>';
    return `<ol class="execution-events">${events.slice(-80).reverse().map(event => `<li><span class="execution-event-dot"></span><div><div class="execution-event-heading"><strong>${esc({ progress: '工作进展', state: '运行状态', approval: '需要批准', result: '交付结果', error: '运行错误' }[event.kind] || event.kind)}</strong><span>${time(event.at || event.createdAt || event.receivedAt || event.timestamp)}</span></div><p>${esc(event.data?.message || event.data?.summary || event.message || status(event.data?.state) || '已收到事件')}</p><small>${event.seq != null ? `事件 #${esc(event.seq)}` : ''}${event.runId ? ` · 运行 ${esc(event.runId.slice(0, 8))}` : ''}</small></div></li>`).join('')}</ol>${events.length > 80 ? '<p class="execution-note">显示最近 80 条事件。</p>' : ''}`;
  }
  function planView(snapshot, detail) {
    const plan = detail.task?.plan || array(detail.events).findLast(event => event.kind === 'result' && event.data?.plan)?.data.plan;
    const children = array(detail.children);
    if (!plan && !children.length) return detail.task?.mode === 'automatic' ? '<p class="execution-note">产品经理的真实规划完成后，子任务及依赖会显示在这里。</p>' : '';
    return `${plan?.goal ? `<p class="execution-body">${esc(plan.goal)}</p>` : ''}${children.length ? `<ol class="execution-plan">${children.map(child => {
      const dependencies = array(child.dependsOn || child.dependencies);
      const inputs = array(child.inputs);
      return `<li><button type="button" data-execution-action="detail" data-execution-value="${esc(child.id)}"><span><strong>${esc(child.title)}</strong><small>${esc(person(snapshot, child.agentId)?.name || child.agentName || child.agentId || '')}</small></span>${badge(child.status)}${icon('arrow', 14)}</button>${dependencies.length ? `<p>依赖 ${dependencies.map(id => esc(children.find(item => item.id === id || item.planTaskId === id)?.title || id)).join('、')}</p>` : '<p>无前置依赖</p>'}${inputs.length ? `<p>交接输入：${inputs.map(input => esc(input.description || input.taskId)).join('；')}</p>` : ''}</li>`;
    }).join('')}</ol>` : `<div class="execution-plan">${array(plan?.tasks).map(child => `<article><strong>${esc(child.title)}</strong><p>${esc(child.description)}</p><small>依赖：${array(child.dependsOn).map(esc).join('、') || '无'}</small></article>`).join('')}</div>`}`;
  }
  function taskDetail(snapshot, id) {
    const detail = snapshot.details.get(id);
    if (!detail) return empty(snapshot.error ? '暂时无法读取任务' : '正在读取任务…', snapshot.error || '正在连接执行服务。', snapshot.error ? button('重新加载', 'refresh') : '');
    const task = detail.task;
    if (!task) return empty('找不到这个任务', '返回列表查看当前账号的任务。');
    const runs = array(detail.runs);
    const lastRun = runs.at(-1);
    const lastEvent = array(detail.events).at(-1);
    const currentMessage = task.currentMessage || task.progressMessage || lastRun?.currentMessage || lastRun?.progressMessage || task.failureReason || lastEvent?.data?.message || lastRun?.result?.summary;
    const terminal = TERMINAL.has(task.status) || (task.status === 'blocked' && ['failed', 'interrupted', 'cancelled'].includes(lastRun?.status));
    const retryable = !task.plan && lastRun?.connectionStatus !== 'unknown' && ['failed', 'cancelled', 'interrupted'].includes(lastRun?.status);
    return `<div class="execution-detail"><button type="button" class="execution-back" data-execution-action="back">← 返回任务列表</button><header class="execution-heading"><div><p class="execution-kicker">${task.mode === 'automatic' ? '自动规划工作流' : task.parentTaskId ? '工作流子任务' : 'Agent 任务'} ${badge(task.status)}</p><h2>${esc(task.title)}</h2></div><div class="execution-actions">${button('刷新状态', 'refresh')}${retryable ? button('重试任务', 'retry-task', { value: task.id, primary: true }) : ''}${!terminal ? button('取消任务', 'cancel-task', { value: task.id }) : ''}</div></header>
      <div class="execution-detail-grid"><section class="execution-card"><h3>任务与执行分配</h3>${taskFacts(snapshot, task)}<h4>任务说明</h4><p class="execution-body">${esc(task.description || task.instructions || '未填写')}</p>${array(task.acceptanceCriteria).length ? `<h4>验收标准</h4><ul class="execution-criteria">${task.acceptanceCriteria.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}${task.parentTaskId ? button('查看上级工作流', 'detail', { value: task.parentTaskId }) : ''}</section>
      <section class="execution-card"><h3>当前工作</h3>${lastRun?.connectionStatus === 'unknown' ? '<p class="execution-error">当前运行状态待确认，请在执行设备上核实原进程状态。</p>' : ''}<p class="execution-current">${esc(currentMessage || task.blockedReason || (task.status === 'queued' || task.status === 'awaiting_plan' ? '等待所选设备领取任务。' : '尚未回传工作说明。'))}</p>${task.error || lastRun?.error ? `<p class="execution-form-error">${esc(typeof (task.error || lastRun.error) === 'string' ? task.error || lastRun.error : (task.error || lastRun.error).message || JSON.stringify(task.error || lastRun.error))}</p>` : ''}<p class="execution-note">设备最近心跳 ${time(device(snapshot, task.deviceId)?.lastSeenAt)}</p><h4>运行记录</h4>${runs.length ? `<ul class="execution-runs">${runs.map(run => `<li><span><code>${esc(run.id?.slice(0, 8) || run.runId?.slice(0, 8))}</code><small>${run.kind === 'plan' ? '产品规划' : '任务执行'} · ${time(run.updatedAt || run.startedAt || run.createdAt)}</small></span>${badge(run.status)}</li>`).join('')}</ul>` : '<p class="execution-note">尚未创建运行。</p>'}</section>
      ${task.mode === 'automatic' || array(detail.children).length ? `<section class="execution-card execution-wide"><h3>产品规划与子任务</h3>${planView(snapshot, detail)}</section>` : ''}
      <section class="execution-card"><h3>批准与输入</h3>${approvals(detail)}</section><section class="execution-card"><h3>交付物</h3>${artifacts(detail)}${lastRun?.id ? `<p><a class="btn" href="workbench-agent://run?runId=${encodeURIComponent(lastRun.id)}">在执行 Mac 上打开工作目录</a></p>` : ''}${task.summary || lastRun?.result?.summary || lastRun?.summary ? `<h4>交付说明</h4><p class="execution-body">${esc(task.summary || lastRun?.result?.summary || lastRun?.summary)}</p>` : ''}${task.status === 'awaiting_acceptance' ? '<p class="execution-note">运行已提交结果，等待人工验收。</p>' : ''}</section>
      <section class="execution-card execution-wide"><h3>执行事件</h3>${eventList(detail)}</section></div></div>`;
  }
  function render(view = 'tasks', options = {}) {
    const snapshot = current();
    const { agentId, taskId } = options;
    let content;
    if (view === 'bindings') content = `<div class="execution-binding-summary"><span>${snapshot.loaded ? `${snapshot.devices.filter(item => item.online && !item.revokedAt).length} 台设备在线 · ${snapshot.devices.filter(item => !item.revokedAt).length} 台已配对` : '正在读取执行设备…'}</span>${button('管理执行设备', 'devices')}</div>`;
    else if (view === 'devices') content = `<header class="execution-heading"><div><h2>执行设备</h2><p>连接本地环境，并核验实际可用的运行能力。</p></div>${button('刷新状态', 'refresh')}</header>${pairingInstructions(snapshot)}${snapshot.loaded ? deviceCards(snapshot) : empty('正在读取设备…', '读取当前账号的设备和能力。')}`;
    else if (view === 'agent') content = `<header class="execution-heading"><div><h3>执行任务</h3><p>此 Agent 的任务、运行和批准记录。</p></div>${button('分配任务', 'new-task', { value: agentId, primary: true })}</header>${tasksList(snapshot, { agentId, compact: true })}`;
    else if (taskId) content = taskDetail(snapshot, taskId);
    else content = `<header class="execution-heading"><div><h2>Agent 任务</h2><p>将任务交给指定 Agent，或由产品经理规划协作流程。</p></div><div class="execution-actions">${button('刷新', 'refresh')}${button('创建任务', 'new-task', { primary: true })}</div></header>${snapshot.loaded ? tasksList(snapshot) : empty('正在读取任务…', '读取实际任务与运行状态。')}`;
    return `<section class="execution-ui" data-execution-panel>${snapshot.error ? `<div class="execution-error" role="alert">${esc(snapshot.error)} ${button('重试', 'refresh')}</div>` : ''}${content}${view === 'bindings' ? '' : `<footer class="execution-sync"><span>${icon('activity', 13)} 状态来自连接器实际回传</span><span>最近同步 ${time(snapshot.refreshedAt)}</span></footer>`}</section>`;
  }

  function optionsHtml(entries, selected, emptyLabel, label = item => item.name || item.id) {
    return `<option value="">${esc(emptyLabel)}</option>${selected && !entries.some(entry => entry.id === selected) ? `<option value="${esc(selected)}" selected>${esc(selected)}（当前配置）</option>` : ''}${entries.map(entry => `<option value="${esc(entry.id)}"${entry.id === selected ? ' selected' : ''}>${esc(label(entry))}</option>`).join('')}`;
  }
  function bindingFields(agent = {}) {
    const snapshot = current();
    const entry = device(snapshot, agent.deviceId);
    return `<fieldset class="execution-binding"><legend>默认执行分配</legend><p class="execution-note">选择已配对设备发布的环境与项目。创建任务时可以调整。</p><div class="execution-form-grid"><label>执行设备<select name="deviceId" data-execution-device>${optionsHtml(snapshot.devices.filter(item => !item.revokedAt), agent.deviceId, '暂不绑定设备', item => `${item.name} · ${item.online ? '在线' : '离线'}`)}</select></label><label>运行环境<select name="harnessId" data-execution-harness>${optionsHtml(harnesses(entry), agent.harnessId, '暂不绑定环境', item => `${item.name || item.id} · ${status(item.status)}`)}</select></label><label class="execution-wide">默认项目<select name="projectId" data-execution-project>${optionsHtml(publishedProjects(entry), agent.projectId, '暂不绑定项目')}</select></label></div>${!snapshot.devices.length ? '<p class="execution-note">先到「AI 团队 → 设备」完成配对。</p>' : ''}</fieldset>`;
  }
  function bindBinding(form) {
    form.querySelector('[data-execution-device]')?.addEventListener('change', event => {
      const entry = device(current(), event.target.value);
      form.querySelector('[data-execution-harness]').innerHTML = optionsHtml(harnesses(entry), '', '暂不绑定环境', item => `${item.name || item.id} · ${status(item.status)}`);
      form.querySelector('[data-execution-project]').innerHTML = optionsHtml(publishedProjects(entry), '', '暂不绑定项目');
    });
  }
  function newTask(initialAgentId = '') {
    const snapshot = current();
    const requestId = crypto.randomUUID();
    const initial = person(snapshot, initialAgentId);
    const formId = 'execution-new-task';
    ctx.openDrawer(`<form id="${formId}" class="execution-ui execution-form" data-discard-guard><fieldset class="execution-mode"><legend>分配方式</legend><label><input type="radio" name="mode" value="manual" checked>手动分配</label><label><input type="radio" name="mode" value="automatic">产品经理自动规划</label></fieldset><p class="execution-note" data-mode-note>指定一个 Agent，在所选设备和项目中执行任务。</p><label>任务标题<input name="title" required maxlength="160" placeholder="希望完成什么"></label><label>任务说明<textarea name="description" required rows="5" maxlength="20000" placeholder="描述目标、上下文和需要交付的结果"></textarea></label><label>验收标准（每行一条）<textarea name="acceptanceCriteria" rows="3" maxlength="8000" placeholder="例如：验证结果符合预期并提交检查记录"></textarea></label><label>负责 Agent<select name="agentId" required>${optionsHtml(snapshot.agents, initialAgentId, '选择 Agent')}</select></label><div class="execution-form-grid"><label>执行设备<select name="deviceId" data-execution-device required>${optionsHtml(snapshot.devices.filter(item => !item.revokedAt), initial?.deviceId, '选择执行设备', item => `${item.name} · ${item.online ? '在线' : '离线'}`)}</select></label><label>运行环境<select name="harnessId" data-execution-harness required></select></label><label class="execution-wide">执行项目<select name="projectId" data-execution-project required></select></label></div><p class="execution-note">项目来自设备主动发布的列表。设备须在线，Codex 须可用；自动规划的子任务沿用本次选择。</p>${!snapshot.devices.length ? '<p class="execution-error">还没有执行设备。请先到「AI 团队 → 设备」完成配对。</p>' : ''}<p class="execution-form-error" role="alert"></p></form>`, '创建 Agent 任务', '任务会发送到你选择的设备执行', `<button type="button" class="btn" data-action="close">取消</button><button type="submit" class="btn primary" form="${formId}">创建并执行</button>`);
    const form = document.getElementById(formId);
    if (!form) return;
    const agentSelect = form.elements.agentId;
    function fillDevice(agent, preserveDevice = false) {
      if (agent && !preserveDevice) form.elements.deviceId.value = agent.deviceId || '';
      const entry = device(snapshot, form.elements.deviceId.value);
      form.elements.harnessId.innerHTML = optionsHtml(harnesses(entry), agent?.harnessId || 'codex', '选择运行环境', item => `${item.name || item.id} · ${status(item.status)}`);
      form.elements.projectId.innerHTML = optionsHtml(publishedProjects(entry), agent?.projectId, '选择执行项目');
      if (!form.elements.harnessId.value && harnesses(entry).length === 1) form.elements.harnessId.value = harnesses(entry)[0].id;
      if (!form.elements.projectId.value && publishedProjects(entry).length === 1) form.elements.projectId.value = publishedProjects(entry)[0].id;
    }
    fillDevice(initial);
    form.addEventListener('change', event => {
      if (event.target.name === 'mode') {
        const automatic = form.elements.mode.value === 'automatic';
        const entries = snapshot.agents.filter(item => !automatic || item.roleId === 'product-manager');
        agentSelect.innerHTML = optionsHtml(entries, entries.some(item => item.id === agentSelect.value) ? agentSelect.value : entries.length === 1 ? entries[0].id : '', automatic ? '选择产品经理 Agent' : '选择 Agent');
        form.querySelector('[data-mode-note]').textContent = automatic ? '先由产品经理真实运行并制定计划，再按依赖逐项分派；所有子任务在所选设备和项目执行。' : '指定一个 Agent，在所选设备和项目中执行任务。';
        fillDevice(person(snapshot, agentSelect.value));
      } else if (event.target === agentSelect) fillDevice(person(snapshot, agentSelect.value));
      else if (event.target.name === 'deviceId') fillDevice(person(snapshot, agentSelect.value), true);
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = document.querySelector(`button[form="${formId}"]`);
      if (submit.disabled || current() !== snapshot) return;
      const output = form.querySelector('.execution-form-error');
      output.textContent = '';
      const values = Object.fromEntries(new FormData(form));
      const selectedDevice = device(snapshot, values.deviceId);
      const harness = harnesses(selectedDevice).find(item => item.id === values.harnessId);
      if (!selectedDevice?.online || selectedDevice.revokedAt) { output.textContent = '所选设备当前离线，请确认连接器在线后刷新设备状态。'; return; }
      if (harness?.status !== 'ready') { output.textContent = '所选运行环境尚未就绪，请在设备上完成登录和环境检查。'; return; }
      submit.disabled = true;
      try {
        const payload = await ctx.api(API + '/tasks', { method: 'POST', body: JSON.stringify({ requestId, title: values.title.trim(), description: values.description.trim(), acceptanceCriteria: values.acceptanceCriteria.split('\n').map(item => item.trim()).filter(Boolean), mode: values.mode, agentId: values.agentId, deviceId: values.deviceId, harnessId: values.harnessId, projectId: values.projectId }) });
        if (!owner(snapshot, payload)) return;
        ctx.closeDrawer();
        if (payload.task?.id) navigate(taskPath(payload.task.id));
        else void refresh(snapshot);
        ctx.toast?.('任务已创建，等待设备领取');
      } catch (error) { if (form.isConnected && current() === snapshot) output.textContent = error.message; }
      finally { submit.disabled = false; }
    });
  }
  async function mutate(snapshot, control, url, body, message) {
    if (control.disabled || !active(snapshot)) return;
    control.disabled = true;
    try {
      const payload = await ctx.api(url, { method: 'POST', body: JSON.stringify(body), signal: controller?.signal });
      if (!owner(snapshot, payload)) return;
      if (url.endsWith('/retry') && payload.task?.id) snapshot.retries.delete(payload.task.id);
      snapshot.error = '';
      ctx.toast?.(message);
      await refresh(snapshot);
    } catch (error) { if (active(snapshot)) { snapshot.error = error.message; repaint(snapshot); } }
    finally { control.disabled = false; }
  }
  function bind(root, view = 'tasks', options = {}) {
    const panel = root?.matches?.('[data-execution-panel]') ? root : root?.querySelector('[data-execution-panel]');
    if (!panel) return;
    const snapshot = current();
    const routeKey = JSON.stringify([view, options.taskId || '', options.agentId || '', options.baseRoute || 'development/tasks']);
    const changed = mounted?.key !== routeKey;
    if (changed) { stop(); snapshot.loading = false; }
    mounted = { panel, view, key: routeKey, baseRoute: options.baseRoute || 'development/tasks', ...options };
    controller ||= new AbortController();
    panel.onclick = async event => {
      const control = event.target.closest('[data-execution-action]');
      if (!control || !active(snapshot)) return;
      const { executionAction: action, executionValue: value } = control.dataset;
      if (action === 'detail') navigate(taskPath(value));
      else if (action === 'devices') navigate('ai-teams/devices');
      else if (action === 'back') navigate(mounted.baseRoute);
      else if (action === 'new-task') newTask(value);
      else if (action === 'refresh') void refresh(snapshot);
      else if (action === 'filter') { snapshot.filter = value; repaint(snapshot); }
      else if (action === 'pairing') {
        if (control.disabled) return;
        control.disabled = true;
        try {
          const result = await ctx.api(API + '/pairing-codes', { method: 'POST', body: '{}', signal: controller.signal });
          if (owner(snapshot, result)) { snapshot.pairing = result; snapshot.error = ''; repaint(snapshot); }
        } catch (error) { if (active(snapshot)) { snapshot.error = error.message; repaint(snapshot); } }
        finally { control.disabled = false; }
      } else if (action === 'cancel-task') void mutate(snapshot, control, API + '/tasks/' + encodeURIComponent(value) + '/cancel', {}, '已请求取消任务');
      else if (action === 'retry-task') {
        if (!snapshot.retries.has(value)) snapshot.retries.set(value, crypto.randomUUID());
        void mutate(snapshot, control, API + '/tasks/' + encodeURIComponent(value) + '/retry', { requestId: snapshot.retries.get(value) }, '已创建重试运行');
      } else if (action === 'revoke') {
        ctx.openDrawer(`<form id="execution-revoke" class="execution-ui"><p>撤销「${esc(device(snapshot, value)?.name || '此设备')}」的连接？设备需要重新配对才能接收任务。</p><p class="execution-form-error" role="alert"></p></form>`, '撤销设备连接', 'AI 团队 · 执行设备', '<button type="button" class="btn" data-action="close">保留连接</button><button class="btn danger" type="submit" form="execution-revoke">撤销连接</button>');
        const form = document.getElementById('execution-revoke');
        form.onsubmit = async submitEvent => {
          submitEvent.preventDefault();
          const submit = document.querySelector('button[form="execution-revoke"]');
          if (submit.disabled || current() !== snapshot) return;
          submit.disabled = true;
          try { const result = await ctx.api(API + '/devices/' + encodeURIComponent(value), { method: 'DELETE' }); if (owner(snapshot, result)) { ctx.closeDrawer(); void refresh(snapshot); } }
          catch (error) { if (form.isConnected) form.querySelector('.execution-form-error').textContent = error.message; }
          finally { submit.disabled = false; }
        };
      }
    };
    panel.oninput = event => {
      const form = event.target.closest('[data-execution-approval]');
      if (form && event.target.name === 'response' && active(snapshot)) snapshot.approvalDrafts.set(`${form.dataset.runId}:${form.dataset.executionApproval}`, event.target.value);
    };
    panel.onsubmit = async event => {
      const form = event.target.closest('[data-execution-approval]');
      if (!form || !active(snapshot)) return;
      event.preventDefault();
      const decision = event.submitter?.value;
      const key = `${form.dataset.runId}:${form.dataset.executionApproval}`;
      if (!['approve', 'deny'].includes(decision) || snapshot.pendingApprovals.has(key)) return;
      const response = form.elements.response.value.trim();
      snapshot.pendingApprovals.add(key);
      for (const control of form.querySelectorAll('button')) control.disabled = true;
      try {
        const payload = await ctx.api(`${API}/runs/${encodeURIComponent(form.dataset.runId)}/approvals/${encodeURIComponent(form.dataset.executionApproval)}`, { method: 'POST', body: JSON.stringify({ decision, ...(response ? { response } : {}) }), signal: controller.signal });
        if (!owner(snapshot, payload)) return;
        snapshot.approvalDrafts.delete(key);
        ctx.toast?.(decision === 'approve' ? '已发送批准或回复' : '已拒绝操作');
        await refresh(snapshot);
      } catch (error) { if (form.isConnected && active(snapshot)) form.querySelector('.execution-form-error').textContent = error.message; }
      finally { snapshot.pendingApprovals.delete(key); for (const control of form.querySelectorAll('button')) control.disabled = false; }
    };
    if (!snapshot.loaded || changed || (options.taskId && !snapshot.details.has(options.taskId))) void refresh(snapshot, options.taskId);
    else schedule(snapshot);
  }
  function cleanup() { stop(); mounted = undefined; state = undefined; }
  function invalidate() { const snapshot = current(); snapshot.catalogLoaded.delete('agents'); if (active(snapshot)) void refresh(snapshot); }
  return { render, bind, cleanup, bindingFields, bindBinding, agentSummary, invalidate };
}
