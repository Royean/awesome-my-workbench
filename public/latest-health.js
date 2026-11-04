// A saved observation belongs to its recorded date, never the dashboard's current date.
export function latestHealthRecord(items,kinds,today,type){
 const wanted=Array.isArray(kinds)?kinds:[kinds];
 return items.filter(x=>wanted.includes(x.kind)&&typeof x.date==='string'&&x.date<=today&&(!type||x.type===type)&&!(x.kind==='file'&&['餐食附件','药品图片'].includes(x.fileCategory)))
  .sort((a,b)=>b.date.localeCompare(a.date)||(b.time||'').localeCompare(a.time||'')||(b.createdAt||'').localeCompare(a.createdAt||''))[0];
}
export function healthRecordDate(record,today){
 if(!record?.date)return '尚未记录';
 const previous=new Date(today+'T12:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);
 const day=record.date===today?'今天':record.date===previous.toISOString().slice(0,10)?'昨天':record.date;
 return day+(record.time?' · '+record.time:'');
}
export function healthRecordStatus(record,today){return record?.date===today?'今天已记录':'今天还未记录';}
