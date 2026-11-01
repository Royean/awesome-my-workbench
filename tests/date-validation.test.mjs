import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import {startServer} from './helpers.mjs';
import {isValidDate,DATE_ERROR} from '../lib/dates.mjs';
import {migrateAccounts,createAccounts} from '../lib/accounts.mjs';
const MESSAGE='日期格式不对，请按 2026-11-01 这样填写';
let dir,server;
const api=async(route,method='GET',body)=>{const r=await fetch(server.base+route,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();return {status:r.status,body:JSON.parse(text),text};};
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'health-dates-'));server=await startServer({env:{HEALTH_DATA_DIR:dir}});});
after(async()=>{await server?.stop();await rm(dir,{recursive:true,force:true});});

test('isValidDate accepts only real YYYY-MM-DD calendar dates and never throws',()=>{
 assert.equal(DATE_ERROR,MESSAGE);
 for(const v of ['2026-11-01','2024-02-29','2000-02-29','1999-12-31'])assert.equal(isValidDate(v),true,v);
 for(const v of ['2026-02-30','2026-02-29','1900-02-29','2026-13-01','2026-00-10','2026-04-31','2026-11-00','2026-1-01','2026/11/01','20261101','2026-11-01T00:00','',' 2026-11-01',null,undefined,20261101,{}])assert.equal(isValidDate(v),false,String(v));
});

test('bad dates return 400 with the Chinese message and field, never "Invalid time value"',async()=>{
 const cases=[
  ['/api/items',{kind:'note',title:'虚构',date:'2026-02-30'},'date'],
  ['/api/items',{kind:'note',title:'虚构',date:'2026-13-45'},'date'],
  ['/api/items',{kind:'note',title:'虚构',date:'2026/11/01'},'date'],
  ['/api/items',{kind:'note',title:'虚构',date:20261101},'date'],
  ['/api/upload',{name:'x.txt',date:'2026-99-99',content:Buffer.from('x').toString('base64')},'date'],
  ['/api/capture-meal',{text:'虚构餐',date:'2026-02-31'},'date'],
 ];
 for(const [route,body,field] of cases){const r=await api(route,'POST',body);assert.equal(r.status,400,JSON.stringify(body));assert.deepEqual(r.body,{error:MESSAGE,field});assert.ok(!/Invalid time value/i.test(r.text));}
 const visit=await api('/api/items','POST',{kind:'visit',title:'虚构就诊',date:'2026-10-01',status:'已完成'});assert.equal(visit.status,201);
 const med={kind:'medication',title:'虚构药',date:'2026-10-01',visitId:visit.body.id,dosage:'1',route:'口服',frequency:'每日',times:['08:00']};
 const bad=await api('/api/items','POST',{...med,endDate:'2026-02-30'});assert.equal(bad.status,400);assert.deepEqual(bad.body,{error:MESSAGE,field:'endDate'});
 const early=await api('/api/items','POST',{...med,endDate:'2026-09-01'});assert.equal(early.status,400);assert.equal(early.body.error,'结束日期不能早于开始日期');
 const note=await api('/api/items','POST',{kind:'note',title:'虚构',date:'2026-11-01'});assert.equal(note.status,201);
 const upd=await api('/api/items/'+note.body.id,'PUT',{date:'2026-11-31'});assert.deepEqual(upd.body,{error:MESSAGE,field:'date'});
});

test('unexpected errors return a generic Chinese 500 without internal details',async()=>{
 assert.equal((await api('/api/items','POST',null)).status,400);
 const db=new DatabaseSync(path.join(dir,'health.sqlite'));db.prepare('INSERT INTO items VALUES(?,?,?,?)').run('corrupt','personal','note','{not json');db.close();
 const r=await api('/api/state');assert.equal(r.status,500);assert.deepEqual(r.body,{error:'服务器内部错误，请稍后重试'});
 const db2=new DatabaseSync(path.join(dir,'health.sqlite'));db2.prepare('DELETE FROM items WHERE id=?').run('corrupt');db2.close();
 assert.ok(/request-error/.test(server.stderr()),'details are logged server-side');
});

test('login rate limit uses an injectable clock: blocks after 5 failures and expires after 15 minutes',async()=>{
 const db=new DatabaseSync(':memory:');migrateAccounts(db);let t=1_800_000_000_000;
 const json=(res,status,body)=>{res.status=status;res.body=body;};
 const accounts=createAccounts({db,enabled:true,json,readBody:async req=>req.body,now:()=>t});
 const attempt=async()=>{const req={method:'POST',headers:{},socket:{remoteAddress:'127.0.0.1'},body:{email:'nobody@example.invalid',password:'wrong-password'}};try{await accounts.handle(req,{setHeader(){}},new URL('http://x/api/auth/login'),null);return 200;}catch(e){return e.status;}};
 for(let i=0;i<5;i++)assert.equal(await attempt(),401);
 assert.equal(await attempt(),429);
 t+=15*60*1000-1;assert.equal(await attempt(),429);
 t+=2;assert.equal(await attempt(),401);
 db.close();
});
