// Phone collection stays inside the two existing workbenches. No browser notification reader.
export function latestStepRecord(items, today) {
  return items.filter(x => x.kind === 'metric' && x.type === 'steps' && x.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.observedAt || '').localeCompare(String(a.observedAt || '')))[0] || null;
}

export function createCaptureUI(ctx) {
  const {esc, icon} = ctx;
  let sequence = 0, inbox = null, filter = 'pending', offset = 0;
  const native = () => /AwesomeMyWorkbench\//.test(navigator.userAgent);
  const scope = () => `${ctx.userId || ''}:${ctx.space}:${ctx.workbench}`;
  const active = (key, seq) => key === scope() && seq === sequence;
  const time = value => {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false}).format(d) : '时间待核对';
  };
  const statusName = s => ({pending:'待核对', confirmed:'已入账', ignored:'已忽略'})[s] || '待核对';
  const metricName = t => ({weight:'体重', heart:'静息心率', sleep:'睡眠', steps:'步数'})[t] || '健康指标';
  const healthRow = x => `<article class="phone-capture-step-row"><div><strong>${esc(x.kind === 'exercise' ? x.title || x.type || '运动' : metricName(x.type))}</strong><small>${esc(x.date)}${x.time ? ' '+esc(x.time) : ''} · Health Connect</small>${x.observedAt ? `<small>数据更新于 ${esc(time(x.observedAt))}</small>` : ''}</div><b>${x.kind === 'exercise' ? `${esc(x.duration)} 分钟${x.distance != null ? `<small>${esc(x.distance)} 公里</small>` : ''}` : `${esc(x.value)} ${esc(x.unit || '')}`}</b></article>`;
  const typeName = t => ({income:'收入', expense:'支出', transfer:'转账', buy:'买入', sell:'卖出', dividend:'分红', fee:'费用', repayment:'还款', other:'其他'})[t] || '请选择类型';
  const noSubmit = '<button type="button" class="btn" data-action="close">关闭</button>';
  const setupLink = () => native()
    ? '<a class="btn primary" href="/app/collectors">管理手机采集</a>'
    : '<p class="phone-capture-hint">请在新版安卓工作台 App 中打开「手机采集」，授权通知和健康数据访问。网页版可以核对流水、查看同步结果。</p>';

  function entry() {
    return `<section class="card phone-capture-entry"><div><h2>${icon('activity',20)}手机采集</h2><p>${ctx.workbench === 'finance' ? '交易通知先核对，再保存为流水。' : '同步步数、睡眠、体重、静息心率和运动记录。'}</p></div><button class="btn" data-action="capture-open">${ctx.workbench === 'finance' ? '采集与待核对' : '查看与管理'}</button></section>`;
  }

  function stepsCard() {
    const last = latestStepRecord(ctx.items, ctx.today);
    const current = last?.date === ctx.today;
    return `<section class="card phone-capture-steps" aria-label="手机步数"><div class="card-head"><h2 class="card-title">${current ? '今日步数' : '最近步数'}</h2><button class="text-btn" data-action="capture-open">手机采集 ${icon('arrow',13)}</button></div><p class="phone-capture-step-value">${last ? esc(Number(last.value).toLocaleString('zh-CN')) : '—'}<small>步</small></p><p>${last ? `${esc(current ? '今天' : last.date)} · ${last.source === 'health-connect' ? 'Health Connect' : '手工记录'}` : '连接手机后，自动显示最近一次步数。'}</p>${last?.observedAt ? `<small>数据更新于 ${esc(time(last.observedAt))} · 北京时间</small>` : ''}${last && !current ? '<small>今天还没有同步数据</small>' : ''}</section>`;
  }

  function cleanup() {sequence++; inbox = null; filter = 'pending'; offset = 0;}

  function recordTag(item) {
    if(item.source !== 'health-connect') return '';
    return `<small class="phone-capture-source">来自 Health Connect${item.observedAt ? ' · '+esc(time(item.observedAt)) : ''}</small>`;
  }

  function intro() {
    return `<div class="phone-capture-intro"><p>交易通知 → 资产工作台待核对<br>健康数据 → 健康工作台</p>${setupLink()}<p class="phone-capture-hint">采集在安卓工作台 App 中运行；通知和各项健康数据可分别开启或暂停。通知缺失的交易仍需通过账单补齐。</p></div>`;
  }

  function blankContext() {
    if(ctx.space === 'demo') {
      ctx.openDrawer(`${intro()}<div class="notice">手机数据只同步到个人空间。</div><button class="btn primary" data-action="capture-personal">切换到个人空间</button>`, '手机采集', '授权后开始采集', noSubmit);
      return true;
    }
    if(!ctx.userId) {
      ctx.openDrawer('<p>请先登录工作台，再在安卓 App 中开启手机采集。</p>', '手机采集', '采集绑定当前登录账号', noSubmit);
      return true;
    }
    return false;
  }

  function rows() {
    const events = inbox?.events || [];
    const selected = events.filter(x => x.status === filter);
    const stats = inbox?.stats || {};
    return `<div class="phone-capture-filters" role="group" aria-label="筛选采集状态">${['pending','confirmed','ignored'].map(s => `<button class="btn ${filter === s ? 'primary' : ''}" aria-pressed="${filter === s}" data-action="capture-filter:${s}">${statusName(s)} ${Number(stats[s] || 0)}</button>`).join('')}</div><div class="phone-capture-list">${selected.length ? selected.map(x => `<article class="phone-capture-event"><div class="phone-capture-event-heading"><strong>${esc(x.parsed?.title || x.title || '交易通知')}</strong><span>${esc(x.parsed?.amount != null ? `${x.parsed.currency || 'CNY'} ${x.parsed.amount}` : '金额待核对')}</span></div><p>${esc(x.text)}</p><small>${esc(inbox.supportedApps?.find(a => a.packageName === x.packageName)?.name || x.packageName)} · ${esc(time(x.postedAt))}</small>${x.possibleDuplicateIds?.length ? '<p class="phone-capture-duplicate">可能与其他通知重复，请核对是否为同一笔交易。</p>' : ''}${x.status === 'pending' ? `<div class="phone-capture-event-actions"><button class="btn primary" data-action="capture-review:${esc(x.id)}">核对入账</button><button class="btn" data-action="capture-ignore:${esc(x.id)}">忽略此条</button></div>` : `<p class="phone-capture-outcome">${statusName(x.status)}${x.transactionDeleted ? ' · 对应流水已删除' : ''}</p>`}</article>`).join('') : `<div class="phone-capture-empty"><p>${filter === 'pending' ? '没有待核对的交易通知' : `还没有${statusName(filter)}的通知`}</p><small>${filter === 'pending' ? '开启手机采集后，新收到的交易通知会出现在这里。' : '可切换状态查看其他通知。'}</small></div>`}</div>${offset > 0 || offset + events.length < Number(inbox?.total || 0) ? `<div class="phone-capture-event-actions"><button class="btn" data-action="capture-page:previous" ${offset === 0 ? 'disabled' : ''}>上一页</button><button class="btn" data-action="capture-page:next" ${offset + events.length >= Number(inbox?.total || 0) ? 'disabled' : ''}>下一页</button></div>` : ''}`;
  }

  function drawInbox() {
    ctx.openDrawer(`${intro()}<div class="phone-capture-inbox-head"><h3>通知收件箱</h3><button class="text-btn" data-action="capture-refresh">刷新</button></div><p class="phone-capture-hint">通知内容仅作线索。确认后保存一条流水，账户余额和持仓保持独立核对。</p>${rows()}`, '手机采集', '资产工作台 · 个人空间', noSubmit);
  }

  async function open() {
    const seq = ++sequence, key = scope();
    if(blankContext()) return;
    ctx.openDrawer(`${intro()}<p role="status">正在读取采集结果…</p>`, '手机采集', `${ctx.workbench === 'finance' ? '资产' : '健康'}工作台 · 个人空间`, noSubmit);
    const waitingDrawer = document.querySelector('.drawer');
    try {
      const data = await ctx.api(ctx.workbench === 'finance' ? `/api/capture?status=${filter}&offset=${offset}&limit=30` : '/api/capture');
      if(!active(key, seq) || document.querySelector('.drawer') !== waitingDrawer) return;
      if(data.owner !== ctx.userId) {cleanup();ctx.closeDrawer();ctx.toast('登录账号已变化，请重新打开工作台');return;}
      if(ctx.workbench === 'finance') {inbox = data;drawInbox();}
      else {
        const steps = data.steps || [];
        const records = data.healthRecords || [];
        ctx.openDrawer(`${intro()}<h3>最近步数记录</h3><div class="phone-capture-list">${steps.length ? steps.slice(0,14).map(x => `<article class="phone-capture-step-row"><div><strong>${esc(x.date)}</strong><small>${x.source === 'health-connect' ? 'Health Connect' : '手工记录'}${x.observedAt ? ' · '+esc(time(x.observedAt)) : ''}</small></div><b>${esc(Number(x.value).toLocaleString('zh-CN'))} 步</b></article>`).join('') : '<div class="phone-capture-empty">还没有同步步数。请在安卓 App 中开启步数采集，并确认 Health Connect 中有步数数据。</div>'}</div><h3>其他健康采集</h3><div class="phone-capture-list">${records.length ? records.slice(0,30).map(healthRow).join('') : '<div class="phone-capture-empty">暂无睡眠、体重、静息心率或运动数据。可在安卓 App 中按需开启各项同步。</div>'}</div>`, '手机采集', '健康工作台 · 北京时间', noSubmit);
      }
    } catch(error) {
      if(active(key, seq) && document.querySelector('.drawer') === waitingDrawer) {
        ctx.openDrawer(`${intro()}<p class="phone-capture-error" role="alert">${esc(error.message)}</p><button class="btn" data-action="capture-refresh">重新加载</button>`, '手机采集', '采集结果暂未加载', noSubmit);
      }
    }
  }

  function review(id) {
    const event = inbox?.events?.find(x => x.id === id && x.status === 'pending');
    if(!event) return;
    const p = event.parsed || {};
    const types = ['income','expense','transfer','buy','sell','dividend','fee','repayment','other'];
    ctx.openDrawer(`<form id="capture-review-form" data-discard-guard><div class="notice">请按实际交易核对。转账、还款与买卖请选对应类型。</div><details class="phone-capture-original"><summary>查看原始通知</summary><p>${esc(event.title)}</p><p>${esc(event.text)}</p><small>${esc(time(event.postedAt))}</small></details>${ctx.field('流水名称','title',p.title || event.title,'text','required maxlength="120"')}${ctx.field('交易日期','date',p.date || '', 'date',`required max="${esc(ctx.today)}"`)}<div class="field"><label for="capture-type">流水类型</label><select id="capture-type" name="transactionType" required><option value="">请选择并核对</option>${types.map(t => `<option value="${t}" ${p.type === t ? 'selected' : ''}>${typeName(t)}</option>`).join('')}</select></div>${ctx.field('金额（支出填负数，收入填正数）','amount',p.amount ?? '', 'number','required step="0.01"')}<div class="field"><label for="capture-currency">币种</label><select name="currency" id="capture-currency" required>${['CNY','HKD','USD','EUR','JPY','GBP'].map(c => `<option ${c === (p.currency || 'CNY') ? 'selected' : ''}>${c}</option>`).join('')}</select></div><div class="field"><label for="capture-account">关联账户</label><select id="capture-account" name="accountId"><option value="">暂不关联，稍后核对</option>${ctx.items.filter(x => x.kind === 'asset_account').map(x => `<option value="${esc(x.id)}">${esc(x.title)} · ${esc(x.currency)}</option>`).join('')}</select></div>${ctx.field('备注','note','','text','maxlength="5000"')}<p class="phone-capture-hint">只保存流水，不自动调整账户余额或资产数量。</p><p id="capture-review-error" role="alert"></p></form>`, '核对通知并入账', '请确认金额、日期与流水类型', '<button type="button" class="btn" data-action="capture-back">返回收件箱</button><button class="btn primary" type="submit" form="capture-review-form">确认并保存流水</button>');
    ctx.markDrawerBaseline();
    document.querySelector('#capture-review-form').onsubmit = async e => {
      e.preventDefault();
      const form = e.currentTarget, seq = sequence, key = scope();
      const button = document.querySelector('[form="capture-review-form"]');
      button.disabled = true;
      const fields = Object.fromEntries(new FormData(form));
      fields.amount = Number(fields.amount);
      if(!fields.accountId) delete fields.accountId;
      try {
        await ctx.api(`/api/capture/events/${encodeURIComponent(id)}/confirm`, {method:'POST', body:JSON.stringify(fields)});
        if(!active(key, seq) || !form.isConnected) return;
        await ctx.load();
        if(!active(key, seq) || !form.isConnected) return;
        ctx.toast('已保存为一条流水');
        await open();
      } catch(error) {
        if(active(key, seq) && form.isConnected) {
          document.querySelector('#capture-review-error').textContent = error.message;
          button.disabled = false;
        }
      }
    };
  }

  async function handle(action, arg) {
    if(action === 'capture-open' || action === 'capture-refresh') {await open();return;}
    if(action === 'capture-personal') {ctx.closeDrawer();await ctx.setSpace('personal');await open();return;}
    if(action === 'capture-filter') {filter = ['pending','confirmed','ignored'].includes(arg) ? arg : 'pending';offset = 0;await open();return;}
    if(action === 'capture-page') {offset = Math.max(0,offset + (arg === 'previous' ? -30 : 30));await open();return;}
    if(action === 'capture-review') {review(arg);return;}
    if(action === 'capture-back') {ctx.requestClose(() => drawInbox());return;}
    if(action === 'capture-ignore') {
      const seq = sequence, key = scope();
      const currentDrawer = document.querySelector('.drawer');
      if(!inbox?.events?.some(x => x.id === arg && x.status === 'pending')) return;
      await ctx.api(`/api/capture/events/${encodeURIComponent(arg)}/ignore`, {method:'POST',body:'{}'});
      if(active(key, seq) && document.querySelector('.drawer') === currentDrawer) {ctx.toast('已忽略这条通知');await open();}
    }
  }

  return {entry, stepsCard, open, handle, cleanup, recordTag};
}
