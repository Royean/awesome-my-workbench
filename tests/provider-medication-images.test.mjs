// Integration coverage uses disposable storage and fictional accounts only.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {startServer,freePort} from './helpers.mjs';
import {originalJPEG,originalPDF,originalPNG,originalWebP} from './originals-fixtures.mjs';
const cwd=path.resolve(import.meta.dirname,'..'),password='Fictional-image-passphrase-93',email='images@example.invalid';
let dir,server,base,cookie,token,otherCookie,otherToken,env;
const owners=new Map();
async function req(route,{method='GET',body,who=cookie}={}){const r=await fetch(base+route,{method,headers:{...(who?{Cookie:who}:{}),Origin:base,'Content-Type':'application/json','X-Workbench-Owner':owners.get(who)||''},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),headers:r.headers};}
async function login(e,p){const r=await req('/api/auth/login',{method:'POST',body:{email:e,password:p},who:''});assert.equal(r.status,200);const ck=r.headers.get('set-cookie').split(';')[0];owners.set(ck,r.body.user.id);return ck;}
async function mint(who){return (await req('/api/auth/tokens',{method:'POST',body:{name:'images-test'},who})).body.token;}
async function rpc(name,args={},t=token){const r=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(r.status,200);return (await r.json()).result;}
async function create(kind,body={}){const r=await req('/api/items',{method:'POST',body:{kind,date:'2026-10-01',...body}});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
function uploadFile(name,bytes,fileCategory,query='',who=cookie){
 return req('/api/upload'+query,{method:'POST',who,body:{name,content:bytes.toString('base64'),date:'2026-10-01',fileCategory}});
}
async function upload(name='虚构药盒.png',query='',who=cookie){
 const fixture={'.png':originalPNG,'.jpg':originalJPEG,'.pdf':originalPDF}[path.extname(name)];
 const isImage=/\.(png|jpg)$/.test(name);
 const r=await uploadFile(name,fixture?fixture():Buffer.from('fictional fixture only'),isImage?'药品图片':'一般资料',query,who);
 assert.equal(r.status,201,JSON.stringify(r.body));return r.body;
}
function uploadMcp(name,content){
 return rpc('upload_attachment',{name,contentBase64:content.toString('base64'),sha256:createHash('sha256').update(content).digest('hex')});
}
async function medication(visitId,extra={}){return create('medication',{title:'虚构测试药',visitId,dosage:'1片',route:'口服',frequency:'每日一次',scheduleMode:'scheduled',times:['08:00'],...extra});}
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'provider-images-'));const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','Fictional image tester'],{cwd,input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});assert.equal(setup.status,0,setup.stderr);const port=await freePort();env={NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:`http://127.0.0.1:${port}`,PORT:String(port),HEALTH_DATA_DIR:dir};server=await startServer({cwd,env});base=server.base;cookie=await login(email,password);token=await mint(cookie);const invite=await req('/api/auth/invitations',{method:'POST',body:{email:'images-other@example.invalid',name:'Fictional other'}});assert.equal(invite.status,201);assert.equal((await req('/api/auth/accept-invitation',{method:'POST',body:{token:invite.body.token,password},who:''})).status,200);otherCookie=await login('images-other@example.invalid',password);otherToken=await mint(otherCookie);});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});

test('visit city and institution ID stay explicit, validated, scoped and durable',async()=>{const visit=await create('visit',{title:'虚构就诊',status:'已完成',hospital:'虚构连锁门诊',hospitalId:' future-clinic_1 ',city:' 深圳 '});assert.equal(visit.city,'深圳');assert.equal(visit.hospitalId,'future-clinic_1');const custom=await create('visit',{title:'自定义',status:'已完成',hospital:'虚构门诊'});assert.equal(custom.city,'');assert.equal(custom.hospitalId,'');for(const patch of [{city:'城'.repeat(101)},{city:123},{hospitalId:'bad/id'}])assert.equal((await req('/api/items/'+visit.id,{method:'PUT',body:patch})).status,400);const m=await rpc('update_record',{id:visit.id,city:'广州',hospitalId:'future.clinic-2'});assert.equal(m.isError,false);assert.equal(m.structuredContent.updated.city,'广州');assert.equal((await rpc('create_record',{kind:'note',title:'bad',city:'广州'})).isError,true);assert.equal((await rpc('create_record',{kind:'medication',title:'bad',hospitalId:'x'})).isError,true);await server.stop();server=await startServer({cwd,env});base=server.base;const stored=(await req('/api/state')).body.items.find(x=>x.id===visit.id);assert.equal(stored.city,'广州');assert.equal(stored.hospitalId,'future.clinic-2');assert.equal(stored.hospital,'虚构连锁门诊');assert.ok(!(await req('/api/state',{who:otherCookie})).body.items.some(x=>x.id===visit.id));});

