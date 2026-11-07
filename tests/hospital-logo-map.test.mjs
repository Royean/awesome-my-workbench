import {test} from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {exportHospitalLogoMap} from '../scripts/export-hospital-logo-map.mjs';
import {institutions} from '../public/institutions.js';import {resolveInstitution} from '../public/provider-ui.js';
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zb6sAAAAASUVORK5CYII=','base64');
const sha=createHash('sha256').update(image).digest('hex');
function fixture(fn){const dir=mkdtempSync(path.join(os.tmpdir(),'hospital-map-'));try{const source=path.join(dir,'catalog.sqlite'),pub=path.join(dir,'public');writeFileSync(path.join(dir,'logo.png'),image);const db=new DatabaseSync(source);db.exec(`CREATE TABLE hospitals(hospital_id TEXT PRIMARY KEY,name TEXT,province TEXT,logo_verified INTEGER,logo_review_status TEXT,details_json TEXT,aliases_json TEXT,logo_candidates_json TEXT,logo_candidate_path TEXT,logo_source_page TEXT,logo_source_url TEXT)`);const row={hospital_id:'fictional-hospital',name:'虚构审核医院',province:'甲省',logo_verified:1,logo_review_status:'approved',details_json:JSON.stringify({logoMapping:{publicId:'fictional-approved',city:'成都',reviewedAt:'2026-11-05'}}),aliases_json:JSON.stringify(['虚构别名']),logo_candidates_json:JSON.stringify([{original:'logo.png',review_status:'approved',sha256:sha}]),logo_candidate_path:'logo.png',logo_source_page:'https://hospital.example/brand',logo_source_url:'https://images.example/logo.png'};const insert=r=>db.prepare('INSERT INTO hospitals VALUES('+Array(11).fill('?').join(',')+')').run(...Object.values(r));try{fn({dir,source,pub,db,row,insert})}finally{db.close()}}finally{rmSync(dir,{recursive:true,force:true})}}
const mappings=pub=>{const source=readFileSync(path.join(pub,'hospital-logo-map.js'),'utf8');return JSON.parse(source.slice(source.indexOf(' = ')+3).trim().replace(/;$/,''))};
test('exports only approved and verified records, preserving exact source file and local asset SHA',()=>fixture(({source,pub,row,insert})=>{insert(row);insert({...row,hospital_id:'pending',logo_verified:0,logo_review_status:'pending'});const before=readFileSync(source);const out=exportHospitalLogoMap(source,pub);assert.equal(out.mappings,1);assert.equal(out.assets,1);const m=mappings(pub)[0];assert.equal(m.id,'fictional-approved');assert.equal(m.city,'成都');assert.equal(m.sourceUrl,row.logo_source_page);assert.equal(m.logoSourceUrl,row.logo_source_url);assert.deepEqual(readFileSync(path.join(pub,m.logo)),image);assert.deepEqual(readFileSync(source),before)}));
test('requires approved matching candidate, reviewed city and review date before modifying prior map',()=>{for(const mutate of [r=>r.logo_candidates_json=JSON.stringify([{original:'logo.png',review_status:'pending',sha256:sha}]),r=>r.details_json=JSON.stringify({logoMapping:{publicId:'fictional-approved',reviewedAt:'2026-11-05'}}),r=>r.details_json=JSON.stringify({logoMapping:{publicId:'fictional-approved',city:'成都'}})])fixture(({source,pub,row,insert})=>{mkdirSync(pub);const target=path.join(pub,'hospital-logo-map.js');writeFileSync(target,'prior-review-map');mutate(row);insert(row);assert.throws(()=>exportHospitalLogoMap(source,pub));assert.equal(readFileSync(target,'utf8'),'prior-review-map');assert.equal(existsSync(path.join(pub,'provider-logos')),false)})});
test('brand requires reviewed cities with no prefilled city, retains brand scope and aliases',()=>fixture(({source,pub,row,insert})=>{row.details_json=JSON.stringify({logoMapping:{publicId:'fictional-brand',scope:'brand',cities:['成都','德阳'],reviewedAt:'2026-11-05'}});insert(row);exportHospitalLogoMap(source,pub);const m=mappings(pub)[0];assert.equal(m.scope,'brand');assert.equal(m.city,'');assert.deepEqual(m.cities,['成都','德阳']);assert.deepEqual(m.aliases,['虚构别名'])}));
test('rejects hash mismatch and duplicate public ID without changing existing export',()=>{for(const bad of ['hash','duplicate'])fixture(({source,pub,row,insert})=>{mkdirSync(pub);writeFileSync(path.join(pub,'hospital-logo-map.js'),'prior');insert(row);if(bad==='hash'){const db=new DatabaseSync(source);db.prepare('UPDATE hospitals SET logo_candidates_json=?').run(JSON.stringify([{original:'logo.png',review_status:'approved',sha256:'0'.repeat(64)}]));db.close()}else insert({...row,hospital_id:'another-hospital'});assert.throws(()=>exportHospitalLogoMap(source,pub));assert.equal(readFileSync(path.join(pub,'hospital-logo-map.js'),'utf8'),'prior')})});
test('whitespace is not an explicitly reviewed institution city',()=>fixture(({source,pub,row,insert})=>{row.details_json=JSON.stringify({logoMapping:{publicId:'fictional-approved',city:'   ',reviewedAt:'2026-11-05'}});insert(row);assert.throws(()=>exportHospitalLogoMap(source,pub))}));
test('brand resolution respects reviewed city scope for named branches and explicit IDs',()=>{const brand={id:'acceptance-fictional-brand',name:'虚构口腔品牌',aliases:['虚构牙科'],scope:'brand',city:'',cities:['成都'],logo:'/fixture.png'};institutions.push(brand);try{assert.equal(resolveInstitution({hospital:'虚构口腔品牌（高新分院）',city:'成都市'})?.id,brand.id);assert.equal(resolveInstitution({hospital:'虚构牙科(高新分院)',city:'成都'})?.id,brand.id);assert.equal(resolveInstitution({hospital:'虚构口腔品牌（高新分院）',city:'北京'}),null);assert.equal(resolveInstitution({hospitalId:brand.id,hospital:'虚构口腔品牌（高新分院）',city:'北京'}),null);assert.equal(resolveInstitution({hospital:'虚构口腔品牌合作医院',city:'成都'}),null);}finally{institutions.pop()}});
test('unknown explicit identity and ambiguous names never fall back; legacy identities remain stable',()=>{assert.equal(resolveInstitution({hospitalId:'unknown-id',hospital:'四川省人民医院',city:'成都'}),null);assert.equal(resolveInstitution({hospital:'协和医院'}),null);assert.equal(resolveInstitution({hospital:'四川省人民医院',city:'成都'})?.id,'sichuan-people');assert.equal(resolveInstitution({hospital:'重庆新桥医院',city:'重庆'})?.id,'chongqing-xinqiao');assert.equal(new Set(institutions.map(x=>x.id)).size,institutions.length)});

