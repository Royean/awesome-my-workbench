import { validateReportObservations } from './lib/report-observations.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import zlib from 'node:zlib';
import { migrateAccounts, createAccounts, publicUser, bearerToken, hasBearerScheme, hasSessionCookie, digest } from './lib/accounts.mjs';
import { createMcp, MCP_PROTOCOL_VERSIONS } from './lib/mcp.mjs';
const authEnabled=process.env.AUTH_REQUIRED==='1'||process.env.NODE_ENV==='production';
const appOrigin=process.env.APP_ORIGIN;
if(process.env.NODE_ENV==='production'&&(!appOrigin||!/^https:\/\/[^/]+$/.test(appOrigin)))throw new Error('production requires APP_ORIGIN=https://your-domain');
if(appOrigin&&new URL(appOrigin).origin!==appOrigin)throw new Error('APP_ORIGIN must be an exact origin without trailing slash');
const host=process.env.HOST||'127.0.0.1';
if(!authEnabled&&!['127.0.0.1','localhost','::1'].includes(host))throw new Error('Remote listening requires AUTH_REQUIRED=1');
const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.HEALTH_DATA_DIR||path.join(root,'data');
fs.mkdirSync(path.join(dataDir,'uploads'),{recursive:true,mode:0o700});
fs.chmodSync(dataDir,0o700);fs.chmodSync(path.join(dataDir,'uploads'),0o700);
const db=new DatabaseSync(path.join(dataDir,'health.sqlite'));
fs.chmodSync(path.join(dataDir,'health.sqlite'),0o600);
migrateAccounts(db);
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, space TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings(space TEXT PRIMARY KEY, body TEXT NOT NULL);');
db.exec('CREATE TABLE IF NOT EXISTS deleted_items(id TEXT PRIMARY KEY, space TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, expires_at INTEGER NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS workbenches(id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL); CREATE INDEX IF NOT EXISTS items_space ON items(space); CREATE INDEX IF NOT EXISTS items_scope_kind ON items(space,kind); CREATE INDEX IF NOT EXISTS deleted_items_space_expiry ON deleted_items(space,expires_at)');
const builtinWorkbenches=[{id:'health',name:'健康',type:'health'},{id:'finance',name:'金融',type:'finance'}];
const getWorkbenches=()=>[...builtinWorkbenches,...db.prepare('SELECT id,name,type FROM workbenches ORDER BY rowid').all()];
// Names are unique within one account's workbenches (compared after trim); renaming to its own name is fine.
const assertUniqueWorkbenchName=(list,name,selfId)=>{const n=String(name).trim();const self=list.find(w=>w.id===selfId);if(self&&String(self.name).trim()===n)return;if(list.some(w=>w.id!==selfId&&String(w.name).trim()===n))throw bad(`已经有叫「${n}」的工作台了`,'name');};
const validateWorkbench=(b,existing=[])=>{if(b.type!=='other'||typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>24)throw bad(b.type!=='other'?'新建的工作台只能记备忘和待办':'工作台名称需为 1–24 个字');assertUniqueWorkbenchName(existing,b.name);return {id:randomUUID(),name:b.name.trim(),type:'other'}};
// Clock: ZH_TEST_NOW (ISO) is honoured only under NODE_ENV=test so tests can pin "now".
const now=()=>process.env.NODE_ENV==='test'&&process.env.ZH_TEST_NOW?new Date(process.env.ZH_TEST_NOW):new Date();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
const nowHM=()=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(now());
const day=(offset=0)=>{const d=new Date(today()+'T12:00:00+08:00');d.setDate(d.getDate()+offset);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(d)};
const getAll=(space)=>db.prepare('SELECT id,kind,body FROM items WHERE space=?').all(space).map(r=>({id:r.id,kind:r.kind,...JSON.parse(r.body)}));
const kinds=['visit','exercise','meal','metric','task','file','report','medication','dose','favorite','water','note'];
import { isValidDate as validDate, DATE_ERROR } from './lib/dates.mjs';
const bad=(message,field,code='validation_failed')=>Object.assign(new Error(message),{status:400,expose:true,code,...(field?{field}:{})});
// 「不能记录未来的日期，今天是 11月1日」 (Asia/Shanghai). Applies to the web API and MCP alike.
const FUTURE_CHECKED=['meal','exercise','metric','water'];
const futureDateError=t=>bad(`不能记录未来的日期，今天是 ${Number(t.slice(5,7))}月${Number(t.slice(8,10))}日`,'date','future_date');
const isPlainObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const dateError=field=>bad(DATE_ERROR,field);
const md=d=>`${Number(d.slice(5,7))}月${Number(d.slice(8,10))}日`;
const validTime=v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const units={weight:'kg',pressure:'mmHg',glucose:'mmol/L',sleep:'小时',heart:'次/分'};
// opts.original: the stored record when updating (lets legacy records keep missing optional links).
function validate(kind,b,opts={}){
 if(!kinds.includes(kind))throw bad('记录类型无效');
 if(typeof b.title!=='string'||!b.title.trim()||b.title.length>120)throw bad('名称需为 1–120 个字符');
 if(!validDate(b.date))throw dateError('date');
 if(FUTURE_CHECKED.includes(kind)&&b.date>today())throw futureDateError(today());
 const clean={title:b.title.trim(),date:b.date,note:String(b.note||'').slice(0,5000)};
 for(const key of ['hospital','department','status','type','mealType','category','time','visitId','unit','name','mime','storageName'])if(b[key]!==undefined)clean[key]=String(b[key]).slice(0,250);
 if(clean.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(clean.time))throw bad('时间格式不对，例如 08:30');
 if(kind==='visit'&&!['待就诊','已完成','待复查'].includes(clean.status))throw bad('就诊状态无效');
 if(kind==='exercise'){if(!Number.isFinite(Number(b.duration))||Number(b.duration)<=0||Number(b.duration)>1440)throw bad('运动时长需大于 0 且不超过 1440 分钟');clean.duration=Number(b.duration);
  if(b.distance!==undefined&&b.distance!==''){if(!Number.isFinite(Number(b.distance))||Number(b.distance)<=0||Number(b.distance)>1000)throw bad('距离需大于 0 且不超过 1000 公里');clean.distance=Number(b.distance);}
  clean.feeling=String(b.feeling||'');if(!['','轻松','适中','吃力','不适'].includes(clean.feeling))throw bad('身体感受选项无效');
  if(b.exercises!==undefined&&(!Array.isArray(b.exercises)||b.exercises.length>30))throw bad('最多记录 30 个训练动作','exercises');
  if((b.exercises||[]).some(m=>!isPlainObject(m)))throw bad('训练动作格式无效，每个动作需包含名称、组数和次数','exercises');clean.exercises=(b.exercises||[]).map(m=>{const name=String(m.name||'').trim();const sets=Number(m.sets),reps=Number(m.reps),weight=Number(m.weight||0);if(!name||name.length>100||!Number.isInteger(sets)||sets<1||sets>100||!Number.isInteger(reps)||reps<1||reps>500||!Number.isFinite(weight)||weight<0||weight>1000)throw bad('请完整填写动作、组数、次数和有效重量（可为 0）');return {name,sets,reps,weight}});
 }
 if(kind==='water'){if(!Number.isFinite(Number(b.volume))||Number(b.volume)<=0||Number(b.volume)>5000)throw bad('饮水量需大于 0 且不超过 5000 毫升');clean.volume=Number(b.volume);}
 if(kind==='favorite'){
  if(b.template!==undefined&&!isPlainObject(b.template))throw bad('收藏模板格式无效','template');if(!['meal','exercise'].includes(b.targetKind))throw bad('收藏类型无效');clean.targetKind=b.targetKind;clean.sourceId=String(b.sourceId||'').slice(0,100);
  const t=validate(b.targetKind,{...b.template,title:b.template?.title||clean.title,date:clean.date});delete t.date;delete t.time;delete t.attachmentIds;delete t.rawText;delete t.visitId;clean.template=t;
 }

 if(kind==='metric'){
  if(!units[clean.type])throw bad('请选择监测项目');
  if(!Number.isFinite(Number(b.value))||Number(b.value)<=0||Number(b.value)>10000)throw bad('请输入有效监测数值');
  clean.value=Number(b.value);clean.unit=units[clean.type];
  if(clean.type==='pressure'){if(!Number.isFinite(Number(b.secondary))||Number(b.secondary)<=0||Number(b.secondary)>=clean.value)throw bad('舒张压需大于 0 且低于收缩压');clean.secondary=Number(b.secondary);}
 }
 if(kind==='visit'){
  for(const key of ['city','hospitalId']){if(b[key]!==undefined&&b[key]!==null&&typeof b[key]!=='string')throw bad(key==='city'?'就诊城市格式无效':'医院编号格式无效',key);clean[key]=String(b[key]||'').trim();if(clean[key].length>100)throw bad(key==='city'?'就诊城市最多 100 个字':'医院编号最多 100 个字符',key);}
  if(clean.hospitalId&&!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(clean.hospitalId))throw bad('医院编号格式无效','hospitalId');
 }
 if(kind==='visit')for(const key of ['doctor','reason','assessment','instructions'])clean[key]=String(b[key]||'').slice(0,8000);
 if(kind==='report'){
  try{clean.observations=validateReportObservations(b.observations);}catch(e){throw bad(e.message,'observations');}
  clean.type=String(b.type||'就诊记录');if(!['就诊记录','检验报告','影像报告','处方','出院记录','其他'].includes(clean.type))throw bad('报告分类无效');
  clean.status=String(b.status||'待补充');if(!['待出报告','待补充','待核对','已归档'].includes(clean.status))throw bad('报告状态无效');
  clean.source=String(b.source||'').slice(0,250);clean.content=String(b.content||'').slice(0,20000);clean.fileId=String(b.fileId||'').slice(0,100);
  if(!clean.visitId&&!(opts.original&&!opts.original.visitId))throw bad('请选择关联就诊');
  if(clean.status==='已归档'&&!clean.content.trim()&&!clean.fileId)throw bad('归档报告需要原文或附件');
 }
 if(kind==='medication'){
  if(b.imageFileId!==undefined&&b.imageFileId!==null&&typeof b.imageFileId!=='string')throw bad('药品图片编号格式无效','imageFileId');
  clean.imageFileId=String(b.imageFileId||'').trim();if(clean.imageFileId.length>100)throw bad('药品图片编号过长','imageFileId');
  if(!clean.visitId)throw bad('请选择关联就诊');
  for(const key of ['dosage','route','frequency','prescriber'])clean[key]=String(b[key]||'').trim().slice(0,250);
  if(!clean.dosage||!clean.route||!clean.frequency)throw bad('请按处方填写单次用量、用药途径和频次');
  clean.status=String(b.status||'进行中');if(!['进行中','已停用','已完成'].includes(clean.status))throw bad('用药状态无效');
  clean.endDate=String(b.endDate||'');if(clean.endDate&&!validDate(clean.endDate))throw dateError('endDate');if(clean.endDate&&clean.endDate<clean.date)throw bad('结束日期不能早于开始日期','endDate');
  clean.scheduleMode=b.scheduleMode==='asNeeded'?'asNeeded':'scheduled';
  if(clean.scheduleMode==='scheduled'){
   const dupTime=Array.isArray(b.times)?b.times.find((t,i)=>b.times.indexOf(t)!==i):null;if(dupTime&&validTime(dupTime))throw bad(`${dupTime} 填了两次，每个时间只填一次`,'times');
   if(!Array.isArray(b.times)||b.times.length<1||b.times.length>12||b.times.some(t=>!validTime(t))||new Set(b.times).size!==b.times.length)throw bad('请填写 1–12 个不重复的有效服用时间','times');
   clean.times=[...b.times].sort();
  }else clean.times=[];
 }
 if(kind==='dose'){
  clean.medicationId=String(b.medicationId||'').slice(0,100);if(!clean.medicationId)throw bad('请选择用药方案');
  clean.outcome=String(b.outcome||'');if(!['已服用','跳过'].includes(clean.outcome))throw bad('服用结果无效');
  clean.scheduledTime=String(b.scheduledTime||'');if(clean.scheduledTime&&!validTime(clean.scheduledTime))throw bad('计划时间格式无效');
  if(clean.date>today())throw bad('不能记录未来日期的服用结果','date','future_date');
  if(clean.outcome==='已服用'&&!clean.time)throw bad('请记录实际服用时间');
  if(clean.outcome==='已服用'&&clean.date===today()&&clean.time>nowHM())throw bad(`服药时间不能晚于现在，现在是 ${nowHM()}`,'time','future_date');
  if(clean.outcome==='跳过')clean.time='';
  if(clean.outcome==='跳过'&&!clean.note.trim())throw bad('跳过要写原因，比如「忘带药」');
  if(clean.date>today())throw bad('不能记录未来日期的服用结果');
 }
 if(kind==='meal'){
  clean.rawText=String(b.rawText||'').slice(0,5000);clean.portion=String(b.portion||'').slice(0,120);
  if(b.attachmentIds!==undefined&&(!Array.isArray(b.attachmentIds)||b.attachmentIds.length>4||b.attachmentIds.some(id=>typeof id!=='string')))throw bad('餐食附件最多 4 个');
  clean.attachmentIds=[...new Set(b.attachmentIds||[])];
 }
 if(kind==='task')clean.done=Boolean(b.done);
 if(kind==='file'){clean.size=Number(b.size)||0;clean.intakeStatus=clean.visitId?'已关联':String(b.intakeStatus||'待整理');clean.fileCategory=String(b.fileCategory||'一般资料').slice(0,80);}
 return clean;
}
// Provenance markers are never read from a request body (validate() drops them); they are carried over from the stored record
// on every write, so a web edit keeps the history. The MCP path passes via='mcp' (create sets createdVia/aiCreatedAt, every MCP write sets lastAiEditAt).
const PROVENANCE=['createdVia','aiCreatedAt','lastAiEditAt'];
function put(space,kind,body,id=randomUUID(),via){
 const old0=db.prepare('SELECT body FROM items WHERE id=? AND space=?').get(id,space);
 const clean=validate(kind,body,{original:old0?JSON.parse(old0.body):undefined});
 const old=db.prepare('SELECT body FROM items WHERE id=? AND space=?').get(id,space);const original=old?JSON.parse(old.body):{};
 for(const k of PROVENANCE)if(old&&original[k]!==undefined)clean[k]=original[k];
 if(via==='mcp'){const now=new Date().toISOString();if(!old){clean.createdVia='mcp';clean.aiCreatedAt=now;}clean.lastAiEditAt=now;}
 if(clean.visitId){const visit=db.prepare("SELECT body FROM items WHERE id=? AND space=? AND kind='visit'").get(clean.visitId,space);if(!visit&&original.visitId!==clean.visitId)throw bad('关联就诊不存在或不在当前空间');}
 if(kind==='file'&&clean.visitId){const conflict=getAll(space).find(x=>x.kind==='report'&&x.fileId===id&&x.visitId!==clean.visitId);if(conflict)throw bad('原件已被其他就诊的报告关联，请先调整报告关联');}
 if(kind==='report'&&clean.fileId){const f=db.prepare("SELECT body FROM items WHERE id=? AND space=? AND kind='file'").get(clean.fileId,space);if(!f){if(original.fileId!==clean.fileId)throw bad('关联原件不存在或不在当前空间')}else{const file=JSON.parse(f.body);if(file.visitId&&file.visitId!==clean.visitId)throw bad('原件属于另一次就诊，请选择同次就诊的资料');}}
 if(kind==='medication'&&clean.imageFileId){
  const f=db.prepare("SELECT body FROM items WHERE id=? AND space=? AND kind='file'").get(clean.imageFileId,space);
  if(!f){if(original.imageFileId!==clean.imageFileId)throw bad('药品图片不存在或不在当前空间','imageFileId');}
  else if(!['image/png','image/jpeg','image/webp'].includes(JSON.parse(f.body).mime))throw bad('药品图片仅支持 PNG、JPG 和 WEBP','imageFileId');
 }
 if(kind==='meal')for(const fileId of clean.attachmentIds){if(!db.prepare("SELECT id FROM items WHERE id=? AND space=? AND kind='file'").get(fileId,space)&&!(original.attachmentIds||[]).includes(fileId))throw bad('餐食附件不存在或不在当前空间');}
 if(kind==='dose'){
  const medRow=db.prepare("SELECT body FROM items WHERE id=? AND space=? AND kind='medication'").get(clean.medicationId,space);if(!medRow)throw bad('用药方案不存在或不在当前空间');const med=JSON.parse(medRow.body);
  if(clean.date<med.date)throw bad(`这个方案从 ${md(med.date)}开始，服药日期不能早于这天`,'date');
  if(med.endDate&&clean.date>med.endDate)throw bad(`这个方案到 ${md(med.endDate)}结束，服药日期不能晚于这天`,'date');
  if(clean.scheduledTime&&med.scheduleMode==='asNeeded')throw bad('按需用药不设置计划服用时段');
  if(clean.scheduledTime&&!med.times.includes(clean.scheduledTime)&&!(original.scheduledTime===clean.scheduledTime&&original.medicationId===clean.medicationId))throw bad('计划时段不属于该用药方案，补记可不选择计划时段');
  if(clean.scheduledTime){const duplicate=getAll(space).find(x=>x.kind==='dose'&&x.id!==id&&x.medicationId===clean.medicationId&&x.date===clean.date&&x.scheduledTime===clean.scheduledTime);if(duplicate)throw bad('该时段已有记录，请编辑原记录');}
 }
 db.prepare('INSERT INTO items VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(id,space,kind,JSON.stringify(clean));return {id,kind,...clean};
}
if(!getAll('demo').length){
 for(let i=0;i<14;i++){const date=day(i-13);put('demo','metric',{title:'晨起体重',type:'weight',value:Math.round((68.7-i*.045+Math.sin(i)*.15)*10)/10,date,time:'07:30',note:'示例记录'});put('demo','metric',{title:'睡眠记录',type:'sleep',value:Math.round((7.1+Math.sin(i)*.6)*10)/10,date,note:'示例记录'});}
 put('demo','metric',{title:'晨间血压',type:'pressure',value:118,secondary:76,date:today(),time:'07:40',note:'示例记录'});
 put('demo','visit',{title:'年度健康体检',date:day(-8),hospital:'示例健康中心',department:'体检科',status:'已完成',note:'这是一条虚构示例。检查原件可在资料档案中关联。'});
 put('demo','visit',{title:'复诊咨询',date:day(5),hospital:'示例门诊',department:'全科',status:'待就诊',note:'整理近期记录，准备就诊问题清单。'});
 for(const [i,title,duration,type] of [[0,'傍晚轻松走',35,'步行'],[-1,'全身力量练习',40,'力量训练'],[-3,'公园慢跑',30,'跑步']])put('demo','exercise',{title,date:day(i),duration,type,note:'主观感受：轻松 · 示例记录'});
 for(const [mealType,title,time] of [['早餐','燕麦、鸡蛋与牛奶','08:00'],['午餐','杂粮饭、时蔬与鸡肉','12:20']])put('demo','meal',{title,date:today(),mealType,time,note:'餐食组成示例，不代表个性化膳食建议'});
 for(const [title,category,time,done] of [['晨间监测','监测','07:30',true],['记录今天的午餐','饮食','12:30',true],['户外步行 30 分钟','锻炼','18:00',false],['整理复诊问题清单','就诊','20:00',false]])put('demo','task',{title,date:today(),category,time,done,note:'示例计划，自行设置'});
}
// Versioned demonstration content; never seed the personal space.
db.exec('CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
// 「最近删除」 trash (30 days). Web and MCP deletes both land here; the web's 12-second undo (deleted_items) keeps working alongside.
db.exec(fs.readFileSync(path.join(root,'migrations','003-trash.sql'),'utf8'));
const TRASH_MS=30*24*3600*1000;
const purgeTrash=()=>db.prepare('DELETE FROM trash_items WHERE expires_at<=?').run(Date.now());
purgeTrash();
// Same rule as the web: a medication that already has dose records cannot be deleted (deleting a visit does not cascade; its reports/medications stay, linked to a removed visit).
function softDelete(space,id,via){
 const old=db.prepare('SELECT * FROM items WHERE id=? AND space=?').get(id,space);if(!old)return null;
 if(old.kind==='medication'&&getAll(space).some(x=>x.kind==='dose'&&x.medicationId===id))throw bad('该方案已有服用记录，请停用以保留历史，或先移除服用记录');
 const now=Date.now();
 db.exec('BEGIN');try{
  if(via==='web')db.prepare('INSERT OR REPLACE INTO deleted_items VALUES(?,?,?,?,?)').run(id,space,old.kind,old.body,now+12000);
  db.prepare('INSERT OR REPLACE INTO trash_items VALUES(?,?,?,?,?,?,?)').run(id,space,old.kind,old.body,now,via,now+TRASH_MS);
  db.prepare('DELETE FROM items WHERE id=? AND space=?').run(id,space);db.exec('COMMIT');
 }catch(err){db.exec('ROLLBACK');throw err}
 return {id,kind:old.kind,...JSON.parse(old.body)};
}
// Settings per data scope: name/focus (web) and waterGoalMl (daily water goal, default 2000ml; used by get_today and the web).
function writeSettings(space,b){
 const cur=JSON.parse(db.prepare('SELECT body FROM settings WHERE space=?').get(space)?.body||'{}');const clean={name:String(cur.name||'Captain').slice(0,40),focus:String(cur.focus||'').slice(0,180),...(cur.waterGoalMl?{waterGoalMl:cur.waterGoalMl}:{})};
 if(b.name!==undefined)clean.name=String(b.name||'Captain').slice(0,40);
 if(b.focus!==undefined)clean.focus=String(b.focus||'').slice(0,180);
 if(b.waterGoalMl!==undefined&&b.waterGoalMl!==''){const v=Number(b.waterGoalMl);if(!Number.isInteger(v)||v<100||v>10000)throw bad('每日饮水目标需在 100–10000 毫升之间','waterGoalMl');clean.waterGoalMl=v;}
 db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(space,JSON.stringify(clean));return clean;
}
const PARENT_NAMES={visit:'就诊记录',medication:'用药方案'};
// Restoring needs the parent back first (visit for report/medication, medication for dose); otherwise a plain error.
function parentOf(kind,body){if(['report','medication'].includes(kind)&&body.visitId)return {kind:'visit',id:body.visitId};if(kind==='dose'&&body.medicationId)return {kind:'medication',id:body.medicationId};return null;}
// restorable:false + reason when the parent (visit / medication) is gone for good (neither live nor in the trash).
function listTrash(space){purgeTrash();return db.prepare('SELECT id,kind,body,deleted_at,deleted_via,expires_at FROM trash_items WHERE space=? ORDER BY deleted_at DESC').all(space).map(r=>{const b=JSON.parse(r.body),p=parentOf(r.kind,b);
 const gone=p&&!db.prepare('SELECT id FROM items WHERE id=? AND space=? AND kind=?').get(p.id,space,p.kind)&&!db.prepare('SELECT id FROM trash_items WHERE id=? AND space=?').get(p.id,space);
 return {id:r.id,kind:r.kind,...b,deletedAt:new Date(r.deleted_at).toISOString(),deletedVia:r.deleted_via,expiresAt:new Date(r.expires_at).toISOString(),restorable:!gone,...(gone?{reason:`所属${p.kind==='visit'?'就诊':'用药方案'}已清除，无法恢复`}:{})};});}
// Ancestors that are in the trash, nearest first (dose → medication → visit), stopping at the first one not in the trash.
function trashedChain(space,parent){const out=[];while(parent){const r=db.prepare('SELECT body FROM trash_items WHERE id=? AND space=? AND kind=?').get(parent.id,space,parent.kind);if(!r)break;const b=JSON.parse(r.body);out.push({...parent,title:b.title});parent=parentOf(parent.kind,b);}return out;}
// 「所属就诊也已删除」/「所属用药方案也已删除」/「用药方案和所属就诊也已删除」
const KN=k=>k==='visit'?'就诊':'用药方案';
const chainText=chain=>{const n=c=>`${KN(c.kind)}「${c.title}」`;return chain.length>1?`${chain.slice(0,-1).map(n).join('、')}和所属${n(chain.at(-1))}也已删除`:`所属${n(chain[0])}也已删除`;};
// opts.withParent: when the parent (visit / medication) is also in the trash, restore it first (recursively), then this record.
function restoreFromTrash(space,id,opts={}){
 purgeTrash();
 const t=db.prepare('SELECT * FROM trash_items WHERE id=? AND space=?').get(String(id||''),space);if(!t)throw bad('最近删除里没有这条记录，可能已超过 30 天或已恢复','id','not_found');
 if(db.prepare('SELECT id FROM items WHERE id=?').get(t.id))throw bad('这条记录已经恢复过了');
 const body=JSON.parse(t.body);const parent=parentOf(t.kind,body);let parentRestored=null;
 if(parent&&!db.prepare('SELECT id FROM items WHERE id=? AND space=? AND kind=?').get(parent.id,space,parent.kind)){
  const inTrash=db.prepare('SELECT id FROM trash_items WHERE id=? AND space=?').get(parent.id,space);
  if(inTrash&&opts.withParent)parentRestored=restoreFromTrash(space,parent.id,opts);
  else if(inTrash){const chain=trashedChain(space,parent);throw Object.assign(bad(`${chainText(chain)}，需要一起恢复`,undefined,'parent_deleted'),{parentId:parent.id,parentKind:parent.kind,parentKinds:chain.map(c=>c.kind),parentIds:chain.map(c=>c.id)});}
  else throw Object.assign(bad(`它所属的${PARENT_NAMES[parent.kind]}已经不在了，无法恢复`,undefined,'parent_missing'),{parentKind:parent.kind});
 }
 if(t.kind==='dose'&&body.scheduledTime&&getAll(space).some(x=>x.kind==='dose'&&x.medicationId===body.medicationId&&x.date===body.date&&x.scheduledTime===body.scheduledTime))throw bad('该时段已有服用结果，不能恢复为重复记录');
 db.exec('BEGIN');try{db.prepare('INSERT INTO items VALUES(?,?,?,?)').run(t.id,space,t.kind,t.body);db.prepare('DELETE FROM trash_items WHERE id=?').run(t.id);db.prepare('DELETE FROM deleted_items WHERE id=?').run(t.id);db.exec('COMMIT');}catch(err){db.exec('ROLLBACK');throw err}
 return {id:t.id,kind:t.kind,...body,restoredCount:1+(parentRestored?.restoredCount||0),...(parentRestored?{parentRestored:{id:parentRestored.id,kind:parentRestored.kind,title:parentRestored.title}}:{})};
}
// Ids of visits/medications in this space's trash (so the web can say 「就诊已删除 · 可在最近删除恢复」).
const trashedIds=space=>db.prepare("SELECT id FROM trash_items WHERE space=? AND kind IN ('visit','medication') AND expires_at>?").all(space,Date.now()).map(r=>r.id);
// All data scopes of one base space (personal/demo) for the current user, across workbenches.
function userScopes(user,base){
 if(authEnabled&&user)return db.prepare('SELECT w.id,w.name,d.space FROM user_workbenches w JOIN data_scopes d ON d.user_id=w.user_id AND d.workbench_id=w.id WHERE w.user_id=? AND d.base_space=? ORDER BY w.rowid').all(user.id,base);
 return getWorkbenches().map(w=>({id:w.id,name:w.name,space:w.id==='health'?base:`${base}::${w.id}`}));
}
if(!db.prepare('SELECT key FROM app_meta WHERE key=?').get('medical-demo-v1')){
 const visit=getAll('demo').find(x=>x.kind==='visit');
 if(visit){
  put('demo','report',{title:'示例门诊记录',date:visit.date,visitId:visit.id,type:'就诊记录',status:'已归档',source:'示例健康中心 · 纸质记录手录',content:'这是一份虚构的界面演示记录。\n主诉、检查所见和医生结论应按原文录入。\n这里没有真实诊断或个性化医疗建议。',note:'仅演示如何将报告与同次就诊关联。'});
  put('demo','medication',{title:'示例药物 A（非真实处方）',date:today(),endDate:day(7),visitId:visit.id,dosage:'示例用量，请勿参考用药',route:'按处方指定途径',frequency:'按处方录入',scheduleMode:'scheduled',times:['08:00','20:00'],status:'进行中',prescriber:'示例医生',note:'虚构方案，仅供体验已服用、跳过及历史记录交互。'});
  put('demo','task',{title:'复查前整理报告和服用记录',date:day(5),visitId:visit.id,category:'就诊',time:'09:00',done:false,note:'示例复查安排，由用户自行确认。'});
 }
 db.prepare('INSERT INTO app_meta VALUES(?,?)').run('medical-demo-v1','seeded');
}
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body))};
async function readBody(req){let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>15*1024*1024){const e=Object.assign(new Error('上传内容超过限制'),{status:413,expose:true});throw e;}chunks.push(c)}if(req.authSnapshot){const current=accounts.session(req);if(!current||current.session_id!==req.authSnapshot.session_id||current.id!==req.authSnapshot.id||current.role!==req.authSnapshot.role){const error=Object.assign(new Error('登录状态已失效，请重新登录'),{status:401,expose:true});throw error;}}let parsed;try{parsed=JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{throw bad('请求格式无效')}if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw bad('请求格式无效');return parsed;}
const mime={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.bcmap':'application/octet-stream','.ttf':'font/ttf','.pfb':'application/octet-stream','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const allowedFiles={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.txt':'text/plain','.webp':'image/webp','.webm':'audio/webm','.m4a':'audio/mp4','.ogg':'audio/ogg','.mp3':'audio/mpeg'};
// Text responses only; images/PDF/audio are already compressed. Hashed assets use build-time .br/.gz siblings
// (verified against the source hash) or are compressed once and kept in memory; mutable files are compressed per request.
const compressible=type=>/^(text\/|application\/(javascript|json|manifest\+json)|image\/svg\+xml)/.test(type);
function negotiate(header=''){const q={};for(const part of String(header).split(',')){const [name,...params]=part.trim().toLowerCase().split(';');const qv=params.map(x=>x.trim()).find(x=>x.startsWith('q='));q[name]=qv?Number(qv.slice(2)):1;}const ok=n=>(q[n]??q['*']??0)>0;return ok('br')?'br':ok('gzip')?'gzip':null;}
const compressCache=new Map();
function compressed(file,bytes,type,accept,immutable){
 const encoding=compressible(type)&&bytes.length>=256?negotiate(accept):null;if(!encoding)return {body:bytes,encoding:null};
 const key=file+'\0'+encoding;if(immutable&&compressCache.has(key))return {body:compressCache.get(key),encoding};
 let body=null;if(immutable){try{const pre=fs.readFileSync(file+(encoding==='br'?'.br':'.gz'));const raw=encoding==='br'?zlib.brotliDecompressSync(pre):zlib.gunzipSync(pre);if(raw.equals(bytes))body=pre;}catch{}}
 body??=encoding==='br'?zlib.brotliCompressSync(bytes,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:immutable?11:5,[zlib.constants.BROTLI_PARAM_SIZE_HINT]:bytes.length}}):zlib.gzipSync(bytes,{level:immutable?9:6});
 if(immutable){compressCache.set(key,body);if(compressCache.size>64)compressCache.delete(compressCache.keys().next().value);}
 return {body,encoding};
}
const accounts=createAccounts({db,enabled:authEnabled,origin:appOrigin,json,readBody,bootstrap:(u,url)=>bootstrapPayload(u,url)});
// Shared by GET /api/bootstrap and a successful POST /api/auth/login, so both return the identical {me,state} for one user.
function bootstrapPayload(user,url){
 const me={enabled:authEnabled,user:user?publicUser(user):null};
 const baseSpace=url.searchParams.get('space')==='demo'?'demo':'personal';const workbenchId=url.searchParams.get('workbench')||'health';
 const workbenches=authEnabled&&user?db.prepare('SELECT id,name,type FROM user_workbenches WHERE user_id=? ORDER BY rowid').all(user.id):getWorkbenches();
 const workbench=workbenches.find(x=>x.id===workbenchId);
 const space=authEnabled&&user?db.prepare('SELECT space FROM data_scopes WHERE user_id=? AND workbench_id=? AND base_space=?').get(user.id,workbenchId,baseSpace)?.space:(workbenchId==='health'?baseSpace:`${baseSpace}::${workbenchId}`);
 if(!workbench||!space)return {me,state:null};
 const settings=JSON.parse(db.prepare('SELECT body FROM settings WHERE space=?').get(space)?.body||JSON.stringify({name:user?.name||'Captain',focus:'建立可持续的健康习惯'}));
 return {me,state:{owner:user?.id??null,space:baseSpace,workbenches,workbench,items:getAll(space),settings,today:today(),trashedIds:trashedIds(space)}};
}
// Remote MCP endpoint (Streamable HTTP, JSON responses, stateless). Bearer token only (personal access token or app token); cookies are never accepted, so a browser cannot be driven cross-site. Host is already checked above.
// MCP originals use the same private file rows and download authorization as the web.
const fileDigest=f=>{const p=path.join(dataDir,'uploads',path.basename(f.storageName));return fs.existsSync(p)?{sha256:createHash('sha256').update(fs.readFileSync(p)).digest('hex')}:{sha256:null,missing:true};};
const attachmentMeta=(space,f)=>({id:f.id,name:f.name||f.title,title:f.title,date:f.date,type:f.mime,size:f.size,visitId:f.visitId||'',...fileDigest(f)});
const listAttachments=(space,limit)=>{const files=getAll(space).filter(f=>f.kind==='file'&&f.fileCategory!=='餐食附件').sort((a,b)=>b.date.localeCompare(a.date));return {total:files.length,returned:Math.min(limit,files.length),files:files.slice(0,limit).map(f=>attachmentMeta(space,f))};};
function uploadAttachment(space,b){
 const name=b.name;if(/[\\/\x00-\x1f\x7f]/.test(name)||name==='.'||name==='..')throw bad('文件名不能包含路径或控制字符');
 const ext=path.extname(name).toLowerCase();if(!['.pdf','.png','.jpg','.jpeg','.webp','.txt'].includes(ext))throw bad('支持 PDF、PNG、JPG、WEBP 和 TXT');
 const encoded=b.contentBase64;if(encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw bad('文件编码格式无效');
 const bytes=Buffer.from(encoded,'base64');if(!bytes.length||bytes.length>10*1024*1024)throw bad('文件需大于 0 且不超过 10MB');
 if(bytes.toString('base64')!==encoded)throw bad('文件编码格式无效');
 const hash=createHash('sha256').update(bytes).digest('hex');if(hash!==b.sha256)throw bad('文件校验失败，请重新读取原件');
 const title=b.title||name,note=b.note||'';
 const body=validate('file',{title,date:b.date,name,mime:allowedFiles[ext],size:bytes.length,storageName:randomUUID()+ext,note,fileCategory:'报告原件'});
 // Compare the actual persisted bytes, so web edits cannot leave a stale trusted digest.
 const existing=getAll(space).find(f=>f.kind==='file'&&f.name===name&&f.date===body.date&&f.title===body.title&&f.note===body.note&&f.size===bytes.length&&f.fileCategory==='报告原件'&&fs.existsSync(path.join(dataDir,'uploads',path.basename(f.storageName)))&&attachmentMeta(space,f).sha256===hash);
 if(existing)return {uploaded:attachmentMeta(space,existing),reused:true};
 const destination=path.join(dataDir,'uploads',body.storageName);let written=false;
 db.exec('BEGIN IMMEDIATE');try{const fd=fs.openSync(destination,'wx',0o600);written=true;try{fs.writeFileSync(fd,bytes);}finally{fs.closeSync(fd);}const f=put(space,'file',body,undefined,'mcp');const uploaded=attachmentMeta(space,f);db.exec('COMMIT');return {uploaded,reused:false};}
 catch(e){if(db.isTransaction)db.exec('ROLLBACK');if(written)fs.unlinkSync(destination);throw e;}
}
function attachReportFile(space,{reportId,fileId}){
 const report=getAll(space).find(x=>x.id===reportId&&x.kind==='report'),file=getAll(space).find(x=>x.id===fileId&&x.kind==='file');
 if(!report||!file)throw bad('没有找到报告或原件，请重新查询');
 if(file.fileCategory==='餐食附件')throw bad('请选择报告原件，不能使用餐食附件');
 if(report.fileId&&report.fileId!==fileId)throw bad('报告已有其他原件，请到网页核对后调整');
 if(!report.visitId||!db.prepare("SELECT id FROM items WHERE id=? AND space=? AND kind='visit'").get(report.visitId,space))throw bad('报告所属就诊不存在，请先恢复或关联就诊');
 if(file.visitId&&file.visitId!==report.visitId)throw bad('原件属于另一次就诊');
 if(!fs.existsSync(path.join(dataDir,'uploads',path.basename(file.storageName))))throw bad('文件内容缺失');
 if(report.fileId===fileId&&file.visitId===report.visitId)return report;
 db.exec('BEGIN IMMEDIATE');try{put(space,'file',{...file,visitId:report.visitId},fileId,'mcp');const updated=put(space,'report',{...report,fileId},reportId,'mcp');db.exec('COMMIT');return updated;}
 catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
}
function attachMedicationImage(space,{medicationId,fileId}){
 const medication=getAll(space).find(x=>x.id===medicationId&&x.kind==='medication');
 const file=getAll(space).find(x=>x.id===fileId&&x.kind==='file');
 if(!medication||!file)throw bad('没有找到用药方案或图片，请重新查询');
 if(!['image/png','image/jpeg','image/webp'].includes(file.mime))throw bad('药品图片仅支持 PNG、JPG 和 WEBP');
 if(medication.imageFileId&&medication.imageFileId!==fileId)throw bad('用药已有其他图片，请到网页核对后调整');
 if(!fs.existsSync(path.join(dataDir,'uploads',path.basename(file.storageName))))throw bad('文件内容缺失');
 if(medication.imageFileId===fileId)return medication;
 return put(space,'medication',{...medication,imageFileId:fileId},medicationId,'mcp');
}
const mcp=createMcp({db,put,getAll,today,validDate,nowHM,softDelete,listTrash,restoreFromTrash,readSettings:space=>JSON.parse(db.prepare('SELECT body FROM settings WHERE space=?').get(space)?.body||'{}'),writeSettings,validateWorkbench,assertUniqueWorkbenchName,uploadAttachment,listAttachments,attachReportFile,attachMedicationImage});
const mcpRate=new Map();const MCP_RATE=Number(process.env.MCP_RATE_PER_MINUTE||120);
async function handleMcp(req,res){
 const unauthorized=(code,message)=>{res.writeHead(401,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','WWW-Authenticate':`Bearer realm="zhiheng", error="invalid_token"`});res.end(JSON.stringify({error:message,code}));};
 if(req.method!=='POST'){res.setHeader('Allow','POST');return json(res,405,{error:'MCP 仅支持 POST 请求',code:'method_not_allowed'});}
 if(!authEnabled)return json(res,404,{error:'助手连接暂未开放',code:'mcp_disabled'});
 if(hasSessionCookie(req))return unauthorized('token_forbidden','助手连接不接受网页登录状态，请使用访问令牌');
 if(!hasBearerScheme(req))return unauthorized('token_missing','缺少访问令牌');const token=bearerToken(req);if(!token)return unauthorized('token_invalid','访问令牌无效或已撤销');
 const user=accounts.session({headers:{authorization:req.headers.authorization}});if(!user)return unauthorized('token_invalid','访问令牌无效或已撤销');
 const version=req.headers['mcp-protocol-version'];if(version&&!MCP_PROTOCOL_VERSIONS.includes(version))return json(res,400,{jsonrpc:'2.0',id:null,error:{code:-32600,message:`不支持的协议版本：${version}`,data:{code:'unsupported_protocol_version'}}});
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return json(res,415,{error:'需使用 JSON 请求',code:'unsupported_media_type'});
 const key=digest(token),now=Date.now(),bucket=mcpRate.get(key);if(!bucket||now-bucket.start>=60000)mcpRate.set(key,{start:now,n:1});else if(++bucket.n>MCP_RATE){const wait=Math.max(1,Math.ceil((bucket.start+60000-now)/1000));res.setHeader('Retry-After',String(wait));return json(res,429,{jsonrpc:'2.0',id:null,error:{code:-32000,message:`请求过于频繁，请 ${wait} 秒后重试`,data:{code:'rate_limited',retryAfter:wait}}});}
 if(mcpRate.size>1000)for(const [k,v] of mcpRate)if(now-v.start>=60000)mcpRate.delete(k);
 let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>14*1024*1024)return json(res,413,{jsonrpc:'2.0',id:null,error:{code:-32600,message:'内容太长了，请分几条记录',data:{code:'payload_too_large'}}});chunks.push(c);}
 let msg;try{msg=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'JSON 解析失败'}});}
 if(size>1024*1024&&!(msg?.method==='tools/call'&&msg?.params?.name==='upload_attachment'))return json(res,413,{jsonrpc:'2.0',id:msg?.id??null,error:{code:-32600,message:'内容太长了，请分几条记录',data:{code:'payload_too_large'}}});
 const current=accounts.session({headers:{authorization:req.headers.authorization}});if(!current||current.id!==user.id||current.session_id!==user.session_id||current.role!==user.role)return unauthorized('token_invalid','访问令牌无效或已撤销');
 let out;try{out=mcp.handle(user,msg,version);}catch(e){console.error('[mcp-error]',e);return json(res,500,{jsonrpc:'2.0',id:msg?.id??null,error:{code:-32603,message:'服务器内部错误',data:{code:'internal_error'}}});}
 if(out.status===202){res.writeHead(202,{'Cache-Control':'no-store'});return res.end();}
 return json(res,out.status,out.body);
}
const server=http.createServer(async(req,res)=>{try{
 res.setHeader('X-Content-Type-Options','nosniff');
 if(appOrigin?.startsWith('https:'))res.setHeader('Strict-Transport-Security','max-age=31536000');
 const requestHost=req.headers.host||'';
 if(appOrigin?requestHost!==new URL(appOrigin).host:!(/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestHost)))return json(res,403,{error:'访问主机无效'});
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/healthz'&&req.method==='GET')return json(res,200,{status:'ok'});
 if(url.pathname==='/mcp')return handleMcp(req,res);
 if(req.method!=='GET'&&req.method!=='HEAD'){
  const expected=appOrigin||`http://${requestHost}`;const origin=req.headers.origin;
  // Native app exemption (never for cookie auth): a request with a Bearer token and no session cookie authenticates only via that token, so a forged cross-site browser request cannot ride an ambient credential. App login issues the token in the body and sets no cookie; it is exempt only when no session cookie is sent and any Origin present is ours.
  const noCookie=!hasSessionCookie(req);const appRequest=authEnabled&&noCookie&&(bearerToken(req)||(url.pathname==='/api/auth/app-login'&&(!origin||origin===expected)));
  if(!appRequest&&((authEnabled&&origin!==expected)||(origin&&origin!==expected)||req.headers['sec-fetch-site']==='cross-site'))return json(res,403,{error:'只接受同源操作'});
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return json(res,415,{error:'需使用 JSON 请求'});
 }
 const user=authEnabled?accounts.session(req,res,{renew:url.pathname.startsWith('/api/')}):null;
 if(user&&!['/api/auth/login','/api/auth/accept-invitation'].includes(url.pathname))req.authSnapshot=user;
 if(await accounts.handle(req,res,url,user))return;
 // Single startup round trip ({me,state}): account state plus the requested workbench state. Unauthenticated sessions get only {me}, as /api/auth/me would.
 const isBootstrap=url.pathname==='/api/bootstrap';
 if(isBootstrap&&req.method!=='GET')return json(res,405,{error:'方法不支持'});
 if(isBootstrap&&authEnabled&&!user)return json(res,200,{me:{enabled:true,user:null}});
 if(authEnabled&&url.pathname.startsWith('/api/')&&!user)return hasBearerScheme(req)&&!hasSessionCookie(req)?json(res,401,{error:'访问令牌无效或已撤销',code:'token_invalid'}):json(res,401,{error:'请先登录',code:'token_missing'});
 const baseSpace=url.searchParams.get('space')==='demo'?'demo':'personal';const workbenchId=url.searchParams.get('workbench')||'health';
 const workbenches=authEnabled&&user?db.prepare('SELECT id,name,type FROM user_workbenches WHERE user_id=? ORDER BY rowid').all(user.id):getWorkbenches();
 // Static assets remain available before login; data scopes are resolved only by the authenticated user.
 const workbench=workbenches.find(x=>x.id===workbenchId);
 const space=authEnabled&&user?db.prepare('SELECT space FROM data_scopes WHERE user_id=? AND workbench_id=? AND base_space=?').get(user.id,workbenchId,baseSpace)?.space:(workbenchId==='health'?baseSpace:`${baseSpace}::${workbenchId}`);
 const readSettings=()=>JSON.parse(db.prepare('SELECT body FROM settings WHERE space=?').get(space)?.body||JSON.stringify({name:user?.name||'Captain',focus:'建立可持续的健康习惯'}));
 if(isBootstrap)return json(res,200,bootstrapPayload(user,url));
 // 「最近删除」 covers every workbench of the current base space (personal or demo).
 if(url.pathname==='/api/trash'&&req.method==='GET'){const out=[];for(const w of userScopes(user,baseSpace))for(const x of listTrash(w.space))out.push({...x,workbench:w.id,workbenchName:w.name});out.sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt));return json(res,200,{items:out.map(({storageName,...x})=>x)});}
 if(url.pathname==='/api/trash/restore'&&req.method==='POST'){const b=await readBody(req);const scopes=userScopes(user,baseSpace);const row=db.prepare('SELECT space FROM trash_items WHERE id=?').get(String(b.id||''));const w=row&&scopes.find(x=>x.space===row.space);if(!w)return json(res,404,{error:'最近删除里没有这条记录，可能已超过 30 天或已恢复',code:'not_found'});const r=restoreFromTrash(w.space,b.id,{withParent:b.withParent===true});const {storageName,...pub}=r;return json(res,200,{...pub,workbench:w.id,workbenchName:w.name});}
 if(url.pathname.startsWith('/api/')&&!workbench)return json(res,404,{error:'工作台不存在'});
 if(authEnabled&&user&&url.pathname.startsWith('/api/')&&!space)return json(res,404,{error:'工作台空间不存在'});
 const checkKind=kind=>{if(workbenchId!=='health'&&!['note','task'].includes(kind))throw bad('此工作台仅支持备忘与待办');};
 if(url.pathname==='/api/workbenches'){if(req.method==='GET')return json(res,200,{workbenches});if(req.method==='POST'){const item=validateWorkbench(await readBody(req),workbenches);if(authEnabled){db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO user_workbenches VALUES(?,?,?,?)').run(user.id,item.id,item.name,item.type);for(const base of ['personal','demo'])db.prepare('INSERT INTO data_scopes VALUES(?,?,?,?)').run(user.id,item.id,base,`account:${user.id}:${item.id}:${base}`);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}else db.prepare('INSERT INTO workbenches(id,name,type) VALUES(?,?,?)').run(item.id,item.name,item.type);return json(res,201,item)}return json(res,405,{error:'方法不支持'})}
 if(workbenchId!=='health'&&['/api/upload','/api/capture-meal'].includes(url.pathname))return json(res,400,{error:'此工作台仅支持备忘与待办，不支持上传或餐食记录'});
 if(url.pathname==='/api/state'){if(req.method!=='GET')return json(res,405,{error:'方法不支持'});return json(res,200,{owner:user?.id??null,workbenches,workbench,items:getAll(space),settings:readSettings(),today:today(),trashedIds:trashedIds(space)})}
 if(url.pathname==='/api/settings'&&req.method==='PUT'){const b=await readBody(req);return json(res,200,writeSettings(space,b,user))}

 if(url.pathname==='/api/items'&&req.method==='POST'){const {kind,...body}=await readBody(req);checkKind(kind);if(kind==='file')throw bad('请通过上传入口添加资料');return json(res,201,put(space,kind,body))}
 if(url.pathname.startsWith('/api/items/')){const id=url.pathname.split('/').pop();const old=db.prepare('SELECT * FROM items WHERE id=? AND space=?').get(id,space);if(!old)return json(res,404,{error:'记录不存在'});
  if(req.method==='PUT'){checkKind(old.kind);const body=await readBody(req);if(old.kind==='file'){const existing=JSON.parse(old.body);for(const key of ['title','date','note','visitId'])if(body[key]!==undefined)existing[key]=body[key];return json(res,200,put(space,old.kind,existing,id))}return json(res,200,put(space,old.kind,{...JSON.parse(old.body),...body},id))}
  if(req.method==='DELETE'){return json(res,200,{deleted:softDelete(space,id,'web')})}
 }
 if(url.pathname==='/api/restore'&&req.method==='POST'){
  const {id}=await readBody(req);const deleted=db.prepare('SELECT * FROM deleted_items WHERE id=? AND space=? AND expires_at>?').get(String(id||''),space,Date.now());
  if(!deleted)return json(res,404,{error:'没有可撤销的删除，或已超过 12 秒'});
  if(db.prepare('SELECT id FROM items WHERE id=?').get(id))throw bad('该记录已存在');
  const deletedBody=JSON.parse(deleted.body);const clean=validate(deleted.kind,deletedBody,{original:deletedBody});for(const k of PROVENANCE)if(deletedBody[k]!==undefined)clean[k]=deletedBody[k];if(deleted.kind==='dose'&&clean.scheduledTime&&getAll(space).some(x=>x.kind==='dose'&&x.medicationId===clean.medicationId&&x.date===clean.date&&x.scheduledTime===clean.scheduledTime))throw bad('该时段已有服用结果，不能撤销为重复记录');db.prepare('INSERT INTO items VALUES(?,?,?,?)').run(id,space,deleted.kind,JSON.stringify(clean));const restored={id,kind:deleted.kind,...clean};db.prepare('DELETE FROM deleted_items WHERE id=?').run(id);db.prepare('DELETE FROM trash_items WHERE id=?').run(id);return json(res,200,restored);
 }
 if(url.pathname==='/api/capture-meal'&&req.method==='POST'){
  const b=await readBody(req);const attachments=b.attachments||[];const existing=b.mealId?getAll(space).find(x=>x.id===b.mealId&&x.kind==='meal'):null;if(b.mealId&&!existing)return json(res,404,{error:'餐食记录不存在'});const keep=b.keepAttachmentIds===undefined?(existing?.attachmentIds||[]):b.keepAttachmentIds;if(!Array.isArray(keep)||keep.some(id=>!existing?.attachmentIds?.includes(id)))throw bad('保留附件无效');
  if(!Array.isArray(attachments)||attachments.length+keep.length>4)throw bad('最多保存 4 个附件','attachments');if(attachments.some(a=>!isPlainObject(a)))throw bad('附件格式无效','attachments');
  const rawText=String(b.text??existing?.rawText??'');const text=rawText.trim();if(!text&&!attachments.length&&!keep.length)throw bad('写一句话、添加照片或录一段语音即可保存');
  if(rawText.length>5000)throw bad('文字最多 5000 个字符');
  const staged=[];let total=keep.reduce((sum,id)=>sum+(getAll(space).find(f=>f.id===id&&f.kind==='file')?.size||0),0);if(total>10*1024*1024)throw bad('附件合计不能超过 10MB');
  for(const attachment of attachments){
   const name=path.basename(String(attachment.name||''));const ext=path.extname(name).toLowerCase();const type=allowedFiles[ext];
   if(!type||(!type.startsWith('image/')&&!type.startsWith('audio/')))throw bad('餐食附件仅支持JPG、PNG、WEBP照片与WEBM、M4A、OGG、MP3音频');
   const bytes=Buffer.from(String(attachment.content||''),'base64');total+=bytes.length;if(!bytes.length||total>10*1024*1024)throw bad('附件合计需大于 0 且不超过 10MB');
   const storageName=randomUUID()+ext;staged.push({id:randomUUID(),name,type,bytes,storageName});
  }
  const mealType=String(b.mealType||existing?.mealType||'餐食');const date=b.date||existing?.date||today();
  const body={...existing,title:(text||existing?.title||`${mealType} · ${staged.some(f=>f.type.startsWith('image/'))?'照片':'语音'}待整理`).slice(0,120),date,time:b.time??existing?.time??'',mealType,note:String(b.note??existing?.note??''),rawText,portion:String(b.portion??existing?.portion??''),attachmentIds:[...keep,...staged.map(f=>f.id)]};
  validate('meal',body);const written=[];
  db.exec('BEGIN');try{
   for(const file of staged){const p=path.join(dataDir,'uploads',file.storageName);fs.writeFileSync(p,file.bytes,{mode:0o600});written.push(p);put(space,'file',{title:file.name,date,time:b.time||'',name:file.name,mime:file.type,size:file.bytes.length,storageName:file.storageName,fileCategory:'餐食附件',intakeStatus:'待整理',note:file.type.startsWith('audio/')?'原始录音，尚未自动转写':'原始照片，尚未自动识别'},file.id);}
   const meal=put(space,'meal',body,existing?.id||randomUUID());db.exec('COMMIT');return json(res,existing?200:201,meal);
  }catch(error){db.exec('ROLLBACK');for(const p of written)try{fs.unlinkSync(p)}catch{}throw error;}
 }
 if(url.pathname==='/api/upload'&&req.method==='POST'){
  const b=await readBody(req);const name=path.basename(String(b.name||''));const ext=path.extname(name).toLowerCase();if(!allowedFiles[ext])throw bad('支持 PDF、PNG、JPG、WEBP 和 TXT');
  const bytes=Buffer.from(String(b.content||''),'base64');if(!bytes.length||bytes.length>10*1024*1024)throw bad('文件需大于 0 且不超过 10MB');
  const storageName=randomUUID()+ext;const body=validate('file',{...b,title:b.title||name,date:b.date||today(),name,mime:allowedFiles[ext],size:bytes.length,storageName});
  if(body.visitId&&!db.prepare("SELECT id FROM items WHERE id=? AND space=? AND kind='visit'").get(body.visitId,space))throw bad('关联就诊记录不存在');
  fs.writeFileSync(path.join(dataDir,'uploads',storageName),bytes,{mode:0o600});return json(res,201,put(space,'file',body));
 }
 if(url.pathname.startsWith('/api/files/')&&req.method==='GET'){
  const file=getAll(space).find(x=>x.kind==='file'&&x.id===url.pathname.split('/').pop());if(!file)return json(res,404,{error:'文件不存在'});
  const p=path.join(dataDir,'uploads',path.basename(file.storageName));if(!fs.existsSync(p))return json(res,404,{error:'文件内容缺失'});const safeMime=allowedFiles[path.extname(file.storageName).toLowerCase()]||'application/octet-stream';res.writeHead(200,{'Content-Type':safeMime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox; frame-ancestors 'self'",'Content-Disposition':`${url.searchParams.get('inline')==='1'?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`});fs.createReadStream(p).pipe(res);return;
 }
 if(url.pathname==='/api/export'&&req.method==='GET'){return json(res,200,{exportedAt:new Date().toISOString(),space:baseSpace,workbench,items:getAll(space),settings:JSON.parse(db.prepare('SELECT body FROM settings WHERE space=?').get(space)?.body||'{}')})}
 if(url.pathname.startsWith('/api/'))return json(res,404,{error:'接口不存在'});
 if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'方法不支持'});
 const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);const p=path.resolve(root,'public',relative);if(!p.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile())return json(res,404,{error:'页面不存在'});
 // Only verified content-addressed public code can be cached across sessions.
 const assetMatch=/^\/assets\/app\.([a-f0-9]{64})\.(js|css)$/.exec(url.pathname);
 const publicRoot=fs.realpathSync(path.join(root,'public'));
 if(!fs.realpathSync(p).startsWith(publicRoot+path.sep))return json(res,404,{error:'页面不存在'});
 const bytes=fs.readFileSync(p);
 const immutable=(!!assetMatch&&createHash('sha256').update(bytes).digest('hex')===assetMatch[1])||url.pathname.startsWith('/vendor/pdfjs/6.4.299/');
 const type=mime[path.extname(p)]||'application/octet-stream';
 const {body,encoding}=compressed(p,bytes,type,req.headers['accept-encoding'],immutable);
 res.writeHead(200,{'Content-Type':type,...(encoding?{'Content-Encoding':encoding}:{}),...(compressible(type)?{'Vary':'Accept-Encoding'}:{}),'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; font-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",'Cache-Control':immutable?'public, max-age=31536000, immutable':'no-store','Content-Length':body.length});
 if(req.method==='HEAD')return res.end();res.end(body);
 }catch(e){if(e?.expose){if(!res.headersSent){if(e.retryAfter)res.setHeader('Retry-After',String(e.retryAfter));json(res,e.status||400,{error:e.message,...(e.code?{code:e.code}:{}),...(e.field?{field:e.field}:{}),...(e.parentKind?{parentKind:e.parentKind}:{}),...(e.parentKinds?{parentKinds:e.parentKinds}:{})});}return;}console.error('[request-error]',req.method,req.url,e);if(!res.headersSent)json(res,500,{error:'服务器内部错误，请稍后重试'});else res.destroy();}});
server.listen(Number(process.env.PORT??3100),host,()=>console.log(`Health workbench http://localhost:${server.address().port}`));
