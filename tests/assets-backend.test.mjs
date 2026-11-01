// Integration coverage uses disposable storage and fictional accounts only.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {startServer,freePort} from './helpers.mjs';
import {validateAsset} from '../lib/assets.mjs';
const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-image-passphrase-93',email='assets-backend@example.invalid';
let dir,server,base,cookie,token,otherCookie,otherToken,env;
const owners=new Map();
async function req(route,{method='GET',body,who=cookie,owner}={}){const r=await fetch(base+route,{method,headers:{...(who?{Cookie:who}:{}),Origin:base,'Content-Type':'application/json','X-Workbench-Owner':owner??owners.get(who)??''},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),headers:r.headers};}
async function login(e,p){const r=await req('/api/auth/login',{method:'POST',body:{email:e,password:p},who:''});assert.equal(r.status,200);const ck=r.headers.get('set-cookie').split(';')[0];owners.set(ck,r.body.user.id);return ck;}
async function mint(who){return (await req('/api/auth/tokens',{method:'POST',body:{name:'images-test'},who})).body.token;}
async function rpc(name,args={},t=token){const r=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(r.status,200);return (await r.json()).result;}
async function create(kind,body={}){const r=await req('/api/items',{method:'POST',body:{kind,date:'2026-10-01',...body}});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'assets-backend-'));const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','Fictional image tester'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);const port=await freePort();env={NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir};server=await startServer({cwd,env});base=server.base;cookie=await login(email,password);token=await mint(cookie);const invite=await req('/api/auth/invitations',{method:'POST',body:{email:'assets-backend-other@example.invalid',name:'Fictional other'}});assert.equal(invite.status,201);assert.equal((await req('/api/auth/accept-invitation',{method:'POST',body:{token:invite.body.token,password},who:''})).status,200);otherCookie=await login('assets-backend-other@example.invalid',password);otherToken=await mint(otherCookie);});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});


