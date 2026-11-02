import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';import path from 'node:path';
import {startServer,freePort} from './helpers.mjs';
const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-reading-passphrase-93',email='reading-backend@example.invalid';
let dir,server,base,cookie,token,otherCookie,env;const owners=new Map();
const reading=route=>route+(route.includes('?')?'&':'?')+'workbench=reading';
async function req(route,{method='GET',body,who=cookie,owner}={}){const r=await fetch(base+route,{method,headers:{...(who?{Cookie:who}:{}),Origin:base,'Content-Type':'application/json','X-Workbench-Owner':owner??owners.get(who)??''},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),headers:r.headers};}
async function login(email){const r=await req('/api/auth/login',{method:'POST',body:{email,password},who:''});assert.equal(r.status,200);const ck=r.headers.get('set-cookie').split(';')[0];owners.set(ck,r.body.user.id);return ck;}
async function rpc(name,args={}){const r=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(r.status,200);return (await r.json()).result;}
async function create(kind,b={}){const r=await req(reading('/api/items'),{method:'POST',body:{kind,title:'虚构阅读记录',date:'2026-11-01',...b}});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
const book=()=>create('reading_book',{title:'虚构的阅读之旅',author:'示例作者',totalPages:200,currentPage:20,status:'reading'});
const bytes=Buffer.from('fictional reading document'),fileData={name:'fictional-reading.txt',title:'虚构读书资料',date:'2026-11-01',content:bytes.toString('base64')};
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'reading-backend-'));const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','Fictional reading tester'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);
 // Simulate an account created before reading existed; boot must backfill without losing custom workbenches.
 const db=new DatabaseSync(path.join(dir,'health.sqlite'));db.prepare("DELETE FROM data_scopes WHERE workbench_id='reading'").run();db.prepare("DELETE FROM user_workbenches WHERE id='reading'").run();db.close();
 const port=await freePort();env={NODE_ENV:'test',ZH_TEST_NOW:'2026-11-02T04:00:00Z',AUTH_REQUIRED:'1',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir};server=await startServer({cwd,env});base=server.base;cookie=await login(email);token=(await req('/api/auth/tokens',{method:'POST',body:{name:'reading-test'}})).body.token;
 const invite=await req('/api/auth/invitations',{method:'POST',body:{email:'reading-other@example.invalid',name:'Fictional other'}});assert.equal(invite.status,201);assert.equal((await req('/api/auth/accept-invitation',{method:'POST',body:{token:invite.body.token,password},who:''})).status,200);otherCookie=await login('reading-other@example.invalid');});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});

