// Merge deliberate draft edits onto a freshly read definition after a conflict.
// Unchanged fields retain concurrent edits; stable block ids preserve their identity.
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const copy=value=>structuredClone(value);
function mergeObject(base,draft,fresh){
 const out=copy(fresh||{});
 for(const key of new Set([...Object.keys(base||{}),...Object.keys(draft||{})])){
  if(same(base?.[key],draft?.[key]))continue;
  if(draft?.[key]===undefined)delete out[key];
  else if(key==='binding'||key==='appearance')out[key]=mergeObject(base?.[key]||{},draft[key],fresh?.[key]||{});
  else out[key]=copy(draft[key]);
 }
 return out;
}
export function mergeComponentDraft(base,draft,fresh){
 const result=mergeObject({...base,blocks:undefined},{...draft,blocks:undefined},{...fresh,blocks:undefined});
 if(same(base.blocks,draft.blocks)){result.blocks=copy(fresh.blocks);return result;}
 const original=new Map(base.blocks.map(b=>[b.id,b])),local=new Map(draft.blocks.map(b=>[b.id,b])),latest=new Map(fresh.blocks.map(b=>[b.id,b]));
 for(const [id,b]of original)if(!local.has(id))latest.delete(id);
 for(const [id,b]of local){if(!original.has(id))latest.set(id,copy(b));else if(!same(original.get(id),b))latest.set(id,mergeObject(original.get(id),b,latest.get(id)||original.get(id)));}
 const localOrder=draft.blocks.map(b=>b.id),baseOrder=base.blocks.map(b=>b.id);
 const order=same(localOrder,baseOrder)?fresh.blocks.map(b=>b.id):localOrder;
 result.blocks=[...order.filter(id=>latest.has(id)).map(id=>latest.get(id)),...[...latest].filter(([id])=>!order.includes(id)).map(([,b])=>b)];
 return result;
}
