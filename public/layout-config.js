// Shared, declarative health-dashboard contract. No DOM or arbitrary executable styles.
export const LAYOUT_WIDGETS = [
 {id:'trend',title:'监测趋势',description:'体重、血压、睡眠、血糖或静息心率趋势',sizes:{desktop:['medium','large'],mobile:['medium','large']},defaultSize:{desktop:'medium',mobile:'large'}},
 {id:'bodyMetrics',title:'最近身体指标',description:'最近体重、睡眠和静息心率',sizes:{desktop:['small','medium','large'],mobile:['medium','large']},defaultSize:{desktop:'small',mobile:'large'}},
 {id:'water',title:'今日饮水',description:'当天饮水记录与个人记录目标',sizes:{desktop:['small','medium','large'],mobile:['medium','large']},defaultSize:{desktop:'small',mobile:'large'}},
 {id:'tasks',title:'近期待办',description:'未完成待办与复查安排',sizes:{desktop:['small','medium','large'],mobile:['small','medium','large']},defaultSize:{desktop:'small',mobile:'large'}},
 {id:'exercise',title:'运动记录',description:'近七天运动与最近一次运动',sizes:{desktop:['medium','large'],mobile:['medium','large']},defaultSize:{desktop:'medium',mobile:'large'}},
 {id:'meals',title:'最近饮食',description:'最近一次餐食记录',sizes:{desktop:['small','medium','large'],mobile:['small','medium','large']},defaultSize:{desktop:'small',mobile:'large'}},
 {id:'visits',title:'最近就诊',description:'最近保存的就诊记录',sizes:{desktop:['small','medium','large'],mobile:['small','medium','large']},defaultSize:{desktop:'small',mobile:'large'}},
 {id:'reports',title:'最近报告与资料',description:'最近报告或上传的原件',sizes:{desktop:['small','medium','large'],mobile:['small','medium','large']},defaultSize:{desktop:'small',mobile:'large'}},
 {id:'medications',title:'今日用药',description:'现有用药方案与服用记录入口',sizes:{desktop:['large'],mobile:['large']},defaultSize:{desktop:'large',mobile:'large'}}
];
export function defaultLayoutConfig(){
 const device=name=>({mode:'default',widgets:LAYOUT_WIDGETS.map(w=>({id:w.id,visible:true,size:w.defaultSize[name],...(w.id==='trend'?{options:{metric:'weight',range:14}}:w.id==='tasks'?{options:{limit:5}}:{})}))});
 return {schemaVersion:1,desktop:device('desktop'),mobile:device('mobile')};
}
export function layoutValidationError(message,field){return Object.assign(new Error(message),{status:400,expose:true,code:'validation_failed',...(field?{field}:{})});}
function plain(value,label){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw layoutValidationError(`${label}格式无效`);}
function keys(value,allowed,label){plain(value,label);if(Object.keys(value).some(k=>!allowed.includes(k)))throw layoutValidationError(`${label}包含不支持的选项`);}
function options(id,value){
 const allowed=id==='trend'?['metric','range']:id==='tasks'?['limit']:[];
 keys(value,allowed,'卡片展示设置');
 if(value.metric!==undefined&&!['weight','pressure','sleep','glucose','heart'].includes(value.metric))throw layoutValidationError('请选择有效的监测项目','metric');
 if(value.range!==undefined&&![7,14,30].includes(value.range))throw layoutValidationError('趋势范围只能选择7、14或30天','range');
 if(value.limit!==undefined&&(!Number.isInteger(value.limit)||value.limit<1||value.limit>8))throw layoutValidationError('待办显示数量需在1至8项之间','limit');
 return {...value};
}
export function validateLayoutConfig(config){
 keys(config,['schemaVersion','desktop','mobile'],'布局');
 if(config.schemaVersion!==1)throw layoutValidationError('布局版本不支持');
 for(const device of ['desktop','mobile']){
  const view=config[device];keys(view,['mode','widgets'],'设备布局');
  if(!['default','custom'].includes(view.mode)||!Array.isArray(view.widgets)||view.widgets.length!==LAYOUT_WIDGETS.length)throw layoutValidationError('设备布局不完整');
  const seen=new Set();
  for(const widget of view.widgets){keys(widget,['id','visible','size','options'],'卡片');const def=LAYOUT_WIDGETS.find(w=>w.id===widget.id);
   if(!def||seen.has(widget.id))throw layoutValidationError('卡片无效或重复');seen.add(widget.id);
   if(typeof widget.visible!=='boolean'||!def.sizes[device].includes(widget.size))throw layoutValidationError('请选择该设备支持的卡片大小与显示状态');
   if(widget.options!==undefined)options(widget.id,widget.options);
  }
 }
 return structuredClone(config);
}
export function applyLayoutChanges(config,currentTheme,changes){
 keys(changes,['themeColor','desktop','mobile'],'布局改动');
 if(!Object.keys(changes).length)throw layoutValidationError('没有需要修改的布局内容');
 const next=validateLayoutConfig(config),summary=[];let themeColor=currentTheme;
 if(changes.themeColor!==undefined){if(typeof changes.themeColor!=='string'||!/^#[0-9a-f]{6}$/i.test(changes.themeColor))throw layoutValidationError('主题色需为六位十六进制颜色','themeColor');themeColor=changes.themeColor.toUpperCase();summary.push('调整工作台主题色');}
 for(const device of ['desktop','mobile']){
  if(changes[device]===undefined)continue;
  const patch=changes[device],deviceName=device==='desktop'?'电脑':'手机';keys(patch,['order','widgets','reset'],'设备改动');
  if(!Object.keys(patch).length)throw layoutValidationError('设备布局改动不能为空');
  if(patch.reset!==undefined&&patch.reset!==true)throw layoutValidationError('恢复默认选项无效');
  if(patch.reset){if(Object.keys(patch).length!==1)throw layoutValidationError('恢复默认不能同时调整其他卡片');next[device]=defaultLayoutConfig()[device];summary.push(`恢复${deviceName}默认布局`);continue;}
  const view=next[device];view.mode='custom';
  if(patch.order!==undefined){if(!Array.isArray(patch.order)||patch.order.length>LAYOUT_WIDGETS.length||patch.order.some(id=>typeof id!=='string'||!LAYOUT_WIDGETS.some(w=>w.id===id))||new Set(patch.order).size!==patch.order.length)throw layoutValidationError('卡片顺序包含无效或重复卡片');const byId=new Map(view.widgets.map(w=>[w.id,w]));view.widgets=[...patch.order.map(id=>byId.get(id)),...view.widgets.filter(w=>!patch.order.includes(w.id))];}
  if(patch.widgets!==undefined){if(!Array.isArray(patch.widgets)||patch.widgets.length>LAYOUT_WIDGETS.length)throw layoutValidationError('卡片改动格式无效');const seen=new Set();
   for(const widget of patch.widgets){keys(widget,['id','visible','size','options'],'卡片改动');const target=view.widgets.find(w=>w.id===widget.id),def=LAYOUT_WIDGETS.find(w=>w.id===widget.id);
    if(!target||seen.has(widget.id))throw layoutValidationError('卡片改动包含无效或重复卡片');seen.add(widget.id);
    if(Object.keys(widget).length===1)throw layoutValidationError('卡片改动不能为空');
    if(widget.visible!==undefined){if(typeof widget.visible!=='boolean')throw layoutValidationError('卡片显示状态无效');target.visible=widget.visible;}
    if(widget.size!==undefined){if(!def.sizes[device].includes(widget.size))throw layoutValidationError('请选择该设备支持的卡片大小','size');target.size=widget.size;}
    if(widget.options!==undefined)target.options={...(target.options||{}),...options(widget.id,widget.options)};
   }
  }
  summary.push(`调整${deviceName}卡片布局`);
 }
 return {config:validateLayoutConfig(next),themeColor,summary};
}
