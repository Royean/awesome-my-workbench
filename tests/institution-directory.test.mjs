import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {institutions} from '../public/institutions.js';
import {resolveInstitution} from '../public/provider-ui.js';
test('public institution directory has unique IDs, local existing brand files and independent branch cities',()=>{
 assert.equal(new Set(institutions.map(x=>x.id)).size,institutions.length);
 for(const p of institutions){assert.match(p.id,/^[a-z0-9-]+$/);assert.ok(p.name);if(p.kind==='checkup')assert.equal(p.city,'');if(p.logo){assert.match(p.logo,/^\/provider-logos\/[a-z0-9-]+\.(png|jpg|svg|webp)$/);assert.ok(fs.statSync(path.join(import.meta.dirname,'../public',p.logo)).isFile());}}
 assert.notEqual(institutions.find(x=>x.id==='chengdu-wuhou-southwest').id,institutions.find(x=>x.id==='chongqing-southwest').id);
});
test('institution resolution rejects ambiguous short names and wrong city, keeps unknown explicit identity unknown',()=>{
 assert.equal(resolveInstitution({hospital:'中山医院'}),null);
 assert.equal(resolveInstitution({hospital:'省医院'}),null);
 assert.equal(resolveInstitution({hospital:'上海中山医院',city:'成都'}),null);
 assert.equal(resolveInstitution({hospital:'四川省人民医院',city:'成都市'}).id,'sichuan-people');
 assert.equal(resolveInstitution({hospitalId:'missing-provider',hospital:'四川省人民医院'}),null);
 assert.equal(resolveInstitution({hospital:'成都武侯西南医院',city:'成都'}).id,'chengdu-wuhou-southwest');
 assert.equal(resolveInstitution({hospital:'重庆西南医院',city:'重庆'}).id,'chongqing-southwest');
 assert.equal(resolveInstitution({hospitalId:'ikang',hospital:'爱康国宾成都城南分院',city:'成都'}).id,'ikang');
});
