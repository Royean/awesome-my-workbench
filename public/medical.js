import { renderReportObservations } from './report-data.js';
import { institutionMark } from './provider-ui.js';
import { showFieldError, aiTag } from './request.js';
export function createMedical(ctx){
 const {icon,esc,field,select,btn,previews}=ctx;
 let view='visits',section='overview',search='',status='all',doseDate='',fileDate='',activeId=null;
 const all=k=>ctx.items.filter(x=>x.kind===k),find=id=>ctx.items.find(x=>x.id===id);
 const sort=a=>[...a].sort((a,b)=>(b.date+(b.time||'')).localeCompare(a.date+(a.time||'')));
 const badge=(text,cls='')=>`<span class="pill ${cls}">${esc(text)}</span>`;
 const visitLink=id=>{const v=find(id);return v?`<button class="text-btn visit-link" data-action="med-open:${id}">${icon('visit',12)} ${esc(v.title)} · ${v.date} ${icon('arrow',11)}</button>`:id?`<small class="muted visit-gone">${(ctx.trashedIds||[]).includes(id)?'就诊已删除 · 可在最近删除恢复':'就诊已删除'}</small>`:''};
 const titleAction=(label,action,ic='plus')=>btn(label,action,'',ic);
 const actions=(x,extra='')=>`<div class="row-actions">${extra}<button class="icon-btn" data-action="${['medication','report','dose'].includes(x.kind)?'med-edit':'edit'}:${x.id}" aria-label="编辑${esc(x.title)}">${icon('edit',15)}</button><button class="icon-btn" data-action="delete:${x.id}" aria-label="删除${esc(x.title)}">${icon('trash',15)}</button></div>`;
 const panelEmpty=(ic,title,text,action,label)=>`<div class="medical-empty">${icon(ic,29)}<h3>${title}</h3><p>${text}</p>${action?btn(label,action,'','plus'):''}</div>`;
 const card=(title,count,action,content)=>`<section class="card medical-section"><div class="card-head"><h2 class="card-title">${title}<span class="subtitle">${count}</span></h2>${action||''}</div>${content}</section>`;
 const textarea=(label,name,value='',placeholder='')=>`<div class="field"><label for="medical-${name}">${label}</label><textarea id="medical-${name}" name="${name}" maxlength="${name==='content'?20000:8000}" placeholder="${esc(placeholder)}">${esc(value)}</textarea></div>`;
 function visitOptions(selected=''){const opts=[['','请选择关联就诊'],...sort(all('visit')).map(v=>[v.id,`${v.date} · ${v.title}`])];if(selected&&!find(selected))opts.push([selected,'原就诊已移除（保留关联）']);return opts;}
 function tabs(){return `<div class="medical-view-tabs">${[['visits','全部就诊',all('visit').length],['medications','用药管理',all('medication').length],['reports','报告与资料',null]].map(([v,l,n])=>`<button class="${view===v||(v==='reports'&&['files','inbox'].includes(view))?'active':''}" data-action="med-view:${v}">${l}${n===null?'':`<span>${n}</span>`}</button>`).join('')}</div>`;}
 function resourceTabs(){return ['reports','files','inbox'].includes(view)?`<div class="resource-tabs" aria-label="报告与资料分类">${[['reports','报告文字',all('report').length],['files','全部原件',all('file').length],['inbox','待整理',all('file').filter(f=>!ctx.fileIsLinked(f)).length]].map(([v,n,c])=>`<button class="${view===v?'active':''}" data-action="med-view:${v}" aria-pressed="${view===v}">${n}<span>${c}</span></button>`).join('')}</div>`:'';}
 function fileContent(){const pending=view==='inbox';const files=sort(all('file').filter(f=>(!pending||!ctx.fileIsLinked(f))&&(!fileDate||f.date===fileDate)&&`${f.title} ${f.name||''} ${f.note||''}`.toLowerCase().includes(search.toLowerCase())));return `<p class="section-desc">${pending?'尚未关联的原件放在这里，可稍后关联到就诊报告。':'点击缩略图查看原件，点击「查看就诊报告」阅读报告文字。'}</p><section class="card"><div class="record-list medical-resource-list">${files.length?ctx.recordRows(files):panelEmpty('file',pending?'暂无待整理资料':'没有匹配的原件','可以先保存原件，再按需要关联就诊。','add:file','上传资料')}</div></section>`;}
 function render(){const route=location.hash.split('/')[1],viewRoute=['reports','medications','files','inbox'].includes(route);if(viewRoute)view=route;else if(!route)view='visits';activeId=route&&!viewRoute&&find(route)?.kind==='visit'?route:null;if(route&&!viewRoute&&!activeId)return `<div class="card">${panelEmpty('visit','找不到这次就诊','记录可能已被移除，关联资料仍可从就诊管理中查找。','med-view:visits','返回就诊管理')}</div>`;if(activeId)return detail(find(activeId));if(['files','inbox'].includes(view)&&ctx.originals)return `${tabs()}${resourceTabs()}${ctx.originals.render({title:view==='inbox'?'待整理原件':'资料原件',defaultStatus:view==='inbox'?'unlinked':'all'})}`;return `${tabs()}${resourceTabs()}<div class="filters"><div class="searchbox">${icon('search',15)}<input id="medical-search" aria-label="搜索就诊内容" placeholder="搜索${view==='visits'?'就诊、医院或科室':view==='medications'?'药名或用药备注':['files','inbox'].includes(view)?'原件名称或备注':'报告标题或来源'}…" value="${esc(search)}"></div><div class="medical-filter-tools">${['files','inbox'].includes(view)?`<input id="medical-file-date" class="filter-input" type="date" value="${fileDate}" aria-label="筛选原件日期">`:''}${view==='medications'?`<input id="med-dose-date" class="filter-input" type="date" value="${doseDate||ctx.today}" max="${ctx.today}" aria-label="查看用药日期">`:''}${view==='visits'?`<select id="medical-status" class="filter-input" aria-label="就诊状态"><option value="all">全部状态</option>${['待就诊','已完成','待复查'].map(s=>`<option ${s===status?'selected':''}>${s}</option>`).join('')}</select>`:''}${view==='visits'?'':btn(['files','inbox'].includes(view)?'上传资料':view==='medications'?'添加用药方案':'添加报告',['files','inbox'].includes(view)?'add:file':view==='medications'?'med-new-medication':'med-new-report','primary','plus')}</div></div><div id="medical-list">${listContent()}</div>`}
 function listContent(){if(['files','inbox'].includes(view))return fileContent();if(view==='visits'){const vs=sort(all('visit')).filter(x=>(status==='all'||x.status===status)&&`${x.title} ${x.hospital||''} ${x.city||''} ${x.department||''}`.includes(search));return `<div class="visit-cards minimal-visit-list">${vs.length?vs.map(v=>{const n=k=>all(k).filter(x=>x.visitId===v.id).length;return `<article class="visit-row">${institutionMark(v,{esc,icon})}<div class="visit-row-main"><button class="visit-card-title" data-action="med-open:${v.id}">${esc(v.title)}</button>${aiTag(v)}<p class="visit-card-meta">${esc(v.hospital||'机构待补充')} · ${esc(v.city||'城市待补充')} · ${esc(v.department||'科室待补充')}${v.doctor?' · '+esc(v.doctor):''}</p><p class="visit-reason">${esc(v.reason||v.note||'暂无就诊备注')}</p></div><div class="visit-row-context"><time>${v.date}${v.time?' · '+esc(v.time):''}</time>${badge(v.status,'visit')}<div class="visit-card-counts"><span>报告 ${n('report')}</span><span>用药 ${n('medication')}</span><span>待办 ${all('task').filter(x=>x.visitId===v.id&&!x.done).length}</span></div></div><div class="visit-row-actions"><button class="icon-btn" data-action="med-open:${v.id}" aria-label="查看${esc(v.title)}详情">${icon('arrow',17)}</button>${actions(v)}</div></article>`}).join(''):panelEmpty('visit',search||status!=='all'?'没有匹配的就诊':'从一次就诊开始','在一次就诊中整理报告、用药和复查安排。','add:visit','添加就诊')}</div>`}
 if(view==='medications'){const meds=sort(all('medication')).filter(x=>`${x.title} ${x.note||''}`.includes(search));return meds.length?`<div class="medication-list">${meds.map(m=>medicationCard(m)).join('')}</div>`:`<div class="card">${panelEmpty('heart','还没有用药方案','按医生处方录入方案，再记录每次服用。','med-new-medication','添加用药方案')}</div>`;}
 const reports=sort(all('report')).filter(x=>`${x.title} ${x.source||''} ${x.content||''}`.includes(search));return `<section class="card">${reports.length?`<div class="record-list medical-resource-list">${reports.map(r=>reportRow(r,true)).join('')}</div>`:panelEmpty('file','还没有就诊报告','可录入报告原文，并上传或关联原始文件。','med-new-report','添加报告')}</section>`;}
 function detail(v){const reports=sort(all('report').filter(x=>x.visitId===v.id)),meds=sort(all('medication').filter(x=>x.visitId===v.id)),tasks=sort(all('task').filter(x=>x.visitId===v.id)),files=sort(all('file').filter(x=>x.visitId===v.id));
 return `<button class="text-btn medical-back" data-action="med-view:visits">← 返回就诊管理</button><section class="card visit-hero"><div class="visit-hero-top">${institutionMark(v,{esc,icon})}<div class="visit-hero-info"><div class="visit-detail-date">${v.date}</div><h1>${esc(v.title)}${aiTag(v)}</h1><p>${esc(v.hospital||'机构待补充')} · ${esc(v.city||'城市待补充')} · ${esc(v.department||'科室待补充')}${v.doctor?' · '+esc(v.doctor):''}${v.time?' · '+esc(v.time):''}</p></div>${badge(v.status,'visit')}${btn('编辑就诊','edit:'+v.id,'','edit')}</div><div class="visit-hero-stats"><span>${reports.length} 份报告</span><span>${meds.filter(m=>m.status==='进行中').length} 个进行中的用药方案</span><span>${tasks.filter(t=>!t.done).length} 项待跟进</span><span>${files.length} 份原件</span></div></section><div class="medical-detail-tabs">${[['overview','就诊概览'],['reports','就诊报告'],['medications','用药与服用记录'],['followup','复查与待办']].map(([k,l])=>`<button class="${section===k?'active':''}" data-action="med-section:${k}">${l}</button>`).join('')}</div>${section==='overview'?`<div class="visit-overview-grid"><div>${card('就诊记录','',btn('编辑记录','edit:'+v.id,'','edit'),`<div class="clinical-notes">${[['就诊原因 / 主诉',v.reason],['医生记录 / 结论原文',v.assessment],['医嘱与注意事项',v.instructions],['其他记录（含原有备注）',v.note]].map(([l,c])=>`<div class="clinical-note"><h3>${l}</h3><p class="${!c?'muted':''}">${esc(c||'尚未补充，可按原始记录录入。')}</p></div>`).join('')}</div>`)}${card('就诊报告',reports.length,titleAction('添加报告','med-new-report:'+v.id),reports.length?`<div class="record-list">${reports.slice(0,3).map(r=>reportRow(r)).join('')}</div>`:panelEmpty('file','整理这次就诊的报告','保存就诊记录、检验、影像或处方原文。','med-new-report:'+v.id,'添加报告'))}</div><div>${card('用药方案',meds.length,titleAction('添加方案','med-new-medication:'+v.id),meds.length?`<div class="compact-med-list">${meds.map(m=>`<div class="compact-med">${medicationImage(m)}<div><button class="link-title" data-action="med-section:medications">${esc(m.title)}</button>${aiTag(m)}<small>${esc(m.dosage)} · ${esc(m.frequency)}</small></div>${badge(m.status)}</div>`).join('')}</div>`:panelEmpty('heart','暂无用药方案','按处方记录药物、用量与频次。','med-new-medication:'+v.id,'添加用药方案'))}${followupCard(tasks,v.id)}${filesCard(files,v.id)}</div></div>`:section==='reports'?`${card('本次就诊报告',reports.length,titleAction('添加报告','med-new-report:'+v.id),reports.length?`<div class="record-list">${reports.map(r=>reportRow(r)).join('')}</div>`:panelEmpty('file','尚未添加报告','可以先建立待出报告的记录，拿到原件后再补充。','med-new-report:'+v.id,'添加报告'))}${filesCard(files,v.id)}`:section==='medications'?`<div class="medical-section-heading"><p>方案按处方录入；服用记录可更正，不生成用药建议。</p><div>${field('查看服用日期','doseDate',doseDate||ctx.today,'date',`max="${ctx.today}"`)}${btn('添加用药方案','med-new-medication:'+v.id,'primary','plus')}</div></div>${meds.length?meds.map(m=>medicationCard(m)).join(''):`<div class="card">${panelEmpty('heart','这次就诊还没有用药方案','请按处方填写，不由系统推断用量。','med-new-medication:'+v.id,'添加用药方案')}</div>`}`:followupCard(tasks,v.id)}`;
 }
 function followupCard(tasks,visitId){return card('复查与后续事项',tasks.filter(x=>!x.done).length+' 项待完成',titleAction('添加事项','med-new-task:'+visitId),tasks.length?`<div class="record-list">${tasks.map(t=>`<div class="task-row"><button class="check ${t.done?'checked':''}" data-action="toggle:${t.id}" aria-pressed="${t.done}" aria-label="${t.done?'取消完成':'完成'}：${esc(t.title)}">${t.done?icon('check',12):''}</button><div class="task-copy"><strong>${esc(t.title)}</strong><small>${t.date} ${esc(t.time||'')} · ${t.done?'已完成':'待完成'}</small>${t.note?`<p class="medical-task-note">${esc(t.note)}</p>`:''}</div>${actions(t)}</div>`).join('')}</div>`:panelEmpty('calendar','把后续安排放在这里','复查、预约或需要准备的资料，都可以建立待办。','med-new-task:'+visitId,'添加复查事项'));}
 function filesCard(files,id){return card('原始资料',files.length,titleAction('上传资料','med-upload:'+id),files.length?`<div class="record-list">${files.map(f=>`<div class="record medical-file-row">${previews.thumb(f)}<div class="record-info"><button class="link-title" data-action="med-preview:${f.id}">${esc(f.title)}</button><p>${f.date} · ${Math.ceil(f.size/1024)} KB</p></div>${btn('预览','med-preview:'+f.id)}<a class="icon-btn" aria-label="下载${esc(f.title)}" href="/api/files/${f.id}?space=${ctx.space}&workbench=${ctx.workbench}" download>${icon('download',16)}</a></div>`).join('')}</div>`:panelEmpty('file','还没有原件','支持 PDF、图片和 TXT；不会自动解析内容。','med-upload:'+id,'上传原件'));}
 function reportRow(r,showVisit=false){const f=find(r.fileId);return `<article class="record report-row">${previews.thumb(f,f?`med-preview-report:${r.id}`:'')}<div class="record-info"><button class="link-title" data-action="med-report:${r.id}">${esc(r.title)}</button>${aiTag(r)}<p>${r.date} · ${esc(r.type)}${r.source?' · '+esc(r.source):''}</p><div class="report-flags">${badge(r.status,'visit')}${badge(r.content?'已录文字':'文字待补充')}${r.observations?.length?badge(r.observations.length+' 项指标'):''}${badge(f?'已关联原件':'原件待补充',f?'':'neutral')}</div><div class="file-original-link">${btn('报告文字','med-report:'+r.id)}${f?btn('查看原件','med-preview-report:'+r.id):''}</div>${showVisit?visitLink(r.visitId):''}</div>${actions(r,`<button class="icon-btn" data-action="med-report:${r.id}" aria-label="查看报告${esc(r.title)}">${icon('arrow',15)}</button>`)}</article>`;}
 function medicationImage(m){const f=find(m.imageFileId);return f?.kind==='file'&&['image/png','image/jpeg','image/webp'].includes(f.mime)?`<span class="medication-image">${previews.thumb(f)}</span>`:`<span class="event-icon metric medication-image-empty">${icon('heart',21)}</span>`;}
 function medicationCard(m){const date=doseDate||ctx.today,logs=sort(all('dose').filter(d=>d.medicationId===m.id)),active=m.status==='进行中'&&m.date<=date&&(!m.endDate||m.endDate>=date),canLog=date<=ctx.today;const times=m.scheduleMode==='asNeeded'?[]:m.times||[];return `<section class="card medication-card"><div class="medication-head">${medicationImage(m)}<div><h3>${esc(m.title)}</h3>${aiTag(m)}<p>${esc(m.prescriber||'处方来源待补充')} · ${m.date} 至 ${m.endDate||'未指定结束日期'}</p>${visitLink(m.visitId)}</div>${badge(m.status,m.status==='进行中'?'':'neutral')}${actions(m,m.status==='进行中'?`<button class="btn" data-action="med-status:${m.id}">停用方案</button>`:'')}</div><div class="medication-facts"><div><small>单次用量（按原处方）</small><strong>${esc(m.dosage)}</strong></div><div><small>用药途径</small><strong>${esc(m.route)}</strong></div><div><small>频次 / 用法</small><strong>${esc(m.frequency)}</strong></div><div><small>服用安排</small><strong>${m.scheduleMode==='asNeeded'?'按需记录':times.map(esc).join(' / ')}</strong></div></div>${m.note?`<div class="medication-note">${esc(m.note)}</div>`:''}<div class="dose-area"><div class="dose-heading"><strong>${date} · 服用记录</strong>${btn('补记一次服用','med-dose:'+m.id,'','plus')}</div>${active&&times.length?times.map(time=>{const d=logs.find(d=>d.date===date&&d.scheduledTime===time);return `<div class="dose-row"><span class="dose-time">${time}</span><span class="dose-outcome ${d?.outcome==='已服用'?'taken':''}">${d?esc(d.outcome)+(d.time?' · 实际 '+esc(d.time):''):'待记录'}</span>${d?aiTag(d):''}${d?`<button class="text-btn" data-action="med-edit:${d.id}">更正记录 ${icon('edit',12)}</button>`:canLog?`<div class="dose-actions"><button class="btn" data-action="med-take:${m.id}" data-time="${time}">记录服用</button><button class="text-btn" data-action="med-skip:${m.id}" data-time="${time}">跳过</button></div>`:''}</div>`}).join(''):`<p class="muted dose-explanation">${m.scheduleMode==='asNeeded'?'按需用药不预设次数，实际使用后记录。':m.status!=='进行中'?'方案已结束或停用，不再生成待服事项，历史记录仍保留。':'所选日期不在方案起止范围内。'}</p>`}</div><details class="dose-history"><summary>全部服用历史 <span>${logs.length} 条</span></summary>${logs.length?logs.map(d=>`<div class="dose-row"><div><strong>${d.date} ${esc(d.scheduledTime||'补记')}</strong>${aiTag(d)}<small>${esc(d.outcome)}${d.time?' · 实际 '+esc(d.time):''}${d.note?' · '+esc(d.note):''}</small></div>${actions(d)}</div>`).join(''):'<p class="muted">尚无服用记录。</p>'}</details></section>`;}
 function bind(){const date=document.querySelector('#medical-file-date');if(date)date.onchange=e=>{fileDate=e.target.value;previews.cleanupThumbs();document.querySelector('#medical-list').innerHTML=listContent();previews.mount();};const input=document.querySelector('#medical-search');if(input)input.oninput=e=>{search=e.target.value;previews.cleanupThumbs();document.querySelector('#medical-list').innerHTML=listContent();previews.mount()};const statusEl=document.querySelector('#medical-status');if(statusEl)statusEl.onchange=e=>{status=e.target.value;previews.cleanupThumbs();document.querySelector('#medical-list').innerHTML=listContent();previews.mount()};for(const input of document.querySelectorAll('#med-dose-date,#field-doseDate'))input.onchange=e=>{doseDate=e.target.value||ctx.today;ctx.render()};}
 function medicationImageFields(m){const files=all('file').filter(f=>['image/png','image/jpeg','image/webp'].includes(f.mime));const existing=find(m.imageFileId);return `<div class="medication-image-editor"><h3>药品图片（可选）</h3><div id="med-image-current">${existing?previews.thumb(existing,''):'<p class="muted">暂无药品图片</p>'}</div>${select('选择已保存的图片','imageFileId',[['','不关联图片'],...files.map(f=>[f.id,`${f.title} · ${f.date}`]),...(m.imageFileId&&!existing?[[m.imageFileId,'原图片已删除（保留原关联）']]:[])],m.imageFileId||'')}<label class="upload-box">${icon('file',22)}<p>拍摄药盒或选择图片</p><input type="file" id="medication-image-upload" accept="image/png,image/jpeg,image/webp" aria-label="拍摄药盒或上传药品图片"><small>PNG、JPG、WEBP · 最大 10MB</small></label><button type="button" class="btn" id="med-image-cancel-upload" hidden>取消待上传</button> <button type="button" class="btn" id="med-image-remove">移除图片关联</button><p class="section-desc">使用你上传的真实图片，点图片可查看原图。</p><div id="medication-upload-state" role="status" aria-live="polite"></div></div>`;}
 function reportOriginalChoices(visitId,selected,old){
  const otherVisitFiles=new Set(all('report').filter(r=>r.id!==old?.id&&r.visitId&&r.visitId!==visitId).map(r=>r.fileId));
  const files=all('file').filter(f=>(!f.visitId||f.visitId===visitId)&&!otherVisitFiles.has(f.id));
  const choices=[['','暂不关联'],...files.map(f=>[f.id,f.title])];
  const historicalId=(old?.visitId||'')===visitId?old?.fileId:'';
  if(historicalId&&!files.some(f=>f.id===historicalId)){
   const file=find(historicalId);
   choices.push([historicalId,file?`${file.title}（保留原关联）`:'原件已删除（保留原关联）']);
  }
  const blocked=Boolean(selected&&!choices.some(([value])=>value===selected));
  if(blocked)choices.push([selected,`${find(selected)?.title||'原件已删除'}（此就诊不可用）`,true]);
  const notice=blocked?'此就诊无法使用已选原件。请换选原件、上传新原件或选择「暂不关联」。'
   :selected&&selected===historicalId&&!files.some(f=>f.id===selected)?'此报告可以保留原件的历史关联，也可以更换或解除关联。':'';
  const options=choices.map(([value,label,disabled])=>`<option value="${esc(value)}"${value===selected?' selected':''}${disabled?' disabled':''}>${esc(label)}</option>`).join('');
  return {options,notice,blocked};
 }
 function openMedical(kind,id=null,visitId='',preset={}){const old=find(id);if(!old&&kind!=='dose'&&!all('visit').length){ctx.openDrawer(`<div class="medical-empty">${icon('visit',30)}<h3>先建立一次就诊</h3><p>报告和用药方案需要关联就诊，方便保留来源与后续安排。</p>${btn('添加就诊','add:visit','primary','plus')}</div>`,'关联就诊','先建立来源，再整理报告与用药');return;}const x={date:ctx.today,status:kind==='report'?'待补充':'进行中',type:'就诊记录',scheduleMode:'scheduled',times:[],...old,...preset};x.visitId=old&&kind==='report'?(old.visitId||''):(old?.visitId||visitId||x.visitId||activeId||'');let body='';
 if(kind==='report'){const originals=reportOriginalChoices(x.visitId,x.fileId||'',old);body=select('报告分类','type',['就诊记录','检验报告','影像报告','处方','出院记录','其他'],x.type)+select('报告状态','status',['待出报告','待补充','待核对','已归档'],x.status)+field('报告来源 / 机构','source',x.source||'','text','maxlength="250"')+textarea('报告原文 / 手工摘录','content',x.content||'','按原始报告逐字录入结论，不将推测写成检查事实。')+`<div class="field"><label for="field-fileId">关联已有原件（可选）</label><select id="field-fileId" name="fileId" aria-describedby="report-original-notice">${originals.options}</select><small id="report-original-notice" role="status">${originals.notice}</small></div><label class="upload-box">${icon('file',24)}<p>也可以上传一份新原件</p><input type="file" id="report-upload" accept=".pdf,.png,.jpg,.jpeg,.txt,.webp" aria-label="上传报告原件"><small>PDF、图片、TXT · 最大 10MB · 不自动解析</small></label><div id="report-upload-state"></div>`;}
 if(kind==='medication')body=`<div class="helper">请按原始处方或医生交代填写。此处只记录方案，不推算用量。</div>`+medicationImageFields(x)+field('单次用量（含单位）','dosage',x.dosage||'','text','required maxlength="250" placeholder="按处方原文填写"')+`<div class="form-grid">${field('用药途径','route',x.route||'','text','required maxlength="250" placeholder="按处方填写"')}${field('频次 / 用法','frequency',x.frequency||'','text','required maxlength="250" placeholder="按处方填写"')}</div>`+field('处方医生 / 来源','prescriber',x.prescriber||'','text','maxlength="250"')+select('记录方式','scheduleMode',[['scheduled','按指定时间记录'],['asNeeded','按需使用，不设次数']],x.scheduleMode)+`<div id="med-time-field" ${x.scheduleMode==='asNeeded'?'hidden':''}>${field('每日服用时间','times',(x.times||[]).join(', '),'text','placeholder="例如 08:00, 20:00"')}<p class="section-desc">时间以逗号分隔，最多 12 个；只用于应用内记录，不发送系统提醒。</p></div>`+field('结束日期（可选）','endDate',x.endDate||'','date')+select('方案状态','status',['进行中','已停用','已完成'],x.status);
 if(kind==='dose'){const med=find(x.medicationId);if(!med){ctx.toast('找不到用药方案');return}body=`<div class="helper"><b>${esc(med.title)}</b><br>${esc(med.dosage)} · ${esc(med.frequency)}<br>${x.scheduledTime?'对应计划时段 '+esc(x.scheduledTime):'补记一次实际使用，不额外生成计划次数。'}</div><input type="hidden" name="medicationId" value="${med.id}"><input type="hidden" name="scheduledTime" value="${esc(x.scheduledTime||'')}">`+select('服用结果','outcome',['已服用','跳过'],x.outcome||'已服用')+field('实际服用时间（跳过时可留空）','time',x.time||new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'}).format(new Date()),'time');}
 const label={report:'就诊报告',medication:'用药方案',dose:'服用记录'}[kind];
 const sourceSpace=ctx.space,sourceWorkbench=ctx.workbench;
 ctx.openDrawer(`<form id="medical-form"><div class="helper">${ctx.space==='demo'?'示例空间 · 虚构示例，不构成处方':'个人空间 · 按原始记录填写'}</div>${kind==='dose'?'':select('关联就诊','visitId',visitOptions(x.visitId),x.visitId)}${field(kind==='medication'?'药物名称':kind==='report'?'报告标题':'记录名称','title',x.title||'','text','required maxlength="120"')}${field(kind==='medication'?'开始日期':'记录日期','date',x.date,'date',kind==='dose'?`required max="${ctx.today}"`:'required')}${body}${textarea(kind==='dose'?'备注 / 跳过原因（跳过必填）':'补充备注','note',x.note||'')}<div id="medical-error" role="alert"></div></form>`,`${id?'编辑':'添加'}${label}`,`${ctx.space==='demo'?'示例空间':'个人空间'} · 保存后回到当前页面`,`${btn('取消','close')}<button type="submit" form="medical-form" class="btn primary">${icon('check',14)}保存${label}</button>`);
 document.querySelector('#field-scheduleMode')?.addEventListener('change',e=>{document.querySelector('#med-time-field').hidden=e.target.value==='asNeeded'});
 if(kind==='dose'){const outcome=document.querySelector('#field-outcome');const timeField=document.querySelector('#field-time').closest('.field');timeField.hidden=outcome.value==='跳过';outcome.onchange=()=>{timeField.hidden=outcome.value==='跳过'};}
 const form=document.querySelector('#medical-form');
 const reportChoice=kind==='report'?form.elements.fileId:null;
 const reportVisit=kind==='report'?form.elements.visitId:null;
 const reportUpload=kind==='report'?form.querySelector('#report-upload'):null;
 let uploaded=null,initialMedicationImage,removeMedicationImage=false;
 let selectedMedicationImage=null,medicationUpload=null,uploadFieldError=null;
 const medicationForm=kind==='medication'?form:null;
 const uploadState=medicationForm?.querySelector('#medication-upload-state');
 const cancelUpload=medicationForm?.querySelector('#med-image-cancel-upload');
 const visitChoice=medicationForm?.elements.visitId;
 const visitUploadError=medicationForm?document.createElement('div'):null;
 if(visitUploadError){
  visitUploadError.id='medication-upload-visit-error';
  visitUploadError.className='form-error';
  visitUploadError.hidden=true;
  visitUploadError.setAttribute('role','alert');
  visitChoice.insertAdjacentElement('afterend',visitUploadError);
 }
 const showVisitUploadError=message=>{
  visitUploadError.hidden=false;
  visitUploadError.textContent=message+'。请选择有效就诊后重试，或在药品图片处选择「'+cancelUpload.textContent+'」。';
  visitChoice.setAttribute('aria-invalid','true');
  visitChoice.setAttribute('aria-describedby',visitUploadError.id);
  visitChoice.disabled=false;
  visitChoice.focus();
  uploadState.textContent='待上传图片和处方草稿已保留。';
 };
 const clearVisitUploadError=()=>{
  if(!visitUploadError.textContent)return;
  visitUploadError.textContent='';
  visitUploadError.hidden=true;
  if(visitChoice.getAttribute('aria-describedby')===visitUploadError.id){
   visitChoice.removeAttribute('aria-describedby');
   visitChoice.removeAttribute('aria-invalid');
  }
 };
 const clearUploadErrors=()=>{
  clearVisitUploadError();
  if(!uploadFieldError?.isConnected)return;
  const described=medicationForm.querySelector(`[aria-describedby="${CSS.escape(uploadFieldError.id)}"]`);
  described?.removeAttribute('aria-describedby');
  described?.removeAttribute('aria-invalid');
  uploadFieldError.remove();
  uploadFieldError=null;
 };
 form.onsubmit=async e=>{e.preventDefault();const submit=document.querySelector('.drawer-foot button[type=submit]');submit.disabled=true;const attachmentControls=kind==='medication'?[...e.target.querySelectorAll('#medication-image-upload,#med-image-cancel-upload,#med-image-remove,[name="imageFileId"],[name="visitId"]')]:kind==='report'?[reportVisit,reportChoice,reportUpload]:[];const data=Object.fromEntries(new FormData(e.target));attachmentControls.forEach(el=>el.disabled=true);try{if(ctx.space!==sourceSpace||ctx.workbench!==sourceWorkbench)throw Error('空间已切换，请重新打开表单');if(kind==='medication')data.times=data.scheduleMode==='asNeeded'?[]:String(data.times||'').split(/[,，\s]+/).filter(Boolean);
 if(kind==='medication'){
 // The select starts with the image seen when the drawer opened. An unchanged
 // value must not replace a newer association created while the drawer was open.
 if(id&&!removeMedicationImage&&data.imageFileId===initialMedicationImage)delete data.imageFileId;
 const file=selectedMedicationImage;
 if(file){
  clearUploadErrors();
  if(!data.visitId){showVisitUploadError('请选择关联就诊');return;}
  try{
   if(file.size>10*1024*1024)throw Error('药品图片不能超过 10MB');
   if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('请选择 PNG、JPG 或 WEBP 图片');
   uploadState.textContent='正在读取并上传药品图片…';
   if(!medicationUpload||medicationUpload.visitId!==data.visitId)medicationUpload={visitId:data.visitId,id:crypto.randomUUID()};
   if(!medicationUpload.body){
    const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(file)});
    medicationUpload.body=JSON.stringify({name:file.name,title:(data.title+' · 药品图片').slice(0,120),date:data.date,visitId:data.visitId,fileCategory:'药品图片',content,uploadAttemptId:medicationUpload.id});
   }
   // Keep the same request when the server may have committed before the response was lost.
   medicationUpload.result??=await ctx.api('/api/upload',{method:'POST',body:medicationUpload.body},sourceSpace,sourceWorkbench);
   data.imageFileId=medicationUpload.result.id;
   cancelUpload.textContent='放弃本次图片关联';
   uploadState.textContent='图片上传成功，正在保存用药方案…';
  }catch(error){
   // A validation rejection lets the user fix fields. Keep the key to prevent a second original.
   if(error.status===400&&error.code==='validation_failed'&&error.field!=='visitId'&&medicationUpload&&!medicationUpload.uncertain)medicationUpload.body=null;
   if(!e.target.isConnected)throw error;
   cancelUpload.textContent='取消待上传';
   if(error.status===400&&error.code==='validation_failed'&&error.field==='visitId'){
    showVisitUploadError(error.message);
   }else if(error.uncertainWrite){
    medicationUpload.uncertain=true;
    uploadState.textContent='图片上传失败，原有图片关联及处方内容已保留。可重试或重新选择图片。未收到上传结果，也可取消待上传。';
   }else{
    const message='图片上传失败，原有图片关联及处方内容已保留。可重试或重新选择图片。';
    if(showFieldError(e.target,error)){
     uploadFieldError=e.target.querySelector(`#${CSS.escape(error.field+'-field-error')}`);
     uploadState.textContent=message;
    }else{
     uploadState.textContent=message+' '+error.message;
    }
   }
   return;
  }
 }}
 if(kind==='report'){
  const file=reportUpload.files[0];
  const selected=reportOriginalChoices(data.visitId,reportChoice.value,old);
  if(!file&&selected.blocked)throw Error(selected.notice);
  if(uploaded&&uploaded.visitId!==data.visitId)throw Error('已上传的原件属于之前选择的就诊，请重新选择文件或已有原件。');
  data.fileId=reportChoice.value;
  if(file){if(file.size>10*1024*1024)throw Error('原件不能超过 10MB');if(!uploaded){const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('文件读取失败'));reader.readAsDataURL(file)});uploaded=await ctx.api('/api/upload',{method:'POST',body:JSON.stringify({name:file.name,title:file.name,date:data.date,visitId:data.visitId,content})},sourceSpace,sourceWorkbench);e.target.querySelector('#report-upload-state').innerHTML=`<p class="notice">${esc(uploaded.title)} 已保存到资料档案，待关联本报告。</p>`;}data.fileId=uploaded.id;}}
 await ctx.api(id?'/api/items/'+id:'/api/items',{method:id?'PUT':'POST',body:JSON.stringify({...data,kind})},sourceSpace,sourceWorkbench);if(document.querySelector('#medical-form')===e.target)ctx.closeDrawer();await ctx.load();ctx.toast(label+'已保存到健康工作台');}catch(err){if(e.target.isConnected&&medicationUpload?.result)uploadState.textContent='图片已保存到资料档案。可重试保存方案或放弃本次图片关联。';if(e.target.isConnected&&showFieldError(e.target,err))return;const errorTarget=e.target.isConnected?e.target.querySelector('#medical-error'):null;if(!errorTarget){ctx.toast(err.message);return;}errorTarget.innerHTML=`<div class="form-error">${esc(err.message)}</div>`}finally{submit.disabled=false;attachmentControls.forEach(el=>el.disabled=false)}};
 if(kind==='medication'){
  const upload=medicationForm.querySelector('#medication-image-upload'),choice=medicationForm.elements.imageFileId;
  initialMedicationImage=choice.value;
  const update=()=>{const file=find(choice.value);medicationForm.querySelector('#med-image-current').innerHTML=file?previews.thumb(file,''):'<p class="muted">暂无药品图片</p>';previews.mount();};
  const clearUpload=()=>{
   upload.value='';
   selectedMedicationImage=null;
   medicationUpload=null;
   cancelUpload.hidden=true;
   clearUploadErrors();
  };
  const showPending=()=>{
   cancelUpload.hidden=!selectedMedicationImage;
   cancelUpload.textContent=medicationUpload?.result?'放弃本次图片关联':'取消待上传';
   if(medicationUpload?.result&&medicationUpload.visitId===visitChoice.value){
    uploadState.textContent='图片已保存到资料档案，待关联用药方案。';
   }else{
    uploadState.textContent=selectedMedicationImage?'待上传：'+selectedMedicationImage.name+'（保存用药方案时上传）':'';
   }
  };
  // An identical selection should fire change. Cancelling the picker keeps the retained File.
  upload.onclick=()=>{upload.value='';};
  upload.onchange=()=>{
   selectedMedicationImage=upload.files[0]||null;
   medicationUpload=null;
   clearUploadErrors();
   showPending();
  };
  visitChoice.onchange=()=>{
   clearVisitUploadError();
   if(selectedMedicationImage)showPending();
  };
  cancelUpload.onclick=()=>{
   const stored=medicationUpload?.result,uncertain=medicationUpload?.uncertain;
   clearUpload();
   upload.focus();
   uploadState.textContent=stored?'已放弃本次图片关联，原件仍保存在资料档案。':
    uncertain?'已取消待上传。若上传已完成，原件仍保存在资料档案。':'已取消待上传。';
  };
  choice.onchange=()=>{removeMedicationImage=false;clearUpload();uploadState.textContent='';update();};
  medicationForm.querySelector('#med-image-remove').onclick=()=>{removeMedicationImage=true;choice.value='';clearUpload();uploadState.textContent='保存后移除关联，原图片仍保存在资料档案。';update();};
  previews.mount();
 }
 if(kind==='report'){
  const notice=form.querySelector('#report-original-notice'),state=form.querySelector('#report-upload-state');
  const updateChoices=()=>{
   const options=reportOriginalChoices(reportVisit.value,reportChoice.value,old);
   reportChoice.innerHTML=options.options;
   notice.textContent=uploaded&&uploaded.visitId!==reportVisit.value?'已上传的原件属于之前选择的就诊，请重新选择文件或已有原件。':reportUpload.files[0]?'':options.notice;
  };
  reportVisit.onchange=updateChoices;
  reportChoice.onchange=()=>{reportUpload.value='';uploaded=null;state.textContent='';updateChoices();};
  reportUpload.onchange=()=>{uploaded=null;state.textContent='';updateChoices();};
 }
 }
 function showReport(id){const r=find(id);if(!r)return;const f=find(r.fileId);ctx.openDrawer(`<div class="report-flags">${badge(r.type,'visit')}${badge(r.status)}${badge(f?'已关联原件':'原件待补充')}</div><div class="report-metadata"><span>报告日期：${r.date}</span><span>来源：${esc(r.source||'未填写')}</span>${visitLink(r.visitId)}</div>${renderReportObservations(r.observations,esc)}<h3 class="clinical-label">报告原文 / 手工摘录</h3><div class="report-text">${esc(r.content||'尚未录入文字。上传原件不会自动识别，请按原文补充。')}</div>${r.note?`<h3 class="clinical-label">补充备注</h3><div class="report-text">${esc(r.note)}</div>`:''}${f?`<div class="report-original"><span>${icon('file',17)} ${esc(f.title)}</span><div>${btn('查看原件','med-preview-report:'+r.id)}<a class="btn" href="/api/files/${f.id}?space=${ctx.space}&workbench=${ctx.workbench}" download>${icon('download',14)}下载</a></div></div>`:'<div class="notice">原件待补充。可以编辑报告上传文件或关联已有资料。</div>'}`,esc(r.title),'保存原文与来源，不自动生成诊断',`${btn('关闭','close')}${btn('编辑报告','med-edit:'+id,'primary','edit')}`);}
 async function preview(id,backAction=''){const f=find(id);if(f?.kind==='file')await previews.open(f,{backAction});}
 async function handle(action,id,el){if(action==='med-open'){section='overview';ctx.navigate('visit/'+id)}else if(action==='med-view'){view=id;search='';status='all';fileDate='';ctx.navigate(id==='visits'?'visit':'visit/'+id)}else if(action==='med-section'){section=id;ctx.render()}
 else if(action==='med-new-medication')openMedical('medication',null,id||activeId||'');
 else if(action==='med-new-report')openMedical('report',null,id||activeId||'');
 else if(action==='med-edit'){const item=find(id);if(item)openMedical(item.kind,id)}
 else if(action==='med-report')showReport(id);
 else if(action==='med-upload')ctx.openForm('file',null,{visitId:id});
 else if(action==='med-new-task')ctx.openForm('task',null,{visitId:id,category:'就诊'});
 else if(action==='med-preview')await preview(id);
 else if(action==='med-preview-report'){const r=find(id);if(r?.kind==='report')await preview(r.fileId,'med-report:'+r.id);}
 else if(['med-take','med-skip','med-dose'].includes(action)){const m=find(id);openMedical('dose',null,'',{title:(m.title+' · 服用记录').slice(0,120),medicationId:id,date:el.dataset.date||doseDate||ctx.today,scheduledTime:el.dataset.time||'',outcome:action==='med-skip'?'跳过':'已服用'});}
 else if(action==='med-status'){const m=find(id);ctx.openDrawer(`<p class="section-desc">将「${esc(m.title)}」标记为已停用后，不再生成待服时段，已有服用历史仍保留。</p><div class="helper">这里只记录你按医生交代做出的停用决定，不提供是否应该停药的建议。</div>`,'记录停用状态','请按处方或医生交代核对',`${btn('取消','close')}${btn('确认已停用','med-confirm-stop:'+id,'primary')}`);}
 else if(action==='med-confirm-stop'){await ctx.api('/api/items/'+id,{method:'PUT',body:JSON.stringify({status:'已停用'})});ctx.closeDrawer();await ctx.load();ctx.toast('已记录停用状态，服用历史保留');}
 }
 function todayCard(){const meds=all('medication').filter(m=>m.status==='进行中'&&m.date<=ctx.today&&(!m.endDate||m.endDate>=ctx.today));if(!meds.length)return '';const rows=meds.flatMap(m=>(m.times||[]).map(time=>({m,time,log:all('dose').find(d=>d.medicationId===m.id&&d.date===ctx.today&&d.scheduledTime===time)})));return `<section class="card today-medications"><div class="card-head"><h2 class="card-title">今日用药<span class="subtitle">按你录入的方案显示 · 不发送系统提醒</span></h2><button class="text-btn" data-action="med-view:medications">用药管理 ${icon('arrow',12)}</button></div><div class="today-medication-rows">${rows.length?rows.map(({m,time,log})=>`<div class="today-medication-row">${medicationImage(m)}<span class="dose-time">${time}</span><div><strong>${esc(m.title)}</strong><small>${esc(m.dosage)}</small></div>${log?aiTag(log)+badge(log.outcome):`<button class="btn" data-action="med-take:${m.id}" data-time="${time}" data-date="${ctx.today}">记录已服用</button>`}</div>`).join(''):'<p class="section-desc">进行中的方案为按需用药，实际使用后到用药管理记录。</p>'}</div></section>`;}
 return {render,bind,handle,openMedical,todayCard};
}
