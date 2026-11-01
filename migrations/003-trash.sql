-- 「最近删除」: deleted records kept for 30 days (separate from the 12-second undo in deleted_items).
CREATE TABLE IF NOT EXISTS trash_items(
 id TEXT PRIMARY KEY,
 space TEXT NOT NULL,
 kind TEXT NOT NULL,
 body TEXT NOT NULL,
 deleted_at INTEGER NOT NULL,
 deleted_via TEXT NOT NULL CHECK(deleted_via IN ('web','mcp')),
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trash_items_space ON trash_items(space,deleted_at);
CREATE INDEX IF NOT EXISTS trash_items_expiry ON trash_items(expires_at);
