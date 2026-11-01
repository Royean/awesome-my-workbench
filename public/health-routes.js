// Keep old bookmarks useful while exposing fewer primary destinations.
export function normalizeHealthRoute(route){return route==='file'?'visit/files':route==='task'?'dashboard/tasks':route;}
