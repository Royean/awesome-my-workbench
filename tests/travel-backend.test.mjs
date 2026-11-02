// Real HTTP and MCP, disposable storage and invented travel data only.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';import path from 'node:path';
import {startServer,freePort} from './helpers.mjs';
const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-travel-passphrase-93',email='travel-backend@example.invalid';
let dir,server,base,cookie,token,otherCookie,otherToken,env;const owners=new Map();
const travel=route=>route+(route.includes('?')?'&':'?')+'workbench=travel';
async function req(route,{method='GET',body,who=cookie,owner}={}){const r=await fetch(base+route,{method,headers:{...(who?{Cookie:who}:{}),Origin:base,'Content-Type':'application/json','X-Workbench-Owner':owner??owners.get(who)??''},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),headers:r.headers};}
async function login(e){const r=await req('/api/auth/login',{method:'POST',body:{email:e,password},who:''});assert.equal(r.status,200);const ck=r.headers.get('set-cookie').split(';')[0];owners.set(ck,r.body.user.id);return ck;}
async function mint(who){return (await req('/api/auth/tokens',{method:'POST',body:{name:'travel-test'},who})).body.token;}
async function rpc(name,args={},t=token){const r=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(r.status,200);return (await r.json()).result;}
async function create(kind,b={}){const r=await req(travel('/api/items'),{method:'POST',body:{kind,title:'虚构旅行记录',date:'2027-02-02',...b}});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
const trip=()=>create('travel_trip',{title:'虚构三日旅行',destination:'示例城市',startDate:'2027-02-01',endDate:'2027-02-03'});
const bytes=Buffer.from('fictional travel reservation only'),fileData={name:'fictional-travel.txt',title:'虚构票据',date:'2027-02-02',content:bytes.toString('base64')};
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'travel-backend-'));const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','Fictional travel tester'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);const port=await freePort();env={NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir};server=await startServer({cwd,env});base=server.base;cookie=await login(email);token=await mint(cookie);const invite=await req('/api/auth/invitations',{method:'POST',body:{email:'travel-other@example.invalid',name:'Fictional other'}});assert.equal(invite.status,201);assert.equal((await req('/api/auth/accept-invitation',{method:'POST',body:{token:invite.body.token,password},who:''})).status,200);otherCookie=await login('travel-other@example.invalid');otherToken=await mint(otherCookie);});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});

