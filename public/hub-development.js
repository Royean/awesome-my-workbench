const API = '/api/developer-hub/issues';
const ROUTE = 'development';
const DETAIL = /^development\/issues\/([0-9a-f-]{36})$/i;
const CATEGORIES = [
  { id: 'mine', label: '待我处理', icon: 'task', hint: '指派给我的开放需求', matches: issue => issue.needsMe },
  { id: 'blocked', label: '阻塞', icon: 'info', hint: 'Issue 已标记阻塞', matches: issue => issue.blocked },
  { id: 'progress', label: '推进中', icon: 'activity', hint: '有阶段记录或在途 PR', matches: issue => issue.isInProgress },
  { id: 'delivered', label: '已交付', icon: 'check', hint: '有交付或发布记录', matches: issue => issue.isDelivered }
];
const FILTERS = [
  { id: 'all', label: '全部状态' }, ...CATEGORIES, { id: 'open', label: 'Issue 开放', matches: issue => issue.state === 'open' },
  { id: 'closed', label: 'Issue 已关闭', matches: issue => issue.state === 'closed' }
];
const PULL_STATES = { open: '开放', draft: '草稿', merged: '已合并', closed: '已关闭', unknown: '状态不可用' };
const CHECK_STATES = {
  success: '通过', failure: '失败', error: '错误', pending: '进行中', cancelled: '取消', timed_out: '超时',
  action_required: '待处理', stale: '过期', startup_failure: '启动失败', skipped: '跳过', neutral: '中性',
  unknown: '未知'
};
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const updatedFirst = (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') || (b.syncedAt || '').localeCompare(a.syncedAt || '');

export function createHubDevelopment(ctx) {
  const { esc, icon } = ctx;
  let state;
  let mounted;
  function current() {
    const scope = ctx.accountScope ?? ctx.userId ?? 'local';
    if (state?.scope !== scope) {
      state = {
        scope, issues: [], github: {}, loaded: false, loading: false, loadError: '', repository: '', status: 'all',
        query: '', syncing: new Set(), issueErrors: new Map()
      };
    }
    return state;
  }

  function button(text, action, iconName, cls = 'btn', extra = '') {
    return `<button type="button" class="${cls}" data-dev-action="${action}" ${extra}>${iconName ? icon(iconName, 15) : ''}${text}</button>`;
  }
  function link(text, value, cls = '') {
    let url;
    try { url = new URL(value); } catch { return ''; }
    if (url.origin !== 'https://github.com' || url.username || url.password) return '';
    return `<a class="${cls}" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(text)}${icon('arrow', 13)}</a>`;
  }
  function timestamp(value, fallback = '—') {
    if (!value || !Number.isFinite(Date.parse(value))) return esc(fallback);
    return `<time datetime="${esc(value)}">${esc(timeFormat.format(new Date(value)))}</time>`;
  }
  function badge(text, tone = '') {
    return `<span class="dev-badge ${tone}">${esc(text)}</span>`;
  }
  function labelForIssue(issue) {
    if (issue.blocked) return ['阻塞', 'is-blocked'];
    if (issue.isDelivered) return [['已交付', '已发布', '已上线'].includes(issue.stage) ? issue.stage : '有交付记录', 'is-delivered'];
    if (issue.state === 'closed') return [issue.stage || '已关闭', ''];
    return [issue.stage || '待明确', issue.isInProgress ? 'is-progress' : ''];
  }
  function issueRows(data) {
    const filter = FILTERS.find(option => option.id === data.status);
    const q = data.query.trim().toLowerCase();
    const issues = data.issues
      .filter(issue => !filter?.matches || filter.matches(issue))
      .filter(issue => !data.repository || issue.repository === data.repository)
      .filter(issue => !q || [issue.title, issue.repository, `#${issue.number}`, String(issue.number), issue.assignee, issue.stage, ...(issue.labels || [])]
        .some(value => String(value || '').toLowerCase().includes(q)));
    if (!issues.length) {
      return `<div class="dev-empty"><span class="dev-empty-icon">${icon('search', 24)}</span><h3>没有符合条件的需求</h3><p>试试其他关键词，或清除筛选。</p>${button('清除筛选', 'reset', '', 'btn')}</div>`;
    }
    return `<ul class="dev-issues" aria-label="已跟踪的需求">${issues.map(issue => {
      const [label, tone] = labelForIssue(issue);
      return `<li><button class="dev-issue-row" type="button" data-dev-action="detail" data-id="${esc(issue.id)}">
        <span class="dev-issue-icon">${icon('task', 18)}</span>
        <span class="dev-issue-main">
          <span class="dev-issue-ref">${esc(issue.repository)} <span>#${esc(issue.number)}</span></span>
          <strong>${esc(issue.title || '未命名 Issue')}</strong>
          ${issue.nextStep ? `<span class="dev-issue-next"><b>下一步</b> ${esc(issue.nextStep)}</span>` : ''}
        </span>
        <span class="dev-issue-status">${badge(label, tone)}${issue.priority ? badge(issue.priority) : ''}</span>
        <span class="dev-issue-owner">${issue.assignee ? esc(issue.assignee) : '—'}</span>
        <span class="dev-issue-time">${timestamp(issue.updatedAt)}</span>
        ${icon('arrow', 16)}
      </button></li>`;
    }).join('')}</ul>`;
  }

  function categoryCards(data) {
    return `<div class="dev-metrics" aria-label="需求概览">${CATEGORIES.map(category => {
      const count = data.loaded ? data.issues.filter(category.matches).length : '—';
      const hint = category.id === 'mine' && !data.github.viewerLogin ? 'Issue 明确标记待我处理' : category.hint;
      return `<button class="dev-metric dev-metric-${category.id}" type="button" data-dev-action="category" data-id="${category.id}" aria-pressed="${data.status === category.id}" ${data.issues.length ? '' : 'disabled'}>
        <span class="dev-metric-top"><span class="dev-metric-icon">${icon(category.icon, 17)}</span><span>${category.label}</span></span>
        <strong>${count}</strong><small>${hint}</small>
      </button>`;
    }).join('')}</div>`;
  }

  function connection(data) {
    if (!data.loaded) return '';
    const github = data.github;
    return `<div class="dev-connection"><span class="dev-connection-dot ${github.authenticated ? 'is-connected' : ''}"></span><span>${github.authenticated ? '已配置 GitHub 凭据' : 'GitHub 公开读取'}${github.viewerLogin ? ' · @' + esc(github.viewerLogin) : ''}</span></div>`;
  }
  function loadState(data) {
    if (data.loadError) return `<div class="dev-empty" role="alert"><span class="dev-empty-icon">${icon('info', 24)}</span><h3>需求列表暂时无法读取</h3><p>${esc(data.loadError)}</p>${button('重新加载', 'reload', '', 'btn')}</div>`;
    return '<div class="dev-empty" role="status" aria-live="polite">正在读取已跟踪的需求…</div>';
  }

  function list(data) {
    const repos = [...new Set(data.issues.map(issue => issue.repository))].filter(Boolean).sort((a, b) => a.localeCompare(b));
    const noIssues = `<div class="dev-empty"><span class="dev-empty-icon">${icon('task', 25)}</span><h3>还没有跟踪的需求</h3>
      <p>添加一个 GitHub Issue 链接，在这里查看需求阶段、后续行动和交付记录。${data.github.authenticated ? '' : ' 私有仓库需要先配置 GitHub 连接。'}</p>
      ${button('添加 GitHub Issue', 'add', 'plus', 'btn primary')}</div>`;
    return `<header class="dev-header">
      <div><h1>需求总览</h1><p>跟踪 GitHub 需求、阻塞和交付进展。</p></div>
      <div class="dev-actions">${button('添加 Issue', 'add', 'plus', 'btn primary', data.loading ? 'disabled' : '')}</div>
    </header>
    ${categoryCards(data)}
    <section class="dev-surface dev-list" aria-labelledby="dev-list-title">
      <header class="dev-surface-head"><div><h2 id="dev-list-title">需求列表${data.loaded ? `<span class="dev-count">${data.issues.length}</span>` : ''}</h2><p>按 GitHub Issue 更新时间排列</p></div>${connection(data)}</header>
      ${data.issues.length ? `<div class="dev-filters">
        <label class="dev-search">${icon('search', 16)}<input type="search" data-dev-field="query" value="${esc(data.query)}" maxlength="160" placeholder="搜索标题、仓库或编号" aria-label="搜索需求"></label>
        <select data-dev-field="repository" aria-label="按仓库筛选"><option value="">全部仓库</option>${repos.map(repo => `<option value="${esc(repo)}" ${repo === data.repository ? 'selected' : ''}>${esc(repo)}</option>`).join('')}</select>
        <select data-dev-field="status" aria-label="按状态筛选">${FILTERS.map(filter => `<option value="${filter.id}" ${filter.id === data.status ? 'selected' : ''}>${filter.label}</option>`).join('')}</select>
      </div>
      <div class="dev-list-columns" aria-hidden="true"><span>需求</span><span>阶段 / 优先级</span><span>负责人</span><span>GitHub 更新</span><span></span></div>` : ''}
      <div data-dev-results aria-live="polite">${data.issues.length ? issueRows(data) : data.loaded ? noIssues : loadState(data)}</div>
    </section>
    <footer class="dev-footer"><span>${icon('info', 14)} 需求状态来自已同步的 GitHub Issue 和关联记录。</span>${button('查看团队角色', 'teams', 'arrow', 'dev-text-button')}</footer>`;
  }

  function facts(issue) {
    return `<dl class="dev-facts">${[
      ['Issue 状态', issue.state === 'open' ? '开放' : issue.stateReason === 'not_planned' ? '已关闭 · 不计划处理' : issue.stateReason === 'duplicate' ? '已关闭 · 重复' : '已关闭'],
      ['阶段', issue.stage || '待明确', issue.stageSource],
      ['优先级', issue.priority || '未注明'], ['负责人', issue.assignee || '未指派']
    ].map(([key, value, source]) => `<div><dt>${key}</dt><dd>${esc(value)}${source ? `<small>来自 ${esc(source)}</small>` : ''}</dd></div>`).join('')}</dl>
    ${issue.nextStep || issue.blockedReason ? `<dl class="dev-next-steps">
      ${issue.nextStep ? `<div><dt>下一步</dt><dd>${esc(issue.nextStep)}</dd></div>` : ''}
      ${issue.blockedReason ? `<div class="dev-blocker"><dt>阻塞</dt><dd>${esc(issue.blockedReason)}</dd></div>` : ''}
    </dl>` : ''}
    ${issue.labels?.length ? `<div class="dev-labels" aria-label="Issue 标签">${issue.labels.map(label => badge(label)).join('')}</div>` : ''}`;
  }

  function related(issue) {
    const components = (issue.componentIds || []).filter(id => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id));
    const agents = (issue.agentIds || []).filter(id => /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(id));
    if (!components.length && !agents.length) return '';
    return `<section class="dev-evidence-section"><h3>相关组件与 Agent</h3><div class="dev-related">
      ${components.map(id => button(`组件 ${esc(id)}`, 'related-component', 'arrow', 'dev-text-button', `data-id="${esc(id)}"`)).join('')}
      ${agents.map(id => button(`Agent ${esc(id.slice(0, 8))}`, 'related-agent', 'arrow', 'dev-text-button', `data-id="${esc(id)}"`)).join('')}
    </div></section>`;
  }

  function checkTone(value) {
    if (value === 'success') return 'is-delivered';
    if (['failure', 'error', 'timed_out', 'startup_failure'].includes(value)) return 'is-blocked';
    return value === 'pending' ? 'is-progress' : '';
  }
  function pullRows(pulls) {
    if (!pulls.length) return '<p class="dev-evidence-empty">已读取的记录中没有关联 PR。</p>';
    return `<ul class="dev-evidence-list">${pulls.map(pr => `<li class="dev-pr">
      <div class="dev-pr-heading"><div>${link(pr.title || `PR #${pr.number}`, pr.url, 'dev-source-link')}<p>${esc(pr.repository)} #${esc(pr.number)} · ${link(pr.source, pr.sourceUrl, 'dev-inline-link')}</p></div>
        ${badge(PULL_STATES[pr.state] || '状态不可用', pr.state === 'merged' ? 'is-delivered' : pr.state === 'open' ? 'is-progress' : '')}
      </div>
      ${pr.checks ? `<div class="dev-ci">
        <div class="dev-ci-title"><span>提交 <code>${esc(pr.checks.sha.slice(0, 12))}</code> 的检查</span>${link('查看提交', pr.checks.url, 'dev-inline-link')}</div>
        ${pr.checks.values.length ? `<ul class="dev-checks">${pr.checks.values.map(check => `<li>
          <span>${check.url ? link(check.name, check.url, 'dev-inline-link') : esc(check.name)}</span>
          ${badge(CHECK_STATES[check.state] || '未知', checkTone(check.state))}
        </li>`).join('')}</ul>` : `<p class="dev-evidence-empty">${pr.checks.incomplete ? '检查记录暂时无法完整读取。' : '这个提交暂无可见的检查记录。'}</p>`}
        ${pr.checks.incomplete && pr.checks.values.length ? '<p class="dev-evidence-empty">当前只显示能读取的部分检查。</p>' : ''}
      </div>` : '<p class="dev-evidence-empty">对应提交的检查暂时不可用。</p>'}
    </li>`).join('')}</ul>`;
  }
  function issueEvidence(records, empty) {
    if (!records.length) return `<p class="dev-evidence-empty">${empty}</p>`;
    return `<ul class="dev-evidence-list">${records.map(record => `<li class="dev-evidence-note"><p>${esc(record.text)}</p>
      <small>${link(record.source, record.url, 'dev-inline-link')}${record.author ? ' · @' + esc(record.author) : ''}</small>
    </li>`).join('')}</ul>`;
  }
  function detail(data, id) {
    const issue = data.issues.find(item => item.id === id);
    const back = button('返回需求总览', 'back', '', 'dev-text-button dev-back');
    if (!issue) return `${back}<section class="dev-surface">${data.loaded
      ? '<div class="dev-empty"><h1>找不到这个需求</h1><p>返回需求总览，查看当前账号跟踪的 Issue。</p></div>' : loadState(data)}</section>`;
    const [label, tone] = labelForIssue(issue);
    const evidence = issue.evidence || {};
    const incomplete = !evidence.sourceAvailable?.timeline || !evidence.sourceAvailable?.comments || evidence.truncated;
    const syncing = data.syncing.has(issue.id);
    const error = data.issueErrors.get(issue.id);
    return `${back}<header class="dev-header dev-detail-head">
      <div><p class="dev-kicker">${esc(issue.repository)} · Issue #${esc(issue.number)} ${badge(label, tone)}</p><h1>${esc(issue.title || '未命名 Issue')}</h1></div>
      <div class="dev-actions">${link('在 GitHub 打开', issue.url, 'btn dev-external')}${button(syncing ? '正在同步…' : '同步 GitHub', 'sync', 'activity', 'btn', syncing ? 'disabled aria-busy="true"' : '')}</div>
    </header>
    ${error ? `<div class="dev-error" role="alert">同步失败，保留上次记录。${esc(error)}</div>` : ''}
    <div class="dev-detail-grid">
      <section class="dev-surface">
        <header class="dev-surface-head"><h2>需求信息</h2></header>
        <div class="dev-detail-content">${facts(issue)}
          <h3>Issue 正文</h3>${issue.body ? `<div class="dev-body">${esc(issue.body)}</div>` : '<p class="dev-evidence-empty">Issue 没有填写正文。</p>'}
        </div>
      </section>
      <section class="dev-surface">
        <header class="dev-surface-head"><h2>进展与交付依据</h2></header>
        <div class="dev-detail-content">
          ${incomplete ? '<p class="dev-data-note" role="status">部分 GitHub 记录超出同步范围或当前权限，打开 Issue 可查看来源。</p>' : ''}
          <section class="dev-evidence-section"><h3>关联 PR 与检查</h3>${pullRows(evidence.pullRequests || [])}</section>
          <section class="dev-evidence-section"><h3>验收记录</h3>${issueEvidence(evidence.acceptance || [], '暂无可引用的仓库协作者验收记录。')}</section>
          <section class="dev-evidence-section"><h3>发布与交付记录</h3>${issueEvidence(evidence.delivery || [], '暂无可引用的仓库协作者发布或交付记录。')}</section>
          ${related(issue)}
        </div>
      </section>
    </div>
    <footer class="dev-footer dev-detail-footer"><span>GitHub 更新 ${timestamp(issue.updatedAt)} · 同步 ${timestamp(issue.syncedAt)}</span>${button('停止跟踪', 'remove', 'trash', 'dev-text-button dev-remove', syncing ? 'disabled' : '')}</footer>`;
  }

  function render(route = ROUTE) {
    const data = current();
    const id = DETAIL.exec(route)?.[1];
    return `<div class="dev-hub" data-dev-hub>${id ? detail(data, id) : list(data)}</div>`;
  }

  function rerender(data) {
    if (current() === data && mounted?.panel.isConnected) ctx.render();
  }

  function ownerMatches(data, payload) {
    return current() === data && (!ctx.userId || !payload?.owner || payload.owner === ctx.userId);
  }

  async function load(data) {
    if (data.loading) return;
    data.loading = true;
    data.loadError = '';
    try {
      const payload = await ctx.api(API);
      if (!ownerMatches(data, payload)) return;
      if (!Array.isArray(payload.issues)) throw new Error('需求列表暂时不可用。');
      data.issues = [...payload.issues].sort(updatedFirst);
      data.github = payload.github || {};
      data.loaded = true;
      if (data.repository && !data.issues.some(issue => issue.repository === data.repository)) data.repository = '';
    } catch (error) {
      if (current() === data) data.loadError = error.message || '请稍后重试。';
    } finally {
      data.loading = false;
      rerender(data);
    }
  }

  function updateIssue(data, issue) {
    if (!issue?.id) throw new Error('未收到有效的同步结果，请重新加载需求列表。');
    data.issues = [...data.issues.filter(item => item.id !== issue.id), issue].sort(updatedFirst);
    ctx.onIssuesChanged?.();
  }

  async function sync(data, issue) {
    if (data.syncing.has(issue.id)) return;
    data.syncing.add(issue.id);
    data.issueErrors.delete(issue.id);
    rerender(data);
    try {
      const result = await ctx.api(`${API}/${encodeURIComponent(issue.id)}/refresh`, { method: 'POST' });
      if (ownerMatches(data, result)) updateIssue(data, result.issue);
    } catch (error) {
      if (current() === data) data.issueErrors.set(issue.id, error.message || '请稍后重试。');
    } finally {
      data.syncing.delete(issue.id);
      rerender(data);
    }
  }

  function drawerForm(data, config, submit) {
    const { id, title, subtitle, content, buttonLabel, dangerous } = config;
    ctx.openDrawer(`<form id="${id}" class="dev-drawer-form">${content}<p data-dev-form-error class="dev-form-error" role="alert"></p></form>`,
      title, subtitle,
      `<button type="button" class="btn" data-action="close">取消</button><button class="btn ${dangerous ? 'danger' : 'primary'}" type="submit" form="${id}">${buttonLabel}</button>`);
    const form = document.getElementById(id);
    const button = document.querySelector(`button[form="${id}"]`);
    if (!form || !button) return;
    form.onsubmit = async event => {
      event.preventDefault();
      if (!form.isConnected || current() !== data || button.disabled) return;
      const errorLine = form.querySelector('[data-dev-form-error]');
      errorLine.textContent = '';
      const values = new FormData(form);
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = dangerous ? '正在移除…' : '正在读取…';
      try {
        const destination = await submit(values);
        if (current() !== data) return;
        if (form.isConnected && destination) {
          ctx.closeDrawer();
          ctx.navigate(destination);
        } else {
          rerender(data);
        }
      } catch (error) {
        if (form.isConnected && current() === data) {
          errorLine.textContent = error.message || '操作暂时无法完成，请稍后重试。';
          const field = form.elements.url;
          if (field && error.status === 400) {
            field.setAttribute('aria-invalid', 'true');
            field.focus();
          }
        }
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = buttonLabel;
      }
    };
    form.elements.url?.addEventListener('input', () => {
      form.elements.url.removeAttribute('aria-invalid');
      form.querySelector('[data-dev-form-error]').textContent = '';
    });
  }

  function add(data) {
    drawerForm(data, {
      id: 'dev-track-form', title: '跟踪 GitHub Issue', subtitle: '将需要关注的 Issue 添加到开发工作台', buttonLabel: '读取并添加',
      content: `<div class="field"><label for="dev-track-url">GitHub Issue 链接</label>
        <input id="dev-track-url" name="url" type="url" required maxlength="1200" inputmode="url" autocomplete="off" spellcheck="false"
          placeholder="https://github.com/owner/repo/issues/123" aria-describedby="dev-track-hint">
        <small id="dev-track-hint">${data.github.authenticated ? '当前连接仅能读取有权限访问的仓库。' : '当前可读取公开仓库。私有仓库需要配置 GitHub 连接。'}</small>
      </div>`
    }, async values => {
      const result = await ctx.api(API, { method: 'POST', body: JSON.stringify({ url: String(values.get('url') || '').trim() }) });
      if (!ownerMatches(data, result)) return '';
      updateIssue(data, result.issue);
      return `${ROUTE}/issues/${result.issue.id}`;
    });
  }
  function remove(data, issue) {
    drawerForm(data, {
      id: 'dev-remove-form', title: '停止跟踪 Issue', subtitle: '从当前账号的需求列表移除', buttonLabel: '停止跟踪', dangerous: true,
      content: `<p>从列表中移除「${esc(issue.title || '此 Issue')}」？GitHub 上的 Issue 和评论会保留。</p>`
    }, async () => {
      const result = await ctx.api(`${API}/${encodeURIComponent(issue.id)}`, { method: 'DELETE' });
      if (!ownerMatches(data, result)) return '';
      data.issues = data.issues.filter(item => item.id !== issue.id);
      ctx.onIssuesChanged?.();
      if (data.repository && !data.issues.some(item => item.repository === data.repository)) data.repository = '';
      return ROUTE;
    });
  }

  function bind(root, route = ROUTE) {
    const panel = root.matches?.('[data-dev-hub]') ? root : root.querySelector('[data-dev-hub]');
    if (!panel) return;
    const data = current();
    mounted = { panel };
    if (!data.loaded && !data.loading && !data.loadError) void load(data);
    const row = data.issues.find(issue => issue.id === DETAIL.exec(route)?.[1]);
    const results = panel.querySelector('[data-dev-results]');
    const status = panel.querySelector('[data-dev-field="status"]');
    function applyFilters() {
      if (results) results.innerHTML = issueRows(data);
      if (status) status.value = data.status;
      for (const control of panel.querySelectorAll('[data-dev-action="category"]')) {
        control.setAttribute('aria-pressed', String(control.dataset.id === data.status));
      }
    }
    panel.oninput = event => {
      if (event.target.dataset.devField !== 'query') return;
      data.query = event.target.value;
      applyFilters();
    };
    panel.onchange = event => {
      if (event.target === status) data.status = event.target.value;
      else if (event.target.dataset.devField === 'repository') data.repository = event.target.value;
      else return;
      applyFilters();
    };
    panel.onclick = event => {
      const target = event.target.closest('[data-dev-action]');
      if (!target || current() !== data) return;
      const { devAction, id } = target.dataset;
      if (devAction === 'add' && !data.loading) add(data);
      else if (devAction === 'detail') ctx.navigate(`${ROUTE}/issues/${id}`);
      else if (devAction === 'back') ctx.navigate(ROUTE);
      else if (devAction === 'teams') ctx.navigate('ai-teams/agents');
      else if (devAction === 'related-agent') ctx.navigate(`ai-teams/agents/${id}`);
      else if (devAction === 'related-component') ctx.navigate(`ui-components/${id}`);
      else if (devAction === 'sync' && row) void sync(data, row);
      else if (devAction === 'remove' && row && !data.syncing.has(row.id)) remove(data, row);
      else if (devAction === 'reload') {
        void load(data);
        rerender(data);
      } else if (devAction === 'reset') {
        data.query = '';
        data.repository = '';
        data.status = 'all';
        panel.querySelector('[data-dev-field="query"]').value = '';
        panel.querySelector('[data-dev-field="repository"]').value = '';
        applyFilters();
        panel.querySelector('[data-dev-field="query"]').focus();
      } else if (devAction === 'category') {
        data.status = data.status === id ? 'all' : id;
        applyFilters();
      }
    };
  }

  return { render, bind, cleanup() { state = undefined; mounted = undefined; } };
}
