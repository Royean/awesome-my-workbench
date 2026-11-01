// Personal access tokens: minted/revoked only from a cookie web session (strict Origin), used via Authorization: Bearer.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import {startServer,freePort} from './helpers.mjs';
import {digest} from '../lib/accounts.mjs';
const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-only-passphrase-92',email='pat-admin@example.invalid';
let dir,server,base,cookie;
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'workbench-pat-'));const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','Fictional PAT admin'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);const port=await freePort();server=await startServer({cwd,env:{NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir}});base=server.base;
 const login=await req('/api/auth/login',{method:'POST',body:{email,password},headers:{Origin:base}});assert.equal(login.status,200);cookie=login.setCookie.split(';')[0];});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});
async function req(route,{method='GET',body,headers={}}={}){const r=await fetch(base+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),setCookie:r.headers.get('set-cookie'),cacheControl:r.headers.get('cache-control')};}
const web=()=>({Cookie:cookie,Origin:base});
const bearer=t=>({Authorization:`Bearer ${t}`});
const mint=(name='Test MCP')=>req('/api/auth/tokens',{method:'POST',body:{name},headers:web()});
const db=()=>new DatabaseSync(path.join(dir,'health.sqlite'));

test('owner mints a token from the web session; shown once, only its hash stored; listed with name/created/last used',async()=>{
 const r=await mint('Claude MCP');assert.equal(r.status,201);assert.match(r.body.token,/^zh_pat_[A-Za-z0-9_-]{43}$/);assert.equal(r.body.name,'Claude MCP');assert.equal(r.cacheControl,'private, no-store');
 const d=db();assert.ok(d.prepare('SELECT id FROM access_tokens WHERE token_hash=?').get(digest(r.body.token)));assert.equal(d.prepare('SELECT COUNT(*) n FROM access_tokens WHERE token_hash=?').get(r.body.token).n,0);d.close();
 let list=(await req('/api/auth/tokens',{headers:{Cookie:cookie}})).body.tokens;const t=list.find(x=>x.id===r.body.id);assert.equal(t.lastUsedAt,null);assert.equal(t.token,undefined);assert.equal(JSON.stringify(list).includes(r.body.token),false);
 assert.equal((await req('/api/state',{headers:bearer(r.body.token)})).status,200);
 list=(await req('/api/auth/tokens',{headers:{Cookie:cookie}})).body.tokens;assert.ok(list.find(x=>x.id===r.body.id).lastUsedAt>0);
 assert.equal((await mint('')).status,400);assert.equal((await mint('x'.repeat(41))).status,400);
});
test('token create/revoke require the cookie session with a same-site Origin; bearer cannot mint, list or revoke',async()=>{
 assert.equal((await req('/api/auth/tokens',{method:'POST',body:{name:'x'},headers:{Cookie:cookie}})).status,403);
 assert.equal((await req('/api/auth/tokens',{method:'POST',body:{name:'x'},headers:{Cookie:cookie,Origin:'https://attacker.invalid'}})).status,403);
 const {token,id}=(await mint()).body;
 assert.equal((await req('/api/auth/tokens',{method:'POST',body:{name:'x'},headers:bearer(token)})).status,403);
 assert.equal((await req('/api/auth/tokens',{headers:bearer(token)})).status,403);
 assert.equal((await req('/api/auth/tokens/'+id,{method:'DELETE',body:{},headers:bearer(token)})).status,403);
 assert.equal((await req('/api/auth/tokens/'+id,{method:'DELETE',body:{},headers:{Cookie:cookie}})).status,403);
 // Account/security endpoints are off-limits to tokens.
 for(const [route,method,body] of [['/api/auth/sessions','GET'],['/api/auth/users','GET'],['/api/auth/password','POST',{currentPassword:password,newPassword:'Another-fictional-pass-1'}],['/api/auth/profile','PATCH',{name:'x'}]])assert.equal((await req(route,{method,body,headers:bearer(token)})).status,403,route);
});
test('bearer token reads and writes /api/* without Origin; cookie rules unchanged; Host check applies',async()=>{
 const {token}=(await mint()).body;
 const w=await req('/api/items',{method:'POST',body:{kind:'water',date:'2026-10-30',title:'饮水',volume:300},headers:bearer(token)});assert.equal(w.status,201);
 assert.equal((await req('/api/items/'+w.body.id,{method:'PUT',body:{volume:400},headers:bearer(token)})).body.volume,400);
 assert.equal((await req('/api/items',{method:'POST',body:{kind:'note',date:'2026-10-30',title:'x'},headers:{Cookie:cookie,...bearer(token)}})).status,403);
 const {request}=await import('node:http');const port=new URL(base).port;
 const status=await new Promise((ok,ko)=>{const r=request({host:'127.0.0.1',port,path:'/api/state',headers:{Host:'evil.invalid',...bearer(token)}},res=>{res.resume();ok(res.statusCode)});r.on('error',ko);r.end();});assert.equal(status,403);
});
test('revoked, unknown and malformed tokens are 401; revoke via web works; disabling/password change revoke all tokens',async()=>{
 assert.equal((await req('/api/state',{headers:bearer('zh_pat_'+'A'.repeat(43))})).status,401);
 const a=(await mint()).body;assert.equal((await req('/api/auth/tokens/'+a.id,{method:'DELETE',body:{},headers:web()})).status,200);
 assert.equal((await req('/api/state',{headers:bearer(a.token)})).status,401);
 assert.equal((await req('/api/auth/tokens/'+a.id,{method:'DELETE',body:{},headers:web()})).status,404);
 const b=(await mint()).body;
 const ch=await req('/api/auth/password',{method:'POST',body:{currentPassword:password,newPassword:'Another-fictional-pass-2'},headers:web()});assert.equal(ch.status,200);
 assert.equal((await req('/api/state',{headers:bearer(b.token)})).status,401);
 assert.equal((await req('/api/auth/tokens',{headers:{Cookie:cookie}})).body.tokens.length,0);
});
test('token list exposes non-secret last4; legacy rows without last4 migrate safely',async()=>{
 const m=await mint('Tail');assert.equal(m.status,201);assert.equal(m.body.last4,m.body.token.slice(-4));
 const list=await req('/api/auth/tokens',{headers:web()});assert.equal(list.body.tokens.find(t=>t.id===m.body.id).last4,m.body.token.slice(-4));
 const {migrateAccounts}=await import('../lib/accounts.mjs');const legacy=new DatabaseSync(':memory:');
 legacy.exec("CREATE TABLE users(id TEXT PRIMARY KEY);CREATE TABLE access_tokens(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_used_at INTEGER);INSERT INTO users VALUES('u');INSERT INTO access_tokens VALUES('t','u','old','h',1,NULL);");
 migrateAccounts(legacy);migrateAccounts(legacy);assert.equal(legacy.prepare("SELECT last4 FROM access_tokens WHERE id='t'").get().last4,null);legacy.close();
});