test('web image binding validates MIME and account/space/workbench scope, preserving prescription',async()=>{const v=await create('visit',{title:'图片测试就诊',status:'已完成'});const image=await upload(),pdf=await upload('原件.pdf');const m=await medication(v.id,{imageFileId:image.id});assert.equal(m.imageFileId,image.id);assert.equal((await req('/api/upload?workbench=finance',{method:'POST',body:{name:'金融.png',content:'eA=='}})).status,201);assert.equal((await req('/api/items/'+m.id+'?workbench=finance',{method:'PUT',body:{imageFileId:image.id}})).status,404);assert.equal(m.dosage,'1片');for(const badId of [pdf.id,(await upload('原始语音.webm')).id,'missing',(await upload('别人.png','',otherCookie)).id,(await upload('示例.png','?space=demo')).id])assert.equal((await req('/api/items/'+m.id,{method:'PUT',body:{imageFileId:badId}})).status,400);assert.equal((await req('/api/items/'+m.id,{method:'PUT',body:{imageFileId:image.id},who:otherCookie})).status,404);assert.equal((await req('/api/items/'+m.id,{method:'PUT',body:{imageFileId:7}})).status,400);const edit=await req('/api/items/'+m.id,{method:'PUT',body:{note:'核对图片'}});assert.equal(edit.body.dosage,'1片');assert.deepEqual(edit.body.times,['08:00']);assert.equal((await req('/api/items/'+m.id,{method:'PUT',body:{imageFileId:null}})).body.imageFileId,'');});

test('MCP image tool is append-only, idempotent, private and shares web validation',async()=>{const v=await create('visit',{title:'助手图片测试',status:'已完成'}),m=await medication(v.id);const up=await uploadMcp('药盒.webp',originalWebP());assert.equal(up.isError,false);const fileId=up.structuredContent.uploaded.id;const first=await rpc('attach_medication_image',{medicationId:m.id,fileId});assert.equal(first.isError,false);assert.deepEqual(first.structuredContent.updated.image,{name:'药盒.webp',type:'image/webp'});assert.equal(first.structuredContent.updated.imageFileId,undefined);assert.doesNotMatch(JSON.stringify(first.structuredContent),/storageName|contentBase64/);assert.deepEqual((await rpc('attach_medication_image',{medicationId:m.id,fileId})).structuredContent,first.structuredContent);assert.equal(first.structuredContent.updated.dosage,'1片');assert.deepEqual(first.structuredContent.updated.times,['08:00']);const different=await upload('另一张.jpg');assert.equal((await rpc('attach_medication_image',{medicationId:m.id,fileId:different.id})).isError,true);assert.equal((await rpc('attach_medication_image',{medicationId:m.id,fileId},otherToken)).isError,true);assert.equal((await rpc('attach_medication_image',{medicationId:m.id,fileId,space:'demo'})).isError,true);assert.equal((await rpc('attach_medication_image',{medicationId:m.id,fileId,workbench:'finance'})).isError,true);const blank=await medication(v.id),pdf=await upload('拒绝.pdf');assert.equal((await rpc('attach_medication_image',{medicationId:blank.id,fileId:pdf.id})).isError,true);const audio=await upload('语音.ogg');assert.equal((await rpc('attach_medication_image',{medicationId:blank.id,fileId:audio.id})).isError,true);for(const name of ['create_record','update_record']){const args=name==='create_record'?{kind:'medication',title:'bad'}:{id:m.id};for(const key of ['imageFileId','image','attachmentIds'])assert.equal((await rpc(name,{...args,[key]:fileId})).isError,true);}const listed=(await rpc('list_records',{kind:'medication'})).structuredContent.records.find(x=>x.id===m.id);assert.deepEqual(listed.image,first.structuredContent.updated.image);assert.equal(listed.imageFileId,undefined);assert.equal((await req('/api/items/'+fileId,{method:'DELETE'})).status,200);const edited=await req('/api/items/'+m.id,{method:'PUT',body:{note:'图片已删除，保留历史'}});assert.equal(edited.status,200);assert.equal(edited.body.imageFileId,fileId);const mc=await rpc('update_record',{id:m.id,note:'助手核对历史'});assert.equal(mc.isError,false);assert.equal(mc.structuredContent.updated.image,null);assert.equal(mc.structuredContent.updated.dosage,'1片');assert.equal((await req('/api/items/'+blank.id,{method:'PUT',body:{imageFileId:fileId}})).status,400);});

