// Independent public-API acceptance derived from docs/PHONE_CAPTURE.md.
// Run after implementation handoff with Node >=24; never targets an existing service/database.
// This is not evidence of Android notification permissions, offline queue, or Health Connect operation.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {freePort,startServer,stopProcess} from './helpers.mjs';

const cwd=path.resolve(import.meta.dirname,'..');
async function inputFingerprint(){const git=spawnSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd,encoding:'utf8'});assert.equal(git.status,0);const files=git.stdout.split('\0').filter(p=>p==='server.mjs'||/^(?:lib|public)\/.*\.(?:mjs|js|css|html)$/.test(p)).sort();const hash=createHash('sha256');for(const file of files){hash.update(file+'\0');try{hash.update(await readFile(path.join(cwd,file)))}catch(error){if(error.code!=='ENOENT')throw error;hash.update('<deleted>')}hash.update('\0')}return hash.digest('hex');}
const inputBefore=await inputFingerprint();console.log('INPUT_FINGERPRINT '+inputBefore);
const port=await freePort(),base=`http://127.0.0.1:${port}`;
const dataDir=await mkdtemp(path.join(os.tmpdir(),'phone-capture-independent-'));
const password=randomBytes(24).toString('base64url');
const finance='?workbench=finance&space=personal',health='?workbench=health&space=personal';
const checks=[];let server,A,B,confirmed,ignored;
const env={NODE_ENV:'test',AUTH_REQUIRED:'1',HOST:'127.0.0.1',APP_ORIGIN:base,PORT:String(port),HEALTH_DATA_DIR:dataDir,ZH_TEST_NOW:'2026-11-05T04:00:00Z'};
const event=(id,extra={})=>({deviceId:'independent-fictional-device',eventId:id,packageName:'com.eg.android.AlipayGphone',title:'支付成功',text:'您向虚构验收商户支付12.34元',postedAt:'2026-11-04T12:34:00+08:00',...extra});
const confirmation=(title='独立验收已核对流水')=>({kind:'asset_transaction',title,date:'2026-11-04',currency:'CNY',amount:14.56,transactionType:'expense',status:'confirmed',note:'虚构测试，人工核对修正金额'});
async function api(route,{as=A,method='GET',body,owner=as?.id,origin=base}={}){
 const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(as?.cookie?{Cookie:as.cookie}:{}),...(owner===undefined?{}:{'X-Workbench-Owner':owner}),...(origin===undefined?{}:{Origin:origin})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const raw=await response.text();let value;try{value=JSON.parse(raw)}catch{value={nonJson:raw.slice(0,200)}}
 return {status:response.status,body:value,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
function ok(r,label){assert.ok([200,201].includes(r.status),`${label}: HTTP ${r.status} ${JSON.stringify(r.body)}`);return r.body;}
function rejected(r,label){assert.ok(r.status>=400&&r.status<500,`${label}: expected 4xx, got ${r.status} ${JSON.stringify(r.body)}`);}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function start(){server=await startServer({cwd,env});}
async function stop(){await stopProcess(server?.proc);server=undefined;}
async function capture(id,extra={}){return api('/api/capture/notifications'+finance,{method:'POST',body:event(id,extra)});}
async function state(scope=finance,as=A){return ok(await api('/api/state'+scope,{as}),'state').items;}
async function list(scope=finance,as=A){return ok(await api('/api/capture'+scope,{as}),'capture list');}
async function steps(records,extra={}){return api('/api/capture/steps'+health,{method:'POST',body:{deviceId:'independent-fictional-device',source:'health-connect',records,...extra}});}
const step=(value,observedAt='2026-11-04T22:00:00+08:00')=>({date:'2026-11-04',steps:value,observedAt});

async function healthAcceptance(){
 const sync=(records,options={})=>api('/api/capture/health'+health,{method:'POST',body:{deviceId:'independent-fictional-device',source:'health-connect',records},...options});
 const record=(kind,value,extra={})=>({sourceId:'independent-'+kind,sourcePackage:'invalid.example.synthetic_health',kind,date:'2026-11-04',observedAt:'2026-11-04T22:00:00+08:00',...(value===undefined?{}:{value}),...extra});
 const exercise=record('exercise',undefined,{sourceId:'independent-session-1',startAt:'2026-11-04T09:00:00+08:00',endAt:'2026-11-04T09:30:00+08:00',durationMinutes:30,distanceKm:2.4,exerciseType:'步行',route:[{latitude:0,longitude:0}]});
 const fixtures=[record('weight',70.5),record('resting_heart_rate',58),record('sleep',7.25,{date:'2026-11-05',observedAt:'2026-11-05T08:00:00+08:00'}),exercise];
 const manual=ok(await api('/api/items'+health,{method:'POST',body:{kind:'metric',type:'weight',title:'虚构手工体重',date:'2026-11-04',value:80,unit:'kg'}}),'manual weight');
 ok(await sync(fixtures),'four health kinds');let records=(await list(health)).healthRecords;assert.equal(records.length,4);
 for(const fixture of fixtures){const saved=records.find(x=>x.sourceId===fixture.sourceId);assert.ok(saved,fixture.kind+' missing');assert.equal(saved.source,'health-connect');assert.equal(saved.sourcePackage,fixture.sourcePackage);assert.equal(saved.deviceId,'independent-fictional-device');assert.equal(saved.date,fixture.date);assert.ok(saved.observedAt);}
 assert.equal(records.find(x=>x.sourceId==='independent-weight').unit,'kg');const heart=records.find(x=>x.sourceId==='independent-resting_heart_rate');assert.equal(heart.type,'heart');assert.equal(heart.title,'静息心率');assert.equal(heart.value,58);
 const session=records.find(x=>x.sourceId===exercise.sourceId);assert.equal(session.kind,'exercise');assert.equal(session.duration,30);assert.equal(session.distance,2.4);assert.equal(Object.hasOwn(session,'route'),false,'route leaked into persisted health record');
 ok(await sync(fixtures),'repeat four kinds');assert.equal((await list(health)).healthRecords.length,4);assert.equal((await state(health)).find(x=>x.id===manual.id).value,80);
 ok(await sync([{...exercise,durationMinutes:20,observedAt:'2026-11-04T22:15:00+08:00'}]),'20 active minutes in 30 elapsed minutes');assert.equal((await list(health)).healthRecords.find(x=>x.sourceId===exercise.sourceId).duration,20);
 ok(await sync([record('weight',71,{sourceId:'independent-weight-new-origin-id',observedAt:'2026-11-04T23:00:00+08:00'})]),'newer same-day weight');
 ok(await sync([record('weight',99,{observedAt:'2026-11-04T21:00:00+08:00'})]),'stale weight');records=(await list(health)).healthRecords;assert.equal(records.filter(x=>x.type==='weight').length,1);assert.equal(records.find(x=>x.type==='weight').value,71);assert.equal((await state(health)).find(x=>x.id===manual.id).value,80);
 const second={...exercise,sourceId:'independent-session-2',startAt:'2026-11-04T10:00:00+08:00',endAt:'2026-11-04T10:20:00+08:00',durationMinutes:20};delete second.distanceKm;delete second.route;ok(await sync([second]),'second session without distance');records=(await list(health)).healthRecords;assert.equal(records.filter(x=>x.kind==='exercise').length,2);assert.equal(Object.hasOwn(records.find(x=>x.sourceId===second.sourceId),'distance'),false,'missing distance fabricated as zero');
 ok(await sync([{...second,distanceKm:1.5,observedAt:'2026-11-04T23:00:00+08:00'}]),'later enabled distance supplements same session');ok(await sync([{...second,observedAt:'2026-11-04T23:10:00+08:00'}]),'missing distance does not erase known distance');assert.equal((await list(health)).healthRecords.find(x=>x.sourceId===second.sourceId).distance,1.5);ok(await sync([{...second,distanceKm:99,observedAt:'2026-11-04T22:30:00+08:00'}]),'stale distance ignored');assert.equal((await list(health)).healthRecords.find(x=>x.sourceId===second.sourceId).distance,1.5);
 for(const invalid of [record('weight',0),record('weight','70.5'),record('sleep',0),record('sleep',24.1),record('resting_heart_rate',58.5),record('resting_heart_rate',19),record('heart_rate',70),{...exercise,durationMinutes:90},{...exercise,distanceKm:0},{...exercise,startAt:'2026-11-04T09:00:00'},{...exercise,endAt:'2026-11-04T08:00:00+08:00'},record('weight',70,{observedAt:'2026-11-06T01:00:00+08:00'}),record('weight',70,{sourcePackage:'https://invalid.example'})])rejected(await sync([invalid]),'invalid '+invalid.kind);
 const before=JSON.stringify((await list(health)).healthRecords);rejected(await sync([]),'empty health batch');assert.equal(JSON.stringify((await list(health)).healthRecords),before);assert.equal((await list(health,B)).healthRecords.length,0);rejected(await sync([record('weight',72)],{as:B,owner:A.id}),'cross-account health upload');
 const removed=records.find(x=>x.kind==='exercise'&&x.sourceId===second.sourceId);ok(await api('/api/items/'+removed.id+health,{method:'DELETE'}),'delete health session');ok(await sync([{...second,observedAt:'2026-11-04T23:30:00+08:00'}]),'retry deleted newer observation');assert.equal((await list(health)).healthRecords.some(x=>x.id===removed.id),false);
 await stop();await start();ok(await sync([{...second,observedAt:'2026-11-04T23:45:00+08:00'}]),'deleted receipt after restart');assert.equal((await list(health)).healthRecords.some(x=>x.id===removed.id),false);assert.equal((await state(health)).find(x=>x.id===manual.id).value,80);
}

async function browserAcceptance(){
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
 const shots=process.env.PHONE_CAPTURE_SHOTS||path.join(os.tmpdir(),'phone-capture-independent-evidence');await mkdir(shots,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:process.env.PW_CHANNEL||'chrome'});
 try{
  const pending=ok(await capture('ui-confirm',{text:'支付12.34元 <img src=x onerror="window.captureUnsafe=true"> 虚构验收'}),'UI candidate').event;
  const discard=ok(await capture('ui-ignore',{text:'支付55.66元，虚构验收待忽略通知'}),'UI ignore candidate').event;
  const before=await state();const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('[name=email]').fill('capture-a@example.invalid');await page.locator('[name=password]').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.bottom-tabs').waitFor();
  async function switchTo(id){await page.locator('.phone-workbench-picker').click();await page.locator(`.drawer [data-action="shell-switch:${id}"]`).click();await page.locator('.phone-workbench-picker').waitFor();}
  async function fit(name){for(const width of [360,390]){await page.setViewportSize({width,height:844});await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} overflow at ${width}`);if(await page.locator('.drawer').count()){const drawer=await page.locator('.drawer').boundingBox();assert.ok(drawer.x>=-1&&drawer.x+drawer.width<=width+1,`${name} drawer outside viewport`);}await page.screenshot({path:path.join(shots,`${name}-${width}.png`)});}}
  await switchTo('finance');await page.locator('.bottom-tabs [data-action="nav:mine"]').click();await page.locator('.shell-menu [data-action="capture-open"]').click();await page.locator(`[data-action="capture-review:${pending.id}"]`).waitFor();
  assert.equal(await page.locator('.phone-capture-list img').count(),0);assert.equal(await page.evaluate(()=>Boolean(window.captureUnsafe)),false);await fit('inbox');
  await page.locator(`[data-action="capture-review:${pending.id}"]`).click();await page.locator('#capture-review-form').waitFor();await page.locator('#capture-review-form [name=title]').fill('虚构网页人工核对');await page.locator('#capture-review-form [name=amount]').fill('-77.88');await page.locator('#capture-review-form [name=date]').fill('2026-11-04');await page.locator('#capture-type').selectOption('expense');await fit('confirmation');
  await page.getByRole('button',{name:'确认并保存流水',exact:true}).click();await page.locator('.phone-capture-filters').waitFor();assert.equal((await list()).events.find(x=>x.id===pending.id).status,'confirmed');const after=await state();assert.equal(after.find(x=>x.title==='虚构网页人工核对')?.amount,-77.88);assert.deepEqual(after.filter(x=>x.kind!=='asset_transaction'),before.filter(x=>x.kind!=='asset_transaction'));
  await page.locator(`[data-action="capture-ignore:${discard.id}"]`).click();await page.waitForFunction(id=>!document.querySelector(`[data-action="capture-ignore:${id}"]`),discard.id);await page.locator('[data-action="capture-filter:ignored"]').click();await page.getByText('虚构验收待忽略通知',{exact:false}).waitFor();await fit('ignored');
  await page.goto(base+'/?phoneCapture=finance#transactions');await page.locator('.phone-capture-filters').waitFor();await page.locator('[data-action="capture-filter:confirmed"]').click();await page.locator('.phone-capture-outcome').first().waitFor();assert.equal((await list()).events.find(x=>x.id===pending.id).status,'confirmed');
  await page.locator('.drawer [data-action="close"]').last().click();await page.locator('.bottom-tabs [data-action="nav:mine"]').click();await page.locator('.shell-menu [data-action="capture-open"]').click();await page.locator('.phone-capture-filters').waitFor();await page.locator('.drawer [data-action="close"]').last().click();
  await page.route('**/api/capture?*',route=>route.abort());await page.locator('.shell-menu [data-action="capture-open"]').click();await page.locator('.phone-capture-error').waitFor();await page.unroute('**/api/capture?*');await page.getByRole('button',{name:'重新加载',exact:true}).click();await page.locator('.phone-capture-filters').waitFor();await page.locator('.drawer [data-action="close"]').last().click();
  ok(await steps([{date:'2026-11-05',steps:0,observedAt:'2026-11-05T11:00:00+08:00'}]),'today zero');await switchTo('health');await page.locator('.bottom-tabs [data-action="nav:dashboard"]').click();await page.locator('.phone-capture-steps').waitFor();assert.match(await page.locator('.phone-capture-step-value').textContent(),/^0步$/);await fit('zero-steps');await page.locator('.phone-capture-steps [data-action="capture-open"]').click();await page.getByText('最近步数记录',{exact:true}).waitFor();
  if(process.env.PHONE_CAPTURE_HEALTH==='1'){await page.getByText('其他健康采集',{exact:true}).waitFor();for(const title of ['体重','静息心率','睡眠','步行'])await page.locator('.phone-capture-list').getByText(title,{exact:true}).waitFor();assert.match(await page.locator('.drawer').textContent(),/2\.4\s*公里|2\.4\s*km/);}
  await fit('health-results');
  if(process.env.PHONE_CAPTURE_HEALTH==='1'){await page.locator('.phone-capture-list').last().scrollIntoViewIfNeeded();await fit('health-records');}
  await page.locator('.drawer [data-action="close"]').last().click();await page.locator('.bottom-tabs [data-action="nav:dashboard"]').click();
  // Existing quick entry must keep its established layout and still save a weight.
  await page.locator('.health-quick-actions [data-action="add:metric"]').click();await page.locator('[data-choice="metricType"] [data-choice-value="weight"]').click();await page.locator('#capture-value').fill('69.9');await page.locator('#capture-save').click();await page.locator('#capture-value').waitFor({state:'detached'});assert.ok((await state(health)).some(x=>x.type==='weight'&&x.value===69.9&&!x.source));
  // The generic record-kind selector is the public manual metric form, including steps.
  await page.locator('.health-tasks [data-action="add:task"]').first().click();await page.locator('#field-recordKind').selectOption('metric');await page.locator('#field-type').selectOption('steps');await page.locator('#field-title').fill('虚构网页手工0步');await page.locator('#field-value').fill('0');await page.locator('[form="record-form"][type=submit]').click();await page.locator('#record-form').waitFor({state:'detached'});
  const manualZero=(await state(health)).find(x=>x.title==='虚构网页手工0步');assert.ok(manualZero);assert.equal(manualZero.value,0);assert.equal(manualZero.source,undefined);
  await page.goto(base+'/#metric');await page.locator(`[data-action="edit:${manualZero.id}"]`).click();await page.locator('#field-value').fill('12');await page.locator('[form="record-form"][type=submit]').click();await page.locator('#record-form').waitFor({state:'detached'});await page.locator(`[data-action="edit:${manualZero.id}"]`).click();await page.locator('#field-value').fill('0');await page.locator('[form="record-form"][type=submit]').click();await page.locator('#record-form').waitFor({state:'detached'});assert.equal((await state(health)).find(x=>x.id===manualZero.id).value,0);
  const other=await browser.newContext({viewport:{width:360,height:844},isMobile:true,hasTouch:true});const bpage=await other.newPage();await bpage.goto(base);await bpage.locator('[name=email]').fill('capture-b@example.invalid');await bpage.locator('[name=password]').fill(password);await bpage.getByRole('button',{name:'登录',exact:true}).click();await bpage.locator('.bottom-tabs').waitFor();await bpage.locator('.phone-workbench-picker').click();await bpage.locator('.drawer [data-action="shell-switch:finance"]').click();await bpage.locator('.bottom-tabs [data-action="nav:mine"]').click();await bpage.locator('.shell-menu [data-action="capture-open"]').click();await bpage.getByText('没有待核对的交易通知',{exact:true}).waitFor();assert.equal(await bpage.locator('.phone-capture-event').count(),0);
  assert.deepEqual(errors,[]);console.log('BROWSER_EVIDENCE '+shots);
 }finally{await browser.close();}
}

async function healthCopyAcceptance(){
 const records=[{sourceId:'copy-weight',kind:'weight',date:'2026-11-04',value:71,observedAt:'2026-11-04T23:00:00+08:00'},{sourceId:'copy-heart',kind:'resting_heart_rate',date:'2026-11-04',value:58,observedAt:'2026-11-04T22:00:00+08:00'},{sourceId:'copy-sleep',kind:'sleep',date:'2026-11-05',value:7.25,observedAt:'2026-11-05T08:00:00+08:00'},{sourceId:'copy-exercise',kind:'exercise',date:'2026-11-04',observedAt:'2026-11-04T22:15:00+08:00',startAt:'2026-11-04T09:00:00+08:00',endAt:'2026-11-04T09:30:00+08:00',durationMinutes:20,distanceKm:2.4,exerciseType:'步行'}];
 ok(await api('/api/capture/health'+health,{method:'POST',body:{deviceId:'independent-copy-device',source:'health-connect',records}}),'copy fixtures');
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');const browser=await chromium.launch({headless:true,channel:process.env.PW_CHANNEL||'chrome'});const shots=process.env.PHONE_CAPTURE_SHOTS||path.join(os.tmpdir(),'phone-capture-independent-evidence');await mkdir(shots,{recursive:true});
 try{const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('[name=email]').fill('capture-a@example.invalid');await page.locator('[name=password]').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.bottom-tabs').waitFor();await page.goto(base+'/?phoneCapture=health#dashboard');await page.getByText('其他健康采集',{exact:true}).waitFor();await page.locator('.phone-capture-list').last().scrollIntoViewIfNeeded();for(const width of [360,390]){await page.setViewportSize({width,height:844});await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))});const text=await page.locator('.drawer').textContent();assert.match(text,/数据更新于/);assert.doesNotMatch(text,/来源记录时间/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(shots,`health-records-${width}.png`)});}assert.deepEqual(errors,[]);console.log('BROWSER_EVIDENCE '+shots);}finally{await browser.close();}
}

try{
 const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email','capture-a@example.invalid','--name','虚构采集A'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,...env}});
 assert.equal(setup.status,0,setup.stderr);await start();
 const loginA=await api('/api/auth/login',{as:null,method:'POST',body:{email:'capture-a@example.invalid',password}});ok(loginA,'login A');A={id:loginA.body.user.id,cookie:loginA.cookie};
 const invitation=ok(await api('/api/auth/invitations',{method:'POST',body:{email:'capture-b@example.invalid',name:'虚构采集B'}}),'invite B');
 const loginB=await api('/api/auth/accept-invitation',{as:null,method:'POST',body:{token:invitation.token,password,name:'虚构采集B'}});ok(loginB,'activate B');B={id:loginB.body.user.id,cookie:loginB.cookie};

 if(process.env.PHONE_CAPTURE_COPY_ONLY==='1')await check('AC06/08 targeted health update-time label and mobile screenshot',healthCopyAcceptance);
 else {
 await check('AC04 anonymous, missing/stale owner, foreign Origin and demo/wrong workbench reject capture',async()=>{
  rejected(await api('/api/capture'+finance,{as:null}),'anonymous list');
  for(const owner of ['',B.id])for(const route of ['/api/capture'+finance,'/api/capture'+health])rejected(await api(route,{owner}),'owner binding');
  rejected(await api('/api/capture/notifications'+finance,{owner:B.id,method:'POST',body:event('bad-owner')}),'stale owner upload');
  rejected(await api('/api/capture/notifications'+finance,{origin:'https://other.example.invalid',method:'POST',body:event('bad-origin')}),'foreign origin');
  rejected(await api('/api/capture/notifications?workbench=finance&space=demo',{method:'POST',body:event('bad-demo')}),'demo upload');
  rejected(await api('/api/capture/notifications'+health,{method:'POST',body:event('bad-workbench')}),'health notification');
  assert.equal((await list()).events.length,0);assert.equal((await list(health)).steps.length,0);
 });
 await check('AC02 non-whitelist, chat, OTP and non-transaction payloads produce no candidates',async()=>{
  const fixtures=[{packageName:'example.private.chat',title:'支付成功',text:'您支付12.34元'},
   {title:'验证码',text:'交易验证码123456，支付金额12.34元，请勿泄露'},
   {title:'Verification code',text:'Your OTP is 123456 for payment CNY 12.34'},
   {packageName:'com.tencent.mm',title:'虚构朋友',text:'今晚请你吃饭，转账给我12.34元'},
   {title:'活动提醒',text:'满100元立减12.34元，立即参与活动'}];
  for(let i=0;i<fixtures.length;i++){const result=await capture('filtered-'+i,fixtures[i]);assert.ok(result.status<500,'filter server error');assert.equal((await list()).events.length,0,'filtered payload persisted');}
  assert.equal((await state()).filter(x=>x.kind==='asset_transaction').length,0);
 });
 await check('AC03 concurrent delivery creates one pending candidate and no automatic ledger mutation',async()=>{
  const account=ok(await api('/api/items'+finance,{method:'POST',body:{kind:'asset_account',title:'虚构验收现金账户',date:'2026-11-04',currency:'CNY',balance:100,includeInTotal:true}}),'create account');
  const holding=ok(await api('/api/items'+finance,{method:'POST',body:{kind:'asset_holding',title:'虚构验收持仓',date:'2026-11-04',currency:'CNY',category:'fund',quantity:10,value:200,status:'active',accountId:account.id}}),'create holding');
  const before=await state();const deliveries=await Promise.all([capture('pending-1'),capture('pending-1'),capture('pending-1')]);deliveries.forEach(r=>ok(r,'delivery'));const ids=deliveries.map(r=>r.body.event.id);assert.equal(new Set(ids).size,1);confirmed=ids[0];
  const inbox=await list();assert.equal(inbox.events.length,1);assert.equal(inbox.events[0].status,'pending');assert.equal(inbox.stats.pending,1);assert.deepEqual(await state(),before);assert.ok(holding.id);
 });
 await check('AC03 confirm validates manual fields and concurrent repeat creates exactly one corrected transaction',async()=>{
  rejected(await api(`/api/capture/events/${confirmed}/confirm`+finance,{method:'POST',body:{}}),'empty confirmation');
  const before=await state();const results=await Promise.all([1,2,3].map(()=>api(`/api/capture/events/${confirmed}/confirm`+finance,{method:'POST',body:confirmation()})));results.forEach(r=>ok(r,'confirm'));
  assert.equal(new Set(results.map(r=>r.body.transaction.id)).size,1);const after=await state();const transactions=after.filter(x=>x.kind==='asset_transaction');assert.equal(transactions.length,1);assert.equal(transactions[0].amount,14.56);assert.equal(transactions[0].status,'confirmed');assert.deepEqual(after.filter(x=>x.kind!=='asset_transaction'),before);
  await api(`/api/capture/events/${confirmed}/ignore`+finance,{method:'POST',body:{}});const saved=(await list()).events.find(x=>x.id===confirmed);assert.equal(saved.status,'confirmed');assert.equal((await state()).filter(x=>x.kind==='asset_transaction').length,1);
 });
 await check('AC03 ignore is idempotent, cannot confirm ignored event, and retry cannot revive it',async()=>{
  const candidate=ok(await capture('ignored-1'),'ignored candidate').event;ignored=candidate.id;assert.ok(candidate.possibleDuplicateIds.includes(confirmed),'similar notification did not flag a possible duplicate');
  for(let i=0;i<2;i++){const r=ok(await api(`/api/capture/events/${ignored}/ignore`+finance,{method:'POST',body:{}}),'ignore');assert.equal(r.event.status,'ignored');}
  rejected(await api(`/api/capture/events/${ignored}/confirm`+finance,{method:'POST',body:confirmation('不应生成的流水')}),'confirm ignored');
  assert.equal(ok(await capture('ignored-1'),'retry ignored').event.status,'ignored');assert.equal((await state()).filter(x=>x.kind==='asset_transaction').length,1);
 });
 await check('AC04 B cannot list or mutate A events, including forged A owner header',async()=>{
  assert.equal((await list(finance,B)).events.length,0);assert.equal((await state(finance,B)).length,0);
  for(const action of ['confirm','ignore'])rejected(await api(`/api/capture/events/${confirmed}/${action}`+finance,{as:B,method:'POST',body:confirmation()}),'cross owner event');
  rejected(await api('/api/capture'+finance,{as:B,owner:A.id}),'forged owner');
 });
 await check('AC05 explicit 0 survives, same-day updates replace totals, stale observations cannot overwrite',async()=>{
  assert.equal((await list(health)).steps.length,0);ok(await steps([step(0,'2026-11-04T10:00:00+08:00')]),'zero steps');let snapshot=await list(health);assert.equal(snapshot.latestStep.value,0);assert.equal(snapshot.steps.length,1);
  ok(await steps([step(1200,'2026-11-04T12:00:00+08:00')]),'1200 steps');ok(await steps([step(1500)]),'1500 steps');ok(await steps([step(1500)]),'retry total');ok(await steps([step(9000,'2026-11-04T11:00:00+08:00')]),'stale total');
  snapshot=await list(health);assert.equal(snapshot.steps.length,1);assert.equal(snapshot.latestStep.value,1500);assert.match(snapshot.latestStep.source,/health-connect/i);assert.equal(snapshot.latestStep.deviceId,'independent-fictional-device');assert.ok(snapshot.latestStep.observedAt);
  const before=JSON.stringify(snapshot.steps);await steps([]);assert.equal(JSON.stringify((await list(health)).steps),before,'no-data changed existing total');assert.equal((await list(health,B)).steps.length,0);
 });
 await check('AC05 invalid records rejected; manual steps remain separate and do not add to aggregate',async()=>{
  for(const record of [step(-1),step(1.5),{...step(10),date:'2026-02-30'},{...step(10),observedAt:'2026-11-04T22:00:00'}])rejected(await steps([record]),'invalid step record');
  rejected(await api('/api/capture/steps?workbench=health&space=demo',{method:'POST',body:{deviceId:'fictional',source:'health-connect',records:[step(10)]}}),'demo steps');
  rejected(await api('/api/capture/steps'+finance,{method:'POST',body:{deviceId:'fictional',source:'health-connect',records:[step(10)]}}),'finance steps');
  const manual=ok(await api('/api/items'+health,{method:'POST',body:{kind:'metric',type:'steps',title:'虚构手工步数',date:'2026-11-04',value:200,unit:'步'}}),'manual steps');
  ok(await steps([step(1600,'2026-11-04T23:00:00+08:00')]),'updated aggregate');assert.equal((await list(health)).latestStep.value,1600);assert.equal((await state(health)).find(x=>x.id===manual.id).value,200);
 });
 await check('AC04/05 server restart preserves processed deduplication and daily totals',async()=>{
  await stop();await start();assert.equal(ok(await capture('pending-1'),'retry after restart').event.id,confirmed);assert.equal(ok(await capture('ignored-1'),'ignored restart').event.status,'ignored');
  assert.equal((await state()).filter(x=>x.kind==='asset_transaction').length,1);const retained=await list(health);assert.equal(retained.latestStep.value,1600);assert.equal(retained.steps.filter(x=>x.source==='health-connect').length,1);assert.equal(retained.steps.filter(x=>x.source==='manual').length,1);
 });
 await check('AC03 finance status pagination remains bounded and does not hide pending behind processed rows',async()=>{
  for(let i=0;i<3;i++)ok(await capture('pagination-'+i),'pagination candidate');
  const first=ok(await api('/api/capture'+finance+'&status=pending&limit=2&offset=0'),'first pending page');const second=ok(await api('/api/capture'+finance+'&status=pending&limit=2&offset=2'),'second pending page');assert.equal(first.events.length,2);assert.equal(second.events.length,1);assert.equal(new Set([...first.events,...second.events].map(x=>x.id)).size,3);assert.ok([...first.events,...second.events].every(x=>x.status==='pending'));assert.equal(first.total,3);assert.equal(first.stats.confirmed,1);assert.equal(first.stats.ignored,1);
  for(const query of ['&limit=201','&offset=-1','&status=unknown'])rejected(await api('/api/capture'+finance+query),'invalid pagination');
 });
 if(process.env.PHONE_CAPTURE_HEALTH==='1')await check('AC08 four health kinds, validation, manual isolation, stale updates and durable delete receipts',healthAcceptance);
 if(process.env.PHONE_CAPTURE_UI==='1')await check('AC06 mobile browser confirm/ignore, 360/390 layouts, zero steps, failures and account isolation',browserAcceptance);
 await check('AC04 invalidated session stops capture',async()=>{ok(await api('/api/auth/logout',{method:'POST',body:{}}),'logout');rejected(await capture('expired-session'),'expired session');assert.equal((await list(finance,B)).events.length,0);});
 }
 const inputAfter=await inputFingerprint();console.log('FINAL_INPUT_FINGERPRINT '+inputAfter);assert.equal(inputAfter,inputBefore,'runtime sources changed during acceptance; rerun the affected checks on a stable handoff');
 console.log(`RESULT ${checks.length} independent public-API groups passed. Android and browser execution remain separate.`);
}finally{await stop();await rm(dataDir,{recursive:true,force:true});}
