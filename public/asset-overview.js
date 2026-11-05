import {assetValue,calculateAssetTotals} from './asset-accounting.js';
import {assetGroup,enrichAssetHolding,assetDeadline} from './asset-lifecycle.js';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const code=x=>x.currency||'CNY';
const snapshotAmount=new Intl.NumberFormat('en-US',{useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2});
const sameAmount=(a,b)=>snapshotAmount.format(a)===snapshotAmount.format(b);
const labels={cash:'现金与存款',fund:'基金 / ETF',stock:'股票',other:'其他金融资产'};
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;

// Never convert currencies or count account totals unless explicitly opted in.
export function buildFinanceOverview(items,today,selectedCurrency=''){
 const totals=calculateAssetTotals(items),contributions=[],missing=[];
 const active=items.filter(x=>x.status!=='closed');
 for(const raw of active){
  const x=raw.kind==='asset_holding'?enrichAssetHolding(raw):raw;
  if(x.kind==='asset_holding'&&x.status!=='pending'){
   const value=assetValue(x),group=assetGroup(x);
   if(value===null)missing.push(x);else contributions.push({id:x.id,currency:code(x),value,group,category:x.category||'other',accountId:x.accountId||''});
  }else if(x.kind==='asset_account'&&x.includeInTotal===true){
   if(!finite(x.balance))missing.push(x);else contributions.push({id:x.id,currency:code(x),value:x.balance,group:'financial',category:'cash',accountId:x.id});
  }
 }
 const currencies=[...new Set([...totals.map(x=>x.currency),...active.filter(x=>x.kind==='asset_snapshot').map(code)])].sort((a,b)=>a==='CNY'?-1:b==='CNY'?1:a.localeCompare(b));
 const currency=currencies.includes(selectedCurrency)?selectedCurrency:currencies[0]||'CNY';
 const total=totals.find(x=>x.currency===currency)||{currency,assets:0,liabilities:0,unknown:0,unknownLiabilities:0,pendingCount:0,pendingValue:0,pendingUnvalued:0,dates:[]};
 const valued=contributions.filter(x=>x.currency===currency),hasValue=valued.length>0;
 const liabilities=active.filter(x=>x.kind==='asset_liability'&&code(x)===currency);
 const unknownDebt=active.filter(x=>x.kind==='asset_liability'&&(!finite(x.balance)||x.status==='pending'));
 const pending=active.filter(x=>x.kind==='asset_holding'&&x.status==='pending');
 const due=active.filter(x=>x.kind==='asset_holding'&&['overdue','soon'].includes(assetDeadline(enrichAssetHolding(x),today).status));
 const debtDue=active.filter(x=>x.kind==='asset_liability'&&validDate(x.dueDate)&&x.dueDate<=new Date(Date.parse(today+'T00:00:00Z')+30*86400000).toISOString().slice(0,10));
 const tasks=active.filter(x=>x.kind==='task'&&!x.done);
 const segments=['financial','fixed','other'].map(group=>({group,value:valued.filter(x=>x.group===group).reduce((sum,x)=>sum+x.value,0),valued:valued.filter(x=>x.group===group).length,unknown:missing.filter(x=>code(x)===currency&&(x.kind==='asset_account'?'financial':assetGroup(x))===group).length,count:active.filter(x=>x.kind==='asset_holding'&&code(x)===currency&&assetGroup(enrichAssetHolding(x))===group).length}));
 return {currency,currencies,total,contributions,valued,hasValue,assets:hasValue?total.assets:null,net:hasValue&&!total.unknownLiabilities?total.net:null,segments,missing,unknownDebt,pending,due,debtDue,tasks,liabilities,accounts:items.filter(x=>x.kind==='asset_account')};
}

