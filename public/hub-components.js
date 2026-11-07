import { renderComponentCard } from './component-card.js';
import { COMPONENT_TEMPLATES } from './component-schema.js';
import { createFilePreviews } from './file-preview.js';
import { workbenchTheme } from './shell.js';

const BASE = 'ui-components';
const CATEGORIES = [
 ['controls','基础控件'],
 ['layout','布局容器'],
 ['data','数据展示'],
 ['feedback','状态反馈'],
 ['composite','组合组件']
];
const THEMES = [
 {id:'health',name:'健康',type:'health'},
 {id:'finance',name:'资产',type:'finance'},
 {id:'travel',name:'旅行',type:'travel'},
 {id:'reading',name:'阅读',type:'reading'}
];
const DEFAULT = [['default','默认']];
const DEMO_DATES = ['06-08','06-09','06-10','06-11','06-12','06-13','06-14'];
const DEMO_TREND = [25,35,18,42,34,48,32];
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function sampleTrend(state) {
 const values = state === 'empty' ? DEMO_TREND.map(() => null) :
  state === 'missing' ? [25,null,18,42,null,48,32] : DEMO_TREND;
 return values.map((value,i) => ({date:'2026-'+DEMO_DATES[i],label:DEMO_DATES[i].replace('-','/'),value}));
}

