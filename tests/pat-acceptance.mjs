// Personal access token UI acceptance (390x844): create → one-time reveal → copy → confirmed close → revoke confirmation.
// Needs Playwright (PLAYWRIGHT_MODULE may point at an external install). Screenshots go to PAT_SHOT_DIR (default docs/).
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const cwd=path.resolve(import.meta.dirname,'..'),base='http://127.0.0.1:3297',password=randomBytes(24).toString('base64url'),dir=await mkdtemp(path.join(os.tmpdir(),'pat-acceptance-')),shots=process.env.PAT_SHOT_DIR||path.join(cwd,'docs');
let proc,browser;const checks=[];const pass=x=>{checks.push(x);console.log('PASS '+x)};
const minTap=async loc=>{for(const el of await loc.all()){if(!await el.isVisible())continue;const b=await el.boundingBox();assert.ok(b.height>=48,`tap target ${await el.textContent()} is ${b.height}px`);}};
try{
 const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email','pat@example.invalid','--name','令牌验收'],{cwd,input:password+'\n',env:{...process.env,HEALTH_DATA_DIR:dir},encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);
 proc=spawn(process.execPath,['server.mjs'],{cwd,env:{...process.env,NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:base,PORT:'3297',HEALTH_DATA_DIR:dir},stdio:'pipe'});for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 browser=await chromium.launch({headless:true,channel:process.env.PW_CHANNEL||'chrome'});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
 const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base);await p.locator('[name=email]').fill('pat@example.invalid');await p.locator('[name=password]').fill(password);await p.getByRole('button',{name:'登录',exact:true}).click();await p.locator('.bottom-tabs').waitFor();
 await p.locator('.bottom-tabs [data-action="nav:mine"]').click();await p.locator('[data-action="account-open"]').click();
 const section=p.locator('.account-section').filter({has:p.getByRole('heading',{name:'个人访问令牌'})});await section.waitFor();await section.getByText('还没有个人访问令牌。').waitFor();
 assert.equal(await section.locator('[name=name]').getAttribute('placeholder'),'例如：Codex');pass('我的 → 账号与安全 → 个人访问令牌，名称占位「例如：Codex」');
 for(const name of ['Claude','Codex']){await section.locator('[name=name]').fill(name);await section.getByRole('button',{name:'生成令牌'}).click();await section.getByText('只显示这一次').waitFor();
  if(name==='Claude'){await section.locator('[data-dismiss-token]').click();await section.getByRole('button',{name:'已保存，关闭'}).click();await section.locator('.account-token-reveal').waitFor({state:'detached'});}}
 const reveal=section.locator('.account-token-reveal');const token=await reveal.getByRole('textbox',{name:'个人访问令牌'}).inputValue();assert.match(token,/^zh_pat_/);
 const copy=reveal.getByRole('button',{name:'复制'});assert.equal(Math.round((await copy.boundingBox()).height),48);await minTap(section.locator('button,input'));
 await section.locator('.account-row').first().waitFor();await p.waitForTimeout(200);await section.scrollIntoViewIfNeeded();await reveal.scrollIntoViewIfNeeded();await p.screenshot({path:path.join(shots,'pat-reveal.png')});
 await copy.click();await reveal.getByRole('button',{name:'已复制'}).waitFor();assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),token);pass('一次性展示「只显示这一次」，48px「复制」→「已复制」，剪贴板正确');
 await reveal.locator('[data-dismiss-token]').click();await reveal.getByText('确定已保存？关闭后无法再次查看').waitFor();await reveal.getByRole('button',{name:'返回'}).click();assert.equal(await reveal.isVisible(),true);
 await reveal.locator('[data-dismiss-token]').click();await reveal.getByRole('button',{name:'已保存，关闭'}).click();await reveal.waitFor({state:'detached'});assert.equal(await p.getByText(token).count(),0);pass('关闭展示需二次确认，返回可取消');
 const rows=section.locator('.account-token-item');assert.equal(await rows.count(),2);const first=rows.first();await first.getByText('创建时间').waitFor();await first.getByText('最近使用时间').waitFor();await first.getByText('从未使用').waitFor();await minTap(section.locator('button,input'));
 await section.scrollIntoViewIfNeeded();await rows.first().scrollIntoViewIfNeeded();await p.screenshot({path:path.join(shots,'pat-list.png')});pass('列表显示名称、创建时间、最近使用时间');
 const authed=await fetch(base+'/api/state',{headers:{Authorization:'Bearer '+token}});assert.equal(authed.status,200);
 await first.getByRole('button',{name:/吊销/}).click();const confirm=first.locator('.account-confirm');await confirm.getByText('吊销后用这个令牌的助手会立刻断开').waitFor();
 const ok=confirm.getByRole('button',{name:'确认吊销'});const [bg,err]=await ok.evaluate(el=>[getComputedStyle(el).backgroundColor,(()=>{const d=document.createElement('i');d.style.color='var(--error)';document.body.append(d);const c=getComputedStyle(d).color;d.remove();return c})()]);assert.equal(bg,err);await minTap(confirm.locator('button'));
 await confirm.scrollIntoViewIfNeeded();await p.screenshot({path:path.join(shots,'pat-revoke-confirm.png')});
 await confirm.getByRole('button',{name:'取消'}).click();assert.equal(await rows.count(),2);
 await first.getByRole('button',{name:/吊销/}).click();await first.getByRole('button',{name:'确认吊销'}).click();await p.waitForFunction(()=>document.querySelectorAll('.account-token-item').length===1);
 assert.equal((await fetch(base+'/api/state',{headers:{Authorization:'Bearer '+token}})).status,401);pass('吊销二次确认（--error 色确认按钮），取消保留，确认后令牌立即 401');
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);pass('390px 无横向溢出、无未捕获错误');
 console.log(`RESULT ${checks.length} checks passed`);
}finally{await browser?.close();if(proc?.exitCode===null){proc.kill();await new Promise(r=>proc.once('exit',r))}await rm(dir,{recursive:true,force:true})}
