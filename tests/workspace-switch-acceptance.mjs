// Workspace switch acceptance: nav kept + content skeleton, stale-while-revalidate cache of any age, idle prefetch,
// race safety, refresh spinner / failure banner / 8s timeout, and per-account cache isolation (logout, session replaced, in-flight).
// Run: PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.mjs node tests/workspace-switch-acceptance.mjs  (SHOTS_DIR=… to save screenshots)
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
const cwd=path.resolve(import.meta.dirname,'..'),port=process.env.PORT_SWITCH||'3298',base='http://127.0.0.1:'+port,password=randomBytes(24).toString('base64url'),dir=await mkdtemp(path.join(os.tmpdir(),'switch-acceptance-')),shots=process.env.SHOTS_DIR;
let proc,browser;const checks=[];const pass=x=>{checks.push(x);console.log('PASS '+x)};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const A='admin@example.invalid',B='member@example.invalid';
async function call(route,{method='GET',body,cookie,query='space=personal&workbench=health'}={}){const r=await fetch(base+route+(route.includes('?')?'&':'?')+query,{method,headers:{'Content-Type':'application/json',Origin:base,...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json().catch(()=>null);return {status:r.status,body:value,cookie:r.headers.get('set-cookie')?.split(';')[0]}}
// Page-side helpers.
const act=(p,action)=>p.evaluate(a=>{const b=document.createElement('button');b.dataset.action=a;b.hidden=true;document.body.append(b);b.click();b.remove()},action);
const keys=p=>p.evaluate(()=>window.__zhihengTestHooks?.cacheKeys?.()||[]);
const text=p=>p.evaluate(()=>document.querySelector('#app')?.textContent||'');
const setSpace=(p,v)=>p.evaluate(v=>{const s=document.querySelector('#space');s.value=v;s.dispatchEvent(new Event('change',{bubbles:true}))},v);
// Init script: fake clock offset + DOM watcher that, once armed, records any frame containing A's data.
const init=()=>{window.__zhihengTestHooks={};const now=Date.now.bind(Date);Date.now=()=>now()+(Number(localStorage.getItem('t-offset'))||0);
 window.__leaks=[];let armed=localStorage.getItem('arm-watch')==='1';const check=()=>{if(!armed&&document.querySelector('#account-gate-form')&&localStorage.getItem('arm-on-gate')==='1')armed=true;if(armed&&/甲的/.test(document.documentElement.textContent))window.__leaks.push(document.querySelector('#app')?.textContent.slice(0,120))};
 new MutationObserver(check).observe(document,{subtree:true,childList:true,characterData:true});};
try{
 const setup=spawnSync(process.execPath,['scripts/account-admin.mjs','create-admin','--email',A,'--name','验收管理员'],{cwd,input:password+'\n',env:{...process.env,HEALTH_DATA_DIR:dir},encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);
 proc=spawn(process.execPath,['server.mjs'],{cwd,env:{...process.env,NODE_ENV:'test',AUTH_REQUIRED:'1',APP_ORIGIN:base,PORT:port,HEALTH_DATA_DIR:dir},stdio:'pipe'});for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok)break}catch{}await sleep(50)}
 // Seed: A and B each have distinguishable settings + finance notes.
 const a=await call('/api/auth/login',{method:'POST',body:{email:A,password}});assert.equal(a.status,200);const aCookie=a.cookie,aId=a.body.user.id;
 const inv=await call('/api/auth/invitations',{method:'POST',cookie:aCookie,body:{email:B,name:'乙'}});assert.equal(inv.status,201);
 const acc=await call('/api/auth/accept-invitation',{method:'POST',body:{token:inv.body.token,password,name:'乙'}});assert.equal(acc.status,200);const bCookie=acc.cookie;
 const today=new Date().toISOString().slice(0,10);
 for(const [c,who] of [[aCookie,'甲'],[bCookie,'乙']]){
  assert.equal((await call('/api/settings',{method:'PUT',cookie:c,body:{name:who+'的名字',focus:who+'的健康重点'}})).status,200);
  assert.equal((await call('/api/items',{method:'POST',cookie:c,query:'space=personal&workbench=finance',body:{kind:'note',title:who+'的金融备忘',date:today}})).status,201);}
 if(shots)await mkdir(shots,{recursive:true});
 browser=await chromium.launch({headless:true,channel:'chrome'});
 const delay={},mode={};let stateHits=[];
 const fresh=async({saveData=false}={})=>{const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await c.addInitScript(init);if(saveData)await c.addInitScript(()=>Object.defineProperty(navigator,'connection',{value:{saveData:true}}));
  await c.route('**/api/state*',async r=>{const u=new URL(r.request().url()),w=u.searchParams.get('workbench')+'@'+u.searchParams.get('space');stateHits.push(w);const m=mode[w]||mode['*'];if(m==='abort')return r.abort();if(m==='hang'){await sleep(10000);return r.abort().catch(()=>{})}const d=delay[w]??delay['*']??0;if(d)await sleep(d);await r.continue().catch(()=>{})});
  const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.locator('#account-gate-form').waitFor();return {c,p,errors}};
 const uiLogin=async(p,email)=>{await p.locator('[name=email]').fill(email);await p.locator('[name=password]').fill(password);await p.locator('#account-gate-form [type=submit]').click();await p.locator('.bottom-tabs').waitFor()};
 const reset=()=>{for(const k of Object.keys(delay))delete delay[k];for(const k of Object.keys(mode))delete mode[k];stateHits=[]};
 const finance=p=>p.locator('.generic-record').filter({hasText:'甲的金融备忘'});

 // 1. No cache (Save-Data disables prefetch): slow 3s switch keeps sidebar + bottom nav, skeleton only in content.
 {const {c,p,errors}=await fresh({saveData:true});await uiLogin(p,A);await p.waitForTimeout(1500);
  assert.deepEqual((await keys(p)).filter(k=>!k.endsWith(':personal:health')),[],'Save-Data must skip prefetch');
  delay['finance@personal']=3000;const t0=Date.now();await act(p,'shell-switch:finance');
  await p.locator('main .home-skeleton').waitFor({timeout:500});assert.ok(Date.now()-t0<500);
  assert.equal(await p.locator('.bottom-tabs').isVisible(),true);assert.equal(await p.locator('.sidebar').count(),1);
  assert.equal(await p.locator('text=正在切换').count(),0);
  if(shots)await p.screenshot({path:path.join(shots,'switch-skeleton-390x844.png')});
  const box=sel=>p.locator(sel).first().evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,height:r.height}});
  const sk=await box('main .home-skeleton'),skFirst=await box('main .home-skeleton .sk');
  await finance(p).waitFor({timeout:4000});
  const real=await box('main .heading'),realFirst=await box('main .heading h1');
  assert.ok(Math.abs(sk.left-real.left)<=1&&Math.abs(sk.right-real.right)<=1,JSON.stringify({sk,real}));
  assert.ok(Math.abs(skFirst.left-realFirst.left)<=1,JSON.stringify({skFirst,realFirst}));
  assert.ok(Math.abs(skFirst.top-real.top)<=1&&Math.abs(skFirst.height-real.height)<=12,JSON.stringify({skFirst,real}));
  pass(`骨架屏与真实内容左右边界一致(±1px)，首块 x 不变；首块高 ${skFirst.height}px vs 标题区 ${real.height}px`);assert.ok(Date.now()-t0>=2800);assert.equal(await p.locator('.home-skeleton').count(),0);
  pass('无缓存慢切换(3s)：侧栏/底部导航/顶栏保留，仅内容区骨架屏，无「正在切换…」；Save-Data 时不预取');
  // Data-space path too.
  reset();delay['finance@demo']=3000;await setSpace(p,'demo');await p.locator('main .home-skeleton').waitFor({timeout:500});assert.equal(await p.locator('.bottom-tabs').isVisible(),true);assert.equal(await p.locator('text=正在切换数据空间').count(),0);
  await p.locator('main .home-skeleton').waitFor({state:'detached',timeout:4500});assert.equal(await finance(p).count(),0);pass('切换数据空间同样保留导航、内容区骨架屏');
  // No cache + failure → error state with 重试 in content area, not infinite skeleton; retry recovers.
  reset();mode['*']='abort';await act(p,'shell-switch:health');await p.locator('main .load-error-banner').filter({hasText:'没连上服务器，内容还没加载出来'}).waitFor({timeout:3000});assert.equal(await p.locator('.bottom-tabs').isVisible(),true);assert.equal(await p.locator('.home-skeleton').count(),0);
  reset();await p.locator('main button',{hasText:'重试'}).click();await p.locator('main h1',{hasText:'健康总览'}).waitFor({timeout:3000});
  assert.deepEqual(errors,[]);await c.close();pass('无缓存且失败：内容区错误态+「重试」，导航保留，重试成功');}

 const {c,p,errors}=await fresh();
 // 2. Idle prefetch warms other workbenches + other space, so a never-visited switch is instant.
 {await uiLogin(p,A);await p.waitForFunction(id=>{const k=window.__zhihengTestHooks.cacheKeys();return k.includes(id+':personal:finance')&&k.includes(id+':demo:health')},aId,{timeout:8000});
  reset();delay['*']=3000;const t0=Date.now();await act(p,'shell-switch:finance');await finance(p).waitFor({timeout:400});assert.ok(Date.now()-t0<400,'prefetched switch not instant');
  assert.equal(await p.locator('.home-skeleton').count(),0);
  await p.locator('.refresh-spinner').waitFor({timeout:300});assert.equal(await p.locator('#toast').isVisible(),false);
  if(shots)await p.screenshot({path:path.join(shots,'switch-cached-spinner-390x844.png')});
  await p.locator('.refresh-spinner').waitFor({state:'detached',timeout:4000});assert.equal(await p.locator('#toast').isVisible(),false);
  pass('空闲预取：从未访问的工作台切换 <400ms 即显示；后台刷新时标题旁 spinner，刷新后消失，全程无 toast');}
 // 3. Cache older than 30s (fake clock +5min) still renders immediately, then updates in place after refresh.
 {await act(p,'shell-switch:health');await p.locator('.refresh-spinner').waitFor({state:'detached',timeout:5000});
  await p.evaluate(()=>localStorage.setItem('t-offset',String(5*60000)));
  assert.equal((await call('/api/items',{method:'POST',cookie:aCookie,query:'space=personal&workbench=finance',body:{kind:'note',title:'甲的新增备忘',date:today}})).status,201);
  await p.evaluate(()=>{window.__sk=false;new MutationObserver(()=>{if(document.querySelector('.home-skeleton'))window.__sk=true}).observe(document,{subtree:true,childList:true})});
  reset();delay['*']=2000;const t0=Date.now();await act(p,'shell-switch:finance');await finance(p).waitFor({timeout:400});assert.ok(Date.now()-t0<400);
  assert.equal(await p.locator('text=甲的新增备忘').count(),0);
  if(shots)await p.screenshot({path:path.join(shots,'switch-cached-390x844.png')});
  await p.locator('text=甲的新增备忘').waitFor({timeout:3500});assert.equal(await p.evaluate(()=>window.__sk),false,'skeleton flashed');assert.equal(await finance(p).count(),1);
  pass('缓存超过30秒(假时钟+5分钟)仍立即显示，后台刷新后原位更新，无骨架闪烁');}
 // 4. Refresh failure → banner with minutes + 重试; cached content kept; retry works.
 {await act(p,'shell-switch:health');await p.locator('.refresh-spinner').waitFor({state:'detached',timeout:5000});await p.evaluate(()=>localStorage.setItem('t-offset',String(12*60000)));
  reset();mode['*']='abort';await act(p,'shell-switch:finance');
  const banner=p.locator('main .stale-banner');await banner.waitFor({timeout:3000});const bt=await banner.locator('span').first().textContent();assert.match(bt,/^网络不稳，显示的是 (7|8) 分钟前的数据$/,bt);
  assert.equal(await finance(p).count(),1);assert.equal(await p.locator('.refresh-spinner').count(),0);assert.equal(await p.locator('#toast').isVisible(),false);
  if(shots)await p.screenshot({path:path.join(shots,'switch-refresh-failed-390x844.png')});
  const rb=await banner.locator('button').evaluate(e=>{const r=e.getBoundingClientRect();return {w:r.width,h:r.height,fs:getComputedStyle(e).fontSize}});assert.ok(rb.h>=44&&rb.w>=44&&rb.fs==='13px',JSON.stringify(rb));
  reset();delay['*']=1200;await banner.locator('button').dblclick();await p.locator('main .stale-banner button.busy[disabled][aria-busy=true]').waitFor({timeout:300});await p.evaluate(()=>document.querySelector('main .stale-banner button')?.click());
  await banner.waitFor({state:'detached',timeout:3000});assert.equal(stateHits.length,1,stateHits.join());
  await p.locator('.refresh-spinner').waitFor({state:'detached',timeout:3000});assert.equal(await finance(p).count(),1);
  pass('刷新失败：细横幅「网络不稳，显示的是 7 分钟前的数据」+「重试」(≥44×44，字号13px)，缓存保留；双击仅1次请求，重试中禁用+spinner，成功后横幅消失');
  // Copy for <1 minute and 60+ minutes.
  for(const [extra,expect] of [[20000,'网络不稳，显示的是刚刚的数据'],[2*3600000+60000,'网络不稳，显示的是 2 小时前的数据']]){
   await act(p,'shell-switch:health');await p.locator('.refresh-spinner').waitFor({state:'detached',timeout:5000});await p.locator('main .stale-banner').waitFor({state:'detached'});
   await act(p,'shell-switch:finance');await p.locator('.refresh-spinner').waitFor({state:'detached',timeout:5000});
   await p.evaluate(x=>localStorage.setItem('t-offset',String(Number(localStorage.getItem('t-offset')||0)+x)),extra);
   await act(p,'shell-switch:health');await p.locator('.refresh-spinner').waitFor({state:'detached',timeout:5000});
   reset();mode['*']='abort';await act(p,'shell-switch:finance');await banner.waitFor({timeout:3000});assert.equal(await banner.locator('span').first().textContent(),expect);reset();}
  pass('横幅文案：<1分钟「显示的是刚刚的数据」，60+分钟「显示的是 2 小时前的数据」');}
 // 5. 8s timeout aborts the state request and shows the failure banner.
 {await act(p,'shell-switch:health');await p.locator('.refresh-spinner').waitFor({state:'detached',timeout:5000});
  reset();mode['finance@personal']='hang';const t0=Date.now();await act(p,'shell-switch:finance');await p.locator('main .stale-banner').waitFor({timeout:10000});const el=Date.now()-t0;
  assert.ok(el>=7500&&el<9500,String(el));assert.equal(await finance(p).count(),1);assert.match(await p.locator('main .stale-banner').textContent(),/网络不稳，显示的是/);
  pass(`超时：状态请求 8s 中止(实测 ${el}ms)并显示失败横幅`);}
 // 6. Rapid A→B→A: slow response for B must not override A.
 {reset();await act(p,'shell-switch:health');await p.locator('.refresh-spinner').waitFor({state:'detached',timeout:5000});
  reset();delay['finance@personal']=1500;delay['health@personal']=200;await act(p,'shell-switch:finance');await p.waitForTimeout(50);await act(p,'shell-switch:health');await p.waitForTimeout(2500);
  assert.equal(await p.locator('main h1').first().textContent(),'健康总览');assert.equal(await finance(p).count(),0);assert.equal(await p.locator('.refresh-spinner').count(),0);
  pass('快速 A→B→A：B 的迟到响应被忽略，最终显示 A');}
 // 7. Logout clears cache; B's first render never contains A's data; in-flight A response after logout is discarded.
 {reset();delay['*']=4000;await act(p,'shell-switch:finance');// in-flight A refresh (4s)
  await p.evaluate(()=>localStorage.setItem('arm-on-gate','1'));
  await act(p,'account-open');await p.locator('#account-logout').click();await p.locator('#account-gate-form').waitFor();
  assert.deepEqual(await keys(p),[]);assert.equal(/甲的/.test(await text(p)),false);
  delete delay['*'];await uiLogin(p,B);await p.waitForTimeout(4500);
  assert.equal(await p.locator('main h1').first().textContent(),'健康总览');
  assert.deepEqual(await p.evaluate(()=>window.__leaks),[]);assert.equal((await keys(p)).some(k=>k.startsWith(aId+':')),false);
  await act(p,'shell-switch:finance');await p.locator('.generic-record',{hasText:'乙的金融备忘'}).waitFor();assert.equal(await finance(p).count(),0);assert.deepEqual(await p.evaluate(()=>window.__leaks),[]);
  for(const s of [p.evaluate(()=>JSON.stringify(localStorage)),p.evaluate(()=>JSON.stringify(sessionStorage))])assert.equal(/甲的/.test(await s),false);
  if(shots)await p.screenshot({path:path.join(shots,'switch-after-account-change-390x844.png')});
  assert.deepEqual(errors,[]);await c.close();pass('退出登录清空缓存；登录乙后每次 DOM 变更都不含甲的数据；甲的在途响应被丢弃；缓存无甲的条目，local/sessionStorage 无健康数据');}
 // 8. Session replaced without logout (cookie becomes B's): first response with foreign owner wipes cache and restarts; B never sees A.
 {const {c,p,errors}=await fresh();await uiLogin(p,A);await p.waitForFunction(id=>window.__zhihengTestHooks.cacheKeys().includes(id+':personal:finance'),aId,{timeout:8000});
  await c.clearCookies();await c.addCookies([{name:bCookie.split('=')[0],value:bCookie.split('=').slice(1).join('='),url:base,httpOnly:true,sameSite:'Strict'}]);
  await p.evaluate(()=>localStorage.setItem('arm-watch','1'));
  await Promise.all([p.waitForEvent('load'),setSpace(p,'demo')]);
  await p.locator('.bottom-tabs').waitFor();await p.waitForTimeout(2500);
  assert.deepEqual(await p.evaluate(()=>window.__leaks),[]);assert.equal((await keys(p)).some(k=>k.startsWith(aId+':')),false);assert.ok((await keys(p)).length>0);
  assert.equal(/甲的/.test(await text(p)),false);assert.deepEqual(errors,[]);await c.close();pass('会话被替换(未退出直接变为乙)：响应 owner 不符即清缓存并重启，乙的页面从首帧起不含甲的数据，缓存无甲的条目');}
 {const c=await browser.newContext();const p=await c.newPage();await p.goto(base);await p.locator('#account-gate-form').waitFor();assert.equal(await p.evaluate(()=>typeof window.__zhihengCacheKeys+'/'+typeof window.__zhihengTestHooks),'undefined/undefined');
  const {readdir,readFile}=await import('node:fs/promises');const js=(await readdir(path.join(cwd,'public/assets'))).filter(f=>f.endsWith('.js'));const html=await readFile(path.join(cwd,'public/index.html'),'utf8');const live=js.filter(f=>html.includes(f));assert.equal(live.length,1);assert.equal((await readFile(path.join(cwd,'public/assets',live[0]),'utf8')).includes('__zhihengCacheKeys'),false);
  await c.close();pass('生产：无测试注入时 window 上无缓存钩子，构建产物不含 __zhihengCacheKeys');}
 console.log(`RESULT ${checks.length} checks passed`);
}finally{await browser?.close();if(proc?.exitCode===null){proc.kill();await new Promise(r=>proc.once('exit',r))}await rm(dir,{recursive:true,force:true})}
