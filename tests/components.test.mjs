import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {createComponents} from '../lib/components.mjs';
import {COMPONENT_TEMPLATES,createComponentDefinition,validateComponentDefinition} from '../public/component-schema.js';
import {startServer,freePort,repoRoot} from './helpers.mjs';
const builtins=[{id:'health',type:'health',name:'健康'},{id:'finance',type:'finance',name:'资产'},{id:'travel',type:'travel',name:'旅行'},{id:'reading',type:'reading',name:'阅读'}];
const date='2026-11-04';
const input={workbench:builtins[0],space:'personal'};
const instance=(id,extra={})=>({instanceId:randomUUID(),componentId:id,zone:'bottom',size:'medium',visible:true,...extra});
const fixture=()=>{const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,created_at INTEGER)');let now=Date.parse(date+'T10:00:00Z');const records={personal:[{id:'a',kind:'exercise',title:'A',date,duration:20},{id:'b',kind:'exercise',title:'B',date:'2026-11-03',duration:30},{id:'c',kind:'exercise',title:'old',date:'2026-10-01',duration:90}],demo:[{id:'demo',kind:'exercise',title:'D',date,duration:7}]};const service=createComponents({db,getWorkbenches:()=>builtins,getAll:space=>records[space]||[],today:()=>date,readSettings:()=>({waterGoalMl:1800}),clock:()=>now});return {db,service,records,setNow:v=>{now=v}};};

test('component vocabulary is bounded, typed, code-free and templates match actual source types',()=>{
 for(const t of COMPONENT_TEMPLATES)assert.doesNotThrow(()=>validateComponentDefinition(createComponentDefinition(t.id,t.sourceType==='reading'?'reading':'health')));
 const d=createComponentDefinition();
 for(const mutate of [v=>v.html='<script>1</script>',v=>v.appearance.accent='url(javascript:1)',v=>v.blocks[0].binding.sql='SELECT *',v=>v.blocks.push({...v.blocks[0]}),v=>v.blocks[0].binding.field='password_hash',v=>v.blocks[0].binding.kind='asset_holding',v=>v.blocks[2].binding.days=null,v=>v.blocks[0].binding.days=100000,v=>v.blocks[0].target={mode:'fixed',value:1}]){const copy=structuredClone(d);mutate(copy);assert.throws(()=>validateComponentDefinition(copy),e=>e.expose&&e.code==='validation_failed');}
 const f=fixture();try{assert.throws(()=>f.service.create(input,{definition:{...d,sourceWorkbench:'finance'}}),/来源工作台不匹配/);assert.throws(()=>f.service.create(input,{definition:{...d,sourceWorkbench:'foreign'}}),e=>e.code==='component_source_unavailable');}finally{f.db.close();}
});