test('travel built-in backfills existing accounts, retains custom theme/name and stays empty and isolated',async()=>{
 const w=(await req('/api/workbenches')).body.workbenches;assert.equal(w.find(x=>x.id==='travel').themeColor,'#356A98');
 assert.deepEqual((await req(travel('/api/state'))).body.items,[]);
 assert.equal((await req('/api/workbenches/travel',{method:'PATCH',body:{themeColor:'#335577',name:'我的旅行'}})).status,200);
 await server.stop();server=await startServer({cwd,env});base=server.base;
 const state=(await req(travel('/api/state'))).body;assert.equal(state.workbench.themeColor,'#335577');assert.equal(state.workbench.name,'我的旅行');
 assert.equal((await req('/api/workbenches',{who:otherCookie})).body.workbenches.find(x=>x.id==='travel').themeColor,'#356A98');
 assert.equal((await req(travel('/api/state')+'&space=demo')).body.items.length,0);
 const x=await trip();assert.equal(x.date,x.startDate);assert.equal(x.status,'planned');
 assert.equal((await req('/api/state')).body.items.some(i=>i.id===x.id),false);
 assert.equal((await req('/api/state?workbench=finance')).body.items.some(i=>i.id===x.id),false);
});
test('travel records validate calendar, coordinates, status, amounts, links and same-scope parents',async()=>{
 const p=await trip();
 const stop=await create('travel_stop',{tripId:p.id,title:'虚构景点',lat:0,lng:0,time:'09:30'});assert.equal(stop.lat,0);assert.equal(stop.done,false);
 const booking=await create('travel_booking',{tripId:p.id,bookingType:'hotel',endDate:'2027-02-04',price:0,currency:'CNY'});assert.equal(booking.price,0);
 const check=await create('travel_check',{tripId:p.id,category:'packing'});assert.equal(check.done,false);assert.equal((await req(travel('/api/items/'+check.id),{method:'PUT',body:{done:true}})).body.done,true);
 for(const [kind,b] of [
 ['travel_trip',{startDate:'2027-02-30',endDate:'2027-03-02'}],['travel_trip',{startDate:'2027-03-01',endDate:'2027-02-03'}],['travel_trip',{startDate:'2027-01-01',endDate:'2028-01-02'}],
 ['travel_stop',{lat:91,lng:0}],['travel_stop',{lat:1}],['travel_stop',{position:1.5}],['travel_stop',{date:'2027-02-04'}],['travel_stop',{done:'yes'}],['travel_stop',{category:'injected'}],
 ['travel_booking',{price:-1}],['travel_booking',{price:'Infinity'}],['travel_booking',{currency:'bad'}],['travel_booking',{referenceUrl:'javascript:alert(1)'}],['travel_booking',{referenceUrl:'https://user:pass@example.invalid'}],['travel_booking',{endDate:'2027-02-05'}],['travel_booking',{status:'paid automatically'}],
 ['travel_check',{category:'arbitrary'}],['travel_stop',{tripId:'not-found'}]
 ]){const r=await req(travel('/api/items'),{method:'POST',body:{kind,title:'虚构无效',date:'2027-02-02',tripId:p.id,...b}});assert.equal(r.status,400,JSON.stringify({kind,b,result:r.body}));}
 const cross=await req(travel('/api/items'),{method:'POST',who:otherCookie,body:{kind:'travel_stop',tripId:p.id,title:'跨用户',date:'2027-02-02'}});assert.equal(cross.status,400);
 assert.equal((await req(travel('/api/items')+'&space=demo',{method:'POST',body:{kind:'travel_stop',tripId:p.id,title:'跨空间',date:'2027-02-02'}})).status,400);
 assert.equal((await req(travel('/api/items/'+p.id),{method:'PUT',body:{startDate:'2027-02-03'}})).status,400);
 for(const bench of ['health','finance'])assert.equal((await req('/api/items?workbench='+bench,{method:'POST',body:{kind:'travel_trip',title:'错台',startDate:'2027-02-01',endDate:'2027-02-03'}})).status,400);
});
test('pre-departure preparation and post-return tasks retain valid dates without blocking trip rescheduling',async()=>{
 const p=await trip();
 const visa=await create('travel_check',{tripId:p.id,title:'出发前办理签证',date:'2027-01-15',category:'todo'});
 const reimbursement=await create('travel_check',{tripId:p.id,title:'返程后报销',date:'2027-02-15',category:'todo'});
 assert.equal(visa.date,'2027-01-15');assert.equal(reimbursement.date,'2027-02-15');
 const moved=await req(travel('/api/items/'+p.id),{method:'PUT',body:{startDate:'2027-03-01',endDate:'2027-03-03'}});
 assert.equal(moved.status,200,JSON.stringify(moved.body));
 const items=(await req(travel('/api/state'))).body.items;
 assert.equal(items.find(x=>x.id===visa.id).date,'2027-01-15');assert.equal(items.find(x=>x.id===reimbursement.id).date,'2027-02-15');
 const invalid=await req(travel('/api/items'),{method:'POST',body:{kind:'travel_check',tripId:p.id,title:'虚构无效日期',date:'2027-02-30'}});
 assert.equal(invalid.status,400);
 const stop=await req(travel('/api/items'),{method:'POST',body:{kind:'travel_stop',tripId:p.id,title:'仍约束旅行地点',date:'2027-02-15'}});
 assert.equal(stop.status,400);
});
test('travel web owner checks cover records, uploads and restores before writes',async()=>{
 const p=await trip(),badOwner=owners.get(otherCookie);
 for(const [route,method,body] of [[travel('/api/items'),'POST',{kind:'travel_check',tripId:p.id,title:'虚构',date:'2027-02-02'}],[travel('/api/items/'+p.id),'PUT',{title:'不应改动'}],[travel('/api/items/'+p.id),'DELETE',{}],[travel('/api/upload'),'POST',{...fileData,tripId:p.id}]])assert.equal((await req(route,{method,body,owner:badOwner})).status,409);
 await req(travel('/api/items/'+p.id),{method:'DELETE'});
 assert.equal((await req('/api/trash/restore',{method:'POST',body:{id:p.id},owner:badOwner})).status,409);
 assert.equal((await req(travel('/api/restore'),{method:'POST',body:{id:p.id},owner:badOwner})).status,409);
 assert.equal((await req('/api/trash/restore',{method:'POST',who:otherCookie,body:{id:p.id}})).status,404);
 assert.equal((await req('/api/trash/restore',{method:'POST',body:{id:p.id}})).status,200);
});
test('whole trip deletion and restoration is atomic and preserves original file bytes and earlier trash',async()=>{
 const p=await trip(),earlier=await create('travel_stop',{tripId:p.id,title:'已提前单独删除'});await req(travel('/api/items/'+earlier.id),{method:'DELETE'});
 const stop=await create('travel_stop',{tripId:p.id}),booking=await create('travel_booking',{tripId:p.id}),check=await create('travel_check',{tripId:p.id});
 const upload=await req(travel('/api/upload'),{method:'POST',body:{...fileData,tripId:p.id}});assert.equal(upload.status,201);const file=upload.body;
 const del=await req(travel('/api/items/'+p.id),{method:'DELETE'});assert.equal(del.body.deleted.deletedCount,5);
 let all=(await req(travel('/api/state'))).body.items;for(const x of [p,stop,booking,check,file])assert.equal(all.some(i=>i.id===x.id),false);
 const restoreChild=await req('/api/trash/restore',{method:'POST',body:{id:stop.id}});assert.equal(restoreChild.body.code,'parent_deleted');
 const restored=await req('/api/trash/restore',{method:'POST',body:{id:stop.id,withParent:true}});assert.equal(restored.status,200);assert.equal(restored.body.restoredCount,5);
 all=(await req(travel('/api/state'))).body.items;for(const x of [p,stop,booking,check,file])assert.equal(all.some(i=>i.id===x.id),true);assert.equal(all.some(i=>i.id===earlier.id),false);
 const f=await fetch(base+travel('/api/files/'+file.id),{headers:{Cookie:cookie}});assert.equal(await f.text(),bytes.toString());
 await req(travel('/api/items/'+p.id),{method:'DELETE'});assert.equal((await req(travel('/api/restore'),{method:'POST',body:{id:p.id}})).body.restoredCount,5);
});
test('MCP travel CRUD, provenance, external IDs, file hashing and cross-workbench rules agree with web',async()=>{
 const p=(await rpc('create_record',{workbench:'travel',kind:'travel_trip',title:'虚构助手旅行',startDate:'2027-04-01',endDate:'2027-04-03',externalId:'fictional-trip:one'})).structuredContent.created;assert.equal(p.date,'2027-04-01');assert.equal(p.createdVia,'mcp');
 assert.equal((await rpc('create_record',{workbench:'travel',kind:'travel_trip',title:'重复来源',startDate:'2027-04-01',endDate:'2027-04-03',externalId:'fictional-trip:one'})).structuredContent.error.code,'duplicate_external_id');
 assert.equal((await rpc('list_records',{workbench:'travel',kind:'travel_trip',externalId:'fictional-trip:one'})).structuredContent.total,1);
 const stop=(await rpc('create_record',{workbench:'travel',kind:'travel_stop',tripId:p.id,title:'虚构地点',date:'2027-04-02',lat:30,lng:104})).structuredContent.created;assert.equal(stop.tripId,p.id);
 assert.equal((await rpc('create_record',{workbench:'travel',kind:'travel_stop',tripId:p.id,title:'跨用户地点',date:'2027-04-02'},otherToken)).isError,true);
 const original={workbench:'travel',tripId:p.id,name:'fictional-mcp.txt',date:'2027-04-02',contentBase64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};
 const first=(await rpc('upload_attachment',original)).structuredContent;assert.equal(first.uploaded.tripId,p.id);assert.equal((await rpc('upload_attachment',original)).structuredContent.uploaded.id,first.uploaded.id);
 assert.equal((await rpc('list_attachments',{workbench:'travel'})).structuredContent.files.some(f=>f.id===first.uploaded.id),true);
 assert.equal((await rpc('create_record',{workbench:'travel',kind:'metric',title:'不在健康',date:'2027-04-01',type:'weight',value:60})).isError,true);
 assert.equal((await rpc('delete_record',{workbench:'travel',id:p.id})).isError,false);
 assert.equal((await rpc('create_record',{workbench:'travel',kind:'travel_trip',title:'不能重复导已删除',startDate:'2027-04-01',endDate:'2027-04-03',externalId:'fictional-trip:one'})).structuredContent.error.code,'duplicate_external_id');
 assert.equal((await rpc('restore_record',{workbench:'travel',id:p.id})).structuredContent.restored.restoredCount,3);
 const exp=(await req(travel('/api/export'))).body;assert.equal(exp.items.some(x=>x.id===stop.id),true);assert.equal(exp.items.some(x=>x.kind==='metric'),false);
});
