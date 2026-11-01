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
