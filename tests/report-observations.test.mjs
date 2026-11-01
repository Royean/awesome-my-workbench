// Integration coverage uses disposable storage and fictional accounts only.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startServer,freePort} from './helpers.mjs';
const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-image-passphrase-93',email='report-data@example.invalid';
let dir,server,base,cookie,token,otherCookie,otherToken,env;
async function req(route,{method='GET',body,who=cookie}={}){const r=await fetch(base+route,{method,headers:{...(who?{Cookie:who}:{}),Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),headers:r.headers};}
async function login(e,p){const r=await req('/api/auth/login',{method:'POST',body:{email:e,password:p},who:''});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
async function mint(who){return (await req('/api/auth/tokens',{method:'POST',body:{name:'images-test'},who})).body.token;}
async function rpc(name,args={},t=token){const r=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(r.status,200);return (await r.json()).result;}
async function create(kind,body={}){const r=await req('/api/items',{method:'POST',body:{kind,date:'2026-10-01',...body}});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'report-data-'));const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','Fictional image tester'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);const port=await freePort();env={NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir};server=await startServer({cwd,env});base=server.base;cookie=await login(email,password);token=await mint(cookie);const invite=await req('/api/auth/invitations',{method:'POST',body:{email:'report-data-other@example.invalid',name:'Fictional other'}});assert.equal(invite.status,201);assert.equal((await req('/api/auth/accept-invitation',{method:'POST',body:{token:invite.body.token,password},who:''})).status,200);otherCookie=await login('report-data-other@example.invalid',password);otherToken=await mint(otherCookie);});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});


import {validateReportObservations} from '../lib/report-observations.mjs';
import {renderReportObservations} from '../public/report-data.js';
const observations=[{label:'虚构指标',code:'TEST',result:'<0.42',unit:'示例单位',reference:'<0.50',flag:''},{label:'虚构电轴',result:'-12',unit:'°',flag:'↑'}];
test('report observations survive web/MCP edits, restart and keep owner/scope isolation',async()=>{
 const v=await create('visit',{title:'虚构指标来源',status:'已完成'});
 const r=await rpc('create_record',{kind:'report',title:'虚构结构化报告',date:'2026-10-01',visitId:v.id,content:'fictional only',type:'检验报告',observations});
 assert.equal(r.isError,false,JSON.stringify(r));const report=r.structuredContent.created;
 assert.equal(report.observations[0].result,'<0.42');assert.equal(report.observations[1].result,'-12');
 assert.equal((await req('/api/items/'+report.id,{method:'PUT',body:{title:'网页更正标题'}})).body.observations.length,2);
 assert.equal((await rpc('update_record',{id:report.id,note:'只改备注'})).structuredContent.updated.observations.length,2);
 assert.equal((await rpc('update_record',{id:report.id,observations:[]},otherToken)).isError,true);
 assert.equal((await rpc('update_record',{id:report.id,space:'demo',observations:[]})).isError,true);
 assert.ok(!(await req('/api/state',{who:otherCookie})).body.items.some(x=>x.id===report.id));
 assert.equal((await req('/api/items/'+report.id,{method:'PUT',who:otherCookie,body:{observations:[]}})).status,404);
 await server.stop();server=await startServer({cwd,env});base=server.base;
 const listed=await rpc('list_records',{kind:'report'});assert.equal(listed.structuredContent.records.find(x=>x.id===report.id).observations.length,2);
 const clear=await rpc('update_record',{id:report.id,observations:[]});assert.deepEqual(clear.structuredContent.updated.observations,[]);
 const legacy=await create('report',{title:'旧文字报告',visitId:v.id,content:'原文'});assert.deepEqual(legacy.observations,[]);
});
test('web and MCP reject malformed report arrays without changing stored results',async()=>{
 const v=await create('visit',{title:'虚构校验来源',status:'已完成'}),r=await create('report',{title:'虚构校验报告',visitId:v.id,content:'原文',observations});
 for(const value of [null,{},[null],[{label:'x',result:3}],[{label:'x',result:' ' }],[{label:'x',result:'1',flag:'正常'}],[{label:'x',result:'1',unexpected:'no'}],[{label:'x'.repeat(121),result:'1'}],Array.from({length:201},()=>({label:'x',result:'1'}))]){
  assert.equal((await req('/api/items/'+r.id,{method:'PUT',body:{observations:value}})).status,400);
  assert.equal((await rpc('update_record',{id:r.id,observations:value})).isError,true);
 }
 assert.equal((await rpc('list_records',{kind:'report'})).structuredContent.records.find(x=>x.id===r.id).observations.length,2);
 assert.equal((await rpc('create_record',{kind:'metric',title:'不支持的指标容器',type:'heart',value:80,observations})).isError,true);
});
test('renderer escapes every imported field and keeps missing reference/flag explicit',()=>{
 const esc=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
 const payload='<img src=x onerror=alert(1)>';
 const html=renderReportObservations([{label:payload,code:payload,result:payload,unit:payload,reference:payload,flag:payload}],esc);
 assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);assert.match(html,/scope="row"/);
 const blank=renderReportObservations([{label:'示例',result:'1'}],esc);assert.match(blank,/未注明/);assert.match(blank,/未标记/);assert.equal(renderReportObservations(undefined,esc),'');
 assert.deepEqual(validateReportObservations(undefined),[]);
});
