// Disposable authenticated server and fictional asset records; no production data.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';import path from 'node:path';
import {startServer,freePort} from './helpers.mjs';
const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-lifecycle-password-91';
let dir,server,base,cookie,otherCookie,token,otherToken;const owners=new Map();
async function req(route,{method='GET',body,who=cookie,owner}={}){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Origin:base,...(who?{Cookie:who}:{}),'X-Workbench-Owner':owner??owners.get(who)??''},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),headers:r.headers};}
async function login(email){const r=await req('/api/auth/login',{method:'POST',who:'',body:{email,password}});assert.equal(r.status,200);const ck=r.headers.get('set-cookie').split(';')[0];owners.set(ck,r.body.user.id);return ck;}
async function mint(who){return (await req('/api/auth/tokens',{method:'POST',who,body:{name:'fictional lifecycle'}})).body.token;}
async function rpc(name,args={},t=token){const r=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(r.status,200);return (await r.json()).result;}
const fin=p=>p+(p.includes('?')?'&':'?')+'workbench=finance';
const baseRecord={kind:'asset_holding',title:'Fictional renewable asset',date:'2026-10-01',currency:'CNY',category:'server'};
async function create(body={}){const r=await req(fin('/api/items'),{method:'POST',body:{...baseRecord,...body}});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
const raw=id=>{const db=new DatabaseSync(path.join(dir,'health.sqlite'));try{return db.prepare('SELECT body FROM items WHERE id=?').get(id)?.body;}finally{db.close();}};
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'asset-lifecycle-'));const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email','lifecycle@example.invalid','--name','Fictional Lifecycle'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);const port=await freePort();server=await startServer({cwd,env:{NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir}});base=server.base;cookie=await login('lifecycle@example.invalid');token=await mint(cookie);const invite=await req('/api/auth/invitations',{method:'POST',body:{email:'lifecycle-other@example.invalid',name:'Other Fictional'}});assert.equal((await req('/api/auth/accept-invitation',{method:'POST',who:'',body:{token:invite.body.token,password}})).status,200);otherCookie=await login('lifecycle-other@example.invalid');otherToken=await mint(otherCookie);});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});

test('future lifecycle dates and renewal references preserve missing valuation and independent currency',async()=>{
 const h=await create({assetGroup:'fixed',expiresOn:'2030-06-01',renewalOn:'2030-05-01',renewalAmount:0,renewalCurrency:'USD',provider:'Fictional Cloud',identifier:'fictional-instance',renewalMode:'unknown'});
 assert.equal(h.renewalAmount,0);assert.equal(h.renewalCurrency,'USD');assert.equal(h.currency,'CNY');assert.equal(h.value,undefined);assert.equal(h.unitPrice,undefined);assert.equal(h.cost,undefined);assert.equal(h.expiresOn,'2030-06-01');
 const noFee=await create({category:'domain'});assert.equal(noFee.renewalAmount,undefined);assert.equal(noFee.value,undefined);assert.equal(noFee.assetGroup,'fixed');
 const fund=await create({category:'fund',value:12});assert.equal(fund.assetGroup,'financial');assert.equal(fund.value,12);
 assert.equal((await req(fin('/api/items/'+h.id),{method:'PUT',body:{valuationDate:'2099-01-01'}})).status,400);
});

test('calendar, lifecycle enums, references and owner boundaries reject without changing records',async()=>{
 const h=await create({category:'domain',assetGroup:'fixed'}),before=raw(h.id);
 for(const patch of [{expiresOn:'2030-02-30'},{renewalOn:'not-a-date'},{expiresOn:true},{renewalAmount:-1},{renewalAmount:'Infinity'},{renewalAmount:true},{renewalCurrency:'usd'},{renewalCurrency:12},{renewalMode:'charge-now'},{assetGroup:'money'},{provider:'a'.repeat(251)},{identifier:{} }]){const r=await req(fin('/api/items/'+h.id),{method:'PUT',body:patch});assert.equal(r.status,400,JSON.stringify(patch));assert.equal(raw(h.id),before);}
 assert.equal((await req(fin('/api/items/'+h.id),{method:'PUT',body:{expiresOn:'2030-01-01'},who:otherCookie})).status,404);
 assert.equal((await req(fin('/api/items'),{method:'POST',body:baseRecord,who:otherCookie,owner:owners.get(cookie)})).status,409);
 for(const workbench of ['health','travel'])assert.equal((await req('/api/items?workbench='+workbench,{method:'POST',body:baseRecord})).status,400);
});

