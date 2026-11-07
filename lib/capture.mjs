import {randomUUID} from 'node:crypto';

// Keep this deliberately small and in sync with the native opt-in application list.
export const CAPTURE_APPS=Object.freeze([
 {packageName:'com.eg.android.AlipayGphone',name:'支付宝'},
 {packageName:'com.tencent.mm',name:'微信支付'},
 {packageName:'com.unionpay',name:'云闪付'},
 {packageName:'cmb.pb',name:'招商银行'},
 {packageName:'com.icbc',name:'中国工商银行'},
 {packageName:'com.chinamworld.bocmbci',name:'中国银行'},
 {packageName:'com.chinamworld.main',name:'中国建设银行'},
 {packageName:'com.android.bankabc',name:'中国农业银行'},
]);
const transactionTypes=['income','expense','transfer','buy','sell','dividend','fee','repayment','other'];
const wechatTitles=['微信支付','微信收款','收款到账通知','微信支付凭证','支付凭证','收款助手','微信收款助手'];
const alipayTitles=['支付宝','支付宝支付','支付宝通知','支付助手','支付成功','付款成功','收款到账','收钱到账','到账提醒','交易提醒','转账到账','退款到账','花呗','借呗','生活缴费','信用卡还款'];
// Keep code prompts aligned with the Android filter. “扫码支付成功” is a transaction.
const codePrompt=/(?:登[录錄陆陸入]|[认認验驗][证證]|校[验驗]|[动動][态態]|短[信訊]|安全|收[款钱錢]|付款|支付|二[维維])[码碼]|(?<![a-z0-9_])(?:pass[ -]?code|(?:login|sign[ -]?in|verification|security|confirmation|qr)[\s-]*code)(?![a-z0-9_])/i;
const sensitive=/动态密码|口令|一次性密码|短信密码|\botp\b|one[ -]?time\s*(?:password|code)|聊天|私信|发来.{0,8}消息|条新消息|\[\s*(?:微信|图片|语音|视频|红包)\s*\]|红包|优惠|领取|抽奖|营销|广告|活动|贷款额度|理财推荐/i;
const trading=/支付|付款|收款|到账|支出|消费|扣款|还款|转账|退款|收入|交易|入账|credited|debited|payment|purchase|refund|received|spent/i;
const amountNumber='(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?';
const prefixed=currency=>`${currency}\\s*(${amountNumber})(?![\\d.,eE])`;
const suffixed=currency=>`(?<![\\d.,eE])(${amountNumber})\\s*${currency}`;
const amountPattern=new RegExp([prefixed('(?:人民币|CNY|RMB|[¥￥])'),suffixed('(?:元|人民币|CNY|RMB)'),prefixed('(?:USD|US\\$|\\$)'),suffixed('USD'),prefixed('(?:HKD|HK\\$)'),suffixed('HKD')].join('|'),'gi');
const chinaDate=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
const fail=(bad,message,field,code,status)=>Object.assign(bad(message,field,code),status?{status}:{});
function identifier(value,field,bad,max=100){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw bad('采集标识格式无效',field);return value.trim();}
export function captureInstant(value,{validDate,bad,field='observedAt'}){
 if(typeof value!=='string'||value.length>64)throw bad('时间需为带时区的 ISO 时间',field);
 const m=/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
 if(!m||!validDate(m[1])||m[6]!==undefined&&(Number(m[6])>14||Number(m[7])>59||Number(m[6])===14&&Number(m[7])!==0)||!Number.isFinite(Date.parse(value)))throw bad('时间需为有效的带时区 ISO 时间',field);
 return new Date(value).toISOString();
}
export function validateStepMetric(body,{validDate,bad,now,today}){
 if(typeof body.value!=='number'||!Number.isInteger(body.value)||body.value<0||body.value>200000)throw bad('步数需为 0–200000 的整数','value');
 if(!validDate(body.date)||body.date>today())throw bad('步数日期必须是今天或过去的有效日期','date','future_date');
 const clean={value:body.value,unit:'步'};
 if(body.source!==undefined&&body.source!==''){
  if(body.source!=='health-connect')throw bad('步数来源无效','source');
  clean.source='health-connect';clean.deviceId=identifier(body.deviceId,'deviceId',bad);
  clean.observedAt=captureInstant(body.observedAt,{validDate,bad});
  if(Date.parse(clean.observedAt)>now().getTime())throw bad('同步观测时间不能晚于现在','observedAt','future_date');
  if(Date.parse(clean.observedAt)<Date.parse(body.date+'T00:00:00+08:00'))throw bad('同步观测时间不能早于记录日期','observedAt');
 }else if(body.deviceId!==undefined||body.observedAt!==undefined)throw bad('同步信息需包含 Health Connect 来源','source');
 return clean;
}
export function validateHealthMetadata(body,{validDate,bad,now}){
 if(body.source===undefined&&body.sourceId===undefined&&body.deviceId===undefined&&body.observedAt===undefined&&body.startAt===undefined&&body.endAt===undefined)return {};
 if(body.source!=='health-connect')throw bad('健康采集来源无效','source');
 const clean={source:'health-connect',sourceId:identifier(body.sourceId,'sourceId',bad,250),deviceId:identifier(body.deviceId,'deviceId',bad),observedAt:captureInstant(body.observedAt,{validDate,bad})};
 if(body.sourcePackage!==undefined){if(typeof body.sourcePackage!=='string'||body.sourcePackage.length>250||!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(body.sourcePackage))throw bad('健康数据来源应用无效','sourcePackage');clean.sourcePackage=body.sourcePackage;}
 if(Date.parse(clean.observedAt)>now().getTime())throw bad('同步观测时间不能晚于现在','observedAt','future_date');
 if(!validDate(body.date)||Date.parse(clean.observedAt)<Date.parse(body.date+'T00:00:00+08:00'))throw bad('同步观测时间不能早于记录日期','observedAt');
 if(body.startAt!==undefined||body.endAt!==undefined){
  clean.startAt=captureInstant(body.startAt,{validDate,bad,field:'startAt'});clean.endAt=captureInstant(body.endAt,{validDate,bad,field:'endAt'});
  if(clean.startAt>=clean.endAt||clean.endAt>clean.observedAt||chinaDate(clean.startAt)!==body.date)throw bad('运动起止时间、日期或观测时间不一致','startAt');
 }
 return clean;
}
export function parseNotification(body,{bad,validDate}){
 const deviceId=identifier(body.deviceId,'deviceId',bad),eventId=identifier(body.eventId,'eventId',bad,250);
 if(!CAPTURE_APPS.some(a=>a.packageName===body.packageName))throw bad('该应用不在可采集列表中','packageName','notification_filtered');
 if(typeof body.title!=='string'||body.title.length>250||typeof body.text!=='string'||body.text.length>4000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.title+body.text))throw bad('通知内容格式或长度无效','text','notification_filtered');
 const title=body.title.trim(),text=body.text.trim(),combined=title+' '+text;
 if(!title||!text||codePrompt.test(combined)||sensitive.test(combined)||!trading.test(combined)||body.packageName==='com.tencent.mm'&&!wechatTitles.includes(title)||body.packageName==='com.eg.android.AlipayGphone'&&!alipayTitles.includes(title))throw bad('已排除非交易或敏感通知','text','notification_filtered');
 const amounts=[...combined.matchAll(amountPattern)].map(m=>({amount:Number((m[1]||m[2]||m[3]||m[4]||m[5]||m[6]).replaceAll(',','')),currency:m[5]||m[6]?'HKD':m[3]||m[4]?'USD':'CNY'})).filter(x=>Number.isFinite(x.amount)&&x.amount>=0&&x.amount<=1e15);
 if(!amounts.length)throw bad('通知缺少明确交易金额','text','notification_filtered');
 const postedAt=captureInstant(body.postedAt,{validDate,bad,field:'postedAt'});
 const parsed={date:chinaDate(postedAt),title:title.slice(0,120)};
 // Multiple different amounts (for example transaction plus balance) stay unresolved.
 if(amounts.every(x=>x.amount===amounts[0].amount&&x.currency===amounts[0].currency))Object.assign(parsed,amounts[0]);
 if(/还款/i.test(combined))parsed.type='repayment';
 else if(/转账/i.test(combined))parsed.type='transfer';
 else{
  const income=/退款|收款|到账|入账|收入|credited|refund|received/i.test(text),expense=/支付|付款|支出|消费|扣款|debited|payment|purchase|spent/i.test(text);
  if(income&&!expense)parsed.type='income';else if(expense&&!income)parsed.type='expense';
 }
 if(parsed.amount!==undefined&&['expense','repayment','fee'].includes(parsed.type))parsed.amount=-parsed.amount;
 return {deviceId,eventId,packageName:body.packageName,title,text,postedAt,parsed};
}

