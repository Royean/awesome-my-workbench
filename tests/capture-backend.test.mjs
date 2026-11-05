// Isolated storage and fictional accounts/notifications only; never contacts a real financial source.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {request} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {startServer,freePort,waitFor} from './helpers.mjs';
import {digest} from '../lib/accounts.mjs';
const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-phone-capture-passphrase-93',email='capture-admin@example.invalid';
let dir,server,base,cookie,otherCookie,token,env;
const owners=new Map();
const fin=route=>route+'?workbench=finance&space=personal',health=route=>route+'?workbench=health&space=personal';
async function req(route,{method='GET',body,who=cookie,owner,headers={}}={}){
 const r=await fetch(base+route,{method,headers:{...(who?{Cookie:who}:{}),Origin:base,'Content-Type':'application/json',...(owner===null?{}:{'X-Workbench-Owner':owner??owners.get(who)??''}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,body:await r.json(),headers:r.headers};
}
async function login(address){const r=await req('/api/auth/login',{method:'POST',body:{email:address,password},who:''});assert.equal(r.status,200,JSON.stringify(r.body));const ck=r.headers.get('set-cookie').split(';')[0];owners.set(ck,r.body.user.id);return ck;}
const notification=(eventId,fields={})=>({deviceId:'fictional-device-a',eventId,packageName:'com.eg.android.AlipayGphone',title:'支付成功',text:'您向虚构商户支付12.34元',postedAt:'2026-11-05T10:00:00+08:00',...fields});
async function receive(eventId,fields={}){const r=await req(fin('/api/capture/notifications'),{method:'POST',body:notification(eventId,fields)});assert.ok([200,201].includes(r.status),JSON.stringify(r.body));return r.body;}
const confirmation=fields=>({title:'人工核对的虚构交易',date:'2026-11-05',amount:-12.34,currency:'CNY',transactionType:'expense',...fields});
const sync=(records,extra={})=>req(health('/api/capture/steps'),{method:'POST',body:{deviceId:'fictional-device-a',source:'health-connect',records,...extra}});
const syncHealth=(records,extra={},options={})=>req(health('/api/capture/health'),{method:'POST',body:{deviceId:'fictional-device-a',source:'health-connect',records,...extra},...options});
const records=(date,steps,observedAt='2026-11-05T03:00:00Z')=>[{date,steps,observedAt}];
function openDb(){return new DatabaseSync(path.join(dir,'health.sqlite'));}
before(async()=>{
 dir=await mkdtemp(path.join(os.tmpdir(),'workbench-capture-'));
 const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','Fictional collector'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);
 const port=await freePort();env={NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir,ZH_TEST_NOW:'2026-11-05T04:00:00Z'};
 server=await startServer({cwd,env});base=server.base;cookie=await login(email);
 token=(await req('/api/auth/tokens',{method:'POST',body:{name:'Fictional phone'}})).body.token;
 const invitation=await req('/api/auth/invitations',{method:'POST',body:{email:'capture-other@example.invalid',name:'Fictional second collector'}});assert.equal(invitation.status,201);
 assert.equal((await req('/api/auth/accept-invitation',{method:'POST',body:{token:invitation.body.token,password},who:''})).status,200);otherCookie=await login('capture-other@example.invalid');
});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});

test('capture requires login, strict owner on reads and writes, personal workbench scope, and existing Origin protection',async()=>{
 assert.equal((await req(fin('/api/capture'),{who:''})).status,401);
 for(const owner of [null,'stale-owner']){
  assert.equal((await req(fin('/api/capture'),{owner})).status,409);
  assert.equal((await req(health('/api/capture'),{owner})).status,409);
  assert.equal((await req(fin('/api/capture/notifications'),{method:'POST',owner,body:notification('unauthorized')})).status,409);
 }
 for(const query of ['workbench=finance&space=demo','workbench=health&space=demo','workbench=travel','workbench=finance&space=unknown'])assert.equal((await req('/api/capture?'+query)).status,403);
 assert.equal((await req(fin('/api/capture/steps'),{method:'POST',body:{}})).status,403);
 assert.equal((await req(health('/api/capture/notifications'),{method:'POST',body:notification('wrong-workbench')})).status,403);
 assert.equal((await req(fin('/api/capture/notifications'),{method:'POST',body:notification('evil-origin'),headers:{Origin:'https://evil.example.invalid'}})).status,403);
 const pat=await req(fin('/api/capture'),{who:'',owner:owners.get(cookie),headers:{Authorization:'Bearer '+token}});assert.equal(pat.status,200);assert.equal(pat.body.owner,owners.get(cookie));assert.equal(pat.body.supportedApps.length,8);
 const out=await receive('owner-scope');assert.equal((await req(fin('/api/capture'),{who:otherCookie})).body.events.length,0);
 assert.equal((await req(fin('/api/capture/events/'+out.event.id+'/confirm'),{method:'POST',who:otherCookie,body:confirmation()})).status,404);
 assert.equal((await req(fin('/api/capture'),{who:otherCookie,owner:owners.get(cookie)})).status,409);
 assert.equal((await req(fin('/api/capture')+'&limit=201')).status,400);
});

test('malicious, OTP, private-chat and non-whitelisted notices are rejected without retaining contents',async()=>{
 const cases=[
  {packageName:'com.example.privatechat'},
  {text:'您支付12.34元，验证码123456'},
  {text:'Your payment CNY12.34 verification code is 123456'},
  {packageName:'com.tencent.mm',title:'虚构朋友',text:'请支付12.34元'},
  {title:'虚构支付宝好友',text:'请支付12.34元'},
  {packageName:'com.tencent.mm',title:'微信支付',text:'虚构好友发来一条新消息：支付12.34元'},
  {text:'领取优惠券，支付12.34元'},
  {text:'交易状态已更新'},
  {text:'支付12,34元'},
  {text:'支付12.345元'},
  {text:'支付1e3元'},
  {title:'支付成功',text:'支付12.34元\u0000私密内容'},
 ];
 for(const [i,fields] of cases.entries()){
  const r=await req(fin('/api/capture/notifications'),{method:'POST',body:notification('filtered-'+i,fields)});assert.equal(r.status,400,JSON.stringify(r.body));assert.equal(r.body.code,'notification_filtered');
 }
 const d=openDb();assert.equal(d.prepare("SELECT COUNT(*) n FROM capture_notifications WHERE event_id LIKE 'filtered-%'").get().n,0);d.close();
 for(const postedAt of ['2026-02-30T10:00:00+08:00','2026-11-05T10:00:00','2026-11-05T25:00:00Z'])assert.equal((await req(fin('/api/capture/notifications'),{method:'POST',body:notification('bad-date',{postedAt})})).status,400);
});

test('concurrent delivery and pending notification updates share one receipt without creating a transaction',async()=>{
 const responses=await Promise.all(Array.from({length:8},()=>receive('concurrent')));
 assert.equal(new Set(responses.map(r=>r.event.id)).size,1);assert.equal(responses.filter(r=>!r.duplicate).length,1);
 assert.equal(responses[0].event.parsed.amount,-12.34);assert.equal(responses[0].event.parsed.type,'expense');
 const update=await receive('concurrent',{text:'您向虚构商户支付18.25元'});assert.equal(update.duplicate,true);assert.equal(update.event.parsed.amount,-18.25);
 const state=(await req(fin('/api/state'))).body;assert.equal(state.items.filter(x=>x.kind==='asset_transaction').length,0);
 const ambiguous=await receive('ambiguous',{text:'您消费12.34元，余额123.45元'});assert.equal(ambiguous.event.parsed.amount,undefined);
 const unknownType=await receive('unknown-type',{text:'交易成功，金额12.34元'});assert.equal(unknownType.event.parsed.type,undefined);
 const transfer=await receive('transfer-type',{title:'转账到账',text:'转账到账12.34元'});assert.equal(transfer.event.parsed.type,'transfer');
 const mixed=await receive('mixed-type',{text:'消费12.34元，退款处理中'});assert.equal(mixed.event.parsed.type,undefined);
 const list=(await req(fin('/api/capture')+'&limit=2&offset=0')).body;assert.equal(list.events.length,2);assert.ok(list.total>=3);
});

test('confirmation validates explicit fields and scope-safe references, is atomic and idempotent, and never adjusts assets',async()=>{
 const {event}=await receive('confirm');
 for(const body of [{},confirmation({amount:undefined}),confirmation({transactionType:'invented'}),confirmation({status:'pending'}),confirmation({date:'2026-11-06'}),confirmation({accountId:'other-account'})]){
  const r=await req(fin('/api/capture/events/'+event.id+'/confirm'),{method:'POST',body});assert.equal(r.status,400,JSON.stringify(r.body));
 }
 const account=await req(fin('/api/items'),{method:'POST',body:{kind:'asset_account',title:'虚构账户',currency:'CNY',date:'2026-11-05',balance:100,includeInTotal:true}});assert.equal(account.status,201);
 const confirmations=await Promise.all(Array.from({length:6},()=>req(fin('/api/capture/events/'+event.id+'/confirm'),{method:'POST',body:confirmation({amount:-14.56,accountId:account.body.id,balance:999,source:'forged',externalId:'forged'})})));
 for(const r of confirmations)assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(new Set(confirmations.map(r=>r.body.transaction.id)).size,1);assert.equal(confirmations.filter(r=>!r.body.duplicate).length,1);
 const transaction=confirmations[0].body.transaction;assert.equal(transaction.amount,-14.56);assert.equal(transaction.source,'手机交易通知');assert.equal(transaction.externalId,'phone-notification:'+event.id);assert.equal(transaction.balance,undefined);
 const updated=await receive('confirm',{text:'支付999.00元'});assert.equal(updated.event.parsed.amount,-12.34);assert.equal(updated.event.status,'confirmed');
 const again=await req(fin('/api/capture/events/'+event.id+'/confirm'),{method:'POST',body:confirmation({amount:999})});assert.equal(again.body.transaction.amount,-14.56);
 const state=(await req(fin('/api/state'))).body;assert.equal(state.items.find(x=>x.id===account.body.id).balance,100);assert.equal(state.items.filter(x=>x.id===transaction.id).length,1);
 assert.equal((await req(fin('/api/capture/events/'+event.id+'/ignore'),{method:'POST',body:{}})).status,409);
 await req(fin('/api/items/'+transaction.id),{method:'DELETE'});
 const deleted=await req(fin('/api/capture/events/'+event.id+'/confirm'),{method:'POST',body:confirmation()});assert.equal(deleted.status,200);assert.equal(deleted.body.transaction,null);assert.equal(deleted.body.event.transactionDeleted,true);
 assert.equal((await req('/api/trash/restore',{method:'POST',body:{id:transaction.id}})).status,200);
 assert.equal((await req(fin('/api/capture/events/'+event.id+'/confirm'),{method:'POST',body:{}})).body.transaction.id,transaction.id);
});

test('ignore is idempotent across retries and restart; duplicate hints never merge or suppress other channels',async()=>{
 const {event}=await receive('ignored');
 for(let i=0;i<2;i++)assert.equal((await req(fin('/api/capture/events/'+event.id+'/ignore'),{method:'POST',body:{}})).body.event.status,'ignored');
 assert.equal((await req(fin('/api/capture/events/'+event.id+'/confirm'),{method:'POST',body:confirmation()})).status,409);
 const another=await receive('other-channel',{deviceId:'fictional-device-b',packageName:'com.tencent.mm',title:'微信支付'});assert.ok(another.event.possibleDuplicateIds.length>0);assert.equal(another.event.status,'pending');
 await server.stop();server=await startServer({cwd,env});base=server.base;
 assert.equal((await receive('ignored')).event.status,'ignored');assert.equal((await receive('other-channel',{deviceId:'fictional-device-b',packageName:'com.tencent.mm',title:'微信支付'})).duplicate,true);
 const pending=(await req(fin('/api/capture')+'&status=pending&limit=1')).body;assert.equal(pending.events.length,1);assert.equal(pending.events[0].status,'pending');assert.equal(pending.total,pending.stats.pending);assert.ok(pending.stats.confirmed>0);assert.ok(pending.stats.ignored>0);
 assert.equal((await req(fin('/api/capture')+'&status=invalid')).status,400);
});

test('steps include zero, replace across devices by observation time, preserve manual records and expose source metadata',async()=>{
 const manual=await req(health('/api/items'),{method:'POST',body:{kind:'metric',title:'虚构手工步数',date:'2026-11-04',type:'steps',value:300}});assert.equal(manual.status,201,JSON.stringify(manual.body));
 const first=await sync(records('2026-11-04',0));assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.updated,1);const id=first.body.results[0].id;
 const zero=first.body.steps.find(x=>x.id===id);assert.equal(zero.value,0);assert.equal(zero.source,'health-connect');assert.equal(zero.deviceId,'fictional-device-a');assert.equal(zero.observedAt,'2026-11-05T03:00:00.000Z');
 const next=await sync(records('2026-11-04',1200,'2026-11-05T03:30:00Z'),{deviceId:'fictional-device-b'});assert.equal(next.body.results[0].id,id);assert.equal(next.body.steps.find(x=>x.id===id).value,1200);assert.equal(next.body.steps.find(x=>x.id===id).deviceId,'fictional-device-b');
 const old=await sync(records('2026-11-04',900,'2026-11-05T03:15:00Z'));assert.equal(old.body.updated,0);assert.equal(old.body.steps.find(x=>x.id===id).value,1200);
 const repeated=await Promise.all(Array.from({length:5},()=>sync(records('2026-11-04',1500,'2026-11-05T03:45:00Z'))));assert.equal(repeated.reduce((n,r)=>n+r.body.updated,0),1);
 const list=(await req(health('/api/capture'))).body;assert.equal(list.steps.filter(x=>x.source==='health-connect'&&x.date==='2026-11-04').length,1);assert.equal(list.steps.find(x=>x.id===manual.body.id).value,300);
 assert.equal(list.latestStep.id,id);assert.equal(list.latestStep.value,1500);
 const metric=(await req(health('/api/state'))).body.items.find(x=>x.id===id);assert.equal(metric.unit,'步');assert.equal(metric.observedAt,'2026-11-05T03:45:00.000Z');
 assert.equal((await req(health('/api/capture'),{who:otherCookie})).body.steps.length,0);
});

