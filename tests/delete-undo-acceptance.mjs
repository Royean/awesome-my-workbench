// Engineering browser check; run with PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startServer,waitFor} from './helpers.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'shared-delete-undo-'));
const shots=process.env.SHOT_DIR||dir;await mkdir(shots,{recursive:true});
const server=await startServer({env:{HEALTH_DATA_DIR:dir}});
const browser=await chromium.launch({channel:'chrome',headless:true});
const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const api=async(path,method='GET',body)=>{const r=await fetch(server.base+path+'?space=personal&workbench=health',{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(r.ok);return r.json();};
try{
 const today=(await api('/api/state')).today;
 const original=await api('/api/items','POST',{kind:'task',title:'虚构工程撤销烟测',date:today,note:'仅隔离数据库',done:false});
 await page.addInitScript(()=>{localStorage.setItem('health-space','personal');localStorage.setItem('active-workbench','health');});
 await page.goto(server.base+'/#dashboard/tasks');
 await page.locator(`[data-action="delete:${original.id}"]`).click();
 assert.match(await page.locator('.drawer').innerText(),/12秒内可以撤销/);
 assert.match(await page.locator('.drawer').innerText(),/工作台设置/);
 await page.screenshot({path:path.join(shots,'delete-confirm-390.png')});
 let deleteRequests=0;
 await page.route('**/api/items/'+original.id+'?*',async route=>{
  if(route.request().method()!=='DELETE')return route.continue();
  deleteRequests++;
  if(deleteRequests===1)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'虚构暂时错误，请重试'})});
  const response=await route.fetch();await new Promise(r=>setTimeout(r,500));await route.fulfill({response});
 });
 const confirm=page.locator(`[data-action="confirm-delete:${original.id}"]`);
 await confirm.click();await page.getByText('虚构暂时错误，请重试',{exact:true}).waitFor();
 assert.equal(await confirm.isEnabled(),true,'failed request allows retry');
 assert.equal((await api('/api/state')).items.some(x=>x.id===original.id),true);
 let delay=true,stateStarted=false;
 await page.route('**/api/state?*',async route=>{
  if(delay){delay=false;stateStarted=true;const response=await route.fetch();await new Promise(r=>setTimeout(r,6000));await route.fulfill({response});}
  else await route.continue();
 });
 const at=Date.now();await confirm.dblclick({delay:50});
 assert.equal(await confirm.isDisabled(),true,'pending button blocks the second native click');
 await page.locator('#toast [data-action="undo"]').waitFor();
 assert.ok(Date.now()-at<1500,'undo appears before the delayed refresh');
 await waitFor(()=>stateStarted);
 await page.waitForTimeout(Math.max(0,9000-(Date.now()-at)));
 assert.equal(await page.locator('#toast [data-action="undo"]').isVisible(),true);
 await page.screenshot({path:path.join(shots,'delete-undo-9s-390.png')});
 await page.locator('#toast [data-action="undo"]').click();
 await waitFor(async()=> (await api('/api/state')).items.some(x=>x.id===original.id));
 assert.deepEqual((await api('/api/state')).items.find(x=>x.id===original.id),original);
 assert.equal(deleteRequests,2,'one failed request plus one successful retry; double click sends one DELETE');
 const navigation=await api('/api/items','POST',{kind:'task',title:'虚构待删除导航烟测',date:today,done:false});
 await page.goto(server.base+'/#dashboard/tasks');await page.locator(`[data-action="delete:${navigation.id}"]`).click();
 let delivered;const delivery=new Promise(resolve=>delivered=resolve);
 await page.route('**/api/items/'+navigation.id+'?*',async route=>{
  const response=await route.fetch();await new Promise(r=>setTimeout(r,1800));await route.fulfill({response});delivered();
 });
 await page.locator(`[data-action="confirm-delete:${navigation.id}"]`).click();
 await page.locator('.drawer-head [data-action="close"]').click();
 await page.locator('.bottom-tabs [data-action="nav:dashboard"]').click();
 assert.equal((await page.locator('#app').innerText()).includes(navigation.title),true,'new page initially renders the pending record');
 await delivery;
 await waitFor(async()=>!(await page.locator('#app').innerText()).includes(navigation.title),{message:'same-source navigation must refresh the completed deletion'});
 assert.equal(await page.locator('#toast [data-action="undo"]').isVisible(),false,'navigation keeps the old undo dismissed');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'passed',viewport:'390x844',refreshDelayMs:6000,failedDeleteRetry:true,doubleClickDeleteRequests:deleteRequests-1,undoAtNineSeconds:true,businessFieldsPreserved:true,sameSourceNavigationRefresh:true,pageErrors:errors}));
}finally{await browser.close();await server.stop();await rm(dir,{recursive:true,force:true});}
