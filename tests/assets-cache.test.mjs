import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildPublic } from '../scripts/build-public.mjs';

const repository = path.resolve(import.meta.dirname, '..');
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-assets-'));
  const publicDir = path.join(root, 'public');
  await mkdir(publicDir);
  const styles = ['style', 'minimal', 'daily', 'mobile', 'account'];
  await Promise.all(styles.map(name => writeFile(path.join(publicDir, name + '.css'), `.${name}{color:green}`)));
  await writeFile(path.join(publicDir, 'index.html'), `<title>fixture</title>${styles.map(name => `<link rel="stylesheet" href="/${name}.css">`).join('')}<script type="module" src="/app.js"></script>`);
  await writeFile(path.join(publicDir, 'app.js'), "import { createA } from './a.js';\nimport { createB as renamed } from './b.js';\nawait Promise.resolve();\nglobalThis.__workbenchBundleFixture = createA() + renamed();\n");
  await writeFile(path.join(publicDir, 'a.js'), "import { shared } from './shared.js';\nconst local = 1;\nexport function createA(){return local + shared();}\n");
  await writeFile(path.join(publicDir, 'b.js'), "import { shared } from './shared.js';\nconst local = 2;\nexport function createB(){return local + shared();}\n");
  await writeFile(path.join(publicDir, 'shared.js'), 'export function shared(){return 10;}\n');
  return { root, publicDir };
}

test('public build is deterministic, isolates module scope, keeps await and old assets', async () => {
  const { root, publicDir } = await fixture();
  try {
    const first = await buildPublic(publicDir), html = await readFile(path.join(publicDir, 'index.html'), 'utf8');
    assert.deepEqual(await buildPublic(publicDir), first);
    assert.equal(await readFile(path.join(publicDir, 'index.html'), 'utf8'), html);
    assert.equal((html.match(/data-workbench-bundle=/g) || []).length, 2);
    assert.equal((await readdir(path.join(publicDir, 'assets'))).length, 2);
    const bundle = path.join(publicDir, first.javascript.slice(1));
    await import(pathToFileURL(bundle));
    assert.equal(globalThis.__workbenchBundleFixture, 23);
    delete globalThis.__workbenchBundleFixture;
    await writeFile(path.join(publicDir, 'shared.js'), 'export function shared(){return 20;}\n');
    const changed = await buildPublic(publicDir);
    assert.notEqual(changed.javascript, first.javascript);
    assert.equal(changed.stylesheet, first.stylesheet);
    assert.ok((await readFile(bundle)).length);
    await writeFile(path.join(publicDir, 'mobile.css'), '.mobile{color:blue}');
    assert.notEqual((await buildPublic(publicDir)).stylesheet, first.stylesheet);
    await writeFile(path.join(publicDir, 'app.js'), "import missing from './shared.js';\n");
    await assert.rejects(buildPublic(publicDir), /Unsupported module syntax/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('favicon is inlined deterministically and refreshed from its source', async () => {
  const { root, publicDir } = await fixture();
  try {
    const index = path.join(publicDir, 'index.html');
    const original = await readFile(index, 'utf8');
    await writeFile(index, `<link rel="icon" type="image/svg+xml" href="/favicon.svg">${original}`);
    const icon = '<svg xmlns="http://www.w3.org/2000/svg"><text>知衡 & test</text></svg>';
    await writeFile(path.join(publicDir, 'favicon.svg'), icon);
    const first = await buildPublic(publicDir);
    const html = await readFile(index, 'utf8');
    const uri = /<link rel="icon"[^>]*href="([^"]+)"/.exec(html)[1];
    assert.equal(decodeURIComponent(uri.slice('data:image/svg+xml,'.length)), icon);
    assert.equal(html.includes('href="/favicon.svg"'), false);
    assert.deepEqual(await buildPublic(publicDir), first);
    assert.equal(await readFile(index, 'utf8'), html);
    const changed = icon.replace('test', 'updated');
    await writeFile(path.join(publicDir, 'favicon.svg'), changed);
    assert.deepEqual(await buildPublic(publicDir), first);
    const updated = await readFile(index, 'utf8');
    assert.notEqual(updated, html);
    assert.ok(updated.includes(encodeURIComponent(changed)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('only matching public content hashes cache; HEAD, APIs and user files remain safe', async () => {
  const { root, publicDir } = await fixture();
  let proc;
  try {
    const built = await buildPublic(publicDir);
    await cp(path.join(repository, 'server.mjs'), path.join(root, 'server.mjs'));
    await cp(path.join(repository, 'lib'), path.join(root, 'lib'), { recursive: true });
    await cp(path.join(repository, 'migrations'), path.join(root, 'migrations'), { recursive: true });
    await writeFile(path.join(publicDir, 'manifest.webmanifest'), '{}');
    await writeFile(path.join(publicDir, 'service-worker.js'), '// no cache');
    const mismatch = `/assets/app.${'0'.repeat(64)}.js`;
    await writeFile(path.join(publicDir, mismatch.slice(1)), 'wrong content');
    const listener = net.createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    proc = spawn(process.execPath, [path.join(root, 'server.mjs')], { cwd: root, env: { ...process.env, NODE_ENV: 'test', AUTH_REQUIRED: '0', APP_ORIGIN: '', HOST: '127.0.0.1', PORT: String(port), HEALTH_DATA_DIR: path.join(root, 'data') }, stdio: 'ignore' });
    let ready = false;
    for (let n = 0; n < 100; n++) {
      if (proc.exitCode !== null) throw Error('isolated server exited');
      try { if ((await fetch(base + '/healthz')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.ok(ready, 'isolated server starts');
    for (const asset of [built.javascript, built.stylesheet]) {
      const get = await fetch(base + asset), head = await fetch(base + asset, { method: 'HEAD' });
      assert.equal(get.status, 200);
      assert.equal(get.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.equal(head.headers.get('cache-control'), get.headers.get('cache-control'));
      assert.equal(head.headers.get('content-length'), get.headers.get('content-length'));
      assert.equal(await head.text(), '');
    }
    for (const asset of ['/', '/app.js', '/style.css', '/manifest.webmanifest', '/service-worker.js', mismatch, '/api/state', '/api/files/missing', '/api/missing']) {
      const response = await fetch(base + asset);
      assert.equal(response.headers.get('cache-control'), 'no-store', asset);
    }
    const uploaded = await fetch(base + '/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'fictional.txt', content: Buffer.from('fictional user bytes').toString('base64') }) });
    assert.equal(uploaded.status, 201);
    const file = await uploaded.json(), response = await fetch(base + '/api/files/' + file.id);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), 'fictional user bytes');
    assert.equal(await (await fetch(base + '/', { method: 'HEAD' })).text(), '');
  } finally {
    if (proc && proc.exitCode === null) { proc.kill(); await new Promise(resolve => proc.once('exit', resolve)); }
    await rm(root, { recursive: true, force: true });
  }
});