test('step batch validation is atomic and strict for future dates/times, invalid calendars, fractional values and range',async()=>{
 for(const [date,steps,observedAt] of [
  ['2026-11-06',0,'2026-11-05T03:00:00Z'],['2026-02-30',0,'2026-11-05T03:00:00Z'],
  ['2026-11-03',-1,'2026-11-05T03:00:00Z'],['2026-11-03',200001,'2026-11-05T03:00:00Z'],['2026-11-03',1.5,'2026-11-05T03:00:00Z'],['2026-11-03','100','2026-11-05T03:00:00Z'],
  ['2026-11-03',0,'2026-11-05T04:00:00.001Z'],['2026-11-03',0,'2026-11-05T03:00:00'],['2026-11-03',0,'2026-11-02T15:59:59Z'],
 ])assert.equal((await sync(records(date,steps,observedAt))).status,400);
 assert.equal((await sync([])).status,400);assert.equal((await sync(records('2026-11-03',10),{source:'unknown'})).status,400);
 const invalid=await sync([{date:'2026-11-03',steps:100,observedAt:'2026-11-05T03:00:00Z'},{date:'2026-11-03',steps:-1,observedAt:'2026-11-05T03:00:00Z'}]);assert.equal(invalid.status,400);
 assert.equal((await req(health('/api/capture'))).body.steps.filter(x=>x.date==='2026-11-03').length,0);
 assert.equal((await sync(records('2026-11-05',200000,'2026-11-05T04:00:00Z'))).status,200);
});

