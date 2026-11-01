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
 const create=tools.find(t=>t.name==='create_record');assert.deepEqual(create.inputSchema.properties.kind.enum,['meal','exercise','metric','water','visit','report','medication','dose','note','task']);assert.deepEqual(create.inputSchema.required,['kind']);
 assert.equal(create.inputSchema.properties.attachmentIds,undefined);
});
test('list_workbenches and get_today',async()=>{
 const w=await ok(tokenA,'list_workbenches');assert.deepEqual(w.workbenches.map(x=>x.id),['health','finance']);assert.deepEqual(w.workbenches[1].writableKinds,['note','task']);assert.equal(w.today,today());
 await ok(tokenA,'create_record',{kind:'water',volume:500});await ok(tokenA,'create_record',{kind:'water',volume:250,time:'09:00'});
 const t=await ok(tokenA,'get_today',{});assert.equal(t.date,today());assert.deepEqual(t.summary.water,{totalMl:750,goalMl:2000});assert.ok(t.records.every(r=>r.date===today()));
 const f=await ok(tokenA,'get_today',{workbench:'finance'});assert.equal(f.workbench.type,'finance');
 assert.equal(await err(tokenA,'get_today',{workbench:'nope'}),'没有找到这个工作台，请从你的工作台里选一个');
 {const e=await errc(tokenA,'get_today',{workbench:'nope'});assert.equal(e.code,'not_found');assert.equal(e.hint,'用 list_workbenches 获取可用工作台');assert.doesNotMatch(e.message,/list_workbenches/);}
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
 assert.match(await err(tokenA,'list_records',{limit:500}),/条数需在 1–200 之间/);assert.match(await err(tokenA,'list_records',{from:'2026-02-30'}),/起始日期格式不对/);
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
 assert.match(await err(tokenA,'create_record',{kind:'meal',title:'x',volume:3}),/餐食记录不支持「饮水量」/);
 assert.match(await err(tokenA,'create_record',{kind:'meal',title:'x',attachmentIds:['a']}),/^助手不能添加或更换附件，请到网页操作$/);
 assert.match(await err(tokenA,'update_record',{id:'missing'}),/没有找到这条记录/);
});
test('disallowed kinds rejected; finance workbench refuses health records; file/favorite stay out of MCP',async()=>{
 for(const kind of ['file','favorite'])assert.match(await err(tokenA,'create_record',{kind,title:'x'}),/记录类型只能是/);
 for(const kind of ['visit','medication','dose','report'])assert.match(await err(tokenA,'create_record',{workbench:'finance',kind,title:'x'}),/只能记备忘和待办/);
 assert.match(await err(tokenA,'create_record',{workbench:'finance',kind:'water',volume:200}),/^「金融」工作台只能记备忘和待办，饮水请记到「健康」工作台$/);
 assert.match(await err(tokenA,'create_record',{workbench:'finance',kind:'meal',title:'午饭'}),/只能记备忘和待办/);
 const fav=await req('/api/items',{method:'POST',body:{kind:'favorite',title:'常吃',date:'2026-10-01',targetKind:'meal',template:{title:'燕麦'}},headers:web(cookieA)});assert.equal(fav.status,201);
 assert.match(await err(tokenA,'update_record',{id:fav.body.id,title:'x'}),/不支持在助手里修改/);
 assert.equal((await ok(tokenA,'list_records',{})).records.some(r=>r.kind==='favorite'||r.kind==='file'),false);
 assert.equal((await ok(tokenA,'get_today',{})).records.some(r=>r.kind==='favorite'||r.kind==='file'),false);
 for(const k of ['favorite','file'])assert.ok(!(await rpc(tokenA,'tools/list')).body.result.tools.find(t=>t.name==='create_record').inputSchema.properties.kind.enum.includes(k));
});
const shift=n=>{const d=new Date(today()+'T12:00:00+08:00');d.setDate(d.getDate()+n);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(d);};
const noStorage=o=>{const t=JSON.stringify(o);assert.doesNotMatch(t,/storageName|fileId|attachmentIds|uploads|base64|ZmFrZQ/,t);};
test('visit/report/medication/dose: read, create, update via MCP with full text fields',async()=>{
 const v=(await ok(tokenA,'create_record',{kind:'visit',title:'内科复诊',date:shift(-2),hospital:'示例医院',department:'内科',doctor:'王医生',reason:'咳嗽',assessment:'上呼吸道感染',instructions:'多喝水'})).created;
 assert.equal(v.status,'已完成');assert.equal(v.doctor,'王医生');assert.equal(v.createdVia,'mcp');
 const vu=(await ok(tokenA,'update_record',{id:v.id,instructions:'多喝水，一周后复查',status:'待复查'})).updated;assert.equal(vu.instructions,'多喝水，一周后复查');assert.equal(vu.status,'待复查');
 const r=(await ok(tokenA,'create_record',{kind:'report',title:'血常规',date:shift(-2),visitId:v.id,type:'检验报告',content:'白细胞 6.1'})).created;
 assert.equal(r.content,'白细胞 6.1');assert.equal(r.status,'待补充');
 assert.equal((await ok(tokenA,'update_record',{id:r.id,content:'白细胞 6.2 ×10^9/L',status:'已归档'})).updated.content,'白细胞 6.2 ×10^9/L');
 const m=(await ok(tokenA,'create_record',{kind:'medication',title:'示例药 A',date:shift(-1),endDate:shift(10),visitId:v.id,dosage:'1 片',route:'口服',frequency:'每日两次',times:['20:00','08:00'],prescriber:'王医生'})).created;
 assert.deepEqual(m.times,['08:00','20:00']);assert.equal(m.status,'进行中');assert.equal(m.dosage,'1 片');
 assert.equal((await ok(tokenA,'update_record',{id:m.id,dosage:'半片'})).updated.dosage,'半片');
 const d=(await ok(tokenA,'create_record',{kind:'dose',medicationId:m.id,date:today(),time:'08:05',scheduledTime:'08:00'})).created;
 assert.equal(d.outcome,'已服用');assert.equal(d.title,'示例药 A');assert.equal(d.medicationId,m.id);
 const du=(await ok(tokenA,'update_record',{id:d.id,time:'08:20',note:'饭后'})).updated;assert.equal(du.time,'08:20');assert.equal(du.outcome,'已服用');
 assert.match(await err(tokenA,'update_record',{id:d.id,date:shift(-1)}),/只能改服用结果、时间和备注/);
 assert.equal((await errc(tokenA,'update_record',{id:d.id,outcome:'跳过',note:''})).message,'请填写跳过原因');
 const ds=(await ok(tokenA,'update_record',{id:d.id,outcome:'跳过',note:'胃不舒服'})).updated;assert.equal(ds.outcome,'跳过');assert.equal(ds.time,'');
 assert.equal((await errc(tokenA,'update_record',{id:d.id,outcome:'已服用'})).message,'请记录实际服用时间');
 assert.equal((await ok(tokenA,'update_record',{id:d.id,outcome:'已服用',time:'09:00'})).updated.time,'09:00');
 const list=await ok(tokenA,'list_records',{kind:'all'});for(const id of [v.id,r.id,m.id,d.id])assert.ok(list.records.some(x=>x.id===id),id);
 const lm=(await ok(tokenA,'list_records',{kind:'medication'})).records.find(x=>x.id===m.id);for(const k of ['dosage','route','frequency','times','status','endDate','prescriber'])assert.ok(k in lm,k);
 const ld=(await ok(tokenA,'list_records',{kind:'dose'})).records.find(x=>x.id===d.id);for(const k of ['outcome','time','scheduledTime','medicationId'])assert.ok(k in ld,k);
 const lv=(await ok(tokenA,'list_records',{kind:'visit'})).records.find(x=>x.id===v.id);for(const k of ['doctor','reason','assessment','instructions'])assert.ok(k in lv,k);
});
test('dose: 跳过 needs a reason, future rejected, medication missing',async()=>{
 const v=(await ok(tokenA,'create_record',{kind:'visit',title:'看诊',date:shift(-1)})).created;
 const m=(await ok(tokenA,'create_record',{kind:'medication',title:'示例药 B',date:shift(-1),visitId:v.id,dosage:'1 粒',route:'口服',frequency:'按需',scheduleMode:'asNeeded'})).created;
 const noReason=await errc(tokenA,'create_record',{kind:'dose',medicationId:m.id,date:today(),outcome:'跳过'});assert.equal(noReason.message,'请填写跳过原因');leak(noReason.message);
 const skip=(await ok(tokenA,'create_record',{kind:'dose',medicationId:m.id,date:today(),outcome:'跳过',time:'08:00',note:'忘了带药'})).created;assert.equal(skip.outcome,'跳过');assert.equal(skip.time,'');assert.equal(skip.note,'忘了带药');
 const fut=await errc(tokenA,'create_record',{kind:'dose',medicationId:m.id,date:shift(1),time:'08:00'});assert.equal(fut.code,'future_date');leak(fut.message);
 const nm=await errc(tokenA,'create_record',{kind:'dose',medicationId:'nope',time:'08:00'});assert.equal(nm.code,'not_found');assert.match(nm.hint,/list_records kind=medication/);leak(nm.message);
 const none=await errc(tokenA,'create_record',{kind:'dose',time:'08:00'});assert.equal(none.code,'validation_failed');leak(none.message);
});
test('report/medication need an existing visit; future visits allowed like web',async()=>{
 for(const kind of ['report','medication']){const extra=kind==='medication'?{dosage:'1',route:'口服',frequency:'每日',times:['08:00']}:{content:'x'};
  const miss=await errc(tokenA,'create_record',{kind,title:'x',...extra});assert.equal(miss.code,'validation_failed');assert.match(miss.hint,/list_records kind=visit/);leak(miss.message);
  const nf=await errc(tokenA,'create_record',{kind,title:'x',visitId:'nope',...extra});assert.equal(nf.code,'not_found');assert.match(nf.hint,/list_records kind=visit/);leak(nf.message);
 }
 const appt=(await ok(tokenA,'create_record',{kind:'visit',title:'预约复查',date:shift(7)})).created;assert.equal(appt.status,'待就诊');
 assert.equal((await ok(tokenA,'create_record',{kind:'visit',title:'x',date:shift(7),status:'已完成'})).created.status,'已完成');
 assert.equal((await ok(tokenA,'update_record',{id:appt.id,status:'已完成'})).updated.status,'已完成');
 const rep=(await ok(tokenA,'create_record',{kind:'report',title:'待出报告',date:shift(7),visitId:appt.id,status:'待出报告'})).created;assert.equal(rep.date,shift(7));
 const med=(await ok(tokenA,'create_record',{kind:'medication',title:'下周开始的药',date:shift(3),endDate:shift(9),visitId:appt.id,dosage:'1 片',route:'口服',frequency:'每日一次',times:['09:00']})).created;assert.equal(med.date,shift(3));
 const wv=await req('/api/items',{method:'POST',body:{kind:'visit',title:'网页补记',date:shift(7),status:'已完成'},headers:web(cookieA)});assert.equal(wv.status,201);
});
test('attachments: only name and type via MCP; cannot be set or changed',async()=>{
 const v=(await req('/api/items',{method:'POST',body:{kind:'visit',title:'拍片',date:shift(-3),status:'已完成'},headers:web(cookieA)})).body;
 const f=await req('/api/upload',{method:'POST',body:{name:'片子.png',content:Buffer.from('fake').toString('base64'),visitId:v.id},headers:web(cookieA)});assert.equal(f.status,201,f.text);
 const r=(await req('/api/items',{method:'POST',body:{kind:'report',title:'影像',date:shift(-3),visitId:v.id,type:'影像报告',fileId:f.body.id},headers:web(cookieA)})).body;
 const listed=(await ok(tokenA,'list_records',{kind:'report'})).records.find(x=>x.id===r.id);assert.deepEqual(listed.attachment,{name:'片子.png',type:'image/png'});noStorage(listed);
 noStorage(await ok(tokenA,'list_records',{}));noStorage(await ok(tokenA,'get_today',{}));
 assert.equal((await errc(tokenA,'update_record',{id:r.id,fileId:'other'})).message,'助手不能添加或更换附件，请到网页操作');
 assert.equal((await errc(tokenA,'create_record',{kind:'report',title:'x',visitId:v.id,fileId:f.body.id})).message,'助手不能添加或更换附件，请到网页操作');
 const up=(await ok(tokenA,'update_record',{id:r.id,content:'未见异常'})).updated;assert.equal(up.content,'未见异常');assert.deepEqual(up.attachment,{name:'片子.png',type:'image/png'});noStorage(up);
 const st=(await req('/api/state',{headers:web(cookieA)})).body.items.find(x=>x.id===r.id);assert.equal(st.fileId,f.body.id);
});
test('provenance: MCP marks records; web body cannot set or wipe the markers',async()=>{
 const c=(await ok(tokenA,'create_record',{kind:'note',title:'AI 记的'})).created;assert.equal(c.createdVia,'mcp');assert.ok(c.aiCreatedAt);assert.ok(c.lastAiEditAt);
 const w=await req('/api/items',{method:'POST',body:{kind:'note',title:'网页记的',date:today(),createdVia:'mcp',lastAiEditAt:'2020-01-01T00:00:00Z',aiCreatedAt:'x'},headers:web(cookieA)});assert.equal(w.status,201);for(const k of ['createdVia','aiCreatedAt','lastAiEditAt'])assert.equal(w.body[k],undefined,k);
 const we=await req(`/api/items/${c.id}`,{method:'PUT',body:{title:'网页改过',createdVia:'web',lastAiEditAt:'2020-01-01T00:00:00Z'},headers:web(cookieA)});assert.equal(we.status,200);
 assert.equal(we.body.title,'网页改过');assert.equal(we.body.createdVia,'mcp');assert.equal(we.body.lastAiEditAt,c.lastAiEditAt);assert.equal(we.body.aiCreatedAt,c.aiCreatedAt);
 const wu=await req(`/api/items/${w.body.id}`,{method:'PUT',body:{title:'网页再改'},headers:web(cookieA)});assert.equal(wu.body.lastAiEditAt,undefined);
 const ai=(await ok(tokenA,'update_record',{id:w.body.id,note:'助手补充'})).updated;assert.equal(ai.createdVia,undefined);assert.ok(ai.lastAiEditAt);
 const del=await req(`/api/items/${c.id}`,{method:'DELETE',body:{},headers:web(cookieA)});assert.equal(del.status,200);
 const back=await req('/api/restore',{method:'POST',body:{id:c.id},headers:web(cookieA)});assert.equal(back.body.createdVia,'mcp');
});
test('medication/dose tool descriptions require read-back and 「对」',async()=>{
 const tools=(await rpc(tokenA,'tools/list')).body.result.tools;
 for(const n of ['create_record','update_record'])assert.match(tools.find(t=>t.name===n).description,/药名、剂量、时间.*「对」.*跳过.*原因.*「对」/);
});
test('cross-account isolation: account B cannot see or update A records',async()=>{
 const a=(await ok(tokenA,'create_record',{kind:'note',title:'A 的私密备忘',date:'2026-10-06'})).created;
 const b=await ok(tokenB,'list_records',{});assert.equal(b.records.some(r=>r.id===a.id||r.title.includes('A 的')),false);
 assert.equal((await ok(tokenB,'get_today',{})).records.length,0);
 assert.match(await err(tokenB,'update_record',{id:a.id,title:'hijack'}),/没有找到这条记录/);
 const still=(await ok(tokenA,'list_records',{kind:'note'})).records.find(r=>r.id===a.id);assert.equal(still.title,'A 的私密备忘');
});

