CREATE TABLE IF NOT EXISTS developer_hub_entries (
  owner TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('issue', 'agent')),
  id TEXT NOT NULL,
  entry_key TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY(owner, kind, id),
  UNIQUE(owner, kind, entry_key)
);

INSERT OR IGNORE INTO schema_migrations VALUES(8, unixepoch()*1000);
