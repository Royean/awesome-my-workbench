// Pure read adapters shared by the server and browser. Never mutate stored records.
const groups=['financial','fixed','other'];
const owns=(x,key)=>Object.prototype.hasOwnProperty.call(x,key);
const inferGroup=category=>['cash','fund','stock'].includes(category)?'financial':['server','domain','property','vehicle','equipment','subscription'].includes(category)?'fixed':'other';
const validDate=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
};
const safeText=value=>typeof value==='string'&&value.trim()&&value.length<=250?value.trim():undefined;
// Old import notes escaped formatting newlines. Decode only outside JSON strings;
// values such as quoted notes, paths and escaped quotes must retain their bytes.
function legacyObject(item,prefix='github:fixed:',wrapperKey='原始固定资产',idKey='id'){
 if(typeof item.externalId!=='string'||!item.externalId.startsWith(prefix)||typeof item.note!=='string'||item.note.length>10000)return null;
 let text='',quoted=false,escaped=false;
 for(let i=0;i<item.note.length;i++){
  const c=item.note[i];
  if(quoted){text+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
  else if(c==='"'){quoted=true;text+=c;}
  else if(c==='\\'&&['n','r','t'].includes(item.note[i+1])){text+=' ';i++;}
  else text+=c;
 }
 try{
  const wrapper=JSON.parse(text),original=wrapper?.[wrapperKey];
  return original&&typeof original==='object'&&!Array.isArray(original)&&typeof original[idKey]==='string'&&item.externalId===prefix+original[idKey]?original:null;
 }catch{return null;}
}
export function enrichAssetHolding(item){
 if(!item||item.kind!=='asset_holding')return item;
 const out={...item},source=legacyObject(item);
 if(source){
  const server=/^SRV-[A-Za-z0-9_-]+$/.test(source.id),domain=/^DOM-[A-Za-z0-9_-]+$/.test(source.id);
  // Refine the old generic import category; an explicitly different category stays.
  if((server||domain)&&['equipment','subscription',undefined].includes(out.category))out.category=server?'server':'domain';
  for(const [target,key] of [['expiresOn','expires_on'],['renewalOn','renewal_on']])if(!owns(item,target)&&validDate(source[key]))out[target]=source[key];
  if(!owns(item,'provider')){const value=safeText(source.provider)||safeText(source.registrar);if(value)out.provider=value;}
  if(!owns(item,'identifier')){const value=safeText(domain?source.name:source.id);if(value)out.identifier=value;}
  if(!owns(item,'renewalAmount')&&typeof source.renewal_price==='number'&&Number.isFinite(source.renewal_price)&&source.renewal_price>=0&&source.renewal_price<=1e15)out.renewalAmount=source.renewal_price;
  if(!owns(item,'renewalCurrency')&&typeof source.currency==='string'&&/^[A-Z]{3}$/.test(source.currency))out.renewalCurrency=source.currency;
  if(!owns(item,'renewalMode'))out.renewalMode=source.auto_renew===true?'automatic':source.auto_renew===false?'manual':'unknown';
 }
 if(!groups.includes(out.assetGroup))out.assetGroup=legacyObject(item,'github:holding:','资产原始信息','asset_id')?'financial':inferGroup(out.category);
 return out;
}
export function assetGroup(item){return enrichAssetHolding(item)?.assetGroup||inferGroup(item?.category);}
export function assetDeadline(item,today){
 const x=enrichAssetHolding(item)||{};
 const dates=[{date:x.expiresOn,kind:'expiry'},{date:x.renewalOn,kind:'renewal'}].filter(x=>validDate(x.date)).sort((a,b)=>a.date.localeCompare(b.date));
 const candidate=dates[0]||{date:null,kind:'expiry'};
 const configured=dates.length>0||typeof x.renewalAmount==='number'&&Number.isFinite(x.renewalAmount)||['manual','automatic'].includes(x.renewalMode);
 const eligible=x.kind==='asset_holding'&&x.status!=='closed'&&(['server','domain','subscription'].includes(x.category)||configured);
 if(x.status==='closed')return {...candidate,days:null,status:'closed',eligible:false};
 if(!candidate.date||!validDate(today))return {...candidate,days:null,status:'unknown',eligible};
 const days=Math.round((Date.parse(candidate.date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);
 return {...candidate,days,status:days<0?'overdue':days<=30?'soon':'later',eligible};
}
