import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import {startServer} from './helpers.mjs';
const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-origins-password-91';
const MAIN='https://main.example.invalid',DIRECT='https://direct.example.invalid';
const request=(port,route,{method='GET',host,origin,body}={})=>new Promise((resolve,reject)=>{const headers={Host:host};if(origin)headers.Origin=origin;if(body)headers['Content-Type']='application/json';const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,cookie:res.headers['set-cookie']?.[0],hsts:res.headers['strict-transport-security']}));});req.on('error',reject);if(body)req.write(body);req.end();});
const login=(port,host,origin)=>request(port,'/api/auth/login',{method:'POST',host,origin,body:JSON.stringify({email:'origins@example.invalid',password})});
async function withServer(env,fn){const dir=await mkdtemp(path.join(os.tmpdir(),'extra-origins-'));try{const cli=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email','origins@example.invalid'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(cli.status,0,cli.stderr);const s=await startServer({cwd,env:{NODE_ENV:'production',AUTH_REQUIRED:'0',HEALTH_DATA_DIR:dir,...env}});try{await fn(s.port);}finally{await s.stop();}}finally{await rm(dir,{recursive:true,force:true});}}

test('APP_EXTRA_ORIGINS: both hosts serve health and login; foreign, mismatched and unknown hosts/origins are rejected',async()=>{
 await withServer({APP_ORIGIN:MAIN,APP_EXTRA_ORIGINS:` ${DIRECT} `},async port=>{
  for(const o of [MAIN,DIRECT]){const host=new URL(o).host;const h=await request(port,'/healthz',{host});assert.equal(h.status,200);assert.ok(h.hsts);
   const l=await login(port,host,o);assert.equal(l.status,200,o);for(const f of ['Secure','HttpOnly','SameSite=Lax'])assert.ok(l.cookie.includes(f));assert.ok(!/domain=/i.test(l.cookie),'host-only cookie');}
  assert.equal((await login(port,'direct.example.invalid','https://attacker.invalid')).status,403);
  assert.equal((await login(port,'direct.example.invalid',MAIN)).status,403);
  assert.equal((await login(port,'main.example.invalid',DIRECT)).status,403);
  assert.equal((await login(port,'direct.example.invalid',undefined)).status,403);
  assert.equal((await request(port,'/healthz',{host:'unknown.example.invalid'})).status,403);
  assert.equal((await login(port,'unknown.example.invalid','https://unknown.example.invalid')).status,403);
 });
});

test('without APP_EXTRA_ORIGINS behavior is unchanged',async()=>{
 await withServer({APP_ORIGIN:MAIN,APP_EXTRA_ORIGINS:''},async port=>{
  assert.equal((await request(port,'/healthz',{host:'main.example.invalid'})).status,200);assert.equal((await login(port,'main.example.invalid',MAIN)).status,200);
  assert.equal((await request(port,'/healthz',{host:'direct.example.invalid'})).status,403);assert.equal((await login(port,'direct.example.invalid',DIRECT)).status,403);
 });
});

test('invalid APP_EXTRA_ORIGINS fails startup',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'extra-origins-bad-'));
 try{for(const [extra,base] of [['not a url',MAIN],['http://direct.example.invalid',MAIN],['https://direct.example.invalid/',MAIN],['https://direct.example.invalid/path',MAIN],[`${DIRECT},ftp://x.invalid`,MAIN],['http://127.0.0.1:1',MAIN],[DIRECT,'']]){
  const r=spawnSync(process.execPath,['server.mjs'],{cwd,encoding:'utf8',timeout:10000,env:{...process.env,NODE_ENV:'production',AUTH_REQUIRED:'0',PORT:'0',HEALTH_DATA_DIR:dir,APP_ORIGIN:base,APP_EXTRA_ORIGINS:extra}});assert.notEqual(r.status,0,extra);assert.equal(r.signal,null,extra);}}
 finally{await rm(dir,{recursive:true,force:true});}
});
