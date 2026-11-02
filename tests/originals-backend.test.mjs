// Disposable accounts/files only; real HTTP and MCP surface, no external network.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';import path from 'node:path';
import {startServer,freePort} from './helpers.mjs';
const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-originals-passphrase-93',email='originals-backend@example.invalid';
let dir,server,base,cookie,token,otherCookie,otherToken,custom,tripId;const owners=new Map();
async function req(route,{method='GET',body,who=cookie,owner}={}){const r=await fetch(base+route,{method,headers:{Cookie:who||'',Origin:base,'Content-Type':'application/json','X-Workbench-Owner':owner??owners.get(who)??''},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),headers:r.headers};}
async function login(e){const r=await req('/api/auth/login',{method:'POST',body:{email:e,password},who:''});assert.equal(r.status,200);const ck=r.headers.get('set-cookie').split(';')[0];owners.set(ck,r.body.user.id);return ck;}
async function mint(who){return (await req('/api/auth/tokens',{method:'POST',body:{name:'originals-test'},who})).body.token;}
async function rpc(name,args={},t=token){const r=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(r.status,200);return (await r.json()).result;}
const contents=Buffer.from('FICTIONAL original only\nNever a real receipt.'),sha=createHash('sha256').update(contents).digest('hex');
const file=(extra={})=>({name:'Fictional-original.txt',title:'虚构资料标题',note:'虚构测试备注 Needle',date:'2026-11-01',content:contents.toString('base64'),...extra});
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'originals-backend-'));const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','Fictional originals tester'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);const port=await freePort();server=await startServer({cwd,env:{NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir}});base=server.base;cookie=await login(email);token=await mint(cookie);const invite=await req('/api/auth/invitations',{method:'POST',body:{email:'originals-other@example.invalid',name:'Fictional other'}});assert.equal(invite.status,201);assert.equal((await req('/api/auth/accept-invitation',{method:'POST',body:{token:invite.body.token,password},who:''})).status,200);otherCookie=await login('originals-other@example.invalid');otherToken=await mint(otherCookie);custom=(await req('/api/workbenches',{method:'POST',body:{name:'虚构自建资料',type:'other'}})).body.id;assert.ok(custom);const p=await req('/api/items?workbench=travel',{method:'POST',body:{kind:'travel_trip',title:'虚构旅行',startDate:'2027-02-01',endDate:'2027-02-03'}});assert.equal(p.status,201);tripId=p.body.id;});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});

test('all workbenches including custom upload/query originals; metadata never contains storage paths',async()=>{
 for(const workbench of ['health','finance','travel',custom]){
  const r=await req('/api/upload?workbench='+workbench,{method:'POST',body:file()});assert.equal(r.status,201,JSON.stringify(r.body));
  const q=await req('/api/attachments?workbench='+workbench+'&query=fictional-original&fileType=text&from=2026-11-01&to=2026-11-01');assert.equal(q.status,200);assert.equal(q.body.total,1);const f=q.body.files[0];assert.equal(f.id,r.body.id);assert.equal(f.sha256,sha);assert.equal(f.note,'虚构测试备注 Needle');assert.equal(f.mime,'text/plain');assert.equal(f.type,'text/plain');assert.equal(f.storageName,undefined);assert.equal(f.content,undefined);
  assert.equal((await req('/api/attachments?workbench='+workbench+'&query=needle')).body.total,1);
  const raw=await fetch(base+'/api/files/'+f.id+'?workbench='+workbench,{headers:{Cookie:cookie}});assert.equal(raw.status,200);assert.deepEqual(Buffer.from(await raw.arrayBuffer()),contents);
  assert.equal((await req('/api/attachments?workbench='+workbench+'&space=demo')).body.total,0);
  assert.equal((await req('/api/attachments?workbench='+workbench,{who:otherCookie})).status,workbench===custom?404:200);
  if(workbench!==custom)assert.equal((await req('/api/attachments?workbench='+workbench,{who:otherCookie})).body.total,0);
 }
});

test('original query supports stable >200 pagination and MIME/date/search combinations over MCP and HTTP',async()=>{
 for(let i=0;i<205;i++)assert.equal((await req('/api/upload?workbench='+custom,{method:'POST',body:file({name:`Page-${String(i).padStart(3,'0')}.txt`,title:'分页虚构 '+i,note:'pagination-only',date:i<100?'2026-10-30':'2026-10-31'})})).status,201);
 const first=await rpc('list_attachments',{workbench:custom,query:'pagination-only',limit:200});assert.equal(first.isError,false);const a=first.structuredContent;assert.equal(a.total,205);assert.equal(a.returned,200);assert.equal(a.hasMore,true);assert.equal(a.nextOffset,200);
 const second=(await rpc('list_attachments',{workbench:custom,query:'pagination-only',offset:200,limit:200})).structuredContent;assert.equal(second.returned,5);assert.equal(second.hasMore,false);assert.equal(second.nextOffset,null);assert.equal(new Set([...a.files,...second.files].map(x=>x.id)).size,205);
 const again=(await req('/api/attachments?workbench='+custom+'&query=pagination-only&limit=200')).body;assert.deepEqual(again.files.map(x=>x.id),a.files.map(x=>x.id));
 const filtered=(await req('/api/attachments?workbench='+custom+'&query=page-&fileType=text&from=2026-10-31&to=2026-10-31&limit=200')).body;assert.equal(filtered.total,105);assert.equal((await req('/api/attachments?workbench='+custom+'&fileType=image')).body.total,0);
 const empty=(await req('/api/attachments?workbench='+custom+'&offset=9999')).body;assert.equal(empty.returned,0);assert.equal(empty.hasMore,false);
});

