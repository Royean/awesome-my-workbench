// Exercise the real HTTP, SQLite and filesystem paths with fictional originals.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readdir,rename,rm,unlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {after,before,test} from 'node:test';
import {freePort,repoRoot,startServer} from './helpers.mjs';
import {originalPNG} from './originals-fixtures.mjs';

const date='2026-10-01', password='Fictional-recovery-passphrase-17';
const email='upload-recovery@example.invalid', otherEmail='upload-recovery-other@example.invalid';
const image=originalPNG();
let dir,uploads,env,server,owner,other;

async function request(route,method='GET',body,session=owner){
 const response=await fetch(server.base+route,{
  method,
  headers:{
   Origin:server.base,
   'Content-Type':'application/json',
   ...(session?{Cookie:session.cookie,'X-Workbench-Owner':session.id}:{}),
  },
  body:body===undefined?undefined:JSON.stringify(body),
 });
 return {status:response.status,headers:response.headers,body:await response.json()};
}

async function login(accountEmail){
 const result=await request('/api/auth/login','POST',{email:accountEmail,password},null);
 assert.equal(result.status,200,JSON.stringify(result.body));
 return {cookie:result.headers.get('set-cookie').split(';')[0],id:result.body.user.id};
}

async function visit(){
 const result=await request('/api/items','POST',{kind:'visit',title:'虚构复诊',status:'已完成',date});
 assert.equal(result.status,201,JSON.stringify(result.body));
 return result.body.id;
}

const intent=overrides=>({
 name:'fictional-package.png',title:'虚构药盒',date,fileCategory:'药品图片',
 content:image.toString('base64'),uploadAttemptId:randomUUID(),...overrides,
});
const upload=(body,query='',session=owner)=>request('/api/upload'+query,'POST',body,session);

before(async()=>{
 dir=await mkdtemp(path.join(os.tmpdir(),'medication-upload-recovery-'));
 uploads=path.join(dir,'uploads');
 const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','Fictional upload tester'],{
  cwd:repoRoot,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir},
 });
 assert.equal(setup.status,0,setup.stderr);
 const port=await freePort();
 env={NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir};
 server=await startServer({env});
 owner=await login(email);
 const invite=await request('/api/auth/invitations','POST',{email:otherEmail,name:'Fictional other account'});
 assert.equal(invite.status,201);
 assert.equal((await request('/api/auth/accept-invitation','POST',{token:invite.body.token,password},null)).status,200);
 other=await login(otherEmail);
});

after(async()=>{
 await server?.stop();
 if(dir)await rm(dir,{recursive:true,force:true});
});

test('concurrent upload and replay after restart produce one original and one disk file',async()=>{
 const body=intent({visitId:await visit()});
 const beforeFiles=await readdir(uploads);
 const responses=await Promise.all(Array.from({length:8},()=>upload(body)));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,200,200,200,200,200,200,201]);
 const created=responses.find(r=>r.status===201).body;
 for(const response of responses)assert.deepEqual(response.body,created);
 assert.equal(created.uploadAttemptId,undefined);
 await server.stop();
 server=await startServer({env});
 const replay=await upload(body);
 assert.equal(replay.status,200);
 assert.deepEqual(replay.body,created);
 const state=await request('/api/state');
 assert.equal(state.body.items.filter(item=>item.kind==='file'&&item.visitId===body.visitId).length,1);
 assert.deepEqual((await readdir(uploads)).filter(name=>!beforeFiles.includes(name)),[created.storageName]);
 const download=await fetch(server.base+'/api/files/'+created.id,{headers:{Cookie:owner.cookie}});
 assert.equal(download.status,200);
 assert.deepEqual(Buffer.from(await download.arrayBuffer()),image);
});

test('the same key conflicts within a scope and is independent across scopes',async()=>{
 const body=intent({visitId:await visit()});
 const otherImage='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 const created=await upload(body);
 assert.equal(created.status,201);
 for(const change of [{title:'另一上传'},{visitId:await visit()},{date:'2026-10-02'},{name:'replacement.png'},{content:otherImage}]){
  const response=await upload({...body,...change});
  assert.equal(response.status,409);
  assert.equal(response.body.code,'upload_attempt_conflict');
 }
 const scopeBody={...body,visitId:undefined};
 const elsewhere=await Promise.all([
  upload(scopeBody,'?space=demo'),
  upload(scopeBody,'?workbench=finance'),
  upload(scopeBody,'',other),
 ]);
 assert.deepEqual(elsewhere.map(r=>r.status),[201,201,201]);
 assert.equal(new Set([created,...elsewhere].map(r=>r.body.id)).size,4);
 const badKey=await upload({...body,uploadAttemptId:'not-a-uuid'});
 assert.equal(badKey.status,400);
 assert.equal(badKey.body.field,'uploadAttemptId');
 const ordinary=await upload({...body,fileCategory:undefined});
 assert.equal(ordinary.status,400);
 assert.equal(ordinary.body.field,'uploadAttemptId');
 const newAttempt=await upload({...body,uploadAttemptId:randomUUID()});
 assert.equal(newAttempt.status,201);
 assert.notEqual(newAttempt.body.id,created.body.id);
 const legacy={...scopeBody,name:'fictional-ordinary.txt',fileCategory:undefined,uploadAttemptId:undefined};
 const oldClient=await Promise.all([upload(legacy),upload(legacy)]);
 assert.deepEqual(oldClient.map(r=>r.status),[201,201]);
 assert.notEqual(oldClient[0].body.id,oldClient[1].body.id);
});

test('failed storage can retry, while a removed or missing original is never recreated',async()=>{
 const body=intent();
 const invalid=await upload({...body,date:'12345-10-01'});
 assert.equal(invalid.status,400);
 assert.equal(invalid.body.field,'date');
 const unavailableDirectory=uploads+'-temporarily-unavailable';
 await rename(uploads,unavailableDirectory);
 try{
  const response=await upload(body);
  assert.equal(response.status,500);
 }finally{
  await rename(unavailableDirectory,uploads);
 }
 const retried=await upload(body);
 assert.equal(retried.status,201,JSON.stringify(retried.body));
 assert.equal((await upload(body)).body.id,retried.body.id);

 const missingBody=intent(), missing=await upload(missingBody);
 assert.equal(missing.status,201);
 await unlink(path.join(uploads,missing.body.storageName));
 assert.equal((await request('/api/items/'+retried.body.id,'DELETE')).status,200);
 const filesBeforeReplay=await readdir(uploads);
 for(const payload of [body,missingBody]){
  const response=await upload(payload);
  assert.equal(response.status,409);
  assert.equal(response.body.code,'upload_attempt_unavailable');
 }
 assert.deepEqual(await readdir(uploads),filesBeforeReplay);
});

test('a deleted visit rejects uploads and identifies the visit field for medication images',async()=>{
 const body=intent({visitId:await visit()});
 assert.equal((await request('/api/items/'+body.visitId,'DELETE')).status,200);
 const filesBefore=await readdir(uploads);

 const medication=await upload(body);
 assert.equal(medication.status,400);
 const rejection={error:'关联就诊记录不存在',code:'validation_failed'};
 assert.deepEqual(medication.body,{...rejection,field:'visitId'});

 const ordinary=await upload({...body,fileCategory:undefined,uploadAttemptId:undefined});
 assert.equal(ordinary.status,400);
 assert.deepEqual(ordinary.body,rejection);
 assert.deepEqual(await readdir(uploads),filesBefore);
});