const fin=(route='')=>route+(route.includes('?')?'&':'?')+'workbench=finance';
const c=async(kind,b={})=>{const r=await req(fin('/api/items'),{method:'POST',body:{kind,title:'虚构资产',date:'2026-10-01',currency:'CNY',...b}});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;};
test('future asset plans are excluded from confirmed current positions; historical snapshots and due dates remain allowed',()=>{
 const base={title:'虚构未来计划',date:'2026-11-01',currency:'CNY'},ctx={today:()=> '2026-11-01',validDate:v=>/^\d{4}-\d{2}-\d{2}$/.test(v),bad:(message,field,code)=>Object.assign(new Error(message),{field,code})};
 const check=(kind,fields)=>validateAsset(kind,{...base,...fields},ctx);
 for(const [kind,fields,field] of [
  ['asset_holding',{category:'stock',date:'2026-11-02'},'date'],
  ['asset_holding',{category:'fund',valuationDate:'2026-11-02'},'valuationDate'],
  ['asset_liability',{date:'2026-11-02'},'date'],
  ['asset_liability',{asOfDate:'2026-11-02'},'asOfDate'],
  ['asset_account',{balance:0,includeInTotal:true,date:'2026-11-02'},'date'],
  ['asset_account',{balance:1,includeInTotal:true,balanceAsOf:'2026-11-02'},'balanceAsOf'],
 ])assert.throws(()=>check(kind,fields),e=>e.code==='future_date'&&e.field===field);
 for(const status of ['pending','closed']){
  assert.equal(check('asset_holding',{category:'stock',date:'2026-11-02',valuationDate:'2026-11-03',status}).status,status);
  assert.equal(check('asset_liability',{date:'2026-11-02',asOfDate:'2026-11-03',status}).status,status);
 }
 assert.equal(check('asset_account',{balance:1,includeInTotal:false,balanceAsOf:'2026-11-02'}).includeInTotal,false);
 assert.equal(check('asset_account',{includeInTotal:true,balanceAsOf:'2026-11-02'}).balance,undefined);
 assert.equal(check('asset_liability',{balance:1,dueDate:'2027-01-01'}).dueDate,'2027-01-01');
 assert.equal(check('asset_holding',{category:'stock',valuationDate:'2026-11-01'}).status,'active');
 assert.equal(check('asset_snapshot',{date:'2026-11-02',totalValue:1}).totalValue,1);
});
test('default asset name and theme; themes persist per account without affecting health',async()=>{
 const w=(await req('/api/workbenches')).body.workbenches;assert.equal(w.find(x=>x.id==='finance').name,'资产');assert.equal(w.find(x=>x.id==='finance').themeColor,'#A65343');assert.equal(w.find(x=>x.id==='health').themeColor,'#2C6B51');
 const theme=await req('/api/workbenches/finance',{method:'PATCH',body:{themeColor:'#824536'}});assert.equal(theme.status,200);assert.equal(theme.body.themeColor,'#824536');
 assert.equal((await req('/api/workbenches/finance',{method:'PATCH',body:{themeColor:'red;display:none'}})).status,400);
 assert.equal((await req('/api/workbenches',{who:otherCookie})).body.workbenches.find(x=>x.id==='finance').themeColor,'#A65343');
 const boot=(await req('/api/bootstrap?workbench=finance')).body;assert.equal(boot.state.workbench.themeColor,'#824536');
 await req('/api/workbenches/finance',{method:'PATCH',body:{name:'金融'}});await server.stop();server=await startServer({cwd,env});base=server.base;assert.equal((await req(fin('/api/state'))).body.workbench.themeColor,'#824536');assert.equal((await req(fin('/api/state'))).body.workbench.name,'金融');await req('/api/workbenches/finance',{method:'PATCH',body:{name:'资产'}});
});
test('asset records preserve missing values, exact zero and raw currency; references remain scope safe',async()=>{
 const a=await c('asset_account',{title:'虚构证券账户',balance:0,balanceAsOf:'2026-10-01'});assert.equal(a.includeInTotal,false);assert.equal(a.balance,0);
 const h=await c('asset_holding',{category:'fund',accountId:a.id,quantity:12.3456,unitPrice:1.234567,value:15.2411,cost:12,valuationDate:'2026-10-01'});assert.equal(h.quantity,12.3456);assert.equal(h.unitPrice,1.234567);
 const l=await c('asset_liability',{balance:null,status:'pending',sourceDate:'2026-09-01'});assert.equal(l.balance,undefined);
 const snap=await c('asset_snapshot',{totalValue:-12.3});assert.equal(snap.totalValue,-12.3);
 const tr=await c('asset_transaction',{amount:-3.12,transactionType:'expense',accountId:a.id,assetId:h.id,status:'pending'});assert.equal(tr.amount,-3.12);
 assert.equal((await req('/api/items',{method:'POST',body:{kind:'asset_holding',title:'非法健康资产',date:'2026-10-01',currency:'CNY',category:'cash'}})).status,400);
 assert.equal((await req(fin('/api/items'),{method:'POST',body:{kind:'asset_holding',title:'错误关联',date:'2026-10-01',currency:'CNY',category:'cash',accountId:'missing'}})).status,400);
 assert.ok(!(await req(fin('/api/state'),{who:otherCookie})).body.items.some(x=>x.id===h.id));assert.equal((await req(fin('/api/items/'+h.id),{method:'PUT',who:otherCookie,body:{value:99}})).status,404);
 for(const body of [{value:-1},{quantity:'Infinity'},{cost:true},{currency:'USD<script>'},{referenceUrl:'javascript:alert(1)'},{valuationDate:'2026-02-30'}])assert.equal((await req(fin('/api/items/'+h.id),{method:'PUT',body})).status,400);
 assert.equal((await req(fin('/api/items/'+a.id),{method:'DELETE'})).status,200);assert.equal((await req(fin('/api/items/'+h.id),{method:'PUT',body:{note:'旧账户已删，保留历史关联'}})).status,200);
});
test('external import IDs are scoped, queryable through MCP and protected through soft delete/restore',async()=>{
 const x=await rpc('create_record',{workbench:'finance',kind:'asset_holding',title:'虚构导入',date:'2026-10-01',currency:'HKD',category:'stock',externalId:'fictional:one',value:0,source:'fictional source',referenceUrl:'https://example.invalid/archive'});assert.equal(x.isError,false,JSON.stringify(x));const id=x.structuredContent.created.id;
 const duplicate=await rpc('create_record',{workbench:'finance',kind:'asset_holding',title:'重复来源',date:'2026-10-01',currency:'HKD',category:'stock',externalId:'fictional:one'});assert.equal(duplicate.structuredContent.error.code,'duplicate_external_id');
 const list=await rpc('list_records',{workbench:'finance',kind:'asset_holding',externalId:'fictional:one'});assert.equal(list.structuredContent.total,1);assert.equal(list.structuredContent.records[0].value,0);
 assert.equal((await rpc('create_record',{kind:'asset_holding',title:'health拒绝',currency:'CNY',category:'cash'})).isError,true);
 const other=await rpc('create_record',{workbench:'finance',kind:'asset_holding',title:'其他用户同来源',date:'2026-10-01',currency:'CNY',category:'cash',externalId:'fictional:one'},otherToken);assert.equal(other.isError,false);
 assert.equal((await rpc('delete_record',{workbench:'finance',id})).isError,false);
 assert.equal((await rpc('create_record',{workbench:'finance',kind:'asset_holding',title:'不可重导已删来源',date:'2026-10-01',currency:'CNY',category:'cash',externalId:'fictional:one'})).structuredContent.error.code,'duplicate_external_id');
 assert.equal((await rpc('restore_record',{workbench:'finance',id})).isError,false);
});
test('finance archives upload through web and MCP, preserve owner scope and reject active HTML',async()=>{
 const bytes=Buffer.from('fictional asset document only');const up=await rpc('upload_attachment',{workbench:'finance',name:'fictional-assets.txt',date:'2026-10-01',contentBase64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')});assert.equal(up.isError,false,JSON.stringify(up));
 const file=up.structuredContent.uploaded;assert.equal((await rpc('list_attachments',{workbench:'finance'})).structuredContent.files.some(x=>x.id===file.id),true);
 assert.equal((await req('/api/files/'+file.id)).status,404);assert.equal((await req(fin('/api/files/'+file.id),{who:otherCookie})).status,404);
 assert.equal((await req(fin('/api/upload'),{method:'POST',body:{name:'active.html',date:'2026-10-01',content:bytes.toString('base64')}})).status,400);
 assert.equal((await req(fin('/api/upload'),{method:'POST',body:{name:'notes.txt',date:'2026-10-01',content:bytes.toString('base64')}})).status,201);
 assert.equal((await rpc('attach_report_file',{workbench:'finance',reportId:'none',fileId:file.id})).isError,true);
});

test('new financial writes reject old-owner forms before any mutation',async()=>{
 const b={kind:'asset_account',title:'旧账号表单',date:'2026-10-01',currency:'CNY'};
 const r=await req(fin('/api/items'),{method:'POST',body:b,who:otherCookie,owner:owners.get(cookie)});assert.equal(r.status,409);assert.equal(r.body.code,'workbench_owner_changed');
 assert.equal((await req('/api/workbenches/finance',{method:'PATCH',body:{themeColor:'#FFFFFF'},who:otherCookie,owner:owners.get(cookie)})).status,409);
 assert.equal((await req(fin('/api/upload'),{method:'POST',body:{name:'stale.txt',content:'eA=='},who:otherCookie,owner:owners.get(cookie)})).status,409);
});