test('draft/publish/version/archive lifecycle is independent of data and cross-workbench placements',()=>{
 const f=fixture();try{const original=structuredClone(f.records),s=f.service;
  const draft=s.create(input,{definition:createComponentDefinition()});assert.equal(draft.revision,1);assert.equal(draft.status,'draft');assert.equal(draft.publishedDefinition,null);
  assert.throws(()=>s.updatePlacements(input,{expectedRevision:0,mobile:[instance(draft.id)]}),/先发布/);
  const published=s.publish(input,draft.id,{expectedRevision:1});assert.equal(published.publishedRevision,2);
  const p=instance(draft.id),placed=s.updatePlacements({...input,workbench:builtins[2]},{expectedRevision:0,mobile:[p]});assert.equal(placed.revision,1);assert.deepEqual(placed.desktop,[]);
  const view=s.view({...input,workbench:builtins[2]});assert.equal(view.mobile[0].model.source.id,'health');assert.equal(view.mobile[0].model.blocks[0].value,50);assert.deepEqual(view.mobile[0].model.blocks[2].points.slice(-2).map(x=>x.value),[30,20]);
  const demo=s.view({...input,workbench:builtins[2],space:'demo'});assert.equal(demo.mobile[0].model.blocks[0].value,7);
  const updated=s.update(input,draft.id,{expectedRevision:2,definition:{...published.definition,title:'草稿新名称'}});assert.equal(updated.hasDraftChanges,true);assert.equal(s.view({...input,workbench:builtins[2]}).mobile[0].model.title,published.definition.title);
  assert.equal(s.view({...input,workbench:builtins[2]}).mobile[0].component.title,published.definition.title);
  assert.throws(()=>s.publish(input,draft.id,{expectedRevision:2}),e=>e.code==='component_conflict');
  const next=s.publish(input,draft.id,{expectedRevision:3});assert.equal(s.view({...input,workbench:builtins[2]}).mobile[0].model.title,'草稿新名称');
  const archived=s.archive(input,draft.id,{expectedRevision:next.revision,archived:true});assert.equal(s.view({...input,workbench:builtins[2]}).mobile[0].model,undefined);assert.match(s.view({...input,workbench:builtins[2]}).mobile[0].unavailable,/归档/);
  assert.throws(()=>s.updatePlacements(input,{expectedRevision:0,mobile:[instance(draft.id)]}),/启用/);
  const copy=s.duplicate(input,draft.id,{expectedRevision:archived.revision});assert.notEqual(copy.id,draft.id);assert.equal(copy.publishedRevision,null);
  const restored=s.restore(input,draft.id,{expectedRevision:archived.revision,revision:1});assert.equal(restored.archived,true);assert.equal(restored.definition.title,published.definition.title);assert.equal(restored.publishedDefinition.title,'草稿新名称');
  const active=s.archive(input,draft.id,{expectedRevision:restored.revision,archived:false});assert.equal(active.status,'published');assert.equal(s.view({...input,workbench:builtins[2]}).mobile[0].model.title,'草稿新名称');
  s.restorePlacements({...input,workbench:builtins[2]},{expectedRevision:1,revision:0});assert.deepEqual(s.view({...input,workbench:builtins[2]}).mobile,[]);assert.deepEqual(f.records,original);
 }finally{f.db.close();}
});

test('unknown numeric values stay unknown, daily gaps and progress have faithful meanings',()=>{
 const f=fixture();try{const d=createComponentDefinition();d.blocks=[{id:'distance',type:'stat',label:'距离',binding:{kind:'exercise',aggregation:'sum',field:'distance',days:7}},{id:'average',type:'chart',label:'平均距离',chart:'line',binding:{kind:'exercise',aggregation:'dailyAvg',field:'distance',days:7}}];const p=f.service.preview(input,{definition:d});assert.equal(p.model.blocks[0].value,null);assert.ok(p.model.blocks[1].points.every(x=>x.value===null));
  const water=f.service.preview(input,{definition:createComponentDefinition('water-progress')});assert.equal(water.model.blocks[0].value,0);assert.equal(water.model.blocks[0].target,1800);
  assert.equal(f.service.list(input).components.length,0);
 }finally{f.db.close();}
});

test('mixed known and missing numeric fields disclose partial statistics without mutating records',()=>{
 const f=fixture();try{
  f.records.personal[0].distance=2.5;const before=structuredClone(f.records),d=createComponentDefinition();
  const bind=aggregation=>({kind:'exercise',aggregation,field:'distance',days:7});
  d.blocks=[{id:'sum',type:'stat',label:'运动距离',binding:bind('sum')},{id:'daily',type:'chart',label:'每日距离',chart:'bar',binding:bind('dailySum')},{id:'average',type:'chart',label:'平均距离',chart:'line',binding:bind('dailyAvg')},{id:'goal',type:'progress',label:'距离进度',binding:bind('sum'),target:{mode:'fixed',value:10}},{id:'latest',type:'stat',label:'最近距离',binding:bind('latest')}];
  const blocks=f.service.preview(input,{definition:d}).model.blocks;
  assert.equal(blocks[0].value,2.5);assert.equal(blocks[1].points.at(-1).value,2.5);assert.equal(blocks[1].points.at(-2).value,null);assert.equal(blocks[2].points.at(-1).value,2.5);assert.equal(blocks[3].value,2.5);
  for(const block of blocks.slice(0,4))assert.equal(block.detail,'1条记录未填写运动距离，仅统计已填写记录');
  assert.equal(blocks[4].detail,date);assert.deepEqual(f.records,before);
 }finally{f.db.close();}
});

