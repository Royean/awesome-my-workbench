// Independent acceptance at the existing createAssetsUI public boundary.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAssetsUI} from '../public/assets.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today='2026-11-05';
const record=(kind,id,extra={})=>({kind,id,title:id,date:today,currency:'CNY',...extra});
const hold=(id,category,value,extra={})=>record('asset_holding',id,{category,status:'active',...(value===undefined?{}:{value}),...extra});
const snap=(id,date,extra={})=>record('asset_snapshot',id,{date,...extra});
const context=items=>({items,page:'dashboard',space:'personal',workbench:'finance',today,account:{user:{id:'qa-owner'}},esc,icon:()=>'',btn:(label,action)=>`<button data-action="${esc(action)}">${esc(label)}</button>`,field:()=>''});
const hero=html=>html.match(/<div class="finance-hero">([\s\S]*?)<\/div>/)?.[1]||'';
async function withDocument(fn){const original=Object.getOwnPropertyDescriptor(globalThis,'document');let html='';const box={set outerHTML(value){html=value},get outerHTML(){return html}};const control={focus(){}};Object.defineProperty(globalThis,'document',{value:{querySelector:selector=>selector==='.finance-overview'?box:control},configurable:true});try{return await fn(()=>html)}finally{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;}}

test('overview public render preserves currency and account attribution, pending/closed exclusions and unknown debt',()=>{
 const rows=[hold('基金','fund',100),hold('设备','equipment',50),hold('未知服务器','server',undefined),hold('待核对基金','fund',888,{status:'pending'}),hold('已结束基金','fund',999,{status:'closed'}),hold('美元股票','stock',70,{currency:'USD'}),record('asset_account','独立现金',{balance:20,includeInTotal:true}),record('asset_account','含持仓账户',{balance:1000,includeInTotal:false}),record('asset_liability','已知负债',{balance:10,status:'active'})];
 const before=JSON.stringify(rows),ctx=context(rows),ui=createAssetsUI(ctx);let html=ui.render();assert.match(hero(html),/160\.00/);assert.match(html,/170\.00/);assert.match(html,/1 项资产未估值/);assert.match(html,/待核对估值/);assert.match(html,/USD.*70\.00/s);assert.equal(JSON.stringify(rows),before);
 rows.push(record('asset_liability','未知负债',{balance:null,status:'pending'}));html=ui.render();assert.match(hero(html),/已知资产估值/);assert.match(hero(html),/170\.00/);assert.match(hero(html),/净额待核实/);assert.doesNotMatch(hero(html),/160\.00/);
});
test('empty, unvalued and single snapshot states do not fabricate chart values or curves',()=>{
 const ctx=context([]),ui=createAssetsUI(ctx);let html=ui.render();assert.match(hero(html),/—/);assert.doesNotMatch(html,/<svg|finance-distribution-row">/);assert.match(html,/还没有可比较的净额快照/);
 ctx.items=[hold('未知资产','server',undefined),snap('唯一历史','2026-11-01',{totalValue:-12})];html=ui.render();assert.match(hero(html),/—/);assert.match(html,/已有 1 次净额快照/);assert.doesNotMatch(html,/<svg/);
});
test('history render removes future/status/invalid/conflicting snapshots and merges equal same-day duplicates',()=>{
 const ctx=context([hold('基金','fund',100),snap('old','2026-06-01',{totalValue:-20}),snap('dup-a','2026-07-01',{totalValue:0}),snap('dup-b','2026-07-01',{assetValue:10,liabilityValue:10}),snap('conflict-a','2026-08-01',{totalValue:25}),snap('conflict-b','2026-08-01',{totalValue:26}),snap('latest','2026-11-01',{totalValue:80}),snap('future','2026-11-06',{totalValue:999}),snap('pending','2026-10-01',{totalValue:900,status:'pending'}),snap('closed','2026-10-02',{totalValue:900,status:'closed'}),snap('partial','2026-10-03',{assetValue:100}),snap('contradiction','2026-10-04',{totalValue:90,assetValue:100,liabilityValue:20})]);
 const html=createAssetsUI(ctx).render(),table=html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]||'';
 assert.equal((table.match(/<tr>/g)||[]).length,3);for(const date of ['2026-06-01','2026-07-01','2026-11-01'])assert.match(table,new RegExp(date));for(const date of ['2026-08-01','2026-11-06','2026-10-01','2026-10-02','2026-10-03','2026-10-04'])assert.doesNotMatch(table,new RegExp(date));
 assert.match(html,/1 个日期的快照净额冲突/);assert.match(html,/2 条快照缺少完整净额或金额口径不一致/);assert.match(html,/2026-07-01 → 2026-11-01/);assert.match(html,/快照变化/);assert.match(html,/不等同投资收益/);assert.match(html,/\+¥80\.00/);
});
test('UI currency, dimension and range actions change rendered content without mixing raw currency percentages',async()=>withDocument(async markup=>{
 const ctx=context([hold('人民币基金','fund',100,{accountId:'qa-account'}),hold('美元股票','stock',70,{currency:'USD'}),record('asset_account','qa-account',{title:'虚构券商',balance:1000,includeInTotal:false}),snap('early','2026-02-01',{totalValue:10}),snap('recent','2026-11-01',{totalValue:20}),snap('dollar-history','2026-11-02',{currency:'USD',totalValue:60})]),ui=createAssetsUI(ctx);ui.render();
 await ui.handle('asset-overview-dimension','account');assert.match(markup(),/虚构券商/);
 await ui.handle('asset-overview-dimension','currency');const distribution=markup().match(/<div class="finance-distribution-rows">([\s\S]*?)<p class="finance-panel-footnote">/)?.[1]||'';assert.match(distribution,/CNY/);assert.match(distribution,/USD/);assert.doesNotMatch(distribution,/%/);
 await ui.handle('asset-overview-range','12');assert.match(markup(),/<td>2026-02-01<\/td>/);await ui.handle('asset-overview-range','6');assert.doesNotMatch(markup(),/<td>2026-02-01<\/td>/);
 await ui.handle('asset-overview-currency','USD');assert.match(markup(),/data-currency="USD"/);assert.match(hero(markup()),/70\.00/);assert.doesNotMatch(hero(markup()),/100\.00/);
}));
test('account and space scope changes clear old currency, dimension and range choices',async()=>withDocument(async markup=>{
 const ctx=context([hold('人民币基金','fund',100),hold('美元股票','stock',70,{currency:'USD'})]),ui=createAssetsUI(ctx);ui.render();
 for(const field of ['space','owner']){await ui.handle('asset-overview-currency','USD');await ui.handle('asset-overview-dimension','account');await ui.handle('asset-overview-range','12');if(field==='space')ctx.space='demo';else ctx.account.user.id='different-owner';const html=ui.render();assert.match(html,/data-currency="CNY"/);assert.match(html,/data-action="asset-overview-dimension:category" aria-pressed="true"/);assert.match(html,/data-action="asset-overview-range:6" aria-pressed="true"/);}
}));
test('one-cent snapshot conflicts are visible in the public history warning and not drawn as valid points',()=>{
 const ctx=context([snap('same-date-a','2026-10-01',{totalValue:100}),snap('same-date-b','2026-10-01',{totalValue:100.01}),snap('dual-conflict','2026-10-02',{totalValue:200.01,assetValue:210,liabilityValue:10})]);
 const html=createAssetsUI(ctx).render();assert.match(html,/1 个日期的快照净额冲突/);assert.match(html,/1 条快照缺少完整净额或金额口径不一致/);assert.doesNotMatch(html,/<svg/);assert.match(html,/还没有可比较的净额快照/);
});
test('financial account names from records remain escaped in the rendered distribution',async()=>withDocument(async markup=>{
 const ctx=context([hold('基金','fund',100,{accountId:'unsafe-account'}),record('asset_account','unsafe-account',{title:'<img src=x onerror=evil>',includeInTotal:false})]),ui=createAssetsUI(ctx);ui.render();await ui.handle('asset-overview-dimension','account');assert.match(markup(),/&lt;img src=x onerror=evil&gt;/);assert.doesNotMatch(markup(),/<img src=x/);
}));
