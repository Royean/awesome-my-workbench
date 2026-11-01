import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { startServer, stopProcess, freePort } from './helpers.mjs';

const cwd = path.resolve(import.meta.dirname, '..'), password = 'Fictional-only-passphrase-91';
const procs = [], dirs = [];
// Each server gets its own temp dir; non-auth servers listen on port 0, auth servers (APP_ORIGIN needs the port) reserve one and retry on EADDRINUSE.
async function start(auth) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'workbench-perf-')); dirs.push(dir);
  if (auth) { const r = spawnSync(process.execPath, ['scripts/account-admin.mjs', 'create-admin', '--email', 'admin@example.invalid', '--name', 'Fictional admin'], { cwd, input: password + '\n', encoding: 'utf8', env: { ...process.env, HEALTH_DATA_DIR: dir } }); assert.equal(r.status, 0, r.stderr); }
  const env = { NODE_ENV: 'test', AUTH_REQUIRED: auth ? '1' : '0', APP_ORIGIN: '', HOST: '127.0.0.1', HEALTH_DATA_DIR: dir };
  if (!auth) { const s = await startServer({ cwd, env }); procs.push(s.proc); return s.base; }
  let last; for (let i = 0; i < 5; i++) { const port = await freePort(); try { const s = await startServer({ cwd, env: { ...env, APP_ORIGIN: 'http://127.0.0.1:' + port, PORT: String(port) } }); procs.push(s.proc); return s.base; } catch (e) { last = e; if (!/EADDRINUSE/.test(e.message)) throw e; } } throw last;
}
after(async () => { for (const p of procs) await stopProcess(p); for (const d of dirs) await rm(d, { recursive: true, force: true }); });
// fetch() always sends its own Accept-Encoding and decodes; use raw http to control negotiation.
const raw = (base, route, headers = {}, method = 'GET') => new Promise((resolve, reject) => { http.request(base + route, { method, headers }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); }).on('error', reject).end(); });

test('static assets negotiate br > gzip > identity with Vary and long cache kept', async () => {
  const base = await start(false);
  const html = (await raw(base, '/')).body.toString();
  const assets = [/href="(\/assets\/[^"]+\.css)"/.exec(html)[1], /src="(\/assets\/[^"]+\.js)"/.exec(html)[1]];
  for (const asset of assets) {
    const source = await readFile(path.join(cwd, 'public', asset.slice(1)));
    const br = await raw(base, asset, { 'Accept-Encoding': 'gzip, deflate, br' });
    assert.equal(br.headers['content-encoding'], 'br'); assert.equal(br.headers.vary, 'Accept-Encoding');
    assert.equal(br.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(Number(br.headers['content-length']), br.body.length);
    assert.ok(zlib.brotliDecompressSync(br.body).equals(source));
    const gz = await raw(base, asset, { 'Accept-Encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip'); assert.ok(zlib.gunzipSync(gz.body).equals(source));
    assert.equal((await raw(base, asset, { 'Accept-Encoding': 'br;q=0, gzip' })).headers['content-encoding'], 'gzip');
    const plain = await raw(base, asset);
    assert.equal(plain.headers['content-encoding'], undefined); assert.equal(plain.headers.vary, 'Accept-Encoding'); assert.ok(plain.body.equals(source));
    const head = await raw(base, asset, { 'Accept-Encoding': 'br' }, 'HEAD');
    assert.equal(head.headers['content-length'], br.headers['content-length']); assert.equal(head.body.length, 0);
  }
  const index = await raw(base, '/', { 'Accept-Encoding': 'br' });
  assert.equal(index.headers['content-encoding'], 'br'); assert.equal(index.headers['cache-control'], 'no-store');
  const png = await raw(base, '/app-icon-192.png', { 'Accept-Encoding': 'br, gzip' });
  assert.equal(png.headers['content-encoding'], undefined); assert.equal(png.headers.vary, undefined);
  const apiResponse = await raw(base, '/api/state', { 'Accept-Encoding': 'br, gzip' });
  assert.equal(apiResponse.headers['content-encoding'], undefined); assert.equal(apiResponse.headers['cache-control'], 'no-store');
});

test('bootstrap without accounts matches /api/auth/me + /api/state', async () => {
  const base = await start(false);
  const boot = await fetch(base + '/api/bootstrap?space=demo&workbench=health');
  assert.equal(boot.status, 200); assert.equal(boot.headers.get('cache-control'), 'no-store');
  const body = await boot.json(), state = await (await fetch(base + '/api/state?space=demo&workbench=health')).json();
  assert.deepEqual(body.me, await (await fetch(base + '/api/auth/me')).json());
  assert.deepEqual(Object.keys(body).sort(), ['me', 'state']);
  const { space, ...rest } = body.state; assert.equal(space, 'demo'); assert.deepEqual(rest, state);
  const missing = await (await fetch(base + '/api/bootstrap?workbench=nope')).json();
  assert.deepEqual(Object.keys(missing).sort(), ['me', 'state']); assert.equal(missing.state, null); assert.equal((await fetch(base + '/api/state?workbench=nope')).status, 404);
  assert.equal((await fetch(base + '/api/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 405);
});

test('bootstrap with accounts: unauthenticated gets only me, authenticated gets scoped data', async () => {
  const base = await start(true);
  const anon = await fetch(base + '/api/bootstrap');
  assert.equal(anon.status, 200); assert.equal(anon.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await anon.json(), { me: { enabled: true, user: null } });
  assert.deepEqual(await (await fetch(base + '/api/auth/me')).json(), { enabled: true, user: null });
  assert.equal((await fetch(base + '/api/state')).status, 401);
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ email: 'admin@example.invalid', password }) });
  assert.equal(login.status, 200);
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const body = await (await fetch(base + '/api/bootstrap?space=personal&workbench=health', { headers: { Cookie } })).json();
  const me = await (await fetch(base + '/api/auth/me', { headers: { Cookie } })).json();
  const state = await (await fetch(base + '/api/state?space=personal&workbench=health', { headers: { Cookie } })).json();
  assert.deepEqual(body.me, me); assert.equal(body.me.user.email, 'admin@example.invalid');
  assert.deepEqual(Object.keys(body).sort(), ['me', 'state']);
  const { space, ...rest } = body.state; assert.equal(space, 'personal'); assert.deepEqual(rest, state);
  const bad = await fetch(base + '/api/bootstrap', { headers: { Cookie: 'workbench_session=forged' } });
  assert.deepEqual(await bad.json(), { me: { enabled: true, user: null } });
});
