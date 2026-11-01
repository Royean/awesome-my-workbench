import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import {startServer,stopProcess,freePort,waitFor} from './helpers.mjs';
import {createLimiter} from '../lib/accounts.mjs';
let base;const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-only-passphrase-91';
let dir,proc,adminCookie,userCookie,userId,adminId;
// APP_ORIGIN must include the port, so reserve one per start; retry only if another process grabbed it.
async function start(){let last;for(let attempt=0;attempt<5;attempt++){const port=await freePort();const origin=`http://127.0.0.1:${port}`;try{const s=await startServer({cwd,env:{NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:origin,PORT:String(port),HEALTH_DATA_DIR:dir}});proc=s.proc;base=s.base;return;}catch(e){last=e;if(!/EADDRINUSE/.test(e.message))throw e;}}throw last;}
async function stop(){await stopProcess(proc);proc=undefined;}
async function api(route,{method='GET',body,cookie=adminCookie,origin=base,headers={}}={}){const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();return {status:response.status,body:value,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
const login=(email='admin@example.invalid')=>api('/api/auth/login',{method:'POST',body:{email,password},cookie:null});
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'auth-workbench-'));const legacy=new DatabaseSync(path.join(dir,'health.sqlite'));legacy.exec("CREATE TABLE items(id TEXT PRIMARY KEY,space TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL); CREATE TABLE workbenches(id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL); INSERT INTO items VALUES('legacy-private','personal','note','{\"title\":\"Legacy private\",\"date\":\"2026-10-30\"}'); INSERT INTO workbenches VALUES('legacy-custom','Legacy custom','other');");legacy.close();const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email','admin@example.invalid','--name','Fictional admin'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);assert.ok(!setup.stdout.includes(password));await start();});
after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
test('authentication, strict origin and session persistence',async()=>{
 assert.equal((await api('/api/state',{cookie:null})).status,401);assert.equal((await api('/api/auth/me',{cookie:null})).body.enabled,true);
 assert.equal((await api('/api/auth/login',{method:'POST',origin:'https://attacker.invalid',body:{email:'admin@example.invalid',password}})).status,403);
 assert.equal((await api('/api/auth/login',{method:'POST',origin:'',body:{}})).status,403);
 assert.equal((await api('/api/auth/login',{method:'POST',body:{email:'admin@example.invalid',password:'wrong'}})).status,401);
 const logged=await login();assert.equal(logged.status,200);adminCookie=logged.cookie;adminId=logged.body.user.id;assert.ok(!JSON.stringify(logged.body).includes('password_hash'));
 assert.equal((await api('/api/state')).body.settings.name,'Fictional admin');assert.equal((await api('/api/state')).body.items.length,0);assert.equal((await api('/api/workbenches')).body.workbenches.some(x=>x.id==='legacy-custom'),false);await stop();await start();assert.equal((await api('/api/auth/me')).body.user.email,'admin@example.invalid');
 const sessions=await api('/api/auth/sessions');assert.equal(sessions.body.sessions.length,1);assert.equal(sessions.body.sessions[0].current,true);
 const db=new DatabaseSync(path.join(dir,'health.sqlite'));const row=db.prepare('SELECT token_hash FROM sessions').get();assert.notEqual(row.token_hash,adminCookie.split('=')[1]);db.close();
});
test('invitation expiry, one-time acceptance and isolated accounts/workbenches/files',async()=>{
 const expired=await api('/api/auth/invitations',{method:'POST',body:{email:'expired@example.invalid',name:'Expired'}});const db=new DatabaseSync(path.join(dir,'health.sqlite'));db.prepare('UPDATE invitations SET expires_at=0 WHERE user_id=(SELECT id FROM users WHERE email=?)').run('expired@example.invalid');db.close();assert.equal((await api('/api/auth/accept-invitation',{method:'POST',cookie:null,body:{token:expired.body.token,password}})).status,400);
 const inv=await api('/api/auth/invitations',{method:'POST',body:{email:'member@example.invalid',name:'Member'}});assert.equal(inv.status,201);const accepted=await api('/api/auth/accept-invitation',{method:'POST',cookie:null,body:{token:inv.body.token,password,name:'Member'}});assert.equal(accepted.status,200);userCookie=accepted.cookie;userId=accepted.body.user.id;assert.equal((await api('/api/auth/accept-invitation',{method:'POST',cookie:null,body:{token:inv.body.token,password}})).status,400);
 assert.equal((await api('/api/auth/users',{cookie:userCookie})).status,403);
 const note=await api('/api/items',{method:'POST',body:{kind:'note',date:'2026-10-30',title:'Private admin'}});assert.equal(note.status,201);
 const file=await api('/api/upload',{method:'POST',body:{name:'fictional.txt',date:'2026-10-30',content:Buffer.from('private admin bytes').toString('base64')}});assert.equal(file.status,201);
 const state=await api('/api/state?user_id='+adminId,{cookie:userCookie});assert.equal(state.body.items.length,0);
 for(const method of ['PUT','DELETE'])assert.equal((await api('/api/items/'+note.body.id,{method,cookie:userCookie,body:{title:'stolen'}})).status,404);
 assert.equal((await api('/api/files/'+file.body.id,{cookie:userCookie})).status,404);
 const content=await fetch(base+'/api/files/'+file.body.id,{headers:{Cookie:adminCookie}});assert.equal(await content.text(),'private admin bytes');
 assert.equal((await api('/api/state?space=demo')).body.items.length,0);
 await api('/api/settings',{method:'PUT',body:{name:'Admin private',focus:'private'}});assert.notEqual((await api('/api/state',{cookie:userCookie})).body.settings.name,'Admin private');
 const custom=await api('/api/workbenches',{method:'POST',body:{type:'other',name:'Admin only'}});assert.equal((await api('/api/state?workbench='+custom.body.id,{cookie:userCookie})).status,404);
 await api('/api/items/'+note.body.id,{method:'DELETE',body:{}});assert.equal((await api('/api/restore',{method:'POST',cookie:userCookie,body:{id:note.body.id}})).status,404);
});
test('password/session revocation, user disable, reset invitation and last administrator',async()=>{
 const another=await login('member@example.invalid');assert.equal(another.status,200);
 assert.equal((await api('/api/auth/password',{method:'POST',cookie:userCookie,body:{currentPassword:password,newPassword:'Next-fictional-password-29'}})).status,200);
 assert.equal((await api('/api/state',{cookie:another.cookie})).status,401);
 assert.equal((await api('/api/state',{cookie:userCookie})).status,200);
 const profile=await api('/api/auth/profile',{method:'PATCH',cookie:userCookie,body:{name:'New name',role:'admin'}});assert.equal(profile.body.user.role,'user');
 assert.equal((await api('/api/auth/users/'+adminId,{method:'PATCH',body:{disabled:true}})).status,409);assert.equal((await api('/api/auth/users/'+adminId+'/reset-invitation',{method:'POST',body:{}})).status,409);assert.equal((await api('/api/state')).status,200);
 assert.equal((await api('/api/auth/users/'+userId,{method:'PATCH',body:{disabled:true}})).status,200);assert.equal((await api('/api/state',{cookie:userCookie})).status,401);
 const reset=await api('/api/auth/users/'+userId+'/reset-invitation',{method:'POST',body:{}});assert.equal(reset.status,200);
 const accepted=await api('/api/auth/accept-invitation',{method:'POST',cookie:null,body:{token:reset.body.token,password}});assert.equal(accepted.status,200);userCookie=accepted.cookie;
 assert.equal((await api('/api/auth/logout',{method:'POST',cookie:userCookie,body:{}})).status,200);assert.equal((await api('/api/state',{cookie:userCookie})).status,401);
});
test('revoking an authenticated session or disabling a user during a streamed body prevents writes',async()=>{
 async function pending(cookie){
  const db=new DatabaseSync(path.join(dir,'health.sqlite'));const session=db.prepare('SELECT id,last_seen_at FROM sessions WHERE token_hash=?').get((await import('../lib/accounts.mjs')).digest(cookie.split('=')[1]));
  // last_seen_at must be observably newer once the server authenticates this request.
  await waitFor(()=>Date.now()>session.last_seen_at);
  let resolveResponse,rejectResponse;const response=new Promise((resolve,reject)=>{resolveResponse=resolve;rejectResponse=reject;});
  const req=http.request(base+'/api/items',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie}},res=>{let value='';res.on('data',x=>value+=x);res.on('end',()=>resolveResponse({status:res.statusCode,body:JSON.parse(value)}));});req.on('error',rejectResponse);req.write('{');
  try{await waitFor(()=>db.prepare('SELECT last_seen_at FROM sessions WHERE id=?').get(session.id)?.last_seen_at>session.last_seen_at,{timeoutMs:10000,message:'server must authenticate before revocation'});}finally{db.close();}
  return {req,response,sessionId:session.id};
 }
 const body='"kind":"note","title":"Revoked in flight","date":"2026-10-30"}';
 for(const action of ['disable','revoke']){
  const member=await login('member@example.invalid');assert.equal(member.status,200);const stream=await pending(member.cookie);
  if(action==='disable')assert.equal((await api('/api/auth/users/'+userId,{method:'PATCH',body:{disabled:true}})).status,200);
  else assert.equal((await api('/api/auth/sessions/'+stream.sessionId,{method:'DELETE',cookie:member.cookie,body:{}})).status,200);
  stream.req.end(body);assert.equal((await stream.response).status,401);
  if(action==='disable')assert.equal((await api('/api/auth/users/'+userId,{method:'PATCH',body:{disabled:false}})).status,200);
  const fresh=await login('member@example.invalid');assert.equal((await api('/api/state',{cookie:fresh.cookie})).body.items.some(x=>x.title==='Revoked in flight'),false);
 }
 const users=(await api('/api/auth/users')).body.users;assert.equal(users.find(x=>x.id===adminId).activated,true);assert.equal(users.find(x=>x.email==='expired@example.invalid').activated,false);assert.ok(!JSON.stringify(users).includes('password_hash'));
});
test('hash concurrency is bounded and session deletion cannot cross accounts',async()=>{
 // Exact 503 counts depend on scheduling; the limiter itself is verified deterministically below.
 const results=await Promise.all([login(),login(),login()]);assert.ok(results.every(x=>[200,503].includes(x.status)));assert.ok(results.some(x=>x.status===200));
 const member=await login('member@example.invalid');const otherSession=(await api('/api/auth/sessions',{cookie:member.cookie})).body.sessions[0];
 assert.equal((await api('/api/auth/sessions/'+otherSession.id,{method:'DELETE',body:{}})).status,404);
 assert.equal((await api('/api/auth/sessions/'+otherSession.id,{method:'DELETE',cookie:member.cookie,body:{}})).status,200);
 assert.equal((await api('/api/state',{cookie:member.cookie})).status,401);
});
test('hash limiter rejects beyond capacity without timing assumptions',async()=>{
 const gates=[];const limited=createLimiter(2,()=>new Promise(r=>gates.push(r)));
 const a=limited(),b=limited();assert.equal(limited.active,2);
 await assert.rejects(limited(),e=>e.status===503);
 gates[0]('a');assert.equal(await a,'a');assert.equal(limited.active,1);
 const c=limited();assert.equal(limited.active,2);gates[1]('b');gates[2]('c');assert.deepEqual([await b,await c],['b','c']);assert.equal(limited.active,0);
});
test('rate limit survives restart',async()=>{
 // Own data dir and server so earlier tests' failed attempts cannot affect counters.
 const own=await mkdtemp(path.join(os.tmpdir(),'auth-ratelimit-'));const saved={dir,proc,base};await stop();dir=own;
 try{await start();
 for(let i=0;i<5;i++)assert.equal((await api('/api/auth/login',{method:'POST',cookie:null,body:{email:'missing@example.invalid',password:'invalid'}})).status,401);
 await stop();await start();assert.equal((await api('/api/auth/login',{method:'POST',cookie:null,body:{email:'missing@example.invalid',password:'invalid'}})).status,429);
 }finally{await stop();await rm(own,{recursive:true,force:true});dir=saved.dir;}
});
