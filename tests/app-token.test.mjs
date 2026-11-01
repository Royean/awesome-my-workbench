// Native app Bearer sessions: token auth is exempt from the Origin check; cookie auth keeps the exact Host+Origin rules.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import {startServer,freePort} from './helpers.mjs';
import {digest} from '../lib/accounts.mjs';
const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-only-passphrase-91',email='app-admin@example.invalid';
let dir,server,base;
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'workbench-app-token-'));const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','Fictional app admin'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);const port=await freePort();server=await startServer({cwd,env:{NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir}});base=server.base;});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});
// Raw request: only the headers given are sent (Node fetch adds no Origin by itself).
async function req(route,{method='GET',body,headers={}}={}){const r=await fetch(base+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),setCookie:r.headers.get('set-cookie'),cacheControl:r.headers.get('cache-control')};}
const appLogin=(pw=password)=>req('/api/auth/app-login',{method:'POST',body:{email,password:pw}});
const bearer=t=>({Authorization:`Bearer ${t}`});
const db=()=>new DatabaseSync(path.join(dir,'health.sqlite'));

test('app login returns an opaque token (hash stored only), no cookie, and the bootstrap payload',async()=>{
 assert.equal((await appLogin('wrong-password-xx')).status,401);
 const r=await appLogin();assert.equal(r.status,200);assert.equal(r.setCookie,null);assert.equal(r.cacheControl,'private, no-store');
 assert.equal(r.body.tokenType,'Bearer');assert.match(r.body.token,/^[A-Za-z0-9_-]{43}$/);assert.ok(r.body.expiresAt>Date.now()+29*86400000);
 assert.equal(r.body.user.email,email);assert.equal(r.body.state.workbench.id,'health');
 const d=db();const row=d.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').get(digest(r.body.token));d.close();assert.ok(row);
 const d2=db();assert.equal(d2.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash=?').get(r.body.token).n,0);d2.close();
 // A foreign Origin on app login is still rejected.
 assert.equal((await req('/api/auth/app-login',{method:'POST',body:{email,password},headers:{Origin:'https://attacker.invalid'}})).status,403);
});
test('bearer works for /api/state, bootstrap, sessions and writes without Origin',async()=>{
 const {token}=(await appLogin()).body;
 const s=await req('/api/state',{headers:bearer(token)});assert.equal(s.status,200);assert.equal(s.setCookie,null);
 assert.equal((await req('/api/bootstrap?workbench=finance',{headers:bearer(token)})).body.state.workbench.id,'finance');
 const w=await req('/api/items',{method:'POST',body:{kind:'note',date:'2026-10-30',title:'App note'},headers:bearer(token)});assert.equal(w.status,201);
 assert.equal((await req('/api/items/'+w.body.id,{method:'PUT',body:{title:'App note 2',date:'2026-10-30'},headers:bearer(token)})).status,200);
 const list=await req('/api/auth/sessions',{headers:bearer(token)});assert.ok(list.body.sessions.some(x=>x.current));
});
test('cookie auth keeps the Origin rules: no Origin or cross-site is 403 even alongside a bearer header',async()=>{
 const login=await req('/api/auth/login',{method:'POST',body:{email,password},headers:{Origin:base}});assert.equal(login.status,200);const cookie=login.setCookie.split(';')[0];
 const note={kind:'note',date:'2026-10-30',title:'x'};
 assert.equal((await req('/api/items',{method:'POST',body:note,headers:{Cookie:cookie}})).status,403);
 assert.equal((await req('/api/items',{method:'POST',body:note,headers:{Cookie:cookie,Origin:'https://attacker.invalid'}})).status,403);
 assert.equal((await req('/api/items',{method:'POST',body:note,headers:{Cookie:cookie,Origin:base,'Sec-Fetch-Site':'cross-site'}})).status,403);
 const {token}=(await appLogin()).body;
 assert.equal((await req('/api/items',{method:'POST',body:note,headers:{Cookie:cookie,...bearer(token)}})).status,403);
 assert.equal((await req('/api/auth/login',{method:'POST',body:{email,password}})).status,403);
 assert.equal((await req('/api/items',{method:'POST',body:note,headers:{Cookie:cookie,Origin:base}})).status,201);
 // Host check still applies to bearer requests.
 const {request}=await import('node:http');const port=new URL(base).port;
 const status=await new Promise((ok,ko)=>{const r=request({host:'127.0.0.1',port,path:'/api/state',headers:{Host:'evil.invalid',...bearer(token)}},res=>{res.resume();ok(res.statusCode)});r.on('error',ko);r.end();});assert.equal(status,403);
});
test('invalid, expired and revoked tokens are 401; logout revokes the token',async()=>{
 assert.equal((await req('/api/state',{headers:bearer('A'.repeat(43))})).status,401);
 assert.equal((await req('/api/items',{method:'POST',body:{kind:'note',date:'2026-10-30',title:'x'},headers:bearer('A'.repeat(43))})).status,401);
 const expired=(await appLogin()).body.token;const d=db();d.prepare('UPDATE sessions SET expires_at=1 WHERE token_hash=?').run(digest(expired));d.close();assert.equal((await req('/api/state',{headers:bearer(expired)})).status,401);
 const a=(await appLogin()).body.token,b=(await appLogin()).body.token;
 const sessions=(await req('/api/auth/sessions',{headers:bearer(a)})).body.sessions;const other=sessions.find(x=>!x.current&&x.id);
 const d3=db();const bId=d3.prepare('SELECT id FROM sessions WHERE token_hash=?').get(digest(b)).id;d3.close();
 assert.ok(other);assert.equal((await req('/api/auth/sessions/'+bId,{method:'DELETE',body:{},headers:bearer(a)})).status,200);assert.equal((await req('/api/state',{headers:bearer(b)})).status,401);
 const out=await req('/api/auth/logout',{method:'POST',body:{},headers:bearer(a)});assert.equal(out.status,200);assert.equal(out.setCookie,null);
 assert.equal((await req('/api/state',{headers:bearer(a)})).status,401);
});
test('bearer sessions use the same sliding 30-day renewal without setting cookies',async()=>{
 const {token}=(await appLogin()).body;const day=86400000,life=30*day,stale=Date.now()+life-day-60000;
 const d=db();d.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(stale,digest(token));d.close();
 const before=Date.now();const r=await req('/api/state',{headers:bearer(token)});assert.equal(r.status,200);assert.equal(r.setCookie,null);
 const d2=db();const e=d2.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').get(digest(token)).expires_at;d2.close();assert.ok(e>=before+life);
});
