// Generated from ../health-workbench/server.mjs. Run node scripts/sync-domain.mjs after domain changes.
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const day=(offset=0)=>{const d=new Date(today()+'T12:00:00+08:00');d.setDate(d.getDate()+offset);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(d)};
const kinds=['visit','exercise','meal','metric','task','file','report','medication','dose','favorite','water','note'];
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(new Date(v+'T12:00:00Z').getTime())&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const validTime=v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const units={weight:'kg',pressure:'mmHg',glucose:'mmol/L',sleep:'小时',heart:'次/分'};
function validate(kind,b){
 if(!kinds.includes(kind))throw new Error('记录类型无效');
 if(typeof b.title!=='string'||!b.title.trim()||b.title.length>120)throw new Error('名称需为 1–120 个字符');
 if(typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||new Date(b.date+'T12:00:00Z').toISOString().slice(0,10)!==b.date)throw new Error('请选择有效日期');
 const clean={title:b.title.trim(),date:b.date,note:String(b.note||'').slice(0,5000)};
 for(const key of ['hospital','department','status','type','mealType','category','time','visitId','unit','name','mime','storageName'])if(b[key]!==undefined)clean[key]=String(b[key]).slice(0,250);
 if(clean.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(clean.time))throw new Error('时间格式需为 HH:MM');
 if(kind==='visit'&&!['待就诊','已完成','待复查'].includes(clean.status))throw new Error('就医状态无效');
 if(kind==='exercise'){if(!Number.isFinite(Number(b.duration))||Number(b.duration)<=0||Number(b.duration)>1440)throw new Error('运动时长需大于0且不超过1440分钟');clean.duration=Number(b.duration);
  if(b.distance!==undefined&&b.distance!==''){if(!Number.isFinite(Number(b.distance))||Number(b.distance)<=0||Number(b.distance)>1000)throw new Error('距离需大于0且不超过1000公里');clean.distance=Number(b.distance);}
  clean.feeling=String(b.feeling||'');if(!['','轻松','适中','吃力','不适'].includes(clean.feeling))throw new Error('身体感受选项无效');
  if(b.exercises!==undefined&&(!Array.isArray(b.exercises)||b.exercises.length>30))throw new Error('最多记录30个训练动作');
  clean.exercises=(b.exercises||[]).map(m=>{const name=String(m.name||'').trim();const sets=Number(m.sets),reps=Number(m.reps),weight=Number(m.weight||0);if(!name||name.length>100||!Number.isInteger(sets)||sets<1||sets>100||!Number.isInteger(reps)||reps<1||reps>500||!Number.isFinite(weight)||weight<0||weight>1000)throw new Error('请完整填写动作、组数、次数和有效重量（可为0）');return {name,sets,reps,weight}});
 }
 if(kind==='water'){if(!Number.isFinite(Number(b.volume))||Number(b.volume)<=0||Number(b.volume)>5000)throw new Error('饮水量需大于0且不超过5000毫升');clean.volume=Number(b.volume);}
 if(kind==='favorite'){
  if(!['meal','exercise'].includes(b.targetKind))throw new Error('收藏类型无效');clean.targetKind=b.targetKind;clean.sourceId=String(b.sourceId||'').slice(0,100);
  const t=validate(b.targetKind,{...b.template,title:b.template?.title||clean.title,date:clean.date});delete t.date;delete t.time;delete t.attachmentIds;delete t.rawText;delete t.visitId;clean.template=t;
 }

 if(kind==='metric'){
  if(!units[clean.type])throw new Error('请选择监测项目');
  if(!Number.isFinite(Number(b.value))||Number(b.value)<=0||Number(b.value)>10000)throw new Error('请输入有效监测数值');
  clean.value=Number(b.value);clean.unit=units[clean.type];
  if(clean.type==='pressure'){if(!Number.isFinite(Number(b.secondary))||Number(b.secondary)<=0||Number(b.secondary)>=clean.value)throw new Error('舒张压需大于0且低于收缩压');clean.secondary=Number(b.secondary);}
 }
 if(kind==='visit')for(const key of ['doctor','reason','assessment','instructions'])clean[key]=String(b[key]||'').slice(0,8000);
 if(kind==='report'){
  clean.type=String(b.type||'就诊记录');if(!['就诊记录','检验报告','影像报告','处方','出院记录','其他'].includes(clean.type))throw new Error('报告分类无效');
  clean.status=String(b.status||'待补充');if(!['待出报告','待补充','待核对','已归档'].includes(clean.status))throw new Error('报告状态无效');
  clean.source=String(b.source||'').slice(0,250);clean.content=String(b.content||'').slice(0,20000);clean.fileId=String(b.fileId||'').slice(0,100);
  if(!clean.visitId)throw new Error('请选择关联就诊');
  if(clean.status==='已归档'&&!clean.content.trim()&&!clean.fileId)throw new Error('归档报告需要原文或附件');
 }
 if(kind==='medication'){
  if(!clean.visitId)throw new Error('请选择关联就诊');
  for(const key of ['dosage','route','frequency','prescriber'])clean[key]=String(b[key]||'').trim().slice(0,250);
  if(!clean.dosage||!clean.route||!clean.frequency)throw new Error('请按处方填写单次用量、用药途径和频次');
  clean.status=String(b.status||'进行中');if(!['进行中','已停用','已完成'].includes(clean.status))throw new Error('用药状态无效');
  clean.endDate=String(b.endDate||'');if(clean.endDate&&(!validDate(clean.endDate)||clean.endDate<clean.date))throw new Error('结束日期不能早于开始日期');
  clean.scheduleMode=b.scheduleMode==='asNeeded'?'asNeeded':'scheduled';
  if(clean.scheduleMode==='scheduled'){
   if(!Array.isArray(b.times)||b.times.length<1||b.times.length>12||b.times.some(t=>!validTime(t))||new Set(b.times).size!==b.times.length)throw new Error('请填写1–12个不重复的有效服用时间');
   clean.times=[...b.times].sort();
  }else clean.times=[];
 }
 if(kind==='dose'){
  clean.medicationId=String(b.medicationId||'').slice(0,100);if(!clean.medicationId)throw new Error('请选择用药方案');
  clean.outcome=String(b.outcome||'');if(!['已服用','跳过'].includes(clean.outcome))throw new Error('服用结果无效');
  clean.scheduledTime=String(b.scheduledTime||'');if(clean.scheduledTime&&!validTime(clean.scheduledTime))throw new Error('计划时间格式无效');
  if(clean.outcome==='已服用'&&!clean.time)throw new Error('请记录实际服用时间');
  if(clean.outcome==='跳过')clean.time='';
  if(clean.outcome==='跳过'&&!clean.note.trim())throw new Error('请填写跳过原因');
  if(clean.date>today())throw new Error('不能记录未来日期的服用结果');
 }
 if(kind==='meal'){
  clean.rawText=String(b.rawText||'').slice(0,5000);clean.portion=String(b.portion||'').slice(0,120);
  if(b.attachmentIds!==undefined&&(!Array.isArray(b.attachmentIds)||b.attachmentIds.length>4||b.attachmentIds.some(id=>typeof id!=='string')))throw new Error('餐食附件最多4个');
  clean.attachmentIds=[...new Set(b.attachmentIds||[])];
 }
 if(kind==='task')clean.done=Boolean(b.done);
 if(kind==='file'){clean.size=Number(b.size)||0;clean.intakeStatus=clean.visitId?'已关联':String(b.intakeStatus||'待整理');clean.fileCategory=String(b.fileCategory||'一般资料').slice(0,80);}
 return clean;
}

