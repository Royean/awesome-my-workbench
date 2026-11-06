// Browser regression with disposable data. Run with Node 24 and Chrome after npm run build.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {freePort,startServer} from './helpers.mjs';
import {originalPNG} from './originals-fixtures.mjs';

const modulePath=process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const {chromium}=await import(modulePath);
const dir=await mkdtemp(path.join(os.tmpdir(),'medication-image-edit-'));
const email='medication-edit@example.invalid',password='Fictional-medication-edit-93';
let server,browser,base,cookie,owner;
const bytes=originalPNG();

async function api(route,method='GET',body,status=200) {
 const response=await fetch(base+route,{
  method,
  headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie,'X-Workbench-Owner':owner}:{})},
  body:body===undefined?undefined:JSON.stringify(body),
 });
 const result=await response.json();
 assert.equal(response.status,status,JSON.stringify(result));
 return {result,response};
}

try {
 const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',email,'--name','虚构图片编辑测试'],
  {cwd:path.resolve(import.meta.dirname,'..'),input:password+'\n',encoding:'utf8',env:{...process.env,HEALTH_DATA_DIR:dir}});
 assert.equal(setup.status,0,setup.stderr);
 const port=await freePort();
 base='http://127.0.0.1:'+port;
 server=await startServer({env:{NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:base,PORT:String(port),HEALTH_DATA_DIR:dir}});
 const login=await api('/api/auth/login','POST',{email,password});
 cookie=login.response.headers.get('set-cookie').split(';')[0];
 owner=login.result.user.id;
 const {token}=(await api('/api/auth/tokens','POST',{name:'fictional-medication-edit'},201)).result;
 const date='2026-10-01';
 const visit=(await api('/api/items','POST',{kind:'visit',title:'虚构就诊',date,status:'已完成'},201)).result;
 const med=(await api('/api/items','POST',{kind:'medication',title:'虚构药品',date,visitId:visit.id,
  dosage:'按虚构处方记录',route:'口服',frequency:'每日一次',scheduleMode:'scheduled',times:['08:00']},201)).result;
 const upload=async name=>(await api('/api/upload','POST',{name,date,content:bytes.toString('base64'),fileCategory:'药品图片'},201)).result;
 const first=await upload('first.png'),second=await upload('second.png');
 const route='/api/items/'+med.id;

 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext();
 const delimiter=cookie.indexOf('=');
 await context.addCookies([{name:cookie.slice(0,delimiter),value:cookie.slice(delimiter+1),url:base}]);
 await context.addInitScript(()=>{localStorage.setItem('health-space','personal');localStorage.setItem('active-workbench','health');});
 const page=await context.newPage();
 await page.goto(base+'/#visit/medications');
 const form=page.locator('#medical-form');
 const choice=form.locator('[name=imageFileId]');
 const file=form.locator('#medication-image-upload');
 const edit=async ()=>{await page.locator('[data-action="med-edit:'+med.id+'"]').click();await form.waitFor();};
 const current=async ()=> (await api('/api/state')).result.items.find(item=>item.id===med.id);
 const save=async (note,expectedFileId,expectedPayloadFileId)=>{
  await form.locator('[name=note]').fill(note);
  const writing=page.waitForResponse(response=>new URL(response.url()).pathname===route&&response.request().method()==='PUT');
  const reloading=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/state');
  await page.getByRole('button',{name:'保存用药方案',exact:true}).click();
  const response=await writing;
  assert.equal(response.status(),200,await response.text());
  expectedPayloadFileId=await expectedPayloadFileId;
  const body=response.request().postDataJSON();
  assert.equal(Object.hasOwn(body,'imageFileId'),expectedPayloadFileId!==undefined);
  assert.equal(body.imageFileId,expectedPayloadFileId);
  await reloading;
  await form.waitFor({state:'detached'});
  await page.getByText(note,{exact:true}).waitFor();
  const saved=await current();
  assert.equal(saved.imageFileId,await expectedFileId);
  assert.equal(saved.note,note);
  assert.equal(saved.dosage,med.dosage);
  assert.deepEqual(saved.times,med.times);
 };

 await edit();
 assert.equal(await choice.inputValue(),'');
 const rpc=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',
  Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},body:JSON.stringify({
   jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'attach_medication_image',arguments:{medicationId:med.id,fileId:first.id}},
  })});
 assert.equal(rpc.status,200);
 assert.equal((await rpc.json()).result.isError,false);
 await save('旧表单仅编辑备注',first.id,undefined);

 await edit();
 assert.equal(await choice.inputValue(),first.id);
 await api(route,'PUT',{imageFileId:second.id});
 await choice.selectOption(second.id);
 await choice.selectOption(first.id);
 await file.setInputFiles({name:'cancelled.png',mimeType:'image/png',buffer:bytes});
 await file.setInputFiles([]);
 await save('选回原值并取消上传',second.id,undefined);

 await edit();
 await choice.selectOption(first.id);
 await save('主动更换图片',first.id,first.id);

 await edit();
 await form.locator('#med-image-remove').click();
 await save('主动移除图片','', '');

 await edit();
 await file.setInputFiles({name:'new.png',mimeType:'image/png',buffer:bytes});
 const uploadedId=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/upload'&&response.request().method()==='POST')
  .then(async response=>{
   assert.equal(response.status(),201,await response.text());
   const uploaded=await response.json();
   assert.equal(uploaded.name,'new.png');
   return uploaded.id;
  });
 await save('上传新图',uploadedId,uploadedId);
 console.log('PASS medication image edit intent in Chrome');
} finally {
 await browser?.close();
 await server?.stop();
 await rm(dir,{recursive:true,force:true});
}
