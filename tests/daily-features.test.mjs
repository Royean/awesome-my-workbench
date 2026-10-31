import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const cwd=path.resolve(import.meta.dirname,'..'),port=Number(process.env.DAILY_TEST_PORT||3106),base=`http://127.0.0.1:${port}`;
if(port===3100)throw Error('Never run acceptance against user port 3100');
let dir,proc,date;
async function start(){try{await fetch(base+'/api/state');throw Error('test port already occupied')}catch(e){if(e.message==='test port already occupied')throw e}proc=spawn(process.execPath,['server.mjs'],{cwd,env:{...process.env,PORT:String(port),HEALTH_DATA_DIR:dir},stdio:'ignore'});for(let n=0;n<100;n++){if(proc.exitCode!==null)throw Error('isolated server exited');try{const r=await fetch(base+'/api/state');if(r.ok){date=(await r.json()).today;return}}catch{}await new Promise(r=>setTimeout(r,50))}throw Error('isolated server did not start')}
async function stop(){if(proc?.exitCode===null){proc.kill();await new Promise(r=>proc.once('exit',r))}}
async function api(route,method='GET',body,space='personal'){const r=await fetch(base+route+(route.includes('?')?'&':'?')+'space='+space,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()}}
const add=(kind,extra={},space)=>api('/api/items','POST',{kind,title:'独立验收虚构记录',date,...extra},space);
const capture=(body,space)=>api('/api/capture-meal','POST',body,space);
const image=(name,content='fictional image')=>({name,content:Buffer.from(content).toString('base64')});
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'health-daily-'));await start()});
after(async()=>{await stop();await rm(dir,{recursive:true,force:true})});
test('exercise distance, feeling and strength detail persist through editing and restart',async()=>{
 const strength={type:'力量训练',duration:40,feeling:'适中',exercises:[{name:'虚构深蹲',sets:3,reps:12,weight:20},{name:'自重练习',sets:2,reps:8,weight:0}]};
 const s=await add('exercise',strength);assert.equal(s.status,201,JSON.stringify(s.body));assert.deepEqual(s.body.exercises,strength.exercises);
 const r=await add('exercise',{type:'跑步',duration:30,distance:5.2,feeling:'轻松'});assert.equal(r.status,201);assert.equal(r.body.distance,5.2);
 const u=await api('/api/items/'+s.body.id,'PUT',{note:'虚构训练后的补充感受'});assert.deepEqual(u.body.exercises,strength.exercises);
 await stop();await start();const all=(await api('/api/state')).body.items;assert.deepEqual(all.find(x=>x.id===s.body.id),u.body);assert.deepEqual(all.find(x=>x.id===r.body.id),r.body);
});
test('training details reject invalid boundaries without partial records',async()=>{
 const movement={name:'虚构动作',sets:3,reps:10,weight:10};
 const invalid=[{distance:0},{distance:-1},{distance:1001},{distance:'NaN'},{feeling:'必须加练'},{exercises:Array(31).fill(movement)},...['name','sets','reps','weight'].flatMap(key=>({name:['','a'.repeat(101)],sets:[0,101,1.5],reps:[0,501,1.1],weight:[-1,1001,'NaN']}[key]).map(value=>({exercises:[{...movement,[key]:value}]})))];
 for(const extra of invalid){const before=(await api('/api/state')).body.items;assert.equal((await add('exercise',{duration:30,...extra})).status,400,JSON.stringify(extra));assert.deepEqual((await api('/api/state')).body.items,before)}
 assert.equal((await add('exercise',{duration:30,distance:1000,exercises:Array(30).fill({...movement,sets:100,reps:500,weight:1000})})).status,201);
});
test('favorites keep reusable fields while removing dates, time, attachments and raw source',async()=>{
 for(const [targetKind,template] of [['meal',{title:'虚构常吃餐',date:'2020-01-01',time:'08:00',mealType:'早餐',portion:'一小碗',rawText:'原餐原话',attachmentIds:['private-photo'],visitId:'private-visit'}],['exercise',{title:'虚构训练',date,time:'20:00',duration:45,type:'力量训练',feeling:'适中',exercises:[{name:'虚构动作',sets:3,reps:8,weight:0}],attachmentIds:['private-photo']}]] ){
  const r=await add('favorite',{targetKind,sourceId:'fictional-source-id',template});assert.equal(r.status,201,JSON.stringify(r.body));
  for(const key of ['date','time','attachmentIds','rawText','visitId'])assert.ok(!(key in r.body.template),key+' must not be cloned');
  assert.equal(r.body.template.title,template.title);if(targetKind==='exercise')assert.deepEqual(r.body.template.exercises,template.exercises);else assert.equal(r.body.template.portion,'一小碗');
  assert.equal((await api('/api/items/'+r.body.id,'PUT',{title:'越界'},'demo')).status,404);
  const copied=await add(targetKind,{...r.body.template,date:'2026-10-01',time:'10:00'});assert.equal(copied.status,201);assert.notEqual(copied.body.id,r.body.id);
  await api('/api/items/'+r.body.id,'DELETE');assert.equal((await api('/api/restore','POST',{id:r.body.id,template:{title:'伪造'}})).body.template.title,template.title);
 }
 for(const extra of [{targetKind:'water',template:{}},{targetKind:'exercise',template:{duration:0}},{targetKind:'exercise',template:{duration:30,exercises:[{name:'坏动作',sets:0,reps:1}]}}])assert.equal((await add('favorite',extra)).status,400);
});
test('meal keeps selected photos, replaces or detaches without deleting original files',async()=>{
 const first=await capture({text:'虚构餐食原话',portion:'一碗',date:'2026-10-01',time:'12:00',attachments:[image('old-a.png','original-a'),image('old-b.jpg','original-b')]});assert.equal(first.status,201);const meal=first.body;
 const edited=await capture({mealId:meal.id,text:'更正后的虚构餐食',date:'2026-10-01',time:'12:05',portion:'半碗',keepAttachmentIds:[meal.attachmentIds[1]],attachments:[image('replacement.webp','replacement')]});assert.equal(edited.status,200);assert.equal(edited.body.id,meal.id);assert.equal(edited.body.portion,'半碗');assert.equal(edited.body.attachmentIds.length,2);assert.ok(!edited.body.attachmentIds.includes(meal.attachmentIds[0]));
 assert.equal(await(await fetch(base+'/api/files/'+meal.attachmentIds[0])).text(),'original-a');
 const detached=await capture({mealId:meal.id,text:'仍保留餐食文字',keepAttachmentIds:[],portion:'三口'});assert.equal(detached.status,200);assert.deepEqual(detached.body.attachmentIds,[]);
 const state=(await api('/api/state')).body.items;assert.equal(state.filter(x=>x.kind==='meal'&&x.id===meal.id).length,1);assert.equal(state.filter(x=>x.kind==='file'&&edited.body.attachmentIds.includes(x.id)).length,2);
});
test('meal edits reject cross-space or foreign attachments and roll back failed changes',async()=>{
 const a=(await capture({text:'虚构A',attachments:[image('a.png')]})).body,b=(await capture({text:'虚构B',attachments:[image('b.png')]})).body;
 assert.equal((await capture({mealId:a.id,text:'越界'},'demo')).status,404);
 const invalid=[{keepAttachmentIds:b.attachmentIds},{keepAttachmentIds:['missing']},{keepAttachmentIds:[...a.attachmentIds,...Array(4).fill(a.attachmentIds[0])]},{attachments:[image('bad.pdf')]},{date:'2026-02-30',attachments:[image('new.png')]}];
 for(const extra of invalid){const before=(await api('/api/state')).body.items,files=await readdir(path.join(dir,'uploads'));assert.equal((await capture({mealId:a.id,text:'不能保存的修改',...extra})).status,400,JSON.stringify(extra));assert.deepEqual((await api('/api/state')).body.items,before);assert.deepEqual(await readdir(path.join(dir,'uploads')),files)}
 const deleted=(await api('/api/items/'+a.id,'DELETE')).body.deleted;assert.equal((await api('/api/restore','POST',{id:deleted.id},'demo')).status,404);const restored=(await api('/api/restore','POST',{id:deleted.id})).body;assert.deepEqual(restored,a);
});
test('photo-only meal edit retains photo title when only existing photo remains',async()=>{
 const original=(await capture({date:'2026-10-01',mealType:'早餐',attachments:[image('photo-only.png')]})).body;
 const r=await capture({mealId:original.id,keepAttachmentIds:original.attachmentIds,portion:'半碗'});
 assert.equal(r.status,200);assert.match(r.body.title,/照片/,'retained photo must not become an audio-only label');assert.equal(r.body.date,'2026-10-01');assert.equal(r.body.mealType,'早餐');
});
test('retained and newly added attachments jointly enforce the total 10MB limit',async()=>{
 const original=(await capture({attachments:[image('existing.png',Buffer.alloc(6*1024*1024))]})).body;
 const before=(await api('/api/state')).body.items,files=await readdir(path.join(dir,'uploads'));
 const rejected=await capture({mealId:original.id,keepAttachmentIds:original.attachmentIds,attachments:[image('too-much.png',Buffer.alloc(4*1024*1024+1))]});assert.equal(rejected.status,400);assert.deepEqual((await api('/api/state')).body.items,before);assert.deepEqual(await readdir(path.join(dir,'uploads')),files);
 const accepted=await capture({mealId:original.id,keepAttachmentIds:original.attachmentIds,attachments:[image('boundary.png',Buffer.alloc(4*1024*1024))]});assert.equal(accepted.status,200);assert.equal(accepted.body.attachmentIds.length,2);
});
test('partial meal edit preserves omitted original text, time, note and portion',async()=>{
 const original=(await capture({text:'  虚构原话\n完整保留  ',time:'12:05',note:'原备注',portion:'原份量',date:'2026-10-01',mealType:'午餐',attachments:[image('partial.png')]})).body;
 const edited=await capture({mealId:original.id,attachments:[image('new.png')]});assert.equal(edited.status,200);
 for(const key of ['rawText','time','note','portion','date','mealType','title'])assert.equal(edited.body[key],original[key],key);
 const clear=await capture({mealId:original.id,text:'',time:'',note:'',portion:''});assert.equal(clear.status,200);for(const key of ['rawText','time','note','portion'])assert.equal(clear.body[key],'',key+' explicit empty');
});
test('water supports historical date, edit, undo, restart and strict positive ml values',async()=>{
 const r=await add('water',{volume:250,date:'2026-10-01',time:'09:30'});assert.equal(r.status,201);assert.equal(r.body.volume,250);
 for(const volume of [0,-1,5001,'NaN',null])assert.equal((await add('water',{volume})).status,400,JSON.stringify(volume));assert.equal((await add('water',{volume:5000})).status,201);
 const corrected=await api('/api/items/'+r.body.id,'PUT',{volume:300});assert.equal(corrected.body.date,'2026-10-01');assert.equal(corrected.body.volume,300);
 assert.equal((await api('/api/items/'+r.body.id,'PUT',{volume:400},'demo')).status,404);await api('/api/items/'+r.body.id,'DELETE');assert.deepEqual((await api('/api/restore','POST',{id:r.body.id,volume:999})).body,corrected.body);
 await stop();await start();assert.deepEqual((await api('/api/state')).body.items.find(x=>x.id===r.body.id),corrected.body);assert.ok(!(await api('/api/state','GET',undefined,'demo')).body.items.some(x=>x.id===r.body.id));
});
