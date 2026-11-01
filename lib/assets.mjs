// Asset records are bookkeeping snapshots, never instructions to place trades.
export const ASSET_KINDS=['asset_account','asset_holding','asset_liability','asset_transaction','asset_snapshot'];
export const ASSET_FIELDS={
 asset_account:['currency','accountType','institution','balance','balanceAsOf','includeInTotal'],
 asset_holding:['category','accountId','currency','quantity','unitPrice','cost','value','valuationDate','status'],
 asset_liability:['currency','balance','asOfDate','dueDate','accountId','status'],
 asset_transaction:['currency','amount','transactionType','accountId','assetId','status'],
 asset_snapshot:['currency','totalValue','assetValue','liabilityValue'],
};
const common=['externalId','source','sourceDate','referenceUrl'];
for(const k of ASSET_KINDS)ASSET_FIELDS[k]=['title','date','note','time',...ASSET_FIELDS[k],...common];
export const ASSET_SCHEMA={
 currency:{type:'string',pattern:'^[A-Z]{3}$',description:'三位大写币种，原币种分开展示，不自动换汇'},
 accountType:{type:'string',maxLength:80},institution:{type:'string',maxLength:250},
 balance:{type:'number',minimum:0,maximum:1e15},balanceAsOf:{type:'string',maxLength:10},includeInTotal:{type:'boolean'},
 accountId:{type:'string',maxLength:100},assetId:{type:'string',maxLength:100},
 quantity:{type:'number',minimum:0,maximum:1e15},unitPrice:{type:'number',minimum:0,maximum:1e15},cost:{type:'number',minimum:0,maximum:1e15},value:{type:'number',minimum:0,maximum:1e15},
 valuationDate:{type:'string',maxLength:10},asOfDate:{type:'string',maxLength:10},dueDate:{type:'string',maxLength:10},
 amount:{type:'number',minimum:-1e15,maximum:1e15},transactionType:{type:'string',maxLength:80},
 totalValue:{type:'number',minimum:-1e15,maximum:1e15},assetValue:{type:'number',minimum:0,maximum:1e15},liabilityValue:{type:'number',minimum:0,maximum:1e15},
 externalId:{type:'string',maxLength:250},source:{type:'string',maxLength:1000},sourceDate:{type:'string',maxLength:10},referenceUrl:{type:'string',maxLength:2000},
};
const numeric=['balance','quantity','unitPrice','cost','value','amount','totalValue','assetValue','liabilityValue'];
const dates=['date','balanceAsOf','valuationDate','asOfDate','dueDate','sourceDate'];
export function validateAsset(kind,body,{validDate,bad,today}){
 const clean={};
 for(const k of ASSET_FIELDS[kind]){
  const v=body[k];if(v===undefined||v===null||v==='')continue;
  if(numeric.includes(k)){
   if(!['number','string'].includes(typeof v)||typeof v==='string'&&!v.trim()||!Number.isFinite(Number(v))||Math.abs(Number(v))>1e15||(!['amount','totalValue'].includes(k)&&Number(v)<0))throw bad('请输入有效金额或数量',k);
   clean[k]=Number(v);
  }else if(k==='includeInTotal'){
   if(typeof v!=='boolean')throw bad('账户计入汇总选项无效',k);clean[k]=v;
  }else{
   const limit=k==='note'?5000:k==='title'?120:ASSET_SCHEMA[k]?.maxLength||250;
   if(typeof v!=='string'||v.length>limit)throw bad('资产字段格式或长度无效',k);
   clean[k]=v.trim();
  }
 }
 clean.note??='';
 if(clean.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(clean.time))throw bad('时间格式不对，例如 08:30','time');
 if(!clean.title)throw bad('请填写名称','title');
 if(!clean.date||!validDate(clean.date))throw bad('请选择有效日期','date');
 if(!/^[A-Z]{3}$/.test(clean.currency||''))throw bad('币种需为三位大写字母，例如 CNY','currency');
 for(const k of dates)if(clean[k]&&!validDate(clean[k]))throw bad('请选择有效日期',k);
 if(clean.referenceUrl){let url;try{url=new URL(clean.referenceUrl);}catch{throw bad('来源链接格式无效','referenceUrl');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw bad('来源链接只支持 HTTP 或 HTTPS','referenceUrl');}
 if(kind==='asset_account')clean.includeInTotal??=false;
 if(kind==='asset_holding'){
  if(!['cash','fund','stock','property','vehicle','equipment','subscription','other'].includes(clean.category))throw bad('请选择资产类别','category');
  clean.status??='active';
 }
 if(kind==='asset_liability')clean.status??='active';
 if(['asset_holding','asset_liability'].includes(kind)&&!['active','closed','pending'].includes(clean.status))throw bad('资产状态无效','status');
 // Future plans cannot contribute to the currently confirmed asset position.
 if(today){
  const currentDate=today();
  const currentFields=clean.status==='active'&&kind==='asset_holding'?['date','valuationDate']:clean.status==='active'&&kind==='asset_liability'?['date','asOfDate']:kind==='asset_account'&&clean.includeInTotal&&clean.balance!==undefined?['date','balanceAsOf']:[];
  const futureField=currentFields.find(k=>clean[k]&&clean[k]>currentDate);
  if(futureField)throw bad(kind==='asset_account'?'未来账户余额不能计入当前汇总，请关闭计入汇总并待核对':'未来资产或负债请保存为待核对 pending，不能计入当前已确认金额',futureField,'future_date');
 }
 if(kind==='asset_transaction'){clean.status??='confirmed';if(!['confirmed','pending'].includes(clean.status))throw bad('流水状态无效','status');if(clean.amount===undefined)throw bad('请填写流水金额','amount');if(clean.status==='confirmed'&&today&&clean.date>today())throw bad('未来流水请保存为待确认，不能记为已发生','date','future_date');}
 return clean;
}
export const defaultTheme=type=>type==='finance'?'#A65343':'#2C6B51';
export function themeColor(value,type='other'){
 if(value===undefined||value===null||value==='')return defaultTheme(type);
 if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw Object.assign(new Error('主题色需为 #RRGGBB 格式'),{status:400,expose:true,code:'validation_failed',field:'themeColor'});
 return value.toUpperCase();
}
