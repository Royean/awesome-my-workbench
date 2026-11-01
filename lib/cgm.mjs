import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID,createCipheriv,createDecipheriv,createHmac} from 'node:crypto';
import {createSilite,cgmError} from './cgm-silite.mjs';
const INTERVAL=300000,iso=t=>t==null?null:new Date(t).toISOString();
const SH={timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'};
const ymd=t=>new Intl.DateTimeFormat('en-CA',SH).format(new Date(t));
const fail=(status,code,message,extra)=>{throw cgmError(status,code,message,extra);};
export function createCgm({db,dataDir,fetchImpl=fetch,now=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS cgm_connections(
 id TEXT PRIMARY KEY,scope TEXT NOT NULL REFERENCES data_scopes(space) ON DELETE CASCADE,
 provider TEXT NOT NULL,account_key TEXT NOT NULL,account_masked TEXT NOT NULL,secret TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'connected',version INTEGER NOT NULL DEFAULT 1,
 last_sync_at INTEGER,last_reading_at INTEGER,last_error TEXT,next_sync_at INTEGER NOT NULL,failures INTEGER NOT NULL DEFAULT 0,
 UNIQUE(scope,provider));
 CREATE TABLE IF NOT EXISTS cgm_readings(
 scope TEXT NOT NULL REFERENCES data_scopes(space) ON DELETE CASCADE,provider TEXT NOT NULL,account_key TEXT NOT NULL,
 t INTEGER NOT NULL,value REAL NOT NULL,trend TEXT,PRIMARY KEY(scope,provider,account_key,t));
 CREATE INDEX IF NOT EXISTS cgm_readings_scope_time ON cgm_readings(scope,t);
 CREATE INDEX IF NOT EXISTS cgm_connections_due ON cgm_connections(enabled,next_sync_at);`);
 const adapter=createSilite({fetchImpl,now}),keyPath=path.join(dataDir,'cgm.key');
 const locks=new Set();let timer=null,stopped=false,polling=false;
 const providers=()=>[{id:'silite',name:'硅基轻享',authType:'password'}];
 const validScope=scope=>{
  const owner=db.prepare("SELECT u.id FROM data_scopes d JOIN users u ON u.id=d.user_id WHERE d.space=? AND d.workbench_id='health' AND d.base_space='personal' AND u.disabled=0").get(scope);
  if(!owner)fail(403,'cgm_scope_forbidden','CGM连接仅用于已登录账号的健康个人空间');
 };
 function readKey(){
  if(!fs.existsSync(keyPath)){
   if(db.prepare('SELECT id FROM cgm_connections LIMIT 1').get()||db.prepare('SELECT t FROM cgm_readings LIMIT 1').get())fail(503,'cgm_key_unavailable','CGM连接密钥不可用，请联系管理员恢复');
   try{fs.writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')fail(503,'cgm_key_unavailable','CGM连接密钥不可用，请联系管理员检查');}
  }
  try{const stat=fs.lstatSync(keyPath);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw Error();const key=fs.readFileSync(keyPath);if(key.length!==32)throw Error();return key;}
  catch{fail(503,'cgm_key_unavailable','CGM连接密钥不可用，请联系管理员恢复');}
 }
 const aad=row=>Buffer.from(JSON.stringify([row.scope,row.provider,row.id]));
 const seal=(row,value)=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',readKey(),iv);cipher.setAAD(aad(row));const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return ['1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),bytes.toString('base64')].join('.');};
 const unseal=row=>{try{const [version,iv,tag,bytes]=row.secret.split('.');if(version!=='1')throw Error();const decipher=createDecipheriv('aes-256-gcm',readKey(),Buffer.from(iv,'base64'));decipher.setAAD(aad(row));decipher.setAuthTag(Buffer.from(tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(bytes,'base64')),decipher.final()]).toString('utf8'));}catch(e){if(e.code==='cgm_key_unavailable')throw e;fail(503,'cgm_key_unavailable','CGM连接凭据无法读取，请断开后重新连接或联系管理员恢复密钥');}};
 const fingerprint=(scope,provider,username)=>createHmac('sha256',readKey()).update(JSON.stringify([scope,provider,username])).digest('hex');
 const rowFor=(scope,id)=>{validScope(scope);const r=db.prepare('SELECT * FROM cgm_connections WHERE scope=? AND id=?').get(scope,id);if(!r)fail(404,'cgm_not_found','没有找到这个CGM连接');return r;};
 const safe=row=>({id:row.id,provider:row.provider,providerName:'硅基轻享',accountMasked:row.account_masked,enabled:!!row.enabled,status:row.status,lastSyncAt:iso(row.last_sync_at),lastReadingAt:iso(row.last_reading_at),lastError:row.last_error||null,nextSyncAt:row.enabled?iso(row.next_sync_at):null,count:db.prepare('SELECT count(*) n FROM cgm_readings WHERE scope=? AND provider=? AND account_key=?').get(row.scope,row.provider,row.account_key).n});
 const connections=scope=>{validScope(scope);return db.prepare('SELECT * FROM cgm_connections WHERE scope=? ORDER BY provider').all(scope).map(safe);};
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 const writePoints=(row,points)=>{
  const put=db.prepare('INSERT INTO cgm_readings(scope,provider,account_key,t,value,trend) VALUES(?,?,?,?,?,?) ON CONFLICT(scope,provider,account_key,t) DO UPDATE SET value=excluded.value,trend=excluded.trend');
  for(const p of points)put.run(row.scope,row.provider,row.account_key,p.t,p.value,p.trend===undefined?null:JSON.stringify(p.trend));
 };
 const latestTime=row=>db.prepare('SELECT max(t) t FROM cgm_readings WHERE scope=? AND provider=? AND account_key=?').get(row.scope,row.provider,row.account_key).t;
 async function connect(scope,body,{isAuthorized=()=>true}={}){
  validScope(scope);
  if(!isAuthorized())fail(401,'cgm_session_changed','登录状态已改变，请重新登录');
  if(!body||body.provider!=='silite')fail(400,'cgm_provider_unsupported','请选择当前支持的CGM平台',{field:'provider'});
  if(typeof body.username!=='string'||!/^1\d{10}$/.test(body.username.trim()))fail(400,'cgm_validation_failed','请输入11位平台手机号',{field:'username'});
  if(typeof body.password!=='string'||!body.password||body.password.length>128)fail(400,'cgm_validation_failed','请输入平台密码（最多128个字符）',{field:'password'});
  if(body.consent!==true)fail(400,'cgm_consent_required','请先确认允许保存连接并自动同步本人数据',{field:'consent'});
  const username=body.username.trim(),lock='connect:'+scope+':silite';
  if(locks.has(lock))fail(409,'cgm_busy','此平台正在连接，请稍后查看结果');
  locks.add(lock);
  try{
   const existing=db.prepare("SELECT * FROM cgm_connections WHERE scope=? AND provider='silite'").get(scope),accountKey=fingerprint(scope,'silite',username);
   if(existing&&existing.account_key!==accountKey)fail(409,'cgm_account_conflict','此平台已连接另一个账号，请先断开原连接');
   if(existing&&locks.has(existing.id))fail(409,'cgm_busy','此平台正在同步，请稍后重试');
   const row={id:existing?.id||randomUUID(),scope,provider:'silite',account_key:accountKey,account_masked:username.slice(0,3)+'****'+username.slice(-4)};
   const auth=await adapter.login(username,body.password),data=await adapter.pull(auth.token);
   validScope(scope);
   if(!isAuthorized())fail(401,'cgm_session_changed','登录状态已改变，本次连接已取消');
   if(stopped)fail(409,'cgm_cancelled','连接操作已停止，请稍后重新操作');
   const live=db.prepare("SELECT * FROM cgm_connections WHERE scope=? AND provider='silite'").get(scope);
   if((existing&&(!live||live.version!==existing.version))||(!existing&&live))fail(409,'cgm_connection_changed','连接状态已改变，请刷新后重试');
   const secret=seal(row,{username,password:body.password,...auth});
   transaction(()=>{
    writePoints(row,data.points);const latest=latestTime(row),time=now();
    if(existing)db.prepare("UPDATE cgm_connections SET secret=?,enabled=1,status='connected',version=version+1,last_sync_at=?,last_reading_at=?,last_error=NULL,next_sync_at=?,failures=0 WHERE id=? AND scope=?").run(secret,time,latest,time+INTERVAL,row.id,scope);
    else db.prepare('INSERT INTO cgm_connections(id,scope,provider,account_key,account_masked,secret,last_sync_at,last_reading_at,next_sync_at) VALUES(?,?,?,?,?,?,?,?,?)').run(row.id,scope,row.provider,row.account_key,row.account_masked,secret,time,latest,time+INTERVAL);
   });
   return {...safe(rowFor(scope,row.id)),imported:data.points.length,skipped:data.skipped};
  }finally{locks.delete(lock);}
 }
 async function sync(scope,id,{isAuthorized=()=>true}={}){
  const row=rowFor(scope,id);
  if(!isAuthorized())fail(401,'cgm_session_changed','登录状态已改变，请重新登录');
  if(locks.has(id)||locks.has('connect:'+scope+':'+row.provider))fail(409,'cgm_busy','此平台正在同步，请稍后查看结果');
  locks.add(id);
  try{
   const secret=unseal(row),data=await adapter.collect(secret);validScope(scope);
   if(!isAuthorized())fail(401,'cgm_session_changed','登录状态已改变，本次同步已取消');
   const live=db.prepare('SELECT * FROM cgm_connections WHERE scope=? AND id=?').get(scope,id);
   if(stopped||!live||live.version!==row.version)fail(409,'cgm_connection_changed','连接状态已改变，本次同步已取消');
   const encrypted=seal(row,{...secret,...data.auth});
   transaction(()=>{writePoints(row,data.points);const t=now();db.prepare('UPDATE cgm_connections SET secret=?,status=?,last_sync_at=?,last_reading_at=?,last_error=NULL,next_sync_at=?,failures=0 WHERE scope=? AND id=? AND version=?').run(encrypted,row.enabled?'connected':'paused',t,latestTime(row),t+INTERVAL,scope,id,row.version);});
   return {...safe(rowFor(scope,id)),imported:data.points.length,skipped:data.skipped};
  }catch(error){
   if(error?.expose&&!['cgm_connection_changed','cgm_session_changed','cgm_scope_forbidden'].includes(error.code)){
    const failures=row.failures+1,delay=Math.max(INTERVAL,Math.min(3600000,INTERVAL*2**Math.min(failures-1,4)),(error.retryAfter||0)*1000);
    const status=['cgm_auth_failed','cgm_token_expired'].includes(error.code)?'reconnect_required':row.enabled?'error':'paused';
    db.prepare('UPDATE cgm_connections SET status=?,last_error=?,next_sync_at=?,failures=? WHERE scope=? AND id=? AND version=?').run(status,error.message,now()+delay,failures,scope,id,row.version);
   }
   throw error;
  }finally{locks.delete(id);}
 }
 function pause(scope,id){const row=rowFor(scope,id);db.prepare("UPDATE cgm_connections SET enabled=0,status='paused',version=version+1 WHERE scope=? AND id=?").run(scope,id);return safe(rowFor(scope,id));}
 async function resume(scope,id,options={}){rowFor(scope,id);if(options.isAuthorized&&!options.isAuthorized())fail(401,'cgm_session_changed','登录状态已改变，请重新登录');db.prepare("UPDATE cgm_connections SET enabled=1,status='connected',next_sync_at=?,version=version+1 WHERE scope=? AND id=?").run(now(),scope,id);return sync(scope,id,options);}
 function disconnect(scope,id){rowFor(scope,id);db.prepare('DELETE FROM cgm_connections WHERE scope=? AND id=?').run(scope,id);return {disconnected:true,historyRetained:true};}
 function readings(scope,{date=ymd(now())}={}){
  validScope(scope);
  const start=typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)?Date.parse(date+'T00:00:00+08:00'):NaN;
  if(!Number.isFinite(start)||ymd(start)!==date)fail(400,'cgm_validation_failed','请选择有效的日期',{field:'date'});
  const current=db.prepare('SELECT * FROM cgm_connections WHERE scope=? ORDER BY last_reading_at DESC LIMIT 1').get(scope);
  const source=current||db.prepare('SELECT provider,account_key FROM cgm_readings WHERE scope=? ORDER BY t DESC LIMIT 1').get(scope);
  if(!source)return {date,points:[],latest:null,summary:{count:0,min:null,max:null,mean:null},lastReadingAt:null,stale:true};
  const rows=db.prepare('SELECT t,value,trend FROM cgm_readings WHERE scope=? AND provider=? AND account_key=? AND t>=? AND t<? ORDER BY t ASC LIMIT 10000').all(scope,source.provider,source.account_key,start,start+86400000);
  const points=rows.map(r=>({t:r.t,value:r.value,...(r.trend===null?{}:{trend:JSON.parse(r.trend)})}));
  const latest=db.prepare('SELECT t,value FROM cgm_readings WHERE scope=? AND provider=? AND account_key=? ORDER BY t DESC LIMIT 1').get(scope,source.provider,source.account_key)||null;
  const values=points.map(p=>p.value),summary={count:points.length,min:points.length?Math.min(...values):null,max:points.length?Math.max(...values):null,mean:points.length?values.reduce((s,v)=>s+v,0)/points.length:null};
  return {date,points,latest,summary,lastReadingAt:latest?iso(latest.t):null,stale:!latest||now()-latest.t>1800000,connected:!!current};
 }
 async function poll(){
  if(stopped||polling)return;
  polling=true;
  try{
  const due=db.prepare("SELECT c.* FROM cgm_connections c JOIN data_scopes d ON d.space=c.scope JOIN users u ON u.id=d.user_id WHERE c.enabled=1 AND c.next_sync_at<=? AND c.status!='reconnect_required' AND u.disabled=0 AND d.workbench_id='health' AND d.base_space='personal' ORDER BY c.next_sync_at LIMIT 100").all(now());
  // Sequential requests bound provider pressure and avoid thousands of simultaneous logins.
  for(const r of due){
   if(stopped)break;
   // A preceding network request may have taken seconds: do not use the queued
   // snapshot to sync a connection the user paused/replaced in the meantime.
   const live=db.prepare('SELECT * FROM cgm_connections WHERE scope=? AND id=?').get(r.scope,r.id);
   if(!live||!live.enabled||live.version!==r.version||live.next_sync_at>now()||live.status==='reconnect_required')continue;
   try{await sync(r.scope,r.id);}catch{/* Safe per-connection error state is persisted by sync; never log credentials/upstream bodies. */}
  }
  }finally{polling=false;}
 }
 function start(){if(timer)return;stopped=false;timer=setInterval(()=>{void poll();},30000);timer.unref?.();void poll();}
 function stop(){stopped=true;if(timer)clearInterval(timer);timer=null;}
 return {providers,connections,connect,sync,pause,resume,disconnect,readings,start,stop};
}
