// Independent, minimal personal travel records. Coordinates are WGS84, never device location.
export const TRAVEL_KINDS=['travel_trip','travel_stop','travel_booking','travel_check'];
const common=['title','date','time','note','externalId','source','sourceDate','referenceUrl'];
export const TRAVEL_FIELDS={
 travel_trip:[...common,'destination','startDate','endDate','status'],
 travel_stop:[...common,'tripId','category','address','lat','lng','position','done'],
 travel_booking:[...common,'tripId','bookingType','status','confirmationCode','location','endDate','price','currency'],
 travel_check:[...common,'tripId','category','done'],
};
export const TRAVEL_SCHEMA={
 tripId:{type:'string',minLength:1,maxLength:100},destination:{type:'string',maxLength:250},
 startDate:{type:'string',maxLength:10,description:'旅行出发日期，目的地当地YYYY-MM-DD，不自动换算时区'},endDate:{type:'string',maxLength:10,description:'结束或退房日期，目的地当地YYYY-MM-DD，不自动换算时区'},
 address:{type:'string',maxLength:500},lat:{type:'number',minimum:-90,maximum:90},lng:{type:'number',minimum:-180,maximum:180},
 position:{type:'integer',minimum:0,maximum:10000},done:{type:'boolean'},
 bookingType:{type:'string',enum:['flight','train','hotel','ticket','car','other']},confirmationCode:{type:'string',maxLength:120},location:{type:'string',maxLength:250},
 price:{type:'number',minimum:0,maximum:1e12},currency:{type:'string',pattern:'^[A-Z]{3}$'},
};
export const nextTravelDay=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
export function validateTravel(kind,body,{validDate,bad}){
 const out={};
 for(const key of TRAVEL_FIELDS[kind]){
  const value=body[key];if(value===undefined||value===null||value==='')continue;
  if(['lat','lng','position','price'].includes(key)){
   if(!['string','number'].includes(typeof value)||typeof value==='string'&&!value.trim()||!Number.isFinite(Number(value)))throw bad('请输入有效数值',key);
   const n=Number(value),schema=TRAVEL_SCHEMA[key];
   if(n<schema.minimum||n>schema.maximum||(key==='position'&&!Number.isInteger(n)))throw bad('数值超出允许范围',key);
   out[key]=n;
  }else if(key==='done'){
   if(typeof value!=='boolean')throw bad('完成状态无效',key);out[key]=value;
  }else{
   const max=key==='note'?5000:key==='title'?120:key==='externalId'?250:key==='source'?1000:key==='referenceUrl'?2000:TRAVEL_SCHEMA[key]?.maxLength||250;
   if(typeof value!=='string'||value.length>max)throw bad('旅行字段格式或长度无效',key);out[key]=value.trim();
  }
 }
 if(!out.title)throw bad('请填写名称','title');out.note??='';
 if(kind==='travel_trip'){
  out.startDate??=out.date;
  if(!out.startDate||!validDate(out.startDate))throw bad('请选择有效出发日期','startDate');
  out.date=out.startDate;
  if(!out.endDate||!validDate(out.endDate)||out.endDate<out.startDate)throw bad('结束日期不能早于出发日期','endDate');
  if((Date.parse(out.endDate)-Date.parse(out.startDate))/86400000>=366)throw bad('一趟旅行最长366天','endDate');
  out.destination??='';out.status??='planned';if(!['planned','active','completed','cancelled'].includes(out.status))throw bad('旅行状态无效','status');
 }else{
  if(!out.date||!validDate(out.date))throw bad('请选择有效日期','date');
  if(!out.tripId)throw bad('请先选择所属旅行','tripId');
 }
 if(out.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(out.time))throw bad('时间格式不对，例如08:30','time');
 if(out.sourceDate&&!validDate(out.sourceDate))throw bad('请选择有效来源日期','sourceDate');
 if(out.referenceUrl){let url;try{url=new URL(out.referenceUrl);}catch{throw bad('链接格式无效','referenceUrl');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw bad('链接只支持HTTP或HTTPS','referenceUrl');}
 if(kind==='travel_stop'){
  out.category??='other';if(!['attraction','food','stay','transport','other'].includes(out.category))throw bad('地点分类无效','category');
  if((out.lat===undefined)!==(out.lng===undefined))throw bad('纬度和经度需一起填写','lat');out.position??=0;out.done??=false;out.address??='';
 }
 if(kind==='travel_booking'){
  out.bookingType??='other';if(!['flight','train','hotel','ticket','car','other'].includes(out.bookingType))throw bad('预订类型无效','bookingType');
  out.status??='planned';if(!['planned','confirmed','cancelled'].includes(out.status))throw bad('预订状态无效','status');
  if(out.endDate&&(!validDate(out.endDate)||out.endDate<out.date))throw bad('结束日期不能早于开始日期','endDate');
  out.currency??='CNY';if(!/^[A-Z]{3}$/.test(out.currency))throw bad('币种需为三位大写字母，例如CNY','currency');
 }
 if(kind==='travel_check'){out.category??='todo';if(!['packing','todo'].includes(out.category))throw bad('清单分类无效','category');out.done??=false;}
 return out;
}
export function assertTravelChildDates(kind,body,trip,bad){
 if(kind==='file'||kind==='travel_check')return;
 if(body.date<trip.startDate||body.date>trip.endDate)throw bad('安排日期需在所属旅行的起止日期内，请先调整旅行日期','date');
 if(kind==='travel_booking'&&body.endDate&&body.endDate>nextTravelDay(trip.endDate))throw bad('预订结束日期不能晚于旅行结束后的次日','endDate');
}