export {today,day,kinds,validate};
export function demoRecords(){const records=[];const getAll=()=>records;const put=(_space,kind,body,id=crypto.randomUUID())=>{const item={id,kind,...validate(kind,body)};records.push(item);return item};
for(let i=0;i<14;i++){const date=day(i-13);put('demo','metric',{title:'晨起体重',type:'weight',value:Math.round((68.7-i*.045+Math.sin(i)*.15)*10)/10,date,time:'07:30',note:'示例记录'});put('demo','metric',{title:'睡眠记录',type:'sleep',value:Math.round((7.1+Math.sin(i)*.6)*10)/10,date,note:'示例记录'});}
 put('demo','metric',{title:'晨间血压',type:'pressure',value:118,secondary:76,date:today(),time:'07:40',note:'示例记录'});
 put('demo','visit',{title:'年度健康体检',date:day(-8),hospital:'示例健康中心',department:'体检科',status:'已完成',note:'这是一条虚构示例。检查原件可在资料档案中关联。'});
 put('demo','visit',{title:'复诊咨询',date:day(5),hospital:'示例门诊',department:'全科',status:'待就诊',note:'整理近期记录，准备就诊问题清单。'});
 for(const [i,title,duration,type] of [[0,'傍晚轻松走',35,'步行'],[-1,'全身力量练习',40,'力量训练'],[-3,'公园慢跑',30,'跑步']])put('demo','exercise',{title,date:day(i),duration,type,note:'主观感受：轻松 · 示例记录'});
 for(const [mealType,title,time] of [['早餐','燕麦、鸡蛋与牛奶','08:00'],['午餐','杂粮饭、时蔬与鸡肉','12:20']])put('demo','meal',{title,date:today(),mealType,time,note:'餐食组成示例，不代表个性化膳食建议'});
 for(const [title,category,time,done] of [['晨间监测','监测','07:30',true],['记录今天的午餐','饮食','12:30',true],['户外步行 30 分钟','锻炼','18:00',false],['整理复诊问题清单','就医','20:00',false]])put('demo','task',{title,date:today(),category,time,done,note:'示例计划，自行设置'});

 const visit=getAll('demo').find(x=>x.kind==='visit');
 if(visit){
  put('demo','report',{title:'示例门诊记录',date:visit.date,visitId:visit.id,type:'就诊记录',status:'已归档',source:'示例健康中心 · 纸质记录手录',content:'这是一份虚构的界面演示记录。\n主诉、检查所见和医生结论应按原文录入。\n这里没有真实诊断或个性化医疗建议。',note:'仅演示如何将报告与同次就诊关联。'});
  put('demo','medication',{title:'示例药物 A（非真实处方）',date:today(),endDate:day(7),visitId:visit.id,dosage:'示例用量，请勿参考用药',route:'按处方指定途径',frequency:'按处方录入',scheduleMode:'scheduled',times:['08:00','20:00'],status:'进行中',prescriber:'示例医生',note:'虚构方案，仅供体验已服用、跳过及历史记录交互。'});
  put('demo','task',{title:'复查前整理报告和服用记录',date:day(5),visitId:visit.id,category:'就医',time:'09:00',done:false,note:'示例复查安排，由用户自行确认。'});
 }

return records;}