test('reviewed Xinqiao branches use the approved brand asset and take precedence for exact names', () => {
 const brand = resolveInstitution({hospital:'新桥口腔', city:'成都'});
 const highTech = resolveInstitution({hospital:'新桥口腔（高新分院）', city:'成都市'});
 const rennan = resolveInstitution({hospital:'新桥口腔成都总院', city:'成都'});
 const yiguanmiao = resolveInstitution({hospital:'新桥口腔（衣冠庙院区）', city:'成都'});
 assert.equal(brand?.id, 'xinqiao-dental');
 assert.equal(highTech?.id, 'xinqiao-dental-chengdu-gaoxin');
 assert.equal(rennan?.id, 'xinqiao-dental-chengdu-rennan');
 assert.equal(yiguanmiao?.id, 'xinqiao-dental-chengdu-yiguanmiao');
 for (const branch of [highTech, rennan, yiguanmiao]) assert.equal(branch.logo, brand.logo);
 assert.equal(resolveInstitution({hospital:'新桥口腔（高新分院）', city:'西宁'}), null);
 assert.equal(resolveInstitution({hospitalId:highTech.id, hospital:'新桥口腔（高新分院）', city:'西宁'}), null);
 assert.equal(resolveInstitution({hospitalId:brand.id, hospital:'新桥口腔（高新分院）', city:'西宁'}), null);
 assert.equal(resolveInstitution({hospitalId:highTech.id, hospital:'新桥口腔（高新分院）', city:'成都'})?.id, highTech.id);
 assert.equal(resolveInstitution({hospitalId:brand.id, hospital:'新桥口腔（高新分院）', city:'成都'})?.id, brand.id);
 assert.equal(resolveInstitution({hospital:'新桥口腔（西宁院区）', city:'西宁'})?.id, 'xinqiao-dental-xining');
 assert.equal(resolveInstitution({hospitalId:brand.id, hospital:'成都新桥口腔医院', city:'成都'})?.logo, brand.logo);
 assert.equal(resolveInstitution({hospital:'新桥口腔（某分院）', city:'德阳'})?.id, brand.id);
 assert.equal(resolveInstitution({hospital:'重庆新桥医院', city:'重庆'})?.id, 'chongqing-xinqiao');
});

