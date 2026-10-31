import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { today, validate, demoRecords } from '../../health-domain.mjs';
export const dynamic='force-dynamic';
const allowed:Record<string,string>={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.txt':'text/plain','.webp':'image/webp','.webm':'audio/webm','.m4a':'audio/mp4','.ogg':'audio/ogg','.mp3':'audio/mpeg'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function fail(message:string,status=400):never{throw Object.assign(new Error(message),{status})}
async function readBody(req:Request){if(Number(req.headers.get('content-length')||0)>15*1024*1024)fail('上传内容超过限制',413);const reader=req.body?.getReader();let size=0;const chunks:Uint8Array[]=[];if(reader)while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>15*1024*1024){await reader.cancel();fail('上传内容超过限制',413)}chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}try{return JSON.parse(new TextDecoder().decode(bytes)||'{}')}catch{fail('请求格式无效')}}
function attachment(b:any){const name=String(b.name||'').split(/[\\/]/).pop()!.slice(0,250);const ext=name.slice(name.lastIndexOf('.')).toLowerCase();const mime=allowed[ext];if(!mime)fail('支持 PDF、PNG、JPG、WEBP、TXT及常用音频');let bytes:Uint8Array;try{const raw=atob(String(b.content||''));bytes=Uint8Array.from(raw,c=>c.charCodeAt(0))}catch{fail('附件编码无效')}if(!bytes!.length||bytes!.length>10*1024*1024)fail('文件需大于0且不超过10MB');return {name,ext,mime,bytes:bytes!}}
async function handle(req:Request){try{
 const user=await getChatGPTUser();if(!user)return json({error:'请先使用 ChatGPT 登录'},401);
 const userId=user.userId;const url=new URL(req.url);const space=url.searchParams.get('space')==='demo'?'demo':'personal';const route=url.pathname;const method=req.method;
 if(!['GET','HEAD'].includes(method)){if(req.headers.get('origin')&&req.headers.get('origin')!==url.origin)fail('只接受同源操作',403);if(req.headers.get('sec-fetch-site')==='cross-site')fail('只接受同源操作',403);if(!req.headers.get('content-type')?.startsWith('application/json'))fail('需使用 JSON 请求',415)}
 const db=env.DB!;const bucket=env.BUCKET!;if(!db||!bucket)fail('云端存储尚未配置',503);
 const stmt=(sql:string,...args:any[])=>db.prepare(sql).bind(...args);
 const all=async()=>{const r=await stmt('SELECT id,kind,body FROM items WHERE user_id=? AND space=?',userId,space).all<any>();return r.results.map(r=>({id:r.id,kind:r.kind,...JSON.parse(r.body)}))};
 const row=async(id:string,kind?:string)=>await stmt('SELECT id,kind,body FROM items WHERE user_id=? AND space=? AND id=?'+(kind?' AND kind=?':''),userId,space,id,...(kind?[kind]:[])).first<any>();
 const recordStatement=(kind:string,body:any,id:string)=>stmt('INSERT INTO items(user_id,space,id,kind,body) VALUES(?,?,?,?,?) ON CONFLICT(user_id,space,id) DO UPDATE SET body=excluded.body',userId,space,id,kind,JSON.stringify(body));
 const prepare=async(kind:string,body:any,id=crypto.randomUUID())=>{
  const clean:any=validate(kind,body);const old=await row(id);const original=old?JSON.parse(old.body):{};if(old&&old.kind!==kind)fail('记录类型不可更改');
  if(clean.visitId&&!await row(clean.visitId,'visit')&&original.visitId!==clean.visitId)fail('关联就诊不存在或不在当前空间');
  const records=await all();
  if(kind==='file'&&clean.visitId&&records.some(x=>x.kind==='report'&&x.fileId===id&&x.visitId!==clean.visitId))fail('原件已被其他就诊的报告关联，请先调整报告关联');
  if(kind==='report'&&clean.fileId){const f=await row(clean.fileId,'file');if(!f){if(original.fileId!==clean.fileId)fail('关联原件不存在或不在当前空间')}else if(JSON.parse(f.body).visitId&&JSON.parse(f.body).visitId!==clean.visitId)fail('原件属于另一次就诊，请选择同次就诊的资料')}
  if(kind==='meal')for(const fileId of clean.attachmentIds)if(!await row(fileId,'file')&&!(original.attachmentIds||[]).includes(fileId))fail('餐食附件不存在或不在当前空间');
  if(kind==='dose'){const m=await row(clean.medicationId,'medication');if(!m)fail('用药方案不存在或不在当前空间');const med=JSON.parse(m.body);if(clean.date<med.date||(med.endDate&&clean.date>med.endDate))fail('服用记录日期需在方案起止范围内');if(clean.scheduledTime&&med.scheduleMode==='asNeeded')fail('按需用药不设置计划服用时段');if(clean.scheduledTime&&!med.times.includes(clean.scheduledTime)&&!(original.scheduledTime===clean.scheduledTime&&original.medicationId===clean.medicationId))fail('计划时段不属于该用药方案');if(clean.scheduledTime&&records.some(x=>x.kind==='dose'&&x.id!==id&&x.medicationId===clean.medicationId&&x.date===clean.date&&x.scheduledTime===clean.scheduledTime))fail('该时段已有记录，请编辑原记录')}
  return {item:{id,kind,...clean},statement:recordStatement(kind,clean,id)};
 };
 const put=async(kind:string,body:any,id?:string)=>{const p=await prepare(kind,body,id);await p.statement.run();return p.item};
 // One atomic, idempotent batch per visitor. Demo deletion never re-seeds it.
 if(space==='demo'&&!await stmt('SELECT value FROM app_meta WHERE user_id=? AND key=?',userId,'demo-v1').first()){
  const seeds=demoRecords();const insert=seeds.map((r:any)=>{const {id,kind,...body}=r;return stmt("INSERT INTO items(user_id,space,id,kind,body) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM app_meta WHERE user_id=? AND key='demo-v1')",userId,space,id,kind,JSON.stringify(body),userId)});
  await db.batch([...insert,stmt("INSERT OR IGNORE INTO app_meta(user_id,key,value) VALUES(?,'demo-v1','seeded')",userId)]);
 }
 const getSettings=async()=>JSON.parse((await stmt('SELECT body FROM settings WHERE user_id=? AND space=?',userId,space).first<any>())?.body||'{"name":"Captain","focus":"建立可持续的健康习惯"}');
 if(route==='/api/state'&&method==='GET')return json({items:await all(),settings:await getSettings(),today:today()});
 if(route==='/api/settings'&&method==='PUT'){const b=await readBody(req);const clean={name:String(b.name||'Captain').slice(0,40),focus:String(b.focus||'').slice(0,180)};await stmt('INSERT INTO settings(user_id,space,body) VALUES(?,?,?) ON CONFLICT(user_id,space) DO UPDATE SET body=excluded.body',userId,space,JSON.stringify(clean)).run();return json(clean)}
 if(route==='/api/items'&&method==='POST'){const {kind,...body}=await readBody(req);if(kind==='file')fail('请通过上传入口添加资料');return json(await put(kind,body),201)}
 if(route.startsWith('/api/items/')){const id=decodeURIComponent(route.split('/').pop()!);const old=await row(id);if(!old)return json({error:'记录不存在'},404);if(method==='PUT'){const body=await readBody(req);const existing=JSON.parse(old.body);if(old.kind==='file'){for(const key of ['title','date','note','visitId'])if(body[key]!==undefined)existing[key]=body[key];return json(await put(old.kind,existing,id))}return json(await put(old.kind,{...existing,...body},id))}if(method==='DELETE'){if(old.kind==='medication'&&(await all()).some(x=>x.kind==='dose'&&x.medicationId===id))fail('该方案已有服用记录，请停用以保留历史，或先移除服用记录');await db.batch([stmt('INSERT OR REPLACE INTO deleted_items(user_id,space,id,kind,body,expires_at) VALUES(?,?,?,?,?,?)',userId,space,id,old.kind,old.body,Date.now()+12000),stmt('DELETE FROM items WHERE user_id=? AND space=? AND id=?',userId,space,id)]);return json({deleted:{id,kind:old.kind,...JSON.parse(old.body)}})}}
 if(route==='/api/restore'&&method==='POST'){const b=await readBody(req);const id=String(b.id||'');const old=await stmt('SELECT * FROM deleted_items WHERE user_id=? AND space=? AND id=? AND expires_at>?',userId,space,id,Date.now()).first<any>();if(!old)return json({error:'没有可撤销的删除，或已超过12秒'},404);if(await row(id))fail('该记录已存在');const clean:any=validate(old.kind,JSON.parse(old.body));if(old.kind==='dose'&&clean.scheduledTime&&(await all()).some(x=>x.kind==='dose'&&x.medicationId===clean.medicationId&&x.date===clean.date&&x.scheduledTime===clean.scheduledTime))fail('该时段已有服用结果，不能撤销为重复记录');await db.batch([recordStatement(old.kind,clean,id),stmt('DELETE FROM deleted_items WHERE user_id=? AND space=? AND id=?',userId,space,id)]);return json({id,kind:old.kind,...clean})}
 const keyFor=(storageName:string)=>`users/${encodeURIComponent(userId)}/${space}/${storageName}`;
 if(route==='/api/upload'&&method==='POST'){const b=await readBody(req);const f=attachment(b);const storageName=crypto.randomUUID()+f.ext;const p=await prepare('file',{...b,title:b.title||f.name,date:b.date||today(),name:f.name,mime:f.mime,size:f.bytes.length,storageName});await bucket.put(keyFor(storageName),f.bytes,{httpMetadata:{contentType:f.mime}});try{await p.statement.run()}catch(error){await bucket.delete(keyFor(storageName));throw error}return json(p.item,201)}
 if(route==='/api/capture-meal'&&method==='POST'){
  const b=await readBody(req);const attachments=b.attachments||[];const existingRow=b.mealId?await row(String(b.mealId),'meal'):null;
  if(b.mealId&&!existingRow)return json({error:'餐食记录不存在'},404);
  const existing=existingRow?{id:existingRow.id,...JSON.parse(existingRow.body)}:null;
  const keep=b.keepAttachmentIds===undefined?(existing?.attachmentIds||[]):b.keepAttachmentIds;
  if(!Array.isArray(keep)||keep.some((id:any)=>!existing?.attachmentIds?.includes(id)))fail('保留附件无效');
  if(!Array.isArray(attachments)||attachments.length+keep.length>4)fail('最多保存4个附件');
  const rawText=String(b.text??existing?.rawText??'');const text=rawText.trim();if(!text&&!attachments.length&&!keep.length)fail('写一句话、添加照片或录一段语音即可保存');if(rawText.length>5000)fail('文字最多5000个字符');
  const records=await all();const staged=attachments.map(attachment);if(staged.some(f=>!f.mime.startsWith('image/')&&!f.mime.startsWith('audio/')))fail('餐食附件仅支持照片与音频');
  const total=keep.reduce((sum:number,id:string)=>sum+(records.find(f=>f.id===id&&f.kind==='file')?.size||0),0)+staged.reduce((n,f)=>n+f.bytes.length,0);if(total>10*1024*1024)fail('附件合计不超过10MB');
  const date=b.date||existing?.date||today();const mealType=String(b.mealType||existing?.mealType||'餐食');
  const files=staged.map(f=>{const storageName=crypto.randomUUID()+f.ext;const body=validate('file',{title:f.name,date,time:b.time??existing?.time??'',name:f.name,mime:f.mime,size:f.bytes.length,storageName,fileCategory:'餐食附件',intakeStatus:'待整理',note:f.mime.startsWith('audio/')?'原始录音，尚未自动转写':'原始照片，尚未自动识别'});return {id:crypto.randomUUID(),storageName,body,bytes:f.bytes,mime:f.mime}});
  const meal=validate('meal',{...existing,title:(text||existing?.title||`${mealType} · ${staged.some(f=>f.mime.startsWith('image/'))?'照片':'语音'}待整理`).slice(0,120),date,time:b.time??existing?.time??'',mealType,note:String(b.note??existing?.note??''),rawText,portion:String(b.portion??existing?.portion??''),attachmentIds:[...keep,...files.map(f=>f.id)]});
  const id=existing?.id||crypto.randomUUID();const written:string[]=[];try{for(const f of files){await bucket.put(keyFor(f.storageName),f.bytes,{httpMetadata:{contentType:f.mime}});written.push(keyFor(f.storageName))}await db.batch([...files.map(f=>recordStatement('file',f.body,f.id)),recordStatement('meal',meal,id)]);return json({id,kind:'meal',...meal},existing?200:201)}catch(error){await bucket.delete(written);throw error}
 }
 if(route.startsWith('/api/files/')&&method==='GET'){const f=await row(decodeURIComponent(route.split('/').pop()!),'file');if(!f)return json({error:'文件不存在'},404);const file=JSON.parse(f.body);const storageName=String(file.storageName);if(!/^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(storageName))return json({error:'文件内容缺失'},404);const object=await bucket.get(keyFor(storageName));if(!object)return json({error:'文件内容缺失'},404);const ext=storageName.slice(storageName.lastIndexOf('.')).toLowerCase();return new Response(object.body,{headers:{'Content-Type':allowed[ext]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox; frame-ancestors 'self'",'Content-Disposition':`${url.searchParams.get('inline')==='1'?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`}})}
 if(route==='/api/export'&&method==='GET')return json({exportedAt:new Date().toISOString(),space,items:await all(),settings:await getSettings()});
 return json({error:'接口不存在或方法不支持'},404);
 }catch(e:any){return json({error:e.message||'请求失败'},e.status||400)}}
export const GET=handle;export const POST=handle;export const PUT=handle;export const DELETE=handle;
