import {test} from 'node:test';
import assert from 'node:assert/strict';
import {enrichAssetHolding,assetGroup,assetDeadline} from '../public/asset-lifecycle.js';
const source={id:'DOM-FAKE',name:'fictional.invalid',registrar:'Fictional Registrar',expires_on:'2027-02-28',renewal_price:null,currency:'CNY',auto_renew:null,notes:'Literal newline\ninside a JSON string and path C:\\fictional'};
const record=(extra={})=>({id:'fictional',kind:'asset_holding',title:'虚构资产',date:'2026-11-01',currency:'CNY',category:'subscription',status:'active',externalId:'github:fixed:DOM-FAKE',note:JSON.stringify({'原始固定资产':source},null,2),...extra});

test('legacy fixed asset notes are read-only, typed and refined without creating an estimate',()=>{
 const raw=record(),before=JSON.stringify(raw),x=enrichAssetHolding(raw);
 assert.equal(x.category,'domain');assert.equal(x.assetGroup,'fixed');assert.equal(x.expiresOn,'2027-02-28');assert.equal(x.identifier,'fictional.invalid');assert.equal(x.provider,'Fictional Registrar');
 assert.equal(x.renewalMode,'unknown');assert.equal(x.renewalAmount,undefined);assert.equal(x.value,undefined);assert.equal(x.cost,undefined);assert.equal(x.quantity,undefined);assert.equal(JSON.stringify(raw),before);
 assert.equal(enrichAssetHolding(record({note:raw.note.replaceAll('\n','\\n')})).expiresOn,'2027-02-28');
 const server=record({externalId:'github:fixed:SRV-FAKE',category:'equipment',note:JSON.stringify({'原始固定资产':{id:'SRV-FAKE',renewal_on:'2027-03-01',provider:'Fictional Cloud'}})});
 const s=enrichAssetHolding(server);assert.equal(s.category,'server');assert.equal(s.renewalOn,'2027-03-01');assert.equal(s.expiresOn,undefined);
});
test('explicit values and cleared fields override legacy values; malformed sources never become dates',()=>{
 const x=enrichAssetHolding(record({expiresOn:'',renewalOn:'',provider:'',identifier:'',renewalAmount:null,renewalCurrency:'',renewalMode:'manual',assetGroup:'other'}));
 for(const key of ['expiresOn','renewalOn','provider','identifier','renewalCurrency'])assert.equal(x[key],'');assert.equal(x.renewalAmount,null);assert.equal(x.assetGroup,'other');assert.equal(x.renewalMode,'manual');
 for(const patch of [{note:'not JSON'},{externalId:'github:fixed:OTHER'},{note:JSON.stringify({'原始固定资产':{...source,expires_on:'2027-02-30'}})}])assert.equal(enrichAssetHolding(record(patch)).expiresOn,undefined);
 assert.equal(assetGroup({kind:'asset_holding',category:'fund'}),'financial');assert.equal(assetGroup({kind:'asset_holding',category:'vehicle'}),'fixed');assert.equal(assetGroup({kind:'asset_holding',category:'other'}),'other');
});
test('deadline states use calendar days across years, keep renewal distinct and never invent missing dates',()=>{
 const holding={kind:'asset_holding',category:'server',status:'active'};
 assert.deepEqual(assetDeadline({...holding,renewalOn:'2027-01-01'},'2026-12-31'),{date:'2027-01-01',kind:'renewal',days:1,status:'soon',eligible:true});
 for(const [date,days,status] of [['2026-10-31',-1,'overdue'],['2026-11-01',0,'soon'],['2026-12-01',30,'soon'],['2026-12-02',31,'later']]){const d=assetDeadline({...holding,expiresOn:date},'2026-11-01');assert.equal(d.days,days);assert.equal(d.status,status);}
 assert.equal(assetDeadline({...holding,expiresOn:'2024-03-01'},'2024-02-28').days,2);
 assert.equal(assetDeadline({...holding,renewalOn:'2027-01-01',expiresOn:'2027-01-02'},'2026-12-31').kind,'renewal');
 assert.equal(assetDeadline({...holding,status:'closed',expiresOn:'2026-01-01'},'2026-11-01').eligible,false);
 assert.equal(assetDeadline(holding,'2026-11-01').status,'unknown');assert.equal(assetDeadline(holding,'2026-11-01').date,null);
 assert.equal(assetDeadline({...holding,category:'property',expiresOn:'',renewalOn:''},'2026-11-01').eligible,false);
});

test('financial import provenance keeps uncategorized financial holdings in finance without guessing value',()=>{
 const row={kind:'asset_holding',category:'other',status:'pending',externalId:'github:holding:FAKE-BOND',note:JSON.stringify({'资产原始信息':{asset_id:'FAKE-BOND',asset_class:'可转债'}})};
 const out=enrichAssetHolding(row);assert.equal(out.assetGroup,'financial');assert.equal(out.category,'other');assert.equal(out.value,undefined);assert.equal(out.status,'pending');
 assert.equal(enrichAssetHolding({...row,assetGroup:'other'}).assetGroup,'other');
 assert.equal(enrichAssetHolding({...row,externalId:'github:holding:OTHER'}).assetGroup,'other');
});
