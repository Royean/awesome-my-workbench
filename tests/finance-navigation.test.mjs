// Independent acceptance fixtures: rendering/navigation only, no user database.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createShell} from '../public/shell.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(run){
 const saved=Object.fromEntries(['window','document','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const app={innerHTML:'',insertAdjacentHTML(where,html){this.innerHTML+=html}},space={};
 const body={dataset:{},style:{setProperty(){}},classList:{toggle(){}}};
 const workspace={insertAdjacentHTML(){},querySelector(){return null}};
 Object.defineProperty(globalThis,'window',{value:{addEventListener(){}},configurable:true});
 Object.defineProperty(globalThis,'navigator',{value:{},configurable:true});
 Object.defineProperty(globalThis,'document',{value:{body,querySelector:q=>q==='#app'?app:q==='#space'?space:q==='.workspace'?workspace:null},configurable:true});
 const ctx={page:'financial',items:[],today:'2026-11-02',workbench:'finance',space:'personal',settings:{name:'虚构'},workbenches:[{id:'finance',type:'finance',name:'资产'}],esc,icon:()=>'',btn:(label,action)=>`<button data-action="${esc(action)}">${esc(label)}</button>`,field:()=>'',previews:{thumb:()=>'',mount(){}},setSpace(){}};
 try{return run(ctx,createShell(ctx),()=>app.innerHTML)}finally{for(const [key,descriptor]of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}
function sidebar(html){return html.match(/<aside class="sidebar">([\s\S]*?)<\/aside>/)[1]}
test('finance sidebar has six primary destinations and my profile at the bottom',()=>fixture((ctx,shell,html)=>{
 shell.renderOther();const side=sidebar(html()),main=side.split('<div class="sidebar-bottom">')[0];
 assert.deepEqual([...main.matchAll(/data-action="nav:([^"]+)"/g)].map(x=>x[1]),['dashboard','financial','fixed','transactions','renewals','documents']);
 assert.match(side.split('<div class="sidebar-bottom">')[1],/data-action="nav:mine"/);
}));
test('all removed primary routes still render, with the correct parent selected',()=>fixture((ctx,shell,html)=>{
 const parents={accounts:'financial',liabilities:'financial',holdings:'dashboard',history:'dashboard',tasks:'renewals',notes:'documents'};
 for(const [route,parent]of Object.entries(parents)){ctx.page=route;shell.renderOther();assert.match(sidebar(html()),new RegExp(`class="nav-btn active" data-action="nav:${parent}"[^>]*aria-current="page"`));assert.match(html(),/aria-label="页内导航"/);}
}));
test('financial and fixed holdings never leak into the other section and mobile keeps independent entry points',()=>fixture((ctx,shell,html)=>{
 ctx.items=[{id:'cash-fixture',kind:'asset_holding',category:'cash',title:'虚构金融持仓',date:ctx.today,value:10,status:'active'},{id:'server-fixture',kind:'asset_holding',category:'server',title:'虚构固定设备',date:ctx.today,status:'active'}];
 shell.renderOther();assert.match(html(),/虚构金融持仓/);assert.doesNotMatch(html(),/虚构固定设备/);
 ctx.page='fixed';shell.renderOther();assert.match(html(),/虚构固定设备/);assert.doesNotMatch(html(),/虚构金融持仓/);
 const bottom=html().match(/<nav class="bottom-tabs"[\s\S]*?<\/nav>/)[0];assert.match(bottom,/data-action="nav:financial"/);assert.match(bottom,/data-action="nav:fixed"/);assert.match(bottom,/data-action="nav:renewals"/);
}));
test('matters preserve actionable task controls and originals keep a path to notes',()=>fixture((ctx,shell,html)=>{
 ctx.items=[{id:'task-fixture',kind:'task',title:'虚构续费核对',date:ctx.today,done:false},{id:'note-fixture',kind:'note',title:'虚构备忘',date:ctx.today}];ctx.page='renewals';shell.renderOther();assert.match(html(),/shell-toggle:task-fixture/);assert.match(html(),/shell-edit:task-fixture/);assert.match(html(),/nav:tasks/);assert.match(sidebar(html()),/asset-nav-count">1<\/span>/);
 ctx.page='documents';shell.renderOther();assert.match(html(),/nav:notes/);ctx.page='notes';shell.renderOther();assert.match(html(),/虚构备忘/);assert.doesNotMatch(html(),/虚构续费核对/);
}));
test('matters badge counts only unfinished tasks and near or overdue deadlines, while repayment schedule excludes closed debt',()=>fixture((ctx,shell,html)=>{
 const holding=(id,date,status='active')=>({id,kind:'asset_holding',title:id,date:ctx.today,category:'server',renewalOn:date,status});
 const debt=(id,date,status='active')=>({id,kind:'asset_liability',title:id,date:ctx.today,dueDate:date,status,currency:'CNY',balance:5});
 ctx.items=[{id:'todo',kind:'task',title:'待完成',date:ctx.today,done:false},{id:'done',kind:'task',title:'已完成',date:ctx.today,done:true},holding('overdue-renewal','2026-11-01'),holding('day-30-renewal','2026-12-02'),holding('day-31-renewal','2026-12-03'),holding('closed-renewal','2026-11-01','closed'),debt('overdue-debt','2026-11-01'),debt('day-30-debt','2026-12-02'),debt('day-31-debt','2026-12-03'),debt('closed-debt','2026-11-01','closed')];
 assert.equal(shell.assets.pendingCount(),5);
 ctx.page='renewals';shell.renderOther();const schedule=html().split('<h2 class="card-title">还款安排</h2>')[1].split('</section>')[0];assert.match(schedule,/overdue-debt/);assert.match(schedule,/day-30-debt/);assert.match(schedule,/day-31-debt/);assert.doesNotMatch(schedule,/closed-debt/);assert.match(sidebar(html()),/asset-nav-count">5<\/span>/);
}));