test('preview numeric aggregates preserve tiny positive values while removing floating point noise',()=>{
 const f=fixture();try{
  f.records.personal[0].distance=0.00001;f.records.personal[1].distance=0.00002;
  const before=structuredClone(f.records),d=createComponentDefinition();
  d.blocks=[{id:'sum',type:'stat',label:'运动距离',binding:{kind:'exercise',aggregation:'sum',field:'distance',days:7}},{id:'daily',type:'chart',label:'每日距离',chart:'bar',binding:{kind:'exercise',aggregation:'dailySum',field:'distance',days:7}}];
  const model=f.service.preview(input,{definition:d}).model;
  assert.equal(model.blocks[0].value,0.00003);assert.ok(model.blocks[0].value>0);
  assert.deepEqual(model.blocks[1].points.slice(-2).map(p=>p.value),[0.00002,0.00001]);assert.ok(model.blocks[1].points.at(-1).value>0);assert.deepEqual(f.records,before);
  f.records.personal[0].distance=0.1;f.records.personal[1].distance=0.2;
  assert.equal(f.service.preview(input,{definition:d}).model.blocks[0].value,0.3);
 }finally{f.db.close();}
});

test('private previews expire and save idempotently; CAS and failed transactions never partially write',()=>{
 const f=fixture();try{const s=f.service,d=createComponentDefinition(),p=s.preview(input,{definition:d}),saved=s.savePreview(input,p.previewId,{});assert.equal(s.savePreview(input,p.previewId,{}).id,saved.id);assert.equal(s.list(input).components.length,1);
  const edit=s.preview(input,{definition:{...d,title:'候选'},componentId:saved.id,expectedRevision:saved.revision});s.update(input,saved.id,{expectedRevision:saved.revision,definition:{...d,title:'另一次修改'}});assert.throws(()=>s.savePreview(input,edit.previewId,{expectedRevision:saved.revision}),e=>e.code==='component_conflict');
  const exp=s.preview(input,{definition:d});f.setNow(Date.parse(date+'T12:00:00Z'));assert.throws(()=>s.getPreview(input,exp.previewId),e=>e.code==='component_preview_unavailable');
  const before=s.get(input,saved.id);f.db.exec("CREATE TRIGGER fail_component_history BEFORE INSERT ON component_versions BEGIN SELECT RAISE(ABORT,'simulated failure'); END");assert.throws(()=>s.update(input,saved.id,{expectedRevision:before.revision,definition:{...d,title:'will roll back'}}),/simulated failure/);assert.deepEqual(s.get(input,saved.id),before);
 }finally{f.db.close();}
});

let server,dir,base,port,a,b,tokenA,tokenB;
const password='Fictional-component-test-91';
async function request(route,{method='GET',body,headers={}}={}){const r=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,headers:r.headers,body:await r.json()};}
const headers=u=>({Cookie:u.cookie,Origin:base,'X-Workbench-Owner':u.id});
async function login(email){const r=await request('/api/auth/login',{method:'POST',body:{email,password},headers:{Origin:base}});assert.equal(r.status,200);return {id:r.body.user.id,cookie:r.headers.get('set-cookie').split(';')[0]};}
async function mint(u){return (await request('/api/auth/tokens',{method:'POST',body:{name:'component-test'},headers:headers(u)})).body.token;}
let callId=0;
async function mcp(token,name,args={}){const r=await request('/mcp',{method:'POST',headers:{Authorization:'Bearer '+token},body:{jsonrpc:'2.0',id:++callId,method:'tools/call',params:{name,arguments:args}}});assert.equal(r.status,200);return r.body.result;}
async function good(token,name,args={}){const r=await mcp(token,name,args);assert.equal(r.isError,false,r.content?.[0]?.text);return r.structuredContent;}
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'components-auth-'));const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email','components-a@example.invalid','--name','Fictional A'],{cwd:repoRoot,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);port=await freePort();server=await startServer({env:{AUTH_REQUIRED:'1',NODE_ENV:'test',PORT:String(port),APP_ORIGIN:`http://127.0.0.1:${port}`,HEALTH_DATA_DIR:dir}});base=server.base;a=await login('components-a@example.invalid');tokenA=await mint(a);const inv=await request('/api/auth/invitations',{method:'POST',headers:headers(a),body:{email:'components-b@example.invalid',name:'Fictional B'}});await request('/api/auth/accept-invitation',{method:'POST',headers:{Origin:base},body:{token:inv.body.token,password}});b=await login('components-b@example.invalid');tokenB=await mint(b);});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});

