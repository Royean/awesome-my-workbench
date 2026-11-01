import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
let cwd=path.resolve(import.meta.dirname,'..'),base=undefined;
import {startServer,stopProcess} from './helpers.mjs';

let dir,proc,date;
async function start(){const s=await startServer({cwd,env:{HEALTH_DATA_DIR:dir}});proc=s.proc;base=s.base;date=(await (await fetch(base+'/api/state')).json()).today;}
async function stop(){await stopProcess(proc);proc=undefined;}
async function api(route,method='GET',body,space='personal'){const r=await fetch(base+route+(route.includes('?')?'&':'?')+'space='+space,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()}}
const payload=(name,content)=>({name,content:Buffer.from(content).toString('base64')});
const capture=(body,space)=>api('/api/capture-meal','POST',body,space);
const add=(kind,extra={})=>api('/api/items','POST',{kind,title:'独立验收虚构记录',date,...extra});
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'health-quick-'));await start()});
after(async()=>{await stop();await rm(dir,{recursive:true,force:true})});
test('sentence capture preserves full original text, defaults date and survives restart',async()=>{
 assert.deepEqual((await api('/api/state')).body.items,[]);
 const text='  '+'虚构晚餐：米饭、青菜与鸡蛋\n<svg onload=alert(1)> & “原始文字”'.repeat(30)+'  ';
 const r=await capture({text});assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.rawText,text);assert.equal(r.body.date,date);assert.ok(r.body.mealType);assert.deepEqual(r.body.attachmentIds,[]);
 await stop();await start();assert.deepEqual((await api('/api/state')).body.items.find(x=>x.id===r.body.id),r.body);
 assert.ok(!(await api('/api/state','GET',undefined,'demo')).body.items.some(x=>x.id===r.body.id));
 const max=await capture({text:'餐'.repeat(5000)});assert.equal(max.status,201);assert.equal(max.body.rawText.length,5000);
});
test('photo-only and raw-audio-only captures preserve bytes and same-space file relations',async()=>{
 for(const [name,bytes,mime] of [['fictional.png',Buffer.from([137,80,78,71,13,10,26,10,0,255]),'image/png'],['fictional.webm',Buffer.from([26,69,223,163,0,255,128]),'audio/webm']]){
  const r=await capture({attachments:[payload('../'+name,bytes)]});assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.rawText,'');assert.equal(r.body.attachmentIds.length,1);
  const id=r.body.attachmentIds[0],file=(await api('/api/state')).body.items.find(x=>x.id===id);assert.equal(file.name,name);assert.equal(file.mime,mime);
  const download=await fetch(base+'/api/files/'+id+'?inline=1');assert.equal(download.headers.get('content-type'),mime);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
  assert.equal((await fetch(base+'/api/files/'+id+'?space=demo')).status,404);
  assert.equal((await api('/api/items/'+r.body.id,'PUT',{note:'越界'},'demo')).status,404);
  assert.equal((await api('/api/items','POST',{kind:'meal',title:'越界引用',date,attachmentIds:[id]},'demo')).status,400);
 }
});
test('capture rejects invalid or excessive input without partial rows or disk files',async()=>{
 const good=payload('fictional.jpg','fictional photo');
 for(const body of [{},{text:'  '},{text:'餐'.repeat(5001)},{attachments:{}},{attachments:Array(5).fill(good)},{attachments:[good,payload('x.pdf','%PDF-1.4')]},{attachments:[payload('x.png','')]},{attachments:[payload('large.png',Buffer.alloc(10*1024*1024+1))]},{date:'2026-02-30',attachments:[good]},{time:'<img>',attachments:[good]}]){
  const before=(await api('/api/state')).body.items,files=await readdir(path.join(dir,'uploads'));
  assert.equal((await capture(body)).status,400,JSON.stringify({...body,attachments:body.attachments?'[omitted]':undefined}));
  assert.deepEqual((await api('/api/state')).body.items,before);assert.deepEqual(await readdir(path.join(dir,'uploads')),files);
 }
 const retry=await capture({text:'错误后可重新记录',attachments:[good]});assert.equal(retry.status,201);
});
test('meal edit and undo retain original text and attachment ids, orphan attachment remains editable',async()=>{
 const r=(await capture({text:'虚构餐食原话',attachments:[payload('history.ogg','fictional audio')]})).body;
 assert.equal((await api('/api/items/'+r.id,'PUT',{attachmentIds:['nonexistent']})).status,400);
 const updated=await api('/api/items/'+r.id,'PUT',{note:'只改备注'});assert.equal(updated.body.rawText,r.rawText);assert.deepEqual(updated.body.attachmentIds,r.attachmentIds);
 await api('/api/items/'+r.attachmentIds[0],'DELETE');assert.equal((await api('/api/items/'+r.id,'PUT',{note:'原附件已移除，保留记录'})).status,200);
 await api('/api/items/'+r.id,'DELETE');const restored=await api('/api/restore','POST',{id:r.id,rawText:'篡改'});assert.equal(restored.body.rawText,r.rawText);assert.deepEqual(restored.body.attachmentIds,r.attachmentIds);
});
test('report intake without visit can be organized later with original bytes and guarded association',async()=>{
 const f=await api('/api/upload','POST',{...payload('fictional-report.txt','虚构报告原文'),fileCategory:'报告待整理'});assert.equal(f.status,201);assert.equal(f.body.fileCategory,'报告待整理');assert.equal(f.body.intakeStatus,'待整理');assert.ok(!f.body.visitId);
 const v=(await add('visit',{status:'已完成'})).body;
 const report=await add('report',{visitId:v.id,fileId:f.body.id,status:'已归档'});assert.equal(report.status,201,JSON.stringify(report.body));
 const linked=await api('/api/items/'+f.body.id,'PUT',{visitId:v.id});assert.equal(linked.status,200);assert.equal(linked.body.intakeStatus,'已关联');
 assert.equal(await(await fetch(base+'/api/files/'+f.body.id)).text(),'虚构报告原文');
 const other=(await add('visit',{status:'已完成'})).body;assert.equal((await api('/api/items/'+f.body.id,'PUT',{visitId:other.id})).status,400);
 await stop();await start();assert.equal((await api('/api/state')).body.items.find(x=>x.id===f.body.id).visitId,v.id);
});
test('exercise and metric schemas preserve boundaries and server-derived units',async()=>{
 assert.equal((await add('exercise',{type:'步行',duration:30})).status,201);
 for(const duration of [0,-1,1441,'invalid'])assert.equal((await add('exercise',{duration})).status,400);
 for(const [type,unit] of Object.entries({weight:'kg',pressure:'mmHg',glucose:'mmol/L',sleep:'小时',heart:'次/分'})){const r=await add('metric',{type,value:type==='pressure'?120:6.5,secondary:80,unit:'forged'});assert.equal(r.status,201);assert.equal(r.body.unit,unit)}
 assert.equal((await add('metric',{type:'pressure',value:120,secondary:130})).status,400);
});
