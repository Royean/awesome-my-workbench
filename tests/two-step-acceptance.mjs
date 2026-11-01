// Headless check (not part of npm test): the four common records complete in ≤2 taps on a
// 390×844 phone, records are saved, and the water undo removes the record.
// Run: PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.mjs node tests/two-step-acceptance.mjs
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startServer,waitFor} from './helpers.mjs';
const SHOTS=process.env.SHOT_DIR||'/workspace/share';await mkdir(SHOTS,{recursive:true});
const dir=await mkdtemp(path.join(os.tmpdir(),'two-step-'));const server=await startServer({env:{HEALTH_DATA_DIR:dir}});
// Retry transient connection errors (busy CI/box); assertions still use the real server state.
const get=async url=>{for(let i=0;;i++){try{return await fetch(url)}catch(e){if(i>=20)throw e;await new Promise(r=>setTimeout(r,100))}}};
const state=async()=>(await (await get(server.base+'/api/state?space=personal')).json());
const post=(body)=>fetch(server.base+'/api/items?space=personal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const results=[];
let page;const assertAboveNav=async()=>{const [t,n]=await page.evaluate(()=>[document.querySelector('#toast').getBoundingClientRect().bottom,document.querySelector('.bottom-tabs').getBoundingClientRect().top]);assert.ok(t<=n,`toast bottom ${t} ≤ nav top ${n}`);const b=await page.locator('#toast button').boundingBox();assert.ok(b.width>=44&&b.height>=44,'撤销 ≥44 '+JSON.stringify(b));};
try{
 const today=(await state()).today;
 // Throwaway history so last-used defaults have something to remember.
 await post({kind:'exercise',title:'跑步记录',type:'跑步',duration:25,date:today,time:'07:00'});
 await post({kind:'metric',title:'血压记录',type:'pressure',value:118,secondary:76,unit:'mmHg',date:today,time:'07:10'});
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,timezoneId:'Asia/Shanghai'});
 await ctx.addInitScript(()=>localStorage.setItem('health-space','personal'));page=await ctx.newPage();let taps=0;const tap=async sel=>{taps++;await page.locator(sel).first().tap();};
 const home=async()=>{await page.goto(server.base+'/?r='+Date.now()+'#dashboard');await page.locator('[data-action="qc-open:meal"]').waitFor();taps=0;};
 const count=async kind=>(await state()).items.filter(x=>x.kind===kind).length;
 // 记一餐: card → type → 保存
 await home();await tap('[data-action="qc-open:meal"]');await page.locator('#capture-form').waitFor();
 await waitFor(()=>page.evaluate(()=>document.activeElement?.id==='capture-text'),{message:'meal text not focused'});
 const mealType=await page.locator('[data-choice="mealType"] .selected').textContent();
 await page.waitForTimeout(450);await page.screenshot({path:SHOTS+'/twostep-meal.png'});
 await page.keyboard.type('虚构午饭：番茄鸡蛋面');await tap('#capture-save');
 await waitFor(async()=>(await count('meal'))===1,{message:'meal not saved'});results.push(['记一餐（打字）',taps]);assert.ok(taps<=2);
 const meal=(await state()).items.find(x=>x.kind==='meal');assert.equal(meal.mealType,mealType.replace('✓','').trim());
 // 记一餐 via 最近吃过: card → chip (saves)
 await home();await tap('[data-action="qc-open:meal"]');await page.locator('[data-recent="0"]').waitFor();await page.locator('[data-recent="0"]').dblclick();taps++;
 await waitFor(async()=>(await count('meal'))===2,{message:'recent meal not saved'});const rt=page.locator('#toast');await rt.getByText(`已记 ${mealType.replace('✓','').trim()} · 虚构午饭：番茄鸡蛋面`,{exact:true}).waitFor();assert.equal(await rt.locator('button').textContent(),'撤销');assert.ok(await rt.locator('span').first().evaluate(s=>s.getBoundingClientRect().height<=24&&s.getBoundingClientRect().right<=390),'toast text one line');await assertAboveNav();await page.waitForTimeout(600);assert.equal(await count('meal'),2,'double tap on 最近吃过 → exactly 1 meal');await page.waitForTimeout(300);await page.screenshot({path:SHOTS+'/twostep-meal-recent.png'});results.push(['记一餐（最近吃过）',taps]);assert.ok(taps<=2);
 // 记运动: card → 保存 with last type/duration
 await home();await tap('[data-action="qc-open:exercise"]');await page.locator('#capture-form').waitFor();
 assert.equal(await page.inputValue('#capture-duration'),'25');assert.match(await page.locator('[data-choice="exerciseType"] .selected').textContent(),/跑步/);
 await page.waitForTimeout(450);await page.screenshot({path:SHOTS+'/twostep-exercise.png'});await tap('#capture-save');
 await waitFor(async()=>(await count('exercise'))===2,{message:'exercise not saved'});results.push(['记运动',taps]);assert.ok(taps<=2);
 const ex=(await state()).items.filter(x=>x.kind==='exercise').find(x=>x.time!=='07:00');assert.equal(ex.type,'跑步');assert.equal(ex.duration,25);
 // 记指标: card → type systolic (auto-advance) diastolic → 保存
 await home();await tap('[data-action="qc-open:metric"]');await page.locator('#capture-value').waitFor();
 await waitFor(()=>page.evaluate(()=>document.activeElement?.id==='capture-value'),{message:'metric value not focused'});
 assert.match(await page.locator('[data-choice="metricType"] .selected').textContent(),/血压/);
 assert.equal(await page.getAttribute('#capture-value','inputmode'),'numeric');
 await page.keyboard.type('122');assert.equal(await page.evaluate(()=>document.activeElement?.id),'capture-secondary');
 await page.keyboard.type('80');await page.waitForTimeout(450);await page.screenshot({path:SHOTS+'/twostep-metric.png'});await tap('#capture-save');
 await waitFor(async()=>(await count('metric'))===2,{message:'metric not saved'});results.push(['记指标（血压）',taps]);assert.ok(taps<=2);
 const bp=(await state()).items.find(x=>x.kind==='metric'&&x.value===122);assert.equal(bp.secondary,80);
 // 记饮水: chip on 今天 → saved + toast with 撤销
 await home();const chip=page.locator('[data-action="qc-water:250"]');const box=await chip.boundingBox();assert.ok(box.height>=48&&box.width>=48,'chip ≥48px '+JSON.stringify(box));
 await page.waitForTimeout(450);await page.screenshot({path:SHOTS+'/twostep-today.png'});await page.locator('[data-action="qc-water:250"]').dblclick();taps++;
 await waitFor(async()=>(await count('water'))===1,{message:'water not saved'});results.push(['记饮水',taps]);assert.ok(taps<=1);
 await page.locator('#toast').getByText('已记 250 ml').waitFor();await page.waitForTimeout(600);assert.equal(await count('water'),1,'double tap → exactly 1 water');await assertAboveNav();await page.waitForTimeout(450);await page.screenshot({path:SHOTS+'/twostep-water-toast.png'});
 await page.locator('#toast button',{hasText:'撤销'}).tap();
 await waitFor(async()=>(await count('water'))===0,{message:'water undo failed'});await page.locator('#toast').getByText('已撤销').waitFor();
 // 合并：toast 仍显示时再点不同量 → 一个 toast 合计，撤销一起撤。
 const wt=page.locator('#toast');await page.waitForTimeout(2100);
 await page.locator('[data-action="qc-water:250"]').tap();await wt.getByText('已记 250 ml',{exact:true}).waitFor();
 await page.locator('[data-action="qc-water:500"]').tap();await wt.getByText('已记 750 ml',{exact:true}).waitFor();
 await waitFor(async()=>(await count('water'))===2,{message:'250+500 not both saved'});await page.waitForTimeout(300);await page.screenshot({path:SHOTS+'/twostep-water-merged.png'});
 await wt.locator('button',{hasText:'撤销'}).tap();await waitFor(async()=>(await count('water'))===0,{message:'merged undo did not remove both'});await wt.getByText('已撤销').waitFor();
 // 并发：不同量连点不等待，均保存且不丢。
 await page.locator('[data-action="qc-water:350"]').tap();await page.locator('[data-action="qc-water:150"]').tap();
 await wt.getByText('已记 500 ml',{exact:true}).waitFor();await waitFor(async()=>(await count('water'))===2,{message:'concurrent different amounts dropped'});
 await wt.locator('button',{hasText:'撤销'}).tap();await waitFor(async()=>(await count('water'))===0,{message:'concurrent undo'});await wt.getByText('已撤销').waitFor();await page.waitForTimeout(2100);
 console.log('ok water merge');
 await page.locator('[data-action="qc-water:150"]').tap();await page.locator('#toast').getByText('已记 150 ml').waitFor();const t0=Date.now();await page.locator('#toast').waitFor({state:'hidden',timeout:8000});const dur=Date.now()-t0;assert.ok(dur>=3800&&dur<=5200,'toast ~4.5s, got '+dur);console.log('ok water undo, toast',dur,'ms');

 // 半填关闭确认：×、遮罩、取消、Esc 均先询问；未填写直接关闭。
 const confirmBox=page.locator('.discard-confirm');
 await home();await tap('[data-action="qc-open:metric"]');await page.locator('#capture-value').waitFor();await page.waitForTimeout(50);
 await page.locator('.drawer-head [data-action="close"]').tap();await page.locator('#capture-form').waitFor({state:'detached'});assert.equal(await confirmBox.count(),0,'untouched form closes without confirm');
 await tap('[data-action="qc-open:meal"]');await page.locator('#capture-text').waitFor();await page.waitForTimeout(50);await page.keyboard.type('半句话');
 await page.locator('.drawer-head [data-action="close"]').tap();await confirmBox.waitFor();
 assert.equal(await confirmBox.locator('h3').textContent(),'放弃这条记录？');
 assert.equal(await page.locator('#discard-yes').evaluate(b=>getComputedStyle(b).backgroundColor),'rgb(159, 76, 58)','放弃 in danger color');
 await page.waitForTimeout(200);await page.screenshot({path:SHOTS+'/twostep-discard.png'});
 await page.locator('#discard-keep').tap();await confirmBox.waitFor({state:'detached'});assert.equal(await page.inputValue('#capture-text'),'半句话');assert.equal(await page.evaluate(()=>document.activeElement?.id),'capture-text','focus back to text');
 await page.locator('.drawer-scrim').tap({position:{x:20,y:20}});await confirmBox.waitFor();await page.keyboard.press('Escape');await confirmBox.waitFor({state:'detached'});assert.equal(await page.inputValue('#capture-text'),'半句话');
 await page.keyboard.press('Escape');await confirmBox.waitFor();await page.locator('#discard-yes').tap();await page.locator('#capture-form').waitFor({state:'detached'});
 await page.locator('[data-action="qc-open:exercise"]').tap();await page.locator('#capture-duration').waitFor();await page.waitForTimeout(50);await page.fill('#capture-duration','40');
 await page.locator('.drawer-foot [data-action="close"]').tap();await confirmBox.waitFor();await page.locator('#discard-yes').tap();await page.locator('#capture-form').waitFor({state:'detached'});
 assert.equal(await count('meal'),2,'discarded meal not saved');console.log('ok discard confirm');
 // 未来日期：max=今天；超出时自动展开「时间与备注」并聚焦日期，不提交。
 const tomorrow=new Date(Date.parse(today+'T12:00:00+08:00')+86400000).toISOString().slice(0,10);
 for(const kind of ['meal','exercise','metric']){await home();await tap(`[data-action="qc-open:${kind}"]`);const form=page.locator('#capture-form');await form.waitFor();
  assert.equal(await form.locator('[name="date"]').getAttribute('max'),today,kind+' max');
  if(kind==='meal')await page.fill('#capture-text','虚构加餐');if(kind==='metric'){await page.fill('#capture-value','120');if(await page.locator('#capture-secondary').count())await page.fill('#capture-secondary','80');}
  await form.locator('[name="date"]').evaluate((d,v)=>{d.value=v},tomorrow);await page.locator('#capture-save').tap();
  await waitFor(()=>form.locator('details:has([name="date"])').evaluate(d=>d.open),{message:kind+' details not opened'});
  await waitFor(()=>page.evaluate(()=>document.activeElement?.name==='date'),{message:kind+' date not focused'});assert.equal(await form.locator('[name="date"] + .field-error').textContent(),'不能记录未来的日期');if(kind==='meal'){await page.waitForTimeout(200);await page.screenshot({path:SHOTS+'/twostep-future-date-local.png'});}}
 assert.equal((await state()).items.filter(x=>x.date>today).length,0);
 // 服务端未来日期错误（PR #12 的文案）：同样展开并聚焦日期，显示服务端文案。
 const MSG='不能记录未来的日期，今天是 11月1日';
 await home();await page.route(/\/api\/items(\?|$)/,r=>r.request().method()==='POST'?r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:MSG,field:'date'})}):r.continue());
 await tap('[data-action="qc-open:exercise"]');await page.locator('#capture-form').waitFor();await page.locator('#capture-save').tap();
 const fe=page.locator('#capture-form [name="date"] + .field-error');await fe.waitFor();assert.equal(await fe.textContent(),MSG);
 assert.equal(await page.evaluate(()=>document.activeElement?.name),'date');await page.unroute(/\/api\/items(\?|$)/);
 await page.waitForTimeout(200);await page.screenshot({path:SHOTS+'/twostep-future-date.png'});console.log('ok future date');
 // 无缓存工作台加载失败：显示错误态 + 重试，而非空态/0。
 const p2=await ctx.newPage();await p2.goto(server.base+'/?r=lf#dashboard');await p2.locator('[data-action="qc-open:meal"]').waitFor();
 await p2.route(/\/api\/state\?.*workbench=finance/,r=>r.abort());
 await p2.evaluate(a=>{const b=document.createElement('button');b.dataset.action=a;b.hidden=true;document.body.append(b);b.click();b.remove()},'shell-switch:finance');
 const lf=p2.locator('.load-error-banner');await lf.waitFor({timeout:15000});assert.equal(await lf.locator('span').first().textContent(),'没连上服务器，内容还没加载出来');
 assert.equal(await p2.locator('main .metrics, main .empty').count(),0,'no empty state or zeros');
 await p2.waitForTimeout(200);await p2.screenshot({path:SHOTS+'/twostep-load-error.png'});
 await p2.unroute(/\/api\/state\?.*workbench=finance/);await p2.route(/\/api\/state\?.*workbench=finance/,async r=>{await new Promise(x=>setTimeout(x,1200));await r.continue();});const rb=lf.locator('button.stale-retry');await rb.tap();await waitFor(()=>rb.evaluate(b=>b.getAttribute('aria-busy')==='true'&&b.classList.contains('busy')&&b.disabled&&getComputedStyle(b,'::after').animationName==='refresh-spin').catch(()=>false),{message:'retry not busy'});await p2.screenshot({path:SHOTS+'/twostep-retrying.png'});await lf.waitFor({state:'detached',timeout:15000});console.log('ok load error + retry');
 for(const [n,t] of results)console.log(`ok ${n}: ${t} taps`);
}finally{await browser.close();await server.stop();await rm(dir,{recursive:true,force:true});}