test('branch export requires its reviewed brand to cover the branch city', () => fixture(({source,pub,row,insert}) => {
 insert({...row, hospital_id:'branch', details_json:JSON.stringify({logoMapping:{
  publicId:'branch', brandId:'brand', city:'成都', reviewedAt:'2026-11-05',
 }})});
 assert.throws(() => exportHospitalLogoMap(source,pub), /Branch needs a reviewed brand/);
 insert({...row, hospital_id:'brand', details_json:JSON.stringify({logoMapping:{
  publicId:'brand', scope:'brand', cities:['成都'], reviewedAt:'2026-11-05',
 }})});
 assert.equal(exportHospitalLogoMap(source,pub).assets,1);
 assert.equal(mappings(pub).find(m=>m.id==='branch').brandId,'brand');
}));

test('a saved Xinqiao branch ID falls back when the visit names a different reviewed branch', () => {
 const hospitalId = 'xinqiao-dental-chengdu-gaoxin';
 for (const [hospital, city] of [
  ['新桥口腔（西宁院区）', '成都'],
  ['新桥口腔（衣冠庙院区）', '成都'],
  ['新桥口腔医院（衣冠庙分院）', '成都'],
  ['新桥口腔（西宁分院）', ''],
 ]) {
  assert.equal(resolveInstitution({hospitalId, hospital, city}), null, hospital);
 }
 assert.equal(resolveInstitution({hospitalId, hospital:'新桥口腔医院（高新分院）', city:'成都'})?.id, hospitalId);
 assert.equal(resolveInstitution({hospitalId})?.id, hospitalId);
 assert.equal(resolveInstitution({hospitalId:'sichuan-people', hospital:'自定义医院名称', city:'西宁'})?.id, 'sichuan-people');
});

test('reviewed branch labels are matched across brand aliases before applying the city filter', () => {
 for (const [hospital, city, expectedId] of [
  ['新桥口腔（西宁分院）', '西宁市', 'xinqiao-dental-xining'],
  ['成都新桥口腔医院（高新分院）', '成都', 'xinqiao-dental-chengdu-gaoxin'],
  ['新桥口腔医院（衣冠庙分院）', '成都', 'xinqiao-dental-chengdu-yiguanmiao'],
  ['新桥口腔（西宁分院）', '成都', null],
  ['成都新桥口腔医院（高新分院）', '西宁', null],
  ['新桥口腔医院（某分院）', '德阳', 'xinqiao-dental'],
  ['自定义机构（西宁分院）', '西宁', null],
 ]) {
  assert.equal(resolveInstitution({hospital, city})?.id ?? null, expectedId, hospital + city);
 }
 const hospitalId = 'xinqiao-dental';
 const hospital = '新桥口腔医院（西宁分院）';
 assert.equal(resolveInstitution({hospitalId, hospital, city:'成都'}), null);
 assert.equal(resolveInstitution({hospitalId, hospital, city:'西宁'})?.id, hospitalId);
});
