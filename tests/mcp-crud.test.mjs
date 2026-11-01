// MCP delete / 最近删除 / restore, favorite, workbenches and settings. Real server, throwaway DB, fictional local accounts only.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import {startServer,freePort} from './helpers.mjs';
const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-only-passphrase-96',email='crud-admin@example.invalid';
let dir,server,base,cookie,token,tokenB,n=1;
async function req(route,{method='GET',body,headers={}}={}){const r=await fetch(base+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();return {status:r.status,headers:r.headers,body:text?JSON.parse(text):undefined};}
const web=c=>({Cookie:c||cookie,Origin:base});
const call=async(t,name,args)=>{const r=await req('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:n++,method:'tools/call',params:{name,arguments:args}},headers:{Authorization:`Bearer ${t}`}});assert.ok(r.body?.result,JSON.stringify(r.body));return r.body.result;};
const ok=async(name,args,t=token)=>{const r=await call(t,name,args);assert.equal(r.isError,false,r.content[0].text);return r.structuredContent;};
const err=async(name,args,t=token)=>{const r=await call(t,name,args);assert.equal(r.isError,true,JSON.stringify(r.structuredContent));assert.doesNotMatch(r.structuredContent.error.message,/[A-Za-z_]{3,}/);return r.structuredContent.error;};
const login=async(e,p)=>(await req('/api/auth/login',{method:'POST',body:{email:e,password:p},headers:{Origin:base}})).headers.get('set-cookie').split(';')[0];
const day=k=>{const d=new Date(Date.now()+k*864e5);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(d);};
before(async()=>{
 dir=await mkdtemp(path.join(os.tmpdir(),'workbench-crud-'));
 const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','Fictional CRUD admin'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);
 const port=await freePort();server=await startServer({cwd,env:{NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir}});base=server.base;
 cookie=await login(email,password);token=(await req('/api/auth/tokens',{method:'POST',body:{name:'crud'},headers:web()})).body.token;
 const inv=await req('/api/auth/invitations',{method:'POST',body:{email:'crud-b@example.invalid',name:'B'},headers:web()});await req('/api/auth/accept-invitation',{method:'POST',body:{token:inv.body.token,password:'Fictional-only-passphrase-97'},headers:{Origin:base}});
 const cb=await login('crud-b@example.invalid','Fictional-only-passphrase-97');tokenB=(await req('/api/auth/tokens',{method:'POST',body:{name:'b'},headers:web(cb)})).body.token;
});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});

test('delete_record → 最近删除 → restore_record (same id, provenance kept); AI delete marked',async()=>{
 const w=(await ok('create_record',{kind:'water',volume:250})).created;
 const d=await ok('delete_record',{id:w.id});assert.equal(d.deleted.id,w.id);assert.equal(d.deleted.volume,250);assert.equal(d.restorableDays,30);
 assert.equal((await ok('list_records',{kind:'water'})).records.some(x=>x.id===w.id),false);
 const del=(await ok('list_deleted',{})).records.find(x=>x.id===w.id);assert.equal(del.deletedVia,'mcp');assert.ok(del.deletedAt<del.expiresAt);
 assert.ok(Date.parse(del.expiresAt)-Date.parse(del.deletedAt)>=30*864e5-1000);
 const webList=(await req('/api/trash',{headers:web()})).body.items.find(x=>x.id===w.id);assert.equal(webList.deletedVia,'mcp');
 const r=await ok('restore_record',{id:w.id});assert.equal(r.restored.id,w.id);assert.equal(r.restored.createdVia,'mcp');
 assert.ok((await ok('list_records',{kind:'water'})).records.some(x=>x.id===w.id));
 assert.equal((await ok('list_deleted',{})).records.some(x=>x.id===w.id),false);
 assert.equal((await err('restore_record',{id:w.id})).code,'not_found');
 assert.equal((await err('delete_record',{id:'missing'})).code,'not_found');
});
test('web deletes also land in 最近删除; 12s undo still works and clears the trash entry; web restore endpoint',async()=>{
 const a=(await req('/api/items',{method:'POST',body:{kind:'note',title:'网页备忘',date:day(0)},headers:web()})).body;
 assert.equal((await req(`/api/items/${a.id}`,{method:'DELETE',body:{},headers:web()})).status,200);
 const t=(await req('/api/trash',{headers:web()})).body.items.find(x=>x.id===a.id);assert.equal(t.deletedVia,'web');
 assert.equal((await req('/api/restore',{method:'POST',body:{id:a.id},headers:web()})).status,200);
 assert.equal((await req('/api/trash',{headers:web()})).body.items.some(x=>x.id===a.id),false);
 await req(`/api/items/${a.id}`,{method:'DELETE',body:{},headers:web()});
 const r=await req('/api/trash/restore',{method:'POST',body:{id:a.id},headers:web()});assert.equal(r.status,200);assert.equal(r.body.title,'网页备忘');
 assert.equal((await req('/api/trash/restore',{method:'POST',body:{id:a.id},headers:web()})).status,404);
});
test('cascade follows web: medication with doses blocked; deleting a visit keeps its reports/medications; restore needs parent first',async()=>{
 const v=(await ok('create_record',{kind:'visit',title:'复诊',date:day(-3),status:'已完成'})).created;
 const rep=(await ok('create_record',{kind:'report',title:'血常规',date:day(-3),visitId:v.id,content:'正常'})).created;
 const m=(await ok('create_record',{kind:'medication',title:'示例药',date:day(-3),visitId:v.id,dosage:'1 片',route:'口服',frequency:'每日一次',times:['08:00']})).created;
 const dose=(await ok('create_record',{kind:'dose',medicationId:m.id,date:day(-2),time:'08:00'})).created;
 const blocked=await err('delete_record',{id:m.id});assert.equal(blocked.message,'该方案已有服用记录，请停用以保留历史，或先移除服用记录');
 const webBlocked=await req(`/api/items/${m.id}`,{method:'DELETE',body:{},headers:web()});assert.equal(webBlocked.status,400);assert.equal(webBlocked.body.error,blocked.message);
 await ok('delete_record',{id:dose.id});await ok('delete_record',{id:m.id});
 const pe=await err('restore_record',{id:dose.id});assert.equal(pe.code,'parent_deleted');assert.equal(pe.message,'所属用药方案「示例药」也已删除，需要一起恢复');assert.match(pe.hint,/所属用药方案「示例药」也已删除，一起恢复？/);assert.match(pe.hint,new RegExp(m.id));
 await ok('restore_record',{id:m.id});await ok('restore_record',{id:dose.id});
 await ok('delete_record',{id:v.id});
 const recs=(await ok('list_records',{kind:'all'})).records;assert.ok(recs.some(x=>x.id===rep.id));assert.ok(recs.some(x=>x.id===m.id));
 await ok('delete_record',{id:rep.id});
 const re=await err('restore_record',{id:rep.id});assert.equal(re.code,'parent_deleted');assert.equal(re.message,'所属就诊「复诊」也已删除，需要一起恢复');assert.equal((await req('/api/trash/restore',{method:'POST',body:{id:rep.id},headers:web()})).body.parentKinds[0],'visit');
 await ok('restore_record',{id:v.id});assert.equal((await ok('restore_record',{id:rep.id})).restored.visitId,v.id);
});
test('restore with parent gone for good is a plain error',async()=>{
 const v=(await ok('create_record',{kind:'visit',title:'临时',date:day(-1),status:'已完成'})).created;
 const rep=(await ok('create_record',{kind:'report',title:'r',date:day(-1),visitId:v.id})).created;
 await ok('delete_record',{id:rep.id});await ok('delete_record',{id:v.id});
 const db=new DatabaseSync(path.join(dir,'health.sqlite'));db.prepare('DELETE FROM trash_items WHERE id=?').run(v.id);db.close();
 const ld=(await ok('list_deleted',{})).records.find(x=>x.id===rep.id);assert.equal(ld.restorable,false);assert.equal(ld.reason,'所属就诊已清除，无法恢复');
 const wl=(await req('/api/trash',{headers:web()})).body.items.find(x=>x.id===rep.id);assert.equal(wl.restorable,false);assert.equal(wl.reason,'所属就诊已清除，无法恢复');
 assert.ok((await req('/api/trash',{headers:web()})).body.items.filter(x=>x.id!==rep.id).every(x=>x.restorable===true||x.reason));
 const e=await err('restore_record',{id:rep.id});assert.equal(e.code,'parent_missing');assert.equal(e.message,'它所属的就诊记录已经不在了，无法恢复');
});
test('expired trash is purged (30 days)',async()=>{
 const x=(await ok('create_record',{kind:'note',title:'过期'})).created;await ok('delete_record',{id:x.id});
 const db=new DatabaseSync(path.join(dir,'health.sqlite'));db.prepare('UPDATE trash_items SET expires_at=? WHERE id=?').run(Date.now()-1,x.id);db.close();
 assert.equal((await ok('list_deleted',{})).records.some(r=>r.id===x.id),false);assert.equal((await err('restore_record',{id:x.id})).code,'not_found');
});
test('delete isolation: other account cannot delete/list/restore; finance workbench rules',async()=>{
 const x=(await ok('create_record',{kind:'note',title:'A 的'})).created;
 assert.equal((await err('delete_record',{id:x.id},tokenB)).code,'not_found');
 await ok('delete_record',{id:x.id});assert.equal((await ok('list_deleted',{},tokenB)).records.length,0);assert.equal((await err('restore_record',{id:x.id},tokenB)).code,'not_found');
 const f=(await ok('create_record',{workbench:'finance',kind:'task',title:'记账'})).created;assert.equal((await ok('delete_record',{workbench:'finance',id:f.id})).deleted.id,f.id);
 assert.ok((await ok('list_deleted',{workbench:'finance'})).records.some(r=>r.id===f.id));
});
test('favorite: list/create/update/delete via MCP with web validation',async()=>{
 const fav=(await ok('create_record',{kind:'favorite',title:'常吃早餐',targetKind:'meal',template:{title:'燕麦牛奶',mealType:'早餐',portion:'一碗'}})).created;
 assert.equal(fav.targetKind,'meal');assert.equal(fav.template.title,'燕麦牛奶');
 assert.ok((await ok('list_records',{kind:'favorite'})).records.some(x=>x.id===fav.id));
 assert.equal((await ok('update_record',{id:fav.id,title:'早餐常用'})).updated.title,'早餐常用');
 assert.match((await err('create_record',{kind:'favorite',title:'x',targetKind:'water'})).message,/收藏类型只能是/);
 assert.match((await err('create_record',{kind:'favorite',title:'x',targetKind:'exercise',template:{title:'跑'}})).message,/运动时长/);
 await ok('delete_record',{id:fav.id});assert.ok((await ok('list_deleted',{})).records.some(x=>x.id===fav.id));
});
test('workbenches: create (notes/tasks only), rename custom only, names 1–24',async()=>{
 const c=(await ok('create_workbench',{name:' 家务 '})).created;assert.equal(c.name,'家务');assert.deepEqual(c.writableKinds,['note','task']);
 assert.ok((await ok('list_workbenches',{})).workbenches.some(w=>w.id===c.id&&w.name==='家务'));
 assert.ok((await ok('create_record',{workbench:c.id,kind:'task',title:'倒垃圾'})).created);
 assert.match((await err('create_record',{workbench:c.id,kind:'water',volume:100})).message,/只能记备忘和待办/);
 assert.equal((await ok('rename_workbench',{workbench:c.id,name:'家务事'})).renamed.name,'家务事');
 assert.equal((await err('rename_workbench',{workbench:'health',name:'x'})).message,'「健康」是内置工作台，不能改名');
 assert.equal((await err('create_workbench',{name:'一'.repeat(25)})).message,'工作台名称需为 1–24 个字');
 assert.equal((await err('create_workbench',{name:'   '})).message,'工作台名称需为 1–24 个字');assert.equal((await err('create_workbench',{name:''})).message,'工作台名称需为 1–24 个字');assert.equal((await err('rename_workbench',{workbench:'health',name:''})).message,'工作台名称需为 1–24 个字');
 assert.equal((await err('rename_workbench',{workbench:c.id,name:'  '})).message,'工作台名称需为 1–24 个字');
 assert.equal((await err('rename_workbench',{workbench:'nope',name:'x'})).code,'not_found');
 assert.equal((await ok('list_workbenches',{},tokenB)).workbenches.some(w=>w.id===c.id),false);
});
test('settings: water goal used by get_today and the web; web PUT keeps it; ranges',async()=>{
 assert.equal((await ok('get_settings',{})).waterGoalMl,2000);
 assert.equal((await ok('update_settings',{waterGoalMl:2500})).waterGoalMl,2500);
 assert.equal((await ok('get_today',{})).summary.water.goalMl,2500);
 const put=await req('/api/settings',{method:'PUT',body:{name:'小王',focus:'早睡'},headers:web()});assert.equal(put.status,200);assert.equal(put.body.waterGoalMl,2500);
 assert.equal((await req('/api/settings',{method:'PUT',body:{name:'小王',focus:'早睡',waterGoalMl:'1800'},headers:web()})).body.waterGoalMl,1800);
 assert.equal((await req('/api/state',{headers:web()})).body.settings.waterGoalMl,1800);
 assert.equal((await req('/api/settings',{method:'PUT',body:{waterGoalMl:50},headers:web()})).body.error,'每日饮水目标需在 100–10000 毫升之间');
 assert.equal((await err('update_settings',{waterGoalMl:50})).message,'每日饮水目标需在 100–10000 毫升之间');
 assert.equal((await ok('update_settings',{focus:'多走路'})).focus,'多走路');assert.equal((await ok('get_settings',{})).waterGoalMl,1800);
 assert.equal((await err('update_settings',{})).code,'validation_failed');
 const tools=(await req('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'},headers:{Authorization:`Bearer ${token}`}})).body.result.tools.map(t=>t.name);
 for(const t of tools)assert.doesNotMatch(t,/password|token|account|admin|user/);
});

