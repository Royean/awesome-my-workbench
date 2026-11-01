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
const lum=c=>{const v=c.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.03928?x/12.92:((x+.055)/1.055)**2.4});return .2126*v[0]+.7152*v[1]+.0722*v[2]};const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05)};
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
 await section.getByRole('button',{name:'生成令牌'}).click();await section.getByText('请填写名称').waitFor();assert.equal(await section.locator('[name=name]').evaluate(el=>el===document.activeElement),true);await section.locator('[name=name]').fill('x');assert.equal(await section.getByText('请填写名称').isVisible(),false);await section.locator('[name=name]').fill('');pass('空名称 → 字段下「请填写名称」并聚焦');
 for(const name of ['Claude','Codex']){await section.locator('[name=name]').fill(name);await section.getByRole('button',{name:'生成令牌'}).click();await section.getByText('只显示这一次').waitFor();
  if(name==='Claude'){await section.locator('[data-dismiss-token]').click();await section.getByRole('button',{name:'已保存，关闭'}).click();await section.locator('.account-token-reveal').waitFor({state:'detached'});}}
 const reveal=section.locator('.account-token-reveal');const token=await reveal.getByRole('textbox',{name:'个人访问令牌'}).inputValue();assert.match(token,/^zh_pat_/);
 assert.equal(await reveal.getByRole('textbox',{name:'个人访问令牌'}).evaluate(el=>el===document.activeElement),true);pass('生成后焦点移到令牌');
 const note=reveal.locator('.account-token-note');const [fg,nbg]=await note.evaluate(el=>[getComputedStyle(el).color,getComputedStyle(el.closest('.account-invitation')).backgroundColor]);assert.ok(ratio(fg,nbg)>=4.5,`contrast ${ratio(fg,nbg)}`);pass(`「关闭后无法再次查看」对比度 ${ratio(fg,nbg).toFixed(2)}:1 ≥ 4.5`);
 const copy=reveal.getByRole('button',{name:'复制'});assert.equal(Math.round((await copy.boundingBox()).height),48);await minTap(section.locator('button,input'));
 await section.locator('.account-row').first().waitFor();await p.waitForTimeout(200);await section.scrollIntoViewIfNeeded();await reveal.scrollIntoViewIfNeeded();await p.screenshot({path:path.join(shots,'pat-reveal.png')});
 await copy.click();await reveal.getByRole('button',{name:'已复制'}).waitFor();assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),token);pass('一次性展示「只显示这一次」，48px「复制」→「已复制」，剪贴板正确');
 await p.waitForTimeout(2300);await reveal.getByRole('button',{name:'复制',exact:true}).waitFor();pass('「已复制」2 秒后恢复「复制」');
 await p.keyboard.press('Escape');await reveal.getByText('确定已保存？关闭后无法再次查看').waitFor();assert.equal(await p.locator('.drawer').count(),1);await reveal.getByRole('button',{name:'返回'}).click();
 await p.locator('.drawer-head [data-action="close"]').click();await reveal.getByText('确定已保存？关闭后无法再次查看').waitFor();assert.equal(await p.locator('.drawer').count(),1);await reveal.getByRole('button',{name:'返回'}).click();
 await p.goBack();await reveal.getByText('确定已保存？关闭后无法再次查看').waitFor();assert.equal(await p.locator('.drawer').count(),1);await reveal.getByRole('button',{name:'返回'}).click();assert.equal(await reveal.isVisible(),true);
 pass('展示中 Esc / 右上角 × / 浏览器返回 均需「确定已保存？」确认，返回可取消');
 await reveal.locator('[data-dismiss-token]').click();await reveal.getByText('确定已保存？关闭后无法再次查看').waitFor();await reveal.getByRole('button',{name:'返回'}).click();assert.equal(await reveal.isVisible(),true);
 await reveal.locator('[data-dismiss-token]').click();await reveal.getByRole('button',{name:'已保存，关闭'}).click();await reveal.waitFor({state:'detached'});assert.equal(await p.getByText(token).count(),0);pass('关闭展示需二次确认，返回可取消');
 const rows=section.locator('.account-token-item');assert.equal(await rows.count(),2);const first=rows.first();await first.getByText('创建时间').waitFor();await first.getByText('最近使用时间').waitFor();await first.getByText('从未使用').waitFor();await minTap(section.locator('button,input'));
 await section.scrollIntoViewIfNeeded();await rows.first().scrollIntoViewIfNeeded();await p.screenshot({path:path.join(shots,'pat-list.png')});assert.equal((await first.locator('.account-token-tail').textContent()),'…'+token.slice(-4));pass('列表显示名称、令牌尾号（…'+token.slice(-4)+'）、创建时间、最近使用时间');
 const authed=await fetch(base+'/api/state',{headers:{Authorization:'Bearer '+token}});assert.equal(authed.status,200);
 await first.getByRole('button',{name:/吊销/}).click();const confirm=first.locator('.account-confirm');await confirm.getByText('吊销后用这个令牌的助手会立刻断开').waitFor();
 const ok=confirm.getByRole('button',{name:'确认吊销'});const [bg,err]=await ok.evaluate(el=>[getComputedStyle(el).backgroundColor,(()=>{const d=document.createElement('i');d.style.color='var(--error)';document.body.append(d);const c=getComputedStyle(d).color;d.remove();return c})()]);assert.equal(bg,err);assert.equal(await confirm.locator('p').evaluate(el=>getComputedStyle(el).color),err);await minTap(confirm.locator('button'));
 await confirm.scrollIntoViewIfNeeded();await p.screenshot({path:path.join(shots,'pat-revoke-confirm.png')});
 await confirm.getByRole('button',{name:'取消'}).click();assert.equal(await rows.count(),2);
 await first.getByRole('button',{name:/吊销/}).click();await first.getByRole('button',{name:'确认吊销'}).click();await p.waitForFunction(()=>document.querySelectorAll('.account-token-item').length===1);
 assert.equal((await fetch(base+'/api/state',{headers:{Authorization:'Bearer '+token}})).status,401);pass('吊销二次确认（--error 色确认按钮），取消保留，确认后令牌立即 401');
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);pass('390px 无横向溢出、无未捕获错误');
 const desk=await browser.newContext({viewport:{width:1280,height:800}});const d=await desk.newPage();await d.goto(base);await d.locator('[name=email]').fill('pat@example.invalid');await d.locator('[name=password]').fill(password);await d.getByRole('button',{name:'登录',exact:true}).click();
 const entry=d.locator('.sidebar [data-desktop-account]');await entry.waitFor();assert.equal(await entry.isVisible(),true);await entry.click();const ds=d.locator('.account-section').filter({has:d.getByRole('heading',{name:'个人访问令牌'})});await ds.waitFor();
 await ds.locator('[name=name]').fill('Desk');await ds.getByRole('button',{name:'生成令牌'}).click();await ds.getByText('只显示这一次').waitFor();await d.keyboard.press('Escape');await ds.getByRole('button',{name:'已保存，关闭'}).click();await d.locator('.drawer').waitFor({state:'detached'});
 await d.screenshot({path:path.join(shots,'pat-desktop.png')});await desk.close();pass('1280×800 侧栏「账号与安全」可进入个人访问令牌；Esc 确认后关闭面板');
 console.log(`RESULT ${checks.length} checks passed`);
}finally{await browser?.close();if(proc?.exitCode===null){proc.kill();await new Promise(r=>proc.once('exit',r))}await rm(dir,{recursive:true,force:true})}
