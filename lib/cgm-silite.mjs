// SiLite's fixed cloud endpoint, based on the user-supplied integration record.
// This is an unofficial interface: never accept a caller-provided upstream URL.
const ORIGIN='https://api.sisensing.com';
const LIMIT=5*1024*1024;
export const cgmError=(status,code,message,extra={})=>Object.assign(new Error(message),{status,code,expose:true,...extra});
const protocol=()=>cgmError(502,'cgm_protocol_error','CGM平台返回的数据格式有变化，请稍后重试');
export function createSilite({fetchImpl=fetch,now=Date.now,timeoutMs=30000}={}){
 async function request(route,{token,body}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);timer.unref?.();
  try{
   const response=await fetchImpl(ORIGIN+route,{method:body?'POST':'GET',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:controller.signal});
   if(response.status===429){const retry=Number(response.headers.get('retry-after'));throw cgmError(429,'cgm_rate_limited','CGM平台请求频繁，已延后同步',{retryAfter:Number.isFinite(retry)&&retry>0?Math.min(3600,Math.max(60,retry)):300});}
   if(response.status===401||response.status===403)return {unauthorized:true};
   if(!response.ok)throw cgmError(502,'cgm_upstream_unavailable','暂时无法连接CGM平台，请稍后重试');
   const length=Number(response.headers.get('content-length'));if(length>LIMIT)throw protocol();
   if(!response.body?.getReader)throw protocol();
   const reader=response.body.getReader(),chunks=[];let size=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT){await reader.cancel();throw protocol();}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
   let result;try{result=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));}catch{throw protocol();}
   if(!result||typeof result!=='object'||Array.isArray(result))throw protocol();
   return result;
  }catch(error){if(error?.expose&&String(error.code).startsWith('cgm_'))throw error;throw cgmError(502,'cgm_upstream_unavailable','暂时无法连接CGM平台，请稍后重试');}
  finally{clearTimeout(timer);}
 }
 async function login(username,password){
  const result=await request('/lite-sense-app/user/password/login',{body:{phone:username,password,appCode:'LITE_SENSE_APP'}});
  if(result.unauthorized||result.code!==200)throw cgmError(400,'cgm_auth_failed','账号或密码未通过CGM平台验证，请检查后重试',{field:'password'});
  const token=result.data?.access_token,seconds=result.data?.expires_in;
  if(typeof token!=='string'||!token||token.length>4096||/[\r\n]/.test(token)||typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<=0||seconds>366*86400)throw protocol();
  return {token,expiresAt:now()+seconds*1000};
 }
 async function pull(token){
  const result=await request('/lite-sense-app/follow/myself/glucose/',{token});
  if(result.unauthorized||result.code===401)throw cgmError(409,'cgm_token_expired','CGM平台登录已过期，请重新连接');
  if(result.code!==200)throw cgmError(502,'cgm_upstream_unavailable','CGM平台暂时无法提供数据，请稍后重试');
  const data=result.data;
  let rows;
  if(Array.isArray(data?.glucoseDataList)){
   if(data.glucoseDataList.length>100)throw protocol();
   rows=[];
   for(const device of data.glucoseDataList){
    if(!device||typeof device!=='object'||Array.isArray(device))throw protocol();
    const points=device.glucoseInfos??[];
    if(!Array.isArray(points)||rows.length+points.length>10000)throw protocol();
    rows.push(...points);
   }
  }else{
   if(data&&Object.hasOwn(data,'glucoseDataList'))throw protocol();
   rows=data?.glucoseInfos;
  }
  if(!Array.isArray(rows)||rows.length>10000)throw protocol();
  const points=[];let skipped=0;
  for(const row of rows){
   if(!row||typeof row!=='object'||typeof row.t!=='number'||!Number.isSafeInteger(row.t)||row.t<946684800000||row.t>now()+300000||typeof row.v!=='number'||!Number.isFinite(row.v)||row.v<=0||row.v>100){skipped++;continue;}
   const point={t:row.t,value:row.v};
   if(typeof row.s==='number'&&Number.isFinite(row.s)&&Math.abs(row.s)<=100)point.trend=row.s;
   else if(typeof row.s==='string'&&row.s.length<=24)point.trend=row.s;
   points.push(point);
  }
  // A nonempty but entirely malformed response must not claim a successful sync.
  if(rows.length&&!points.length)throw protocol();
  return {points,skipped};
 }
 async function collect(secret){
  let auth={token:secret.token,expiresAt:secret.expiresAt};
  let refreshed=false;
  if(typeof auth.token!=='string'||!auth.token||!Number.isFinite(auth.expiresAt)||auth.expiresAt<=now()+300000){auth=await login(secret.username,secret.password);refreshed=true;}
  try{return {...await pull(auth.token),auth};}
  catch(error){if(error.code!=='cgm_token_expired'||refreshed)throw error;auth=await login(secret.username,secret.password);return {...await pull(auth.token),auth};}
 }
 return {login,pull,collect};
}