export function financeDistribution(model,dimension='category'){
 const financial=model.contributions.filter(x=>x.group==='financial'&&(dimension==='currency'||x.currency===model.currency));
 const groups=new Map();
 for(const x of financial){const key=dimension==='currency'?x.currency:dimension==='account'?x.accountId:x.category;groups.set(key,(groups.get(key)||0)+x.value);}
 const total=financial.reduce((sum,x)=>sum+x.value,0);
 return [...groups].map(([key,value])=>({key,value,currency:dimension==='currency'?key:model.currency,label:dimension==='currency'?key:dimension==='account'?(model.accounts.find(x=>x.id===key)?.title||'未关联账户'):(labels[key]||'其他金融资产'),percent:dimension==='currency'||!total?null:value/total*100})).sort((a,b)=>dimension==='currency'?a.currency.localeCompare(b.currency):b.value-a.value||a.label.localeCompare(b.label));
}

export function financeSnapshots(items,currency,today,months=6){
 const end=new Date(today+'T00:00:00Z');
 const since=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()-months+1,1)).toISOString().slice(0,10);
 const grouped=new Map();let invalid=0;
 for(const x of items){
  if(x.kind!=='asset_snapshot'||code(x)!==currency||!validDate(x.date)||x.date>today||x.date<since||['pending','closed'].includes(x.status))continue;
  const derived=finite(x.assetValue)&&finite(x.liabilityValue)?x.assetValue-x.liabilityValue:null;
  const value=finite(x.totalValue)?x.totalValue:derived;
  if(value===null){invalid++;continue;}
  if(derived!==null&&finite(x.totalValue)&&!sameAmount(x.totalValue,derived)){invalid++;continue;}
  if(!grouped.has(x.date))grouped.set(x.date,[]);
  grouped.get(x.date).push(value);
 }
 const points=[];let conflicts=0;
 for(const [date,values] of grouped){if(values.some(x=>!sameAmount(x,values[0]))){conflicts++;continue;}points.push({date,value:values[0]});}
 points.sort((a,b)=>a.date.localeCompare(b.date));
 return {points,invalid,conflicts,since,delta:points.length>1?points.at(-1).value-points.at(-2).value:null};
}

