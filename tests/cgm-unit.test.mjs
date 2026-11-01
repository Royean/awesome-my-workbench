import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {migrateAccounts} from '../lib/accounts.mjs';
import {createCgm} from '../lib/cgm.mjs';
import {createSilite} from '../lib/cgm-silite.mjs';
const T=Date.parse('2026-11-01T13:00:00Z'),phone='13800001234',password='fictional-cgm-password',token='fictional-cgm-access-token';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const loginResponse=()=>response({code:200,data:{access_token:token,expires_in:1209600}});
function fixture(t){
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-cgm-')),db=new DatabaseSync(path.join(dataDir,'health.sqlite'));migrateAccounts(db);
 for(const id of ['a','b']){db.prepare('INSERT INTO users(id,email,name,role,disabled,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid','Fictional','user',0,T);db.prepare('INSERT INTO user_workbenches(user_id,id,name,type) VALUES(?,?,?,?)').run(id,'health','健康','health');db.prepare('INSERT INTO data_scopes VALUES(?,?,?,?)').run(id,'health','personal','account:'+id+':health:personal');}
 let time=T,rows=[{t:T-300000,v:5.4,s:1},{t:T-600000,v:5.2}],gate=null,fail=null;const calls=[];
 const fetchImpl=async(url,options)=>{calls.push({url,options});if(url.endsWith('/password/login'))return loginResponse();if(gate)await gate;if(fail)return fail();return response({code:200,data:{glucoseDataList:[{glucoseInfos:rows}]}});};
 const cgm=createCgm({db,dataDir,fetchImpl,now:()=>time});
 t.after(()=>{cgm.stop();db.close();fs.rmSync(dataDir,{recursive:true,force:true});});
 return {db,cgm,dataDir,calls,scope:'account:a:health:personal',other:'account:b:health:personal',setRows:v=>rows=v,setGate:v=>gate=v,setFail:v=>fail=v,setTime:v=>time=v};
}
const connect=(f,extra={})=>f.cgm.connect(f.scope,{provider:'silite',username:phone,password,consent:true,...extra});
test('CGM connect encrypts credentials, deduplicates corrections and keeps scopes separate',async t=>{
 const f=fixture(t),c=await connect(f);assert.equal(c.provider,'silite');assert.equal(c.accountMasked,'138****1234');assert.equal(c.count,2);assert.equal(c.enabled,true);
 let stored=f.db.prepare('SELECT * FROM cgm_connections').get();for(const value of [phone,password,token])assert.ok(!JSON.stringify(stored).includes(value));assert.equal(fs.statSync(path.join(f.dataDir,'cgm.key')).mode&0o777,0o600);
 assert.equal(f.cgm.connections(f.other).length,0);await assert.rejects(f.cgm.sync(f.other,c.id),e=>e.status===404);assert.throws(()=>f.cgm.pause(f.other,c.id),e=>e.status===404);
 f.setRows([{t:T-600000,v:5.3},{t:T-300000,v:5.4},{t:T-900000,v:5.1},{t:T-300000,v:5.5}]);const second=await connect(f);assert.equal(second.id,c.id);assert.equal(second.count,3);
 const data=f.cgm.readings(f.scope,{date:'2026-11-01'});assert.deepEqual(data.points.map(x=>x.value),[5.1,5.3,5.5]);assert.equal(data.summary.count,3);assert.equal(data.latest.value,5.5);assert.equal(data.stale,false);assert.equal(f.cgm.readings(f.other).summary.count,0);
 await assert.rejects(connect(f,{username:'13900001234'}),e=>e.code==='cgm_account_conflict');
 f.cgm.disconnect(f.scope,c.id);assert.equal(f.cgm.connections(f.scope).length,0);assert.equal(f.cgm.readings(f.scope,{date:'2026-11-01'}).summary.count,3);
 const next=await connect(f,{username:'13900001234'});assert.notEqual(next.id,c.id);assert.equal(next.count,3);assert.equal(f.db.prepare('SELECT count(distinct account_key) n FROM cgm_readings').get().n,2);
});
test('CGM validates explicit consent, account input, readings and Shanghai dates',async t=>{
 const f=fixture(t);
 for(const extra of [{consent:false},{username:'abc'},{password:''},{provider:'invented'}])await assert.rejects(connect(f,extra),e=>e.status===400);
 assert.equal(f.calls.length,0);
 f.setRows([{t:T-1000,v:5.1},{t:T-2000,v:0},{t:T-3000,v:1000},{t:'invalid',v:5},{t:T+600000,v:5}]);const c=await connect(f);assert.equal(c.skipped,4);assert.equal(c.count,1);
 assert.throws(()=>f.cgm.readings(f.scope,{date:'2026-02-30'}),e=>e.status===400);
 f.setRows([{t:Date.parse('2026-10-31T16:00:00Z'),v:4.4},{t:Date.parse('2026-10-31T15:59:59Z'),v:4.1}]);await f.cgm.sync(f.scope,c.id);
 assert.equal(f.cgm.readings(f.scope,{date:'2026-10-31'}).points.length,1);assert.equal(f.cgm.readings(f.scope,{date:'2026-11-01'}).points.length,2);
 f.setRows([{t:T,v:null}]);await assert.rejects(f.cgm.sync(f.scope,c.id),e=>e.code==='cgm_protocol_error');assert.equal(f.cgm.connections(f.scope)[0].count,3);
});
test('SiLite renewal checks HTTP-200 body code401, retries once and uses only fixed HTTPS routes',async()=>{
 let pulls=0,logins=0;const calls=[];
 const fetchImpl=async(url,opt)=>{calls.push({url,opt});if(url.endsWith('/password/login')){logins++;assert.deepEqual(JSON.parse(opt.body),{phone,password,appCode:'LITE_SENSE_APP'});return loginResponse();}pulls++;return pulls===1?response({code:401,msg:'untrusted secret'}):response({code:200,data:{glucoseInfos:[{t:T,v:5.8}]}});};
 const a=createSilite({fetchImpl,now:()=>T}),result=await a.collect({username:phone,password,token:'old',expiresAt:T+86400000});assert.equal(logins,1);assert.equal(pulls,2);assert.equal(result.points[0].value,5.8);
 for(const c of calls){assert.ok(c.url.startsWith('https://api.sisensing.com/'));assert.equal(c.opt.redirect,'error');assert.ok(c.opt.signal);}
 const always401=createSilite({now:()=>T,fetchImpl:async u=>u.endsWith('/password/login')?loginResponse():response({code:401,msg:password})});await assert.rejects(always401.collect({username:phone,password,token:'old',expiresAt:T+86400000}),e=>e.code==='cgm_token_expired'&&!e.message.includes(password));
 let first;const early=createSilite({now:()=>T,fetchImpl:async u=>{first??=u;return u.endsWith('/password/login')?loginResponse():response({code:200,data:{glucoseInfos:[]}});}});await early.collect({username:phone,password,token:'old',expiresAt:T+1000});assert.ok(first.endsWith('/password/login'));
});
test('CGM disconnect and pause cancel in-flight results without resurrecting secret or points',async t=>{
 const f=fixture(t),c=await connect(f);let release;const gate=new Promise(r=>release=r);f.setGate(gate);f.setRows([{t:T,v:6.2}]);
 const pending=f.cgm.sync(f.scope,c.id);await Promise.resolve();f.cgm.disconnect(f.scope,c.id);release();await assert.rejects(pending,e=>e.code==='cgm_connection_changed');assert.equal(f.db.prepare('SELECT count(*) n FROM cgm_connections').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM cgm_readings WHERE t=?').get(T).n,0);
 f.setGate(null);const again=await connect(f);let release2;f.setGate(new Promise(r=>release2=r));f.setRows([{t:T-100,v:6.4}]);const pausedPending=f.cgm.sync(f.scope,again.id);await Promise.resolve();f.cgm.pause(f.scope,again.id);release2();await assert.rejects(pausedPending,e=>e.code==='cgm_connection_changed');assert.equal(f.cgm.connections(f.scope)[0].status,'paused');assert.equal(f.db.prepare('SELECT count(*) n FROM cgm_readings WHERE t=?').get(T-100).n,0);
});
test('CGM revoked session or disabled account cannot commit delayed upstream data',async t=>{
 const f=fixture(t);let release,authorized=true;f.setGate(new Promise(r=>release=r));const pending=f.cgm.connect(f.scope,{provider:'silite',username:phone,password,consent:true},{isAuthorized:()=>authorized});await Promise.resolve();authorized=false;release();await assert.rejects(pending,e=>e.code==='cgm_session_changed');assert.equal(f.db.prepare('SELECT count(*) n FROM cgm_connections').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM cgm_readings').get().n,0);
 f.setGate(null);const c=await connect(f);const before=f.db.prepare('SELECT secret FROM cgm_connections').get().secret;let release2;f.setGate(new Promise(r=>release2=r));f.setRows([{t:T,v:7}]);const sync=f.cgm.sync(f.scope,c.id);await Promise.resolve();f.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run('a');release2();await assert.rejects(sync,e=>e.code==='cgm_scope_forbidden');assert.equal(f.db.prepare('SELECT secret FROM cgm_connections').get().secret,before);assert.equal(f.db.prepare('SELECT count(*) n FROM cgm_readings WHERE t=?').get(T).n,0);
});
test('CGM key survives restart and missing key never overwrites encrypted accounts',async t=>{
 const f=fixture(t),c=await connect(f),keyPath=path.join(f.dataDir,'cgm.key'),key=fs.readFileSync(keyPath);f.cgm.stop();
 const restarted=createCgm({db:f.db,dataDir:f.dataDir,now:()=>T,fetchImpl:async u=>u.endsWith('/password/login')?loginResponse():response({code:200,data:{glucoseInfos:[{t:T,v:5.9}]}})});await restarted.sync(f.scope,c.id);assert.deepEqual(fs.readFileSync(keyPath),key);assert.equal(restarted.readings(f.scope).latest.value,5.9);restarted.stop();
 fs.unlinkSync(keyPath);await assert.rejects(f.cgm.sync(f.scope,c.id),e=>e.code==='cgm_key_unavailable');assert.equal(fs.existsSync(keyPath),false);
 await assert.rejects(connect(f),e=>e.code==='cgm_key_unavailable');assert.equal(fs.existsSync(keyPath),false);
});
test('CGM upstream errors persist only safe status and bounded backoff',async t=>{
 const f=fixture(t),c=await connect(f);f.setFail(()=>response({code:401,msg:password}));await assert.rejects(f.cgm.sync(f.scope,c.id),e=>e.code==='cgm_token_expired');let safe=f.cgm.connections(f.scope)[0];assert.equal(safe.status,'reconnect_required');assert.ok(!JSON.stringify(safe).includes(password));
 f.setFail(()=>new Response('secret upstream body '+password,{status:429,headers:{'retry-after':'3600'}}));await assert.rejects(f.cgm.sync(f.scope,c.id),e=>e.code==='cgm_rate_limited');safe=f.cgm.connections(f.scope)[0];assert.equal(Date.parse(safe.nextSyncAt),T+3600000);assert.ok(!JSON.stringify(safe).includes(password));
});
test('CGM queued background work rechecks pause and disabled users before fetching',async t=>{
 const f=fixture(t),a=await connect(f),b=await f.cgm.connect(f.other,{provider:'silite',username:phone,password,consent:true});
 f.db.prepare('UPDATE cgm_connections SET next_sync_at=? WHERE id=?').run(T+300001,b.id);f.setTime(T+300002);
 let release;f.setGate(new Promise(r=>release=r));const before=f.calls.length;f.cgm.start();await Promise.resolve();
 assert.equal(f.calls.length,before+1);f.cgm.pause(f.other,b.id);release();
 for(let i=0;i<30&&f.cgm.connections(f.scope)[0].lastSyncAt===new Date(T).toISOString();i++)await new Promise(r=>setImmediate(r));
 assert.equal(f.cgm.connections(f.scope)[0].lastSyncAt,new Date(T+300002).toISOString());assert.equal(f.cgm.connections(f.other)[0].status,'paused');assert.equal(f.calls.length,before+1);
 f.cgm.stop();f.setGate(null);f.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run('a');f.setTime(T+900000);f.cgm.start();await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,before+1);f.cgm.stop();
});
test('CGM locks reject simultaneous same-scope connect and sync during reconnect',async t=>{
 const f=fixture(t);let release;f.setGate(new Promise(r=>release=r));const pending=connect(f);await Promise.resolve();await assert.rejects(connect(f),e=>e.code==='cgm_busy');release();const c=await pending;
 let release2;f.setGate(new Promise(r=>release2=r));const reconnect=connect(f);await Promise.resolve();await assert.rejects(f.cgm.sync(f.scope,c.id),e=>e.code==='cgm_busy');release2();await reconnect;
 let release3;f.setGate(new Promise(r=>release3=r));const sync=f.cgm.sync(f.scope,c.id);await Promise.resolve();await assert.rejects(connect(f),e=>e.code==='cgm_busy');release3();await sync;
});
test('SiLite rejects oversized or malformed upstream responses without leaking bodies',async()=>{
 const bad=[new Response('not-json '+password),response({code:200,data:{glucoseInfos:{}}}),response({code:200,data:{glucoseInfos:Array.from({length:10001},()=>({t:T,v:5}))}}),new Response('x'.repeat(5*1024*1024+1))];
 for(const upstream of bad){const a=createSilite({now:()=>T,fetchImpl:async()=>upstream});await assert.rejects(a.pull(token),e=>e.code==='cgm_protocol_error'&&!e.message.includes(password));}
 const a=createSilite({now:()=>T,timeoutMs:5,fetchImpl:async(_u,{signal})=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(Error('untrusted '+password)),{once:true});})});
 // Keep the event loop alive while the adapter's intentionally unref'ed timeout runs.
 const keep=setTimeout(()=>{},50);try{await assert.rejects(a.pull(token),e=>e.code==='cgm_upstream_unavailable'&&!e.message.includes(password));}finally{clearTimeout(keep);}
});
test('CGM partial upstream failures and credential replacement never overwrite a working connection',async t=>{
 const f=fixture(t),c=await connect(f),before=f.db.prepare('SELECT secret FROM cgm_connections').get().secret;
 f.setFail(()=>response({code:500,msg:password}));await assert.rejects(connect(f,{password:'fictional-replacement'}),e=>e.code==='cgm_upstream_unavailable');assert.equal(f.db.prepare('SELECT secret FROM cgm_connections').get().secret,before);assert.equal(f.cgm.connections(f.scope)[0].status,'connected');assert.equal(f.cgm.connections(f.scope)[0].count,2);
 f.setFail(null);const last=f.db.prepare('SELECT * FROM cgm_connections').get();assert.equal(last.id,c.id);
});

