import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createPersonalSettings} from '../lib/personal-settings.mjs';
function fixture(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(space TEXT PRIMARY KEY,body TEXT); CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT); CREATE TABLE data_scopes(user_id TEXT,workbench_id TEXT,base_space TEXT,space TEXT);');const store=createPersonalSettings(db,(message,field)=>Object.assign(new Error(message),{field}));return {db,store};}
test('legacy local health preferences are shared; scope rows are preserved and writes validate atomically',()=>{
 const {db,store}=fixture();const old={name:'旧称呼',focus:'散步',waterGoalMl:2200};db.prepare('INSERT INTO settings VALUES(?,?)').run('personal',JSON.stringify(old));db.prepare('INSERT INTO settings VALUES(?,?)').run('personal::finance',JSON.stringify({name:'旧资产称呼'}));
 assert.deepEqual(store.read('demo::travel'),old);store.write('personal::finance',{name:'统一昵称'});assert.equal(store.read('personal').name,'统一昵称');assert.equal(store.read('demo::reading').waterGoalMl,2200);
 assert.throws(()=>store.write('personal',{name:'不应保存',waterGoalMl:0}));assert.equal(store.read('personal').name,'统一昵称');assert.equal(JSON.parse(db.prepare('SELECT body FROM settings WHERE space=?').get('personal').body).name,'旧称呼');db.close();
});
test('account name is canonical, preferences inherit health personal regardless of first workbench; accounts stay isolated',()=>{
 const {db,store}=fixture();for(const id of ['a','b']){db.prepare('INSERT INTO users VALUES(?,?)').run(id,'账号'+id);for(const w of ['health','finance','travel','reading','custom'])for(const base of ['personal','demo'])db.prepare('INSERT INTO data_scopes VALUES(?,?,?,?)').run(id,w,base,`account:${id}:${w}:${base}`);}
 db.prepare('INSERT INTO settings VALUES(?,?)').run('account:a:health:personal',JSON.stringify({name:'过时分台称呼',focus:'旧关注',waterGoalMl:1800}));
 assert.deepEqual(store.read('account:a:travel:demo'),{name:'账号a',focus:'旧关注',waterGoalMl:1800});store.write('account:a:custom:demo',{name:'新账号昵称',waterGoalMl:2500});assert.equal(db.prepare('SELECT name FROM users WHERE id=?').get('a').name,'新账号昵称');assert.equal(store.read('account:a:reading:personal').name,'新账号昵称');assert.equal(store.read('account:b:health:personal').name,'账号b');
 db.prepare('UPDATE users SET name=? WHERE id=?').run('安全页修改','a');assert.equal(store.read('account:a:finance:personal').name,'安全页修改');store.write('account:a:health:personal',{focus:'只改目标'});assert.equal(store.read('account:a:health:personal').name,'安全页修改');assert.throws(()=>store.read('account:forged:health:personal'));db.close();
});