test('deleting collected steps does not resurrect on retry; restoring retains the same daily identity',async()=>{
 const first=await sync(records('2026-11-02',400));const id=first.body.results[0].id;
 assert.equal((await req(health('/api/items/'+id),{method:'DELETE'})).status,200);
 const retry=await sync(records('2026-11-02',500,'2026-11-05T03:30:00Z'));assert.equal(retry.body.results[0].status,'deleted');assert.ok(!retry.body.steps.some(x=>x.id===id));
 assert.equal((await req('/api/trash/restore',{method:'POST',body:{id}})).status,200);
 const restoreRetry=await sync(records('2026-11-02',600,'2026-11-05T03:45:00Z'));assert.equal(restoreRetry.body.results[0].id,id);assert.equal(restoreRetry.body.steps.find(x=>x.id===id).value,600);
});

test('revoking a session while its request body is pending prevents all capture mutation',async()=>{
 const loginResult=await req('/api/auth/app-login',{method:'POST',who:'',body:{email,password}});assert.equal(loginResult.status,200);const appToken=loginResult.body.token;
 const d=openDb();d.prepare('UPDATE sessions SET last_seen_at=1 WHERE token_hash=?').run(digest(appToken));
 const payload=JSON.stringify(notification('revoked-during-body'));
 const result=new Promise((resolve,reject)=>{
  const r=request(base+fin('/api/capture/notifications'),{method:'POST',headers:{Authorization:'Bearer '+appToken,'X-Workbench-Owner':owners.get(cookie),'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));});r.on('error',reject);r.write(payload.slice(0,20));
  (async()=>{await waitFor(()=>d.prepare('SELECT last_seen_at FROM sessions WHERE token_hash=?').get(digest(appToken))?.last_seen_at>1);d.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(appToken));r.end(payload.slice(20));})().catch(reject);
 });
 const out=await result;assert.equal(out.status,401);assert.equal(d.prepare("SELECT COUNT(*) n FROM capture_notifications WHERE event_id='revoked-during-body'").get().n,0);d.close();
});

const healthRecord=(kind,fields={})=>({sourceId:'fictional-'+kind,kind,date:'2026-11-03',observedAt:'2026-11-05T03:00:00Z',...fields});
const sessionRecord=fields=>healthRecord('exercise',{startAt:'2026-11-03T10:00:00+08:00',endAt:'2026-11-03T10:30:00+08:00',durationMinutes:30,distanceKm:2.5,exerciseType:'步行',...fields});
test('additional Health Connect records map to existing metrics and exercise with provenance, without modifying manual records',async()=>{
 const manual=await req(health('/api/items'),{method:'POST',body:{kind:'metric',title:'手工体重',date:'2026-11-03',type:'weight',value:65}});assert.equal(manual.status,201);
 const out=await syncHealth([healthRecord('weight',{value:64.5}),healthRecord('resting_heart_rate',{value:58}),healthRecord('sleep',{sourceId:'sleep:2026-11-03',value:7.25}),sessionRecord()]);
 assert.equal(out.status,200,JSON.stringify(out.body));assert.equal(out.body.updated,4);assert.equal(out.body.healthRecords.length,4);
 const byType=type=>out.body.healthRecords.find(x=>x.type===type);
 assert.equal(byType('weight').unit,'kg');assert.equal(byType('heart').unit,'次/分');assert.equal(byType('sleep').unit,'小时');assert.equal(byType('sleep').value,7.25);
 const exercise=byType('步行');assert.equal(exercise.kind,'exercise');assert.equal(exercise.duration,30);assert.equal(exercise.distance,2.5);assert.equal(exercise.time,'10:00');assert.equal(exercise.startAt,'2026-11-03T02:00:00.000Z');
 for(const record of out.body.healthRecords){assert.equal(record.source,'health-connect');assert.ok(record.sourceId);assert.equal(record.deviceId,'fictional-device-a');assert.equal(record.observedAt,'2026-11-05T03:00:00.000Z');}
 assert.equal((await req(health('/api/state'))).body.items.find(x=>x.id===manual.body.id).value,65);
 assert.equal((await req(health('/api/capture'),{who:otherCookie})).body.healthRecords.length,0);
 assert.equal((await syncHealth([healthRecord('weight',{value:60})],{}, {owner:'stale-owner'})).status,409);
 assert.equal((await req(fin('/api/capture/health'),{method:'POST',body:{}})).status,403);
});

test('daily health metrics replace across source IDs/devices, sessions deduplicate across devices, and older observations do not overwrite',async()=>{
 const old=(await req(health('/api/capture'))).body.healthRecords.find(x=>x.type==='weight');
 const next=await syncHealth([healthRecord('weight',{sourceId:'new-weight-measurement',value:64.1,observedAt:'2026-11-05T03:30:00Z'})],{deviceId:'fictional-device-b'});assert.equal(next.body.results[0].id,old.id);assert.equal(next.body.healthRecords.find(x=>x.id===old.id).sourceId,'new-weight-measurement');assert.equal(next.body.healthRecords.find(x=>x.id===old.id).deviceId,'fictional-device-b');
 const stale=await syncHealth([healthRecord('weight',{value:200,observedAt:'2026-11-05T03:15:00Z'})]);assert.equal(stale.body.updated,0);assert.equal(stale.body.healthRecords.find(x=>x.id===old.id).value,64.1);
 const concurrent=await Promise.all(Array.from({length:6},(_,i)=>syncHealth([sessionRecord({sourceId:'concurrent-session',observedAt:'2026-11-05T03:45:00Z'})],{deviceId:'fictional-device-'+i})));
 assert.equal(concurrent.reduce((n,r)=>n+r.body.updated,0),1);assert.equal(new Set(concurrent.map(r=>r.body.results[0].id)).size,1);
 const final=(await req(health('/api/capture'))).body.healthRecords;assert.equal(final.filter(x=>x.type==='weight'&&x.date==='2026-11-03').length,1);assert.equal(final.filter(x=>x.sourceId==='concurrent-session').length,1);
});

test('additional health batches reject unsupported types, invalid units/ranges/times, and roll back the whole batch',async()=>{
 const badRecords=[
  healthRecord('glucose',{value:5}),healthRecord('weight',{value:0}),healthRecord('weight',{value:1001}),healthRecord('weight',{value:64,unit:'lb'}),healthRecord('sleep',{value:25}),healthRecord('sleep',{value:'7'}),healthRecord('resting_heart_rate',{value:19}),healthRecord('resting_heart_rate',{value:58.5}),
  healthRecord('weight',{value:64,date:'2026-11-06'}),healthRecord('weight',{value:64,observedAt:'2026-11-05T04:00:00.001Z'}),healthRecord('weight',{value:64,sourceId:''}),
  sessionRecord({durationMinutes:0}),sessionRecord({durationMinutes:50}),sessionRecord({distanceKm:0}),sessionRecord({distanceKm:1001}),sessionRecord({exerciseType:1}),sessionRecord({endAt:'2026-11-03T09:59:00+08:00'}),sessionRecord({startAt:undefined}),
 ];
 for(const record of badRecords){const r=await syncHealth([record]);assert.equal(r.status,400,JSON.stringify({record,response:r.body}));}
 assert.equal((await syncHealth([])).status,400);
 const out=await syncHealth([healthRecord('weight',{date:'2026-11-01',sourceId:'batch-atomic',value:64}),healthRecord('sleep',{date:'2026-11-01',value:99})]);assert.equal(out.status,400);
 assert.ok(!(await req(health('/api/capture'))).body.healthRecords.some(x=>x.sourceId==='batch-atomic'));
});

test('health capture deletion retains a durable receipt and restoration preserves provenance and daily identity',async()=>{
 const out=await syncHealth([healthRecord('sleep',{date:'2026-11-01',sourceId:'sleep:2026-11-01',value:7})]);assert.equal(out.status,200,JSON.stringify(out.body));const id=out.body.results[0].id;
 await req(health('/api/items/'+id),{method:'DELETE'});
 const deleted=await syncHealth([healthRecord('sleep',{date:'2026-11-01',sourceId:'sleep:2026-11-01',value:8,observedAt:'2026-11-05T03:30:00Z'})]);assert.equal(deleted.body.results[0].status,'deleted');assert.ok(!deleted.body.healthRecords.some(x=>x.id===id));
 const restored=await req('/api/trash/restore',{method:'POST',body:{id}});assert.equal(restored.status,200);assert.equal(restored.body.sourceId,'sleep:2026-11-01');assert.equal(restored.body.source,'health-connect');
 const after=await syncHealth([healthRecord('sleep',{date:'2026-11-01',sourceId:'sleep:2026-11-01',value:7.5,observedAt:'2026-11-05T03:45:00Z'})]);assert.equal(after.body.results[0].id,id);assert.equal(after.body.healthRecords.find(x=>x.id===id).value,7.5);
});


test('active workout duration excludes pauses while retaining the full session boundaries',async()=>{
 const out=await syncHealth([sessionRecord({sourceId:'fictional-paused-session',durationMinutes:20})]);
 assert.equal(out.status,200,JSON.stringify(out.body));
 const saved=out.body.healthRecords.find(x=>x.sourceId==='fictional-paused-session');
 assert.equal(saved.duration,20);
 assert.equal((Date.parse(saved.endAt)-Date.parse(saved.startAt))/60000,30);
 assert.equal((await syncHealth([sessionRecord({sourceId:'fictional-invalid-duration',durationMinutes:35})])).status,400);
});


test('workout distance can be filled later and omission does not erase previously collected distance',async()=>{
 const sourceId='fictional-distance-permissions';
 const initial=await syncHealth([sessionRecord({sourceId,distanceKm:undefined,sourcePackage:'org.example.fitness',observedAt:'2026-11-05T03:00:00Z'})]);
 assert.equal(initial.status,200,JSON.stringify(initial.body));
 const id=initial.body.results[0].id;
 assert.equal(initial.body.healthRecords.find(x=>x.id===id).distance,undefined);
 const filled=await syncHealth([sessionRecord({sourceId,distanceKm:3,sourcePackage:'org.example.fitness',observedAt:'2026-11-05T03:10:00Z'})]);
 assert.equal(filled.body.healthRecords.find(x=>x.id===id).distance,3);
 assert.equal(filled.body.healthRecords.find(x=>x.id===id).sourcePackage,'org.example.fitness');
 const revoked=await syncHealth([sessionRecord({sourceId,distanceKm:undefined,sourcePackage:'org.example.fitness',observedAt:'2026-11-05T03:20:00Z'})]);
 assert.equal(revoked.body.healthRecords.find(x=>x.id===id).distance,3);
 const changed=await syncHealth([sessionRecord({sourceId,distanceKm:3.5,sourcePackage:'org.example.fitness',observedAt:'2026-11-05T03:30:00Z'})]);
 assert.equal(changed.body.healthRecords.find(x=>x.id===id).distance,3.5);
 assert.equal((await syncHealth([sessionRecord({sourceId,sourcePackage:'<script>'})])).status,400);
});