const errc=async(token,name,args)=>{const r=await call(token,name,args);assert.equal(r.isError,true);assert.equal(r.structuredContent.error.message,r.content[0].text);return r.structuredContent.error;};
const leak=m=>{assert.doesNotMatch(m.replace('list_workbenches',''),/[A-Za-z_]{3,}|[<>≤≥]|=|（(finance|health)）/,m);};
test('tool errors: stable codes and plain Chinese without internals',async()=>{
 const cases=[
  [{kind:'exercise',title:'跑',duration:2000},'validation_failed',/^运动时长需在 1–1440 分钟之间$/],
  [{kind:'water',volume:0},'validation_failed',/^饮水量需在 1–5000ml 之间$/],
  [{workbench:'finance',kind:'water',volume:200},'forbidden_kind',/金融」工作台只能记备忘和待办/],
  [{kind:'meal'},'validation_failed',/名称/],
  [{title:'x'},'validation_failed',/^缺少记录类型$/],
  [{kind:'exercise',title:'力量',duration:30,exercises:[{name:'深蹲',sets:3}]},'validation_failed',/^第1个动作缺少次数$/],
  [{kind:'meal',title:'x',time:'25:00'},'validation_failed',/^时间格式不对/],
  [{kind:'exercise',title:'x',duration:10,feeling:'爽'},'validation_failed',/^身体感受只能是/],
  [{workbench:'nope',kind:'note',title:'x'},'not_found',/没有找到这个工作台/],
 ];
 for(const [args,code,re] of cases){const e=await errc(tokenA,'create_record',args);assert.equal(e.code,code,e.message);assert.match(e.message,re);leak(e.message);}
 const nf=await errc(tokenA,'update_record',{id:'missing',title:'x'});assert.equal(nf.code,'not_found');leak(nf.message);
});
test('create_record/update_record reject future dates (Asia/Shanghai) with future_date; web API too',async()=>{
 const t=today(),d=new Date(t+'T12:00:00+08:00');d.setDate(d.getDate()+1);const tomorrow=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(d);
 const msg=`不能记录未来的日期，今天是 ${Number(t.slice(5,7))}月${Number(t.slice(8,10))}日`;
 for(const args of [{kind:'water',volume:200,date:tomorrow},{kind:'meal',title:'x',date:tomorrow},{kind:'exercise',title:'跑',duration:10,date:tomorrow},{kind:'metric',title:'体重',type:'weight',value:60,date:tomorrow}]){const e=await errc(tokenA,'create_record',args);assert.equal(e.code,'future_date');assert.equal(e.message,msg);}
 const created=await ok(tokenA,'create_record',{kind:'water',volume:200,date:t});const e=await errc(tokenA,'update_record',{id:created.created.id,date:tomorrow});assert.equal(e.code,'future_date');
 assert.equal((await ok(tokenA,'create_record',{kind:'task',title:'明天体检',date:tomorrow})).created.date,tomorrow);
 const web=await req('/api/items?space=personal&workbench=health',{method:'POST',body:{kind:'meal',title:'x',date:tomorrow},headers:{Cookie:cookieA,Origin:base}});assert.equal(web.status,400);assert.equal(web.body.code,'future_date');assert.equal(web.body.error,msg);
});
test('401 bodies carry token_missing / token_invalid; PAT on token management is token_forbidden',async()=>{
 const none=await req('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'ping'}});assert.equal(none.body.code,'token_missing');leak(none.body.error);
 const bad=await rpc('zh_pat_'+'A'.repeat(43),'ping');assert.equal(bad.body.code,'token_invalid');
 const cookieOnly=await req('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'ping'},headers:web(cookieA)});assert.equal(cookieOnly.body.code,'token_forbidden');
 const api=await req('/api/state',{headers:{Authorization:'Bearer zh_pat_'+'B'.repeat(43)}});assert.equal(api.status,401);assert.equal(api.body.code,'token_invalid');
 assert.equal((await req('/api/state')).body.code,'token_missing');
 const pm=await req('/api/auth/tokens',{headers:{Authorization:`Bearer ${tokenA}`}});assert.equal(pm.status,403);assert.equal(pm.body.code,'token_forbidden');
});
test('malformed Bearer values are token_invalid; no Bearer scheme at all is token_missing; token list keeps last4',async()=>{
 const send=(authorization,path='/mcp')=>req(path,path==='/mcp'?{method:'POST',body:{jsonrpc:'2.0',id:1,method:'ping'},headers:{Authorization:authorization}}:{headers:{Authorization:authorization}});
 for(const h of ['Bearer abc','Bearer wrong_'+'C'.repeat(43),'Bearer ','Bearer','bearer abc','Bearer a b']){for(const path of ['/mcp','/api/state']){const r=await send(h,path);assert.equal(r.status,401,h+path);assert.equal(r.body.code,'token_invalid',h+path);leak(r.body.error);}}
 for(const h of ['Basic dXNlcjpwYXNz','Token zh_pat_'+'D'.repeat(43)]){for(const path of ['/mcp','/api/state']){const r=await send(h,path);assert.equal(r.status,401);assert.equal(r.body.code,'token_missing',h+path);}}
 const t=await mint(cookieA);const list=await req('/api/auth/tokens',{headers:web(cookieA)});assert.equal(list.status,200);assert.ok(list.body.tokens.some(x=>x.last4===t.slice(-4)));
 for(const [m,path] of [['GET','/api/auth/tokens'],['POST','/api/auth/tokens'],['DELETE','/api/auth/tokens/x']]){const r=await req(path,{method:m,body:m==='POST'?{name:'x'}:m==='DELETE'?{}:undefined,headers:{Authorization:`Bearer ${t}`}});assert.equal(r.status,403,m);assert.equal(r.body.code,'token_forbidden',m);}
});
test('web API validation messages are plain Chinese without field names or format codes',async()=>{
 const wb=async b=>(await req('/api/workbenches',{method:'POST',body:b,headers:web(cookieA)})).body.error;
 assert.equal(await wb({type:'health',name:'体检'}),'新建的工作台只能记备忘和待办');
 assert.equal(await wb({type:'other',name:''}),'工作台名称需为1–24个字');
 const t=await req('/api/items?space=personal&workbench=health',{method:'POST',body:{kind:'meal',title:'早餐',date:today(),time:'25:00'},headers:web(cookieA)});assert.equal(t.status,400);assert.equal(t.body.error,'时间格式不对，例如 08:30');
});
test('429 rate limit includes Retry-After seconds and rate_limited code',async()=>{
 const t=await mint(cookieA);let r;for(let i=0;i<125;i++){r=await rpc(t,'ping');if(r.status===429)break;}
 assert.equal(r.status,429);const ra=Number(r.headers.get('retry-after'));assert.ok(Number.isInteger(ra)&&ra>=1&&ra<=60,String(ra));assert.equal(r.body.error.data.code,'rate_limited');assert.equal(r.body.error.data.retryAfter,ra);
});