export function createAssetOverview(ctx){
 const {esc,icon,btn}=ctx;let selectedCurrency='',dimension='category',months=6,scope='';
 const money=(value,currency)=>finite(value)?new Intl.NumberFormat('zh-CN',{style:'currency',currency:/^[A-Z]{3}$/.test(currency)?currency:'CNY',maximumFractionDigits:2}).format(value):'—';
 const compact=value=>new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(value);
 const key=()=>[ctx.account?.user?.id||'',ctx.workbench,ctx.space].join(':');
 const clean=()=>{selectedCurrency='';dimension='category';months=6;scope='';};
 function ensure(){if(scope!==key()){clean();scope=key();}}
 function switcher(action,choices,current,label){return `<div class="finance-segmented" role="group" aria-label="${label}">${choices.map(([value,title])=>`<button type="button" data-action="${action}:${value}" aria-pressed="${String(value===current)}">${title}</button>`).join('')}</div>`;}
 function state(text,action,label){return `<div class="finance-empty"><span>${icon('activity',22)}</span><p>${text}</p>${action?btn(label,action,'text-btn'):''}</div>`;}
 function chart(history,currency){
  if(history.points.length<2)return state(history.points.length?'已有 1 次净额快照，再记录一次即可查看变化。':'还没有可比较的净额快照，记录后再看变化。','asset-add:asset_snapshot','记录历史快照');
  const points=history.points,width=660,height=215,left=90,right=42,top=26,bottom=34;
  const values=points.map(x=>x.value),low=Math.min(...values),high=Math.max(...values),padding=Math.max((high-low)*.18,Math.abs(high)*.03,1),min=low-padding,max=high+padding;
  const first=Date.parse(points[0].date),last=Date.parse(points.at(-1).date);
  const coords=points.map(p=>({x:left+(Date.parse(p.date)-first)/(last-first)*(width-left-right),y:top+(max-p.value)/(max-min)*(height-top-bottom),...p}));
  const path=coords.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const ticks=Array.from({length:4},(_,i)=>{const value=min+(max-min)*i/3,y=top+(max-value)/(max-min)*(height-top-bottom);return `<line x1="${left}" x2="${width-right}" y1="${y}" y2="${y}" class="finance-gridline"/><text x="${left-12}" y="${y+4}" text-anchor="end">${esc(compact(value,currency))}</text>`;}).join('');
  const xlabels=[0,...(coords.length>2?[Math.floor((coords.length-1)/2)]:[]),coords.length-1].map(i=>`<text x="${coords[i].x}" y="${height-7}" text-anchor="middle">${points[i].date.slice(5).replace('-','/')}</text>`).join('');
  return `<svg class="finance-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(currency+'净额历史变化，'+points.length+'次快照；最新'+money(points.at(-1).value,currency))}">${ticks}<path d="${path}" class="finance-chart-line"/>${coords.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="4"><title>${esc(p.date+' · '+money(p.value,currency))}</title></circle>`).join('')}${xlabels}</svg><details class="finance-chart-data"><summary>查看快照数据（${points.length} 次）</summary><div class="finance-data-scroll"><table><caption>${esc(currency)} 净额历史快照</caption><thead><tr><th scope="col">日期</th><th scope="col">已记录净额</th></tr></thead><tbody>${points.map(p=>`<tr><td>${esc(p.date)}</td><td>${money(p.value,currency)}</td></tr>`).join('')}</tbody></table></div></details>`;
 }
 function render(){
  ensure();const m=buildFinanceOverview(ctx.items,ctx.today,selectedCurrency);selectedCurrency=m.currency;
  const {currency,total}=m,history=financeSnapshots(ctx.items,currency,ctx.today,months),allHistory=financeSnapshots(ctx.items,currency,ctx.today,1200),rows=financeDistribution(m,dimension);
  const financial=m.segments[0],fixed=m.segments[1];
  const selectedUnknown=m.missing.filter(x=>code(x)===currency).length;
  const groups=total.dates.length?`${total.dates[0]}${total.dates.length>1?' 至 '+total.dates.at(-1):''}`:'估值日期待补';
  const heroLabel=total.unknownLiabilities?'已知资产估值':'已估值净额';
  const pendingValue=total.pendingCount?` · ${total.pendingCount} 项待核对估值 ${money(total.pendingValue,currency)}，未计入`:'';
  const totalNotice=`${selectedUnknown?`${selectedUnknown} 项资产未估值，未计入`:'按已记录资产与负债统计'}${pendingValue}`;
  const delta=allHistory.delta,deltaText=delta===null?'—':`${delta>0?'+':''}${money(delta,currency)}`;
  const deltaDates=delta===null?'待补可比快照':`${allHistory.points.at(-2).date} → ${allHistory.points.at(-1).date}`;
  const originalAmounts=m.currencies.filter(c=>c!==currency).map(c=>{const model=buildFinanceOverview(ctx.items,ctx.today,c);return `<button data-action="asset-overview-currency:${esc(c)}">${esc(c)} <strong>${money(model.assets,c)}</strong></button>`;}).join('');
  const distribution=rows.length?`<div class="finance-distribution-rows">${rows.map((r,i)=>`<div class="finance-distribution-row"><span class="finance-category"><i class="finance-dot finance-color-${i%4}"></i>${esc(r.label)}</span><strong>${money(r.value,r.currency)}</strong>${r.percent===null?`<span class="finance-share">${esc(r.currency)}</span>`:`<div class="finance-bar"><i class="finance-color-${i%4}" style="width:${Math.max(0,Math.min(100,r.percent)).toFixed(2)}%"></i></div><span class="finance-share">${r.percent.toFixed(1)}%</span>`}</div>`).join('')}</div>`:state('有已确认估值的金融资产后，将在这里展示分布。','nav:financial','查看金融资产');
  const warnings=[...(m.missing.length?[{text:`${m.missing.length} 项估值待补`,route:'holdings'}]:[]),...(m.unknownDebt.length?[{text:`${m.unknownDebt.length} 项负债待核实`,route:'liabilities'}]:[]),...(m.pending.length?[{text:`${m.pending.length} 项资产待核对`,route:'holdings'}]:[]),...(m.due.length?[{text:`${m.due.length} 项近期到期与续费`,route:'renewals'}]:[]),...(m.debtDue.length?[{text:`${m.debtDue.length} 项还款安排`,route:'renewals'}]:[]),...(m.tasks.length?[{text:`${m.tasks.length} 项待办`,route:'tasks'}]:[])];
  const attention=`<section class="finance-attention" aria-label="当前空间需要关注"><strong><i></i>${warnings.length?'需要关注':'近期事项'}</strong><div>${warnings.length?warnings.map(w=>`<button data-action="nav:${w.route}">${w.text}</button>`).join(''):'暂无已记录的近期事项'}</div>${btn('查看事项 →','nav:renewals','text-btn')}</section>`;
  const historyWarning=history.conflicts+history.invalid?`<p class="finance-history-warning">${history.conflicts?`${history.conflicts} 个日期的快照净额冲突，已暂不绘制。`:''}${history.invalid?`${history.invalid} 条快照缺少完整净额或金额口径不一致。`:''}${btn('核对快照','nav:history','text-btn')}</p>`:'';
  const financeRows=financeDistribution(m,'category');
  const stacked=financial.value>0?`<div class="finance-stacked" aria-hidden="true">${financeRows.map((r,i)=>`<i class="finance-color-${i%4}" style="width:${Math.max(0,r.percent||0)}%"></i>`).join('')}</div>`:'';
  const other=m.segments[2];
  return `<div class="finance-overview" data-currency="${esc(currency)}"><header class="finance-overview-heading"><div><h1>资产总览</h1><p>一眼看清家底与变化</p></div><div class="finance-overview-tools"><label class="finance-currency-label"><span>展示币种</span><select id="finance-overview-currency" aria-label="展示币种">${(m.currencies.length?m.currencies:['CNY']).map(c=>`<option value="${esc(c)}" ${c===currency?'selected':''}>${esc(c)}${({CNY:' 人民币',USD:' 美元',HKD:' 港币',EUR:' 欧元',JPY:' 日元',GBP:' 英镑'})[c]||''}</option>`).join('')}</select></label>${ctx.space==='demo'?'<span class="finance-demo-tag">示例数据</span>':''}${btn('记录','shell-capture','primary','plus')}</div></header><section class="finance-summary" aria-label="所选币种财务汇总"><div class="finance-summary-metrics"><div class="finance-hero"><span>${esc(currency)} · ${heroLabel}</span><strong>${money(total.unknownLiabilities?m.assets:m.net,currency)}</strong><small>${total.unknownLiabilities?'净额待核实，待补负债信息':'仅含已记录且有估值的资产与负债'}</small></div><div><span>已估值资产</span><strong>${money(m.assets,currency)}</strong><small>金融与固定资产分别维护</small></div><div><span>已记录负债</span><strong>${total.unknownLiabilities?'待核实（'+total.unknownLiabilities+'项）':m.liabilities.length?money(total.liabilities,currency):'—'}</strong><small>${total.unknownLiabilities?(m.liabilities.some(x=>finite(x.balance)&&x.status!=='pending')?'已确认部分 '+money(total.liabilities,currency):'尚无已确认余额'):m.liabilities.length?'以已记录未偿余额为准':'暂无负债记录'}</small></div><div><span>快照变化</span><strong class="${delta!==null&&delta>0?'finance-positive':''}">${deltaText}</strong><small>${deltaDates}</small></div></div><div class="finance-summary-note"><span>${esc(totalNotice)}</span><span>估值日期 ${esc(groups)}</span></div></section>${originalAmounts?`<div class="finance-other-currencies"><span>其他币种已估值资产</span>${originalAmounts}<small>原币分别统计，不自动换汇</small></div>`:''}<div class="finance-analytics"><section class="finance-panel finance-distribution"><div class="finance-panel-heading"><h2>金融资产分布</h2>${switcher('asset-overview-dimension',[['category','按类别'],['account','按账户'],['currency','按币种']],dimension,'资产分布维度')}</div>${distribution}<p class="finance-panel-footnote">${dimension==='currency'?'各币种分别列示原币金额，不计算跨币种占比。':`占 ${esc(currency)} 已估值金融资产比例，含明确计入的账户余额。`}</p></section><section class="finance-panel finance-trend"><div class="finance-panel-heading"><div><h2>净额变化</h2><p>按历史快照 · 不等同投资收益</p></div>${switcher('asset-overview-range',[['6','近6个月'],['12','近一年']],String(months),'快照时间范围')}</div>${chart(history,currency)}${historyWarning}</section></div>${attention}<div class="finance-management"><section class="finance-panel finance-financial-summary"><div class="finance-panel-heading"><h2>金融资产</h2><small>${financial.count} 项持仓</small></div><strong class="finance-module-amount">${money(financial.valued?financial.value:null,currency)}</strong><p>现金与存款 / 基金 / 股票</p>${stacked}<div class="finance-module-note">${financial.unknown?`${financial.unknown} 项未估值 · `:''}含明确计入的账户余额</div><div class="finance-module-links">${btn('查看持仓 →','nav:financial','text-btn')}${btn('账户管理','nav:accounts','text-btn')}</div></section><section class="finance-panel finance-fixed-summary"><div class="finance-panel-heading"><h2>固定资产</h2><small>${fixed.count} 项</small></div><strong class="finance-module-amount">${money(fixed.valued?fixed.value:null,currency)}</strong><p>实物资产 · 设备与数字服务</p><div class="finance-fixed-facts"><span>${icon('building',17)}已估值 ${fixed.valued} 项</span><span>${icon('file',17)}未估值 ${fixed.unknown} 项</span></div><div class="finance-module-note">续费参考费用不作为资产估值</div><div class="finance-module-links">${btn('查看资产 →','nav:fixed','text-btn')}${btn('维护与续费','nav:renewals','text-btn')}</div></section></div>${other.count?`<div class="finance-unclassified">另有 ${other.count} 项其他分区资产${other.valued?'，已估值 '+money(other.value,currency):''}。${btn('查看并整理','nav:holdings','text-btn')}</div>`:''}<footer class="finance-overview-footer"><span>按币种分别统计，不自动换汇 · 金额与估值日期以原记录为准</span><div>${btn('历史记录','nav:history','text-btn')}${btn('全部资产明细','nav:holdings','text-btn')}</div></footer></div>`;
 }
 function repaint(focusAction){const box=document.querySelector('.finance-overview');if(!box)return;box.outerHTML=render();bind();if(focusAction)document.querySelector(`[data-action="${focusAction}"]`)?.focus({preventScroll:true});}
 function bind(){const select=document.querySelector('#finance-overview-currency');if(select)select.onchange=e=>{selectedCurrency=e.target.value;repaint();document.querySelector('#finance-overview-currency')?.focus({preventScroll:true});};}
 function handle(action,arg){ensure();if(action==='asset-overview-currency'&&/^[A-Z]{3}$/.test(arg))selectedCurrency=arg;else if(action==='asset-overview-dimension'&&['category','account','currency'].includes(arg))dimension=arg;else if(action==='asset-overview-range'&&['6','12'].includes(arg))months=Number(arg);else return;repaint(action+':'+arg);}
 return {render,bind,handle,cleanup:clean};
}
