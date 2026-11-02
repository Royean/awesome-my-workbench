// Independent acceptance: real isolated backend + installed desktop Chrome.
// Run: node tests/upcoming-tasks-acceptance.mjs
// Optional: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startServer,stopProcess,repoRoot,waitFor} from './helpers.mjs';
const modulePath=process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const {chromium}=await import(pathToFileURL(modulePath));
const dir=await mkdtemp(path.join(os.tmpdir(),'upcoming-tasks-acceptance-'));
const evidence=process.env.ACCEPTANCE_EVIDENCE_DIR||await mkdtemp(path.join(os.tmpdir(),'upcoming-tasks-evidence-'));
await mkdir(evidence,{recursive:true});
let server,browser;const checks=[];
const ok=name=>{checks.push(name);console.log('PASS '+name)};
try{
 server=await startServer({env:{HEALTH_DATA_DIR:dir,AUTH_REQUIRED:'0',NODE_ENV:'test',HOST:'127.0.0.1'}});
 const api=async(route,method='GET',body)=>{const r=await fetch(server.base+route+'?space=personal&workbench=health',{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(r.ok,`${method} ${route}: ${r.status} ${await r.clone().text()}`);return r.json()};
 const state=await api('/api/state');assert.equal(state.items.filter(x=>x.kind==='task').length,0);
 const day=offset=>{const d=new Date(state.today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)};
 const fixtures=[['未来较晚',day(5),'09:00'],['今天晚间',day(0),'18:00'],['未来最近',day(1),'08:00'],['今天早间',day(0),'08:00'],['过去未完成',day(-2),'10:00'],['未来次近',day(2),'10:00'],['已完成不展示',day(-3),'07:00',true]];
 const seeded=[];for(const [title,date,time,done=false]of fixtures)seeded.push(await api('/api/items','POST',{kind:'task',title,date,time,done,category:'日常'}));
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'});
 await context.addInitScript(()=>{localStorage.setItem('health-space','personal');localStorage.setItem('active-workbench','health')});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.base+'/#dashboard');
 const card=()=>page.locator('section.card').filter({has:page.getByRole('heading',{name:/近期待办/})});
 const titles=()=>card().locator('.task-copy strong').allTextContents();
 await card().waitFor();
 assert.deepEqual(await titles(),['过去未完成','今天早间','今天晚间','未来最近','未来次近']);
 assert.match(await card().innerText(),/6 项未完成/);assert.match(await card().innerText(),/仅显示最近 5 项/);
 assert.match(await card().locator('.task-row').first().innerText(),new RegExp(day(-2)+' · 已逾期'));
 assert.match(await card().innerText(),new RegExp(day(1)));assert.match(await card().innerText(),/今天/);
 ok('desktop: future tasks visible, date/time ascending, completed excluded, overdue marked, limit/count/overflow link');
 await page.screenshot({path:path.join(evidence,'desktop.png'),fullPage:true});
 await page.setViewportSize({width:360,height:800});
 assert.deepEqual(await titles(),['过去未完成','今天早间','今天晚间','未来最近','未来次近']);
 const widths=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,main:document.querySelector('main').scrollWidth,mainClient:document.querySelector('main').clientWidth}));
 assert.ok(widths.document<=widths.viewport&&widths.body<=widths.viewport&&widths.main<=widths.mainClient,JSON.stringify(widths));
 assert.ok(await card().getByRole('button',{name:'全部待办',exact:true}).isVisible());
 await card().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,'mobile-360.png'),fullPage:true});ok('360px: tasks/actions visible and no document/body/main horizontal overflow');
 await card().getByRole('button',{name:'完成：过去未完成',exact:true}).click();
 await waitFor(async()=>JSON.stringify(await titles())===JSON.stringify(['今天早间','今天晚间','未来最近','未来次近','未来较晚']));
 assert.match(await card().innerText(),/5 项未完成/);assert.doesNotMatch(await card().innerText(),/仅显示最近/);
 assert.equal((await api('/api/state')).items.find(x=>x.title==='过去未完成').done,true);ok('UI completion persists to real backend and sixth task fills slot');
 await card().getByRole('button',{name:'全部待办',exact:true}).click();await page.waitForURL('**/#dashboard/tasks');
 assert.equal(await page.locator('#records article').count(),7);
 await page.getByRole('button',{name:'取消完成：过去未完成',exact:true}).click();
 await waitFor(async()=>(await api('/api/state')).items.find(x=>x.title==='过去未完成').done===false);
 await page.getByRole('button',{name:'编辑未来最近',exact:true}).click();await page.locator('#field-title').fill('未来最近已编辑');
 await page.getByRole('button',{name:'保存记录',exact:true}).click();await page.locator('.drawer').waitFor({state:'detached'});
 assert.equal((await api('/api/state')).items.find(x=>x.id===seeded[2].id).title,'未来最近已编辑');
 ok('all-tasks navigation shows all 7, completed task can reopen, editing saves');
 // Replace only fictional isolated tasks to check a date boundary independent of execution date.
 for(const task of seeded)await api('/api/items/'+task.id,'DELETE');
 const year=Number(state.today.slice(0,4))+1;
 for(const [title,date]of [['跨年元旦',`${year}-01-01`],['年末安排',`${year-1}-12-31`]])await api('/api/items','POST',{kind:'task',title,date,time:'09:00',done:false});
 await page.goto(server.base+'/#dashboard');await page.reload();await card().waitFor();
 assert.deepEqual(await titles(),['年末安排','跨年元旦']);assert.match(await card().innerText(),new RegExp(`${year}-01-01`));
 ok('cross-year sorting and unambiguous full-year labels');
 // Create a future task through the actual form, rather than assuming API fixtures prove input UI.
 await card().getByRole('button',{name:/添加/}).click();await page.locator('#field-title').fill('表单未来安排');await page.locator('#field-date').fill(`${year}-02-01`);
 await page.getByRole('button',{name:'保存记录',exact:true}).click();await page.locator('.drawer').waitFor({state:'detached'});
 assert.ok((await titles()).includes('表单未来安排'));ok('future task created through real UI is immediately visible');
 for(const task of (await api('/api/state')).items.filter(x=>x.kind==='task'))await api('/api/items/'+task.id,'PUT',{done:true});
 await page.reload();await card().waitFor();assert.equal((await titles()).length,0);assert.match(await card().innerText(),/0 项未完成/);assert.match(await card().innerText(),/安排一件接下来要做的事。/);assert.ok(await card().getByRole('button',{name:'添加待办',exact:true}).isVisible());
 await page.screenshot({path:path.join(evidence,'empty-360.png'),fullPage:true});ok('all tasks completed: empty state and add action');
 assert.deepEqual(errors,[]);ok('no browser uncaught exceptions');
 const source=await readFile(path.join(repoRoot,'public/app.js'));const index=await readFile(path.join(repoRoot,'public/index.html'),'utf8');
 const summary={checkedAt:new Date().toISOString(),executor:'/root/todo_acceptance',chrome:browser.version(),platform:process.platform,arch:process.arch,node:process.version,sourceSha256:createHash('sha256').update(source).digest('hex'),bundle:index.match(/app\.[a-f0-9]+\.js/)?.[0],checks,mobileWidths:widths,evidence};
 await writeFile(path.join(evidence,'result.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
}finally{await browser?.close();await stopProcess(server?.proc);await rm(dir,{recursive:true,force:true})}
