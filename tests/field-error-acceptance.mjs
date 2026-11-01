// Headless check (not part of npm test): a field-scoped API error opens the collapsed
// 「时间与备注」 details, appears under the date input in var(--error), keeps entered values, no dialog.
// Run: PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.mjs node tests/field-error-acceptance.mjs
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startServer} from './helpers.mjs';
const MESSAGE='日期格式不对，请按 2026-11-01 这样填写';
const dir=await mkdtemp(path.join(os.tmpdir(),'field-error-'));const server=await startServer({env:{HEALTH_DATA_DIR:dir}});
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 for(const kind of ['meal','exercise']){
  const page=await browser.newPage({viewport:{width:390,height:844}});let dialogs=0;page.on('dialog',d=>{dialogs++;d.dismiss()});
  // Browsers sanitize <input type=date>, so the server's field error is simulated at the network layer.
  await page.route(/\/api\/capture-meal(\?|$)/,r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:MESSAGE,field:'date'})}));
  await page.route(/\/api\/items(\?|$)/,r=>r.request().method()==='POST'?r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:MESSAGE,field:'date'})}):r.continue());
  await page.goto(server.base+'/');await page.click(`[data-action="qc-open:${kind}"]`);
  const form=page.locator('#capture-form');await form.waitFor();
  const details=form.locator('details:has([name="date"])');assert.equal(await details.evaluate(d=>d.open),false,'details starts collapsed');
  if(kind==='meal')await form.locator('[name="text"]').fill('虚构午餐');else await form.locator('[name="duration"]').first().fill('30');
  const note=form.locator('details [name="note"]');if(await note.count())await note.evaluate(n=>{n.value='保留的备注'});
  await page.click('#capture-save');
  const err=form.locator('[name="date"] + .field-error');await err.waitFor({timeout:5000});
  assert.equal(await err.textContent(),MESSAGE);assert.equal(await details.evaluate(d=>d.open),true,kind+' details opened');
  assert.equal(await err.evaluate(e=>getComputedStyle(e).color),'rgb(159, 76, 58)');
  assert.equal(await page.evaluate(()=>document.activeElement?.name),'date');
  if(kind==='meal')assert.equal(await form.locator('[name="text"]').inputValue(),'虚构午餐');
  if(await note.count())assert.equal(await note.inputValue(),'保留的备注');
  assert.equal(dialogs,0);console.log('ok',kind);await page.close();
 }
}finally{await browser.close();await server.stop();await rm(dir,{recursive:true,force:true});}
