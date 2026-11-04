import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAssetsUI,assetRowsForPage,calculateAssetTotals,assetRenewalCost} from '../public/assets.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fixture=page=>({page,items:[],today:'2026-11-02',workbench:'finance',space:'personal',account:{user:{id:'fictional-owner'}},esc,icon:()=>'',btn:(label,action)=>`<button data-action="${esc(action)}">${esc(label)}</button>`,field:()=>''});
const asset=(id,category,extra={})=>({id,kind:'asset_holding',category,title:id,date:'2026-10-01',status:'active',currency:'CNY',...extra});
test('financial and fixed sections separate holdings without changing totals or original rows',()=>{
 const rows=[asset('cash','cash',{value:90}),asset('server','server',{renewalAmount:199}),asset('domain','domain'),asset('custom','other',{assetGroup:'financial',value:10})];
 assert.deepEqual(assetRowsForPage(rows,'financial').map(x=>x.id),['cash','custom']);assert.deepEqual(assetRowsForPage(rows,'fixed').map(x=>x.id),['server','domain']);assert.equal(assetRowsForPage(rows,'holdings').length,4);assert.equal(calculateAssetTotals(rows)[0].assets,100);assert.equal(rows[1].assetGroup,undefined);
});
test('fixed list shows distinct renewal or expiry labels, provider, identifier and unknown valuations',()=>{
 const c=fixture('fixed');c.items=[asset('server','server',{provider:'Fictional cloud',identifier:'FAKE-001',renewalOn:'2032-04-17'}),asset('domain','domain',{expiresOn:'2032-09-08'})];const html=createAssetsUI(c).render();
 assert.match(html,/固定资产/);assert.match(html,/服务器/);assert.match(html,/域名/);assert.match(html,/Fictional cloud/);assert.match(html,/FAKE-001/);assert.match(html,/续费日 2032-04-17/);assert.match(html,/到期日 2032-09-08/);assert.match(html,/未填写/);assert.doesNotMatch(html,/CNY.*0\.00/);
});
test('renewal page excludes closed and nonrenewable unknown financial assets',()=>{
 const c=fixture('renewals');c.items=[asset('overdue-domain','domain',{expiresOn:'2026-11-01'}),asset('today-server','server',{renewalOn:c.today}),asset('unknown-domain','domain'),asset('closed-server','server',{renewalOn:c.today,status:'closed'}),asset('plain-stock','stock'),asset('plain-property','property')];
 const html=createAssetsUI(c).render();assert.match(html,/overdue-domain/);assert.match(html,/记录日期已过 1 天/);assert.match(html,/续费日 2026-11-02 · 今天/);assert.match(html,/unknown-domain/);assert.match(html,/日期待补/);assert.doesNotMatch(html,/closed-server|plain-stock|plain-property/);assert.match(html,/按到期状态筛选/);
});
test('dashboard has financial, fixed and due entry points while renewal fees never inflate valuation',()=>{
 const c=fixture('dashboard');c.items=[asset('server','server',{renewalOn:'2026-11-03',renewalAmount:599,renewalCurrency:'USD'})];const html=createAssetsUI(c).render();for(const route of ['financial','fixed','renewals'])assert.match(html,new RegExp('nav:'+route));assert.match(html,/近期到期与续费/);assert.match(html,/续费参考/);assert.equal(calculateAssetTotals(c.items)[0].assets,0);
});
test('asset descriptions escape lifecycle values and shared originals remain available',()=>{
 const c=fixture('fixed');c.items=[asset('<script>title</script>','domain',{provider:'<img src=x onerror=evil>',identifier:'<svg>',expiresOn:'2027-01-01'})];assert.doesNotMatch(createAssetsUI(c).render(),/<script>|<img|<svg>/);c.page='documents';c.originals={render:()=>'<p>shared originals</p>'};assert.match(createAssetsUI(c).render(),/shared originals/);
});
test('new fixed forms default to a server and keep unknown fees and lifecycle fields blank',async()=>{
 const c=fixture('fixed'),fields=[];c.field=(label,name,value,type,attrs)=>{fields.push({label,name,value,type,attrs});return '';};let markup='';c.openDrawer=html=>{markup=html;};c.toast=()=>{};const previous=globalThis.document;globalThis.document={querySelector:()=>({})};
 try{await createAssetsUI(c).handle('asset-add','asset_holding');for(const name of ['expiresOn','renewalOn','renewalAmount'])assert.equal(fields.find(x=>x.name===name)?.value,'');assert.match(markup,/<option value="fixed" selected>/);assert.match(markup,/<option value="server" selected>/);assert.match(markup,/<option value="unknown" selected>/);assert.match(markup,/续费费用不计入资产估值/);}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
test('imported original fixed JSON supplies display dates without mutating the source object',()=>{
 const original=asset('legacy','subscription',{externalId:'github:fixed:DOM-FAKE',note:JSON.stringify({'原始固定资产':{id:'DOM-FAKE',name:'fictional.invalid',registrar:'Fictional registrar',expires_on:'2027-03-01',renewal_price:null,auto_renew:null}})}),before=JSON.stringify(original),c=fixture('fixed');c.items=[original];const html=createAssetsUI(c).render();assert.match(html,/域名/);assert.match(html,/到期日 2027-03-01/);assert.match(html,/fictional.invalid/);assert.equal(JSON.stringify(original),before);
});

test('renewal cost never guesses asset currency when the renewal currency is missing or explicitly cleared',()=>{
 for(const renewalCurrency of [undefined,'',null]){const x=asset('missing-currency','server',{renewalAmount:199,currency:'CNY',...(renewalCurrency===undefined?{}:{renewalCurrency})});assert.equal(assetRenewalCost(x),'199 · 币种待补');const c=fixture('fixed');c.items=[x];assert.match(createAssetsUI(c).render(),/续费参考 199 · 币种待补/);}
 assert.match(assetRenewalCost({renewalAmount:199,renewalCurrency:'USD'}),/199/);assert.equal(assetRenewalCost({renewalAmount:null,renewalCurrency:'CNY'}),'未知 / 未核实');
});
test('editing a reloaded asset preserves a cleared renewal currency and its detail states currency unknown',async()=>{
 const c=fixture('fixed'),fields=[];c.items=[asset('cleared','server',{renewalAmount:199,renewalCurrency:'',currency:'CNY'})];c.field=(label,name,value)=>{fields.push({name,value});return '';};let html='';c.openDrawer=markup=>{html=markup;};c.toast=()=>{};const previous=globalThis.document;globalThis.document={querySelector:()=>({})};try{const ui=createAssetsUI(c);await ui.handle('asset-edit','cleared');assert.equal(fields.find(x=>x.name==='renewalCurrency').value,'');await ui.handle('asset-detail','cleared');assert.match(html,/199 · 币种待补/);assert.doesNotMatch(html,/¥199/);}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
test('asset dashboard preserves currency groups, incomplete liabilities and account balance attribution',()=>{const c=fixture('dashboard');c.items=[asset('fund','fund',{value:100}),asset('dollar','stock',{value:70,currency:'USD'}),{id:'cash-account',kind:'asset_account',title:'计入的账户',currency:'CNY',balance:50,includeInTotal:true,date:c.today},{id:'debt',kind:'asset_liability',title:'待核对负债',currency:'CNY',balance:null,status:'pending',date:c.today}];const html=createAssetsUI(c).render();assert.match(html,/CNY · 已知资产估值/);assert.match(html,/USD · 已估值净额/);assert.match(html,/计入的账户余额/);assert.match(html,/待核实（1项）/);assert.match(html,/150\.00/);assert.match(html,/70\.00/);assert.match(html,/按币种分别统计，不自动换汇/);});
