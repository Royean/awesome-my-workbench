CREATE TABLE IF NOT EXISTS agent_execution_pairings (
  code_hash TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_execution_devices (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  capabilities TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS agent_execution_devices_owner ON agent_execution_devices(owner);
CREATE TABLE IF NOT EXISTS agent_execution_tasks (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  parent_id TEXT,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  body TEXT NOT NULL,
  UNIQUE(owner,request_id)
);
CREATE INDEX IF NOT EXISTS agent_execution_tasks_owner ON agent_execution_tasks(owner,created_at);
CREATE INDEX IF NOT EXISTS agent_execution_tasks_parent ON agent_execution_tasks(owner,parent_id);
CREATE TABLE IF NOT EXISTS agent_execution_runs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  task_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  state TEXT NOT NULL,
  ack_seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_execution_runs_queue ON agent_execution_runs(owner,device_id,state,created_at);
CREATE INDEX IF NOT EXISTS agent_execution_runs_task ON agent_execution_runs(owner,task_id);
CREATE TABLE IF NOT EXISTS agent_execution_events (
  owner TEXT NOT NULL,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(owner,run_id,seq)
);
CREATE TABLE IF NOT EXISTS agent_execution_approvals (
  owner TEXT NOT NULL,
  run_id TEXT NOT NULL,
  id TEXT NOT NULL,
  state TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  PRIMARY KEY(owner,run_id,id)
);
INSERT OR IGNORE INTO schema_migrations VALUES(9,unixepoch()*1000);
