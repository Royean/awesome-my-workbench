// Only the common record deletion uses the server's short restore window.
// Anchor it before the request so response transit and list refresh never renew it.
const UNDO_MS = 12000;
export function createDeleteUndo({context, api, refresh, show, hide, now = () => performance.now()}) {
  let version = 0, scopeVersion = 0, target = null;
  const same = source => {
    const current = context();
    return current.owner === source.owner && current.space === source.space && current.workbench === source.workbench;
  };
  const validSource = (source, scope) => scope === scopeVersion && same(source);
  const current = (source, request, scope) => request === version && validSource(source, scope);
  function dismiss() { version++; target = null; hide(); }
  function clear() { scopeVersion++; dismiss(); }
  function deadline(result, started) {
    if(result.undoExpiresAt === undefined && result.serverNow === undefined) return started + UNDO_MS;
    if(!Number.isFinite(result.undoExpiresAt) || !Number.isFinite(result.serverNow) || result.serverNow <= 0) return null;
    return started + Math.max(0, Math.min(UNDO_MS, result.undoExpiresAt - result.serverNow));
  }
  async function remove(id, name, onDeleted = () => {}) {
    dismiss();
    const source = {...context()}, request = version, scope = scopeVersion, started = now();
    try {
      const result = await api('/api/items/' + id, {method:'DELETE'}, source.space, source.workbench);
      if(!validSource(source, scope)) return;
      if(current(source, request, scope)) {
        onDeleted();
        const until = deadline(result, started), remaining = until === null ? 0 : until - now();
        if(result.deleted?.id === id && remaining > 0) {
          target = {source, request, scope, id, name, until};
          show(`已从${name}工作台移除记录`, `撤销${name}记录`, remaining);
        } else show(`已从${name}工作台移除记录`);
      }
      await refresh();
    } catch(error) { if(current(source, request, scope)) throw error; }
  }
  async function restore() {
    const saved = target;
    if(!saved || !current(saved.source, saved.request, saved.scope) || now() >= saved.until) {
      dismiss();
      throw Error('撤销已失效，可从本工作台首页的设置进入最近删除恢复');
    }
    dismiss();
    const {source, scope, id, name} = saved, request = version;
    try {
      await api('/api/restore', {method:'POST', body:JSON.stringify({id})}, source.space, source.workbench);
      if(!validSource(source, scope)) return;
      await refresh();
      if(current(source, request, scope)) show(`记录已恢复到${name}工作台`);
    } catch(error) { if(current(source, request, scope)) throw error; }
  }
  return {remove, restore, clear, dismiss};
}
