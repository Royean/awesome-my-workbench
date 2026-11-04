import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const renderSource=source.slice(source.indexOf('function taskRows('),source.indexOf('function detail('));
function render(items,today='2026-12-31'){
 const context=vm.createContext({items,today,settings:{},metricType:'weight',metricNames:{weight:'Weight',sleep:'Sleep',heart:'Heart'},units:{weight:'kg'},aiTag:()=>'',byKind:kind=>items.filter(x=>x.kind===kind),sorted:a=>a,
  esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  icon:()=>'',catClass:()=>'',dateLabel:d=>d,quick:{launcher:()=>''},stats:()=>'',medical:{todayCard:()=>''},trendCard:()=>'',empty:(kind,message)=>`empty:${kind}:${message}`});
 return vm.runInContext(renderSource+'\ndashboard()',context);
}
const task=(id,date,time='',done=false)=>({id,title:id,kind:'task',date,time,done});
test('future tasks appear without any task today, including next year',()=>{
 const html=render([task('next-year','2027-01-02','09:00'),task('tomorrow','2027-01-01','08:00')]);
 assert.match(html,/近期.*待办/);assert.match(html,/2 项未完成/);
 assert.ok(html.indexOf('<strong>tomorrow</strong>')<html.indexOf('<strong>next-year</strong>'));
 assert.match(html,/08:00 · 2027-01-01/);assert.doesNotMatch(html,/empty:task|已逾期|完成进度/);
});
test('overdue, today and future tasks sort by date then time; completed tasks stay out',()=>{
 const input=[task('future','2027-01-01'),task('late','2026-12-31','18:00'),task('finished','2026-12-30','',true),task('early','2026-12-31','08:00'),task('overdue','2026-12-30')];
 const before=structuredClone(input),html=render(input);
 const titles=[...html.matchAll(/<strong>(.*?)<\/strong>/g)].map(x=>x[1]);
 assert.deepEqual(titles,['overdue','early','late','future']);assert.deepEqual(input,before);
 assert.match(html,/2026-12-30 · 已逾期/);assert.match(html,/08:00 · 今天/);assert.match(html,/4 项未完成/);
 assert.match(html,/data-action="toggle:future"/);assert.match(html,/data-action="edit:future"/);
});
test('show at most five, count all pending, and completing one lets the next task appear',()=>{
 const input=Array.from({length:7},(_,i)=>task(`task-${i+1}`,`2027-01-0${i+1}`));
 let html=render(input);assert.match(html,/7 项未完成/);assert.match(html,/仅显示最近 5 项/);assert.match(html,/data-action="nav:dashboard\/tasks"/);
 assert.equal((html.match(/class="task-row /g)||[]).length,5);assert.doesNotMatch(html,/<strong>task-6<\/strong>/);
 input[0].done=true;html=render(input);assert.doesNotMatch(html,/<strong>task-1<\/strong>/);assert.match(html,/<strong>task-6<\/strong>/);assert.match(html,/6 项未完成/);
});
test('empty and all-completed states invite an upcoming task; titles stay escaped',()=>{
 for(const input of [[],[task('finished','2027-01-01','',true)]]){
  const html=render(input);assert.match(html,/0 项未完成/);assert.match(html,/安排一件接下来要做的事/);assert.doesNotMatch(html,/仅显示最近|完成进度/);
 }
 assert.match(render([task('<script>','2027-01-01')]),/<strong>&lt;script&gt;<\/strong>/);
});
