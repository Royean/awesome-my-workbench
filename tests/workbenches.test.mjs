import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
let remote=process.env.WORKBENCH_TEST_URL,base=remote,cwd=path.resolve(import.meta.dirname,'..');
import {startServer,stopProcess} from './helpers.mjs';
if(remote&&(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)||base.endsWith(":3100")))throw Error('Only isolated loopback preview allowed');
const user='fictional-workbench-'+crypto.randomUUID();let dir,proc,date,custom;
async function api(route,{method='GET',body,workbench='health',space='personal',userId=user}={}){const r=await fetch(base+route+(route.includes('?')?'&':'?')+new URLSearchParams({workbench,space}),{method,headers:{'Content-Type':'application/json',...(remote?{'oai-authenticated-user-id':userId,'oai-authenticated-user-email':userId+'@example.invalid'}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()}}
const add=(kind,workbench='health',extra={})=>api('/api/items',{method:'POST',workbench,body:{kind,title:'虚构工作台验收',date,...extra}});
async function start(){const s=await startServer({cwd,env:{HEALTH_DATA_DIR:dir}});proc=s.proc;base=s.base;}
async function stop(){await stopProcess(proc);proc=undefined;}
before(async()=>{if(!remote){dir=await mkdtemp(path.join(os.tmpdir(),'workbench-isolation-'));await start()}date=(await api('/api/state')).body.today});
after(async()=>{if(!remote){await stop();await rm(dir,{recursive:true,force:true})}});
test('builtins, registration validation, space independence and persistence',async()=>{
 assert.deepEqual((await api('/api/workbenches')).body.workbenches.map(x=>x.id),['health','finance','travel','reading']);
 for(const body of [{name:'',type:'other'},{name:'a'.repeat(25),type:'other'},{name:'伪造',type:'finance'}])assert.equal((await api('/api/workbenches',{method:'POST',body})).status,400);
 const created=await api('/api/workbenches',{method:'POST',body:{name:'  虚构事务  ',type:'other',id:'health',userId:'injected'}});assert.equal(created.status,201);custom=created.body;assert.match(custom.id,/^[a-f0-9-]{36}$/);assert.equal(custom.name,'虚构事务');
 if(!remote){await stop();await start()}assert.ok((await api('/api/workbenches',{space:'demo'})).body.workbenches.some(x=>x.id===custom.id));
 if(remote)assert.equal((await api('/api/state',{workbench:custom.id,userId:user+'-other'})).status,404);
});
test('health compatibility, notes/tasks and three-way record isolation',async()=>{
 const health=await add('water','health',{volume:250});assert.equal(health.status,201);
 const finance=await add('note','finance',{note:'只有备忘，非持仓管理'});assert.equal(finance.status,201);const other=await add('task',custom.id,{done:false});assert.equal(other.status,201);
 for(const [workbench,item] of [['health',health.body],['finance',finance.body],[custom.id,other.body]]){const state=await api('/api/state',{workbench});assert.equal(state.body.workbench.id,workbench);assert.ok(state.body.items.some(x=>x.id===item.id));for(const another of [health.body,finance.body,other.body].filter(x=>x.id!==item.id))assert.equal(state.body.items.some(x=>x.id===another.id),false)}
 assert.equal((await api('/api/items/'+health.body.id,{workbench:'finance',method:'PUT',body:{title:'越界'}})).status,404);
 assert.equal((await api('/api/items/'+finance.body.id,{method:'DELETE',workbench:'health',body:{}})).status,404);
 await api('/api/items/'+finance.body.id,{method:'DELETE',workbench:'finance',body:{}});assert.equal((await api('/api/restore',{method:'POST',workbench:custom.id,body:{id:finance.body.id}})).status,404);assert.equal((await api('/api/restore',{method:'POST',workbench:'finance',body:{id:finance.body.id}})).status,200);
 assert.equal((await api('/api/state',{workbench:'finance',space:'demo'})).body.items.length,0);
 const exp=await api('/api/export',{workbench:'finance'});assert.equal(exp.body.space,'personal');assert.equal(exp.body.workbench.id,'finance');assert.ok(exp.body.items.every(x=>['note','task'].includes(x.kind)));
});
test('non-health restrictions, unknown registry IDs and scoped settings/references',async()=>{
 for(const workbench of ['finance',custom.id]){assert.equal((await add('meal',workbench)).status,400);assert.equal((await api('/api/upload',{workbench,method:'POST',body:{name:'fake.txt',content:'ZmFrZQ=='}})).status,201);assert.equal((await api('/api/capture-meal',{workbench,method:'POST',body:{text:'虚构'}})).status,400)}
 for(const route of ['/api/state','/api/export','/api/workbenches'])assert.equal((await api(route,{workbench:crypto.randomUUID()})).status,404);
 await api('/api/settings',{workbench:'finance',method:'PUT',body:{name:'虚构金融称呼',focus:'只记备忘'}});assert.equal((await api('/api/state',{workbench:'finance'})).body.settings.name,'虚构金融称呼');assert.notEqual((await api('/api/state')).body.settings.name,'虚构金融称呼');
 const f=await api('/api/upload',{method:'POST',body:{name:'fictional.txt',date,content:Buffer.from('fictional workbench bytes').toString('base64')}});assert.equal(f.status,201);assert.equal((await api('/api/files/'+f.body.id,{workbench:'finance'})).status,404);assert.equal((await api('/api/files/'+f.body.id,{workbench:custom.id})).status,404);const v=await add('visit','health',{status:'已完成'});assert.equal((await add('task','finance',{visitId:v.body.id})).status,400);
});
