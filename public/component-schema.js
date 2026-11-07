// Shared component vocabulary. Definitions contain data, never executable markup or queries.
const common=['health','finance','travel','reading','other'];
const countOnly=(title,types)=>({title,workbenchTypes:types,fields:{},aggregations:['count','dailyCount','list'],countUnit:'项'});
const numeric=(title,types,fields,countUnit='次')=>({title,workbenchTypes:types,fields,aggregations:['count','sum','latest','dailySum','dailyAvg','dailyCount','list'],countUnit});
export const COMPONENT_CATALOG={
 schemaVersion:1,blockTypes:['stat','chart','list','progress'],layouts:['stack','grid'],days:[7,14,30,90],maxBlocks:8,maxComponents:50,maxPlacementsPerDevice:12,
 kinds:{
  exercise:numeric('运动记录',['health'],{duration:{label:'运动时长',unit:'分钟'},distance:{label:'运动距离',unit:'公里'}}),
  water:numeric('饮水记录',['health'],{volume:{label:'饮水量',unit:'ml'}}),
  metric:{title:'身体指标',workbenchTypes:['health'],fields:{value:{label:'指标数值',unit:'metric'},secondary:{label:'舒张压',unit:'mmHg'}},aggregations:['count','latest','dailyAvg','dailyCount','list'],countUnit:'次'},
  meal:countOnly('饮食记录',['health']),visit:countOnly('就诊记录',['health']),
  task:countOnly('待办',common),note:countOnly('备忘',common),
  reading_entry:numeric('阅读记录',['reading'],{minutes:{label:'阅读时长',unit:'分钟'}},'次'),reading_book:countOnly('书籍',['reading']),
  travel_trip:countOnly('旅行',['travel']),travel_stop:countOnly('旅行地点',['travel']),travel_booking:countOnly('预订',['travel']),travel_check:countOnly('准备清单',['travel']),
  asset_account:countOnly('资产账户',['finance']),asset_holding:countOnly('资产持仓',['finance']),asset_liability:countOnly('负债',['finance']),asset_transaction:countOnly('流水',['finance']),asset_snapshot:countOnly('估值快照',['finance'])
 },metrics:{weight:{title:'体重',unit:'kg'},pressure:{title:'血压',unit:'mmHg'},sleep:{title:'睡眠',unit:'小时'},glucose:{title:'血糖',unit:'mmol/L'},heart:{title:'静息心率',unit:'次/分'},steps:{title:'步数',unit:'步'}}
};
export const COMPONENT_TEMPLATES=[
 {id:'exercise-summary',title:'运动汇总',description:'近7天运动时长、次数和每日柱状图',workbenchTypes:['health'],sourceType:'health'},
 {id:'metric-trend',title:'身体指标趋势',description:'最近体重与近14天每日平均趋势',workbenchTypes:['health'],sourceType:'health'},
 {id:'water-progress',title:'今日饮水进度',description:'当天饮水量与已有饮水记录目标',workbenchTypes:['health'],sourceType:'health'},
 {id:'pending-tasks',title:'待办清单',description:'所有未完成待办数量和最近事项',workbenchTypes:common,sourceType:'current'},
 {id:'reading-summary',title:'阅读汇总',description:'近7天阅读分钟数、次数和每日柱状图',workbenchTypes:['reading'],sourceType:'reading'},
 {id:'notes-list',title:'最近备忘',description:'展示最近保存的备忘',workbenchTypes:common,sourceType:'current'}
];
const binding=(kind,aggregation,extra={})=>({kind,aggregation,days:null,...extra});
export function createComponentDefinition(templateId='exercise-summary',sourceWorkbench='health'){
 const base={schemaVersion:1,title:'我的组件',description:'',sourceWorkbench,layout:'grid',appearance:{accent:null,tone:'neutral',density:'comfortable'},blocks:[]};
 if(templateId==='exercise-summary')Object.assign(base,{title:'近7天运动',blocks:[{id:'duration',type:'stat',label:'运动时长',binding:binding('exercise','sum',{field:'duration',days:7})},{id:'count',type:'stat',label:'运动次数',binding:binding('exercise','count',{days:7})},{id:'daily',type:'chart',label:'每日运动时长',chart:'bar',binding:binding('exercise','dailySum',{field:'duration',days:7})}]});
 else if(templateId==='metric-trend')Object.assign(base,{title:'体重趋势',blocks:[{id:'latest',type:'stat',label:'最近体重',binding:binding('metric','latest',{field:'value',metric:'weight'})},{id:'daily',type:'chart',label:'每日平均体重',chart:'line',binding:binding('metric','dailyAvg',{field:'value',metric:'weight',days:14})}]});
 else if(templateId==='water-progress')Object.assign(base,{title:'今日饮水',blocks:[{id:'water',type:'progress',label:'今日记录进度',target:{mode:'waterGoalMl'},binding:binding('water','sum',{field:'volume',days:7,todayOnly:true})}]});
 else if(templateId==='pending-tasks')Object.assign(base,{title:'接下来要做的事',blocks:[{id:'count',type:'stat',label:'未完成待办',binding:binding('task','count',{onlyPending:true})},{id:'tasks',type:'list',label:'近期待办',binding:binding('task','list',{onlyPending:true,limit:5})}]});
 else if(templateId==='reading-summary')Object.assign(base,{title:'近7天阅读',blocks:[{id:'minutes',type:'stat',label:'阅读时长',binding:binding('reading_entry','sum',{field:'minutes',days:7})},{id:'count',type:'stat',label:'阅读次数',binding:binding('reading_entry','count',{days:7})},{id:'daily',type:'chart',label:'每日阅读时长',chart:'bar',binding:binding('reading_entry','dailySum',{field:'minutes',days:7})}]});
 else if(templateId==='notes-list')Object.assign(base,{title:'最近备忘',layout:'stack',blocks:[{id:'notes',type:'list',label:'最近保存',binding:binding('note','list',{limit:5})}]});
 else throw componentValidationError('组件模板不存在');
 return validateComponentDefinition(base);
}
export const componentValidationError=(message,field)=>Object.assign(new Error(message),{status:400,expose:true,code:'validation_failed',...(field?{field}:{})});
const plain=(v,label)=>{if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw componentValidationError(label+'格式无效');};
const exact=(v,allowed,label)=>{plain(v,label);if(Object.keys(v).some(k=>!allowed.includes(k)))throw componentValidationError(label+'包含不支持的选项');};
const text=(v,min,max,label)=>{if(typeof v!=='string'||v.trim().length<min||v.length>max)throw componentValidationError(label+'长度无效');return v.trim();};
export function validateComponentDefinition(input){
 exact(input,['schemaVersion','title','description','sourceWorkbench','layout','appearance','blocks'],'组件定义');
 if(input.schemaVersion!==1)throw componentValidationError('组件版本不支持');
 const out={schemaVersion:1,title:text(input.title,1,40,'组件名称'),description:text(input.description??'',0,240,'组件说明'),sourceWorkbench:text(input.sourceWorkbench,1,100,'来源工作台'),layout:input.layout,appearance:input.appearance,blocks:input.blocks};
 if(!COMPONENT_CATALOG.layouts.includes(out.layout))throw componentValidationError('请选择有效排列方式');
 exact(out.appearance,['accent','tone','density'],'组件外观');
 if(out.appearance.accent!==null&&(typeof out.appearance.accent!=='string'||!/^#[a-f0-9]{6}$/i.test(out.appearance.accent)))throw componentValidationError('组件颜色需为六位十六进制颜色或跟随工作台');
 if(!['neutral','tinted'].includes(out.appearance.tone)||!['compact','comfortable'].includes(out.appearance.density))throw componentValidationError('组件外观选项无效');
 if(!Array.isArray(out.blocks)||out.blocks.length<1||out.blocks.length>8)throw componentValidationError('组件需包含1至8个区块');
 const ids=new Set();
 for(const block of out.blocks){
  exact(block,['id','type','label','binding','chart','target'],'组件区块');
  if(typeof block.id!=='string'||!/^[-a-zA-Z0-9_]{1,40}$/.test(block.id)||ids.has(block.id))throw componentValidationError('区块编号无效或重复');ids.add(block.id);
  text(block.label,1,40,'区块标题');if(!COMPONENT_CATALOG.blockTypes.includes(block.type))throw componentValidationError('区块类型无效');
  const q=block.binding;exact(q,['kind','aggregation','field','metric','days','limit','onlyPending','todayOnly'],'数据绑定');const kind=Object.hasOwn(COMPONENT_CATALOG.kinds,q.kind)?COMPONENT_CATALOG.kinds[q.kind]:null;
  if(!kind||!kind.aggregations.includes(q.aggregation))throw componentValidationError('此数据类型不支持所选计算');
  if(q.days!==null&&!COMPONENT_CATALOG.days.includes(q.days))throw componentValidationError('请选择全部时间或7、14、30、90天');
  if(q.todayOnly!==undefined&&typeof q.todayOnly!=='boolean')throw componentValidationError('当天筛选无效');
  if(q.todayOnly&&q.days===null)throw componentValidationError('当天筛选需使用有限时间范围');
  if(q.onlyPending!==undefined&&(typeof q.onlyPending!=='boolean'||!['task','travel_check'].includes(q.kind)))throw componentValidationError('此数据类型不支持未完成筛选');
  if(q.kind==='metric'){if(!Object.hasOwn(COMPONENT_CATALOG.metrics,q.metric))throw componentValidationError('请选择监测项目');}else if(q.metric!==undefined)throw componentValidationError('仅身体指标可选择监测项目');
  const numericOps=['sum','latest','dailySum','dailyAvg'];
  if(numericOps.includes(q.aggregation)){if(!Object.hasOwn(kind.fields,q.field))throw componentValidationError('请选择支持的数值字段');if(q.field==='secondary'&&q.metric!=='pressure')throw componentValidationError('舒张压仅适用于血压');}
  else if(q.field!==undefined)throw componentValidationError('此计算不需要数值字段');
  if(q.limit!==undefined&&(!Number.isInteger(q.limit)||q.limit<1||q.limit>8||q.aggregation!=='list'))throw componentValidationError('列表数量需在1至8项之间');
  const allowed=block.type==='stat'?['count','sum','latest']:block.type==='chart'?['dailyCount','dailySum','dailyAvg']:block.type==='list'?['list']:['count','sum'];
  if(!allowed.includes(q.aggregation))throw componentValidationError('区块展示与计算方式不匹配');
  if(block.type==='chart'){if(!['bar','line'].includes(block.chart)||q.days===null)throw componentValidationError('图表需选择类型和有限时间范围');}else if(block.chart!==undefined)throw componentValidationError('此区块不支持图表类型');
  if(block.type==='progress'){
   if(!['water','exercise','task','reading_entry','travel_check'].includes(q.kind))throw componentValidationError('此数据类型不支持进度目标');
   exact(block.target,['mode','value'],'进度目标');if(block.target.mode==='fixed'){if(typeof block.target.value!=='number'||!Number.isFinite(block.target.value)||block.target.value<=0||block.target.value>1000000)throw componentValidationError('进度目标需为有效正数');}
   else if(block.target.mode==='waterGoalMl'){if(Object.keys(block.target).length!==1||q.kind!=='water'||q.field!=='volume'||q.aggregation!=='sum')throw componentValidationError('饮水目标仅适用于饮水量');}
   else throw componentValidationError('进度目标类型无效');
  }else if(block.target!==undefined)throw componentValidationError('此区块不支持进度目标');
 }
 return structuredClone(out);
}
const STR=(max,min=0)=>({type:'string',minLength:min,maxLength:max});
const bindingSchema={type:'object',additionalProperties:false,required:['kind','aggregation','days'],properties:{kind:{type:'string',enum:Object.keys(COMPONENT_CATALOG.kinds)},aggregation:{type:'string',enum:['count','sum','latest','dailySum','dailyCount','dailyAvg','list']},field:STR(30,1),metric:{type:'string',enum:Object.keys(COMPONENT_CATALOG.metrics)},days:{anyOf:[{type:'integer',enum:COMPONENT_CATALOG.days},{type:'null'}]},limit:{type:'integer',minimum:1,maximum:8},onlyPending:{type:'boolean'},todayOnly:{type:'boolean'}}};
export const COMPONENT_DEFINITION_SCHEMA={
 type:'object',additionalProperties:false,required:['schemaVersion','title','sourceWorkbench','layout','appearance','blocks'],
 properties:{
  schemaVersion:{type:'integer',enum:[1]},title:STR(40,1),description:STR(240),sourceWorkbench:STR(100,1),layout:{type:'string',enum:COMPONENT_CATALOG.layouts},
  appearance:{type:'object',additionalProperties:false,required:['accent','tone','density'],properties:{accent:{anyOf:[{type:'string',pattern:'^#[a-fA-F0-9]{6}$'},{type:'null'}]},tone:{type:'string',enum:['neutral','tinted']},density:{type:'string',enum:['compact','comfortable']}}},
  blocks:{type:'array',minItems:1,maxItems:8,items:{
   type:'object',additionalProperties:false,required:['id','type','label','binding'],properties:{
    id:{type:'string',pattern:'^[-a-zA-Z0-9_]{1,40}$'},type:{type:'string',enum:COMPONENT_CATALOG.blockTypes},label:STR(40,1),binding:bindingSchema,chart:{type:'string',enum:['bar','line']},
    target:{type:'object',additionalProperties:false,required:['mode'],properties:{mode:{type:'string',enum:['fixed','waterGoalMl']},value:{type:'number',exclusiveMinimum:0,maximum:1000000}}}
   }
  }}
 }
};
