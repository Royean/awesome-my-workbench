import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOriginals,filterOriginals,originalType} from '../public/originals.js';
const a={id:'a',kind:'file',title:'报告',name:'CHECKUP.PDF',note:'成都 复查',date:'2026-10-25',mime:'application/pdf',size:1024};
const b={id:'b',kind:'file',title:'照片',name:'photo.png',note:'成都',date:'2026-11-01',mime:'image/png',size:2048};
const c={id:'c',kind:'file',title:'文字',name:'notes.txt',note:'原文',date:'2026-11-01',mime:'text/plain',size:12};
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function context(workbench='health'){return {workbench,space:'personal',account:{user:{id:'fictional-owner'}},today:'2026-11-02',items:[a,b,c],esc,icon:()=>'',btn:(label,action)=>`<button data-action="${action}">${label}</button>`,field:(label,name,value,type,extra)=>`<input aria-label="${label}" name="${name}" type="${type}" value="${value}" ${extra}>`,previews:{thumb:f=>`<button data-file-thumb="${f.id}">缩略图</button>`,mount(){},cleanupThumbs(){}},openDrawer(){},healthOriginalAction:()=>'<button>查看就诊报告</button>'};}

test('original search combines filename, title, note, type, date and stable pagination ordering',()=>{
 assert.deepEqual(filterOriginals([a,b,c],{query:'checkup'}).map(x=>x.id),['a']);
 assert.deepEqual(filterOriginals([a,b,c],{query:'成都',fileType:'pdf',from:'2026-10-01',to:'2026-10-31'}).map(x=>x.id),['a']);
 assert.deepEqual(filterOriginals([a,b,c]).map(x=>x.id),['c','b','a']);
 assert.equal(originalType({...a,mime:'audio/webm'}),'audio');assert.equal(originalType(c),'text');
 assert.deepEqual(filterOriginals([a,b,c],{relation:'unassigned'},{a:{id:'trip'},b:{id:''},c:{id:''}}).map(x=>x.id),['c','b']);
});
test('one original browser renders previews and filters for all workbench types, preserving health report actions',()=>{
 for(const type of ['health','finance','travel','fictional-custom']){const ctx=context(type),ui=createOriginals(ctx),html=ui.render();assert.match(html,/搜索资料原件/);assert.match(html,/文件类型/);assert.match(html,/起始日期/);assert.match(html,/下载报告/);assert.match(html,/original-preview:a/);assert.match(html,/上传资料/);assert.equal(html.includes('查看就诊报告'),type==='health');if(type==='travel')assert.match(html,/未关联旅行/);}
});
test('original metadata is escaped, file URLs stay same-origin and unassigned travel files remain visible without trips',()=>{
 const ctx=context('travel');ctx.items=[{...a,title:'<img onerror=attack()>',note:'<script>attack</script>'}];const html=createOriginals(ctx).render();assert.doesNotMatch(html,/<script>|<img onerror/);assert.match(html,/&lt;script&gt;/);assert.match(html,/\/api\/files\/a\?space=personal&workbench=travel/);assert.match(html,/data-file-thumb="a"/);
});
test('large original lists show fifty per page while retaining the complete filtered count',()=>{
 const ctx=context('finance');ctx.items=Array.from({length:131},(_,i)=>({...a,id:'fictional-'+String(i).padStart(3,'0')}));const html=createOriginals(ctx).render();assert.match(html,/131 份/);assert.equal((html.match(/class="original-record"/g)||[]).length,50);assert.match(html,/original-next/);
});
test('standalone travel uploads offer unassigned originals without requiring a trip',async()=>{
 const ctx=context('travel');ctx.items.push({kind:'travel_trip',id:'trip',title:'虚构旅行'});let opened='';ctx.openDrawer=html=>opened=html;const form={};const previous=globalThis.document;globalThis.document={querySelector:()=>form};try{const ui=createOriginals(ctx);ui.render({defaultTripId:'trip'});await ui.handle('original-reset'); // reset means all, then the relation picker selects unassigned.
 // Render with no default trip reproduces the no-trip/MCP intake case.
 ui.cleanup();ui.render();await ui.handle('original-upload');assert.match(opened,/<option value="">未关联旅行<\/option>/);assert.doesNotMatch(opened,/<option value="trip" selected/);
 }finally{globalThis.document=previous;}
});
test('switching owner clears metadata filter state and never leaks old relationship names',()=>{
 const ctx=context('travel');ctx.items.push({kind:'travel_trip',id:'trip',title:'旧账号行程'});const ui=createOriginals(ctx);const first=ui.render({defaultTripId:'trip'});assert.match(first,/旧账号行程/);ctx.account.user.id='new-fictional';ctx.items=[];const second=ui.render();assert.doesNotMatch(second,/旧账号行程|CHECKUP/);assert.match(second,/还没有资料原件/);
});

test('changing owner during file reading prevents a stale original upload',async()=>{
 const ctx=context('finance');let writes=0,reader;ctx.api=async()=>{writes++;};
 const original={document:globalThis.document,FormData:globalThis.FormData,FileReader:globalThis.FileReader};
 const errorBox={innerHTML:''},button={disabled:false,isConnected:true},form={isConnected:true,elements:{file:{files:[{name:'fictional.txt',size:4}]}},querySelector:()=>errorBox};
 globalThis.document={querySelector:selector=>selector==='#original-form'?form:button};
 globalThis.FormData=class{*[Symbol.iterator](){yield ['title','虚构'];yield ['date','2026-11-02'];yield ['note',''];}};
 globalThis.FileReader=class{constructor(){reader=this;}readAsDataURL(){}};
 try{const ui=createOriginals(ctx);ui.render();await ui.handle('original-upload');const submitted=form.onsubmit({preventDefault(){}});ctx.account.user.id='another-fictional-owner';reader.result='data:text/plain;base64,dGVzdA==';reader.onload();await submitted;assert.equal(writes,0);assert.match(errorBox.innerHTML,/工作台或账号已变化/);}finally{Object.assign(globalThis,original);}
});

test('reset in health pending intake keeps linked originals outside the pending tab',async()=>{
 const ctx=context('health');ctx.items=[{...a,visitId:'visit'},b,{kind:'visit',id:'visit',title:'虚构就诊'}];const ui=createOriginals(ctx),opts={defaultStatus:'unlinked'};
 assert.doesNotMatch(ui.render(opts),/original-preview:a/);const previous=globalThis.document;globalThis.document={querySelector:()=>null};try{await ui.handle('original-reset');const html=ui.render(opts);assert.doesNotMatch(html,/original-preview:a/);assert.match(html,/original-preview:b/);assert.doesNotMatch(html,/id="original-status"/);}finally{globalThis.document=previous;}
});

test('editing unassigned travel metadata preserves its missing trip rather than inheriting the current trip',async()=>{
 const ctx=context('travel');ctx.items.push({kind:'travel_trip',id:'trip',title:'虚构旅行'});let html='';ctx.openDrawer=value=>html=value;const oldDocument=globalThis.document;globalThis.document={querySelector:()=>({})};try{const ui=createOriginals(ctx);ui.render({defaultTripId:'trip'});await ui.handle('original-edit','a');assert.match(html,/<option value="">未关联旅行<\/option>/);assert.doesNotMatch(html,/<option value="trip" selected/);}finally{globalThis.document=oldDocument;}
});