test('travel query finds unassigned files and validates its own scoped trip filter',async()=>{
 assert.equal((await req('/api/upload?workbench=travel',{method:'POST',body:file({tripId,name:'Fictional-assigned.txt',date:'2027-02-02'})})).status,201);
 assert.equal((await req('/api/attachments?workbench=travel&tripId=unassigned')).body.total,1);
 assert.equal((await req('/api/attachments?workbench=travel&tripId='+tripId)).body.total,1);
 assert.equal((await req('/api/attachments?workbench=travel&tripId='+tripId,{who:otherCookie})).status,400);
 assert.equal((await req('/api/attachments?workbench=health&tripId=unassigned')).status,400);
});

test('queries reject malformed filters, bounds and unknown inputs without leaking scope',async()=>{
 for(const query of ['query='+encodeURIComponent('x'.repeat(201)),'fileType=html','from=2026-02-30','to=not-a-date','from=2026-11-02&to=2026-11-01','offset=-1','offset=1.5','offset=100001','limit=0','limit=201','limit=NaN','offset=','unknown=1'])assert.equal((await req('/api/attachments?'+query)).status,400,query);
 for(const args of [{query:'x'.repeat(201)},{from:'2026-02-30'},{offset:-1},{fileType:'html'},{limit:201}])assert.equal((await rpc('list_attachments',args)).isError,true);
 assert.equal((await req('/api/attachments?workbench=not-registered')).status,404);
});

test('owner guards, forbidden relationships and foreign workbench access protect every file write',async()=>{
 for(const workbench of ['health','finance','travel',custom]){
  assert.equal((await req('/api/upload?workbench='+workbench,{method:'POST',owner:'old-owner',body:file()})).status,409);
  assert.equal((await req('/api/upload?workbench='+workbench,{method:'POST',body:file({name:'fictional-audio.mp3'})})).status,workbench==='health'?201:400);
  const f=(await req('/api/upload?workbench='+workbench,{method:'POST',body:file({name:'Owner-guard.txt'})})).body;
  for(const method of ['PUT','DELETE'])assert.equal((await req('/api/items/'+f.id+'?workbench='+workbench,{method,owner:'old-owner',body:{title:'Should not save'}})).status,409);
  assert.equal((await req('/api/items/'+f.id+'?workbench='+workbench,{method:'PUT',body:{title:'Edited safely'}})).status,200);
  assert.equal((await req('/api/items/'+f.id+'?workbench='+workbench,{method:'DELETE'})).status,200);
  assert.equal((await req('/api/trash/restore',{method:'POST',owner:'old-owner',body:{id:f.id}})).status,409);
  assert.equal((await req('/api/trash/restore',{method:'POST',body:{id:f.id}})).status,200);
  const wrong=workbench==='health'?'finance':'health';assert.equal((await fetch(base+'/api/files/'+f.id+'?workbench='+wrong,{headers:{Cookie:cookie}})).status,404);
 }
 for(const workbench of ['finance','travel',custom])for(const key of ['visitId','medicationId','imageFileId','fileId','attachmentIds','accountId','assetId'])assert.equal((await req('/api/upload?workbench='+workbench,{method:'POST',body:file({[key]:key==='attachmentIds'?['foreign']:'foreign'})})).status,400,key);
 for(const workbench of ['health','finance',custom])assert.equal((await req('/api/upload?workbench='+workbench,{method:'POST',body:file({tripId})})).status,400);
});

test('custom MCP originals are idempotent while clinical attach tools and dedicated record kinds stay restricted',async()=>{
 const args={workbench:custom,name:'MCP-Fictional.txt',date:'2026-11-01',title:'虚构助手上传',contentBase64:contents.toString('base64'),sha256:sha};
 const a=(await rpc('upload_attachment',args)).structuredContent,b=(await rpc('upload_attachment',args)).structuredContent;assert.equal(a.uploaded.id,b.uploaded.id);assert.equal(b.reused,true);
 assert.equal((await rpc('list_attachments',{workbench:custom,query:'MCP-Fictional'})).structuredContent.total,1);
 assert.equal((await rpc('attach_report_file',{workbench:custom,reportId:'foreign',fileId:a.uploaded.id})).isError,true);
 assert.equal((await rpc('attach_medication_image',{workbench:custom,medicationId:'foreign',fileId:a.uploaded.id})).isError,true);
 assert.equal((await rpc('create_record',{workbench:custom,kind:'travel_trip',title:'not permitted',startDate:'2027-02-01',endDate:'2027-02-03'})).isError,true);
 assert.equal((await rpc('list_attachments',{workbench:custom},otherToken)).isError,true);
});
