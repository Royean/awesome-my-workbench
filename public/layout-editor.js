import {LAYOUT_WIDGETS, defaultLayoutConfig, applyLayoutChanges} from './layout-config.js';

const clone=value=>structuredClone(value);
const selectors={trend:'.health-trend',bodyMetrics:'.health-body-metrics',water:'.health-water',tasks:'.health-tasks',exercise:'.health-exercise',meals:'.health-meals',visits:'.health-visits',reports:'.health-reports',medications:'.health-medication-summary'};
const validPreview=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
const initialQuery=new URLSearchParams(location.search);

export function createLayoutUI(ctx){
 const {esc,icon}=ctx, media=matchMedia('(max-width:900px)');
 let snapshot=null,editor=null,preview=null,returnDraft=null,previewError='',pendingPreview=initialQuery.get('layoutPreview'),generation=0,operation=0,busyOwner=0,busy=false,pendingKind='',previewLoading=false,trendKey='',savedTrend=null,refreshing=false;
 const defaultTrends={mobile:{metric:'weight',range:14},desktop:{metric:'weight',range:14}};
 const isFrame=window.self!==window.top&&initialQuery.get('layoutFrame')==='1'&&validPreview(initialQuery.get('layoutPreview'));
 if(isFrame)document.body.classList.add('layout-preview-frame-page');
 const device=()=>media.matches?'mobile':'desktop';
 const owner=()=>ctx.userId||null;
 let trendOwner=owner();
 const context=()=>`${generation}:${owner()||'local'}:${ctx.workbench}:${ctx.route}`;
 const active=key=>ctx.ready&&ctx.workbench==='health'&&key===context();
 const view=()=>preview||snapshot;
 const config=()=>view()?.config||defaultLayoutConfig();
 const options=id=>{const selected=config()[device()];return selected.mode==='custom'?selected.widgets.find(w=>w.id===id)?.options||{}:{};};
 const api=(path,options={})=>ctx.api(path,{...options,headers:{...options.headers,'X-Workbench-Owner':owner()||''}},ctx.space,'health');
 const lock=(kind,token)=>{busyOwner=token;busy=true;pendingKind=kind;};
 const unlock=token=>{if(busyOwner!==token)return false;busyOwner=0;busy=false;pendingKind='';return true;};
 const button=(label,action,primary=false,disabled=false)=>`<button type="button" class="btn ${primary?'primary':''}" data-action="${action}" ${disabled?'disabled':''}>${label}</button>`;
 const comparable=d=>JSON.stringify({config:d.config,themeColor:d.themeColor.toUpperCase()});
 const changed=()=>editor&&comparable(editor.draft)!==comparable(editor.base);
 const stale=()=>preview&&(preview.baseRevision??preview.revision)!==snapshot?.revision;
 const expired=()=>preview&&Date.parse(preview.expiresAt)<=Date.now();
 const clearURL=()=>{const url=new URL(location.href);for(const key of ['layoutPreview','layoutFrame','layoutDevice'])url.searchParams.delete(key);history.replaceState(null,'',url.pathname+url.search+url.hash);};
 const setURL=(id,target)=>{const url=new URL(location.href);url.searchParams.set('layoutPreview',id);url.searchParams.set('layoutDevice',target);url.hash='dashboard';history.replaceState(null,'',url.pathname+url.search+url.hash);};
 function clearPreview(){operation++;previewLoading=false;if(savedTrend)ctx.setTrend(savedTrend.metric,savedTrend.range);savedTrend=null;preview=null;previewError='';pendingPreview=null;returnDraft=null;trendKey='';clearURL();}
 function cleanup({keepLink=false,resetSnapshot=true}={}){generation++;operation++;editor=null;busy=false;busyOwner=0;pendingKind='';previewLoading=false;if(savedTrend)ctx.setTrend(savedTrend.metric,savedTrend.range);savedTrend=null;preview=null;returnDraft=null;previewError='';trendKey='';if(keepLink)pendingPreview=new URLSearchParams(location.search).get('layoutPreview');else{pendingPreview=null;clearURL();}if(resetSnapshot)snapshot=null;}
 function setSnapshot(next){if(trendOwner!==owner()){trendOwner=owner();defaultTrends.mobile={metric:'weight',range:14};defaultTrends.desktop={metric:'weight',range:14};trendKey='';}snapshot=next?.workbench==='health'&&next.owner===owner()?next:null;}
 function beforeRender(){
  if(ctx.workbench!=='health'||ctx.route!=='dashboard')return;
  const prefs=options('trend'),key=JSON.stringify([snapshot?.owner,snapshot?.revision,preview?.previewId,device(),prefs]);
  if(key!==trendKey){trendKey=key;const selected=config()[device()].mode==='custom'?prefs:defaultTrends[device()];ctx.setTrend(selected.metric,selected.range);}
 }
 function mount(){
  if(ctx.workbench!=='health'||ctx.route!=='dashboard')return;
  const root=document.querySelector('.health-overview');if(!root)return;
  const heading=root.querySelector('.health-overview-heading'),title=heading?.querySelector('h1');
  if(title){const line=document.createElement('div');line.className='layout-overview-title';title.before(line);line.append(title);line.insertAdjacentHTML('beforeend',`<button class="btn layout-edit-entry" data-action="layout-edit">${icon('grid',15)}编辑布局</button>`);}
  if(preview)ctx.previewTheme(preview.themeColor);
  const selected=config()[device()];
  if(selected.mode==='custom'){
   const nodes=new Map(LAYOUT_WIDGETS.map(w=>[w.id,root.querySelector(selectors[w.id])]));
   const canvas=document.createElement('div');canvas.className='layout-canvas';canvas.dataset.device=device();canvas.setAttribute('aria-label','自定义健康首页布局');
   for(const w of selected.widgets){const node=nodes.get(w.id);if(!node||!w.visible)continue;node.dataset.layoutWidget=w.id;node.dataset.layoutSize=w.size;node.classList.add('layout-widget');canvas.append(node);}
   root.querySelector('.health-bento')?.remove();root.querySelector('.health-medication-summary')?.remove();root.append(canvas);
   if(!canvas.children.length)canvas.innerHTML=`<div class="layout-empty"><h2>首页卡片已全部隐藏</h2><p>记录仍保存在各模块中，可以随时重新显示卡片。</p>${button('编辑布局','layout-edit',true)}</div>`;
  }
  if((preview||previewError||previewLoading)&&!isFrame){
   const banner=document.createElement('section');banner.className='layout-preview-banner';banner.setAttribute('aria-label','布局预览状态');
   const invalid=stale()||expired(),target=preview?.device||device();
   banner.innerHTML=`<div><strong>${previewLoading?'正在打开布局预览…':previewError?'布局预览需要处理':`${target==='mobile'?'手机':'电脑'}布局预览 · 尚未应用`}</strong><p>${esc(previewError||(invalid?'当前布局已更新或预览已过期，可继续编辑或退出预览。':'正在查看实际卡片，应用后才会保存到你的工作台。'))}</p></div><div class="layout-preview-actions">${preview?button('继续编辑','layout-preview-edit',false,busy):''}${preview?button(busy?'正在应用…':'应用布局','layout-preview-apply',true,invalid||busy):''}${button('退出预览','layout-preview-exit',false,busy&&pendingKind==='save')}</div>`;
   root.before(banner);
   if(preview&&target!==device()){
    root.hidden=true;
    const width=target==='mobile'?390:1440,height=target==='mobile'?844:1000,url=new URL(location.href);url.searchParams.set('layoutPreview',preview.previewId);url.searchParams.set('layoutFrame','1');url.searchParams.delete('layoutDevice');
    const wrapper=document.createElement('div');wrapper.className='layout-device-frame';wrapper.setAttribute('aria-label',target==='mobile'?'手机尺寸预览':'电脑尺寸预览');root.before(wrapper);
    const available=wrapper.clientWidth||document.querySelector('main').clientWidth,scale=Math.min(1,available/width);wrapper.style.height=`${height*scale}px`;
    const frame=document.createElement('iframe');frame.title=target==='mobile'?'手机布局预览':'电脑布局预览';frame.src=url.pathname+url.search+'#dashboard';frame.width=String(width);frame.height=String(height);frame.style.width=`${width}px`;frame.style.height=`${height}px`;frame.style.transform=`scale(${scale})`;wrapper.append(frame);
   }
  }
 }
 async function initializePreview(){
  if(!pendingPreview||ctx.workbench!=='health'||!ctx.ready)return;
  const id=pendingPreview;pendingPreview=null;const key=context();previewLoading=true;ctx.render();
  if(!validPreview(id)){previewLoading=false;previewError='预览链接无效，可以退出后编辑当前布局。';ctx.render();return;}
  try{const data=await api('/api/layout/preview/'+encodeURIComponent(id));if(!active(key)||!previewLoading)return;if(data.owner!==owner())return;const target=initialQuery.get('layoutDevice'),inferred=data.affectedDevices?.length===1?data.affectedDevices[0]:device();savedTrend=ctx.getTrend();preview={...data,device:isFrame?device():['mobile','desktop'].includes(target)?target:inferred};}
  catch(error){if(active(key)&&previewLoading)previewError=error.message;}
  finally{if(active(key)&&previewLoading){previewLoading=false;ctx.render();}}
 }
 function changes(){
  const out={};if(editor.draft.themeColor.toUpperCase()!==editor.base.themeColor.toUpperCase())out.themeColor=editor.draft.themeColor;
  for(const d of ['desktop','mobile'])if(JSON.stringify(editor.draft.config[d])!==JSON.stringify(editor.base.config[d])){
   const view=editor.draft.config[d],base=editor.base.config[d];
   if(view.mode==='default'){out[d]={reset:true};continue;}
   const patch={},ids=view.widgets.map(w=>w.id);
   if(base.mode!==view.mode||JSON.stringify(ids)!==JSON.stringify(base.widgets.map(w=>w.id)))patch.order=ids;
   const widgets=[];
   for(const w of view.widgets){const before=base.widgets.find(x=>x.id===w.id),delta={id:w.id};for(const field of ['size','visible'])if(w[field]!==before[field])delta[field]=w[field];
    const options={};for(const [field,value]of Object.entries(w.options||{}))if(value!==before.options?.[field])options[field]=value;if(Object.keys(options).length)delta.options=options;if(Object.keys(delta).length>1)widgets.push(delta);}
   if(widgets.length)patch.widgets=widgets;if(Object.keys(patch).length)out[d]=patch;
  }
  return out;
 }
 function errorText(error){const box=document.querySelector('#layout-editor-error');if(box){box.textContent=error.message;box.hidden=false;if(error.code==='layout_conflict')box.insertAdjacentHTML('beforeend',button('读取最新并保留我的调整','layout-reload'));}else ctx.toast(error.message);}
 function editorBody(){
  const d=editor.device,selected=editor.draft.config[d],canRestore=editor.base.history?.some(h=>h.revision<editor.base.revision);
  const sizeLabels=d==='mobile'?{small:'半宽',medium:'标准',large:'舒展'}:{small:'紧凑',medium:'半宽',large:'通栏'};
  return `<form id="layout-editor-form" data-discard-guard><input type="hidden" name="layout-draft" value="${esc(comparable(editor.base))}"><div class="layout-device-tabs" role="group" aria-label="编辑哪种设备">${['mobile','desktop'].map(name=>`<button type="button" data-action="layout-device:${name}" aria-pressed="${d===name}">${icon(name==='mobile'?'grid':'building',17)}${name==='mobile'?'手机':'电脑'}布局</button>`).join('')}</div><p class="layout-editor-intro">${d==='mobile'?'只调整手机的卡片排列。半宽卡片可并排，舒展卡片增加留白。':'只调整电脑的卡片排列。紧凑、半宽和通栏分别使用不同宽度。'}个人与示例空间共用布局。</p><div class="layout-editor-toolbar"><span>${selected.mode==='default'?'默认排列':'自定义排列'} · ${selected.widgets.filter(w=>w.visible).length} 张可见卡片</span>${button('恢复此设备默认','layout-reset')}</div><div class="layout-widget-list">${selected.widgets.map((w,index)=>{const def=LAYOUT_WIDGETS.find(x=>x.id===w.id);return `<section class="layout-widget-row ${w.visible?'':'is-hidden'}" data-widget-row="${w.id}"><div class="layout-widget-row-head"><label><input type="checkbox" data-layout-visible="${w.id}" ${w.visible?'checked':''}><strong>${esc(def.title)}</strong></label><div class="layout-order-buttons"><button type="button" class="icon-btn" data-action="layout-up:${w.id}" aria-label="上移${esc(def.title)}" ${index===0?'disabled':''}>↑</button><button type="button" class="icon-btn" data-action="layout-down:${w.id}" aria-label="下移${esc(def.title)}" ${index===selected.widgets.length-1?'disabled':''}>↓</button></div></div><div class="layout-widget-settings"><label>大小<select data-layout-size="${w.id}" aria-label="${esc(def.title)}卡片大小">${def.sizes[d].map(size=>`<option value="${size}" ${size===w.size?'selected':''}>${sizeLabels[size]}</option>`).join('')}</select></label>${w.id==='trend'?`<label>监测项目<select data-layout-option="trend:metric" aria-label="趋势监测项目">${Object.entries({weight:'体重',pressure:'血压',sleep:'睡眠',glucose:'血糖',heart:'静息心率'}).map(([value,title])=>`<option value="${value}" ${(w.options?.metric||'weight')===value?'selected':''}>${title}</option>`).join('')}</select></label><label>时间范围<select data-layout-option="trend:range" aria-label="趋势时间范围">${[7,14,30].map(value=>`<option value="${value}" ${(w.options?.range||14)===value?'selected':''}>近${value}天</option>`).join('')}</select></label>`:w.id==='tasks'?`<label>显示数量<select data-layout-option="tasks:limit" aria-label="待办显示数量">${[1,2,3,4,5,6,7,8].map(value=>`<option value="${value}" ${(w.options?.limit||5)===value?'selected':''}>${value}项</option>`).join('')}</select></label>`:''}</div></section>`;}).join('')}</div><div class="layout-theme-field"><label for="layout-theme">健康工作台主题色</label><div><input id="layout-theme" type="color" value="${esc(editor.draft.themeColor)}"><span>${esc(editor.draft.themeColor)}</span></div><small>电脑、手机与健康模块共用；预览时不会保存。</small></div><details class="layout-history"><summary>历史版本 · 当前版本 ${editor.base.revision}</summary><p>恢复版本会同时恢复当时的双端布局和主题色。</p><div class="layout-history-actions"><select id="layout-history-revision" aria-label="选择历史布局版本" ${canRestore?'':'disabled'}>${(editor.base.history||[]).filter(h=>h.revision<editor.base.revision).map(h=>`<option value="${h.revision}">版本 ${h.revision} · ${esc((h.summary||[]).join('、'))}</option>`).join('')||'<option>还没有历史版本</option>'}</select>${button('恢复所选版本','layout-restore',false,!canRestore)}</div></details><details class="layout-ai-help"><summary>让 AI 帮我调整</summary><p>向已连接知衡的 AI 描述需求，例如：把手机的饮水卡片放最前，隐藏运动，电脑保持原样。</p><p>AI 可读取组件与布局，创建预览、应用修改或恢复版本；新工具需要连接端刷新工具列表。</p></details><div id="layout-editor-error" class="form-error" role="alert" hidden></div></form>`;
 }
 function drawEditor({scrollTop,focus}={}){
  ctx.openDrawer(editorBody(),'编辑健康首页','分别管理手机和电脑的布局',`${button('取消','close')}${button('预览','layout-preview',false,!changed())}${button('应用布局','layout-save',true,!changed())}`);
  const form=document.querySelector('#layout-editor-form');form.elements['layout-draft'].value=comparable(editor.draft);form.onsubmit=e=>e.preventDefault();
  form.onchange=e=>{
   try{
    const input=e.target;let patch;
    if(input.dataset.layoutVisible)patch={widgets:[{id:input.dataset.layoutVisible,visible:input.checked}]};
    if(input.dataset.layoutSize)patch={widgets:[{id:input.dataset.layoutSize,size:input.value}]};
    if(input.dataset.layoutOption){const [id,name]=input.dataset.layoutOption.split(':');patch={widgets:[{id,options:{[name]:name==='metric'?input.value:Number(input.value)}}]};}
    if(input.id==='layout-theme')changeDraft({themeColor:input.value});
    else if(patch)changeDraft({[editor.device]:patch});
   }catch(error){errorText(error);}
  };
  if(scrollTop!==undefined)document.querySelector('.drawer-content').scrollTop=scrollTop;
  if(focus)document.querySelector(focus)?.focus({preventScroll:true});
 }
 function focusSelector(){const node=document.activeElement;if(!node)return null;if(node.id)return '#'+CSS.escape(node.id);for(const name of ['data-layout-visible','data-layout-size','data-layout-option','data-action'])if(node.hasAttribute(name))return `[${name}="${CSS.escape(node.getAttribute(name))}"]`;return null;}
 function changeDraft(patch){const next=applyLayoutChanges(editor.draft.config,editor.draft.themeColor,patch);editor.draft={...editor.draft,config:next.config,themeColor:next.themeColor};const scrollTop=document.querySelector('.drawer-content')?.scrollTop||0,focus=focusSelector();drawEditor({scrollTop,focus});}
 async function open(){
  if(ctx.workbench!=='health')return;const key=context(),data=await api('/api/layout');if(!active(key)||data.owner!==owner())return;snapshot=data;editor={base:clone(data),draft:clone(data),device:device()};drawEditor();
 }
 async function applied(data,key){if(!active(key))return;clearPreview();editor=null;snapshot=data;ctx.closeDrawer();ctx.invalidateCache();await ctx.load();if(active(key))ctx.toast('布局已应用，可在历史版本中恢复');}
 async function write(path,body){
  if(busy)return;const key=context(),token=++operation,form=document.querySelector('#layout-editor-form'),previewId=preview?.previewId;lock('save',token);
  document.querySelectorAll('#layout-editor-form input,#layout-editor-form select,#layout-editor-form button,.drawer-foot button,.layout-preview-actions button').forEach(b=>b.disabled=true);
  try{const data=await api(path,{method:'POST',body:JSON.stringify(body)});if(!active(key))return;
   if(operation!==token||(form&&!form.isConnected)||(!form&&preview?.previewId!==previewId)){ctx.invalidateCache();ctx.toast('布局已保存，刷新后可查看');return;}
   unlock(token);await applied(data,key);
  }
  catch(error){if(active(key)&&operation===token){errorText(error);if(preview){previewError=error.message;if(error.code==='layout_conflict'){try{const latest=await api('/api/layout');if(active(key)&&operation===token)snapshot=latest;}catch{}}if(active(key)&&operation===token)ctx.render();}}}
  finally{if(unlock(token)){if(active(key)&&form?.isConnected){document.querySelectorAll('#layout-editor-form input,#layout-editor-form select,#layout-editor-form button,.drawer-foot button').forEach(b=>b.disabled=false);if(editor){const top=document.querySelector('.drawer-content')?.scrollTop||0;const message=document.querySelector('#layout-editor-error')?.textContent,conflict=Boolean(document.querySelector('[data-action="layout-reload"]'));drawEditor({scrollTop:top});if(message)errorText(Object.assign(new Error(message.replace('读取最新并保留我的调整','')),{code:conflict?'layout_conflict':undefined}));}}if(active(key)&&preview)ctx.render();}}
 }
 async function handle(action,arg){
  if(isFrame)return;
  if(action==='layout-edit'){if(preview)return handle('layout-preview-edit');return open();}
  if(action==='layout-preview-exit'){if(busy&&pendingKind==='save')return;clearPreview();ctx.render();await ctx.load({retainOnError:true});return;}
  if(action==='layout-preview-edit'){
   if(!preview||busy)return;
   const draft=returnDraft||{base:clone(snapshot),draft:clone(preview),device:preview.device||device()};clearPreview();ctx.render();editor=draft;drawEditor();if(draft.base.revision!==snapshot?.revision)errorText(Object.assign(new Error('当前布局已更新，你的草稿仍保留。请读取最新布局再应用。'),{code:'layout_conflict'}));return;
  }
  if(action==='layout-preview-apply'){if(preview&&!stale()&&!expired())await write('/api/layout',{expectedRevision:preview.baseRevision??preview.revision,previewId:preview.previewId});return;}
  if(!editor||!document.querySelector('#layout-editor-form')||busy)return;
  if(action==='layout-device'){if(['mobile','desktop'].includes(arg)){editor.device=arg;drawEditor({focus:`[data-action="layout-device:${arg}"]`});}return;}
  if(action==='layout-reload'){
   const key=context(),patch=changes(),target=editor.device,form=document.querySelector('#layout-editor-form'),token=++operation;const data=await api('/api/layout');if(!active(key)||!form?.isConnected||token!==operation)return;
   const next=Object.keys(patch).length?applyLayoutChanges(data.config,data.themeColor,patch):{config:data.config,themeColor:data.themeColor};snapshot=data;editor={base:clone(data),draft:{...clone(data),config:next.config,themeColor:next.themeColor},device:target};drawEditor();const note=document.querySelector('#layout-editor-error');note.textContent='已读取最新布局并保留你的调整，请检查后预览或应用。';note.hidden=false;return;
  }
  if(action==='layout-reset'){changeDraft({[editor.device]:{reset:true}});return;}
  if(action==='layout-up'||action==='layout-down'){
   const list=editor.draft.config[editor.device].widgets.map(w=>w.id),i=list.indexOf(arg),j=i+(action==='layout-up'?-1:1);if(i<0||j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];changeDraft({[editor.device]:{order:list}});return;
  }
  if(action==='layout-save'){if(changed())await write('/api/layout',{expectedRevision:editor.base.revision,changes:changes()});return;}
  if(action==='layout-restore'){
   if(changed()){errorText(new Error('请先应用当前修改，或取消后重新打开，再恢复历史版本。'));return;}
   const revision=Number(document.querySelector('#layout-history-revision')?.value);if(Number.isSafeInteger(revision))await write('/api/layout/restore',{expectedRevision:editor.base.revision,revision});return;
  }
  if(action==='layout-preview'&&changed()){
   const key=context(),draft=editor,form=document.querySelector('#layout-editor-form'),token=++operation;lock('preview',token);document.querySelectorAll('.drawer-foot button').forEach(b=>b.disabled=true);
   try{const result=await api('/api/layout/preview',{method:'POST',body:JSON.stringify({expectedRevision:editor.base.revision,changes:changes()})});if(!active(key)||token!==operation||!form?.isConnected)return;unlock(token);ctx.closeDrawer();returnDraft=draft;savedTrend=ctx.getTrend();preview={...result,device:draft.device};setURL(result.previewId,draft.device);ctx.enterDashboard();ctx.render();}
   catch(error){if(active(key)&&token===operation&&form?.isConnected)errorText(error);}
   finally{if(unlock(token)&&form?.isConnected)document.querySelectorAll('.drawer-foot button').forEach(b=>b.disabled=false);}
  }
 }
 async function refresh(){
  if(refreshing||!ctx.ready||ctx.workbench!=='health'||ctx.route!=='dashboard'||document.hidden||document.querySelector('.drawer')||preview||previewError||busy)return;
  const key=context();refreshing=true;try{const data=await api('/api/layout');if(active(key)&&data.owner===owner()&&(data.revision!==snapshot?.revision||data.themeColor!==snapshot?.themeColor)){ctx.invalidateCache();await ctx.load({retainOnError:true});}}catch{}finally{refreshing=false;}
 }
 media.addEventListener('change',()=>{if(ctx.ready&&ctx.workbench==='health'&&ctx.route==='dashboard')ctx.render();});
 window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);setInterval(refresh,30000);
 const guardClose=()=>{if(busy&&pendingKind==='save'){ctx.toast('正在保存布局，请稍候');return true;}return false;};
 const rememberTrend=(metric,range)=>{if(!preview&&config()[device()].mode==='default')defaultTrends[device()]={metric,range};};
 return {setSnapshot,beforeRender,mount,options,handle,cleanup,initializePreview,rememberTrend,guardClose,isBusy:()=>busy,isFrame:()=>isFrame,isPreview:()=>Boolean(preview||previewError||previewLoading||pendingPreview),onDrawerClose:()=>{operation++;if(pendingKind==='preview')unlock(busyOwner);editor=null;},refresh};
}
