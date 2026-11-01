// MCP + web dose/medication/report rules with a pinned clock (ZH_TEST_NOW, NODE_ENV=test only). Fictional local accounts, throwaway DB.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {startServer,freePort} from './helpers.mjs';
const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-only-passphrase-95',email='clock-admin@example.invalid';
const NOW='2026-11-01T14:40:00+08:00',TODAY='2026-11-01';
let dir,server,base,cookie,token,n=1;
async function req(route,{method='GET',body,headers={}}={}){const r=await fetch(base+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();return {status:r.status,body:text?JSON.parse(text):undefined};}
const web=()=>({Cookie:cookie,Origin:base});
const call=async(name,args)=>(await req('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:n++,method:'tools/call',params:{name,arguments:args}},headers:{Authorization:`Bearer ${token}`}})).body.result;
const ok=async(name,args)=>{const r=await call(name,args);assert.equal(r.isError,false,r.content[0].text);return r.structuredContent;};
const err=async(name,args)=>{const r=await call(name,args);assert.equal(r.isError,true,JSON.stringify(r.structuredContent));return r.structuredContent.error;};
before(async()=>{
 dir=await mkdtemp(path.join(os.tmpdir(),'workbench-clock-'));
 const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','Fictional clock admin'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);
 const port=await freePort();server=await startServer({cwd,env:{NODE_ENV:'test',ZH_TEST_NOW:NOW,AUTH_REQUIRED:'1',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir}});base=server.base;
 const l=await req('/api/auth/login',{method:'POST',body:{email,password},headers:{Origin:base}});cookie=l.status===200&&(await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email,password})})).headers.get('set-cookie').split(';')[0];
 token=(await req('/api/auth/tokens',{method:'POST',body:{name:'clock'},headers:web()})).body.token;assert.ok(token);
});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});
let visit,med;
test('setup: visit and medication (start 10月30日, times 08:00/20:00)',async()=>{
 assert.equal((await ok('list_workbenches',{})).today,TODAY);
 visit=(await ok('create_record',{kind:'visit',title:'复诊',date:'2026-10-30',status:'已完成'})).created;
 med=(await ok('create_record',{kind:'medication',title:'示例药 C',date:'2026-10-30',visitId:visit.id,dosage:'1 片',route:'口服',frequency:'每日两次',times:['08:00','20:00']})).created;
});
test('dose time later than now (Asia/Shanghai) is future_date — MCP create/update and web',async()=>{
 const e=await err('create_record',{kind:'dose',medicationId:med.id,date:TODAY,time:'15:00'});assert.equal(e.code,'future_date');assert.equal(e.message,'服药时间不能晚于现在，现在是 14:40');
 const d=(await ok('create_record',{kind:'dose',medicationId:med.id,date:TODAY,time:'14:40',scheduledTime:'08:00'})).created;
 const u=await err('update_record',{id:d.id,time:'14:41'});assert.equal(u.code,'future_date');assert.equal(u.message,'服药时间不能晚于现在，现在是 14:40');
 assert.equal((await ok('create_record',{kind:'dose',medicationId:med.id,date:'2026-10-31',time:'23:00'})).created.time,'23:00');
 const w=await req('/api/items',{method:'POST',body:{kind:'dose',title:'示例药 C',medicationId:med.id,date:TODAY,time:'20:05',outcome:'已服用'},headers:web()});assert.equal(w.status,400);assert.equal(w.body.code,'future_date');assert.equal(w.body.error,'服药时间不能晚于现在，现在是 14:40');
 const wd=await req(`/api/items/${d.id}`,{method:'PUT',body:{time:'16:00'},headers:web()});assert.equal(wd.status,400);assert.equal(wd.body.code,'future_date');
 assert.equal((await err('create_record',{kind:'dose',medicationId:med.id,date:'2026-11-02',time:'08:00'})).code,'future_date');
});
test('dose: specific errors for start date, planned time, missing time',async()=>{
 assert.equal((await err('create_record',{kind:'dose',medicationId:med.id,date:'2026-10-29',time:'08:00'})).message,'这个方案从 10月30日开始，服药日期不能早于这天');
 assert.equal((await err('create_record',{kind:'dose',medicationId:med.id,date:'2026-10-29'})).message,'这个方案从 10月30日开始，服药日期不能早于这天');
 assert.equal((await err('create_record',{kind:'dose',medicationId:med.id,date:'2026-10-31',scheduledTime:'12:00',time:'12:00'})).message,'计划时间不在这个用药方案里');
 assert.equal((await err('create_record',{kind:'dose',medicationId:med.id,date:'2026-10-31',scheduledTime:'12:00'})).message,'计划时间不在这个用药方案里');
 assert.equal((await err('create_record',{kind:'dose',medicationId:med.id,date:'2026-10-31'})).message,'请记录实际服用时间');
});
test('medication: duplicate times reported before missing title',async()=>{
 assert.equal((await err('create_record',{kind:'medication',visitId:visit.id,dosage:'1 片',route:'口服',frequency:'每日两次',times:['08:00','08:00']})).message,'08:00 填了两次，每个时间只填一次');
 assert.equal((await err('create_record',{kind:'medication',title:'x',visitId:visit.id,dosage:'1 片',route:'口服',frequency:'每日',times:[]})).message,'按时服用需要至少填一个服用时间');
});
test('legacy report without visit can be updated (MCP and web); create still needs a visit',async()=>{
 const space=new DatabaseSync(path.join(dir,'health.sqlite')).prepare("SELECT space FROM data_scopes WHERE workbench_id='health' AND base_space='personal'").get().space;
 const id=randomUUID();const db=new DatabaseSync(path.join(dir,'health.sqlite'));db.prepare('INSERT INTO items VALUES(?,?,?,?)').run(id,space,'report',JSON.stringify({title:'旧报告',date:'2025-01-01',note:'',type:'其他',status:'待补充',source:'',content:'旧',fileId:''}));db.close();
 assert.equal((await ok('update_record',{id,content:'补充原文'})).updated.content,'补充原文');
 const w=await req(`/api/items/${id}`,{method:'PUT',body:{title:'旧报告（已整理）'},headers:web()});assert.equal(w.status,200,JSON.stringify(w.body));
 assert.equal((await err('create_record',{kind:'report',title:'新报告'})).code,'validation_failed');
 const wc=await req('/api/items',{method:'POST',body:{kind:'report',title:'新报告',date:TODAY},headers:web()});assert.equal(wc.status,400);
});
test('past-dated visit with 待就诊 allowed; future 已完成 allowed (same as web)',async()=>{
 assert.equal((await ok('create_record',{kind:'visit',title:'漏记的预约',date:'2026-10-01',status:'待就诊'})).created.status,'待就诊');
 assert.equal((await ok('create_record',{kind:'visit',title:'提前登记',date:'2026-11-20',status:'已完成'})).created.status,'已完成');
});