export function createCapture({db,put,validDate,validTime,bad,today,now}){
 db.exec(`CREATE TABLE IF NOT EXISTS capture_notifications(
  id TEXT PRIMARY KEY,space TEXT NOT NULL,device_id TEXT NOT NULL,event_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','confirmed','ignored')),body TEXT NOT NULL,
  received_at TEXT NOT NULL,transaction_id TEXT,UNIQUE(space,device_id,event_id));
  CREATE INDEX IF NOT EXISTS capture_notifications_scope ON capture_notifications(space,received_at DESC,id);
  CREATE TABLE IF NOT EXISTS capture_step_sync(
  space TEXT NOT NULL,date TEXT NOT NULL,source TEXT NOT NULL,item_id TEXT NOT NULL,observed_at TEXT NOT NULL,
  PRIMARY KEY(space,date,source));
  CREATE TABLE IF NOT EXISTS capture_health_sync(
  space TEXT NOT NULL,sync_key TEXT NOT NULL,kind TEXT NOT NULL,item_id TEXT NOT NULL,observed_at TEXT NOT NULL,
  PRIMARY KEY(space,sync_key));`);
 const transact=fn=>{db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(error){db.exec('ROLLBACK');throw error;}};
 const item=(space,id)=>{const row=db.prepare('SELECT id,kind,body FROM items WHERE id=? AND space=?').get(id,space);return row?{id:row.id,kind:row.kind,...JSON.parse(row.body)}:null;};
 const candidates=(space,parsed,self)=>{
  if(parsed.amount===undefined||!parsed.currency)return [];
  const same=x=>x.date===parsed.date&&x.currency===parsed.currency&&Number.isFinite(x.amount)&&Math.abs(x.amount)===Math.abs(parsed.amount);
  const events=db.prepare('SELECT id,body,transaction_id FROM capture_notifications WHERE space=? AND id<>? AND status<>? ORDER BY received_at DESC LIMIT 500').all(space,self||'','ignored');
  const ids=events.filter(x=>same(JSON.parse(x.body).parsed)).map(x=>x.id);
  const rows=db.prepare("SELECT id,body FROM items WHERE space=? AND kind='asset_transaction' AND json_extract(body,'$.date')=? LIMIT 500").all(space,parsed.date);
  for(const row of rows)if(same(JSON.parse(row.body)))ids.push(row.id);
  return [...new Set(ids)].slice(0,50);
 };
 const event=(row)=>{const b=JSON.parse(row.body);return {id:row.id,status:row.status,...b,receivedAt:row.received_at,possibleDuplicateIds:candidates(row.space,b.parsed,row.id).filter(id=>id!==row.transaction_id),...(row.transaction_id?{transactionId:row.transaction_id,transactionDeleted:!item(row.space,row.transaction_id)}:{})};};
 const find=(space,id)=>{const row=db.prepare('SELECT * FROM capture_notifications WHERE id=? AND space=?').get(id,space);if(!row)throw fail(bad,'采集通知不存在','id','not_found',404);return row;};
 return {
  apps:()=>CAPTURE_APPS.map(x=>({...x})),
  notifications(space,{limit=100,offset=0,status}={}){
   if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(offset)||offset<0||offset>100000)throw bad('分页范围无效','limit');
   if(status!==undefined&&!['pending','confirmed','ignored'].includes(status))throw bad('通知筛选状态无效','status');
   const stats={pending:0,confirmed:0,ignored:0};for(const row of db.prepare('SELECT status,COUNT(*) n FROM capture_notifications WHERE space=? GROUP BY status').all(space))stats[row.status]=row.n;
   const rows=status?db.prepare('SELECT * FROM capture_notifications WHERE space=? AND status=? ORDER BY received_at DESC,id DESC LIMIT ? OFFSET ?').all(space,status,limit,offset):db.prepare('SELECT * FROM capture_notifications WHERE space=? ORDER BY received_at DESC,id DESC LIMIT ? OFFSET ?').all(space,limit,offset);
   return {events:rows.map(event),stats,limit,offset,...(status?{status}:{}),total:status?stats[status]:stats.pending+stats.confirmed+stats.ignored};
  },
  receive(space,body){
   const b=parseNotification(body,{bad,validDate});
   return transact(()=>{
    const old=db.prepare('SELECT * FROM capture_notifications WHERE space=? AND device_id=? AND event_id=?').get(space,b.deviceId,b.eventId);
    if(old){
     if(JSON.parse(old.body).packageName!==b.packageName)throw fail(bad,'通知标识与已有应用不一致','eventId','capture_event_conflict',409);
     if(old.status==='pending'&&b.postedAt>=JSON.parse(old.body).postedAt)db.prepare('UPDATE capture_notifications SET body=? WHERE id=?').run(JSON.stringify(b),old.id);
     return {event:event(find(space,old.id)),duplicate:true};
    }
    const id=randomUUID();db.prepare('INSERT INTO capture_notifications VALUES(?,?,?,?,?,?,?,NULL)').run(id,space,b.deviceId,b.eventId,'pending',JSON.stringify(b),now().toISOString());
    return {event:event(find(space,id)),duplicate:false};
   });
  },
  confirm(space,id,body){return transact(()=>{
   const row=find(space,id);
   if(row.status==='ignored')throw fail(bad,'已忽略的通知不能确认','id','capture_ignored',409);
   if(row.status==='confirmed')return {event:event(row),transaction:item(space,row.transaction_id),duplicate:true};
   for(const field of ['title','date','currency','transactionType'])if(typeof body[field]!=='string'||!body[field].trim())throw bad('请明确核对名称、日期、金额、币种与流水类型',field);
   if(typeof body.amount!=='number'||!Number.isFinite(body.amount)||Math.abs(body.amount)>1e15)throw bad('请填写核对后的流水金额','amount');
   if(!transactionTypes.includes(body.transactionType))throw bad('请选择有效流水类型','transactionType');
   if(body.status!==undefined&&body.status!=='confirmed')throw bad('核对通知后应确认为已发生流水','status');
   const transaction=put(space,'asset_transaction',{...body,status:'confirmed',externalId:'phone-notification:'+row.id,source:'手机交易通知'},randomUUID());
   db.prepare("UPDATE capture_notifications SET status='confirmed',transaction_id=? WHERE id=? AND space=?").run(transaction.id,id,space);
   return {event:event(find(space,id)),transaction,duplicate:false};
  });},
  ignore(space,id){return transact(()=>{const row=find(space,id);if(row.status==='confirmed')throw fail(bad,'已确认的通知不能忽略，请在流水中处理','id','capture_confirmed',409);db.prepare("UPDATE capture_notifications SET status='ignored' WHERE id=? AND space=?").run(id,space);return {event:event(find(space,id))};});},
  health(space){
   const steps=db.prepare("SELECT id,body FROM items WHERE space=? AND kind='metric' AND json_extract(body,'$.type')='steps' ORDER BY json_extract(body,'$.date') DESC,CASE WHEN json_extract(body,'$.source')='health-connect' THEN 1 ELSE 0 END DESC,json_extract(body,'$.observedAt') DESC,id DESC LIMIT 200").all(space).map(r=>{const b=JSON.parse(r.body);return {id:r.id,date:b.date,value:b.value,unit:'步',source:b.source||'manual',...(b.observedAt?{observedAt:b.observedAt}:{}),...(b.deviceId?{deviceId:b.deviceId}:{})};});
   const healthRecords=db.prepare("SELECT id,kind,body FROM items WHERE space=? AND kind IN ('metric','exercise') AND json_extract(body,'$.source')='health-connect' AND COALESCE(json_extract(body,'$.type'),'')<>'steps' ORDER BY json_extract(body,'$.date') DESC,json_extract(body,'$.observedAt') DESC,id DESC LIMIT 200").all(space).map(r=>({id:r.id,kind:r.kind,...JSON.parse(r.body)}));
   return {steps,latestStep:steps[0]||null,healthRecords};
  },
  syncHealth(space,body){
   const deviceId=identifier(body.deviceId,'deviceId',bad);
   if(body.source!=='health-connect')throw bad('仅支持 Health Connect 健康采集','source');
   if(!Array.isArray(body.records)||body.records.length<1||body.records.length>100)throw bad('每批需包含 1–100 条健康记录','records');
   const records=body.records.map(r=>{
    if(!r||typeof r!=='object'||Array.isArray(r)||!['weight','resting_heart_rate','sleep','exercise'].includes(r.kind))throw bad('健康采集类型无效','kind');
    if(!validDate(r.date)||r.date>today())throw bad('健康记录日期必须是今天或过去的有效日期','date','future_date');
    const metadata=validateHealthMetadata({...r,source:'health-connect',deviceId},{validDate,bad,now});
    const common={date:r.date,...metadata};
    if(r.kind==='exercise'){
     if(!metadata.startAt||!metadata.endAt)throw bad('运动记录需要起止时间','startAt');
     const elapsed=(Date.parse(metadata.endAt)-Date.parse(metadata.startAt))/60000;
     if(typeof r.durationMinutes!=='number'||!Number.isFinite(r.durationMinutes)||r.durationMinutes<=0||r.durationMinutes>1440||r.durationMinutes>elapsed+1)throw bad('运动有效时长需为正数且不能超过起止区间','durationMinutes');
     if(r.distanceKm!==undefined&&(typeof r.distanceKm!=='number'||!Number.isFinite(r.distanceKm)||r.distanceKm<=0||r.distanceKm>1000))throw bad('运动距离需为大于 0 且不超过 1000 的公里数','distanceKm');
     if(typeof r.exerciseType!=='string'||!r.exerciseType.trim()||r.exerciseType.length>80)throw bad('请填写运动类型名称','exerciseType');
     return {sourceKind:r.kind,syncKey:'exercise:'+metadata.sourceId,kind:'exercise',body:{...common,title:r.exerciseType.trim(),type:r.exerciseType.trim(),time:new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(metadata.startAt)),duration:r.durationMinutes,...(r.distanceKm===undefined?{}:{distance:r.distanceKm})}};
    }
    const type={weight:'weight',resting_heart_rate:'heart',sleep:'sleep'}[r.kind];
    if(r.unit!==undefined&&r.unit!=={weight:'kg',resting_heart_rate:'次/分',sleep:'小时'}[r.kind])throw bad('健康采集单位与指标不一致','unit');
    if(typeof r.value!=='number'||!Number.isFinite(r.value)||r.value<=0||r.value>({weight:1000,resting_heart_rate:300,sleep:24}[r.kind])||r.kind==='resting_heart_rate'&&(!Number.isInteger(r.value)||r.value<20))throw bad('健康指标数值超出有效范围','value');
    const time=r.kind==='sleep'?undefined:r.time;
    if(time!==undefined&&!validTime(time))throw bad('测量时间须为北京时间 HH:mm','time');
    return {sourceKind:r.kind,syncKey:'metric:'+r.kind+':'+r.date,kind:'metric',body:{...common,title:{weight:'体重',resting_heart_rate:'静息心率',sleep:'睡眠时长'}[r.kind],type,value:r.value,...(time===undefined?{}:{time})}};
   });
   return transact(()=>{
    const results=[];let updated=0;
    for(const record of records){
     const old=db.prepare('SELECT * FROM capture_health_sync WHERE space=? AND sync_key=?').get(space,record.syncKey);
     const result={sourceId:record.body.sourceId,kind:record.sourceKind,date:record.body.date};
     if(old&&record.body.observedAt<=old.observed_at){results.push({...result,id:old.item_id,status:'unchanged'});continue;}
     const previous=old?item(space,old.item_id):null;
     if(old&&!previous){db.prepare('UPDATE capture_health_sync SET observed_at=? WHERE space=? AND sync_key=?').run(record.body.observedAt,space,record.syncKey);results.push({...result,id:old.item_id,status:'deleted'});continue;}
     if(previous&&(previous.kind!==record.kind||previous.type!==record.body.type||previous.source!=='health-connect'||previous.date!==record.body.date)){results.push({...result,id:old.item_id,status:'modified'});continue;}
     // An omitted distance means it was not read; it is not a request to erase a known distance.
     if(record.kind==='exercise'&&record.body.distance===undefined&&previous?.distance!==undefined)record.body.distance=previous.distance;
     const saved=put(space,record.kind,record.body,old?.item_id||randomUUID());
     db.prepare('INSERT INTO capture_health_sync VALUES(?,?,?,?,?) ON CONFLICT(space,sync_key) DO UPDATE SET observed_at=excluded.observed_at').run(space,record.syncKey,record.sourceKind,saved.id,record.body.observedAt);
     results.push({...result,id:saved.id,status:old?'updated':'created'});updated++;
    }
    return {updated,results,...this.health(space)};
   });
  },
  syncSteps(space,body){
   const deviceId=identifier(body.deviceId,'deviceId',bad);
   if(body.source!=='health-connect')throw bad('仅支持 Health Connect 步数','source');
   if(!Array.isArray(body.records)||body.records.length<1||body.records.length>100)throw bad('每批需包含 1–100 条步数记录','records');
   const records=body.records.map(r=>{if(!r||typeof r!=='object'||Array.isArray(r))throw bad('步数记录格式无效','records');return {date:r.date,...validateStepMetric({date:r.date,value:r.steps,source:body.source,deviceId,observedAt:r.observedAt},{validDate,bad,today,now})};});
   return transact(()=>{
    const results=[];let updated=0;
    for(const record of records){
     const old=db.prepare('SELECT * FROM capture_step_sync WHERE space=? AND date=? AND source=?').get(space,record.date,'health-connect');
     if(old&&record.observedAt<=old.observed_at){results.push({date:record.date,id:old.item_id,status:'unchanged'});continue;}
     if(old&&!item(space,old.item_id)){
      // A durable receipt survives soft deletion and trash expiry: retries never resurrect it.
      db.prepare('UPDATE capture_step_sync SET observed_at=? WHERE space=? AND date=? AND source=?').run(record.observedAt,space,record.date,'health-connect');
      results.push({date:record.date,id:old.item_id,status:'deleted'});continue;
     }
     if(old){const previous=item(space,old.item_id);if(previous.kind!=='metric'||previous.type!=='steps'||previous.source!=='health-connect'||previous.date!==record.date){results.push({date:record.date,id:old.item_id,status:'modified'});continue;}}
     const saved=put(space,'metric',{title:'每日步数',type:'steps',...record},old?.item_id||randomUUID());
     db.prepare('INSERT INTO capture_step_sync VALUES(?,?,?,?,?) ON CONFLICT(space,date,source) DO UPDATE SET observed_at=excluded.observed_at').run(space,record.date,'health-connect',saved.id,record.observedAt);
     results.push({date:record.date,id:saved.id,status:old?'updated':'created'});updated++;
    }
    return {updated,results,...this.health(space)};
   });
  },
 };
}