const CATALOG = [
 {
  id:'button',category:'controls',name:'按钮',icon:'plus',source:'.btn / .icon-btn',
  description:'触发记录、保存、取消等明确的操作。',
  usage:'各工作台的表单、列表和页内操作。',
  guidance:'同一区域保留一个主要按钮。只有图标时提供可读的操作名称，并为暂不可用的操作使用原生 disabled。',
  states:[...DEFAULT,['disabled','禁用']],
  code:'<button type="button" class="btn primary">保存记录</button>\n<button type="button" class="btn">取消</button>',
  example:(state,{icon}) => `<div class="hub-components-sample-actions">
    <button type="button" class="btn primary" data-demo-event="save" ${state==='disabled'?'disabled':''}>${icon('check',15)}保存记录</button>
    <button type="button" class="btn" data-demo-event="cancel">取消</button>
    <button type="button" class="icon-btn" aria-label="编辑示例" data-demo-event="edit">${icon('edit',18)}</button>
   </div><p class="hub-components-demo-status" data-demo-status role="status"></p>`
 },
 {
  id:'field',category:'controls',name:'表单字段',icon:'edit',source:'.field / .field-error',
  description:'用标签、输入框和辅助文字收集结构化信息。',
  usage:'健康记录、旅行行程、阅读记录和工作台设置。',
  guidance:'用 for 和 id 关联标签。发生输入错误时，将错误文字与字段关联，同时保留原输入。',
  states:[...DEFAULT,['filled','已填写'],['invalid','校验失败'],['disabled','禁用']],
  code:'<div class="field">\n  <label for="record-title">记录名称</label>\n  <input id="record-title" name="title" required>\n</div>',
  example:state => `<div class="field hub-components-sample-field">
    <label for="hub-sample-field">记录名称</label>
    <input id="hub-sample-field" placeholder="输入名称" value="${state==='filled'||state==='disabled'?'晨间散步':''}" aria-describedby="hub-sample-field-hint" ${state==='invalid'?'aria-invalid="true"':''} ${state==='disabled'?'disabled':''}>
    ${state==='invalid'?'<p id="hub-sample-field-hint" class="field-error">请输入记录名称</p>':'<small id="hub-sample-field-hint">使用容易辨认的名称，例如「晨间散步」。</small>'}
   </div>`
 },
 {
  id:'tabs',category:'layout',name:'页内标签',icon:'menu',source:'.tabs / .tab',
  description:'在同一上下文里切换同层视图。',
  usage:'健康监测中的体重、血压、睡眠等指标视图。',
  guidance:'保持同层标签稳定。选择状态要清晰，并为内容变化提供可感知的提示。',
  states:DEFAULT,
  code:'<div class="tabs" role="group" aria-label="指标类型">\n  <button class="tab active" type="button" aria-pressed="true">体重</button>\n  <button class="tab" type="button" aria-pressed="false">睡眠</button>\n</div>',
  example:() => `<div class="hub-components-sample-tabs">
    <div class="tabs" role="group" aria-label="示例指标类型">${['体重','睡眠','血压'].map((label,i) => `<button type="button" class="tab${i===0?' active':''}" data-demo-event="tab" aria-pressed="${i===0}">${label}</button>`).join('')}</div>
    <p class="hub-components-demo-status" data-demo-status role="status">当前查看体重记录</p>
   </div>`
 },
 {
  id:'card',category:'layout',name:'内容卡片',icon:'grid',source:'.card / .card-head / .card-title',
  description:'把围绕同一主题的内容和操作放在一起。',
  usage:'健康总览、旅行首页、阅读总览和通用工作台。',
  guidance:'标题说明卡片里有什么。卡片头部适合放一个与该卡片直接相关的入口。',
  states:DEFAULT,
  code:'<section class="card">\n  <div class="card-head"><h2 class="card-title">待办</h2></div>\n  <!-- 填入内容 -->\n</section>',
  example:() => `<section class="card hub-components-sample-card">
    <div class="card-head"><h3 class="card-title">计划中的活动</h3></div>
    <p>周末去附近公园走一走，出发前查看天气。</p>
   </section>`
 },
 {
  id:'drawer',category:'layout',name:'抽屉',icon:'arrow',source:'openDrawer()',
  description:'在保留页面上下文的同时处理编辑和详情。',
  usage:'各工作台的记录表单、设置与卡片管理。',
  guidance:'使用现有抽屉入口，让应用统一处理遮罩、键盘关闭、焦点和未保存编辑。',
  states:[['open','展开'],['closed','收起']],
  code:"openDrawer(body, '编辑记录', '填写记录信息', footer);",
  example:(state,{icon}) => `<div class="hub-components-sample-drawer-stage">
    ${state==='open'?'<div class="hub-components-sample-drawer"><header class="drawer-head"><div><h3>记录详情</h3><p>示例记录</p></div></header><div class="drawer-content">晨间散步 · 30 分钟</div><footer class="drawer-foot"><button type="button" class="btn" data-demo-event="drawer-close">关闭</button></footer></div>':''}
    <button type="button" class="btn primary" data-demo-event="drawer-open">${icon('arrow',15)}打开实际抽屉</button>
   </div>`
 },
 {
  id:'metric',category:'data',name:'指标卡',icon:'metric',source:'.metric-card / .metric-value',
  description:'突出一个数值，同时保留单位和记录时间。',
  usage:'健康总览的体重、运动、睡眠和血压。',
  guidance:'为最新值标出时间。数值缺失时用空值占位，明确区分缺失与零。',
  states:[...DEFAULT,['empty','无记录']],
  code:'<article class="metric-card">\n  <div class="metric-top">最近体重</div>\n  <div class="metric-value">62.4<small>kg</small></div>\n  <div class="metric-bottom">今天 · 最新记录</div>\n</article>',
  example:(state,{icon}) => `<article class="metric-card hub-components-sample-metric">
    <div class="metric-top">最近体重<span class="metric-icon">${icon('scale',16)}</span></div>
    <div class="metric-value">${state==='empty'?'—':'62.4<small>kg</small>'}</div>
    <div class="metric-bottom">${icon('clock',12)}${state==='empty'?'等待第一条记录':'今天 · 最新记录'}</div>
   </article>`
 },
 {
  id:'chart',category:'data',name:'数据图表',icon:'activity',source:'renderComponentCard() / chart',
  description:'用柱状图比较每日数值，用折线图查看趋势。',
  usage:'AI 组件库中的运动汇总、身体指标趋势与阅读汇总模板。',
  guidance:'提供单位和明细。对无记录的日期保留缺口，并为整段缺失的情况准备空状态。',
  states:[['default','柱状图'],['line','折线图'],['missing','缺少部分记录'],['empty','无记录']],
  code:"renderComponentCard({ title: '运动趋势', blocks: [\n  { type: 'chart', chart: 'bar', label: '每日运动', unit: '分钟', points }\n] });",
  example:state => renderComponentCard({
   title:'近 7 天运动',
   blocks:[{type:'chart',chart:['line','missing'].includes(state)?'line':'bar',label:'每日运动时长',unit:'分钟',points:sampleTrend(state)}]
  })
 },
 {
  id:'file-preview',category:'data',name:'文件预览',icon:'file',source:'createFilePreviews() / .file-thumb',
  description:'展示资料缩略图，并从记录打开原件查看器。',
  usage:'健康档案和报告原件，以及工作台资料列表。',
  guidance:'在列表用 thumb() 生成原件入口，通过 open() 打开查看器。PDF 和图片可以生成缩略图，缺少原件时保留提示。',
  states:[['default','文本原件'],['empty','无原件']],
  code:'const previews = createFilePreviews(context);\nconst thumbnail = previews.thumb(file);\nawait previews.open(file);',
  example:(state,{fileThumb}) => state==='empty'?fileThumb(null):
   `<div class="hub-components-sample-actions">${fileThumb({title:'晨间散步.txt',mime:'text/plain'},'')}<button type="button" class="btn" data-demo-event="file-open">查看示例原件</button></div>`
 },
 {
  id:'badge',category:'feedback',name:'状态标签',icon:'check',source:'.pill',
  description:'在记录旁标明状态或分类。',
  usage:'健康就诊、资料关联和待办分类。',
  guidance:'让标签文字说明含义，同时用颜色辅助区分。需要切换状态时提供独立按钮。',
  states:DEFAULT,
  code:'<span class="pill">已关联</span>\n<span class="pill neutral">待整理</span>\n<span class="pill visit">待复查</span>',
  example:() => '<div class="hub-components-sample-actions"><span class="pill">已关联</span><span class="pill neutral">待整理</span><span class="pill visit">待复查</span></div>'
 },
 {
  id:'empty',category:'feedback',name:'空状态与错误反馈',icon:'info',source:'.empty / .load-error-banner',
  description:'解释当前状态，并提供一个可继续的操作。',
  usage:'各工作台的记录列表与加载异常提示。',
  guidance:'区分还没有记录、筛选无结果和加载失败。根据原因给出添加、清除筛选或重试操作。',
  states:[['default','无记录'],['filtered','无筛选结果'],['error','加载失败']],
  code:'<div class="empty"><h3>还没有记录</h3><p>添加第一条记录后会在这里显示。</p></div>',
  example:(state,{icon}) => state==='error'?
   '<div class="load-error-banner" role="alert"><span>没连上服务器，内容还没加载出来</span><button type="button" class="stale-retry" data-demo-event="retry">重试</button></div><p class="hub-components-demo-status" data-demo-status role="status"></p>':
   `<div class="empty">${icon(state==='filtered'?'search':'file',29)}<h3>${state==='filtered'?'没有符合筛选条件的记录':'还没有记录'}</h3><p>${state==='filtered'?'试试换个日期范围。':'添加第一条记录后会在这里显示。'}</p></div>`
 },
 {
  id:'configurable-card',category:'composite',name:'AI 可配置卡片',icon:'sparkles',source:'renderComponentCard() / AI 组件库',
  description:'把指标、图表、列表和进度组合为可复用的卡片。',
  usage:'已发布的卡片可放置到工作台首页，阅读工作台也支持从书架管理。实际放置见下方账号列表。',
  guidance:'使用模板或通过已连接知衡的 AI 创建草稿。选择来源工作台，预览、保存并发布后，到目标工作台管理放置。手机和电脑的放置分别配置。',
  states:[...DEFAULT,['empty','无记录']],
  code:"renderComponentCard({ title: '今日运动', layout: 'grid', blocks: [\n  { type: 'stat', label: '运动时间', value: 42, unit: '分钟' },\n  { type: 'progress', label: '目标', value: 42, target: 60, unit: '分钟' }\n] });",
  example:state => renderComponentCard({
   title:'今日运动',description:'把今天的运动记录和目标放在一起。',layout:'grid',
   appearance:{tone:'tinted'},source:{name:'健康'},space:'demo',
   blocks:[
    {type:'stat',label:'运动时间',unit:'分钟',value:state==='empty'?null:42},
    {type:'stat',label:'记录次数',unit:'次',value:state==='empty'?0:2},
    {type:'progress',label:'今日目标',unit:'分钟',value:state==='empty'?null:42,target:60},
    {type:'list',label:'最近活动',items:state==='empty'?[]:[{title:'午间散步',date:'2026-06-14',detail:'24 分钟'},{title:'晨间拉伸',date:'2026-06-14',detail:'18 分钟'}]}
   ]
  })
 }
];

