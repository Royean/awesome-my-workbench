// Remote MCP endpoint: real server process, throwaway DB, fictional local accounts only.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startServer,freePort} from './helpers.mjs';
const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-only-passphrase-93',email='mcp-admin@example.invalid';
let dir,server,base,cookieA,tokenA,tokenB,appToken;
async function req(route,{method='GET',body,headers={},raw}={}){const r=await fetch(base+route,{method,headers:{...(body!==undefined||raw!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:raw??(body===undefined?undefined:JSON.stringify(body))});const text=await r.text();return {status:r.status,headers:r.headers,text,body:text?JSON.parse(text):undefined};}
const web=c=>({Cookie:c,Origin:base});
const login=async(e,p)=>{const r=await req('/api/auth/login',{method:'POST',body:{email:e,password:p},headers:{Origin:base}});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
const mint=async c=>{const r=await req('/api/auth/tokens',{method:'POST',body:{name:'mcp'},headers:web(c)});assert.equal(r.status,201);return r.body.token;};
let nextId=1;
const rpc=(token,method,params,extra={})=>req('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:nextId++,method,...(params!==undefined?{params}:{})},headers:{Authorization:`Bearer ${token}`,Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18',...extra}});
const call=async(token,name,args={})=>{const r=await rpc(token,'tools/call',{name,arguments:args});assert.equal(r.status,200,r.text);assert.ok(r.body.result,r.text);return r.body.result;};
const ok=async(token,name,args)=>{const r=await call(token,name,args);assert.equal(r.isError,false,r.content?.[0]?.text);assert.deepEqual(JSON.parse(r.content[0].text),r.structuredContent);return r.structuredContent;};
const err=async(token,name,args)=>{const r=await call(token,name,args);assert.equal(r.isError,true);return r.content[0].text;};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());

before(async()=>{
 dir=await mkdtemp(path.join(os.tmpdir(),'workbench-mcp-'));
 const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','Fictional MCP admin'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);
 const port=await freePort();server=await startServer({cwd,env:{NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir}});base=server.base;
 cookieA=await login(email,password);tokenA=await mint(cookieA);
 const inv=await req('/api/auth/invitations',{method:'POST',body:{email:'mcp-b@example.invalid',name:'B'},headers:web(cookieA)});assert.equal(inv.status,201);
 const acc=await req('/api/auth/accept-invitation',{method:'POST',body:{token:inv.body.token,password:'Fictional-only-passphrase-94'},headers:{Origin:base}});assert.equal(acc.status,200);
 tokenB=await mint(await login('mcp-b@example.invalid','Fictional-only-passphrase-94'));
 appToken=(await req('/api/auth/app-login',{method:'POST',body:{email,password}})).body.token;
});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});

