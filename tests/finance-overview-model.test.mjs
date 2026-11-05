import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildFinanceOverview,financeDistribution,financeSnapshots,createAssetOverview} from '../public/asset-overview.js';
const today='2026-11-05';
const holding=(id,value,extra={})=>({id,kind:'asset_holding',date:today,title:id,currency:'CNY',category:'fund',status:'active',value,...extra});
const snapshot=(date,totalValue,extra={})=>({kind:'asset_snapshot',date,currency:'CNY',totalValue,...extra});
test('overview and distribution retain account opt-in, group and currency boundaries, missing debt blocks net',()=>{
 const rows=[holding('fund',90),holding('equipment',30,{assetGroup:'fixed',category:'equipment'}),holding('usd',500,{currency:'USD'}),holding('missing',null,{assetGroup:'fixed'}),holding('closed',1000,{status:'closed'}),holding('pending',900,{status:'pending'}),{id:'account',kind:'asset_account',currency:'CNY',balance:10,includeInTotal:true},{kind:'asset_account',balance:500,includeInTotal:false},{kind:'asset_liability',currency:'CNY',balance:null,status:'pending'}];
 const before=JSON.stringify(rows),m=buildFinanceOverview(rows,today,'CNY');assert.equal(m.assets,130);assert.equal(m.net,null);assert.equal(m.total.unknownLiabilities,1);assert.equal(m.segments[0].value,100);assert.equal(m.segments[1].value,30);assert.equal(m.missing.length,1);assert.equal(m.pending.length,1);
 const category=financeDistribution(m);assert.equal(category[0].percent,90);assert.equal(category[1].percent,10);assert.equal(financeDistribution(m,'account').length,2);
 const currencies=financeDistribution(m,'currency');assert.deepEqual(currencies.map(x=>[x.currency,x.value,x.percent]),[['CNY',100,null],['USD',500,null]]);assert.equal(JSON.stringify(rows),before);
});
test('no values stays unknown while explicit zero and negative net remain meaningful',()=>{
 assert.equal(buildFinanceOverview([],today).net,null);assert.equal(buildFinanceOverview([holding('missing',null)],today).assets,null);
 const m=buildFinanceOverview([holding('zero',0),{kind:'asset_liability',balance:50,currency:'CNY'}],today);assert.equal(m.assets,0);assert.equal(m.net,-50);assert.equal(financeDistribution(m)[0].percent,null);
});
test('snapshots ignore future, partial, inconsistent, pending and other-currency data; conflicting dates never become chosen points',()=>{
 const rows=[snapshot('2026-06-01',-20),snapshot('2026-07-01',0),snapshot('2026-07-01',0),snapshot('2026-08-01',50),snapshot('2026-08-01',60),snapshot('2026-09-01',undefined,{assetValue:120,liabilityValue:20}),snapshot('2026-09-20',30,{assetValue:90,liabilityValue:30}),snapshot('2026-10-01',undefined,{assetValue:100}),snapshot('2026-11-06',999),snapshot('2026-10-10',600,{status:'pending'}),snapshot('2026-10-11',700,{currency:'USD'})];
 const history=financeSnapshots(rows,'CNY',today);assert.deepEqual(history.points,[{date:'2026-06-01',value:-20},{date:'2026-07-01',value:0},{date:'2026-09-01',value:100}]);assert.equal(history.delta,100);assert.equal(history.conflicts,1);assert.equal(history.invalid,2);
});
test('six months and one year are calendar windows and do not interpolate missing months',()=>{
 const rows=[snapshot('2026-01-01',10),snapshot('2026-05-31',20),snapshot('2026-06-01',30),snapshot(today,40)];assert.equal(financeSnapshots(rows,'CNY',today,6).points.length,2);assert.equal(financeSnapshots(rows,'CNY',today,12).points.length,4);assert.equal(financeSnapshots([snapshot(today,0)],'CNY',today).delta,null);
});
test('render handles empty/single-point histories honestly and escapes account titles',()=>{
 const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const ctx={items:[snapshot(today,0)],today,space:'personal',workbench:'finance',esc,icon:()=>'',btn:(label,action)=>`<button data-action="${esc(action)}">${esc(label)}</button>`};
 const ui=createAssetOverview(ctx);const html=ui.render();assert.match(html,/已有 1 次净额快照/);assert.doesNotMatch(html,/<svg/);assert.match(html,/asset-add:asset_snapshot/);
 ctx.items=[holding('fund',10,{accountId:'account'}),{id:'account',kind:'asset_account',title:'<script>evil</script>',includeInTotal:false}];const saved=globalThis.document;globalThis.document={querySelector:()=>null};try{ui.handle('asset-overview-dimension','account');assert.match(ui.render(),/&lt;script&gt;evil/);assert.doesNotMatch(ui.render(),/<script>/);}finally{if(saved===undefined)delete globalThis.document;else globalThis.document=saved;}
});

test('snapshot conflicts retain one-cent differences at either magnitude and tolerate arithmetic precision noise',()=>{
 for(const amount of [100,200]){const h=financeSnapshots([snapshot('2026-10-01',amount),snapshot('2026-10-01',amount+.01)],'CNY',today);assert.equal(h.conflicts,1);assert.equal(h.points.length,0);const dual=financeSnapshots([snapshot('2026-10-01',amount+.01,{assetValue:amount+10,liabilityValue:10})],'CNY',today);assert.equal(dual.invalid,1);}
 assert.equal(financeSnapshots([snapshot('2026-10-01',.3,{assetValue:.1+.2,liabilityValue:0})],'CNY',today).points.length,1);
});
