import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {startServer,freePort,repoRoot} from './helpers.mjs';
import {createLayouts} from '../lib/layouts.mjs';
import {defaultLayoutConfig,applyLayoutChanges} from '../public/layout-config.js';

test('declarative patch preserves untouched devices, rejects executable/unknown options and unsupported sizes',()=>{
 const initial=defaultLayoutConfig();
 assert.equal(initial.mobile.widgets.find(w=>w.id==='tasks').options.limit,5);
 const out=applyLayoutChanges(initial,'#2C6B51',{mobile:{order:['tasks','trend'],widgets:[{id:'trend',options:{metric:'pressure',range:30}},{id:'exercise',visible:false},{id:'tasks',size:'small',options:{limit:2}}]}});
 assert.deepEqual(out.config.desktop,initial.desktop);assert.equal(out.config.mobile.mode,'custom');assert.deepEqual(out.config.mobile.widgets.slice(0,2).map(w=>w.id),['tasks','trend']);
 assert.equal(out.config.mobile.widgets.find(w=>w.id==='exercise').visible,false);assert.deepEqual(initial,defaultLayoutConfig());
 for(const changes of [{css:'body{display:none}'},{themeColor:'url(javascript:1)'},{mobile:{order:['tasks','tasks']}},{mobile:{widgets:[{id:'trend',size:'small'}]}},{desktop:{widgets:[{id:'medications',size:'medium'}]}},{mobile:{widgets:[{id:'reports',options:{metric:'weight'}}]}},{mobile:{widgets:[{id:'trend',options:{range:0}}]}},{mobile:{widgets:[{id:'tasks',options:{limit:9}}]}},{mobile:{reset:true,order:['water']}}])assert.throws(()=>applyLayoutChanges(initial,'#2C6B51',changes),e=>e.expose&&e.code==='validation_failed');
 const reset=applyLayoutChanges(out.config,'#2C6B51',{mobile:{reset:true}});assert.deepEqual(reset.config,initial);
});

test('preview expiry, transaction rollback and bounded immutable history use actual SQLite',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,created_at INTEGER); CREATE TABLE workbenches(id TEXT PRIMARY KEY,name TEXT,type TEXT,themeColor TEXT)');
 let now=Date.parse('2026-11-04T12:00:00Z');const layout=createLayouts({db,clock:()=>now}),input={workbench:{id:'health',type:'health'}};
 try{
  const before=layout.get(input),draft=layout.preview(input,{expectedRevision:0,changes:{themeColor:'#778899'}});
  assert.equal(layout.get(input).themeColor,before.themeColor);now+=3600001;
  assert.throws(()=>layout.getPreview(input,draft.previewId),e=>e.code==='layout_preview_unavailable');
  db.exec("CREATE TRIGGER reject_theme BEFORE INSERT ON workbenches BEGIN SELECT RAISE(ABORT,'simulated write failure'); END");
  assert.throws(()=>layout.update(input,{expectedRevision:0,changes:{themeColor:'#123456'}}),/simulated write failure/);
  assert.deepEqual(layout.get(input),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM dashboard_layout_versions').get().n,0);
  db.exec('DROP TRIGGER reject_theme');
  for(let revision=0;revision<35;revision++)layout.update(input,{expectedRevision:revision,changes:{mobile:{widgets:[{id:'exercise',visible:revision%2===0}]}}});
  const current=layout.get(input);assert.equal(current.revision,35);assert.equal(current.history.length,31);assert.equal(current.history.at(-1).revision,0);assert.equal(current.history[29].revision,6);
  assert.throws(()=>layout.restore(input,{expectedRevision:35,revision:1}),e=>e.code==='layout_history_unavailable');
  const restored=layout.restore(input,{expectedRevision:35,revision:0});assert.equal(restored.revision,36);assert.deepEqual(restored.config,defaultLayoutConfig());assert.equal(restored.themeColor,before.themeColor);
 }finally{db.close();}
});