test('real API/MCP share typed definitions, publication, private previews and per-owner data scopes',async()=>{
 const initial=(await request('/api/state',{headers:headers(a)})).body.items;
 assert.equal((await request('/api/components')).status,401);assert.equal((await request('/api/components',{headers:{Cookie:a.cookie}})).status,409);
 const types=await good(tokenA,'list_component_types');assert.equal(types.templates.length,6);
 const d=createComponentDefinition('pending-tasks');const created=await good(tokenA,'create_component',{definition:d});assert.equal(created.revision,1);
 assert.equal((await request('/api/components/'+created.id,{headers:headers(b)})).status,404);assert.equal((await mcp(tokenB,'get_component',{id:created.id})).isError,true);
 const p=await good(tokenA,'preview_component',{definition:d,componentId:created.id,expectedRevision:1});assert.match(p.previewUrl,/componentPreview=/);assert.equal(p.space,'personal');assert.equal((await request('/api/components/previews/'+p.previewId,{headers:headers(b)})).status,404);assert.equal((await request('/api/components/'+created.id,{headers:headers(a)})).body.revision,1);
 const published=await good(tokenA,'publish_component',{id:created.id,expectedRevision:1});const placed=await good(tokenA,'update_component_placements',{workbench:'travel',expectedRevision:0,mobile:[instance(created.id)]});assert.equal(placed.revision,1);
 const state=(await request('/api/state?workbench=travel',{headers:headers(a)})).body;assert.equal(state.componentView.mobile[0].model.source.id,'health');assert.equal(state.componentView.mobile[0].component.publishedRevision,published.revision);
 assert.deepEqual((await request('/api/state?workbench=travel',{headers:headers(b)})).body.componentView.mobile,[]);
 assert.deepEqual((await request('/api/state',{headers:headers(a)})).body.items,initial);
});

test('component writes use optimistic concurrency and malformed inputs cannot mutate existing published instances',async()=>{
 const def=createComponentDefinition(),c=(await request('/api/components',{method:'POST',headers:headers(a),body:{definition:def}})).body;
 const writes=await Promise.all(['A','B'].map(title=>request('/api/components/'+c.id,{method:'PUT',headers:headers(a),body:{expectedRevision:c.revision,definition:{...def,title}}})));assert.deepEqual(writes.map(x=>x.status).sort(),[200,409]);
 const fresh=(await request('/api/components/'+c.id,{headers:headers(a)})).body;
 for(const bad of [{...def,css:'display:none'},{...def,sourceWorkbench:'finance'},{...def,blocks:[{...def.blocks[0],binding:{...def.blocks[0].binding,field:'secret'}}]}])assert.equal((await request('/api/components/'+c.id,{method:'PUT',headers:headers(a),body:{expectedRevision:fresh.revision,definition:bad}})).status,400);
 assert.equal((await request('/api/components/'+c.id,{headers:headers(a)})).body.revision,fresh.revision);
 const published=await good(tokenA,'publish_component',{id:c.id,expectedRevision:fresh.revision});const placements=await good(tokenA,'get_component_placements');const i=instance(c.id);const same=await Promise.all([1,2].map(()=>request('/api/components/placements',{method:'PUT',headers:headers(a),body:{expectedRevision:placements.revision,desktop:[i]}})));assert.deepEqual(same.map(r=>r.status).sort(),[200,409]);
 const before=(await request('/api/components/placements',{headers:headers(a)})).body;
 assert.equal((await request('/api/components/placements',{method:'PUT',headers:headers(a),body:{expectedRevision:before.revision,mobile:[i,i]}})).status,400);
 assert.equal((await request('/api/components/placements',{headers:headers(a)})).body.revision,before.revision);
 assert.equal(published.hasDraftChanges,false);
});

