// Render only the evaluated component model. Definitions and data queries never
// become markup, executable styles, URLs, or event handlers here.
const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const numberFormatter=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:8});
const number=value=>value===0?'0':Math.abs(value)<1e-7?String(value):numberFormatter.format(value);
const display=value=>finite(value)?number(value):typeof value==='string'&&value.trim()?value:'—';
const coordinate=value=>Number.isFinite(value)?Number(value.toFixed(3)):0;
const array=value=>Array.isArray(value)?value:[];
const present=value=>value!==undefined&&value!==null&&value!=='';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

function chart(block,esc){
 const points=array(block.points).slice(0,90).map(point=>({date:String(point?.date??''),label:String(point?.label??point?.date??''),value:finite(point?.value)?point.value:null}));
 const values=points.filter(point=>point.value!==null).map(point=>point.value);
 if(!values.length)return '<p class="component-card-empty">这段时间还没有可展示的数据。</p>';
 const minimum=Math.min(0,...values),maximum=Math.max(0,...values),magnitude=Math.max(1,...values.map(value=>Math.abs(value)));
 const low=minimum/magnitude,high=maximum/magnitude;
 const extent=high-low||1;
 const width=320,height=174,left=10,right=10,top=12,bottom=14,plotWidth=width-left-right,plotHeight=height-top-bottom;
 const y=value=>coordinate(top+(high-value/magnitude)/extent*plotHeight);
 // All-zero data has a zero baseline at the bottom and no phantom positive bar.
 const allZero=values.every(value=>value===0),zero=allZero?height-bottom:y(0);
 const valueY=value=>allZero?zero:y(value);
 const x=index=>coordinate(block.chart==='line'?(points.length===1?width/2:left+index/(points.length-1)*plotWidth):left+(index+.5)/points.length*plotWidth);
 const barWidth=coordinate(Math.min(34,plotWidth/points.length*.66));
 const unit=String(block.unit??'');
 const pointTitle=point=>esc(`${point.label||point.date}：${point.value===null?'暂无数据':display(point.value)+(unit?' '+unit:'')}`);
 const grid=[top,top+plotHeight/2,height-bottom].map(row=>`<line class="component-chart-grid" x1="${left}" y1="${coordinate(row)}" x2="${width-right}" y2="${coordinate(row)}"/>`).join('');
 let drawing='';
 if(block.chart==='line'){
  const segments=[];let current=[];
  for(let i=0;i<points.length;i++){const point=points[i];if(point.value===null){if(current.length)segments.push(current);current=[];continue;}current.push({x:x(i),y:valueY(point.value)});}
  if(current.length)segments.push(current);
  drawing=segments.map(segment=>`<path class="component-chart-line" d="${segment.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' ')}"/>`).join('');
  drawing+=points.map((point,index)=>point.value===null?'':`<circle class="component-chart-point" cx="${x(index)}" cy="${valueY(point.value)}" r="2.7"><title>${pointTitle(point)}</title></circle>`).join('');
 }else{
  drawing=points.map((point,index)=>{
   if(point.value===null)return '';
   const endpoint=valueY(point.value),barY=coordinate(Math.min(zero,endpoint)),barHeight=coordinate(Math.abs(zero-endpoint));
   return `<rect class="component-chart-bar ${point.value<0?'is-negative':''}" x="${coordinate(x(index)-barWidth/2)}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="${Math.min(3,barWidth/3)}"><title>${pointTitle(point)}</title></rect>`;
  }).join('');
 }
 const labelIndices=[...new Set(Array.from({length:Math.min(5,points.length)},(_,i)=>Math.round(i*(points.length-1)/Math.max(1,Math.min(5,points.length)-1))))];
 const labels=labelIndices.map((index,i)=>`<span class="${i&&i<labelIndices.length-1?'is-intermediate':''}">${esc(points[index].label||points[index].date)}</span>`).join('');
 const description=`${block.label||'图表'}，${points.map(point=>(point.label||point.date)+' '+(point.value===null?'暂无数据':display(point.value)+' '+unit)).join('，')}`;
 return `<div class="component-chart"><div class="component-chart-scale"><span>${esc(display(minimum))} – ${esc(display(maximum))}${unit?' '+esc(unit):''}</span><span>${block.chart==='line'?'折线':'柱状'}</span></div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(description)}" preserveAspectRatio="none">${grid}<line class="component-chart-zero" x1="${left}" y1="${zero}" x2="${width-right}" y2="${zero}"/>${drawing}</svg><div class="component-chart-axis">${labels}</div><details class="component-chart-values"><summary>查看数值</summary><dl>${points.map(point=>`<div><dt>${esc(point.label||point.date)}</dt><dd>${point.value===null?'暂无数据':esc(display(point.value))+(unit?' '+esc(unit):'')}</dd></div>`).join('')}</dl></details></div>`;
}