test('initialize handshake, initialized notification, ping, version negotiation',async()=>{
 const r=await rpc(tokenA,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}});
 assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/application\/json/);
 assert.equal(r.body.result.protocolVersion,'2025-06-18');assert.ok(r.body.result.capabilities.tools);assert.equal(r.body.result.serverInfo.name,'zhiheng');
 assert.equal((await rpc(tokenA,'initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'t',version:'1'}})).body.result.protocolVersion,'2025-03-26');
 assert.equal((await rpc(tokenA,'initialize',{protocolVersion:'1999-01-01',capabilities:{},clientInfo:{name:'t',version:'1'}})).body.result.protocolVersion,'2025-06-18');
 const n=await req('/mcp',{method:'POST',body:{jsonrpc:'2.0',method:'notifications/initialized'},headers:{Authorization:`Bearer ${tokenA}`}});assert.equal(n.status,202);assert.equal(n.text,'');
 assert.deepEqual((await rpc(tokenA,'ping')).body.result,{});
 assert.equal((await rpc(tokenA,'nope/method')).body.error.code,-32601);
 assert.equal((await req('/mcp',{method:'POST',raw:'{bad',headers:{Authorization:`Bearer ${tokenA}`}})).body.error.code,-32700);
 assert.equal((await req('/mcp',{method:'POST',body:[{jsonrpc:'2.0',id:1,method:'ping'}],headers:{Authorization:`Bearer ${tokenA}`}})).body.error.code,-32600);
 assert.equal((await rpc(tokenA,'ping',undefined,{'MCP-Protocol-Version':'1999-01-01'})).status,400);
 // App-login session tokens are accepted too.
 assert.deepEqual((await rpc(appToken,'ping')).body.result,{});
});
test('GET /mcp is 405; auth: missing/invalid token 401 with WWW-Authenticate; cookie-only rejected',async()=>{
 const g=await req('/mcp',{headers:{Authorization:`Bearer ${tokenA}`}});assert.equal(g.status,405);assert.equal(g.headers.get('allow'),'POST');
 const none=await req('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'ping'}});assert.equal(none.status,401);assert.match(none.headers.get('www-authenticate'),/^Bearer/);
 const bad=await rpc('zh_pat_'+'A'.repeat(43),'ping');assert.equal(bad.status,401);assert.match(bad.headers.get('www-authenticate'),/^Bearer/);
 const cookieOnly=await req('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'ping'},headers:web(cookieA)});assert.equal(cookieOnly.status,401);
 const both=await req('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'ping'},headers:{...web(cookieA),Authorization:`Bearer ${tokenA}`}});assert.equal(both.status,401);
 // Host check still applies.
 const {request}=await import('node:http');const port=new URL(base).port;
 const status=await new Promise((res,rej)=>{const r=request({host:'127.0.0.1',port,path:'/mcp',method:'POST',headers:{Host:'evil.invalid','Content-Type':'application/json',Authorization:`Bearer ${tokenA}`}},x=>{x.resume();res(x.statusCode)});r.on('error',rej);r.end('{"jsonrpc":"2.0","id":1,"method":"ping"}');});assert.equal(status,403);
 // Revoked token stops working.
 const t=await mint(cookieA);const list=(await req('/api/auth/tokens',{headers:{Cookie:cookieA}})).body.tokens;assert.equal((await req('/api/auth/tokens/'+list[0].id,{method:'DELETE',body:{},headers:web(cookieA)})).status,200);assert.equal((await rpc(t,'ping')).status,401);
});
test('tools/list publishes exactly the v1 tools with strict schemas (no delete)',async()=>{
 const {tools}=(await rpc(tokenA,'tools/list')).body.result;
 assert.deepEqual(tools.map(t=>t.name).sort(),['create_record','get_today','list_records','list_workbenches','update_record']);
 for(const t of tools){assert.equal(t.inputSchema.type,'object');assert.equal(t.inputSchema.additionalProperties,false);assert.match(t.description,/[\u4e00-\u9fa5]/);}
 const create=tools.find(t=>t.name==='create_record');assert.deepEqual(create.inputSchema.properties.kind.enum,['meal','exercise','metric','water','note','task']);assert.deepEqual(create.inputSchema.required,['kind']);
 assert.equal(create.inputSchema.properties.attachmentIds,undefined);
});
test('list_workbenches and get_today',async()=>{
 const w=await ok(tokenA,'list_workbenches');assert.deepEqual(w.workbenches.map(x=>x.id),['health','finance']);assert.deepEqual(w.workbenches[1].writableKinds,['note','task']);assert.equal(w.today,today());
 await ok(tokenA,'create_record',{kind:'water',volume:500});await ok(tokenA,'create_record',{kind:'water',volume:250,time:'09:00'});
 const t=await ok(tokenA,'get_today',{});assert.equal(t.date,today());assert.deepEqual(t.summary.water,{totalMl:750,goalMl:2000});assert.ok(t.records.every(r=>r.date===today()));
 const f=await ok(tokenA,'get_today',{workbench:'finance'});assert.equal(f.workbench.type,'finance');
 assert.match(await err(tokenA,'get_today',{workbench:'nope'}),/工作台不存在/);
});
test('create_record for every allowed kind, list_records filters/sorts, update_record',async()=>{
 const meal=(await ok(tokenA,'create_record',{kind:'meal',title:'燕麦粥',mealType:'早餐',date:'2026-10-01',time:'08:00',portion:'一碗'})).created;assert.equal(meal.kind,'meal');assert.ok(meal.id);
 await ok(tokenA,'create_record',{kind:'exercise',title:'慢跑',type:'跑步',duration:30,distance:5,feeling:'适中',date:'2026-10-02',time:'07:00'});
 const m=(await ok(tokenA,'create_record',{kind:'metric',title:'血压',type:'pressure',value:120,secondary:80,date:'2026-10-03'})).created;assert.equal(m.unit,'mmHg');
 await ok(tokenA,'create_record',{kind:'note',title:'问医生睡眠问题',date:'2026-10-03'});
 const task=(await ok(tokenA,'create_record',{kind:'task',title:'预约复查',date:'2026-10-04',done:false})).created;
 const range=await ok(tokenA,'list_records',{from:'2026-10-01',to:'2026-10-03'});assert.deepEqual(range.records.map(r=>r.date),['2026-10-03','2026-10-03','2026-10-02','2026-10-01']);
 assert.deepEqual((await ok(tokenA,'list_records',{kind:'meal'})).records.map(r=>r.title),['燕麦粥']);
 assert.equal((await ok(tokenA,'list_records',{limit:2})).records.length,2);
 assert.match(await err(tokenA,'list_records',{limit:500}),/超出范围/);assert.match(await err(tokenA,'list_records',{from:'2026-02-30'}),/有效日期/);
 const u=(await ok(tokenA,'update_record',{id:task.id,done:true})).updated;assert.equal(u.done,true);assert.equal(u.title,'预约复查');
 assert.equal((await ok(tokenA,'update_record',{id:meal.id,portion:'半碗'})).updated.portion,'半碗');
 // Same data is visible on the web API.
 const state=await req('/api/state',{headers:{Cookie:cookieA}});assert.equal(state.body.items.find(x=>x.id===task.id).done,true);
 // Notes/tasks can be written to the finance workbench.
 const fn=(await ok(tokenA,'create_record',{workbench:'finance',kind:'note',title:'月度预算',date:'2026-10-05'})).created;assert.equal(fn.kind,'note');
});
test('validation errors come back as isError tool results with the web validator messages',async()=>{
 assert.match(await err(tokenA,'create_record',{kind:'water',volume:9000}),/超出范围|饮水量/);
 assert.match(await err(tokenA,'create_record',{kind:'exercise',title:'跑'}),/运动时长/);
 assert.match(await err(tokenA,'create_record',{kind:'metric',title:'x',type:'pressure',value:120,secondary:130}),/舒张压/);
 assert.match(await err(tokenA,'create_record',{kind:'meal',title:'x',date:'2026-13-01'}),/格式无效|日期/);
 assert.match(await err(tokenA,'create_record',{kind:'meal',title:'x',volume:3}),/不支持字段 volume/);
 assert.match(await err(tokenA,'create_record',{kind:'meal',title:'x',attachmentIds:['a']}),/不支持的字段/);
 assert.match(await err(tokenA,'update_record',{id:'missing'}),/记录不存在/);
});
test('disallowed kinds rejected; finance workbench refuses health records; medical items cannot be updated',async()=>{
 for(const kind of ['medication','dose','file','visit','report'])assert.match(await err(tokenA,'create_record',{kind,title:'x'}),/取值无效/);
 assert.match(await err(tokenA,'create_record',{workbench:'finance',kind:'water',volume:200}),/不支持饮水记录/);
 assert.match(await err(tokenA,'create_record',{workbench:'finance',kind:'meal',title:'午饭'}),/只能写入备忘与待办/);
 const visit=await req('/api/items',{method:'POST',body:{kind:'visit',title:'体检',date:'2026-10-01',status:'已完成'},headers:web(cookieA)});assert.equal(visit.status,201);
 assert.match(await err(tokenA,'update_record',{id:visit.body.id,title:'x'}),/不支持通过 MCP 修改/);
 assert.equal((await ok(tokenA,'list_records',{})).records.some(r=>r.kind==='visit'),false);
});
test('cross-account isolation: account B cannot see or update A records',async()=>{
 const a=(await ok(tokenA,'create_record',{kind:'note',title:'A 的私密备忘',date:'2026-10-06'})).created;
 const b=await ok(tokenB,'list_records',{});assert.equal(b.records.some(r=>r.id===a.id||r.title.includes('A 的')),false);
 assert.equal((await ok(tokenB,'get_today',{})).records.length,0);
 assert.match(await err(tokenB,'update_record',{id:a.id,title:'hijack'}),/记录不存在/);
 const still=(await ok(tokenA,'list_records',{kind:'note'})).records.find(r=>r.id===a.id);assert.equal(still.title,'A 的私密备忘');
});