test('component definitions and published placements survive restart without changing existing records',async()=>{
 const before=(await request('/api/components',{headers:headers(a)})).body.components,view=(await request('/api/state',{headers:headers(a)})).body.componentView;
 await server.stop();server=await startServer({env:{AUTH_REQUIRED:'1',NODE_ENV:'test',PORT:String(port),APP_ORIGIN:base,HEALTH_DATA_DIR:dir}});
 assert.deepEqual((await request('/api/components',{headers:headers(a)})).body.components,before);assert.deepEqual((await request('/api/state',{headers:headers(a)})).body.componentView,view);
 const db=new DatabaseSync(path.join(dir,'health.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT version FROM schema_migrations WHERE version=7').get().version,7);}finally{db.close();}
});

test('library and version retention are bounded and archived history restores only a draft',()=>{
 const f=fixture();try{const s=f.service,d=createComponentDefinition('notes-list'),c=s.create(input,{definition:d});let current=c;
  for(let i=0;i<35;i++)current=s.update(input,c.id,{expectedRevision:current.revision,definition:{...d,title:'版本 '+i}});
  assert.equal(current.history.length,31);assert.equal(current.history.at(-1).revision,1);assert.equal(current.history[29].revision,7);
  assert.throws(()=>s.restore(input,c.id,{expectedRevision:current.revision,revision:2}),e=>e.code==='component_history_unavailable');
  const restored=s.restore(input,c.id,{expectedRevision:current.revision,revision:1});assert.equal(restored.definition.title,d.title);assert.equal(restored.publishedRevision,null);
  for(let i=1;i<50;i++)s.create(input,{definition:d});assert.equal(s.list(input).components.length,50);assert.throws(()=>s.create(input,{definition:d}),e=>e.code==='component_limit');
  const before=f.db.prepare('SELECT COUNT(*) n FROM component_versions').get().n;assert.throws(()=>s.duplicate(input,c.id,{expectedRevision:restored.revision}),e=>e.code==='component_limit');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM component_versions').get().n,before);
 }finally{f.db.close();}
});

test('published definitions reuse across all boards and self-created sources remain owner-bound',async()=>{
 const def=createComponentDefinition('notes-list'),draft=await good(tokenA,'create_component',{definition:def}),published=await good(tokenA,'publish_component',{id:draft.id,expectedRevision:draft.revision});
 const custom=(await request('/api/workbenches',{method:'POST',headers:headers(a),body:{type:'other',name:'虚构组件复用'}})).body;
 for(const wb of ['health','finance','travel','reading',custom.id]){
  const before=await good(tokenA,'get_component_placements',{workbench:wb});await good(tokenA,'update_component_placements',{workbench:wb,expectedRevision:before.revision,desktop:[instance(published.id)]});
  const state=(await request('/api/state?workbench='+wb,{headers:headers(a)})).body;assert.equal(state.componentView.workbench,wb);assert.equal(state.componentView.desktop[0].model.source.id,'health');assert.equal(state.componentView.desktop[0].model.space,'personal');
 }
 const customDef=createComponentDefinition('notes-list',custom.id);const personal=await good(tokenA,'create_component',{definition:customDef});assert.equal(personal.definition.sourceWorkbench,custom.id);
 const other=await mcp(tokenB,'create_component',{definition:customDef});assert.equal(other.isError,true);assert.equal(other.structuredContent.error.code,'component_source_unavailable');
 const current=(await request('/api/state',{headers:headers(a)})).body,day=current.today;
 assert.equal((await request('/api/items',{method:'POST',headers:headers(a),body:{kind:'exercise',title:'虚构组件聚合样本',date:day,duration:17}})).status,201);
 const model=await good(tokenA,'preview_component',{definition:createComponentDefinition()});assert.equal(model.model.blocks[0].value,17);
 const demoItems=(await request('/api/state?space=demo',{headers:headers(a)})).body.items,cutoff=new Date(day+'T12:00:00Z');cutoff.setUTCDate(cutoff.getUTCDate()-6);const minimum=cutoff.toISOString().slice(0,10);
 const expected=demoItems.filter(x=>x.kind==='exercise'&&x.date>=minimum&&x.date<=day).reduce((n,x)=>n+x.duration,0),demo=await good(tokenA,'preview_component',{space:'demo',definition:createComponentDefinition()});assert.equal(demo.model.blocks[0].value,expected);assert.equal(demo.space,'demo');
});