test('web 最近删除 covers all workbenches of the current space; workbench name; restore via web in another workbench',async()=>{
 const f=(await ok('create_record',{workbench:'finance',kind:'note',title:'金融备忘'})).created;await ok('delete_record',{workbench:'finance',id:f.id});
 const h=(await ok('create_record',{kind:'water',volume:120})).created;await ok('delete_record',{id:h.id});
 const list=(await req('/api/trash',{headers:web()})).body.items;const fi=list.find(x=>x.id===f.id);assert.equal(fi.workbench,'finance');assert.equal(fi.workbenchName,'金融');assert.ok(list.some(x=>x.id===h.id&&x.workbench==='health'));
 for(let i=1;i<list.length;i++)assert.ok(list[i-1].deletedAt>=list[i].deletedAt);
 assert.equal((await req('/api/trash?space=demo',{headers:web()})).body.items.some(x=>x.id===f.id),false);
 const r=await req('/api/trash/restore',{method:'POST',body:{id:f.id},headers:web()});assert.equal(r.status,200);assert.equal(r.body.workbench,'finance');
 assert.ok((await ok('list_records',{workbench:'finance'})).records.some(x=>x.id===f.id));
});
test('restore withParent (MCP and web): parent restored first, then child; without it the error names withParent',async()=>{
 const v=(await ok('create_record',{kind:'visit',title:'眼科',date:day(-4),status:'已完成'})).created;
 const m=(await ok('create_record',{kind:'medication',title:'眼药水',date:day(-4),visitId:v.id,dosage:'1 滴',route:'滴眼',frequency:'每日两次',times:['08:00','20:00']})).created;
 const d=(await ok('create_record',{kind:'dose',medicationId:m.id,date:day(-3),time:'08:01'})).created;
 await ok('delete_record',{id:d.id});await ok('delete_record',{id:m.id});await ok('delete_record',{id:v.id});
 const e=await err('restore_record',{id:d.id});assert.equal(e.code,'parent_deleted');assert.match(e.hint,/withParent/);assert.equal(e.message,'用药方案「眼药水」和所属就诊「眼科」也已删除，需要一起恢复');assert.match(e.hint,new RegExp(`${m.id}、${v.id}`));assert.match(e.hint,/用药方案「眼药水」和所属就诊「眼科」也已删除，一起恢复？/);
 const web1=await req('/api/trash/restore',{method:'POST',body:{id:d.id},headers:web()});assert.equal(web1.status,400);assert.equal(web1.body.code,'parent_deleted');assert.equal(web1.body.parentKind,'medication');assert.deepEqual(web1.body.parentKinds,['medication','visit']);
 const r=(await ok('restore_record',{id:d.id,withParent:true})).restored;assert.equal(r.id,d.id);assert.equal(r.restoredCount,3);
 const all=(await ok('list_records',{kind:'all'})).records;for(const id of [v.id,m.id,d.id])assert.ok(all.some(x=>x.id===id),id);
 const rep=(await ok('create_record',{kind:'report',title:'验光',date:day(-4),visitId:v.id})).created;await ok('delete_record',{id:rep.id});await ok('delete_record',{id:v.id});
 const w=await req('/api/trash/restore',{method:'POST',body:{id:rep.id,withParent:true},headers:web()});assert.equal(w.status,200);assert.equal(w.body.parentRestored.id,v.id);
});
test('records whose visit/medication was deleted still read fine: visit {deleted, inTrash}; web state lists trashed ids',async()=>{
 const v=(await ok('create_record',{kind:'visit',title:'牙科',date:day(-5),status:'已完成'})).created;
 const rep=(await ok('create_record',{kind:'report',title:'牙片',date:day(-5),visitId:v.id})).created;
 const m=(await ok('create_record',{kind:'medication',title:'漱口水',date:day(-5),visitId:v.id,dosage:'10 毫升',route:'含漱',frequency:'每日一次',times:['21:00']})).created;
 await ok('delete_record',{id:v.id});
 const recs=(await ok('list_records',{kind:'all'})).records;assert.deepEqual(recs.find(x=>x.id===rep.id).visit,{deleted:true,inTrash:true});assert.deepEqual(recs.find(x=>x.id===m.id).visit,{deleted:true,inTrash:true});
 assert.ok((await req('/api/state',{headers:web()})).body.trashedIds.includes(v.id));
 const db=new DatabaseSync(path.join(dir,'health.sqlite'));db.prepare('DELETE FROM trash_items WHERE id=?').run(v.id);db.close();
 assert.deepEqual((await ok('list_records',{kind:'report'})).records.find(x=>x.id===rep.id).visit,{deleted:true,inTrash:false});
 assert.equal((await ok('update_record',{id:rep.id,content:'补充'})).updated.content,'补充');
});
test('designer copy: skip reason, plan dates, duplicate times (web and MCP)',async()=>{
 const v=(await ok('create_record',{kind:'visit',title:'内科',date:day(-3),status:'已完成'})).created;
 const start=day(-2),end=day(-1);const md=d=>`${Number(d.slice(5,7))}月${Number(d.slice(8,10))}日`;
 const m=(await ok('create_record',{kind:'medication',title:'药 D',date:start,endDate:end,visitId:v.id,dosage:'1 片',route:'口服',frequency:'每日一次',times:['08:00']})).created;
 assert.equal((await err('create_record',{kind:'dose',medicationId:m.id,date:day(-3),time:'08:00'})).message,`这个方案从 ${md(start)}开始，服药日期不能早于这天`);
 assert.equal((await err('create_record',{kind:'dose',medicationId:m.id,date:day(0),time:'00:00'})).message,`这个方案到 ${md(end)}结束，服药日期不能晚于这天`);
 assert.equal((await err('create_record',{kind:'dose',medicationId:m.id,date:end,outcome:'跳过'})).message,'跳过要写原因，比如「忘带药」');
 assert.equal((await err('create_record',{kind:'medication',title:'x',visitId:v.id,dosage:'1',route:'口服',frequency:'每日',times:['08:00','20:00','08:00']})).message,'08:00 填了两次，每个时间只填一次');
 const wb=b=>req('/api/items',{method:'POST',body:b,headers:web()});
 assert.equal((await wb({kind:'medication',title:'x',date:day(-1),visitId:v.id,dosage:'1',route:'口服',frequency:'每日',times:['09:00','09:00']})).body.error,'09:00 填了两次，每个时间只填一次');
 assert.equal((await wb({kind:'dose',title:'x',medicationId:m.id,date:day(-3),outcome:'已服用',time:'08:00'})).body.error,`这个方案从 ${md(start)}开始，服药日期不能早于这天`);
 assert.equal((await wb({kind:'dose',title:'x',medicationId:m.id,date:end,outcome:'跳过'})).body.error,'跳过要写原因，比如「忘带药」');
});