let dir,server,port,base,a,b,tokenA,tokenB;
const email='layout-a@example.invalid',password='Fictional-layout-passphrase-2026';
async function req(route,{method='GET',body,headers={}}={}){const response=await fetch(base+route,{method,headers:{...headers,...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,headers:response.headers,body:await response.json()};}
const web=session=>({Cookie:session.cookie,Origin:base,'X-Workbench-Owner':session.owner});
const api=(session,route,method='GET',body)=>req(route,{method,body,headers:web(session)});
async function login(mail,pass){const r=await req('/api/auth/login',{method:'POST',body:{email:mail,password:pass},headers:{Origin:base}});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],owner:r.body.user.id};}
let rpcId=1;
async function call(token,name,args={}){const r=await req('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:rpcId++,method:'tools/call',params:{name,arguments:args}},headers:{Authorization:'Bearer '+token,Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'}});assert.equal(r.status,200);assert.ok(r.body.result);return r.body.result;}
const good=async(token,name,args)=>{const r=await call(token,name,args);assert.equal(r.isError,false,r.content?.[0]?.text);return r.structuredContent;};
const bad=async(token,name,args)=>{const r=await call(token,name,args);assert.equal(r.isError,true);return r.structuredContent.error;};
async function start(){server=await startServer({env:{AUTH_REQUIRED:'1',NODE_ENV:'test',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir}});base=server.base;}
before(async()=>{
 dir=await mkdtemp(path.join(os.tmpdir(),'workbench-layout-'));
 const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','虚构布局验收A'],{cwd:repoRoot,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);
 port=await freePort();await start();a=await login(email,password);
 const invitation=await api(a,'/api/auth/invitations','POST',{email:'layout-b@example.invalid',name:'虚构布局验收B'});assert.equal(invitation.status,201);
 assert.equal((await req('/api/auth/accept-invitation',{method:'POST',body:{token:invitation.body.token,password},headers:{Origin:base}})).status,200);b=await login('layout-b@example.invalid',password);
 tokenA=(await api(a,'/api/auth/tokens','POST',{name:'虚构布局验收'})).body.token;tokenB=(await api(b,'/api/auth/tokens','POST',{name:'虚构布局验收'})).body.token;
});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});

test('existing databases upgrade additively and default layout is account-scoped and present in state/bootstrap',async()=>{
 const r=await api(a,'/api/layout');assert.equal(r.status,200);assert.equal(r.body.revision,0);assert.equal(r.body.owner,a.owner);assert.deepEqual(r.body.config,defaultLayoutConfig());
 assert.deepEqual((await api(a,'/api/layout?space=demo')).body,r.body);
 const state=(await api(a,'/api/state')).body,bootstrap=(await api(a,'/api/bootstrap')).body;
 assert.deepEqual(state.layout,r.body);assert.deepEqual(bootstrap.state.layout,r.body);
 assert.equal((await api(a,'/api/layout?workbench=finance')).body.code,'unsupported_layout');assert.equal((await api(a,'/api/layout?page=metric')).body.code,'unsupported_layout');
 assert.equal((await req('/api/layout',{headers:{Cookie:a.cookie}})).status,409);assert.equal((await req('/api/layout',{headers:{...web(a),'X-Workbench-Owner':b.owner}})).status,409);
 assert.equal((await req('/api/layout')).status,401);
 const catalog=(await good(tokenA,'list_layout_widgets')).widgets;assert.equal(catalog.length,9);assert.ok(catalog.every(w=>w.title&&w.sizes.mobile.length));
});

test('MCP changes only requested device, options and theme; web sees result without touching records',async()=>{
 const records=(await api(a,'/api/state')).body.items;
 const updated=await good(tokenA,'update_layout',{expectedRevision:0,changes:{themeColor:'#77bc32',mobile:{order:['tasks','trend'],widgets:[{id:'exercise',visible:false},{id:'trend',options:{metric:'pressure',range:30}}]}}});
 assert.equal(updated.revision,1);assert.equal(updated.themeColor,'#77BC32');assert.deepEqual(updated.config.desktop,defaultLayoutConfig().desktop);assert.equal(updated.config.mobile.widgets[0].id,'tasks');assert.equal(updated.history[0].source,'mcp');
 const state=(await api(a,'/api/state')).body;assert.deepEqual(state.items,records);assert.deepEqual(state.layout,updated);assert.equal(state.workbench.themeColor,'#77BC32');
 assert.equal((await good(tokenB,'get_layout')).revision,0);assert.equal((await good(tokenB,'get_layout')).themeColor,'#2C6B51');
 assert.equal((await bad(tokenA,'update_layout',{expectedRevision:1,workbench:'finance',changes:{themeColor:'#123456'}})).code,'unsupported_layout');
});

