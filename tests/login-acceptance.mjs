// Login acceptance: one round trip after login, button loading state, slow (3s) hint and 15s timeout.
// Run: PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.mjs node tests/login-acceptance.mjs  (SHOTS_DIR=… to save screenshots)
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
const cwd=path.resolve(import.meta.dirname,'..'),port=process.env.PORT_LOGIN||'3299',base='http://127.0.0.1:'+port,password=randomBytes(24).toString('base64url'),dir=await mkdtemp(path.join(os.tmpdir(),'login-acceptance-')),shots=process.env.SHOTS_DIR;
let proc,browser;const checks=[];const pass=x=>{checks.push(x);console.log('PASS '+x)};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email','admin@example.invalid','--name','验收管理员'],{cwd,input:password+'\n',env:{...process.env,HEALTH_DATA_DIR:dir},encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);
 proc=spawn(process.execPath,['server.mjs'],{cwd,env:{...process.env,NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:base,PORT:port,HEALTH_DATA_DIR:dir},stdio:'pipe'});for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok)break}catch{}await sleep(50)}
 if(shots)await mkdir(shots,{recursive:true});
 browser=await chromium.launch({headless:true,channel:'chrome'});
 const fresh=async()=>{const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.locator('#account-gate-form').waitFor();return {c,p,errors}};
 const fill=async(p,pw=password)=>{await p.locator('[name=email]').fill('admin@example.invalid');await p.locator('[name=password]').fill(pw)};
 const btn=p=>p.locator('#account-gate-form [type=submit]');
 // 1. Wrong password: restore, error under password, email kept, focus on password.
 {const {c,p,errors}=await fresh();await fill(p,'wrong-password');await btn(p).click();await p.locator('.account-error').filter({hasText:'邮箱或密码'}).waitFor();
  assert.equal(await btn(p).isEnabled(),true);assert.equal(await btn(p).textContent(),'登录');assert.equal(await btn(p).getAttribute('aria-busy'),null);
  assert.equal(await p.locator('[name=email]').inputValue(),'admin@example.invalid');assert.equal(await p.locator('[name=email]').evaluate(e=>e.readOnly),false);
  assert.equal(await p.evaluate(()=>document.activeElement?.name),'password');
  assert.equal(await p.evaluate(()=>{const pw=document.querySelector('[name=password]').closest('label'),err=document.querySelector('#account-gate-form .account-error');return pw.nextElementSibling===err&&getComputedStyle(err).color===getComputedStyle(document.documentElement).getPropertyValue('--error').trim().replace(/^#(..)(..)(..)$/,(_,r,g,b)=>`rgb(${parseInt(r,16)}, ${parseInt(g,16)}, ${parseInt(b,16)})`)}),true);
  assert.deepEqual(errors,[]);await c.close();pass('错误密码：按钮与输入恢复，错误在密码下方(var(--error))，保留邮箱，焦点回到密码');}
 // 2. Loading state + slow hint at 3s (login held 4.5s), double submit blocked, then one round trip.
 {const {c,p,errors}=await fresh();await fill(p);let logins=0;const seen=[];
  await p.route('**/api/auth/login*',async r=>{logins++;await sleep(5000);await r.continue()});
  const width=await btn(p).evaluate(b=>b.getBoundingClientRect().width);
  p.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))seen.push(u.pathname)});
  const t0=Date.now();await btn(p).click();
  assert.equal(await btn(p).isDisabled(),true);assert.equal(await btn(p).getAttribute('aria-busy'),'true');assert.equal((await btn(p).textContent()).trim(),'登录中…');assert.equal(await p.locator('#account-gate-form .account-spinner').count(),1);
  assert.equal(Math.abs(await btn(p).evaluate(b=>b.getBoundingClientRect().width)-width)<1,true);
  for(const n of ['email','password'])assert.equal(await p.locator(`[name=${n}]`).evaluate(e=>e.readOnly||e.disabled),true);
  await p.evaluate(()=>document.querySelector('#account-gate-form').requestSubmit());await p.keyboard.press('Enter');
  if(shots)await p.screenshot({path:path.join(shots,'login-loading-390x844.png')});
  assert.equal(await p.locator('.account-slow').textContent(),'');
await p.locator('.account-slow').filter({hasText:'网络较慢，正在连接…'}).waitFor({timeout:4500});assert.ok(Date.now()-t0>=2900,'slow hint too early');
  if(shots)await p.screenshot({path:path.join(shots,'login-slow-390x844.png')});
  assert.equal(await p.locator('.modal,.drawer,[role=dialog]').count(),0);
  await p.locator('.bottom-tabs').waitFor();await p.waitForTimeout(500);
  assert.equal(logins,1);assert.deepEqual(seen,['/api/auth/login'],seen.join());
  assert.deepEqual(errors,[]);await c.close();pass('登录中：立即禁用+spinner+「登录中…」宽度不变、输入锁定、防重复提交；3s后「网络较慢」；成功后仅1个API请求(无/api/state、无/api/bootstrap)');}
 // 3. Skeleton visible immediately on success while home data is pending (fallback path: login payload without state).
 {const {c,p}=await fresh();await fill(p);const seen=[];p.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))seen.push(u.pathname)});
  await p.route('**/api/auth/login*',async r=>{const res=await r.fetch();const b=await res.json();delete b.state;await r.fulfill({response:res,body:JSON.stringify(b)})});
  await p.route('**/api/state*',async r=>{await sleep(1500);await r.continue()});
  await btn(p).click();await p.locator('.home-skeleton').waitFor({timeout:1000});assert.equal(await p.locator('#account-gate-form').count(),0);
  await p.locator('.bottom-tabs').waitFor();assert.equal(await p.locator('.home-skeleton').count(),0);assert.deepEqual(seen,['/api/auth/login','/api/state']);
  await c.close();pass('成功后数据未到时立即显示首页骨架屏；登录载荷缺失state时回退/api/state');}
 // 4. 15s timeout: aborted, restored, hint 「连接超时，请重试」.
 {const {c,p,errors}=await fresh();await fill(p);await p.route('**/api/auth/login*',async r=>{await sleep(17000);await r.abort().catch(()=>{})});
  const t0=Date.now();await btn(p).click();await p.locator('.account-slow').filter({hasText:'连接超时，请重试'}).waitFor({timeout:17000});const elapsed=Date.now()-t0;
  assert.ok(elapsed>=14500&&elapsed<16500,String(elapsed));assert.equal(await btn(p).isEnabled(),true);assert.equal(await btn(p).getAttribute('aria-busy'),null);assert.equal(await p.locator('[name=password]').evaluate(e=>e.readOnly),false);assert.equal(await p.locator('[name=email]').inputValue(),'admin@example.invalid');
  assert.deepEqual(errors,[]);await c.close();pass('15s超时：中止请求，按钮恢复，提示「连接超时，请重试」');}
 // 5. Already signed in: reload uses bootstrap only (no second state fetch).
 {const {c,p}=await fresh();await fill(p);await btn(p).click();await p.locator('.bottom-tabs').waitFor();const seen=[];p.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))seen.push(u.pathname)});await p.reload();await p.locator('.bottom-tabs').waitFor();await p.waitForTimeout(500);assert.deepEqual(seen,['/api/bootstrap'],seen.join());await c.close();pass('已登录启动：仅/api/bootstrap一个请求');}
 console.log(`RESULT ${checks.length} checks passed`);
}finally{await browser?.close();if(proc?.exitCode===null){proc.kill();await new Promise(r=>proc.once('exit',r))}await rm(dir,{recursive:true,force:true})}
