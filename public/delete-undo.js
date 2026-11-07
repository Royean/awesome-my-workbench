// Only the common record deletion uses the server's short restore window.
// Anchor it before the request so response transit and list refresh never renew it.
const UNDO_MS = 12000;
export function createDeleteUndo({context, api, refresh, show, hide, now = () => performance.now()}) {
  let version = 0, target = null;
  const same = source => {
    const current = context();
    return current.owner === source.owner && current.space === source.space && current.workbench === source.workbench;
  };
  const current = (source, request) => request === version && same(source);
  function clear() { version++; target = null; hide(); }
  function dismiss() { if(target) clear(); }
  function deadline(result, started) {
    if(result.undoExpiresAt === undefined && result.serverNow === undefined) return started + UNDO_MS;
    if(!Number.isFinite(result.undoExpiresAt) || !Number.isFinite(result.serverNow) || result.serverNow <= 0) return null;
    return started + Math.max(0, Math.min(UNDO_MS, result.undoExpiresAt - result.serverNow));
  }
  async function remove(id, name, onDeleted = () => {}) {
    clear();
    const source = {...context()}, request = version, started = now();
    try {
      const result = await api('/api/items/' + id, {method:'DELETE'}, source.space, source.workbench);
      if(!current(source, request)) return;
      onDeleted();
      const until = deadline(result, started), remaining = until === null ? 0 : until - now();
      if(result.deleted?.id === id && remaining > 0) {
        target = {source, request, id, name, until};
        show(`已从${name}工作台移除记录`, `撤销${name}记录`, remaining);
      } else show(`已从${name}工作台移除记录`);
      await refresh();
    } catch(error) { if(current(source, request)) throw error; }
  }
  async function restore() {
    const saved = target;
    if(!saved || !current(saved.source, saved.request) || now() >= saved.until) {
      clear();
      throw Error('撤销已失效，可从本工作台首页的设置进入最近删除恢复');
    }
    clear();
    const {source, id, name} = saved, request = version;
    try {
      await api('/api/restore', {method:'POST', body:JSON.stringify({id})}, source.space, source.workbench);
      if(!current(source, request)) return;
      await refresh();
      if(current(source, request)) show(`记录已恢复到${name}工作台`);
    } catch(error) { if(current(source, request)) throw error; }
  }
  return {remove, restore, clear, dismiss};
}
