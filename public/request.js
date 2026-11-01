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

// Small 「来自 AI 助手」 label for records created or last changed through the assistant (MCP). Values come from the server only.
export function aiTag(item) {
  const at = item && (item.lastAiEditAt || item.aiCreatedAt);
  if (!at && item?.createdVia !== 'mcp') return '';
  const d = at ? new Date(at) : null;
  const when = d && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) : '';
  return `<span class="ai-tag" title="${when ? `AI 助手最后修改于 ${when}` : '来自 AI 助手'}">来自 AI 助手${when ? ` · ${when}` : ''}</span>`;
}
