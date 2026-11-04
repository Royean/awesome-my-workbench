import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderComponentCard} from '../public/component-card.js';

const card=block=>renderComponentCard({title:'虚构组件',blocks:[block]});
const heights=html=>[...html.matchAll(/<rect class="component-chart-bar[^>]* height="([\d.]+)"/g)].map(match=>Number(match[1]));

test('bar chart represents recorded ratios and zero without a minimum visible bar',()=>{
 const html=card({type:'chart',chart:'bar',label:'运动时长',unit:'分钟',points:[{date:'1',value:10},{date:'2',value:20},{date:'3',value:0}]});
 const actual=heights(html);assert.equal(actual.length,3);assert.equal(actual[2],0);assert.equal(actual[1],actual[0]*2);
 assert.match(html,/3：0 分钟/);assert.doesNotMatch(html,/NaN|Infinity/);
});

test('negative bars use the common zero baseline and missing samples are not drawn as zeros',()=>{
 const html=card({type:'chart',chart:'bar',points:[{date:'a',value:-10},{date:'b',value:20},{date:'c',value:null}]});
 const zero=Number(/component-chart-zero"[^>]* y1="([\d.]+)"/.exec(html)[1]);
 const bars=[...html.matchAll(/<rect class="component-chart-bar[^>]* y="([\d.]+)"[^>]* height="([\d.]+)"/g)].map(m=>({y:Number(m[1]),h:Number(m[2])}));
 assert.equal(bars.length,2);assert.equal(bars[0].y,zero);assert.ok(Math.abs(bars[1].y+bars[1].h-zero)<.002);assert.ok(Math.abs(bars[1].h-bars[0].h*2)<.002);assert.match(html,/<dt>c<\/dt><dd>暂无数据/);
});

test('line chart does not bridge unknown observations and retains valid single samples',()=>{
 const html=card({type:'chart',chart:'line',points:[{date:'a',value:1},{date:'b',value:null},{date:'c',value:2}]});
 assert.equal((html.match(/class="component-chart-line"/g)||[]).length,2);assert.equal((html.match(/class="component-chart-point"/g)||[]).length,2);
 const empty=card({type:'chart',chart:'line',points:[{value:null},{value:NaN}]});assert.doesNotMatch(empty,/<svg/);assert.match(empty,/还没有可展示的数据/);
 const zero=card({type:'chart',points:[{value:0},{value:0}]});assert.deepEqual(heights(zero),[0,0]);assert.doesNotMatch(zero,/NaN|Infinity/);
});

test('null stat stays unknown; zero remains a recorded zero; large finite graph values have finite geometry',()=>{
 assert.match(card({type:'stat',value:null}),/component-stat-value">—/);assert.match(card({type:'stat',value:0}),/component-stat-value">0/);
 assert.match(card({type:'stat',value:1e-12}),/component-stat-value">1e-12/);assert.match(card({type:'stat',value:-0}),/component-stat-value">0/);
 const html=card({type:'chart',points:[{value:Number.MAX_VALUE},{value:-Number.MAX_VALUE},{value:Infinity}]});assert.doesNotMatch(html,/="(?:NaN|Infinity|-Infinity)/);assert.equal(heights(html).length,2);
});

test('progress preserves the actual value while limiting only visual fill; missing target is explicit',()=>{
 const overflow=card({type:'progress',value:2500,target:2000,unit:'ml'});assert.match(overflow,/2,500/);assert.match(overflow,/width:100%/);assert.match(overflow,/aria-valuenow="100"/);
 const negative=card({type:'progress',value:-10,target:100});assert.match(negative,/width:0%/);assert.match(negative,/>-10/);
 const noGoal=card({type:'progress',value:10,target:0});assert.match(noGoal,/目标未设置/);assert.doesNotMatch(noGoal,/role="progressbar"/);
 const unknown=card({type:'progress',value:null,target:100});assert.match(unknown,/尚未记录/);assert.doesNotMatch(unknown,/aria-valuenow/);
});

test('all text surfaces escape markup and style/action options are allowlisted',()=>{
 const attack='<img src=x onerror="alert(1)">';
 const html=renderComponentCard({title:attack,description:attack,source:{name:attack},appearance:{accent:'red; background:url(https://bad.invalid)',tone:'"><script>',density:'"><script>'},blocks:[{type:'stat',label:attack,value:attack,unit:attack,detail:attack},{type:'list',label:attack,items:[{title:attack,date:attack,detail:attack}]},{type:'chart',label:attack,points:[{label:attack,value:1}]}]},{componentId:'"><script>',showManage:true});
 assert.doesNotMatch(html,/<img|<script|--component-accent:|data-action=|url\(/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/href=/);
 const id='12345678-1234-1234-1234-123456789abc';
 assert.match(renderComponentCard({title:'样本'},{componentId:id,showManage:true}),new RegExp('data-action="component-open:'+id+'"'));
 assert.doesNotMatch(renderComponentCard({title:'样本'},{componentId:id,showManage:true,readOnly:true}),/data-action=/);
 assert.match(renderComponentCard({appearance:{accent:'#77BC32'}}),/--component-accent:#77BC32/);
 assert.match(renderComponentCard({appearance:{accent:'#FFFFFF'}}),/--component-data-ink:#8c8c8c/);
 assert.match(renderComponentCard({appearance:{accent:'#000000'}}),/--component-data-ink:#000000/);
});

test('chart and progress retain numeric data and escape partial-data explanations',()=>{
 const note='1条记录未填写数值 <script>alert(1)</script>';
 const html=renderComponentCard({title:'部分记录',layout:'stack',appearance:{accent:null,tone:'neutral',density:'comfortable'},blocks:[{id:'chart',type:'chart',label:'每日合计',chart:'bar',points:[{date:'2026-11-04',value:5}],detail:note},{id:'goal',type:'progress',label:'目标',value:5,target:10,detail:note}]});
 assert.equal((html.match(/1条记录未填写数值 &lt;script&gt;/g)||[]).length,2);
 assert.doesNotMatch(html,/<script>/);assert.match(html,/aria-valuenow="50"/);assert.match(html,/height="148"/);
});
