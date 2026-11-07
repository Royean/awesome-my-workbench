const BASE = '/api/developer-hub';
const VIEWS = [
  ['roles', '角色库', 'grid', 'ai-teams'],
  ['agents', 'Agent', 'settings', 'ai-teams/agents'],
  ['capabilities', '能力索引', 'sparkles', 'ai-teams/capabilities'],
];
const GROUPS = new Map([
  ['开发协作', 'grid'],
  ['工作协作', 'task'],
  ['生活与资产', 'heart'],
  ['内容与媒体', 'file'],
]);
const ENVIRONMENTS = ['Codex', 'Claude Code', 'ChatGPT', 'OpenClaw', '其他'];
const CAP_LIMIT = 30;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const statusLabel = status => status === 'configured' ? '已登记配置' : '待核验';
const skillsOf = record => record.skills || [];
const mcpOf = record => record.mcp || [];
const matches = (query, ...fields) => fields.join(' ').toLocaleLowerCase().includes(query);
const getView = route => VIEWS.find(view => view[0] === route.split('/')[1])?.[0] || 'roles';

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search ? url.href : '';
  } catch {
    return '';
  }
}

export function createHubTeams(ctx) {
  const { esc, icon } = ctx;
  const accountScope = () => ctx.accountScope ?? ctx.userId ?? 'local';
  const emptyState = scope => ({
    scope,
    roles: { status: 'idle', records: [], source: null },
    agents: { status: 'idle', records: [] },
    issues: { status: 'idle', records: [] },
    query: '',
    group: '',
    capability: 'role-skills',
  });
  let state;
  let mounted = null;

  function current() {
    const scope = accountScope();
    if (scope !== state?.scope) {
      state = emptyState(scope);
      mounted = null;
    }
    return state;
  }

  function repaint(snapshot) {
    if (current() === snapshot && mounted?.isConnected) ctx.render();
  }

  async function load(kind, snapshot = current()) {
    const resource = snapshot[kind];
    if (resource.status === 'loading') return;
    const retrying = resource.status === 'error';
    resource.status = 'loading';
    if (retrying) repaint(snapshot);
    try {
      const result = await ctx.api(BASE + '/' + kind);
      if (current() !== snapshot) return;
      if (result.owner != null && result.owner !== ctx.userId) {
        throw new Error('登录账号已变化，请重新加载。');
      }
      resource.records = result[kind] || [];
      resource.source = result.source;
      resource.status = 'ready';
    } catch (error) {
      if (current() !== snapshot) return;
      resource.status = 'error';
      resource.error = error.message;
    }
    repaint(snapshot);
  }

  function button(label, action, { symbol, value, classes = 'btn' } = {}) {
    return `<button type="button" class="${classes}" data-team-action="${action}"${value ? ` data-team-value="${esc(value)}"` : ''}>${symbol ? icon(symbol, 15) : ''}${esc(label)}</button>`;
  }

  function sourceLink(label, url, classes = 'hub-teams-link') {
    const href = httpsUrl(url);
    return href ? `<a class="${classes}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}${icon('arrow', 13)}</a>` : '';
  }

  function routeLink(label, path, classes = 'hub-teams-link') {
    return `<a class="${classes}" href="#${esc(path)}" data-team-action="navigate" data-team-value="${esc(path)}">${esc(label)}</a>`;
  }

  function empty(title, text, { symbol = 'grid', action = '', error = false } = {}) {
    return `<section class="hub-teams-empty${error ? ' is-error' : ''}" ${error ? 'role="alert"' : ''}>
      <span class="hub-teams-mark">${icon(symbol, 19)}</span><h2>${title}</h2><p>${text}</p>${action}
    </section>`;
  }

  function resourcePlaceholder(kind, resource) {
    const label = { roles: '角色库', agents: 'Agent 配置', issues: '关联需求' }[kind];
    if (resource.status === 'error') {
      return empty(`暂时无法加载${label}`, esc(resource.error || '请稍后再试。'), {
        symbol: 'info', error: true, action: button('重试', 'retry', { value: kind }),
      });
    }
    return `<div class="hub-teams-loading" role="status"><span></span>正在加载${label}…</div>`;
  }

  function sourceBar(source) {
    if (!source) return '';
    return `<div class="hub-teams-source">
      <span class="hub-teams-source-title">${icon('shield', 15)}${source.status === 'snapshot' ? 'GitHub 角色快照' : '角色定义来源'}</span>
      ${sourceLink(source.repo || '查看角色仓库', source.url)}
      ${source.revision ? `<code title="${esc(source.revision)}">${esc(String(source.revision).slice(0, 7))}</code>` : ''}
    </div>`;
  }

  function roleCard(role, agents, agentsReady) {
    const skills = skillsOf(role);
    const count = agents.filter(agent => agent.roleId === role.id).length;
    return `<button type="button" class="hub-teams-role" data-team-action="role" data-team-value="${esc(role.id)}">
      <span class="hub-teams-role-top"><span class="hub-teams-mark">${icon(GROUPS.get(role.group) || 'grid', 20)}</span>${icon('arrow', 15)}</span>
      <span class="hub-teams-role-title">${esc(role.name)}</span>
      <span class="hub-teams-role-desc">${esc(role.description)}</span>
      <span class="hub-teams-role-foot">
        <span>${skills.length} 项推荐 Skills</span>
        ${agentsReady ? `<span class="hub-teams-status${count ? ' is-configured' : ''}"><i></i>${count ? `已配置 ${count} 个 Agent` : '待配置 Agent'}</span>` : ''}
      </span>
    </button>`;
  }

  function roleWall(snapshot) {
    const { roles, agents, group } = snapshot;
    if (roles.status !== 'ready') return resourcePlaceholder('roles', roles);
    if (!roles.records.length) return empty('角色库为空', '角色定义同步后会显示在这里。');
    const query = snapshot.query.trim().toLocaleLowerCase();
    const filtered = roles.records.filter(role => (!group || group === role.group) &&
      matches(query, role.name, role.group, role.description, ...(role.responsibilities || []), ...skillsOf(role).map(skill => skill.name)));
    if (!filtered.length) return empty('没有匹配的角色', '试试其他关键词或分类。', { symbol: 'search' });
    const groups = [...new Set([...GROUPS.keys(), ...filtered.map(role => role.group)])];
    return groups.map(name => {
      const members = filtered.filter(role => role.group === name);
      if (!members.length) return '';
      return `<section class="hub-teams-group">
        <header><h2>${esc(name)}</h2><span>${members.length} 个角色</span></header>
        <div class="hub-teams-role-grid">${members.map(role => roleCard(role, agents.records, agents.status === 'ready')).join('')}</div>
      </section>`;
    }).join('');
  }

  function agentList(snapshot) {
    const { roles, agents } = snapshot;
    if (agents.status !== 'ready') return resourcePlaceholder('agents', agents);
    if (!agents.records.length) return empty('还没有 Agent 配置', '从一个角色开始，登记它使用的环境、Skills 和 MCP。', {
      symbol: 'settings',
      action: roles.records.length ? button('配置 Agent', 'agent-new', { symbol: 'plus', classes: 'btn primary' }) : '',
    });
    return `<div class="hub-teams-table">${agents.records.map(agent => {
      const role = roles.records.find(candidate => candidate.id === agent.roleId);
      return `<article class="hub-teams-agent">
        <span class="hub-teams-mark">${icon('settings', 18)}</span>
        <div class="hub-teams-row-name">
          <h3>${routeLink(agent.name, 'ai-teams/agents/' + agent.id, 'hub-teams-name-link')}</h3>
          <p>${esc(role?.name || agent.roleId)}<span aria-hidden="true"> · </span>${esc(agent.environment)}</p>
        </div>
        <div class="hub-teams-agent-counts"><span>${skillsOf(agent).length} Skills</span><span>${mcpOf(agent).length} MCP</span></div>
        <div class="hub-teams-row-actions">
          ${button('编辑', 'agent-edit', { value: agent.id })}
          <button class="hub-teams-icon-button" type="button" data-team-action="agent-delete" data-team-value="${esc(agent.id)}" aria-label="删除 ${esc(agent.name)} 的配置">${icon('trash', 16)}</button>
        </div>
      </article>`;
    }).join('')}</div>`;
  }

  function agentDetail(snapshot, id) {
    const { roles, agents, issues } = snapshot;
    const back = routeLink('返回 Agent 列表', 'ai-teams/agents');
    if (agents.status !== 'ready') return back + resourcePlaceholder('agents', agents);
    const agent = agents.records.find(entry => entry.id === id);
    if (!agent) return back + empty('找不到这个 Agent', '返回列表查看当前账号的 Agent 配置。', { symbol: 'settings' });
    const role = roles.records.find(entry => entry.id === agent.roleId);
    const related = issues.records.filter(issue => issue.agentIds?.includes(id));
    const capabilities = [
      ['Skills', skillsOf(agent), 'sparkles'],
      ['MCP', mcpOf(agent), 'grid'],
    ];
    return `<article class="hub-teams-agent-detail">
      ${back}
      <header>
        <div><h2>${esc(agent.name)}</h2><p>${role ? button(role.name, 'role', { value: role.id, classes: 'hub-teams-link' }) : esc(agent.roleId)} · ${esc(agent.environment)}</p></div>
        ${button('编辑配置', 'agent-edit', { value: id, symbol: 'edit' })}
      </header>
      <div class="hub-teams-agent-id"><span>Agent ID</span> <code>${esc(id)}</code></div>
      ${capabilities.map(([label, entries, symbol]) => `<section><h3>${label}</h3>${entries.length ? `<div class="hub-teams-table">${entries.map(entry => `<article class="hub-teams-capability">
        <span class="hub-teams-mark">${icon(symbol, 17)}</span><div class="hub-teams-row-name"><h3>${esc(entry.name)}</h3>${entry.scope ? `<p>${esc(entry.scope)}</p>` : ''}</div>
        <span class="hub-teams-status${entry.status === 'configured' ? ' is-configured' : ''}"><i></i>${statusLabel(entry.status)}</span>
        ${sourceLink('查看来源', entry.sourceUrl)}
      </article>`).join('')}</div>` : '<p>暂无登记。</p>'}</section>`).join('')}
      <section><h3>关联需求</h3>${issues.status !== 'ready' ? resourcePlaceholder('issues', issues) : related.length ? `<div class="hub-teams-table">${related.map(issue => `<article class="hub-teams-capability">
        <span class="hub-teams-mark">${icon('task', 17)}</span><div class="hub-teams-row-name">
          <h3>${routeLink(issue.title, 'development/issues/' + issue.id, 'hub-teams-name-link')}</h3>
          <p>${esc(issue.repository)} #${esc(issue.number)}</p>
        </div>
      </article>`).join('')}</div>` : '<p>暂无关联需求。</p>'}</section>
    </article>`;
  }

  function capabilityList(snapshot) {
    const { roles, agents, capability } = snapshot;
    if (capability === 'role-skills') {
      if (roles.status !== 'ready') return resourcePlaceholder('roles', roles);
      const recommendations = new Map();
      for (const role of roles.records) {
        for (const skill of skillsOf(role)) {
          const key = JSON.stringify([skill.name.toLocaleLowerCase(), skill.sourceUrl]);
          const row = recommendations.get(key);
          if (row) row.roles.push(role);
          else recommendations.set(key, { ...skill, roles: [role] });
        }
      }
      if (!recommendations.size) return empty('还没有推荐 Skills', '角色定义中的推荐项会列在这里。', { symbol: 'sparkles' });
      return `<div class="hub-teams-table">${[...recommendations.values()].map(skill => `<article class="hub-teams-capability">
        <span class="hub-teams-mark">${icon('sparkles', 17)}</span>
        <div class="hub-teams-row-name">
          <h3>${esc(skill.name)}</h3>
          ${skill.description ? `<p>${esc(skill.description)}</p>` : ''}
          <div class="hub-teams-role-links">${skill.roles.map(role => button(role.name, 'role', { value: role.id, classes: 'hub-teams-chip' })).join('')}</div>
        </div>
        ${skill.status === 'unverified' ? '<span class="hub-teams-status"><i></i>待核验</span>' : ''}
        ${sourceLink('查看来源', skill.sourceUrl)}
      </article>`).join('')}</div>`;
    }
    if (agents.status !== 'ready') return resourcePlaceholder('agents', agents);
    const mcp = capability === 'agent-mcp';
    const rows = agents.records.flatMap(agent => (mcp ? mcpOf(agent) : skillsOf(agent)).map(entry => ({ agent, entry })));
    if (!rows.length) return empty(`还没有登记 ${mcp ? 'MCP' : 'Skills'}`, '在 Agent 中补充配置后，可以在这里按能力查看。', {
      symbol: 'sparkles', action: button('查看 Agent', 'navigate', { value: 'ai-teams/agents' }),
    });
    return `<div class="hub-teams-table">${rows.map(({ agent, entry }) => `<article class="hub-teams-capability">
      <span class="hub-teams-mark">${icon(mcp ? 'grid' : 'sparkles', 17)}</span>
      <div class="hub-teams-row-name">
        <h3>${esc(entry.name)}</h3>
        <p>${routeLink(agent.name, 'ai-teams/agents/' + agent.id)}${mcp && entry.scope ? `<span> · ${esc(entry.scope)}</span>` : ''}</p>
      </div>
      <span class="hub-teams-status${entry.status === 'configured' ? ' is-configured' : ''}"><i></i>${statusLabel(entry.status)}</span>
      ${!mcp ? sourceLink('查看来源', entry.sourceUrl) : ''}
    </article>`).join('')}</div>`;
  }

  function render(route) {
    const snapshot = current();
    const { roles, agents, query, group, capability } = snapshot;
    const view = getView(route);
    const agentId = view === 'agents' && route.split('/')[2];
    const addAgent = roles.records.length && agents.status === 'ready' ? button('配置 Agent', 'agent-new', { symbol: 'plus', classes: 'btn primary' }) : '';
    const groups = [...new Set(roles.records.map(role => role.group))];
    return `<section class="hub-teams" data-hub-teams>
      <header class="hub-page-heading hub-teams-heading">
        <div><h1>AI 团队</h1><p>浏览团队角色，管理 Agent 的实际配置与能力。</p></div>
        ${view === 'agents' && !agentId && agents.records.length ? addAgent : ''}
      </header>
      <nav class="hub-teams-tabs" aria-label="AI 团队视图">
        ${VIEWS.map(([key, label, symbol, path]) => `<a href="#${path}" data-team-action="navigate" data-team-value="${path}" ${key === view ? 'aria-current="page"' : ''}>${icon(symbol, 16)}${label}</a>`).join('')}
      </nav>
      ${view === 'roles' ? `
        ${sourceBar(roles.source)}
        ${roles.records.length ? `<div class="hub-teams-tools">
          <label class="hub-teams-search">${icon('search', 17)}<input type="search" value="${esc(query)}" placeholder="搜索角色、职责或 Skill" aria-label="搜索角色、职责或 Skill" data-teams-search></label>
          <select class="hub-teams-select" aria-label="筛选角色分类" data-teams-group><option value="">全部分类</option>${groups.map(name => `<option value="${esc(name)}"${name === group ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select>
          <span class="hub-teams-total">${roles.records.length} 个角色</span>
        </div>` : ''}
        <div data-teams-results>${roleWall(snapshot)}</div>
      ` : view === 'agents' ? `
        <p class="hub-teams-note">${icon('info', 16)}这里登记已经选用的角色、运行环境和能力。实际运行与权限由对应的 Agent 环境管理。</p>
        ${roles.status === 'error' ? resourcePlaceholder('roles', roles) : ''}
        ${agentId ? agentDetail(snapshot, agentId) : agentList(snapshot)}
      ` : `
        <div class="hub-teams-tools hub-teams-cap-tools" role="group" aria-label="能力类型">
          ${[['role-skills', '角色推荐 Skills'], ['agent-skills', 'Agent Skills'], ['agent-mcp', 'Agent MCP']].map(([key, label]) => `<button type="button" class="hub-teams-chip" aria-pressed="${capability === key}" data-team-action="capability" data-team-value="${key}">${label}</button>`).join('')}
        </div>
        <p class="hub-teams-note">${icon('info', 16)}${capability === 'role-skills' ? '角色定义中的推荐项。实际使用情况可在 Agent Skills 中查看。' : '能力状态来自手工登记。连接和权限在对应的 Agent 环境中核验。'}</p>
        <div data-teams-cap-results>${capabilityList(snapshot)}</div>
      `}
    </section>`;
  }

  function showRole(id) {
    const { roles, agents } = current();
    const role = roles.records.find(entry => entry.id === id);
    if (!role) return;
    const skills = skillsOf(role);
    const assigned = agents.records.filter(agent => agent.roleId === role.id);
    const source = sourceLink('打开 GitHub 定义', role.sourceUrl, 'btn hub-teams-link');
    ctx.openDrawer(`<div class="hub-teams-detail" id="hub-teams-role-detail">
      <p class="hub-teams-detail-desc">${esc(role.description)}</p>
      ${role.responsibilities?.length ? `<section><h3>主要职责</h3><ul>${role.responsibilities.map(item => `<li>${esc(item)}</li>`).join('')}</ul></section>` : ''}
      <section><h3>推荐 Skills</h3>${skills.length ? `<ul class="hub-teams-detail-list">${skills.map(skill => `<li><strong>${esc(skill.name)}</strong>${skill.description ? `<small>${esc(skill.description)}</small>` : ''}${skill.status === 'unverified' ? '<span class="hub-teams-status"><i></i>待核验</span>' : ''}${sourceLink('查看来源', skill.sourceUrl)}</li>`).join('')}</ul>` : '<p>暂无推荐 Skills。</p>'}</section>
      <section><h3>关联的 Agent</h3>${agents.status === 'ready' ? (assigned.length ? `<div class="hub-teams-role-links">${assigned.map(agent => routeLink(agent.name, 'ai-teams/agents/' + agent.id, 'hub-teams-chip')).join('')}</div>` : '<p>还没有为这个角色配置 Agent。</p>') : '<p>Agent 配置暂未加载。</p>'}</section>
    </div>`, esc(role.name), `${esc(role.group)} · 角色定义`, source + (agents.status === 'ready' ?
      button('配置 Agent', 'agent-new', { value: role.id, symbol: 'plus', classes: 'btn primary' }) : ''));
    document.getElementById('hub-teams-role-detail')?.closest('[role="dialog"]')?.addEventListener('click', event => {
      const control = event.target.closest('[data-team-action]');
      if (!control) return;
      if (control.dataset.teamAction === 'navigate') {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        ctx.navigate(control.dataset.teamValue);
      } else {
        ctx.closeDrawer();
        showAgentForm(null, role.id);
      }
    });
  }

  function entryFields(kind, entry = {}) {
    const skill = kind === 'skills';
    return `<div class="hub-teams-entry" data-team-entry>
      <label><span>名称</span><input name="${kind}Name" data-entry-name value="${esc(entry.name)}" maxlength="100" required></label>
      ${skill
        ? `<label><span>文档链接（可选）</span><input name="skillSource" type="url" data-entry-extra value="${esc(entry.sourceUrl)}" maxlength="400" placeholder="https://"></label>`
        : `<label><span>权限范围（可选）</span><input name="mcpScope" data-entry-extra value="${esc(entry.scope)}" maxlength="160" placeholder="例如：只读"></label>`}
      <label><span>状态</span><select name="${kind}Status" data-entry-status><option value="unverified">待核验</option><option value="configured"${entry.status === 'configured' ? ' selected' : ''}>已登记配置</option></select></label>
      <button type="button" class="hub-teams-icon-button" data-entry-remove aria-label="移除此项 ${skill ? 'Skill' : 'MCP'}">${icon('trash', 16)}</button>
    </div>`;
  }

  function entrySection(kind, label, entries) {
    return `<fieldset class="hub-teams-entry-section" data-team-kind="${kind}">
      <legend>${label}</legend>
      <div data-team-entries>${entries.map(entry => entryFields(kind, entry)).join('')}</div>
      <button type="button" class="btn" data-entry-add${entries.length >= CAP_LIMIT ? ' disabled' : ''}>${icon('plus', 15)}添加 ${label}</button>
    </fieldset>`;
  }

  function entryData(form, kind) {
    return [...form.querySelectorAll(`[data-team-kind="${kind}"] [data-team-entry]`)].map(row => {
      const input = row.querySelector('[data-entry-name]');
      const name = input.value.trim();
      if (!name) {
        input.focus();
        throw new Error('请填写能力名称。');
      }
      const status = row.querySelector('[data-entry-status]').value;
      const extraInput = row.querySelector('[data-entry-extra]');
      const extra = extraInput.value.trim();
      if (!extra) return { name, status };
      if (kind === 'mcp') return { name, status, scope: extra };
      const sourceUrl = httpsUrl(extra);
      if (!sourceUrl) {
        extraInput.focus();
        throw new Error('请填写不含查询参数或登录信息的 HTTPS 文档链接。');
      }
      return { name, status, sourceUrl };
    });
  }

  function showAgentForm(agent, initialRoleId) {
    const snapshot = current();
    const choices = snapshot.roles.records;
    const roleId = agent?.roleId || initialRoleId;
    const existingRole = roleId && !choices.some(role => role.id === roleId);
    if (!choices.length && !existingRole) return;
    const environments = [...new Set([...ENVIRONMENTS, ...(agent?.environment ? [agent.environment] : [])])];
    // A single ID per draft also makes a save retry safe if the connection drops.
    const id = agent?.id || crypto.randomUUID();
    ctx.openDrawer(`<form class="hub-teams-form" id="hub-teams-agent-form" data-discard-guard>
      <div class="field"><label for="hub-teams-agent-role">角色</label>
        <select id="hub-teams-agent-role" name="roleId" required>
          <option value=""${roleId ? '' : ' selected'} disabled>选择角色</option>
          ${existingRole ? `<option value="${esc(roleId)}" selected>${esc(roleId)}</option>` : ''}
          ${choices.map(role => `<option value="${esc(role.id)}"${role.id === roleId ? ' selected' : ''}>${esc(role.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label for="hub-teams-agent-name">Agent 名称</label><input id="hub-teams-agent-name" name="name" maxlength="80" required value="${esc(agent?.name)}"></div>
      <div class="field"><label for="hub-teams-agent-environment">运行环境</label><select id="hub-teams-agent-environment" name="environment" required>
        <option value=""${agent?.environment ? '' : ' selected'} disabled>选择环境</option>
        ${environments.map(environment => `<option value="${esc(environment)}"${environment === agent?.environment ? ' selected' : ''}>${esc(environment)}</option>`).join('')}
      </select></div>
      <p class="hub-teams-form-note">填写已选用的 Skills 和 MCP，可将尚未核实的项目标记为「待核验」。</p>
      ${entrySection('skills', 'Skills', agent ? skillsOf(agent) : [])}
      ${entrySection('mcp', 'MCP', agent ? mcpOf(agent) : [])}
      <p class="hub-teams-form-error" role="alert" data-team-form-error></p>
    </form>`, agent ? '编辑 Agent' : '配置 Agent', 'AI 团队 · 我的配置',
    '<button type="button" class="btn" data-action="close">取消</button><button type="submit" class="btn primary" form="hub-teams-agent-form">保存配置</button>');
    const form = document.getElementById('hub-teams-agent-form');
    if (!form) return;
    form.addEventListener('click', event => {
      const action = event.target.closest('[data-entry-add], [data-entry-remove]');
      if (!action) return;
      const section = action.closest('[data-team-kind]');
      const entries = section.querySelector('[data-team-entries]');
      const add = section.querySelector('[data-entry-add]');
      if (action === add) {
        entries.insertAdjacentHTML('beforeend', entryFields(section.dataset.teamKind));
        entries.lastElementChild.querySelector('[data-entry-name]').focus();
      } else {
        action.closest('[data-team-entry]').remove();
        (entries.lastElementChild?.querySelector('[data-entry-name]') || add).focus();
      }
      add.disabled = entries.childElementCount >= CAP_LIMIT;
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      mutate(form, snapshot, async () => {
        const { roleId: selectedRole, name, environment } = Object.fromEntries(new FormData(form));
        if (!name.trim()) throw new Error('请填写 Agent 名称。');
        const data = { roleId: selectedRole, name: name.trim(), environment, skills: entryData(form, 'skills'), mcp: entryData(form, 'mcp') };
        const { agent: saved } = await ctx.api(BASE + '/agents/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(data) });
        if (current() !== snapshot) return;
        const records = snapshot.agents.records;
        snapshot.agents.records = records.some(item => item.id === id) ? records.map(item => item.id === id ? saved : item) : [saved, ...records];
      }, '已保存 Agent 配置');
    });
  }

  async function mutate(form, snapshot, action, message) {
    if (current() !== snapshot) return;
    const submit = document.querySelector(`button[form="${form.id}"]`);
    if (submit?.disabled) return;
    const output = form.querySelector('[data-team-form-error]');
    output.textContent = '';
    if (submit) submit.disabled = true;
    try {
      await action();
      if (current() !== snapshot) return;
      if (form.isConnected) ctx.closeDrawer();
      repaint(snapshot);
      ctx.toast?.(message);
    } catch (error) {
      if (form.isConnected && current() === snapshot) output.textContent = error.message;
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function confirmDelete(id) {
    const snapshot = current();
    const agent = snapshot.agents.records.find(entry => entry.id === id);
    if (!agent) return;
    ctx.openDrawer(`<form class="hub-teams-form" id="hub-teams-delete-form">
      <p class="hub-teams-form-note">删除「${esc(agent.name)}」的登记配置？</p>
      <p class="hub-teams-form-error" role="alert" data-team-form-error></p>
    </form>`, '删除 Agent 配置', 'AI 团队 · 我的配置',
    '<button type="button" class="btn" data-action="close">取消</button><button type="submit" class="btn danger" form="hub-teams-delete-form">删除配置</button>');
    const form = document.getElementById('hub-teams-delete-form');
    form?.addEventListener('submit', event => {
      event.preventDefault();
      mutate(form, snapshot, async () => {
        await ctx.api(BASE + '/agents/' + encodeURIComponent(id), { method: 'DELETE' });
        if (current() === snapshot) snapshot.agents.records = snapshot.agents.records.filter(entry => entry.id !== id);
      }, '已删除 Agent 配置');
    });
  }

  function bind(root, route) {
    const section = root?.matches?.('[data-hub-teams]') ? root : root?.querySelector('[data-hub-teams]');
    if (!section || section === mounted) return;
    const snapshot = current();
    mounted = section;

    section.addEventListener('click', event => {
      const control = event.target.closest('[data-team-action]');
      if (!control || current() !== snapshot) return;
      const { teamAction: action, teamValue: value } = control.dataset;
      if (action === 'navigate') {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        ctx.navigate(value);
      }
      if (action === 'retry') void load(value, snapshot);
      if (action === 'role') showRole(value);
      if (action === 'agent-new') showAgentForm(null, value);
      if (action === 'agent-edit') {
        const agent = snapshot.agents.records.find(entry => entry.id === value);
        if (agent) showAgentForm(agent);
      }
      if (action === 'agent-delete') confirmDelete(value);
      if (action === 'capability') {
        snapshot.capability = value;
        for (const choice of section.querySelectorAll('[data-team-action="capability"]')) {
          choice.setAttribute('aria-pressed', String(choice === control));
        }
        section.querySelector('[data-teams-cap-results]').innerHTML = capabilityList(snapshot);
        section.querySelector('.hub-teams-note').lastChild.textContent = value === 'role-skills'
          ? '角色定义中的推荐项。实际使用情况可在 Agent Skills 中查看。'
          : '能力状态来自手工登记。连接和权限在对应的 Agent 环境中核验。';
      }
    });
    const results = section.querySelector('[data-teams-results]');
    section.querySelector('[data-teams-search]')?.addEventListener('input', event => {
      snapshot.query = event.target.value;
      results.innerHTML = roleWall(snapshot);
    });
    section.querySelector('[data-teams-group]')?.addEventListener('change', event => {
      snapshot.group = event.target.value;
      results.innerHTML = roleWall(snapshot);
    });
    const kinds = ['roles', 'agents'];
    if (getView(route) === 'agents' && UUID.test(route.split('/')[2])) kinds.push('issues');
    for (const kind of kinds) {
      if (snapshot[kind].status === 'idle') void load(kind, snapshot);
    }
  }

  function cleanup() {
    mounted = null;
    state = undefined;
  }

  function invalidateIssues() {
    const snapshot = current();
    snapshot.issues = { status: 'idle', records: [] };
    repaint(snapshot);
  }

  return { render, bind, cleanup, invalidateIssues };
}
