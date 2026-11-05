import {institutionMark} from '../public/provider-ui.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {latestHealthRecord,healthRecordDate,healthRecordStatus} from '../public/latest-health.js';

test('latest record uses recorded date/time, excludes future observations and does not mutate input',()=>{
 const items=[{id:'old',kind:'meal',date:'2025-12-30',time:'20:00'},{id:'future',kind:'meal',date:'2026-01-02'},
 {id:'early',kind:'meal',date:'2025-12-31',time:'08:00'},{id:'late',kind:'meal',date:'2025-12-31',time:'19:30'},
 {id:'exercise',kind:'exercise',date:'2026-01-01'}];
 const before=structuredClone(items);assert.equal(latestHealthRecord(items,'meal','2026-01-01').id,'late');assert.deepEqual(items,before);
 assert.equal(latestHealthRecord(items,'metric','2026-01-01'),undefined);
});
test('metric type and report/file selection retain separate histories; attachment images are not reports',()=>{
 const items=[{id:'pressure',kind:'metric',type:'pressure',date:'2026-01-01'},
 {id:'weight',kind:'metric',type:'weight',date:'2025-10-28'},
 {id:'report',kind:'report',date:'2025-11-01'},{id:'file',kind:'file',date:'2025-12-01'},
 {id:'photo',kind:'file',fileCategory:'餐食附件',date:'2026-01-01'},
 {id:'drug',kind:'file',fileCategory:'药品图片',date:'2026-01-01'}];
 assert.equal(latestHealthRecord(items,'metric','2026-01-01','weight').id,'weight');
 assert.equal(latestHealthRecord(items,['report','file'],'2026-01-01').id,'file');
});
test('date labels handle Shanghai-provided day across year and leap-day boundaries without relabeling history as today',()=>{
 assert.equal(healthRecordDate({date:'2025-12-31',time:'18:30'},'2026-01-01'),'昨天 · 18:30');
 assert.equal(healthRecordDate({date:'2024-02-29'},'2024-03-01'),'昨天');
 assert.equal(healthRecordDate({date:'2025-01-01',time:'08:00'},'2026-01-01'),'2025-01-01 · 08:00');
 assert.equal(healthRecordDate({date:'2026-01-01'},'2026-01-01'),'今天');
 assert.equal(healthRecordStatus({date:'2025-12-31'},'2026-01-01'),'今天还未记录');
});

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function dashboard(items){
 const ctx=vm.createContext({institutionMark,items,today:'2026-01-01',settings:{},layoutUI:{options:()=>({})},metricType:'weight',
  metricNames:{weight:'体重',sleep:'睡眠',heart:'心率'},units:{weight:'kg'},latestHealthRecord,healthRecordDate,healthRecordStatus,
  sorted:a=>[...a].sort((a,b)=>b.date.localeCompare(a.date)),byKind:k=>items.filter(x=>x.kind===k),
  esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  icon:()=>'',aiTag:()=>'',catClass:()=>'',dateLabel:x=>x,trendCard:()=>'<section class="card"><div class="tabs"></div></section>',medical:{todayCard:()=>''}});
 return vm.runInContext(source.slice(source.indexOf('function taskRows('),source.indexOf('function detail('))+'\ndashboard()',ctx);
}
test('dashboard keeps infrequent history while today water and weekly exercise remain zero',()=>{
 const old='2025-10-28';const html=dashboard([
  {id:'meal',kind:'meal',date:old,title:'历史晚餐',mealType:'晚餐',time:'18:30'},
  {id:'exercise',kind:'exercise',date:old,title:'历史跑步',duration:45},
  {id:'visit',kind:'visit',date:old,title:'历史就诊',hospital:'历史医院'},
  {id:'report',kind:'report',date:old,title:'历史报告'},
  {id:'water',kind:'water',date:old,volume:500},
  {id:'task',kind:'task',date:'2026-02-01',title:'未来复查',done:false}]);
 for(const title of ['历史晚餐','历史跑步','历史就诊','历史报告','未来复查'])assert.ok(html.includes(title),title);
 assert.match(html,/今日饮水0毫升/);assert.match(html,/health-exercise-total"><b>0<\/b>/);
 assert.match(html,/2025-10-28 · 18:30/);assert.match(html,/45 分钟/);assert.match(html,/今天还未记录/);
});
test('empty classes have their own state; rendered record text remains escaped',()=>{
 const empty=dashboard([]);for(const text of ['还没有餐食记录','还没有运动记录','还没有保存就诊记录','还没有报告或资料'])assert.ok(empty.includes(text),text);
 const html=dashboard([{id:'meal',kind:'meal',title:'<img onerror=alert(1)>',date:'2026-01-01'}]);
 assert.match(html,/&lt;img onerror=alert\(1\)&gt;/);assert.doesNotMatch(html,/<img onerror/);
});
test('range with no measurements retains an explicitly dated latest value instead of a blank graph',()=>{
 const chartSource=source.slice(source.indexOf('function chart('),source.indexOf('function taskRows('));
 const records=[{kind:'metric',type:'weight',date:'2025-10-28',value:65,unit:'kg'}];
 const ctx=vm.createContext({institutionMark,items:records,today:'2026-01-01',range:14,metricType:'weight',metricNames:{weight:'体重'},units:{weight:'kg'},
  latestHealthRecord,healthRecordDate,byKind:()=>records,esc:String});
 const html=vm.runInContext(chartSource+'\nchart()',ctx);
 assert.match(html,/近 14 天暂无体重记录/);assert.match(html,/最近一次：65 kg/);assert.match(html,/2025-10-28/);
 assert.doesNotMatch(html,/<svg|记录一次/);
});
