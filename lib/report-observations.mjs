// Transcribed report results, not longitudinal home measurements or inferred diagnoses.
export function validateReportObservations(value){
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>200)throw Error('结构化指标需为列表，最多 200 项');
 const limits={label:120,code:40,result:120,unit:60,reference:250,flag:10};
 return value.map((row,i)=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!Object.hasOwn(limits,k)))throw Error(`第 ${i+1} 项指标格式无效`);
  const out={};for(const [k,n] of Object.entries(limits)){
   const v=row[k]===undefined?'':row[k];
   if(typeof v!=='string'||v.length>n)throw Error(`第 ${i+1} 项指标字段格式或长度无效`);
   out[k]=v.trim();
  }
  if(!out.label||!out.result)throw Error(`第 ${i+1} 项指标需填写项目和结果`);
  if(!['','↑','↓','异常'].includes(out.flag))throw Error(`第 ${i+1} 项指标标记无效`);
  return out;
 });
}