test('legacy imported source is read-only, date meanings stay distinct and malformed source is ignored',async()=>{
 const original={id:'SRV-QA100',name:'Fictional server',provider:'Fictional provider',renewal_on:'2032-04-05',currency:'USD',renewal_price:20,auto_renew:null,secret:'FICTIONAL SOURCE ONLY'};
 const note=JSON.stringify({'原始固定资产':original},null,2).replaceAll('\n','\\n');
 const h=await create({category:'equipment',externalId:'github:fixed:SRV-QA100',note});const before=raw(h.id);
 assert.equal(h.category,'server');assert.equal(h.renewalOn,'2032-04-05');assert.equal(h.expiresOn,undefined);assert.equal(h.provider,'Fictional provider');assert.equal(h.renewalMode,'unknown');assert.equal(h.renewalAmount,20);assert.equal(h.value,undefined);assert.equal(h.secret,undefined);
 const state=(await req(fin('/api/state'))).body.items.find(x=>x.id===h.id);assert.equal(state.renewalOn,h.renewalOn);
 const listed=(await rpc('list_records',{workbench:'finance',kind:'asset_holding',externalId:h.externalId})).structuredContent.records[0];assert.equal(listed.renewalOn,h.renewalOn);assert.equal(listed.assetGroup,'fixed');assert.equal(listed.note,note);assert.equal(listed.secret,undefined);
 assert.equal(raw(h.id),before);const stored=JSON.parse(before);assert.equal(stored.renewalOn,undefined);assert.equal(stored.assetGroup,undefined);assert.equal(stored.category,'equipment');
 const bad=await create({category:'equipment',externalId:'github:fixed:SRV-QA101',note});assert.equal(bad.renewalOn,undefined);assert.equal(bad.provider,undefined);
 const malformed=await create({category:'subscription',externalId:'github:fixed:DOM-QA101',note:'{broken'});assert.equal(malformed.expiresOn,undefined);
 const wrongDate=await create({category:'subscription',externalId:'github:fixed:DOM-QA102',note:JSON.stringify({'原始固定资产':{id:'DOM-QA102',name:'fictional.example',expires_on:'2030-02-30',renewal_price:null}})});assert.equal(wrongDate.expiresOn,undefined);assert.equal(wrongDate.renewalAmount,undefined);
});

test('explicit clears survive HTTP and MCP reads without resurrecting legacy fields or altering raw source',async()=>{
 const source={id:'DOM-QA200',name:'fictional.example',registrar:'Fictional registrar',expires_on:'2033-03-04',renewal_on:'2033-02-04',renewal_price:42,currency:'USD',auto_renew:true};
 const note=JSON.stringify({'原始固定资产':source});const h=await create({category:'subscription',externalId:'github:fixed:DOM-QA200',note});
 const clear={expiresOn:'',renewalOn:'',renewalAmount:null,renewalCurrency:'',provider:'',identifier:'',renewalMode:'unknown'};
 const changed=await req(fin('/api/items/'+h.id),{method:'PUT',body:clear});assert.equal(changed.status,200);for(const [k,v] of Object.entries(clear))assert.equal(changed.body[k],v);
 const byMcp=await rpc('update_record',{workbench:'finance',id:h.id,...clear});assert.equal(byMcp.isError,false,JSON.stringify(byMcp));for(const [k,v] of Object.entries(clear))assert.equal(byMcp.structuredContent.updated[k],v);
 assert.equal(JSON.parse(raw(h.id)).note,note);for(const [k,v] of Object.entries(clear))assert.equal(JSON.parse(raw(h.id))[k],v);
 const listed=(await rpc('list_records',{workbench:'finance',kind:'asset_holding',externalId:h.externalId})).structuredContent.records[0];for(const [k,v] of Object.entries(clear))assert.equal(listed[k],v);
 assert.equal((await rpc('update_record',{workbench:'finance',id:h.id,renewalAmount:true})).isError,true);
 assert.equal((await rpc('update_record',{workbench:'finance',id:h.id,renewalAmount:-1})).isError,true);
 assert.equal((await rpc('update_record',{workbench:'finance',id:h.id,expiresOn:'2030-02-30'})).isError,true);
 assert.equal((await rpc('update_record',{workbench:'finance',id:h.id,renewalOn:'2035-01-01'},otherToken)).isError,true);
});
