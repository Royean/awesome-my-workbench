CREATE TABLE IF NOT EXISTS access_tokens(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_used_at INTEGER);
CREATE INDEX IF NOT EXISTS access_tokens_user ON access_tokens(user_id);
INSERT OR IGNORE INTO schema_migrations VALUES(2,unixepoch()*1000);