test('previews are private, do not change live layout, apply once and reject stale bases',async()=>{
 const original=(await api(a,'/api/layout')).body;
 const draft=await good(tokenA,'preview_layout',{expectedRevision:original.revision,changes:{themeColor:'#356A98',desktop:{order:['water'],widgets:[{id:'water',size:'large'}]}}});
 assert.equal(draft.preview,true);assert.equal(draft.baseRevision,original.revision);assert.match(draft.previewUrl,new RegExp('^'+base.replaceAll('.','\\.')+'/\\?layoutPreview='));
 assert.deepEqual(draft.affectedDevices,['desktop']);assert.match(draft.previewUrl,/&layoutDevice=desktop#dashboard$/);
 assert.deepEqual((await api(a,'/api/layout')).body,original);assert.equal((await api(b,'/api/layout/preview/'+draft.previewId)).status,404);
 assert.equal((await bad(tokenB,'update_layout',{expectedRevision:0,previewId:draft.previewId})).code,'layout_preview_unavailable');
 const applied=await api(a,'/api/layout','POST',{expectedRevision:original.revision,previewId:draft.previewId});assert.equal(applied.status,200);assert.equal(applied.body.themeColor,'#356A98');assert.equal(applied.body.config.desktop.widgets[0].id,'water');
 assert.equal((await api(a,'/api/layout/preview/'+draft.previewId)).status,404);
 const stale=(await api(a,'/api/layout/preview','POST',{expectedRevision:applied.body.revision,changes:{mobile:{order:['water']}}})).body;
 const revision=applied.body.revision;
 const outcomes=await Promise.all([api(a,'/api/layout','POST',{expectedRevision:revision,changes:{mobile:{order:['reports']}}}),api(a,'/api/layout','POST',{expectedRevision:revision,changes:{mobile:{order:['visits']}}})]);assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
 assert.equal((await api(a,'/api/layout','POST',{expectedRevision:revision+1,previewId:stale.previewId})).body.code,'layout_conflict');
 assert.equal((await bad(tokenA,'update_layout',{expectedRevision:0,changes:{themeColor:'#111111'}})).code,'layout_conflict');
});

test('only current-owner valid root preview GET permits same-origin framing, including isolated loopback mode',async()=>{
 const current=(await api(a,'/api/layout')).body;
 const draft=(await api(a,'/api/layout/preview','POST',{expectedRevision:current.revision,changes:{mobile:{order:['water']}}})).body;
 assert.deepEqual(draft.affectedDevices,['mobile']);assert.match(draft.previewUrl,/&layoutDevice=mobile#dashboard$/);
 const query='?layoutFrame=1&layoutPreview='+draft.previewId;
 const check=async(route,session,allowed,method='GET')=>{const response=await fetch(base+route,{method,headers:session?{Cookie:session.cookie}:{}});assert.equal(response.status,200);assert.equal(response.headers.get('x-frame-options'),allowed?'SAMEORIGIN':'DENY');assert.match(response.headers.get('content-security-policy'),new RegExp("frame-ancestors '"+(allowed?'self':'none')+"'"));assert.equal(response.headers.get('cache-control'),'no-store');await response.arrayBuffer();};
 await check('/'+query,a,true);
 await check('/'+query,b,false);
 await check('/'+query,null,false);
 await check('/?layoutPreview='+draft.previewId,a,false);
 await check('/?layoutFrame=1',a,false);
 await check('/?layoutFrame=1&layoutPreview=invalid',a,false);
 await check('/'+query+'&workbench=finance',a,false);
 await check('/'+query+'&page=metric',a,false);
 await check('/index.html'+query,a,false);
 await check('/app.js'+query,a,false);
 await check('/'+query,a,false,'HEAD');
 const plain=(await api(a,'/api/layout/preview','POST',{expectedRevision:current.revision,changes:{themeColor:'#223344'}})).body;assert.deepEqual(plain.affectedDevices,[]);assert.ok(!plain.previewUrl.includes('layoutDevice='));
 const both=(await api(a,'/api/layout/preview','POST',{expectedRevision:current.revision,changes:{mobile:{order:['tasks']},desktop:{order:['tasks']}}})).body;assert.deepEqual(both.affectedDevices,['desktop','mobile']);assert.ok(!both.previewUrl.includes('layoutDevice='));
 const db=new DatabaseSync(path.join(dir,'health.sqlite'));try{db.prepare('UPDATE dashboard_layout_previews SET expires_at=0 WHERE id=?').run(draft.previewId);}finally{db.close();}
 await check('/'+query,a,false);
 const local=await startServer({env:{AUTH_REQUIRED:'0',NODE_ENV:'test',APP_ORIGIN:'',HOST:'127.0.0.1',HEALTH_DATA_DIR:path.join(dir,'local-preview')}});
 try{
  const preview=await (await fetch(local.base+'/api/layout/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:0,changes:{mobile:{order:['water']}}})})).json();
  const framed=await fetch(local.base+'/?layoutFrame=1&layoutPreview='+preview.previewId);assert.equal(framed.headers.get('x-frame-options'),'SAMEORIGIN');assert.match(framed.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  const normal=await fetch(local.base+'/');assert.equal(normal.headers.get('x-frame-options'),'DENY');assert.match(normal.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 }finally{await local.stop();}
});

test('invalid API/MCP patches fail closed without changing layout or theme',async()=>{
 const before=(await api(a,'/api/layout')).body;
 const invalid=[{css:'display:none'},{themeColor:'javascript:alert(1)'},{mobile:{order:['water','water']}},{desktop:{widgets:[{id:'not-a-widget',visible:false}]}},{mobile:{widgets:[{id:'trend',size:'small'}]}},{mobile:{widgets:[{id:'reports',options:{metric:'weight'}}]}},{mobile:{widgets:[{id:'trend',options:{range:365}}]}},{mobile:{widgets:[{id:'tasks',options:{limit:100}}]}},{mobile:{widgets:[{id:'tasks',html:'<script>'}]}}];
 for(const changes of invalid){const response=await api(a,'/api/layout','POST',{expectedRevision:before.revision,changes});assert.equal(response.status,400,JSON.stringify(changes));assert.equal((await bad(tokenA,'update_layout',{expectedRevision:before.revision,changes})).code,'validation_failed');}
 assert.equal((await api(a,'/api/layout','POST',{expectedRevision:before.revision,changes:{mobile:{order:['water']}},previewId:'00000000-0000-0000-0000-000000000000'})).status,400);
 assert.equal((await api(a,'/api/layout','POST',{changes:{themeColor:'#123456'}})).status,400);
 assert.deepEqual((await api(a,'/api/layout')).body,before);
});

test('a streamed old theme-picker request that omits theme does not revert a concurrent AI theme',async()=>{
 const before=(await api(a,'/api/layout')).body;
 let finish;
 const response=new Promise((resolve,reject)=>{
  const request=http.request(base+'/api/workbenches/health',{method:'PATCH',headers:{...web(a),'Content-Type':'application/json',Expect:'100-continue'}},res=>{let text='';res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});
  request.on('error',reject);finish=request;request.flushHeaders();
 });
 await once(finish,'continue');finish.write('{"name":');
 const changed=await good(tokenA,'update_layout',{expectedRevision:before.revision,changes:{themeColor:'#445566'}});
 finish.end('"健康"}');const result=await response;
 assert.equal(result.status,200);assert.equal(result.body.themeColor,'#445566');assert.equal((await api(a,'/api/layout')).body.themeColor,'#445566');assert.equal((await api(a,'/api/layout')).body.revision,changed.revision);
});

test('old theme picker versions current layout, restores preserve records and survive server restart',async()=>{
 const before=(await api(a,'/api/layout')).body;
 const themed=await api(a,'/api/workbenches/health','PATCH',{themeColor:'#74634F'});assert.equal(themed.status,200);
 const changed=(await api(a,'/api/layout')).body;assert.equal(changed.revision,before.revision+1);assert.deepEqual(changed.config,before.config);assert.equal(changed.history[0].source,'theme');
 const restored=await good(tokenA,'restore_layout',{expectedRevision:changed.revision});assert.equal(restored.revision,changed.revision+1);assert.equal(restored.themeColor,before.themeColor);assert.deepEqual(restored.config,before.config);
 const reset=await api(a,'/api/layout','POST',{expectedRevision:restored.revision,changes:{mobile:{reset:true}}});assert.equal(reset.status,200);assert.deepEqual(reset.body.config.mobile,defaultLayoutConfig().mobile);assert.deepEqual(reset.body.config.desktop,restored.config.desktop);
 const draft=(await api(a,'/api/layout/preview','POST',{expectedRevision:reset.body.revision,changes:{themeColor:'#112233'}})).body;
 await server.stop();await start();
 assert.deepEqual((await api(a,'/api/layout')).body,reset.body);assert.equal((await api(a,'/api/layout/preview/'+draft.previewId)).body.previewId,draft.previewId);
 assert.equal((await api(b,'/api/layout/preview/'+draft.previewId)).status,404);
 const initial=await api(a,'/api/layout/restore','POST',{expectedRevision:reset.body.revision,revision:0});assert.equal(initial.status,200);assert.deepEqual(initial.body.config,defaultLayoutConfig());assert.equal(initial.body.themeColor,'#2C6B51');assert.deepEqual((await api(a,'/api/state')).body.items,[]);
});
