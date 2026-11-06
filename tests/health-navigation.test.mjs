import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHealthRoute} from '../public/health-routes.js';
import {createMedical} from '../public/medical.js';
const esc=s=>String(s??'').replace(/[<>"']/g,'');
function medical(){return createMedical({items:[{id:'visit-one',kind:'visit',title:'Fictional visit',date:'2026-10-01',status:'已完成'},{id:'r',kind:'report',title:'Fictional report',date:'2026-10-01',visitId:'visit-one',content:'Fictional text'},{id:'f',kind:'file',title:'Fictional pending original',date:'2026-10-01'}],icon:()=>'',esc,field:()=>'',select:()=>'',btn:(name,action)=>`<button data-action="${action}">${name}</button>`,previews:{thumb:()=>''},fileIsLinked:()=>false,recordRows:files=>files.map(f=>f.title).join('|')});}
test('old file/task bookmarks normalize while visit detail and other routes are retained',()=>{
 assert.equal(normalizeHealthRoute('file'),'visit/files');assert.equal(normalizeHealthRoute('task'),'dashboard/tasks');
 for(const route of ['visit','visit/visit-one','visit/reports','visit/inbox','exercise','tasks','notes'])assert.equal(normalizeHealthRoute(route),route);
});
test('named medical routes remain usable and are never mistaken for missing visit IDs',()=>{
 globalThis.location={hash:'#visit/files'};const m=medical();let html=m.render();assert.match(html,/全部原件/);assert.match(html,/Fictional pending original/);assert.doesNotMatch(html,/找不到这次就诊/);
 location.hash='#visit/inbox';html=m.render();assert.match(html,/尚未关联的原件/);assert.match(html,/Fictional pending original/);
 location.hash='#visit/reports';html=m.render();assert.match(html,/Fictional report/);assert.match(html,/报告与资料/);
 location.hash='#visit/medications';assert.match(m.render(),/还没有用药方案/);
 location.hash='#visit/not-real';assert.match(m.render(),/找不到这次就诊/);
 delete globalThis.location;
});

test('report picker reacts to visit changes and requires an explicit compatible selection',async()=>{
 const originalDocument=globalThis.document,originalFormData=globalThis.FormData;
 const visit={value:'a'},file={value:'inferred',innerHTML:''},upload={files:[]},submit={};
 const notice={},uploadState={},error={};
 const fields={'#report-upload':upload,'#report-original-notice':notice,'#report-upload-state':uploadState,'#medical-error':error};
 const form={elements:{visitId:visit,fileId:file},querySelector:id=>fields[id],querySelectorAll:()=>[],isConnected:true};
 globalThis.document={querySelector:id=>id==='#medical-form'?form:id.startsWith('.drawer-foot')?submit:null};
 globalThis.FormData=class {constructor(){return [['visitId',visit.value],['fileId',file.value]];}};
 const date='2026-10-01';
 const items=[
  {id:'a',kind:'visit',title:'Visit A',date},{id:'b',kind:'visit',title:'Visit B',date},
  {id:'inferred',kind:'file',title:'Referenced original'},{id:'explicit',kind:'file',title:'Direct original',visitId:'a'},
  {id:'available',kind:'file',title:'Free original'},
  {id:'owner',kind:'report',title:'Visit A report',visitId:'a',fileId:'inferred'},
  {id:'editing',kind:'report',title:'Report to edit',date,visitId:'a',fileId:'inferred'},
 ];
 let html;
 const requests=[];
 const medical=createMedical({items,space:'personal',workbench:'health',today:date,esc,icon:()=>'',field:()=>'',select:()=>'',btn:()=>'',openDrawer:content=>{html=content;},
  api:async(route,request)=>requests.push({route,body:JSON.parse(request.body)}),closeDrawer:()=>{},load:async()=>{},toast:()=>{}});
 const submitForm=()=>form.onsubmit({target:form,preventDefault(){}});
 try{
  medical.openMedical('report','editing');
  assert.match(html,/<option value="inferred" selected>Referenced original/);
  assert.match(html,/<option value="explicit">Direct original/);
  visit.value='b';
  visit.onchange();
  assert.match(file.innerHTML,/<option value="inferred" selected disabled>/);
  assert.doesNotMatch(file.innerHTML,/value="explicit"/);
  assert.match(file.innerHTML,/value="available"/);
  assert.match(notice.textContent,/无法使用已选原件/);
  await submitForm();
  assert.deepEqual(requests,[]);
  assert.match(error.innerHTML,/无法使用已选原件/);
  file.value='';
  file.onchange();
  assert.equal(notice.textContent,'');
  await submitForm();
  assert.equal(requests[0].body.fileId,'');
  assert.equal(requests[0].body.visitId,'b');

  items.find(x=>x.id==='editing').visitId='b'; // Simulate a stored pre-fix conflict.
  medical.openMedical('report','editing');
  assert.match(html,/<option value="inferred" selected>Referenced original（保留原关联）/);
 }finally{
  if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
  globalThis.FormData=originalFormData;
 }
});