export function createHubComponents(ctx) {
 const {esc,icon} = ctx;
 const previewContext = {icon,fileThumb:createFilePreviews(ctx).thumb};
 let category = 'all', query = '';

 const url = id => '#'+BASE+(id?'/'+id:'');
 const categoryName = id => CATEGORIES.find(([key]) => key===id)?.[1];
 const componentFor = route => CATALOG.find(item => route===BASE+'/'+item.id);
 const manageButton = () => `<button type="button" class="btn" data-action="component-library">${icon('sparkles',16)}管理 AI 卡片</button>`;
 const filterButton = (id,name) => `<button type="button" data-hub-catalog-filter="${id}" aria-pressed="${category===id}">${name}</button>`;
 const patternLink = item => `<a class="hub-components-pattern" href="${url(item.id)}" data-hub-catalog-pattern="${item.id}">
   <span class="hub-components-mark">${icon(item.icon,22)}</span>
   <span class="hub-components-pattern-copy"><strong>${item.name}</strong><span>${item.description}</span></span>
   <span class="hub-components-pattern-arrow">${icon('arrow',16)}</span>
  </a>`;

 function catalog() {
  return `<div class="hub-components" data-hub-component-catalog>
   <header class="hub-components-heading">
    <div><p class="hub-components-kicker">全局目录</p><h1>组件</h1><p>查看工作台共用的界面元素、交互状态与复用方法。</p></div>
    ${manageButton()}
   </header>
   <div class="hub-components-catalog-tools">
    <div class="hub-components-filters" role="group" aria-label="组件分类">
     ${filterButton('all','全部')}${CATEGORIES.map(([id,name]) => filterButton(id,name)).join('')}
    </div>
    <label class="hub-components-search">${icon('search',17)}<input type="search" data-hub-catalog-search value="${esc(query)}" placeholder="搜索组件" aria-label="搜索组件"></label>
   </div>
   <p class="hub-components-results" data-hub-catalog-count role="status"></p>
   ${CATEGORIES.map(([id,name]) => `<section class="hub-components-group" data-hub-catalog-group aria-labelledby="hub-components-group-${id}"><h2 id="hub-components-group-${id}">${name}</h2><div class="hub-components-grid">${CATALOG.filter(item => item.category===id).map(patternLink).join('')}</div></section>`).join('')}
   <div class="empty hub-components-no-match" data-hub-catalog-empty hidden>${icon('search',27)}<h2>没有找到组件</h2><button type="button" class="btn" data-hub-catalog-reset>清除筛选</button></div>
  </div>`;
 }

 function themes() {
  const workbenches = ctx.workbenches || [];
  return [
   {id:'current',name:'当前工作台'},
   ...workbenches,
   ...THEMES.filter(theme => !workbenches.some(workbench => workbench.id===theme.id))
  ];
 }
 function previewTheme(value) {
  const chosen = value==='current'?themes().find(theme => theme.id===ctx.workbench):themes().find(theme => theme.id===value);
  return workbenchTheme(chosen?.themeColor,chosen?.type);
 }
 function previewOptions(label,id,values) {
  return `<div><label for="hub-component-preview-${id}">${label}</label><select id="hub-component-preview-${id}" data-hub-preview="${id}">${values.map(([value,name]) => `<option value="${esc(value)}">${esc(name)}</option>`).join('')}</select></div>`;
 }

 function libraryPanel() {
  return `<section class="hub-components-library" aria-labelledby="hub-components-library-title">
   <div class="hub-components-panel-heading"><div><h2 id="hub-components-library-title">我的卡片</h2><p>组件库中的卡片与已经配置的工作台放置记录。</p></div>${manageButton()}</div>
   <div class="hub-components-library-body" data-hub-component-library aria-live="polite"></div>
   <div class="hub-components-library-tools"><button class="btn" type="button" data-hub-library-refresh>刷新卡片列表</button></div>
   <details class="hub-components-code"><summary>查看 ${COMPONENT_TEMPLATES.length} 个内置模板</summary><ul class="hub-components-templates">${COMPONENT_TEMPLATES.map(item => `<li><strong>${esc(item.title)}</strong><span>${esc(item.description)}</span></li>`).join('')}</ul></details>
  </section>`;
 }

 function detail(item) {
  const hasLibrary = item.id==='configurable-card';
  return `<div class="hub-components" data-hub-component-detail="${item.id}">
   <a class="hub-components-back" href="${url()}">${icon('arrow',14)}返回组件</a>
   <header class="hub-components-heading hub-components-detail-heading">
    <div><p class="hub-components-kicker">${categoryName(item.category)}</p><h1>${item.name}</h1><p>${item.description}</p></div>
    <span class="hub-components-mark">${icon(item.icon,26)}</span>
   </header>
   <section class="hub-components-preview" aria-labelledby="hub-components-preview-title">
    <div class="hub-components-panel-heading">
     <div><h2 id="hub-components-preview-title">交互预览</h2><p>切换宽度、主题和状态。预览使用示例内容。</p></div>
     <div class="hub-components-preview-tools">
      ${previewOptions('宽度','device',[['desktop','桌面'],['mobile','手机']])}
      ${previewOptions('主题','theme',themes().map(theme => [theme.id,theme.name]))}
      ${item.states.length>1?previewOptions('状态','state',item.states):''}
     </div>
    </div>
    <div class="hub-components-preview-stage" tabindex="0" role="region" aria-label="组件预览画布"><div class="hub-components-preview-frame" data-hub-preview-frame data-device="desktop"><div class="hub-components-preview-caption"><span>示例</span><span data-hub-preview-caption>桌面预览</span></div><div class="hub-components-preview-surface" data-hub-preview-surface>${item.example(item.states[0][0],previewContext)}</div></div></div>
   </section>
   <section class="hub-components-documentation" aria-label="组件用法">
    <div><h2>现有使用位置</h2><p>${item.usage}</p></div>
    <div><h2>使用方式</h2><p>${item.guidance}</p></div>
    <details class="hub-components-code"><summary>查看代码示例 <code>${esc(item.source)}</code></summary><pre><code>${esc(item.code)}</code></pre></details>
   </section>
   ${hasLibrary?libraryPanel():''}
   <section class="hub-components-issues" aria-labelledby="hub-components-issues-title"><h2 id="hub-components-issues-title">关联需求</h2><div data-hub-component-issues aria-live="polite">正在读取关联需求…</div></section>
  </div>`;
 }

 function filterCatalog(view) {
  const needle = query.trim().toLocaleLowerCase();
  let count = 0;
  for (const link of view.querySelectorAll('[data-hub-catalog-pattern]')) {
   const item = CATALOG.find(entry => entry.id===link.dataset.hubCatalogPattern);
   const searchable = [item.name,item.description,item.source,item.usage,categoryName(item.category)].join(' ').toLocaleLowerCase();
   link.hidden = (category!=='all'&&category!==item.category)||!searchable.includes(needle);
   if (!link.hidden) count++;
  }
  for (const group of view.querySelectorAll('[data-hub-catalog-group]')) {
   group.hidden = !group.querySelector('[data-hub-catalog-pattern]:not([hidden])');
  }
  for (const button of view.querySelectorAll('[data-hub-catalog-filter]')) {
   button.setAttribute('aria-pressed',String(button.dataset.hubCatalogFilter===category));
  }
  view.querySelector('[data-hub-catalog-count]').textContent = count+' 个组件';
  view.querySelector('[data-hub-catalog-empty]').hidden = count>0;
 }
 function bindCatalog(view) {
  const search = view.querySelector('[data-hub-catalog-search]');
  search.oninput = () => {query=search.value;filterCatalog(view);};
  view.onclick = event => {
   const filter = event.target.closest('[data-hub-catalog-filter]');
   if (filter) {category=filter.dataset.hubCatalogFilter;filterCatalog(view);}
   if (event.target.closest('[data-hub-catalog-reset]')) {
    category='all';
    query=search.value='';
    filterCatalog(view);
    search.focus();
   }
  };
  filterCatalog(view);
 }
 function bindPreview(view,item) {
  const frame = view.querySelector('[data-hub-preview-frame]');
  const surface = view.querySelector('[data-hub-preview-surface]');
  const device = view.querySelector('[data-hub-preview="device"]');
  const theme = view.querySelector('[data-hub-preview="theme"]');
  const state = view.querySelector('[data-hub-preview="state"]');
  const applyTheme = target => {
   for (const [name,value] of Object.entries(previewTheme(theme.value))) target.style.setProperty(name,value);
  };
  device.onchange = () => {
   frame.dataset.device = device.value;
   frame.querySelector('[data-hub-preview-caption]').textContent = device.value==='mobile'?'手机预览':'桌面预览';
  };
  if (matchMedia('(max-width: 600px)').matches) {
   device.value='mobile';
   device.onchange();
  }
  theme.onchange = () => applyTheme(frame);
  applyTheme(frame);
  if (state) state.onchange = () => {surface.innerHTML=item.example(state.value,previewContext);};
  surface.onclick = event => {
   const trigger = event.target.closest('[data-demo-event]');
   if (!trigger) return;
   const demo = trigger.dataset.demoEvent;
   if (demo==='drawer-open'||demo==='file-open') {
    const close = '<button type="button" class="btn primary" data-action="close">完成</button>';
    if (demo==='drawer-open') ctx.openDrawer('<p class="section-desc">晨间散步 · 30 分钟</p>','记录详情','抽屉组件预览',close);
    else ctx.openDrawer('<div class="preview-meta">晨间散步.txt · 示例文件</div><div class="original-viewer"><pre class="report-text reader-page-text">晨间散步\n\n日期 2026-06-14\n运动时长 30 分钟</pre></div>','晨间散步.txt','原件查看器预览',close);
    const drawer = document.querySelector('#overlay .drawer');
    if (drawer) applyTheme(drawer);
    return;
   }
   if (demo==='drawer-close' && state) {
    state.value='closed';
    state.onchange();
    surface.querySelector('[data-demo-event="drawer-open"]')?.focus();
    return;
   }
   const status = surface.querySelector('[data-demo-status]');
   if (!status) return;
   if (demo==='tab') {
    for (const tab of surface.querySelectorAll('[data-demo-event="tab"]')) {
     tab.classList.toggle('active',tab===trigger);
     tab.setAttribute('aria-pressed',String(tab===trigger));
    }
    status.textContent = '当前查看'+trigger.textContent+'记录';
   } else {
    status.textContent = {save:'示例按钮已触发保存',cancel:'示例按钮已触发取消',edit:'示例按钮已触发编辑',retry:'示例重试成功'}[demo]||'';
   }
  };
 }

 function libraryCards(items) {
  if (!items.length) return '<p class="hub-components-library-note">组件库还没有卡片。打开管理入口可以从模板创建卡片。</p>';
  return `<ul class="hub-components-library-list">${items.map(card => {
   const status = card.archived?'已归档':card.publishedRevision?(card.hasDraftChanges?'有未发布修改':'已发布'):'草稿';
   const placements = card.usage?.map(entry => {
    const devices = [entry.devices?.includes('desktop')?'电脑':'',entry.devices?.includes('mobile')?'手机':''].filter(Boolean).join('、');
    return `<li>${esc(entry.workbenchName)} · ${entry.page==='dashboard'?'首页':esc(entry.page)}${devices?' · '+devices:''}</li>`;
   }).join('');
   return `<li class="hub-components-library-card"><div><h3>${esc(card.title)} <span class="pill neutral">${status}</span></h3><p>来源工作台 ${esc(card.sourceName)} · 版本 ${esc(card.revision)}</p>
    ${placements?`<p>已有放置配置</p><ul class="hub-components-placements">${placements}</ul>`:'<p>尚无放置配置</p>'}</div>
    ${UUID.test(card.id)?`<button type="button" class="btn" data-action="component-open:${card.id}">查看与编辑</button>`:''}
   </li>`;
  }).join('')}</ul>`;
 }
 function bindLibrary(view) {
  const target = view.querySelector('[data-hub-component-library]');
  if (!target) return;
  const refresh = view.querySelector('[data-hub-library-refresh]');
  async function loadLibrary() {
   refresh.disabled=true;
   target.setAttribute('aria-busy','true');
   target.textContent='正在读取卡片…';
   await readOwned(target,'/api/components','卡片',data => libraryCards(data.components||[]));
   refresh.disabled=false;
   target.removeAttribute('aria-busy');
  }
  refresh.onclick=loadLibrary;
  loadLibrary();
 }
 async function readOwned(target,path,label,html) {
  const owner = ctx.userId || null;
  const workbench = ctx.workbench;
  const space = ctx.space;
  const active = () => target.isConnected && (ctx.userId||null)===owner && ctx.workbench===workbench && ctx.space===space;
  try {
   const data = await ctx.api(path,{headers:{'X-Workbench-Owner':owner||''}},space,workbench);
   if (!active()) return;
   if (data.owner!==owner) throw new Error('登录账号已变化，请重新打开页面');
   target.innerHTML=html(data);
  } catch (error) {
   if (active()) target.innerHTML=`<div class="load-error-banner" role="alert">暂时无法读取${label}。 ${esc(error.message)}</div>`;
  }
 }
 function bindIssues(view,item) {
  const target = view.querySelector('[data-hub-component-issues]');
  readOwned(target,'/api/developer-hub/issues','关联需求',data => {
   const issues = (data.issues||[]).filter(issue => Array.isArray(issue.componentIds)&&issue.componentIds.includes(item.id)&&UUID.test(issue.id));
   if (!issues.length) return '<p>还没有与此组件关联的需求。</p>';
   return `<ul>${issues.map(issue => `<li><a href="#development/issues/${issue.id}">#${esc(issue.number)} ${esc(issue.title)}</a></li>`).join('')}</ul>`;
  });
 }
 return {
  render(route) {
   const item = componentFor(route);
   return item ? detail(item) : catalog();
  },
  bind(root,route) {
   const item = componentFor(route);
   const view = root.querySelector(item?'[data-hub-component-detail]':'[data-hub-component-catalog]');
   if (!view) return;
   if (!item) {bindCatalog(view);return;}
   bindPreview(view,item);
   bindLibrary(view);
   bindIssues(view,item);
  }
 };
}
