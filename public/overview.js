const symbols = { health: 'heart', finance: 'activity', travel: 'compass', reading: 'file' };

export function createOverview({ esc, icon, fetchOverview }) {
  let pendingRequest;

  function cleanup() {
    pendingRequest?.abort();
    pendingRequest = null;
  }

  function frame(space) {
    return `<div class="app"><div class="workspace">
      <main class="main overview-main">
        <div class="heading overview-heading">
          <div><h1>总览看板</h1><p>汇集各工作台的待处理事项和最近动态</p></div>
          <button class="btn overview-space" data-action="shell-spaces">${icon('shield', 15)}${space === 'demo' ? '示例空间 · 虚构' : '个人空间'}</button>
        </div>
        <div id="overview-content"></div>
      </main>
    </div></div>`;
  }

  function row(item, today, upcoming = false) {
    const overdue = upcoming && item.date && item.date < today;
    const date = item.date === today ? '今天' : item.date;
    const time = [date, item.time].filter(Boolean).join(' ');
    const copy = `<span class="overview-row-copy"><strong>${esc(item.title)}</strong><small>${upcoming ? esc(item.workbenchName) + ' · ' : ''}${esc(item.kind)}</small></span>
      <span class="overview-row-time${overdue ? ' overdue' : ''}">${overdue ? '已逾期 · ' : ''}${esc(time || '未安排日期')}</span>`;
    if (!item.route) return `<li><div class="overview-row">${copy}</div></li>`;
    return `<li><button class="overview-row" data-action="overview-open:${esc(item.workbench)}" data-route="${esc(item.route)}" data-trip="${esc(item.trip || '')}">
      ${copy}${icon('arrow', 15)}
    </button></li>`;
  }

  function content(data) {
    const { today, upcoming, pendingCount, overdueCount, workbenches } = data;
    const workbenchCard = board => `<article class="card overview-board">
      <div class="overview-board-head">
        <span class="workbench-symbol ${esc(board.type)}">${icon(symbols[board.type] || 'grid', 19)}</span>
        <div><h3>${esc(board.name)}</h3><p>${board.pendingCount} 项待处理</p></div>
        <button class="text-btn overview-enter" data-action="shell-switch:${esc(board.id)}" aria-label="进入${esc(board.name)}工作台">进入${icon('arrow', 15)}</button>
      </div>
      ${board.recent.length ? `<ul>${board.recent.map(item => row(item, today)).join('')}</ul>` : '<p class="overview-empty">暂无动态</p>'}
    </article>`;
    return `<div class="overview-columns">
      <section class="card overview-pending" aria-labelledby="overview-pending-title">
        <div class="card-head">
          <div><h2 class="card-title" id="overview-pending-title">待处理事项</h2>
          <p>${pendingCount} 项待处理${overdueCount ? ` · ${overdueCount} 项逾期` : ''}</p></div>
          <button class="btn" data-action="overview-refresh">${icon('activity', 15)}刷新</button>
        </div>
        ${upcoming.length ? `<ul>${upcoming.map(item => row(item, today, true)).join('')}</ul>` : '<p class="overview-empty">暂无待处理事项</p>'}
        ${pendingCount > upcoming.length ? `<p class="overview-more">显示前 ${upcoming.length} 项 · 其余事项可在对应工作台查看</p>` : ''}
      </section>
      <section class="overview-activity" aria-labelledby="overview-activity-title">
        <div class="overview-activity-head"><h2 id="overview-activity-title">工作台动态</h2><span>${workbenches.length} 个工作台 · 按记录日期</span></div>
        <div class="overview-boards">${workbenches.map(workbenchCard).join('')}</div>
      </section>
    </div>`;
  }

  async function mount() {
    cleanup();
    const node = document.querySelector('#overview-content');
    if (!node) return;
    const controller = new AbortController();
    pendingRequest = controller;
    node.setAttribute('aria-busy', 'true');
    node.innerHTML = '<div class="card overview-state" role="status">正在加载总览…</div>';
    try {
      const data = await fetchOverview(controller.signal);
      if (node.isConnected && !controller.signal.aborted) node.innerHTML = content(data);
    } catch {
      if (node.isConnected && !controller.signal.aborted) {
        node.innerHTML = '<div class="card overview-state"><p role="alert">暂时无法加载总览。</p><button class="btn" data-action="overview-refresh">重试</button></div>';
      }
    } finally {
      if (pendingRequest === controller) {
        pendingRequest = null;
        node.removeAttribute('aria-busy');
      }
    }
  }

  return { frame, mount, cleanup };
}
