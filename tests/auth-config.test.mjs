import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {startServer} from './helpers.mjs';
const cwd=path.resolve(import.meta.dirname,'..');let port;
const request=(route,options={})=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:route,method:options.method||'GET',headers:{Host:'example.invalid',...options.headers}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,ok:res.statusCode===200,cookie:res.headers['set-cookie']?.[0]}));});req.on('error',reject);if(options.body)req.write(options.body);req.end();});
test('production fails closed and password recovery CLI has no secret output',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'auth-config-'));
 try{
  for(const overrides of [{NODE_ENV:'production',AUTH_REQUIRED:'0',APP_ORIGIN:''},{NODE_ENV:'test',AUTH_REQUIRED:'0',APP_ORIGIN:'',HOST:'0.0.0.0'}]){const result=spawnSync(process.execPath,['server.mjs'],{cwd,encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir,...overrides}});assert.notEqual(result.status,0);}
  const password='Fictional-config-password-91';
  const cli=(command,input=password)=>spawnSync(process.execPath,['scripts/account-admin.mjs',command,'--email','config@example.invalid'],{cwd,input:input+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});
  assert.equal(cli('create-admin','short').status,1);const created=cli('create-admin');assert.equal(created.status,0,created.stderr);assert.ok(!created.stdout.includes(password));assert.equal(cli('create-admin').status,1);assert.equal(cli('reset-password').status,0);
  const server=await startServer({cwd,env:{NODE_ENV:'production',AUTH_REQUIRED:'0',APP_ORIGIN:'https://example.invalid',HEALTH_DATA_DIR:dir}});port=server.port;
  try{
   assert.equal((await request('/healthz')).status,200);
   const login=await request('/api/auth/login',{method:'POST',headers:{Host:'example.invalid',Origin:'https://example.invalid','Content-Type':'application/json'},body:JSON.stringify({email:'config@example.invalid',password})});assert.equal(login.status,200);const cookie=login.cookie;for(const flag of ['Secure','HttpOnly','SameSite=Lax'])assert.ok(cookie.includes(flag));assert.equal((await request('/api/state')).status,401);
  }finally{await server.stop();}
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('first administrator invitation is passwordless, hashed, one-time and only emitted at creation',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'auth-first-invite-'));
 try{
  const result=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin-invitation','--email','first@example.invalid','--name','First'],{cwd,encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(result.status,0,result.stderr);const {token,expiresAt}=JSON.parse(result.stdout);assert.ok(token.length>=40);assert.ok(expiresAt>Date.now());const db=new DatabaseSync(path.join(dir,'health.sqlite'));assert.equal(db.prepare('SELECT password_hash FROM users').get().password_hash,null);assert.equal(db.prepare('SELECT token_hash FROM invitations').get().token_hash,createHash('sha256').update(token).digest('hex'));db.close();const again=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin-invitation','--email','second@example.invalid'],{cwd,encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(again.status,1);assert.ok(!again.stdout.includes(token));
 }finally{await rm(dir,{recursive:true,force:true});}
});
