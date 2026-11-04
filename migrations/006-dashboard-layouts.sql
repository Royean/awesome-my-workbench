CREATE TABLE IF NOT EXISTS dashboard_layouts(
 owner TEXT NOT NULL, workbench TEXT NOT NULL, page TEXT NOT NULL,
 revision INTEGER NOT NULL, config TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(owner,workbench,page)
);
CREATE TABLE IF NOT EXISTS dashboard_layout_versions(
 owner TEXT NOT NULL, workbench TEXT NOT NULL, page TEXT NOT NULL,
 revision INTEGER NOT NULL, config TEXT NOT NULL, theme_color TEXT NOT NULL,
 updated_at TEXT NOT NULL, source TEXT NOT NULL, summary TEXT NOT NULL,
 PRIMARY KEY(owner,workbench,page,revision)
);
CREATE TABLE IF NOT EXISTS dashboard_layout_previews(
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, workbench TEXT NOT NULL, page TEXT NOT NULL,
 base_revision INTEGER NOT NULL, config TEXT NOT NULL, theme_color TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, source TEXT NOT NULL, summary TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dashboard_layout_preview_owner ON dashboard_layout_previews(owner,expires_at);
INSERT OR IGNORE INTO schema_migrations VALUES(6,unixepoch()*1000);