test('spoofed medication images fail before upload or association writes',async()=>{
 const visit=await create('visit',{title:'药品图片内容测试',status:'已完成'});
 const image=await upload();
 const existing=await medication(visit.id,{imageFileId:image.id});
 const blank=await medication(visit.id);
 const uploads=path.join(dir,'uploads');
 const state=async()=>(await req('/api/state')).body.items;
 const originalItems=await state();
 const originalFiles=(await readdir(uploads)).sort();
 const pdf=originalPDF();
 for(const [name,bytes] of [['冒充.png',pdf],['冒充.jpg',Buffer.from('arbitrary content')],['冒充.webp',originalPNG()],['真实原件.pdf',pdf]]){
  const rejected=await uploadFile(name,bytes,'药品图片');
  assert.equal(rejected.status,400,JSON.stringify(rejected.body));
  assert.equal(rejected.body.field,'content');
 }
 assert.deepEqual(await state(),originalItems);
 assert.deepEqual((await readdir(uploads)).sort(),originalFiles);

 const ordinary=await uploadFile('普通资料.png',pdf,'一般资料');
 assert.equal(ordinary.status,201,JSON.stringify(ordinary.body));
 const mcpUpload=await uploadMcp('助手原件.png',pdf);
 assert.equal(mcpUpload.isError,false);
 const snapshot=await state();
 const files=(await readdir(uploads)).sort();
 for(const fileId of [ordinary.body.id,mcpUpload.structuredContent.uploaded.id]){
  const created=await req('/api/items',{method:'POST',body:{...blank,imageFileId:fileId}});
  assert.equal(created.status,400,JSON.stringify(created.body));
  assert.equal(created.body.field,'imageFileId');
  const replaced=await req('/api/items/'+existing.id,{method:'PUT',body:{imageFileId:fileId,note:'替换失败不应修改备注'}});
  assert.equal(replaced.status,400,JSON.stringify(replaced.body));
  assert.equal(replaced.body.field,'imageFileId');
  const attached=await rpc('attach_medication_image',{medicationId:blank.id,fileId});
  assert.equal(attached.isError,true);
  assert.match(JSON.stringify(attached),/药品图片内容与文件格式不符/);
 }
 assert.deepEqual(await state(),snapshot);
 assert.deepEqual((await readdir(uploads)).sort(),files);

 const replacement=await upload('真实更换.jpg');
 const replaced=await req('/api/items/'+existing.id,{method:'PUT',body:{imageFileId:replacement.id}});
 assert.equal(replaced.status,200);
 assert.equal(replaced.body.imageFileId,replacement.id);
 assert.equal(replaced.body.dosage,existing.dosage);
 assert.deepEqual(replaced.body.times,existing.times);
});

test('unrelated prescription edits preserve a legacy image association with invalid bytes',async()=>{
 const visit=await create('visit',{title:'历史处方测试',status:'已完成'});
 const image=await upload();
 const linked=await medication(visit.id,{imageFileId:image.id});
 // Simulate an existing association written before byte validation, in disposable storage.
 await writeFile(path.join(dir,'uploads',image.storageName),originalPDF());
 const edited=await req('/api/items/'+linked.id,{method:'PUT',body:{imageFileId:image.id,note:'仅核对历史用药'}});
 assert.equal(edited.status,200,JSON.stringify(edited.body));
 assert.equal(edited.body.imageFileId,image.id);
 const mcpEdit=await rpc('update_record',{id:linked.id,note:'助手仅修改备注'});
 assert.equal(mcpEdit.isError,false);
 const stored=(await req('/api/state')).body.items.find(item=>item.id===linked.id);
 assert.equal(stored.imageFileId,image.id);
 assert.equal(stored.dosage,linked.dosage);
 assert.deepEqual(stored.times,linked.times);
 assert.equal(stored.note,'助手仅修改备注');
});
