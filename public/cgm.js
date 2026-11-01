// CGM credentials live only in the current form; no browser persistence or auto-login.
export function createCgmUI(ctx){
 const {esc,icon,btn}=ctx;
 let identity=null,epoch=0,controller=null,connections=[],providers=[],data=null,chosenDate='',loaded=false,busy=false,writing=false,error='',container=null,pollTimer=null,visibilityBound=false,lastLoadedAt=null;
 const supported=()=>ctx.space==='personal'&&ctx.workbench==='health';
 const scopeKey=()=>JSON.stringify([ctx.userId??null,ctx.space,ctx.workbench]);
 const current=(key,ticket)=>supported()&&scopeKey()===key&&identity===key&&epoch===ticket;
 const shTime=t=>{const n=typeof t==='number'?t:Date.parse(t);return Number.isFinite(n)?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(n)):'尚无记录';};
 const number=v=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(1):'—';
 const timestamp=t=>typeof t==='number'?t:Date.parse(t);
 function lastReadingTime(){return timestamp(connections[0]?.lastReadingAt||data?.lastReadingAt||data?.latest?.t);}
 function staleReading(){const t=lastReadingTime();return Number.isFinite(t)?Date.now()-t>=30*60*1000:data?.stale===true;}
 function stopPolling(){if(pollTimer!==null){clearInterval(pollTimer);pollTimer=null;}if(visibilityBound){document.removeEventListener('visibilitychange',onVisible);visibilityBound=false;}}
 function canPoll(){
  const node=document.querySelector('#cgm-panel');
  if(!node||!node.isConnected){stopPolling();return false;}
  if(!supported()||identity!==scopeKey()){stopPolling();return false;}
  if(document.hidden||document.visibilityState==='hidden'||writing||busy||document.querySelector('#cgm-connect-form'))return false;
  const rect=node.getBoundingClientRect();return rect.bottom>0&&rect.top<window.innerHeight;
 }
 function poll(){if(canPoll())refresh();}
 function onVisible(){if(!document.hidden&&document.visibilityState!=='hidden')poll();}
 function startPolling(){if(pollTimer===null)pollTimer=setInterval(poll,60000);if(!visibilityBound){document.addEventListener('visibilitychange',onVisible);visibilityBound=true;}}
 function safeError(e,connecting=false){
  if(e?.uncertainWrite)return '操作结果尚未确认，请刷新连接状态后再决定是否重试。';
  if(e?.status===401)return '登录状态已失效，请重新登录工作台。';
  if(e?.status===429||['rate_limited','cgm_rate_limited'].includes(e?.code))return '平台请求较频繁，请稍后再试。';
  if(['auth_failed','authentication_failed','cgm_auth_failed','provider_auth_failed','invalid_credentials'].includes(e?.code))return '平台账号或密码未通过验证，请核对后重试。';
  if(e?.status===400)return connecting?'请核对手机号、密码及同步授权后重试。':'操作未完成，请刷新连接状态后重试。';
  if(e?.status===409)return '连接状态已发生变化，请先刷新后再操作。';
  return connecting?'暂时无法连接该平台，请核对账号密码或稍后重试。':'暂时无法读取或同步，请稍后刷新重试。';
 }
 function clearForm(){const p=document.querySelector('#cgm-connect-form input[name="password"]');if(p)p.value='';}
 function cleanup(){clearForm();stopPolling();epoch++;controller?.abort();controller=null;identity=null;connections=[];providers=[];data=null;chosenDate='';loaded=false;busy=false;writing=false;error='';container=null;lastLoadedAt=null;}
 function ensureScope(){if(identity!==scopeKey()){cleanup();identity=scopeKey();}}
 function card(){
  if(!supported())return ctx.workbench==='health'?`<section class="card cgm-panel cgm-disabled"><div class="card-head"><h2 class="card-title">动态血糖 CGM</h2></div><div class="cgm-body"><p>切换到个人空间后，可连接自己的 CGM 平台。</p></div></section>`:'';
  ensureScope();
  return `<section class="card cgm-panel" id="cgm-panel" aria-label="动态血糖 CGM">${body()}</section>`;
 }
 function connectionStatus(c){
  if(!c.enabled)return '已暂停自动同步';
  if(['auth_error','auth_failed','reauth_required','needs_auth','expired','reconnect_required'].includes(c.status))return '需要重新连接';
  if(['error','sync_error','failed','unavailable'].includes(c.status)||c.lastError)return '上次同步未完成';
  return '自动同步已开启';
 }
 function body(){
  const c=connections[0];
  return `<div class="card-head"><div><h2 class="card-title">动态血糖 <span class="subtitle">CGM</span></h2><p class="cgm-subtitle">独立保存传感器数据，与手动血糖记录分开展示。</p></div><button class="text-btn" data-action="cgm-refresh" ${busy?'disabled':''}>${icon('activity',15)} 刷新</button></div><div class="cgm-body" ${busy?'aria-busy="true"':''}>${error?`<div class="cgm-message error" role="alert">${esc(error)} <button class="text-btn" data-action="cgm-refresh">重试</button></div>`:''}${!loaded?`<p class="cgm-loading" role="status">正在读取连接状态…</p>`:!c?`<div class="cgm-empty">${icon('metric',30)}<div><h3>连接你的 CGM 平台</h3><p>连接后，每 5 分钟自动同步一次。即使关闭工作台，服务器也会继续同步。</p></div>${btn('连接 CGM 平台','cgm-connect','primary','plus')}</div><p class="cgm-fineprint">当前支持硅基轻享。原厂 App 仍需正常向云端上传数据。</p>${data?.points?.length?`<p class="cgm-message">连接已断开，已同步的历史数据仍然保留。</p>`:''}`:`<div class="cgm-connection"><div><strong>${esc(c.providerName||'硅基轻享')}</strong><span class="cgm-account">${esc(c.accountMasked||'已连接账号')}</span></div><span class="pill ${c.lastError?'cgm-warning':''}">${esc(connectionStatus(c))}</span></div><dl class="cgm-sync-meta"><div><dt>上次同步</dt><dd>${esc(shTime(c.lastSyncAt))}</dd></div><div><dt>最新数据时间</dt><dd>${esc(shTime(c.lastReadingAt||data?.latest?.t||data?.lastReadingAt))}</dd></div></dl>${c.lastError?`<p class="cgm-message error">同步未完成，可手动重试；如密码已修改，请重新连接。</p>`:''}<div class="cgm-actions">${btn(busy?'正在处理…':'立即同步','cgm-sync:'+c.id,'','activity')}${btn(c.enabled?'暂停自动同步':'继续自动同步',(c.enabled?'cgm-pause:':'cgm-resume:')+c.id)}${btn('重新连接','cgm-connect')}${btn('断开连接','cgm-disconnect:'+c.id)}</div>`}${loaded&&(c||data?.lastReadingAt||data?.latest||data?.points?.length)?readings():''}${lastLoadedAt?`<p class="cgm-fineprint cgm-page-updated">页面更新于 ${esc(shTime(lastLoadedAt))} · 可见时每分钟刷新</p>`:''}<p class="cgm-fineprint">云端同步依赖原厂 App 上传，可能存在延迟；本页面仅展示记录，不替代原厂报警或医疗判断。</p></div>`;
 }
 function chart(points,date){
  if(!points.length)return `<div class="cgm-chart-empty">${icon('activity',26)}<p>这一天还没有同步到动态血糖数据</p></div>`;
  const start=Date.parse(date+'T00:00:00+08:00');
  const valid=points.filter(p=>p&&typeof p.t==='number'&&Number.isFinite(p.t)&&typeof p.value==='number'&&Number.isFinite(p.value)&&p.value>0&&p.value<=100&&p.t>=start&&p.t<start+86400000).sort((a,b)=>a.t-b.t);
  if(!valid.length)return `<div class="cgm-chart-empty"><p>这一天还没有可展示的读数</p></div>`;
  const sampled=valid.length<=300?valid:Array.from({length:300},(_,i)=>valid[Math.round(i*(valid.length-1)/299)]);
  let lo=Math.min(...valid.map(p=>p.value)),hi=Math.max(...valid.map(p=>p.value));
  const pad=Math.max((hi-lo)*.2,.5);lo=Math.max(0,lo-pad);hi+=pad;
  const x=t=>46+(t-start)/86400000*472,y=v=>20+(hi-v)/(hi-lo)*140;
  // Do not draw a continuous line across more than 20 minutes of missing data.
  let path='';sampled.forEach((p,i)=>{path+=`${!i||p.t-sampled[i-1].t>1200000?'M':'L'}${x(p.t).toFixed(2)} ${y(p.value).toFixed(2)} `;});
  return `<div class="cgm-chart"><svg viewBox="0 0 550 205" role="img" aria-label="${esc(date)}动态血糖曲线，${valid.length}个读数，横轴为北京时间00点至24点">${[0,1,2,3].map(i=>{const v=lo+(hi-lo)*i/3,yy=y(v);return `<line x1="46" y1="${yy.toFixed(2)}" x2="518" y2="${yy.toFixed(2)}" stroke="#e5ebe6" stroke-dasharray="3 4"/><text x="37" y="${(yy+4).toFixed(2)}" text-anchor="end">${v.toFixed(1)}</text>`;}).join('')}<path d="${path}" fill="none" stroke="#2c6b51" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${valid.length===1?`<circle cx="${x(valid[0].t).toFixed(2)}" cy="${y(valid[0].value).toFixed(2)}" r="4" fill="#2c6b51"/>`:''}${[0,6,12,18,24].map(h=>`<text x="${46+h/24*472}" y="190" text-anchor="middle">${String(h).padStart(2,'0')}:00</text>`).join('')}</svg></div>`;
 }
 function readings(){
  const date=chosenDate||ctx.today,points=Array.isArray(data?.points)?data.points:[],summary=data?.summary||{},latest=data?.latest;
  return `<section class="cgm-readings" aria-label="单日动态血糖"><div class="cgm-chart-head"><h3>单日血糖曲线</h3><label class="cgm-date-label">日期<input id="cgm-date" aria-label="CGM 曲线日期" type="date" value="${esc(date)}" max="${esc(ctx.today)}"></label></div>${staleReading()&&connections.length?`<p class="cgm-message" role="status">${Number.isFinite(lastReadingTime())?'最新数据已超过 30 分钟未更新':'尚未收到平台的最新数据'}，请检查原厂 App 是否正常上传。</p>`:''}${latest&&typeof latest.value==='number'&&Number.isFinite(latest.value)?`<div class="cgm-latest"><small>最新同步读数</small><strong>${number(latest.value)} <span>mmol/L</span></strong><time>${esc(shTime(latest.t))}</time></div>`:''}${chart(points,date)}<dl class="cgm-summary"><div><dt>数据点</dt><dd>${Number.isSafeInteger(summary.count)&&summary.count>=0?summary.count:points.length}</dd></div><div><dt>平均</dt><dd>${number(summary.mean)}</dd></div><div><dt>最低</dt><dd>${number(summary.min)}</dd></div><div><dt>最高</dt><dd>${number(summary.max)}</dd></div></dl><p class="cgm-fineprint">单位 mmol/L · 北京时间 · 空缺时段不补值</p></section>`;
 }
 function paint(){const node=document.querySelector('#cgm-panel');if(node&&supported()&&identity===scopeKey()){node.innerHTML=body();container=node;bindDate();}}
 function bindDate(){const input=document.querySelector('#cgm-date');if(input)input.onchange=()=>{if(/^\d{4}-\d{2}-\d{2}$/.test(input.value)&&input.value<=ctx.today){chosenDate=input.value;refresh();}};}
 async function refresh(){
  if(!supported()||writing)return;ensureScope();const key=identity,ticket=++epoch,sourceSpace=ctx.space,sourceWorkbench=ctx.workbench;
  controller?.abort();const abort=new AbortController();controller=abort;busy=true;error='';paint();
  try{
   const date=chosenDate||ctx.today;
   const [ps,cs,ds]=await Promise.all([ctx.api('/api/cgm/providers',{signal:abort.signal},sourceSpace,sourceWorkbench),ctx.api('/api/cgm/connections',{signal:abort.signal},sourceSpace,sourceWorkbench),ctx.api('/api/cgm/readings?date='+encodeURIComponent(date),{signal:abort.signal},sourceSpace,sourceWorkbench)]);
   if(!current(key,ticket))return;
   providers=Array.isArray(ps.providers)?ps.providers.filter(p=>p.id==='silite'):[];
   connections=Array.isArray(cs.connections)?cs.connections:[];data=ds;loaded=true;busy=false;lastLoadedAt=Date.now();paint();
  }catch(e){if(!current(key,ticket)||abort.signal.aborted)return;loaded=true;busy=false;error=safeError(e);paint();}
 }
 function mount(){
  const node=document.querySelector('#cgm-panel');if(!node){stopPolling();if(container&&!writing){controller?.abort();epoch++;container=null;busy=false;}return;}
  if(!supported()){cleanup();return;}ensureScope();
  startPolling();if(container===node)return;container=node;bindDate();if(!writing)refresh();
 }
 function connectForm(){
  if(!supported())return;ensureScope();const key=identity,sourceSpace=ctx.space,sourceWorkbench=ctx.workbench;
  const list=providers.length?providers:[{id:'silite',name:'硅基轻享'}];
  ctx.openDrawer(`<form id="cgm-connect-form" autocomplete="off"><div class="field"><label for="cgm-provider">CGM 平台</label><select id="cgm-provider" name="provider">${list.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select><small>当前支持硅基轻享，其他平台暂未接入。</small></div><div class="field"><label for="cgm-username">平台账号（手机号）</label><input id="cgm-username" name="username" type="tel" inputmode="numeric" autocomplete="off" maxlength="11" pattern="1[0-9]{10}" required placeholder="原厂 App 的手机号"></div><div class="field"><label for="cgm-password">平台密码</label><input id="cgm-password" name="password" type="password" autocomplete="new-password" maxlength="128" required placeholder="原厂 App 的登录密码"></div><div class="cgm-connect-note"><p>首次连接会同步云端最近 7 天的数据，之后每 5 分钟持续同步并保存。</p><p>账号密码由工作台服务器加密保存，用于自动续期；不会在页面中回显。硅基轻享使用非官方云端接口，平台更新可能影响同步，原厂 App 仍需保持正常上传。</p></div><label class="cgm-consent"><input name="consent" type="checkbox" required><span>同意将该平台账号的动态血糖同步到当前健康工作台，并自动持续同步</span></label><div id="cgm-connect-error" role="alert"></div></form>`,'连接 CGM 平台','只连接你本人有权使用的平台账号',`${btn('取消','close')}<button type="submit" form="cgm-connect-form" class="btn primary" disabled>连接并同步</button>`);
  const form=document.querySelector('#cgm-connect-form'),submit=document.querySelector('button[form="cgm-connect-form"]');
  form.elements.consent.onchange=()=>{submit.disabled=!form.elements.consent.checked;};
  form.onsubmit=async event=>{
   event.preventDefault();if(scopeKey()!==key||identity!==key||!supported()||!form.isConnected)return;
   const values=new FormData(form);if(values.get('consent')!=='on')return;
   const username=String(values.get('username')||'').trim(),password=String(values.get('password')||'');
   const target=form.querySelector('#cgm-connect-error');
   if(!/^1\d{10}$/.test(username)||!password||password.length>128){target.innerHTML='<p class="form-error">请填写有效手机号、平台密码，并确认同步授权。</p>';return;}
   const ticket=++epoch;controller?.abort();const abort=new AbortController();controller=abort;writing=true;submit.disabled=true;submit.textContent='正在验证并同步…';target.replaceChildren();
   try{
    await ctx.api('/api/cgm/connections',{method:'POST',body:JSON.stringify({provider:String(values.get('provider')),username,password,consent:true}),signal:abort.signal,timeoutMs:60000},sourceSpace,sourceWorkbench);
    if(!current(key,ticket)||!form.isConnected)return;writing=false;form.elements.password.value='';ctx.closeDrawer();ctx.toast('CGM 已连接，自动同步已开启');await refresh();
   }catch(e){if(!current(key,ticket)||abort.signal.aborted||!form.isConnected)return;target.innerHTML=`<p class="form-error">${esc(safeError(e,true))}</p>`;}
   finally{if(current(key,ticket))writing=false;if(form.isConnected&&scopeKey()===key){submit.disabled=!form.elements.consent.checked;submit.textContent='连接并同步';}}
  };
 }
 async function change(action,id){
  if(!supported()||busy||writing)return;ensureScope();const key=identity,ticket=++epoch,sourceSpace=ctx.space,sourceWorkbench=ctx.workbench;
  controller?.abort();const abort=new AbortController();controller=abort;busy=true;writing=true;error='';paint();
  try{
   await ctx.api('/api/cgm/connections/'+encodeURIComponent(id)+(action==='disconnect'?'':'/'+action),{method:action==='disconnect'?'DELETE':'POST',body:JSON.stringify({}),signal:abort.signal,timeoutMs:60000},sourceSpace,sourceWorkbench);
   if(!current(key,ticket))return;
   writing=false;if(action==='disconnect')ctx.closeDrawer();ctx.toast(({sync:'CGM 同步已完成',pause:'已暂停自动同步',resume:'自动同步已继续',disconnect:'已断开连接，历史数据保留'})[action]);busy=false;await refresh();
  }catch(e){if(!current(key,ticket)||abort.signal.aborted)return;writing=false;busy=false;error=safeError(e);paint();ctx.toast(error);}
 }
 async function handle(action,id){
  if(!supported())return;
  if(action==='cgm-refresh')return refresh();
  if(action==='cgm-connect')return connectForm();
  if(action==='cgm-disconnect'){
   const c=connections.find(x=>x.id===id);if(!c)return;
   const key=identity;
   ctx.openDrawer(`<div class="cgm-disconnect"><p>断开${esc(c.providerName||'硅基轻享')}（${esc(c.accountMasked||'已连接账号')}）后，工作台将删除该连接保存的账号凭据并停止自动同步。</p><p>已同步的血糖历史仍然保留。</p></div>`,'断开 CGM 连接','确认后可随时重新连接',`${btn('取消','close')}${btn('确认断开','cgm-confirm-disconnect:'+id,'primary')}`);
   const drawer=document.querySelector('.drawer');if(drawer)drawer.dataset.cgmOwner=key;return;
  }
  if(action==='cgm-confirm-disconnect'){
   const drawer=document.querySelector('.drawer');if(drawer?.dataset.cgmOwner!==identity||identity!==scopeKey())return;return change('disconnect',id);
  }
  const operation={'cgm-sync':'sync','cgm-pause':'pause','cgm-resume':'resume'}[action];if(operation&&connections.some(c=>c.id===id))return change(operation,id);
 }
 return {card,mount,handle,cleanup};
}
