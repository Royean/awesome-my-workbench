import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
let cwd=path.resolve(import.meta.dirname,'..'),base=undefined;
import {startServer,stopProcess} from './helpers.mjs';
let dir,proc,custom;
const legacy={id:'legacy-health',kind:'meal',title:'虚构旧版健康餐食',date:'2026-10-01',note:'迁移前原文'};
async function start(){const s=await startServer({cwd,env:{HEALTH_DATA_DIR:dir}});proc=s.proc;base=s.base;}
async function stop(){await stopProcess(proc);proc=undefined;}
async function api(route,method='GET',body,wb='health',space='personal'){const r=await fetch(base+route+(route.includes('?')?'&':'?')+'space='+space+'&workbench='+encodeURIComponent(wb),{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()}}
const add=(kind,wb,extra={})=>api('/api/items','POST',{kind,title:'虚构工作台记录',date:'2026-10-01',...extra},wb);
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'health-workbench-qa-'));const db=new DatabaseSync(path.join(dir,'health.sqlite'));db.exec('CREATE TABLE items(id TEXT PRIMARY KEY,space TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL)');const {id,kind,...body}=legacy;db.prepare('INSERT INTO items VALUES(?,?,?,?)').run(id,'personal',kind,JSON.stringify(body));db.close();await start()});
after(async()=>{await stop();await rm(dir,{recursive:true,force:true})});
test('existing unscoped health rows retain identity; omitted workbench means health',async()=>{
 const normal=await api('/api/state');assert.deepEqual(normal.body.items.find(x=>x.id===legacy.id),legacy);
 const omitted=await(await fetch(base+'/api/state?space=personal')).json();assert.deepEqual(omitted.items,normal.body.items);
 assert.deepEqual((await api('/api/state','GET',undefined,'finance')).body.items,[]);assert.equal((await api('/api/state','GET',undefined,'nonexistent')).status,404);
});
test('registry validates names and type and persists across spaces and process restart',async()=>{
 for(const body of [{name:'',type:'other'},{name:'  ',type:'other'},{name:'x'.repeat(25),type:'other'},{name:'伪装健康',type:'health'},{name:'伪装金融',type:'finance'}])assert.equal((await api('/api/workbenches','POST',body)).status,400);
 const r=await api('/api/workbenches','POST',{name:'  虚构家庭工作台  ',type:'other',id:'health'});assert.equal(r.status,201);custom=r.body.id;assert.notEqual(custom,'health');assert.equal(r.body.name,'虚构家庭工作台');assert.equal(r.body.type,'other');
 await stop();await start();for(const space of ['personal','demo'])assert.ok((await api('/api/state','GET',undefined,'finance',space)).body.workbenches.some(x=>x.id===custom));
});
test('health, finance, custom and demo fully isolate records, settings, edits, export and tombstones',async()=>{
 const rows=[];for(const wb of ['health','finance',custom]){const r=await add('task',wb,{title:'虚构任务-'+wb,done:false});assert.equal(r.status,201);rows.push([wb,r.body]);await api('/api/settings','PUT',{name:wb,focus:'虚构目标'},wb)}
 for(const [wb,row] of rows){const state=(await api('/api/state','GET',undefined,wb)).body;assert.equal(state.settings.name,wb);assert.ok(state.items.some(x=>x.id===row.id));const exported=(await api('/api/export','GET',undefined,wb)).body;assert.equal(exported.workbench.id,wb);for(const [other] of rows.filter(([w])=>w!==wb)){assert.ok(!(await api('/api/state','GET',undefined,other)).body.items.some(x=>x.id===row.id));assert.equal((await api('/api/items/'+row.id,'PUT',{title:'越界'},other)).status,404);assert.equal((await api('/api/items/'+row.id,'DELETE',undefined,other)).status,404);assert.ok(!exported.items.some(x=>rows.some(([w,y])=>w!==wb&&y.id===x.id)))}assert.ok(!(await api('/api/state','GET',undefined,wb,'demo')).body.items.some(x=>x.id===row.id));await api('/api/items/'+row.id,'DELETE',undefined,wb);for(const [other] of rows.filter(([w])=>w!==wb))assert.equal((await api('/api/restore','POST',{id:row.id},other)).status,404);assert.equal((await api('/api/restore','POST',{id:row.id},wb,'demo')).status,404);assert.equal((await api('/api/restore','POST',{id:row.id},wb)).body.id,row.id)}
});
test('asset workbench permits document upload but still rejects health capture',async()=>{
 for(const wb of ['finance',custom]){for(const kind of ['note','task'])assert.equal((await add(kind,wb)).status,201);for(const kind of ['visit','meal','exercise','metric','report','medication','dose','water','favorite','file'])assert.equal((await add(kind,wb,{duration:30,value:65,type:'weight',volume:250,status:'待就诊'})).status,400,wb+' '+kind);for(const route of ['/api/upload','/api/capture-meal'])assert.equal((await api(route,'POST',{text:'不应保存',name:'x.png',content:Buffer.from('fictional').toString('base64')},wb)).status,route==='/api/upload'?201:400)}
});
test('health file bytes cannot be fetched, associated or restored from another workbench',async()=>{
 const f=await api('/api/upload','POST',{name:'fictional.txt',content:Buffer.from('fictional private health bytes').toString('base64')});assert.equal(f.status,201);
 for(const wb of ['finance',custom]){assert.equal((await fetch(base+'/api/files/'+f.body.id+'?workbench='+wb)).status,404);assert.equal((await api('/api/items/'+f.body.id,'PUT',{title:'不应改写'},wb)).status,404)}
 await api('/api/items/'+f.body.id,'DELETE');assert.equal((await api('/api/restore','POST',{id:f.body.id},'finance')).status,404);assert.equal((await api('/api/restore','POST',{id:f.body.id})).status,200);assert.equal(await(await fetch(base+'/api/files/'+f.body.id)).text(),'fictional private health bytes');
});
