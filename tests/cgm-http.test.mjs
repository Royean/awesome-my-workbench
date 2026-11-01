// All provider traffic is intercepted inside an isolated server process; no real CGM accounts.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm,readdir,stat} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startServer,freePort} from './helpers.mjs';
const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-cgm-account-pass-87',email='cgm-http@example.invalid';
let dir,server,base,cookie,otherCookie,pat,env;
const owners=new Map();
async function req(route,{method='GET',body,who=cookie,bearer,origin=base,headers={}}={}){const r=await fetch(base+route,{method,headers:{...(bearer?{Authorization:'Bearer '+bearer}:who?{Cookie:who}:{}),Origin:origin,'Content-Type':'application/json','X-Workbench-Owner':owners.get(who)||'',...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});return {status:r.status,body:await r.json(),headers:r.headers};}
async function login(e){const r=await req('/api/auth/login',{method:'POST',who:'',body:{email:e,password}});assert.equal(r.status,200);const ck=r.headers.get('set-cookie').split(';')[0];owners.set(ck,r.body.user.id);return ck;}
before(async()=>{
 dir=await mkdtemp(path.join(os.tmpdir(),'cgm-http-'));const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','Fictional CGM tester'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);
 const preload=path.join(dir,'provider-fixture.mjs');await writeFile(preload,`
 import fs from 'node:fs';
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
  if(!String(url).startsWith('https://api.sisensing.com/'))return original(url,options);
  if(options.method==='POST'){
   fs.appendFileSync(new URL('./provider-calls.txt',import.meta.url),'call\\n');
   const b=JSON.parse(options.body);
   if(b.password!=='fictional-provider-password')return Response.json({code:601,msg:'do-not-expose-fixture-secret'});
   return Response.json({code:200,data:{access_token:'fictional-cgm-token',expires_in:1209600}});
  }
  const t=Date.now()-3600000;
  return Response.json({code:200,data:{glucoseInfos:[{t,v:5.4,s:1},{t:t-300000,v:5.2,s:0},{t,v:5.6,s:1}]}});
 };\n`);
 const port=await freePort();env={NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir,NODE_OPTIONS:'--import='+pathToFileURL(preload).href};server=await startServer({cwd,env});base=server.base;cookie=await login(email);
 const inv=await req('/api/auth/invitations',{method:'POST',body:{email:'cgm-http-other@example.invalid',name:'Fictional other'}});assert.equal(inv.status,201);assert.equal((await req('/api/auth/accept-invitation',{method:'POST',who:'',body:{token:inv.body.token,password}})).status,200);otherCookie=await login('cgm-http-other@example.invalid');pat=(await req('/api/auth/tokens',{method:'POST',body:{name:'cgm-isolation-test'}})).body.token;
});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});
test('CGM API requires interactive auth, owner and real personal health scope',async()=>{
 assert.equal((await req('/api/cgm/connections',{who:''})).status,401);
 assert.equal((await req('/api/cgm/connections',{who:'',bearer:pat})).status,403);
 assert.equal((await req('/api/cgm/connections?space=demo')).status,403);
 const swapped=await req('/api/cgm/connections',{method:'POST',who:otherCookie,headers:{'X-Workbench-Owner':owners.get(cookie)},body:{provider:'silite',username:'19900000001',password:'fictional-provider-password',consent:true}});assert.equal(swapped.status,409);assert.equal(swapped.body.code,'cgm_owner_changed');assert.deepEqual((await req('/api/cgm/connections',{who:otherCookie})).body.connections,[]);assert.equal(await stat(path.join(dir,'provider-calls.txt')).then(()=>true,()=>false),false);
 assert.equal((await req('/api/cgm/connections?workbench=finance')).status,403);
 assert.equal((await req('/api/cgm/connections',{method:'POST',origin:'https://foreign.invalid',body:{}})).status,403);
 const list=await req('/api/cgm/providers');assert.equal(list.status,200);assert.equal(list.body.providers[0].id,'silite');assert.ok(list.body.owner);assert.match(list.headers.get('cache-control'),/no-store/);
});
test('credential consent and bounded payload; real errors cannot echo upstream secrets',async()=>{
 const credentials={provider:'silite',username:'19900000001',password:'fictional-provider-password'};
 assert.equal((await req('/api/cgm/connections',{method:'POST',body:credentials})).status,400);
 const bad=await req('/api/cgm/connections',{method:'POST',body:{...credentials,password:'wrong',consent:true}});assert.equal(bad.status,400);assert.ok(!JSON.stringify(bad.body).includes('do-not-expose'));
 const over=await req('/api/cgm/connections',{method:'POST',body:{...credentials,password:'x'.repeat(5000),consent:true}});assert.equal(over.status,413);
 assert.equal((await req('/api/cgm/connections')).body.connections.length,0);
});
test('connect, scoped readings, lifecycle and recovery keep secrets out of APIs/state',async()=>{
 const r=await req('/api/cgm/connections',{method:'POST',body:{provider:'silite',username:'19900000001',password:'fictional-provider-password',consent:true}});assert.equal(r.status,201,JSON.stringify(r.body));const c=r.body.connection;
 assert.equal(c.count,2);assert.ok(c.accountMasked.includes('****'));assert.ok(!JSON.stringify(r.body).includes('fictional-provider-password'));assert.ok(!JSON.stringify(r.body).includes('fictional-cgm-token'));assert.ok(!JSON.stringify(r.body).includes('19900000001'));
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()-3600000));
 const readings=await req('/api/cgm/readings?date='+date);assert.equal(readings.status,200);assert.equal(readings.body.points.length,2);assert.equal(readings.body.points.at(-1).value,5.6);assert.equal(readings.body.owner,r.body.owner);
 assert.deepEqual((await req('/api/cgm/connections',{who:otherCookie})).body.connections,[]);
 assert.equal((await req('/api/cgm/readings?date='+date,{who:otherCookie})).body.points.length,0);
 assert.equal((await req('/api/cgm/connections/'+c.id+'/sync',{method:'POST',who:otherCookie,body:{}})).status,404);
 assert.equal((await req('/api/cgm/connections/'+c.id+'/pause',{method:'POST',body:{}})).body.connection.enabled,false);
 assert.equal((await req('/api/cgm/connections/'+c.id+'/resume',{method:'POST',body:{}})).body.connection.enabled,true);
 assert.ok(!(await req('/api/state')).body.items.some(x=>x.source==='cgm'));
 const backupDir=path.join(dir,'..',path.basename(dir)+'-backups');
 try{
  const backup=spawnSync(process.execPath,['scripts/backup.mjs'],{cwd,env:{...process.env,HEALTH_DATA_DIR:dir,WORKBENCH_BACKUP_DIR:backupDir},encoding:'utf8'});assert.equal(backup.status,0,backup.stderr);
  const snap=path.join(backupDir,(await readdir(backupDir)).find(x=>!x.startsWith('.')));
  assert.deepEqual(await readFile(path.join(snap,'cgm.key')),await readFile(path.join(dir,'cgm.key')));assert.equal((await stat(path.join(snap,'cgm.key'))).mode&0o777,0o600);
  const db=new DatabaseSync(path.join(snap,'health.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM cgm_readings').get().n>=2,true);const body=JSON.stringify(db.prepare('SELECT * FROM cgm_connections').all());assert.ok(!body.includes('fictional-provider-password'));db.close();
  await server.stop();server=await startServer({cwd,env:{...env,HEALTH_DATA_DIR:snap}});base=server.base;
  assert.equal((await req('/api/cgm/connections/'+c.id+'/sync',{method:'POST',body:{}})).status,200);
  await server.stop();server=await startServer({cwd,env});base=server.base;
 }finally{await rm(backupDir,{recursive:true,force:true});}
 await server.stop();server=await startServer({cwd,env});base=server.base;
 assert.equal((await req('/api/cgm/connections')).body.connections[0].id,c.id);
 assert.equal((await req('/api/cgm/connections/'+c.id,{method:'DELETE',body:{}})).body.disconnected,true);
 assert.equal((await req('/api/cgm/connections')).body.connections.length,0);
 assert.equal((await req('/api/cgm/readings?date='+date)).body.points.length>=2,true);
 assert.ok(!server.stderr().includes('fictional-provider-password'));
});