test('CGM disconnected historical fingerprints still require the original key',async t=>{
 const f=fixture(t),c=await connect(f),keyPath=path.join(f.dataDir,'cgm.key');
 f.cgm.disconnect(f.scope,c.id);assert.equal(f.db.prepare('SELECT count(*) n FROM cgm_connections').get().n,0);
 const originalKey=f.db.prepare('SELECT account_key FROM cgm_readings LIMIT 1').get().account_key;
 fs.unlinkSync(keyPath);await assert.rejects(connect(f),e=>e.code==='cgm_key_unavailable');
 assert.equal(fs.existsSync(keyPath),false);assert.equal(f.db.prepare('SELECT count(*) n FROM cgm_connections').get().n,0);
 assert.equal(f.db.prepare('SELECT account_key FROM cgm_readings LIMIT 1').get().account_key,originalKey);
 assert.equal(f.cgm.readings(f.scope,{date:'2026-11-01'}).summary.count,2);
});

test('SiLite flattens bounded myself device lists and rejects malformed nested shapes',async()=>{
 const read=data=>createSilite({now:()=>T,fetchImpl:async()=>response({code:200,data})}).pull(token);
 const r=await read({glucoseDataList:[{glucoseInfos:[{t:T-300000,v:5.2}]},{glucoseInfos:[{t:T,v:5.5}]}]});
 assert.deepEqual(r.points.map(p=>p.value),[5.2,5.5]);
 assert.deepEqual((await read({glucoseDataList:[]})).points,[]);
 assert.deepEqual((await read({glucoseDataList:[{glucoseInfos:null}]})).points,[]);
 for(const data of [{glucoseDataList:{}},{glucoseDataList:[null]},{glucoseDataList:[{glucoseInfos:{}}]},{glucoseDataList:[{glucoseInfos:Array(6000).fill({t:T,v:5})},{glucoseInfos:Array(4001).fill({t:T,v:5})}]},{glucoseDataList:Array(101).fill({})}])await assert.rejects(read(data),e=>e.code==='cgm_protocol_error');
});
