import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
let cwd=path.resolve(import.meta.dirname,'..'),base=undefined;
import {startServer,stopProcess} from './helpers.mjs';
let dir,proc,date;
async function start(){// Pin "now" late in today's Asia/Shanghai day so fixed dose times (08:10, 11:00…) are never later than now.
 const t=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());const s=await startServer({cwd,env:{HEALTH_DATA_DIR:dir,NODE_ENV:'test',ZH_TEST_NOW:`${t}T23:30:00+08:00`}});proc=s.proc;base=s.base;date=(await (await fetch(base+'/api/state')).json()).today;}
async function stop(){await stopProcess(proc);proc=undefined;}
async function api(route,method='GET',body,space='personal'){const r=await fetch(base+route+(route.includes('?')?'&':'?')+'space='+space,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()}}
const add=async(kind,extra={},space='personal')=>{const r=await api('/api/items','POST',{kind,title:'独立验收虚构记录',date,...extra},space);assert.equal(r.status,201,JSON.stringify(r.body));return r.body};
const update=(x,b)=>api('/api/items/'+x.id,'PUT',b);
const med=(visitId,extra={})=>add('medication',{visitId,dosage:'医生原文用量',route:'医生原文途径',frequency:'医生原文频次',scheduleMode:'scheduled',times:['08:00','20:00'],...extra});
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'health-medical-'));await start()});
after(async()=>{await stop();await rm(dir,{recursive:true,force:true})});
test('personal never seeded; visit/report/medication/task original text and links persist',async()=>{
 assert.deepEqual((await api('/api/state')).body.items,[]);
 const text='医生及用户原始记录\n<svg onload=alert(1)>原文 & 「引号」';
 const v=await add('visit',{status:'已完成',doctor:'虚构医生',reason:text,assessment:text,instructions:text,note:'旧版note原文'});
 const r=await add('report',{visitId:v.id,status:'已归档',type:'检验报告',source:'虚构纸质原件',content:text.repeat(100)});
 const m=await med(v.id);const t=await add('task',{visitId:v.id,category:'就诊',done:false});
 await stop();await start();const all=(await api('/api/state')).body.items;
 for(const x of [v,r,m,t])assert.deepEqual(all.find(a=>a.id===x.id),x);
 assert.equal((await update(v,{title:'已编辑'})).body.note,'旧版note原文');
 assert.ok(!(await api('/api/state','GET',undefined,'demo')).body.items.some(x=>x.id===r.id));
});
test('report statuses, original attachment preview, relation type and space validation',async()=>{
 const a=await add('visit',{status:'待就诊'}),b=await add('visit',{status:'待复查'});const foreign=await add('visit',{status:'待就诊'},'demo');
 const file=(await api('/api/upload','POST',{name:'original.txt',content:Buffer.from('<script>untrusted report</script>').toString('base64'),visitId:a.id})).body;
 const r=await add('report',{visitId:a.id,fileId:file.id,status:'已归档'});
 const preview=await fetch(base+'/api/files/'+file.id+'?space=personal&inline=1');assert.equal(preview.status,200);assert.match(preview.headers.get('content-type'),/^text\/plain/);assert.match(preview.headers.get('content-disposition'),/^inline/);assert.equal(preview.headers.get('x-content-type-options'),'nosniff');assert.match(preview.headers.get('content-security-policy'),/sandbox/);assert.equal(await preview.text(),'<script>untrusted report</script>');
 for(const extra of [{visitId:foreign.id},{visitId:file.id},{visitId:a.id,status:'已归档'},{visitId:a.id,type:'自动诊断'},{visitId:a.id,status:'自动解读'},{visitId:b.id,fileId:file.id},{visitId:a.id,fileId:a.id}])assert.equal((await api('/api/items','POST',{kind:'report',title:'虚构',date,...extra})).status,400,JSON.stringify(extra));
 assert.equal((await update(r,{visitId:b.id})).status,400);
 assert.equal((await fetch(base+'/api/files/'+file.id+'?space=demo&inline=1')).status,404);
 assert.equal((await api('/api/items/'+r.id,'PUT',{content:'越界'},'demo')).status,404);
});
test('manual medication schedule validation, taken/skipped history and duplicate prevention',async()=>{
 const v=await add('visit',{status:'已完成'}),m=await med(v.id);
 for(const extra of [{dosage:''},{route:''},{frequency:''},{times:[]},{times:['08:00','08:00']},{times:['24:00']},{endDate:'2020-01-01'}])assert.equal((await api('/api/items','POST',{...m,...extra,kind:'medication'})).status,400,JSON.stringify(extra));
 const d=await add('dose',{medicationId:m.id,outcome:'已服用',time:'08:10',scheduledTime:'08:00'});
 assert.equal((await api('/api/items','POST',{...d})).status,400);
 assert.equal((await update(d,{note:'用户补记'})).status,200);
 for(const extra of [{outcome:'跳过',note:''},{outcome:'已服用',time:''},{medicationId:v.id},{date:'2099-01-01'}])assert.equal((await api('/api/items','POST',{kind:'dose',title:'虚构',date,medicationId:m.id,outcome:'已服用',time:'20:00',...extra})).status,400,JSON.stringify(extra));
 await add('dose',{medicationId:m.id,outcome:'跳过',scheduledTime:'20:00',note:'用户记录原因'});
 assert.equal((await api('/api/items/'+m.id,'DELETE')).status,400);
 assert.equal((await update(m,{status:'已停用'})).status,200);
 const needed=await med(v.id,{scheduleMode:'asNeeded'});assert.deepEqual(needed.times,[]);
 assert.equal((await api('/api/items','POST',{kind:'dose',title:'虚构',date,medicationId:needed.id,outcome:'已服用',time:'09:00',scheduledTime:'09:00'})).status,400);
 await add('dose',{medicationId:needed.id,outcome:'已服用',time:'09:00'});
});
test('visit delete keeps medical records and undo identities; orphan edits remain possible',async()=>{
 const v=await add('visit',{status:'已完成'}),m=await med(v.id),r=await add('report',{visitId:v.id,content:'原文',status:'已归档'}),t=await add('task',{visitId:v.id});
 await api('/api/items/'+v.id,'DELETE');
 for(const x of [m,r,t])assert.equal((await update(x,{note:'就诊删除后仍可记录'})).status,200);
 assert.equal((await api('/api/restore','POST',{id:v.id,reason:'伪造'})).body.id,v.id);
 const deleted=(await api('/api/items/'+r.id,'DELETE')).body.deleted;
 assert.equal((await api('/api/restore','POST',{id:deleted.id},'demo')).status,404);
 const restored=(await api('/api/restore','POST',{id:deleted.id,content:'篡改'})).body;assert.equal(restored.id,r.id);assert.equal(restored.content,'原文');assert.equal(restored.visitId,v.id);
});
test('report attachment cannot move to another visit while linked',async()=>{
 const a=await add('visit',{status:'已完成'}),b=await add('visit',{status:'已完成'});
 const f=(await api('/api/upload','POST',{name:'relation.txt',content:Buffer.from('虚构原文').toString('base64'),visitId:a.id})).body;
 await add('report',{visitId:a.id,fileId:f.id,status:'已归档'});
 assert.equal((await update(f,{visitId:b.id})).status,400,'report linked file must not move to a conflicting visit');
});
test('undo dose does not recreate duplicate scheduled slot',async()=>{
 const v=await add('visit',{status:'已完成'}),m=await med(v.id);
 const d=await add('dose',{medicationId:m.id,outcome:'已服用',time:'08:10',scheduledTime:'08:00'});
 await api('/api/items/'+d.id,'DELETE');
 await add('dose',{medicationId:m.id,outcome:'跳过',note:'用户改记',scheduledTime:'08:00'});
 assert.equal((await api('/api/restore','POST',{id:d.id})).status,400,'undo must preserve duplicate prevention');
});
test('scheduled dose matches plan while historical slots survive plan edits',async()=>{
 const v=await add('visit',{status:'已完成'}),m=await med(v.id);
 assert.equal((await api('/api/items','POST',{kind:'dose',title:'虚构时段',date,medicationId:m.id,outcome:'已服用',time:'09:05',scheduledTime:'09:00'})).status,400);
 const d=await add('dose',{medicationId:m.id,outcome:'已服用',time:'08:05',scheduledTime:'08:00'});
 assert.equal((await update(m,{times:['10:00']})).status,200);
 assert.equal((await update(d,{note:'保留历史时段原始记录'})).status,200);
 await add('dose',{medicationId:m.id,outcome:'已服用',time:'11:00',scheduledTime:''});
});
