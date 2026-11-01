import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer, freePort } from './helpers.mjs';

const cwd = path.resolve(import.meta.dirname, '..');
let dir, server;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'workbench-install-'));
  const port = await freePort();
  server = await startServer({ cwd, env: { NODE_ENV: 'test', AUTH_REQUIRED: '1', APP_ORIGIN: `http://127.0.0.1:${port}`, PORT: String(port), HEALTH_DATA_DIR: dir } });
});
after(async () => { await server?.stop(); await rm(dir, { recursive: true, force: true }); });

test('GET /install.md serves docs/AGENT-INSTALL.md publicly as markdown, without secrets', async () => {
  const r = await fetch(server.base + '/install.md');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/markdown; charset=utf-8$/);
  const text = await r.text();
  assert.equal(text, await readFile(path.join(cwd, 'docs/AGENT-INSTALL.md'), 'utf8'));
  assert.match(text, /https:\/\/vivid-dream\.online\/mcp/);
  assert.doesNotMatch(text, /zh_pat_[A-Za-z0-9_-]{8,}/);
  assert.doesNotMatch(text, /Bearer\s+zh_pat_/);
  const h = await fetch(server.base + '/install.md', { method: 'HEAD' });
  assert.equal(h.status, 200);assert.equal(await h.text(), '');
  const post = await fetch(server.base + '/install.md', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: server.base }, body: '{}' });
  assert.notEqual(post.status, 200);
  assert.equal((await fetch(server.base + '/skills/zhiheng/SKILL.md')).status, 404);
});
