CREATE TABLE IF NOT EXISTS component_library(
 owner TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,definition TEXT NOT NULL,
 published_definition TEXT,published_revision INTEGER,archived INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner,id)
);
CREATE TABLE IF NOT EXISTS component_versions(
 owner TEXT NOT NULL,component_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,
 action TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner,component_id,revision)
);
CREATE TABLE IF NOT EXISTS component_previews(
 id TEXT PRIMARY KEY,owner TEXT NOT NULL,definition TEXT NOT NULL,component_id TEXT,base_revision INTEGER,
 space TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,saved_id TEXT
);
CREATE INDEX IF NOT EXISTS component_preview_owner ON component_previews(owner,expires_at);
CREATE TABLE IF NOT EXISTS component_placements(
 owner TEXT NOT NULL,workbench TEXT NOT NULL,page TEXT NOT NULL,revision INTEGER NOT NULL,
 body TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner,workbench,page)
);
CREATE TABLE IF NOT EXISTS component_placement_versions(
 owner TEXT NOT NULL,workbench TEXT NOT NULL,page TEXT NOT NULL,revision INTEGER NOT NULL,
 body TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner,workbench,page,revision)
);
INSERT OR IGNORE INTO schema_migrations VALUES(7,unixepoch()*1000);
