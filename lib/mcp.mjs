import { enrichAssetHolding } from '../public/asset-lifecycle.js';
import { TRAVEL_KINDS, TRAVEL_FIELDS, TRAVEL_SCHEMA } from './travel.mjs';
import { ASSET_KINDS, ASSET_FIELDS, ASSET_SCHEMA } from './assets.mjs';
// Remote MCP server (Streamable HTTP transport, JSON responses only). Hand-written JSON-RPC 2.0, zero dependencies.
// Data access goes through the same validate()/put() and per-account data scopes as the web API.
export const MCP_PROTOCOL_VERSIONS=['2025-06-18','2025-03-26'];
const LATEST=MCP_PROTOCOL_VERSIONS[0];
const HEALTH_KINDS=['meal','exercise','metric','water','visit','report','medication','dose','favorite'],COMMON_KINDS=['note','task'],MCP_KINDS=[...HEALTH_KINDS,...COMMON_KINDS,...ASSET_KINDS,...TRAVEL_KINDS];
const KIND_NAMES={travel_trip:'旅行',travel_stop:'旅行地点',travel_booking:'预订',travel_check:'准备清单',asset_account:'账户',asset_holding:'资产持仓',asset_liability:'负债',asset_transaction:'流水',asset_snapshot:'估值快照',meal:'餐食',exercise:'运动',metric:'身体指标',water:'饮水',note:'备忘',task:'待办',visit:'就诊',report:'报告',medication:'用药',dose:'服药',favorite:'收藏'};
const DEFAULT_TITLES={water:'饮水记录'};
// Generic record fields are allowlisted per kind; attachment links require dedicated tools.
const FIELDS={...ASSET_FIELDS,...TRAVEL_FIELDS,
 meal:['title','date','time','note','mealType','portion','rawText'],
 exercise:['title','date','time','note','type','duration','distance','feeling','exercises'],
 metric:['title','date','time','note','type','value','secondary'],
 water:['title','date','time','note','volume'],
 note:['title','date','time','note','category'],
 task:['title','date','time','note','category','done'],
 visit:['title','date','time','note','hospital','hospitalId','city','department','status','doctor','reason','assessment','instructions'],
 report:['title','date','time','note','visitId','type','status','source','content','observations'],
 medication:['title','date','note','visitId','dosage','route','frequency','prescriber','status','endDate','scheduleMode','times'],
 dose:['title','date','time','note','medicationId','scheduledTime','outcome'],
 favorite:['title','date','note','targetKind','template','sourceId'],
};
// Dose records can only be corrected (outcome/time/note) through MCP; validate() applies the web rules (跳过 needs a reason and clears time, 已服用 needs a time).
const DOSE_UPDATABLE=['outcome','time','note'];
// Generic record writes never accept attachment fields; dedicated upload/link tools are explicit.
const ATTACHMENT_KEYS=['imageFileId','image','fileId','attachmentIds','attachments','storageName','content_base64'];
const READ_BACK='涉及用药（medication）或服药（dose）时：写入前必须把药名、剂量、时间完整念一遍给用户，用户明确回答「对」之后才能调用。记「跳过」服药时，先问用户为什么跳过，再把药名、计划服用时间和跳过原因念一遍，用户回答「对」才写（原因写在备注里）。';
const DATE={type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$',description:'日期 YYYY-MM-DD（健康记录为Asia/Shanghai；旅行为目的地当地日期，不自动换算）'};
const scope={
 workbench:{type:'string',maxLength:100,description:'工作台 ID，默认 health。用 list_workbenches 查看可用工作台'},
 space:{type:'string',enum:['personal','demo'],description:'数据空间：personal（真实数据，默认）或 demo（示例数据）'},
};
const recordFields={...ASSET_SCHEMA,...TRAVEL_SCHEMA,
 title:{type:'string',minLength:1,maxLength:120,description:'名称，1–120 字。饮水可省略（默认「饮水记录」）'},
 date:{...DATE,description:'日期 YYYY-MM-DD，健康使用Asia/Shanghai，旅行使用目的地当地日期，不自动换算。新建时省略则为今天；餐食/运动/指标/饮水不能晚于今天，旅行安排允许未来日期'},
 time:{type:'string',pattern:'^([01]\\d|2[0-3]):[0-5]\\d$',description:'时间 HH:MM（24小时制），旅行按目的地当地墙上时间保存，不自动换算；其他记录按Asia/Shanghai。可选'},
 note:{type:'string',maxLength:5000,description:'备注，可选'},
 mealType:{type:'string',maxLength:250,description:'餐食：餐次，如 早餐/午餐/晚餐/加餐'},
 portion:{type:'string',maxLength:120,description:'餐食：份量描述，如 一碗'},
 rawText:{type:'string',maxLength:5000,description:'餐食：用户原话'},
 type:{type:'string',maxLength:250,description:'运动：运动类型（如 跑步/步行/力量训练）；身体指标：weight(kg)/pressure(mmHg)/glucose(mmol/L)/sleep(小时)/heart(次/分) 之一'},
 duration:{type:'number',exclusiveMinimum:0,maximum:1440,description:'运动：时长（分钟），必填，0<x≤1440'},
 distance:{type:'number',exclusiveMinimum:0,maximum:1000,description:'运动：距离（公里），可选'},
 feeling:{type:'string',enum:['','轻松','适中','吃力','不适'],description:'运动：身体感受'},
 exercises:{type:'array',maxItems:30,description:'运动：力量训练动作列表',items:{type:'object',additionalProperties:false,required:['name','sets','reps'],properties:{name:{type:'string',minLength:1,maxLength:100},sets:{type:'integer',minimum:1,maximum:100},reps:{type:'integer',minimum:1,maximum:500},weight:{type:'number',minimum:0,maximum:1000,description:'公斤，可为 0'}}}},
 value:{type:'number',minimum:0,maximum:1e15,description:'监测数值或资产原币估值；监测值必须大于0且不超过10000，按kind由服务端校验'},
 secondary:{type:'number',exclusiveMinimum:0,description:'身体指标：血压的舒张压，需低于收缩压'},
 volume:{type:'number',exclusiveMinimum:0,maximum:5000,description:'饮水：毫升，0<x≤5000'},
 category:{type:'string',maxLength:250,description:'资产类别：cash/fund/stock/property/vehicle/equipment/subscription/server/domain/other；或备忘/待办分类'},
 done:{type:'boolean',description:'待办：是否完成'},
 hospitalId:{type:'string',maxLength:100,description:'就诊：机构目录编号，可空，自定义机构留空，不推测'},
 city:{type:'string',maxLength:100,description:'就诊：实际就诊城市，可空；连锁机构不自动采用总部城市'},
 hospital:{type:'string',maxLength:250,description:'就诊：医院'},
 department:{type:'string',maxLength:250,description:'就诊：科室'},
 status:{type:'string',maxLength:250,description:'就诊：待就诊/已完成/待复查（新建时未来日期默认待就诊，否则已完成）；报告：待出报告/待补充/待核对/已归档；用药：进行中/已停用/已完成'},
 doctor:{type:'string',maxLength:8000,description:'就诊：医生'},
 reason:{type:'string',maxLength:8000,description:'就诊：就诊原因'},
 assessment:{type:'string',maxLength:8000,description:'就诊：医生结论'},
 instructions:{type:'string',maxLength:8000,description:'就诊：医嘱'},
 visitId:{type:'string',minLength:1,maxLength:100,description:'报告/用药：关联的就诊记录 ID（必填，先用 list_records kind=visit 查找，没有就先新建就诊记录）'},
 source:{type:'string',maxLength:1000,description:'报告或资产记录的来源'},
 content:{type:'string',maxLength:20000,description:'报告：原文文字（检查数值等），可读可改'},
 observations:{type:'array',maxItems:200,description:'报告：经用户确认的原报告指标；结果、单位、参考范围、标记逐字摘录，不自动推断异常或诊断',items:{type:'object',additionalProperties:false,required:['label','result'],properties:{label:{type:'string',minLength:1,maxLength:120},code:{type:'string',maxLength:40},result:{type:'string',minLength:1,maxLength:120},unit:{type:'string',maxLength:60},reference:{type:'string',maxLength:250},flag:{type:'string',enum:['','↑','↓','异常']}}}},
 dosage:{type:'string',maxLength:250,description:'用药：单次用量（按处方原文）'},
 route:{type:'string',maxLength:250,description:'用药：用药途径'},
 frequency:{type:'string',maxLength:250,description:'用药：频次'},
 prescriber:{type:'string',maxLength:250,description:'用药：开药医生'},
 endDate:{...DATE,description:'用药：结束日期 YYYY-MM-DD，可选，不早于开始日期'},
 scheduleMode:{type:'string',enum:['scheduled','asNeeded'],description:'用药：scheduled 按时服用（需 times）/ asNeeded 按需'},
 times:{type:'array',maxItems:12,description:'用药：每天服用时间 HH:MM 列表（1–12 个，不重复）',items:{type:'string',pattern:'^([01]\\d|2[0-3]):[0-5]\\d$'}},
 medicationId:{type:'string',minLength:1,maxLength:100,description:'服药：用药方案 ID（先用 list_records kind=medication 查找）'},
 scheduledTime:{type:'string',pattern:'^([01]\\d|2[0-3]):[0-5]\\d$',description:'服药：对应的计划服用时间，可选'},
 targetKind:{type:'string',enum:['meal','exercise'],description:'收藏：收藏的是哪类记录，meal 餐食 / exercise 运动'},
 template:{type:'object',description:'收藏：常用内容模板，字段同对应的餐食/运动记录（如 {"title":"燕麦牛奶","mealType":"早餐","portion":"一碗"}）'},
 sourceId:{type:'string',maxLength:100,description:'收藏：来源记录 ID，可选'},
 outcome:{type:'string',enum:['已服用','跳过'],description:'服药：已服用（默认，需填实际服用时间）或 跳过（需在备注写跳过原因，不记服用时间）'},
};
export const TOOLS=[
 {name:'upload_attachment',title:'上传资料原件',description:'上传用户已确认的原件到健康、资产、旅行或自建工作台。仅支持 PDF、PNG、JPG、WEBP、TXT，单文件大于0且不超过10MiB。先复述文件名、检查日期和目标空间并获得确认。传原文件的标准Base64及SHA-256，不传下载链接，不生成或修改文件内容。同一空间内文件名、日期、内容和备注完全相同的重试返回同一原件；不会覆盖已有文件。上传后用 attach_report_file 关联报告，图片可用 attach_medication_image 关联已有用药方案，无需新增用药。',inputSchema:{type:'object',additionalProperties:false,required:['name','contentBase64','sha256'],properties:{...scope,name:{type:'string',minLength:1,maxLength:250},contentBase64:{type:'string',minLength:4,maxLength:13981016},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},date:DATE,title:recordFields.title,note:recordFields.note,tripId:TRAVEL_SCHEMA.tripId}},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},
 {name:'list_attachments',title:'查询资料原件',description:'查询健康、资产、旅行或自建工作台的原件安全元数据。按文件名、标题、备注搜索，并按类型、起止日期或旅行筛选；不搜索PDF/OCR全文，不返回文件字节或存储路径。结果按日期、时间、编号倒序；total为过滤后总量，使用nextOffset继续查询。',inputSchema:{type:'object',additionalProperties:false,properties:{...scope,query:{type:'string',maxLength:200},fileType:{type:'string',enum:['all','pdf','image','text','audio']},from:DATE,to:DATE,tripId:{type:'string',minLength:1,maxLength:100,description:'仅旅行工作台：旅行编号或unassigned（未关联资料），省略为全部'},offset:{type:'integer',minimum:0,maximum:100000},limit:{type:'integer',minimum:1,maximum:200}}},annotations:{readOnlyHint:true}},
 {name:'attach_report_file',title:'关联报告原件',description:'将已上传的原件关联到同一健康空间的已有报告。调用前复述报告、检查日期和原件名称并获得确认。只添加原件，已有不同原件时拒绝替换；重复关联同一原件返回相同结果。报告必须已有有效就诊。',inputSchema:{type:'object',additionalProperties:false,required:['reportId','fileId'],properties:{...scope,reportId:{type:'string',minLength:1,maxLength:100},fileId:{type:'string',minLength:1,maxLength:100}}},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},
 {name:'attach_medication_image',title:'关联药品图片',description:'将已上传的 PNG、JPG 或 WEBP 图片关联到同一健康空间的已有用药方案。调用前复述图片名称和目标空间并获得确认。'+READ_BACK+'只添加图片，已有不同图片时拒绝替换，请到网页核对后调整；重复关联同一图片返回相同结果。不修改药名、剂量、频次或服用时间。',inputSchema:{type:'object',additionalProperties:false,required:['medicationId','fileId'],properties:{...scope,medicationId:{type:'string',minLength:1,maxLength:100},fileId:{type:'string',minLength:1,maxLength:100}}},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},
 {name:'list_workbenches',title:'列出工作台',description:'列出当前账号可用的工作台（健康、资产、旅行及自建工作台）和数据空间（personal 真实数据 / demo 示例数据），以及每个工作台允许的记录类型。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'get_today',title:'今日概览',description:'获取某工作台某数据空间今天（Asia/Shanghai）的概览：今日全部记录、饮水合计与目标（服务端饮水目标设置，未设置时 2000 毫升；目前固定 2000 毫升）、运动分钟数、餐食数、未完成待办。',inputSchema:{type:'object',properties:{...scope},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'list_records',title:'查询记录',description:'按类型和日期范围查询记录，按日期和时间倒序（最新在前）。返回完整文字字段（就诊医生/原因/结论/医嘱、报告原文、用药剂量/途径/频次/时间/状态、服药结果/时间）。附件只返回文件名和类型，不返回文件内容。',inputSchema:{type:'object',properties:{...scope,kind:{type:'string',enum:[...MCP_KINDS,'all'],description:'记录类型：meal 餐食 / exercise 运动 / metric 身体指标 / water 饮水 / visit 就诊 / report 报告 / medication 用药 / dose 服药 / favorite 收藏 / note 备忘 / task 待办 / all 全部（默认）。附件只返回文件名和类型'},from:{...DATE,description:'起始日期（含），YYYY-MM-DD'},to:{...DATE,description:'结束日期（含），YYYY-MM-DD'},limit:{type:'integer',minimum:1,maximum:200,description:'最多返回条数，默认 50，最大 200'},externalId:ASSET_SCHEMA.externalId},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'create_record',title:'新建记录',description:'新建一条记录。这是真实健康数据：调用前必须向用户复述将写入的内容并获得确认。健康类（meal/exercise/metric/water/visit/report/medication/dose）只能写入 health 类型工作台；资产账户/持仓/负债/流水/快照只能写入资产工作台；旅行/地点/预订/准备清单（travel_trip/travel_stop/travel_booking/travel_check）只能写入旅行工作台；备忘/待办（note/task）可写入任意工作台。'+READ_BACK+'报告和用药必须关联已有就诊记录（visitId），没有就先 list_records kind=visit 或新建就诊。服药可记「已服用」或「跳过」，不能记未来日期。不能添加或更换附件。',inputSchema:{type:'object',properties:{...scope,kind:{type:'string',enum:MCP_KINDS,description:'记录类型'},...recordFields},required:['kind'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false}},
 {name:'update_record',title:'修改记录',description:'修改一条已有记录（只传需要修改的字段，其余保持不变）。支持 meal/exercise/metric/water/visit/report/medication/dose/note/task。调用前必须向用户说明修改前后的内容并获得确认。'+READ_BACK+'服药记录只能改服用结果、时间和备注。不能更换附件。删除用 delete_record。',inputSchema:{type:'object',properties:{...scope,id:{type:'string',minLength:1,maxLength:100,description:'记录 ID（来自 list_records/get_today）'},...recordFields},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true}},
 {name:'delete_record',title:'删除记录',description:'删除一条记录（进入「最近删除」，30 天内可用 restore_record 或在网页「最近删除」恢复）。这是真实健康数据：调用前必须把要删除的内容（类型、日期时间、名称和关键数值）完整念给用户，用户明确同意后才能调用。删除用药（medication）或服药（dose）前，必须把药名、剂量、时间完整念一遍，用户明确回答「对」之后才能调用。规则与网页相同：已有服药记录的用药方案不能删除（请先停用）；删除就诊不会连带删除报告和用药；删除旅行会将其地点、预订、准备清单和关联资料一起放入最近删除，恢复旅行时一起恢复。本工具不执行预订或付款。附件请到网页删除。',inputSchema:{type:'object',properties:{...scope,id:{type:'string',minLength:1,maxLength:100,description:'记录 ID（来自 list_records/get_today）'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false}},
 {name:'list_deleted',title:'最近删除',description:'列出最近 30 天删除的记录（最新在前），含删除时间、删除来源（web 网页 / mcp 助手）和到期时间。',inputSchema:{type:'object',properties:{...scope,limit:{type:'integer',minimum:1,maximum:200,description:'最多返回条数，默认 50'}},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'restore_record',title:'恢复删除',description:'把「最近删除」里的一条记录恢复原样（同一个 ID）。恢复前向用户说明要恢复哪条并确认。报告/用药需要它所属的就诊还在、服药需要用药方案还在；如果上级记录也在最近删除里，会报错；问用户「所属就诊、用药方案或旅行也已删除，一起恢复？」，同意后带 withParent:true 再调用。',inputSchema:{type:'object',properties:{...scope,id:{type:'string',minLength:1,maxLength:100,description:'记录 ID（来自 list_deleted）'},withParent:{type:'boolean',description:'上级记录（就诊/用药方案/旅行）也在最近删除里时，是否一起先恢复上级（需用户同意）'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false}},
 {name:'create_workbench',title:'新建工作台',description:'新建一个工作台（支持备忘、待办和资料），名称 1–24 字。调用前向用户确认名称。',inputSchema:{type:'object',properties:{name:{type:'string',minLength:1,maxLength:24,description:'工作台名称，1–24 字'}},required:['name'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false}},
 {name:'rename_workbench',title:'工作台改名',description:'给自建的工作台改名（健康、资产、旅行不能改名），名称 1–24 字。调用前向用户确认新名称。',inputSchema:{type:'object',properties:{workbench:{type:'string',minLength:1,maxLength:100,description:'工作台 ID（来自 list_workbenches）'},name:{type:'string',minLength:1,maxLength:24,description:'新名称，1–24 字'}},required:['workbench','name'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},
 {name:'get_settings',title:'查看设置',description:'查看某工作台某数据空间的设置：每日饮水目标（毫升，默认 2000）和关注目标。',inputSchema:{type:'object',properties:{...scope},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'update_settings',title:'修改设置',description:'修改每日饮水目标（100–10000 毫升）或关注目标（最多 180 字）。调用前向用户确认。账号、密码、令牌等不能通过助手修改。',inputSchema:{type:'object',properties:{...scope,waterGoalMl:{type:'integer',minimum:100,maximum:10000,description:'每日饮水目标（毫升）'},focus:{type:'string',maxLength:180,description:'关注目标'}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},
];
// Every tool error carries a stable machine-readable `code` (see docs/MCP.md) and a plain-Chinese message with no field names, ids or schema expressions.
const toolError=(message,code='validation_failed',extra={})=>Object.assign(new Error(message),{toolError:true,code,...extra});
const LABELS={assetGroup:'资产分区',expiresOn:'到期日期',renewalOn:'续费日期',renewalAmount:'续费参考费用',renewalCurrency:'续费币种',provider:'服务商',identifier:'资产标识',renewalMode:'平台续费状态',kind:'记录类型',workbench:'工作台',space:'数据空间',id:'记录',title:'名称',date:'日期',time:'时间',note:'备注',mealType:'餐次',portion:'份量',rawText:'原话',type:'类型',duration:'运动时长',distance:'距离',feeling:'身体感受',exercises:'训练动作',value:'监测数值',secondary:'舒张压',volume:'饮水量',category:'分类',done:'完成状态',from:'起始日期',to:'结束日期',limit:'条数',name:'动作名称',sets:'组数',reps:'次数',weight:'重量',hospital:'医院',hospitalId:'医院编号',city:'就诊城市',department:'科室',status:'状态',doctor:'医生',reason:'就诊原因',assessment:'医生结论',instructions:'医嘱',visitId:'关联就诊',source:'来源',content:'报告原文',observations:'报告指标',dosage:'单次用量',route:'用药途径',frequency:'频次',prescriber:'开药医生',endDate:'结束日期',scheduleMode:'服用方式',times:'服用时间',medicationId:'用药方案',targetKind:'收藏类型',template:'收藏内容',sourceId:'来源记录',waterGoalMl:'每日饮水目标',focus:'关注目标',scheduledTime:'计划服用时间',outcome:'服用结果'};
const RANGE={duration:'运动时长需在 1–1440 分钟之间',distance:'距离需大于 0 且不超过 1000 公里',volume:'饮水量需在 1–5000ml 之间',value:'监测数值需大于 0 且不超过 10000',secondary:'舒张压需大于 0 且低于收缩压',limit:'条数需在 1–200 之间',waterGoalMl:'每日饮水目标需在 100–10000 毫升之间',sets:'组数需在 1–100 之间',reps:'次数需在 1–500 之间',weight:'重量需在 0–1000kg 之间'};
const PATTERN={date:'日期格式不对，请按 2026-11-01 这样填写',from:'起始日期格式不对，请按 2026-11-01 这样填写',to:'结束日期格式不对，请按 2026-11-01 这样填写',endDate:'结束日期格式不对，请按 2026-11-01 这样填写',times:'服用时间格式不对，请按 08:30 这样填写',scheduledTime:'计划服用时间格式不对，请按 08:30 这样填写',time:'时间格式不对，请按 08:30 这样填写'};
const ENUM={targetKind:'收藏类型只能是 餐食 或 运动',outcome:'服用结果只能是 已服用 或 跳过',kind:'记录类型只能是 餐食、运动、身体指标、饮水、就诊、报告、用药、服药、收藏、备忘、待办 之一',scheduleMode:'服用方式只能是 按时 或 按需',space:'数据空间只能是 个人数据 或 示例数据',feeling:'身体感受只能是 轻松、适中、吃力、不适 之一'};
const leaf=p=>String(p||'').replace(/\[\d+\]/g,'').split('.').pop();
const label=p=>LABELS[leaf(p)]||'参数';
const at=p=>{const m=/\[(\d+)\]/.exec(String(p||''));return m&&String(p).startsWith('exercises')?`第${Number(m[1])+1}个动作的`:'';};
// Minimal JSON-Schema check matching the published schemas (types, enums, ranges, patterns, required, additionalProperties).
function check(schema,value,path){
 const where=path||'参数';
 if(schema.anyOf){let first;for(const candidate of schema.anyOf){try{check(candidate,value,path);return;}catch(error){first??=error;}}throw first;}
 if(schema.type==='null'){if(value!==null)throw toolError(`${label(path)}格式不对`,'validation_failed',{field:path});return;}
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

const md=d=>`${Number(d.slice(5,7))}月${Number(d.slice(8,10))}日`;
const byNewest=(a,b)=>b.date.localeCompare(a.date)||(b.time||'').localeCompare(a.time||'');
export function createMcp({db,put,getAll,today,validDate,nowHM,softDelete,listTrash,restoreFromTrash,readSettings,writeSettings,validateWorkbench,assertUniqueWorkbenchName,uploadAttachment,listAttachments,attachReportFile,attachMedicationImage}){
 const workbenchesFor=user=>db.prepare('SELECT id,name,type,themeColor FROM user_workbenches WHERE user_id=? ORDER BY rowid').all(user.id);
 function resolve(user,args){
  const workbenchId=args.workbench||'health',base=args.space||'personal';
  const workbench=workbenchesFor(user).find(w=>w.id===workbenchId);if(!workbench)throw toolError('没有找到这个工作台，请从你的工作台里选一个','not_found',{hint:'用 list_workbenches 获取可用工作台'});
  const space=db.prepare('SELECT space FROM data_scopes WHERE user_id=? AND workbench_id=? AND base_space=?').get(user.id,workbenchId,base)?.space;if(!space)throw toolError(base==='demo'?'这个工作台没有示例数据':'这个工作台没有个人数据空间','not_found');
  return {workbench,space,base};
 }
 // Attachments: only file name and type ever leave the server; never content, storage name or path.
 const fileInfo=(space,id)=>{const r=db.prepare("SELECT body FROM items WHERE id=? AND space=? AND kind='file'").get(id,space);if(!r)return null;const f=JSON.parse(r.body);return {name:f.name||f.title,type:f.mime||''};};
 const publicItem=space=>({storageName,attachmentIds,fileId,imageFileId,mime,size,...x})=>{
  if(x.kind==='medication'&&imageFileId)x.image=fileInfo(space,imageFileId);
  if(x.kind==='report'&&fileId)x.attachment=fileInfo(space,fileId);
  // Linked visit / medication that was deleted: expose that instead of failing.
  const link=x.kind==='dose'?['medicationId','medication']:['report','medication'].includes(x.kind)?['visitId','visit']:null;
  if(link&&x[link[0]]&&!db.prepare('SELECT id FROM items WHERE id=? AND space=?').get(x[link[0]],space))x[link[1]]={deleted:true,inTrash:!!db.prepare('SELECT id FROM trash_items WHERE id=? AND space=?').get(x[link[0]],space)};
  if(x.kind==='meal'&&attachmentIds?.length)x.attachments=attachmentIds.map(id=>fileInfo(space,id)).filter(Boolean);
  return enrichAssetHolding(x);};
 const allowedKinds=w=>w.type==='health'?[...HEALTH_KINDS,...COMMON_KINDS]:w.type==='finance'?[...ASSET_KINDS,...COMMON_KINDS]:w.type==='travel'?[...TRAVEL_KINDS,...COMMON_KINDS]:COMMON_KINDS;
 const assertKind=(w,kind)=>{if(!allowedKinds(w).includes(kind))throw toolError(w.type==='finance'?`「${w.name}」工作台不支持${KIND_NAMES[kind]||'这类记录'}，请切换到对应工作台`:`「${w.name}」工作台支持备忘、待办和资料，${KIND_NAMES[kind]||'这类记录'}请切换到支持该记录类型的工作台`,'forbidden_kind');};
 const pick=(kind,args)=>{const out={};for(const [k,v] of Object.entries(args))if(!['kind','workbench','space','id'].includes(k)){if(!FIELDS[kind].includes(k))throw toolError(`${KIND_NAMES[kind]}记录不支持${LABELS[k]?'「'+LABELS[k]+'」':'这个参数'}`,'validation_failed',{field:k});out[k]=v;}return out;};
 const needMedication=(space,id)=>{if(!id)throw toolError('请先选好要记的用药方案','validation_failed',{field:'medicationId',hint:'先用 list_records kind=medication 找到用药方案；没有的话先新建用药记录'});const r=db.prepare("SELECT body FROM items WHERE id=? AND space=? AND kind='medication'").get(id,space);if(!r)throw toolError('没有找到这个用药方案','not_found',{field:'medicationId',hint:'先用 list_records kind=medication 找到用药方案；没有的话先新建用药记录'});return JSON.parse(r.body);};
 // MCP checks on top of validate(): visit link for report/medication (with an assistant hint), future dose dates (same rule as web, with future_date code).
 function checkHealth(space,kind,body,original){
  if(kind==='medication'&&body.times!==undefined&&(body.scheduleMode||'scheduled')==='scheduled'){const ts=body.times;if(!Array.isArray(ts)||!ts.length)throw toolError('按时服用需要至少填一个服用时间','validation_failed',{field:'times'});const dup=ts.find((t,i)=>ts.indexOf(t)!==i);if(dup)throw toolError(`${dup} 填了两次，每个时间只填一次`,'validation_failed',{field:'times'});}
  if(kind==='dose'){const med=needMedication(space,body.medicationId);const t0=today();
   if(typeof body.date==='string'&&body.date>t0)throw toolError(`不能记录未来的服药，今天是 ${Number(t0.slice(5,7))}月${Number(t0.slice(8,10))}日`,'future_date',{field:'date'});
   if(typeof body.date==='string'&&body.date<med.date)throw toolError(`这个方案从 ${md(med.date)}开始，服药日期不能早于这天`,'validation_failed',{field:'date'});
   if(med.endDate&&typeof body.date==='string'&&body.date>med.endDate)throw toolError(`这个方案到 ${md(med.endDate)}结束，服药日期不能晚于这天`,'validation_failed',{field:'date'});
   const keepSlot=original&&original.scheduledTime===body.scheduledTime&&original.medicationId===body.medicationId;
   if(body.scheduledTime&&!keepSlot&&!(med.times||[]).includes(body.scheduledTime))throw toolError('计划时间不在这个用药方案里','validation_failed',{field:'scheduledTime',hint:'用 list_records kind=medication 查看这个方案的服用时间；补记可以不填计划时间'});
   if((body.outcome||'已服用')==='已服用'&&!body.time)throw toolError('请记录实际服用时间','validation_failed',{field:'time'});
   if((body.outcome||'已服用')==='已服用'&&body.date===t0&&body.time>nowHM())throw toolError(`服药时间不能晚于现在，现在是 ${nowHM()}`,'future_date',{field:'time'});}
  if(['report','medication'].includes(kind)&&!(original&&!original.visitId&&!body.visitId)){const hint='先用 list_records kind=visit 找到这次就诊；没有的话先新建一条就诊记录';
   if(!body.visitId)throw toolError(`${KIND_NAMES[kind]}需要关联一次就诊，请先选好是哪次就诊`,'validation_failed',{field:'visitId',hint});
   if(original?.visitId!==body.visitId&&!db.prepare("SELECT id FROM items WHERE id=? AND space=? AND kind='visit'").get(body.visitId,space))throw toolError('没有找到要关联的那次就诊','not_found',{field:'visitId',hint});}
 }
 const run={
  upload_attachment(user,args){const {space}=resolve(user,args);return uploadAttachment(space,{...args,date:args.date??today()});},
  list_attachments(user,args){const {space}=resolve(user,args);const {workbench,space:base,...filters}=args;return listAttachments(space,filters);},
  attach_medication_image(user,args){const {workbench,space}=resolve(user,args);assertKind(workbench,'medication');return {updated:publicItem(space)(attachMedicationImage(space,args))};},
  attach_report_file(user,args){const {workbench,space}=resolve(user,args);assertKind(workbench,'report');const result=attachReportFile(space,args);return {updated:publicItem(space)(result),fileId:args.fileId};},
  list_workbenches(user){return {workbenches:workbenchesFor(user).map(w=>({...w,spaces:['personal','demo'],writableKinds:allowedKinds(w)})),defaultWorkbench:'health',defaultSpace:'personal',timezone:'Asia/Shanghai',today:today()};},
  get_today(user,args){const {workbench,space,base}=resolve(user,args);const date=today();const items=getAll(space).filter(x=>x.date===date&&MCP_KINDS.includes(x.kind)).map(publicItem(space)).sort(byNewest);
   const settings=JSON.parse(db.prepare('SELECT body FROM settings WHERE space=?').get(space)?.body||'{}');const goal=Number(settings.waterGoalMl||settings.waterGoal)>0?Number(settings.waterGoalMl||settings.waterGoal):2000;
   const sum=(k,f)=>items.filter(x=>x.kind===k).reduce((a,x)=>a+Number(x[f]||0),0);
   return {date,timezone:'Asia/Shanghai',workbench,space:base,summary:workbench.type==='health'?{water:{totalMl:sum('water','volume'),goalMl:goal},exerciseMinutes:sum('exercise','duration'),meals:items.filter(x=>x.kind==='meal').length,metrics:items.filter(x=>x.kind==='metric').length,openTasks:items.filter(x=>x.kind==='task'&&!x.done).length}:{openTasks:items.filter(x=>x.kind==='task'&&!x.done).length,notes:items.filter(x=>x.kind==='note').length},records:items};},
  list_records(user,args){const {workbench,space,base}=resolve(user,args);const kind=args.kind||'all';
   for(const f of ['from','to'])if(args[f]!==undefined&&!validDate(args[f]))throw toolError(PATTERN[f],'validation_failed',{field:f});if(args.from&&args.to&&args.from>args.to)throw toolError('起始日期不能晚于结束日期','validation_failed',{field:'from'});
   if(args.externalId!==undefined&&![...ASSET_KINDS,...TRAVEL_KINDS].includes(kind))throw toolError('来源编号查询需指定资产或旅行记录类型','validation_failed',{field:'externalId'});
   const limit=args.limit??50;const all=getAll(space).filter(x=>MCP_KINDS.includes(x.kind)&&(kind==='all'||x.kind===kind)&&(args.externalId===undefined||x.externalId===args.externalId)&&(!args.from||x.date>=args.from)&&(!args.to||x.date<=args.to)).sort(byNewest);
   return {workbench:workbench.id,space:base,kind,total:all.length,returned:Math.min(limit,all.length),records:all.slice(0,limit).map(publicItem(space))};},
  create_record(user,args){const {workbench,space}=resolve(user,args);assertKind(workbench,args.kind);const body=pick(args.kind,args);body.date??=today();if(body.title===undefined&&DEFAULT_TITLES[args.kind])body.title=DEFAULT_TITLES[args.kind];
   if(args.kind==='visit')body.status??=(body.date>today()?'待就诊':'已完成');
   if(args.kind==='dose'){body.outcome??='已服用';const med=needMedication(space,body.medicationId);body.title??=med.title;}
   checkHealth(space,args.kind,body);
   return {created:publicItem(space)(put(space,args.kind,body,undefined,'mcp'))};},
  delete_record(user,args){const {workbench,space}=resolve(user,args);const row=db.prepare('SELECT kind FROM items WHERE id=? AND space=?').get(args.id,space);if(!row)throw toolError('没有找到这条记录，可能已经删除','not_found',{hint:'用 list_records 重新查找；已删除的在 list_deleted 里'});
   if(!MCP_KINDS.includes(row.kind))throw toolError('附件等资料请到网页删除','forbidden_kind');assertKind(workbench,row.kind);
   return {deleted:publicItem(space)(softDelete(space,args.id,'mcp')),restorableDays:30};},
  list_deleted(user,args){const {workbench,space,base}=resolve(user,args);const limit=args.limit??50;const all=listTrash(space).filter(x=>MCP_KINDS.includes(x.kind));
   return {workbench:workbench.id,space:base,total:all.length,returned:Math.min(limit,all.length),records:all.slice(0,limit).map(publicItem(space))};},
  restore_record(user,args){const {space}=resolve(user,args);try{return {restored:publicItem(space)(restoreFromTrash(space,args.id,{withParent:args.withParent===true}))};}catch(e){if(e.code==='parent_deleted')e.hint=`先问用户「${e.message.replace(/，需要一起恢复$/,'')}，一起恢复？」；同意后用 withParent:true 再调用 restore_record（将一起恢复：${e.parentIds.join('、')}）`;throw e;}},
  create_workbench(user,args){const item=validateWorkbench({type:'other',name:args.name},workbenchesFor(user));
   db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO user_workbenches(user_id,id,name,type,themeColor) VALUES(?,?,?,?,?)').run(user.id,item.id,item.name,item.type,item.themeColor);for(const base of ['personal','demo'])db.prepare('INSERT INTO data_scopes VALUES(?,?,?,?)').run(user.id,item.id,base,`account:${user.id}:${item.id}:${base}`);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   return {created:{...item,writableKinds:COMMON_KINDS}};},
  rename_workbench(user,args){const w=workbenchesFor(user).find(x=>x.id===args.workbench);if(!w)throw toolError('没有找到这个工作台，请从你的工作台里选一个','not_found',{hint:'用 list_workbenches 获取可用工作台'});
   if(w.type!=='other')throw toolError(`「${w.name}」是内置工作台，不能改名`,'forbidden_kind');const name=args.name.trim();if(!name||name.length>24)throw toolError('工作台名称需为 1–24 个字');assertUniqueWorkbenchName(workbenchesFor(user),name,w.id);
   db.prepare('UPDATE user_workbenches SET name=? WHERE user_id=? AND id=?').run(name,user.id,w.id);return {renamed:{id:w.id,name,type:w.type,previousName:w.name,themeColor:w.themeColor}};},
  get_settings(user,args){const {workbench,space,base}=resolve(user,args);const s=readSettings(space);return {workbench:workbench.id,space:base,waterGoalMl:Number(s.waterGoalMl)>0?Number(s.waterGoalMl):2000,focus:s.focus||''};},
  update_settings(user,args){const {workbench,space,base}=resolve(user,args);if(args.waterGoalMl===undefined&&args.focus===undefined)throw toolError('没有需要修改的内容');const s=writeSettings(space,{waterGoalMl:args.waterGoalMl,focus:args.focus});return {workbench:workbench.id,space:base,waterGoalMl:s.waterGoalMl||2000,focus:s.focus};},
  update_record(user,args){const {workbench,space}=resolve(user,args);const row=db.prepare('SELECT kind,body FROM items WHERE id=? AND space=?').get(args.id,space);if(!row)throw toolError('没有找到这条记录，可能已在网页删除','not_found');if(!MCP_KINDS.includes(row.kind))throw toolError('这类记录不支持在助手里修改，请到网页操作','forbidden_kind');assertKind(workbench,row.kind);const patch=pick(row.kind,args);if(!Object.keys(patch).length)throw toolError('没有需要修改的内容');
   if(row.kind==='dose'&&Object.keys(patch).some(k=>!DOSE_UPDATABLE.includes(k)))throw toolError('服药记录在助手里只能改服用结果、时间和备注，其他请到网页修改','validation_failed');
   const stored=JSON.parse(row.body),body={...stored,...patch};checkHealth(space,row.kind,body,stored);
   return {updated:publicItem(space)(put(space,row.kind,body,args.id,'mcp'))};},
 };
 const rpcError=(id,code,message,data)=>({jsonrpc:'2.0',id:id??null,error:{code,message,...(data?{data}:{})}});
 // Returns {status, body} where body is undefined for 202 (notification/response accepted).
 function handle(user,msg,headerVersion){
  if(Array.isArray(msg))return {status:400,body:rpcError(null,-32600,'不支持 JSON-RPC 批量请求')};
  if(!msg||typeof msg!=='object'||msg.jsonrpc!=='2.0')return {status:400,body:rpcError(msg?.id,-32600,'无效的 JSON-RPC 请求')};
  if(msg.method===undefined)return {status:202};// a response from the client
  if(typeof msg.method!=='string')return {status:400,body:rpcError(msg.id,-32600,'无效的 JSON-RPC 请求')};
  const isNotification=msg.id===undefined;if(isNotification)return {status:202};
  if(!(typeof msg.id==='string'||Number.isInteger(msg.id)))return {status:400,body:rpcError(null,-32600,'请求编号格式不对')};
  const ok=result=>({status:200,body:{jsonrpc:'2.0',id:msg.id,result}});const params=msg.params??{};
  if(params===null||typeof params!=='object'||Array.isArray(params))return {status:200,body:rpcError(msg.id,-32602,'请求内容格式不对')};
  switch(msg.method){
   case 'initialize':{const requested=params.protocolVersion;return ok({protocolVersion:MCP_PROTOCOL_VERSIONS.includes(requested)?requested:LATEST,capabilities:{tools:{listChanged:false}},serverInfo:{name:'zhiheng',title:'知衡',version:'1.0.0'},instructions:'知衡是个人多工作台。健康记录日期使用Asia/Shanghai时区的YYYY-MM-DD；旅行日期和时间使用目的地当地墙上日期时间，不自动换算时区，允许未来安排。写入（create_record/update_record）前必须向用户复述内容并获得确认；用药和服药要把药名、剂量、时间完整念一遍（跳过服药则念药名、计划时间和原因），用户回答「对」才写。删除会进入「最近删除」，30 天内可恢复；删除前必须念出要删的内容并获得确认。'});}
   case 'ping':return ok({});
   case 'tools/list':return ok({tools:TOOLS});
   case 'tools/call':{
    const tool=TOOLS.find(t=>t.name===params.name);if(!tool)return {status:200,body:rpcError(msg.id,-32602,'未知工具',{code:'unknown_tool'})};
    const args=params.arguments??{};
    try{if(['create_workbench','rename_workbench'].includes(tool.name)&&args&&typeof args==='object'&&(typeof args.name!=='string'||!args.name.trim()||args.name.trim().length>24))throw toolError('工作台名称需为 1–24 个字','validation_failed',{field:'name'});
    if(args&&typeof args==='object'&&['create_record','update_record'].includes(tool.name)&&ATTACHMENT_KEYS.some(k=>k in args))throw toolError('助手不能添加或更换附件，请到网页操作','validation_failed');check(tool.inputSchema,args);const result=run[tool.name](user,args);return ok({content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:false});}
    catch(e){if(e.toolError||e.expose){const error={code:e.code||'validation_failed',message:e.message,...(e.hint?{hint:e.hint}:{})};return ok({content:[{type:'text',text:e.message}],structuredContent:{error},isError:true});}throw e;}
   }
   default:return {status:200,body:rpcError(msg.id,-32601,`方法不存在：${msg.method}`)};
  }
 }
 return {handle};
}
