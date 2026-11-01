// JSON API calls never populate the browser cache or automatically retry writes.
export async function fetchJSON(url, options = {}) {
  const {timeoutMs, signal, ...request} = options;
  const method = String(request.method || 'GET').toUpperCase();
  const writing = !['GET','HEAD'].includes(method);
  const limit = timeoutMs ?? (/\/api\/(upload|capture-meal)/.test(url) ? 60000 : writing ? 30000 : 15000);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if(signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, {once:true});
  const timer = setTimeout(() => {timedOut = true; controller.abort();}, limit);
  try {
    const response = await fetch(url, {...request, credentials:'same-origin', cache:'no-store', headers:{'Content-Type':'application/json', ...request.headers}, signal:controller.signal});
    let body;
    try {body = await response.json();}
    catch(error) {if(controller.signal.aborted) throw error; throw Object.assign(new Error(writing ? '未收到有效的操作结果。请先刷新检查，避免重复提交。' : '服务暂时返回异常，请稍后重试。'),{status:response.ok ? 502 : response.status,uncertainWrite:writing});}
    if(!response.ok) throw Object.assign(new Error(body?.error || '操作失败，请重试。'),{status:response.status,field:typeof body?.field==='string'?body.field:undefined});
    return body;
  } catch(error) {
    if(timedOut) throw Object.assign(new Error(writing ? '网络响应超时，操作结果尚未确认。请先刷新检查，避免重复提交。' : '连接超时，请检查网络后重新加载。'), {status:0, timeout:true, uncertainWrite:writing});
    if(error instanceof TypeError || error.name==='AbortError') throw Object.assign(new Error(writing ? '连接中断，操作结果尚未确认。请先刷新检查，避免重复提交。' : '网络连接失败，请检查网络后重试。'),{status:0,uncertainWrite:writing});
    throw error;
  } finally {clearTimeout(timer); signal?.removeEventListener('abort', abort);}
}

// Places a field-scoped API error inline under the matching input without touching entered values.
export function showFieldError(form, error) {
  if(!form) return false;
  for(const old of form.querySelectorAll('.field-error')) old.remove();
  for(const input of form.querySelectorAll('[aria-invalid="true"]')) input.removeAttribute('aria-invalid');
  const input = error?.field && form.querySelector(`[name="${CSS.escape(error.field)}"]`);
  if(!input) return false;
  // Reveal the field if it sits inside a collapsed <details> (e.g. 「时间与备注」).
  for(let d = input.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
  const message = document.createElement('div');
  message.className = 'field-error'; message.setAttribute('role','alert'); message.id = `${input.name}-field-error`;
  message.textContent = error.message;
  input.setAttribute('aria-invalid','true'); input.setAttribute('aria-describedby', message.id);
  input.insertAdjacentElement('afterend', message); input.focus?.();
  return true;
}

// 「来自 AI 助手」 tag for records created or changed through the assistant (MCP). Markers come from the server only:
// createdVia/aiCreatedAt/lastAiEditAt (MCP writes) and lastUserEditAt (web edits).
const SH = { timeZone: 'Asia/Shanghai' };
const ymd = d => new Intl.DateTimeFormat('en-CA', { ...SH, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export function aiWhen(iso, now = new Date()) {
  const d = new Date(iso); if (!iso || Number.isNaN(d.getTime())) return '';
  const hm = new Intl.DateTimeFormat('en-GB', { ...SH, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  const day = ymd(d), today = ymd(now), y = new Date(now.getTime() - 864e5);
  if (day === today) return `今天 ${hm}`;
  if (day === ymd(y)) return `昨天 ${hm}`;
  const [Y, M, D] = day.split('-').map(Number);
  return `${day.slice(0, 4) !== today.slice(0, 4) ? Y + '年' : ''}${M}月${D}日 ${hm}`;
}
const ms = v => { const t = Date.parse(v || ''); return Number.isNaN(t) ? 0 : t; };
// Pure: returns {text, label} or null.
export function aiTagInfo(item, now = new Date()) {
  if (!item || !(item.lastAiEditAt || item.aiCreatedAt || item.createdVia === 'mcp')) return null;
  const byAi = item.createdVia === 'mcp', ai = item.lastAiEditAt || item.aiCreatedAt, userAfter = ms(item.lastUserEditAt) > ms(ai);
  const text = userAfter ? `${byAi ? 'AI 助手创建' : 'AI 助手修改过'} · 你修改过` : `${byAi ? '来自 AI 助手' : 'AI 助手修改过'}${ai ? ' · ' + aiWhen(ai, now) : ''}`;
  const events = [];
  if (byAi) events.push({ t: ms(item.aiCreatedAt), s: `AI 助手 ${aiWhen(item.aiCreatedAt, now)} 创建`.replace(/ +/g, ' ') });
  else events.push({ t: -1, s: '你创建' });
  if (item.lastAiEditAt && (!byAi || ms(item.lastAiEditAt) > ms(item.aiCreatedAt))) events.push({ t: ms(item.lastAiEditAt), s: `AI 助手 ${aiWhen(item.lastAiEditAt, now)} 修改` });
  if (item.lastUserEditAt) events.push({ t: ms(item.lastUserEditAt), user: true, s: `你 ${aiWhen(item.lastUserEditAt, now)} ` });
  events.sort((a, b) => a.t - b.t);
  // Chronological; the user's own later edit reads 「又修改」 when anything came before it.
  const label = events.map((e, i) => e.user ? e.s + (i > 0 ? '又修改' : '修改') : e.s).join('，');
  return { text, label };
}
const escAttr = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function aiTag(item) {
  const info = aiTagInfo(item); if (!info) return '';
  return `<span class="ai-tag" role="img" aria-label="${escAttr(info.label)}" title="${escAttr(info.label)}">${escAttr(info.text)}</span>`;
}
