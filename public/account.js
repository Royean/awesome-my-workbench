import { fetchJSON } from './request.js';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function createAccount({openDrawer, closeDrawer, toast = () => {}, onAuthenticated, onUnauthorized} = {}) {
  let enabled = false, user = null, invite = new URLSearchParams(location.hash.slice(1)).get('invite');
  const esc = escapeHTML;
  const field = (label, name, type = 'text', extra = '') => `<label class="account-field"><span>${label}</span><input name="${name}" type="${type}" ${extra}></label>`;
  const error = '<p class="account-error" role="alert" aria-live="assertive"></p>';
  const submit = label => `<button class="account-button account-primary" type="submit">${label}</button>`;
  const date = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '未知' : d.toLocaleString('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}); };
  function handleUnauthorized() {
    onUnauthorized?.();
    user = null;
    document.querySelector('#app')?.replaceChildren();
    document.querySelector('#overlay')?.replaceChildren();
    document.body.classList.remove('scroll-lock');
    location.reload();
  }
  async function request(path, options = {}, allowUnauthorized = false) {
    try {return await fetchJSON(`/api/auth${path}`,options);}
    catch(error) {if(error.status===401&&!allowUnauthorized)handleUnauthorized();throw error;}
  }
  const write = (path, body, method = 'POST', allow = false) => request(path, {method, body:JSON.stringify(body)}, allow);
  function bindForm(form, action) {
    if (!form) return;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (form.dataset.busy) return;
      const button = form.querySelector('[type="submit"]'), label = button.textContent;
      const alert = form.querySelector('.account-error');
      alert.textContent = ''; form.dataset.busy = 'true'; button.disabled = true; button.textContent = '正在处理…';
      try { await action(Object.fromEntries(new FormData(form)), form); }
      catch (err) { alert.textContent = err.message || '连接失败，请重试。'; }
      finally { delete form.dataset.busy; button.disabled = false; button.textContent = label; }
    });
  }
  function gate(message = '') {
    document.querySelector('#overlay')?.replaceChildren();
    document.body.classList.remove('scroll-lock');
    const root = document.querySelector('#app');
    root.innerHTML = `<main class="account-gate"><div class="account-brand"><span class="account-mark" aria-hidden="true">A</span><span>Awesome My Workbench</span></div><section class="account-card"><p class="account-eyebrow">我的工作台</p><h1>${invite ? '激活你的账号' : '欢迎回来'}</h1><p class="account-muted">${invite ? '设置密码，开始使用属于你的工作台。' : '登录后，继续记录与安排你的日常。'}</p>${message ? `<p class="account-error" role="alert">${esc(message)}</p><button type="button" class="account-button account-primary" id="account-retry">重新连接</button>` : `<form id="account-gate-form">${invite ? field('昵称', 'name', 'text', 'autocomplete="nickname" maxlength="80"') : field('邮箱', 'email', 'email', 'autocomplete="username" required maxlength="254" inputmode="email" autocapitalize="none" spellcheck="false"')}${field(invite ? '设置密码' : '密码', 'password', 'password', `autocomplete="${invite ? 'new-password' : 'current-password'}" required ${invite ? 'minlength="12" maxlength="128"' : 'maxlength="128"'}`)}${invite ? '<p class="account-muted account-hint">密码需为 12–128 个字符，建议使用独立长密码。</p>' : ''}${error}${submit(invite ? '激活并进入工作台' : '登录')}</form><p class="account-footnote">${invite ? '邀请仅可使用一次。链接失效时，请联系管理员重新邀请。' : '暂不开放公开注册，请联系管理员获取邀请。'}</p>${invite ? '<button class="account-button account-quiet" id="account-back-login" type="button">返回登录</button>' : ''}`}</section><p class="account-bottom">把生活的每一部分，放在一起。</p></main>`;
    root.querySelector('#account-retry')?.addEventListener('click', () => location.reload());
    root.querySelector('#account-back-login')?.addEventListener('click', () => { invite = null; history.replaceState(null, '', location.pathname + location.search); gate(); });
    bindForm(root.querySelector('form'), async data => {
      const result = invite ? await write('/accept-invitation', {...data, token:invite}, 'POST', true) : await write('/login', data, 'POST', true);
      invite = null;
      user = result.user;
      history.replaceState(null, '', location.pathname + location.search);
      if(onAuthenticated)await onAuthenticated(user);
      else location.reload();
    });
    root.querySelector('input')?.focus();
  }
  async function initialize() {
    try {
      const data = await request('/me', {}, true);
      enabled = !!data.enabled; user = data.user || null;
      if (!enabled) return true;
      if (invite || !user) { gate(); return false; }
      return true;
    } catch (err) {
      if (err.status === 404) { enabled = false; return true; }
      enabled = true;
      if (err.status === 401) { user = null; gate(); }
      else gate('暂时无法连接账号服务，请检查网络后重试。');
      return false;
    }
  }
  function section(title, content) { return `<section class="account-section"><h3>${title}</h3>${content}</section>`; }
  async function open() {
    if (!enabled || !user) return;
    openDrawer(`<div class="account-panel"><div class="account-identity"><span class="account-avatar">${esc((user.name || user.email || 'A').slice(0,1).toUpperCase())}</span><div><strong>${esc(user.name || '我的账号')}</strong><p>${esc(user.email)}</p><span class="account-tag">${user.role === 'admin' ? '管理员' : '成员'}</span></div></div>${section('个人资料', `<form id="account-profile">${field('昵称','name','text',`value="${esc(user.name)}" autocomplete="nickname" required maxlength="80"`)}${error}${submit('保存昵称')}</form>`)}${section('修改密码', `<form id="account-password">${field('当前密码','currentPassword','password','autocomplete="current-password" required maxlength="128"')}${field('新密码','newPassword','password','autocomplete="new-password" required minlength="12" maxlength="128"')}<p class="account-muted account-hint">使用 12–128 个字符。修改后，其他设备需要重新登录。</p>${error}${submit('更新密码')}</form>`)}${section('登录会话','<div id="account-sessions" aria-live="polite"><p class="account-muted">正在读取会话…</p></div>')}${user.role === 'admin' ? section('成员管理', `<p class="account-muted">通过邀请为成员建立独立账号。禁用将撤销登录；重置邀请会使现有登录和旧邀请链接失效。</p><form id="account-invite">${field('受邀邮箱','email','email','required autocomplete="email" inputmode="email" maxlength="254"')}${field('昵称（选填）','name','text','maxlength="80"')}${error}${submit('生成邀请链接')}</form><div id="account-invite-result" aria-live="polite"></div><div id="account-users" aria-live="polite"><p class="account-muted">正在读取成员…</p></div>`) : ''}<button class="account-button account-danger account-full" id="account-logout" type="button">退出登录</button><p class="account-error" id="account-action-error" role="alert"></p></div>`, '账号与安全', '管理个人资料、密码和登录设备');
    const panel = document.querySelector('.account-panel');
    bindForm(panel.querySelector('#account-profile'), async data => { const result = await write('/profile', data, 'PATCH'); user = result.user || {...user,...data}; panel.querySelector('.account-identity strong').textContent = user.name; panel.querySelector('.account-avatar').textContent = (user.name || user.email).slice(0,1).toUpperCase(); toast('昵称已保存'); });
    bindForm(panel.querySelector('#account-password'), async (data, form) => { await write('/password', data); form.reset(); toast('密码已更新'); await sessions(panel); });
    bindForm(panel.querySelector('#account-invite'), async (data, form) => { const result = await write('/invitations', data); showInvite(panel, result); form.reset(); await users(panel); });
    panel.querySelector('#account-logout').addEventListener('click', async event => { event.currentTarget.disabled = true; try { await write('/logout', {}); handleUnauthorized(); } catch (err) { panel.querySelector('#account-action-error').textContent = err.message; event.target.disabled = false; } });
    await Promise.all([sessions(panel), user.role === 'admin' ? users(panel) : Promise.resolve()]);
  }
  function retry(target, message, action) {
    target.innerHTML = `<p class="account-error" role="alert">${esc(message)}</p><button class="account-button" type="button">重试</button>`;
    target.querySelector('button').addEventListener('click', action);
  }
  async function sessions(panel) {
    const target = panel.querySelector('#account-sessions');
    try {
      const {sessions: list = []} = await request('/sessions');
      if (!target.isConnected) return;
      target.innerHTML = list.length ? list.map(s => `<div class="account-row"><div><strong>${s.current ? '当前设备' : '登录会话'}</strong><p>登录 ${esc(date(s.createdAt))}</p><p>最近活动 ${esc(date(s.lastSeenAt))}</p><p>到期 ${esc(date(s.expiresAt))}</p></div><button type="button" class="account-button ${s.current ? 'account-danger' : ''}" data-session="${esc(s.id)}">${s.current ? '退出此设备' : '撤销'}</button></div>`).join('') : '<p class="account-muted">没有活跃会话。</p>';
      for (const button of target.querySelectorAll('[data-session]')) button.addEventListener('click', async () => { const session = list.find(s => String(s.id) === button.dataset.session); button.disabled = true; try { await request('/sessions/' + encodeURIComponent(button.dataset.session), {method:'DELETE'}); if (session?.current) handleUnauthorized(); else { toast('会话已撤销'); await sessions(panel); } } catch (err) { retry(target, err.message, () => sessions(panel)); } });
    } catch (err) { if (target.isConnected) retry(target, err.message, () => sessions(panel)); }
  }
  function showInvite(panel, result) {
    const target = panel.querySelector('#account-invite-result');
    const url = new URL(location.pathname, location.origin); url.hash = 'invite=' + encodeURIComponent(result.token);
    target.innerHTML = `<div class="account-invitation"><strong>邀请链接已生成</strong><p>此链接仅在这里显示，请复制后妥善转交给受邀人。到期：${esc(date(result.expiresAt))}</p><label class="account-field"><span>一次性邀请链接</span><input readonly aria-label="一次性邀请链接" value="${esc(url.href)}"></label><button class="account-button" type="button">复制链接</button><button class="account-button account-quiet" type="button" data-dismiss-invite>收起链接</button><p class="account-copy-status" role="status"></p></div>`;
    target.querySelector('button').addEventListener('click', async () => { try { await navigator.clipboard.writeText(url.href); target.querySelector('.account-copy-status').textContent = '链接已复制'; } catch { target.querySelector('input').select(); target.querySelector('.account-copy-status').textContent = '请长按或使用键盘复制已选中的链接。'; } });
    target.querySelector('[data-dismiss-invite]').addEventListener('click', () => target.replaceChildren());
  }
  async function users(panel) {
    const target = panel.querySelector('#account-users');
    try {
      const {users: list = []} = await request('/users');
      if (!target.isConnected) return;
      target.innerHTML = list.map(member => `<article class="account-member"><div><strong>${esc(member.name || '未命名成员')}</strong><p>${esc(member.email)}</p><span class="account-tag">${member.role === 'admin' ? '管理员' : '成员'} · ${member.disabled ? '已禁用' : member.activated === false || member.status === 'invited' ? '待激活' : '已启用'}</span></div><div class="account-member-actions">${String(member.id) !== String(user.id) ? `<button type="button" class="account-button" data-toggle-user="${esc(member.id)}">${member.disabled ? '启用' : '禁用'}</button>` : '<span class="account-muted">当前账号</span>'}${String(member.id) !== String(user.id) ? `<button type="button" class="account-button" data-reset-user="${esc(member.id)}">重置邀请</button>` : ''}</div></article>`).join('') || '<p class="account-muted">暂无成员。</p>';
      for (const button of target.querySelectorAll('[data-toggle-user],[data-reset-user]')) button.addEventListener('click', async () => { button.disabled = true; try { if (button.dataset.toggleUser) { const member = list.find(m => String(m.id) === button.dataset.toggleUser); await write('/users/' + encodeURIComponent(member.id), {disabled:!member.disabled}, 'PATCH'); toast(member.disabled ? '成员已启用' : '成员已禁用'); } else { showInvite(panel, await write('/users/' + encodeURIComponent(button.dataset.resetUser) + '/reset-invitation', {})); toast('新的邀请链接已生成'); panel.querySelector('#account-invite-result').scrollIntoView({block:'nearest',behavior:'smooth'}); } await users(panel); } catch (err) { panel.querySelector('#account-action-error').textContent = err.message; button.disabled = false; } });
    } catch (err) { if (target.isConnected) retry(target, err.message, () => users(panel)); }
  }
  return {initialize, open, handleUnauthorized, get enabled() {return enabled;}, get user() {return user;}};
}