test('delete_record description requires read-back and 「对」 for medication/dose; MCP text uses 就诊 only',async()=>{
 const tools=(await req('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'},headers:{Authorization:`Bearer ${token}`}})).body.result.tools;
 assert.match(tools.find(t=>t.name==='delete_record').description,/药名、剂量、时间.*「对」/);
 assert.ok(!JSON.stringify(tools).includes('就'+'医'));
});

test('workbench names are unique per account (trimmed), web and MCP, create and rename',async()=>{
 const a=(await ok('create_workbench',{name:'读书'})).created;
 assert.equal((await err('create_workbench',{name:' 读书 '})).message,'已经有叫「读书」的工作台了');
 const w=await req('/api/workbenches',{method:'POST',body:{type:'other',name:'读书'},headers:web()});assert.equal(w.status,400);assert.equal(w.body.error,'已经有叫「读书」的工作台了');
 assert.equal((await err('create_workbench',{name:'健康'})).message,'已经有叫「健康」的工作台了');
 const b=(await ok('create_workbench',{name:'跑步'})).created;
 assert.equal((await err('rename_workbench',{workbench:b.id,name:'读书'})).message,'已经有叫「读书」的工作台了');
 assert.equal((await ok('rename_workbench',{workbench:a.id,name:' 读书 '})).renamed.name,'读书');
 assert.equal((await ok('create_workbench',{name:'读书'},tokenB)).created.name,'读书');
 const wb=await req('/api/workbenches',{method:'POST',body:{type:'other',name:'书法'},headers:web()});assert.equal(wb.status,201);
});
