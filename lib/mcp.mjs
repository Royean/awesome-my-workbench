// Remote MCP server (Streamable HTTP transport, JSON responses only). Hand-written JSON-RPC 2.0, zero dependencies.
// Data access goes through the same validate()/put() and per-account data scopes as the web API.
export const MCP_PROTOCOL_VERSIONS=['2025-06-18','2025-03-26'];
const LATEST=MCP_PROTOCOL_VERSIONS[0];
const HEALTH_KINDS=['meal','exercise','metric','water'],COMMON_KINDS=['note','task'],MCP_KINDS=[...HEALTH_KINDS,...COMMON_KINDS];
const KIND_NAMES={meal:'餐食',exercise:'运动',metric:'身体指标',water:'饮水',note:'备忘',task:'待办'};
const DEFAULT_TITLES={water:'饮水记录'};
// Writable fields per kind (anything else is rejected, so attachments/medical fields can never be written through MCP).
const FIELDS={
 meal:['title','date','time','note','mealType','portion','rawText'],
 exercise:['title','date','time','note','type','duration','distance','feeling','exercises'],
 metric:['title','date','time','note','type','value','secondary'],
 water:['title','date','time','note','volume'],
 note:['title','date','time','note','category'],
 task:['title','date','time','note','category','done'],
};
const DATE={type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$',description:'日期 YYYY-MM-DD（Asia/Shanghai 时区）'};
const scope={
 workbench:{type:'string',maxLength:100,description:'工作台 ID，默认 health。用 list_workbenches 查看可用工作台'},
 space:{type:'string',enum:['personal','demo'],description:'数据空间：personal（真实数据，默认）或 demo（示例数据）'},
};
const recordFields={
 title:{type:'string',minLength:1,maxLength:120,description:'名称，1–120 字。饮水可省略（默认“饮水记录”）'},
 date:{...DATE,description:'日期 YYYY-MM-DD（Asia/Shanghai），新建时省略则为今天；餐食/运动/指标/饮水不能晚于今天'},
 time:{type:'string',pattern:'^([01]\\d|2[0-3]):[0-5]\\d$',description:'时间 HH:MM（24 小时制，Asia/Shanghai），可选'},
 note:{type:'string',maxLength:5000,description:'备注，可选'},
 mealType:{type:'string',maxLength:250,description:'餐食：餐次，如 早餐/午餐/晚餐/加餐'},
 portion:{type:'string',maxLength:120,description:'餐食：份量描述，如 一碗'},
 rawText:{type:'string',maxLength:5000,description:'餐食：用户原话'},
 type:{type:'string',maxLength:250,description:'运动：运动类型（如 跑步/步行/力量训练）；身体指标：weight(kg)/pressure(mmHg)/glucose(mmol/L)/sleep(小时)/heart(次/分) 之一'},
 duration:{type:'number',exclusiveMinimum:0,maximum:1440,description:'运动：时长（分钟），必填，0<x≤1440'},
 distance:{type:'number',exclusiveMinimum:0,maximum:1000,description:'运动：距离（公里），可选'},
 feeling:{type:'string',enum:['','轻松','适中','吃力','不适'],description:'运动：身体感受'},
 exercises:{type:'array',maxItems:30,description:'运动：力量训练动作列表',items:{type:'object',additionalProperties:false,required:['name','sets','reps'],properties:{name:{type:'string',minLength:1,maxLength:100},sets:{type:'integer',minimum:1,maximum:100},reps:{type:'integer',minimum:1,maximum:500},weight:{type:'number',minimum:0,maximum:1000,description:'公斤，可为 0'}}}},
 value:{type:'number',exclusiveMinimum:0,maximum:10000,description:'身体指标：数值（单位由 type 决定，服务端自动填写）；血压为收缩压'},
 secondary:{type:'number',exclusiveMinimum:0,description:'身体指标：血压的舒张压，需低于收缩压'},
 volume:{type:'number',exclusiveMinimum:0,maximum:5000,description:'饮水：毫升，0<x≤5000'},
 category:{type:'string',maxLength:250,description:'备忘/待办：分类，可选'},
 done:{type:'boolean',description:'待办：是否完成'},
};
export const TOOLS=[
 {name:'list_workbenches',title:'列出工作台',description:'列出当前账号可用的工作台（健康、金融及自建工作台）和数据空间（personal 真实数据 / demo 示例数据），以及每个工作台允许的记录类型。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'get_today',title:'今日概览',description:'获取某工作台某数据空间今天（Asia/Shanghai）的概览：今日全部记录、饮水合计与目标（服务端饮水目标设置，未设置时 2000 毫升；目前固定 2000 毫升）、运动分钟数、餐食数、未完成待办。',inputSchema:{type:'object',properties:{...scope},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'list_records',title:'查询记录',description:'按类型和日期范围查询记录，按日期和时间倒序（最新在前）。',inputSchema:{type:'object',properties:{...scope,kind:{type:'string',enum:[...MCP_KINDS,'all'],description:'记录类型：meal 餐食 / exercise 运动 / metric 身体指标 / water 饮水 / note 备忘 / task 待办 / all 全部（默认）'},from:{...DATE,description:'起始日期（含），YYYY-MM-DD'},to:{...DATE,description:'结束日期（含），YYYY-MM-DD'},limit:{type:'integer',minimum:1,maximum:200,description:'最多返回条数，默认 50，最大 200'}},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'create_record',title:'新建记录',description:'新建一条记录。这是真实健康数据：调用前必须向用户复述将写入的内容并获得确认。健康类（meal/exercise/metric/water）只能写入 health 类型工作台；备忘/待办（note/task）可写入任意工作台。不支持附件和用药。',inputSchema:{type:'object',properties:{...scope,kind:{type:'string',enum:MCP_KINDS,description:'记录类型'},...recordFields},required:['kind'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false}},
 {name:'update_record',title:'修改记录',description:'修改一条已有记录（只传需要修改的字段，其余保持不变）。仅支持 meal/exercise/metric/water/note/task。调用前必须向用户说明修改前后的内容并获得确认。不提供删除。',inputSchema:{type:'object',properties:{...scope,id:{type:'string',minLength:1,maxLength:100,description:'记录 ID（来自 list_records/get_today）'},...recordFields},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true}},
];
// Every tool error carries a stable machine-readable `code` (see docs/MCP.md) and a plain-Chinese message with no field names, ids or schema expressions.
const toolError=(message,code='validation_failed',extra={})=>Object.assign(new Error(message),{toolError:true,code,...extra});
const LABELS={kind:'记录类型',workbench:'工作台',space:'数据空间',id:'记录',title:'名称',date:'日期',time:'时间',note:'备注',mealType:'餐次',portion:'份量',rawText:'原话',type:'类型',duration:'运动时长',distance:'距离',feeling:'身体感受',exercises:'训练动作',value:'监测数值',secondary:'舒张压',volume:'饮水量',category:'分类',done:'完成状态',from:'起始日期',to:'结束日期',limit:'条数',name:'动作名称',sets:'组数',reps:'次数',weight:'重量'};
const RANGE={duration:'运动时长需在 1–1440 分钟之间',distance:'距离需大于0且不超过1000公里',volume:'饮水量需在 1–5000ml 之间',value:'监测数值需大于0且不超过10000',secondary:'舒张压需大于0且低于收缩压',limit:'条数需在 1–200 之间',sets:'组数需在 1–100 之间',reps:'次数需在 1–500 之间',weight:'重量需在 0–1000kg 之间'};
const PATTERN={date:'日期格式不对，请按 2026-11-01 这样填写',from:'起始日期格式不对，请按 2026-11-01 这样填写',to:'结束日期格式不对，请按 2026-11-01 这样填写',time:'时间格式不对，请按 08:30 这样填写'};
const ENUM={kind:'记录类型只能是 餐食、运动、身体指标、饮水、备忘、待办 之一',space:'数据空间只能是 个人数据 或 示例数据',feeling:'身体感受只能是 轻松、适中、吃力、不适 之一'};
const leaf=p=>String(p||'').replace(/\[\d+\]/g,'').split('.').pop();
const label=p=>LABELS[leaf(p)]||'参数';
const at=p=>{const m=/\[(\d+)\]/.exec(String(p||''));return m?`第${Number(m[1])+1}个动作的`:'';};
// Minimal JSON-Schema check matching the published schemas (types, enums, ranges, patterns, required, additionalProperties).
function check(schema,value,path){
 const where=path||'参数';
 if(schema.type==='object'){if(value===null||typeof value!=='object'||Array.isArray(value))throw toolError(`${at(path)}${path?label(path):'内容'}格式不对`,'validation_failed',{field:path});for(const k of schema.required||[])if(value[k]===undefined)throw toolError(`${at(path).replace(/的$/,"")}缺少${label(k)}`,'validation_failed',{field:k});for(const [k,v] of Object.entries(value)){const s=schema.properties?.[k];if(!s){if(schema.additionalProperties===false)throw toolError('包含不支持的参数','validation_failed',{field:k});continue;}check(s,v,path?`${path}.${k}`:k);}return;}
 if(schema.type==='array'){if(!Array.isArray(value))throw toolError(`${label(path)}格式不对`,'validation_failed',{field:path});if(schema.maxItems!==undefined&&value.length>schema.maxItems)throw toolError(`${label(path)}最多 ${schema.maxItems} 项`,'validation_failed',{field:path});value.forEach((v,i)=>check(schema.items,v,`${where}[${i}]`));return;}
 if(schema.type==='string'&&typeof value!=='string')throw toolError(`${at(path)}${label(path)}格式不对`,'validation_failed',{field:path});
 if(schema.type==='number'&&(typeof value!=='number'||!Number.isFinite(value)))throw toolError(`${at(path)}${label(path)}格式不对`,'validation_failed',{field:path});
 if(schema.type==='integer'&&!Number.isInteger(value))throw toolError(`${at(path)}${label(path)}格式不对`,'validation_failed',{field:path});
 if(schema.type==='boolean'&&typeof value!=='boolean')throw toolError(`${at(path)}${label(path)}格式不对`,'validation_failed',{field:path});
 if(schema.enum&&!schema.enum.includes(value))throw toolError(ENUM[leaf(path)]||`${label(path)}取值无效`,'validation_failed',{field:path});
 if(typeof value==='string'){if(schema.minLength!==undefined&&value.length<schema.minLength)throw toolError(`${at(path)}${label(path)}不能为空`,'validation_failed',{field:path});if(schema.maxLength!==undefined&&value.length>schema.maxLength)throw toolError(`${at(path)}${label(path)}最多 ${schema.maxLength} 个字`,'validation_failed',{field:path});if(schema.pattern&&!new RegExp(schema.pattern).test(value))throw toolError(PATTERN[leaf(path)]||`${label(path)}格式不对`,'validation_failed',{field:path});}
 if(typeof value==='number'){if(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum||schema.exclusiveMinimum!==undefined&&value<=schema.exclusiveMinimum)throw toolError(`${at(path)}${RANGE[leaf(path)]||label(path)+'超出范围'}`,'validation_failed',{field:path});}
}
const publicItem=({storageName,attachmentIds,...x})=>x;
const byNewest=(a,b)=>b.date.localeCompare(a.date)||(b.time||'').localeCompare(a.time||'');
export function createMcp({db,put,getAll,today,validDate}){
 const workbenchesFor=user=>db.prepare('SELECT id,name,type FROM user_workbenches WHERE user_id=? ORDER BY rowid').all(user.id);
 function resolve(user,args){
  const workbenchId=args.workbench||'health',base=args.space||'personal';
  const workbench=workbenchesFor(user).find(w=>w.id===workbenchId);if(!workbench)throw toolError('没有找到这个工作台，请从你的工作台里选一个','not_found',{hint:'用 list_workbenches 获取可用工作台'});
  const space=db.prepare('SELECT space FROM data_scopes WHERE user_id=? AND workbench_id=? AND base_space=?').get(user.id,workbenchId,base)?.space;if(!space)throw toolError(base==='demo'?'这个工作台没有示例数据':'这个工作台没有个人数据空间','not_found');
  return {workbench,space,base};
 }
 const allowedKinds=w=>w.type==='health'?MCP_KINDS:COMMON_KINDS;
 const assertKind=(w,kind)=>{if(!allowedKinds(w).includes(kind))throw toolError(`「${w.name}」工作台只能记备忘和待办，${KIND_NAMES[kind]||'这类记录'}请记到「健康」工作台`,'forbidden_kind');};
 const pick=(kind,args)=>{const out={};for(const [k,v] of Object.entries(args))if(!['kind','workbench','space','id'].includes(k)){if(!FIELDS[kind].includes(k))throw toolError(`${KIND_NAMES[kind]}记录不支持${LABELS[k]?'「'+LABELS[k]+'」':'这个参数'}`,'validation_failed',{field:k});out[k]=v;}return out;};
 const run={
  list_workbenches(user){return {workbenches:workbenchesFor(user).map(w=>({...w,spaces:['personal','demo'],writableKinds:allowedKinds(w)})),defaultWorkbench:'health',defaultSpace:'personal',timezone:'Asia/Shanghai',today:today()};},
  get_today(user,args){const {workbench,space,base}=resolve(user,args);const date=today();const items=getAll(space).filter(x=>x.date===date&&x.kind!=='file').map(publicItem).sort(byNewest);
   const settings=JSON.parse(db.prepare('SELECT body FROM settings WHERE space=?').get(space)?.body||'{}');const goal=Number(settings.waterGoal)>0?Number(settings.waterGoal):2000;
   const sum=(k,f)=>items.filter(x=>x.kind===k).reduce((a,x)=>a+Number(x[f]||0),0);
   return {date,timezone:'Asia/Shanghai',workbench,space:base,summary:workbench.type==='health'?{water:{totalMl:sum('water','volume'),goalMl:goal},exerciseMinutes:sum('exercise','duration'),meals:items.filter(x=>x.kind==='meal').length,metrics:items.filter(x=>x.kind==='metric').length,openTasks:items.filter(x=>x.kind==='task'&&!x.done).length}:{openTasks:items.filter(x=>x.kind==='task'&&!x.done).length,notes:items.filter(x=>x.kind==='note').length},records:items};},
  list_records(user,args){const {workbench,space,base}=resolve(user,args);const kind=args.kind||'all';
   for(const f of ['from','to'])if(args[f]!==undefined&&!validDate(args[f]))throw toolError(PATTERN[f],'validation_failed',{field:f});if(args.from&&args.to&&args.from>args.to)throw toolError('起始日期不能晚于结束日期','validation_failed',{field:'from'});
   const limit=args.limit??50;const all=getAll(space).filter(x=>MCP_KINDS.includes(x.kind)&&(kind==='all'||x.kind===kind)&&(!args.from||x.date>=args.from)&&(!args.to||x.date<=args.to)).sort(byNewest);
   return {workbench:workbench.id,space:base,kind,total:all.length,returned:Math.min(limit,all.length),records:all.slice(0,limit).map(publicItem)};},
  create_record(user,args){const {workbench,space}=resolve(user,args);assertKind(workbench,args.kind);const body=pick(args.kind,args);body.date??=today();if(body.title===undefined&&DEFAULT_TITLES[args.kind])body.title=DEFAULT_TITLES[args.kind];return {created:publicItem(put(space,args.kind,body))};},
  update_record(user,args){const {workbench,space}=resolve(user,args);const row=db.prepare('SELECT kind,body FROM items WHERE id=? AND space=?').get(args.id,space);if(!row)throw toolError('没有找到这条记录，可能已在网页删除','not_found');if(!MCP_KINDS.includes(row.kind))throw toolError('这类记录不支持在助手里修改，请到网页操作','forbidden_kind');assertKind(workbench,row.kind);const patch=pick(row.kind,args);if(!Object.keys(patch).length)throw toolError('没有需要修改的内容');return {updated:publicItem(put(space,row.kind,{...JSON.parse(row.body),...patch},args.id))};},
 };
 const rpcError=(id,code,message,data)=>({jsonrpc:'2.0',id:id??null,error:{code,message,...(data?{data}:{})}});
 // Returns {status, body} where body is undefined for 202 (notification/response accepted).
 function handle(user,msg,headerVersion){
  if(Array.isArray(msg))return {status:400,body:rpcError(null,-32600,'不支持 JSON-RPC 批量请求')};
  if(!msg||typeof msg!=='object'||msg.jsonrpc!=='2.0')return {status:400,body:rpcError(msg?.id,-32600,'无效的 JSON-RPC 请求')};
  if(msg.method===undefined)return {status:202};// a response from the client
  if(typeof msg.method!=='string')return {status:400,body:rpcError(msg.id,-32600,'无效的 JSON-RPC 请求')};
  const isNotification=msg.id===undefined;if(isNotification)return {status:202};
  if(!(typeof msg.id==='string'||Number.isInteger(msg.id)))return {status:400,body:rpcError(null,-32600,'id 需为字符串或整数')};
  const ok=result=>({status:200,body:{jsonrpc:'2.0',id:msg.id,result}});const params=msg.params??{};
  if(params===null||typeof params!=='object'||Array.isArray(params))return {status:200,body:rpcError(msg.id,-32602,'params 需为对象')};
  switch(msg.method){
   case 'initialize':{const requested=params.protocolVersion;return ok({protocolVersion:MCP_PROTOCOL_VERSIONS.includes(requested)?requested:LATEST,capabilities:{tools:{listChanged:false}},serverInfo:{name:'zhiheng',title:'知衡',version:'1.0.0'},instructions:'知衡是个人健康工作台。日期一律使用 Asia/Shanghai 时区的 YYYY-MM-DD。写入（create_record/update_record）前必须向用户复述内容并获得确认；没有删除工具。'});}
   case 'ping':return ok({});
   case 'tools/list':return ok({tools:TOOLS});
   case 'tools/call':{
    const tool=TOOLS.find(t=>t.name===params.name);if(!tool)return {status:200,body:rpcError(msg.id,-32602,'未知工具',{code:'unknown_tool'})};
    const args=params.arguments??{};
    try{check(tool.inputSchema,args);const result=run[tool.name](user,args);return ok({content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:false});}
    catch(e){if(e.toolError||e.expose){const error={code:e.code||'validation_failed',message:e.message,...(e.hint?{hint:e.hint}:{})};return ok({content:[{type:'text',text:e.message}],structuredContent:{error},isError:true});}throw e;}
   }
   default:return {status:200,body:rpcError(msg.id,-32601,`方法不存在：${msg.method}`)};
  }
 }
 return {handle};
}