function blockContent(block,esc){
 if(block.type==='stat')return `<div class="component-stat-value">${esc(display(block.value))}${present(block.unit)?`<small>${esc(block.unit)}</small>`:''}</div>${present(block.detail)?`<p class="component-stat-detail">${esc(block.detail)}</p>`:(!present(block.value)||typeof block.value==='number'&&!finite(block.value))?'<p class="component-stat-detail">尚未记录</p>':''}`;
 if(block.type==='chart')return chart(block,esc)+(present(block.detail)?`<p class="component-stat-detail">${esc(block.detail)}</p>`:'');
 if(block.type==='list'){
  const items=array(block.items).slice(0,8).filter(item=>item&&typeof item==='object');
  return items.length?`<ul class="component-data-list">${items.map(item=>`<li><strong>${esc(item.title||'未命名记录')}</strong>${present(item.date)?`<time>${esc(item.date)}</time>`:''}${present(item.detail)?`<p>${esc(item.detail)}</p>`:''}</li>`).join('')}</ul>`:'<p class="component-card-empty">暂无符合条件的记录。</p>';
 }
 if(block.type==='progress'){
  const hasValue=finite(block.value),hasTarget=finite(block.target)&&block.target>0;
  const percent=hasValue&&hasTarget?Math.min(100,Math.max(0,block.value/block.target*100)):0;
  const text=hasValue?display(block.value):'—',unit=present(block.unit)?' '+String(block.unit):'';
  const label=hasTarget?`${text}${unit}，目标 ${display(block.target)}${unit}`:`${text}${unit}，目标未设置`;
  return `<div class="component-progress-values"><strong>${esc(text)}${unit?`<small>${esc(unit)}</small>`:''}</strong><span>${hasTarget?'目标 '+esc(display(block.target))+esc(unit):'目标未设置'}</span></div><div class="component-progress-track" ${hasTarget&&hasValue?`role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${coordinate(percent)}"`:'role="img"'} aria-label="${esc(label)}"><span style="width:${coordinate(percent)}%"></span></div><p class="component-progress-detail">${!hasValue?'尚未记录':hasTarget?`${Math.round(percent)}%`:'设置目标后显示进度'}</p>${present(block.detail)?`<p class="component-stat-detail">${esc(block.detail)}</p>`:''}`;
 }
 return '';
}

export function renderComponentCard(model,options={}){
 model=model&&typeof model==='object'?model:{};
 const esc=typeof options.esc==='function'?options.esc:escapeText;
 const appearance=model.appearance||{},tone=appearance.tone==='tinted'?'tinted':'neutral',density=appearance.density==='compact'?'compact':'comfortable',layout=model.layout==='grid'?'grid':'stack';
 const accent=typeof appearance.accent==='string'&&/^#[a-f0-9]{6}$/i.test(appearance.accent)?appearance.accent:null;
 const rgb=accent?[1,3,5].map(i=>parseInt(accent.slice(i,i+2),16)):null;
 const luminance=rgb?.reduce((sum,value,i)=>sum+[.2126,.7152,.0722][i]*(value/255<=.04045?value/255/12.92:((value/255+.055)/1.055)**2.4),0);
 const dataInk=accent&&(luminance>.25?'#'+rgb.map(value=>Math.round(value*.55).toString(16).padStart(2,'0')).join(''):accent);
 const source=typeof model.source?.name==='string'&&model.source.name?`来自${model.source.name}工作台`:'';
 const showManage=options.showManage===true&&!options.readOnly&&uuid(options.componentId);
 const blocks=array(model.blocks).slice(0,8).filter(block=>block&&typeof block==='object'&&['stat','chart','list','progress'].includes(block.type));
 return `<article class="component-card component-card-tone-${tone} component-card-density-${density}" ${accent?`style="--component-accent:${accent};--component-data-ink:${dataInk}"`:''}><header class="component-card-head"><div><h3>${esc(model.title||'未命名组件')}</h3>${present(model.description)?`<p>${esc(model.description)}</p>`:''}</div>${showManage?`<button type="button" class="component-manage-button" data-action="component-open:${esc(options.componentId)}" aria-label="管理${esc(model.title||'组件')}">管理</button>`:''}</header>${source?`<div class="component-source-badge">${esc(source)}${model.space==='demo'?'<span>示例 · 虚构</span>':''}</div>`:''}<div class="component-card-blocks" data-component-layout="${layout}">${blocks.map(block=>`<section class="component-block component-block-${block.type}"><h4>${esc(block.label||({stat:'指标',chart:'趋势',list:'记录',progress:'进度'})[block.type])}</h4>${blockContent(block,esc)}</section>`).join('')||'<p class="component-card-empty">还没有可展示的组件内容。</p>'}</div></article>`;
}
