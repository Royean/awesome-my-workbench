import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.HEALTH_DATA_DIR||path.join(root,'data');
fs.mkdirSync(path.join(dataDir,'uploads'),{recursive:true,mode:0o700});
fs.chmodSync(dataDir,0o700);fs.chmodSync(path.join(dataDir,'uploads'),0o700);
const db=new DatabaseSync(path.join(dataDir,'health.sqlite'));
fs.chmodSync(path.join(dataDir,'health.sqlite'),0o600);
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, space TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings(space TEXT PRIMARY KEY, body TEXT NOT NULL);');
db.exec('CREATE TABLE IF NOT EXISTS deleted_items(id TEXT PRIMARY KEY, space TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, expires_at INTEGER NOT NULL)');
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const day=(offset=0)=>{const d=new Date(today()+'T12:00:00+08:00');d.setDate(d.getDate()+offset);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(d)};
const getAll=(space)=>db.prepare('SELECT id,kind,body FROM items WHERE space=?').all(space).map(r=>({id:r.id,kind:r.kind,...JSON.parse(r.body)}));
const kinds=['visit','exercise','meal','metric','task','file'];
const units={weight:'kg',pressure:'mmHg',glucose:'mmol/L',sleep:'小时',heart:'次/分'};
function validate(kind,b){
 if(!kinds.includes(kind))throw new Error('记录类型无效');
 if(typeof b.title!=='string'||!b.title.trim()||b.title.length>120)throw new Error('名称需为 1–120 个字符');
 if(typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||new Date(b.date+'T12:00:00Z').toISOString().slice(0,10)!==b.date)throw new Error('请选择有效日期');
 const clean={title:b.title.trim(),date:b.date,note:String(b.note||'').slice(0,5000)};
 for(const key of ['hospital','department','status','type','mealType','category','time','visitId','unit','name','mime','storageName'])if(b[key]!==undefined)clean[key]=String(b[key]).slice(0,250);
 if(clean.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(clean.time))throw new Error('时间格式需为 HH:MM');
 if(kind==='visit'&&!['待就诊','已完成','待复查'].includes(clean.status))throw new Error('就医状态无效');
 if(kind==='exercise'){if(!Number.isFinite(Number(b.duration))||Number(b.duration)<=0||Number(b.duration)>1440)throw new Error('运动时长需大于0且不超过1440分钟');clean.duration=Number(b.duration);}
 if(kind==='metric'){
  if(!units[clean.type])throw new Error('请选择监测项目');
  if(!Number.isFinite(Number(b.value))||Number(b.value)<=0||Number(b.value)>10000)throw new Error('请输入有效监测数值');
  clean.value=Number(b.value);clean.unit=units[clean.type];
  if(clean.type==='pressure'){if(!Number.isFinite(Number(b.secondary))||Number(b.secondary)<=0||Number(b.secondary)>=clean.value)throw new Error('舒张压需大于0且低于收缩压');clean.secondary=Number(b.secondary);}
 }
 if(kind==='task')clean.done=Boolean(b.done);
 if(kind==='file')clean.size=Number(b.size)||0;
 return clean;
}
function put(space,kind,body,id=randomUUID()){const clean=validate(kind,body);db.prepare('INSERT INTO items VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(id,space,kind,JSON.stringify(clean));return {id,kind,...clean};}
if(!getAll('demo').length){
 for(let i=0;i<14;i++){const date=day(i-13);put('demo','metric',{title:'晨起体重',type:'weight',value:Math.round((68.7-i*.045+Math.sin(i)*.15)*10)/10,date,time:'07:30',note:'示例记录'});put('demo','metric',{title:'睡眠记录',type:'sleep',value:Math.round((7.1+Math.sin(i)*.6)*10)/10,date,note:'示例记录'});}
 put('demo','metric',{title:'晨间血压',type:'pressure',value:118,secondary:76,date:today(),time:'07:40',note:'示例记录'});
 put('demo','visit',{title:'年度健康体检',date:day(-8),hospital:'示例健康中心',department:'体检科',status:'已完成',note:'这是一条虚构示例。检查原件可在资料档案中关联。'});
 put('demo','visit',{title:'复诊咨询',date:day(5),hospital:'示例门诊',department:'全科',status:'待就诊',note:'整理近期记录，准备就诊问题清单。'});
 for(const [i,title,duration,type] of [[0,'傍晚轻松走',35,'步行'],[-1,'全身力量练习',40,'力量训练'],[-3,'公园慢跑',30,'跑步']])put('demo','exercise',{title,date:day(i),duration,type,note:'主观感受：轻松 · 示例记录'});
 for(const [mealType,title,time] of [['早餐','燕麦、鸡蛋与牛奶','08:00'],['午餐','杂粮饭、时蔬与鸡肉','12:20']])put('demo','meal',{title,date:today(),mealType,time,note:'餐食组成示例，不代表个性化膳食建议'});
 for(const [title,category,time,done] of [['晨间监测','监测','07:30',true],['记录今天的午餐','饮食','12:30',true],['户外步行 30 分钟','锻炼','18:00',false],['整理复诊问题清单','就医','20:00',false]])put('demo','task',{title,date:today(),category,time,done,note:'示例计划，自行设置'});
}
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body))};
async function readBody(req){let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>15*1024*1024){const e=new Error('上传内容超过限制');e.status=413;throw e;}chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{throw new Error('请求格式无效')}}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const allowedFiles={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.txt':'text/plain','.webp':'image/webp'};
const server=http.createServer(async(req,res)=>{try{
 if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||''))return json(res,403,{error:'仅支持本机访问'});
 const url=new URL(req.url,'http://localhost');const space=url.searchParams.get('space')==='demo'?'demo':'personal';
 if(req.method!=='GET'&&req.method!=='HEAD'){
  const origin=req.headers.origin; if(origin&&origin!==`http://${req.headers.host}`)return json(res,403,{error:'只接受同源操作'});
  if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'只接受同源操作'});
  if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'需使用 JSON 请求'});
 }
 if(url.pathname==='/api/state'){if(req.method!=='GET')return json(res,405,{error:'方法不支持'});return json(res,200,{items:getAll(space),settings:JSON.parse(db.prepare('SELECT body FROM settings WHERE space=?').get(space)?.body||'{"name":"Captain","focus":"建立可持续的健康习惯"}'),today:today()})}
 if(url.pathname==='/api/settings'&&req.method==='PUT'){const b=await readBody(req);const clean={name:String(b.name||'Captain').slice(0,40),focus:String(b.focus||'').slice(0,180)};db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(space,JSON.stringify(clean));return json(res,200,clean)}
 if(url.pathname==='/api/items'&&req.method==='POST'){const {kind,...body}=await readBody(req);if(kind==='file')throw new Error('请通过上传入口添加资料');return json(res,201,put(space,kind,body))}
 if(url.pathname.startsWith('/api/items/')){const id=url.pathname.split('/').pop();const old=db.prepare('SELECT * FROM items WHERE id=? AND space=?').get(id,space);if(!old)return json(res,404,{error:'记录不存在'});
  if(req.method==='PUT'){const body=await readBody(req);if(old.kind==='file'){const existing=JSON.parse(old.body);for(const key of ['title','date','note','visitId'])if(body[key]!==undefined)existing[key]=body[key];if(existing.visitId&&!db.prepare("SELECT id FROM items WHERE id=? AND space=? AND kind='visit'").get(existing.visitId,space))throw new Error('关联就医记录不存在');return json(res,200,put(space,old.kind,existing,id))}return json(res,200,put(space,old.kind,{...JSON.parse(old.body),...body},id))}
  if(req.method==='DELETE'){db.exec('BEGIN');try{db.prepare('INSERT OR REPLACE INTO deleted_items VALUES(?,?,?,?,?)').run(id,space,old.kind,old.body,Date.now()+12000);db.prepare('DELETE FROM items WHERE id=? AND space=?').run(id,space);db.exec('COMMIT')}catch(err){db.exec('ROLLBACK');throw err}return json(res,200,{deleted:{id,kind:old.kind,...JSON.parse(old.body)}})}
 }
 if(url.pathname==='/api/restore'&&req.method==='POST'){
  const {id}=await readBody(req);const deleted=db.prepare('SELECT * FROM deleted_items WHERE id=? AND space=? AND expires_at>?').get(String(id||''),space,Date.now());
  if(!deleted)return json(res,404,{error:'没有可撤销的删除，或已超过12秒'});
  if(db.prepare('SELECT id FROM items WHERE id=?').get(id))throw new Error('该记录已存在');
  const restored=put(space,deleted.kind,JSON.parse(deleted.body),id);db.prepare('DELETE FROM deleted_items WHERE id=?').run(id);return json(res,200,restored);
 }
 if(url.pathname==='/api/upload'&&req.method==='POST'){
  const b=await readBody(req);const name=path.basename(String(b.name||''));const ext=path.extname(name).toLowerCase();if(!allowedFiles[ext])throw new Error('支持 PDF、PNG、JPG、WEBP 和 TXT');
  const bytes=Buffer.from(String(b.content||''),'base64');if(!bytes.length||bytes.length>10*1024*1024)throw new Error('文件需大于0且不超过10MB');
  const storageName=randomUUID()+ext;const body=validate('file',{...b,title:b.title||name,date:b.date||today(),name,mime:allowedFiles[ext],size:bytes.length,storageName});
  if(body.visitId&&!db.prepare("SELECT id FROM items WHERE id=? AND space=? AND kind='visit'").get(body.visitId,space))throw new Error('关联就医记录不存在');
  fs.writeFileSync(path.join(dataDir,'uploads',storageName),bytes,{mode:0o600});return json(res,201,put(space,'file',body));
 }
 if(url.pathname.startsWith('/api/files/')&&req.method==='GET'){
  const file=getAll(space).find(x=>x.kind==='file'&&x.id===url.pathname.split('/').pop());if(!file)return json(res,404,{error:'文件不存在'});
  const p=path.join(dataDir,'uploads',path.basename(file.storageName));if(!fs.existsSync(p))return json(res,404,{error:'文件内容缺失'});res.writeHead(200,{'Content-Type':file.mime,'X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`});fs.createReadStream(p).pipe(res);return;
 }
 if(url.pathname==='/api/export'&&req.method==='GET'){return json(res,200,{exportedAt:new Date().toISOString(),space,items:getAll(space),settings:JSON.parse(db.prepare('SELECT body FROM settings WHERE space=?').get(space)?.body||'{}')})}
 if(url.pathname.startsWith('/api/'))return json(res,404,{error:'接口不存在'});
 if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'方法不支持'});
 const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);const p=path.resolve(root,'public',relative);if(!p.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile())return json(res,404,{error:'页面不存在'});
 res.writeHead(200,{'Content-Type':mime[path.extname(p)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",'Cache-Control':'no-store'});fs.createReadStream(p).pipe(res);
 }catch(e){json(res,e.status||400,{error:e.message||'请求失败'})}});
server.listen(Number(process.env.PORT||3100),'127.0.0.1',()=>console.log(`Health workbench http://localhost:${process.env.PORT||3100}`));