test('reading backfills old accounts, exists for new accounts and persists records and custom theme through restart',async()=>{
 assert.equal((await req('/api/workbenches')).body.workbenches.find(x=>x.id==='reading').themeColor,'#74634F');
 assert.equal((await req('/api/workbenches',{who:otherCookie})).body.workbenches.find(x=>x.id==='reading').type,'reading');
 assert.deepEqual((await req(reading('/api/state'))).body.items,[]);
 const p=await book();assert.equal((await req('/api/workbenches/reading',{method:'PATCH',body:{themeColor:'#334477',name:'书房'}})).status,200);
 await server.stop();server=await startServer({cwd,env});base=server.base;
 const state=(await req(reading('/api/state'))).body;assert.equal(state.workbench.themeColor,'#334477');assert.equal(state.workbench.name,'书房');assert.equal(state.items.find(x=>x.id===p.id).currentPage,20);
 for(const route of ['/api/state','/api/state?workbench=finance','/api/state?workbench=travel',reading('/api/state')+'&space=demo'])assert.equal((await req(route)).body.items.some(x=>x.id===p.id),false);
 assert.equal((await req(reading('/api/state'),{who:otherCookie})).body.items.some(x=>x.id===p.id),false);
});
test('reading validates progress, dates, excerpts and same-scope book references without coercing unknown pages to zero',async()=>{
 const p=await book();const unknown=await create('reading_book');assert.equal(unknown.currentPage,undefined);assert.equal(unknown.totalPages,undefined);
 const entry=await create('reading_entry',{bookId:p.id,entryType:'session',page:30,minutes:15});assert.equal(entry.minutes,15);
 const excerpt=await create('reading_entry',{bookId:p.id,entryType:'excerpt',quote:'虚构摘录',page:0});assert.equal(excerpt.page,0);
 for(const b of [{totalPages:0},{currentPage:-1},{currentPage:201},{currentPage:true},{totalPages:2.5},{status:'invalid'},{date:'2026-02-30'}])assert.equal((await req(reading('/api/items/'+p.id),{method:'PUT',body:b})).status,400,JSON.stringify(b));
 for(const b of [{page:201},{page:-1},{page:true},{minutes:0},{minutes:1441},{minutes:2.5},{bookId:'not-found'},{entryType:'invalid'},{entryType:'excerpt'},{date:'2026-11-03'}])assert.equal((await req(reading('/api/items'),{method:'POST',body:{kind:'reading_entry',title:'无效示例',date:'2026-11-01',bookId:p.id,...b}})).status,400,JSON.stringify(b));
 assert.equal((await req(reading('/api/items/'+p.id),{method:'PUT',body:{totalPages:25}})).status,400);
 assert.equal((await req(reading('/api/items/'+p.id),{method:'PUT',body:{currentPage:null,totalPages:null}})).status,200);
 const cleared=(await req(reading('/api/state'))).body.items.find(x=>x.id===p.id);assert.equal(cleared.currentPage,undefined);assert.equal(cleared.totalPages,undefined);
 for(const options of [{who:otherCookie},{}]){const route=options.who?reading('/api/items'):reading('/api/items')+'&space=demo';assert.equal((await req(route,{...options,method:'POST',body:{kind:'reading_entry',title:'跨空间',date:'2026-11-01',bookId:p.id}})).status,400);}
 for(const wb of ['health','finance','travel'])assert.equal((await req('/api/items?workbench='+wb,{method:'POST',body:{kind:'reading_book',title:'错台',date:'2026-11-01'}})).status,400);
 assert.equal((await req(reading('/api/items'),{method:'POST',body:{kind:'metric',title:'错台',date:'2026-11-01',type:'weight',value:60}})).status,400);
});
test('book attachments filter and download by scope, preserve linkage and reject foreign parents before writing',async()=>{
 const p=await book(),other=await book();
 const upload=await req(reading('/api/upload'),{method:'POST',body:{...fileData,bookId:p.id}});assert.equal(upload.status,201);const f=upload.body;assert.equal(f.bookId,p.id);
 assert.equal((await req(reading('/api/attachments')+'&bookId='+p.id)).body.files.some(x=>x.id===f.id),true);
 assert.equal((await req(reading('/api/attachments')+'&bookId='+other.id)).body.files.some(x=>x.id===f.id),false);
 assert.equal((await req(reading('/api/attachments')+'&bookId=unassigned')).body.files.some(x=>x.id===f.id),false);
 for(const route of ['/api/upload',reading('/api/upload')+'&space=demo'])assert.equal((await req(route,{method:'POST',body:{...fileData,bookId:p.id}})).status,400);
 assert.equal((await req(reading('/api/upload'),{method:'POST',who:otherCookie,body:{...fileData,bookId:p.id}})).status,400);
 const download=await fetch(base+reading('/api/files/'+f.id),{headers:{Cookie:cookie}});assert.equal(download.status,200);assert.equal(await download.text(),bytes.toString());
 assert.equal((await req('/api/files/'+f.id)).status,404);
 assert.equal((await req(reading('/api/items/'+p.id),{method:'DELETE'})).status,400);
 assert.equal((await req(reading('/api/items/'+f.id),{method:'PUT',body:{bookId:''}})).status,200);
 assert.equal((await req(reading('/api/items/'+p.id),{method:'DELETE'})).status,200);
});
test('reading owner checks prevent stale-session writes, and deletion/restoration preserve book dependencies',async()=>{
 const p=await book(),e=await create('reading_entry',{bookId:p.id,page:100});const owner=owners.get(otherCookie);
 for(const [route,method,body] of [[reading('/api/items'),'POST',{kind:'reading_book',title:'不可保存',date:'2026-11-01'}],[reading('/api/items/'+p.id),'PUT',{title:'不可修改'}],[reading('/api/items/'+p.id),'DELETE',{}],[reading('/api/upload'),'POST',{...fileData,bookId:p.id}],[reading('/api/settings'),'PUT',{name:'不可修改'}]])assert.equal((await req(route,{method,body,owner})).status,409);
 assert.equal((await req(reading('/api/items/'+p.id),{method:'DELETE'})).status,400);
 assert.equal((await req(reading('/api/items/'+e.id),{method:'DELETE'})).status,200);
 assert.equal((await req(reading('/api/items/'+p.id),{method:'DELETE'})).status,200);
 assert.equal((await req('/api/trash/restore',{method:'POST',body:{id:e.id}})).body.code,'parent_deleted');
 assert.equal((await req('/api/trash/restore',{method:'POST',body:{id:e.id,withParent:true},owner})).status,409);
 assert.equal((await req('/api/trash/restore',{method:'POST',body:{id:e.id,withParent:true}})).status,200);
 await req(reading('/api/items/'+e.id),{method:'DELETE'});await req(reading('/api/items/'+p.id),{method:'PUT',body:{currentPage:10,totalPages:50}});
 assert.equal((await req('/api/trash/restore',{method:'POST',body:{id:e.id}})).status,400);
 assert.equal((await req(reading('/api/restore'),{method:'POST',body:{id:e.id}})).status,400);
});
test('reading MCP CRUD and originals use the same validation, scopes and provenance as HTTP',async()=>{
 const list=await rpc('list_workbenches');assert.equal(list.isError,false);assert.ok(list.structuredContent.workbenches.find(x=>x.id==='reading').writableKinds.includes('reading_book'));
 const created=await rpc('create_record',{workbench:'reading',kind:'reading_book',title:'MCP虚构书籍',totalPages:100,date:'2026-11-01'});assert.equal(created.isError,false,JSON.stringify(created));const p=created.structuredContent.created;
 assert.equal(p.createdVia,'mcp');
 const e=await rpc('create_record',{workbench:'reading',kind:'reading_entry',bookId:p.id,title:'虚构摘录',entryType:'excerpt',quote:'一段示例原文',page:20,date:'2026-11-01'});assert.equal(e.isError,false,JSON.stringify(e));
 assert.equal((await rpc('create_record',{kind:'reading_book',title:'错台'})).isError,true);
 assert.equal((await rpc('update_record',{workbench:'reading',id:p.id,currentPage:101})).isError,true);
 const cleared=await rpc('update_record',{workbench:'reading',id:p.id,currentPage:null});assert.equal(cleared.isError,false);assert.equal(cleared.structuredContent.updated.currentPage,undefined);
 const payload={workbench:'reading',bookId:p.id,name:fileData.name,title:fileData.title,date:fileData.date,contentBase64:fileData.content,sha256:createHash('sha256').update(bytes).digest('hex')};
 const uploaded=await rpc('upload_attachment',payload);assert.equal(uploaded.isError,false,JSON.stringify(uploaded));assert.equal(uploaded.structuredContent.uploaded.bookId,p.id);
 assert.equal((await rpc('upload_attachment',payload)).structuredContent.reused,true);
 const files=await rpc('list_attachments',{workbench:'reading',bookId:p.id});assert.equal(files.structuredContent.files.length,1);
 assert.equal((await rpc('delete_record',{workbench:'reading',id:p.id})).isError,true);
 assert.equal((await rpc('delete_record',{workbench:'reading',id:e.structuredContent.created.id})).isError,false);
 assert.equal((await rpc('restore_record',{workbench:'reading',id:e.structuredContent.created.id})).isError,false);
});
