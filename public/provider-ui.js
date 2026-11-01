import { institutions } from './institutions.js';
const normalize=value=>String(value||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const names=p=>[p.name,...(p.aliases||[])];
const hospitalBuildingIcon=()=>`<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#668371" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17M7 10H4a1 1 0 0 0-1 1v10m14-11h3a1 1 0 0 1 1 1v10M2 21h20M10 21v-4h4v4M12 6v4m-2-2h4M10 13h.01M14 13h.01M4.5 14h.01M4.5 17h.01M19.5 14h.01M19.5 17h.01"/></svg>`;
export function resolveInstitution(visit){
 if(visit.hospitalId)return institutions.find(p=>p.id===visit.hospitalId)||null;
 const hospital=normalize(visit.hospital);if(!hospital)return null;
 const city=normalize(visit.city).replace(/市$/,'');
 const ambiguous=new Set(['省医院','省人民医院','人民医院','协和医院','中山医院','同济医院','鼓楼医院']);
 const matches=institutions.filter(p=>names(p).some(name=>normalize(name)===hospital));
 const candidates=city?matches.filter(p=>!p.city||normalize(p.city).replace(/市$/,'')===city):matches;
 if(!city&&ambiguous.has(hospital))return null;
 return candidates.length===1?candidates[0]:null;
}
export function institutionMark(visit,{esc,icon}){const p=resolveInstitution(visit);const crest=['sichuan-people','shanghai-ruijin','wuhan-tongji','wuhan-union','zju-first','nanjing-gulou','chongqing-xinqiao','rich-healthcare'].includes(p?.id);const dark=['west-china','wuhan-union','zju-first'].includes(p?.id);return `<span class="institution-mark${p?.logo?' has-logo':''}${p?.logo&&crest?' logo-crest':''}${p?.logo&&dark?' logo-dark':''}" aria-label="${esc(p?p.name:'机构待补充')}">${p?.logo?`<img src="${esc(p.logo)}" alt="${esc(p.name)}标识" loading="lazy" data-institution-logo><span hidden>${hospitalBuildingIcon()}</span>`:hospitalBuildingIcon()}</span>`;}
export function institutionFields(visit,{field,esc}){return `<div class="field institution-picker"><label for="institution-search">查找医院 / 体检机构</label><input id="institution-search" type="search" autocomplete="off" placeholder="输入机构、城市或别名"><div id="institution-results" class="institution-results" role="group" aria-label="机构搜索结果"></div></div><input type="hidden" name="hospitalId" value="${esc(visit.hospitalId||'')}">${field('实际就诊医院 / 分院（可自定义）','hospital',visit.hospital||'','text','maxlength="250" placeholder="未找到时直接填写机构全名"')}<div class="form-grid">${field('实际就诊城市','city',visit.city||'','text','maxlength="100" placeholder="例如 上海；连锁机构请手动填写"')}${field('科室','department',visit.department||'','text','maxlength="250"')}</div><p class="section-desc" id="institution-selection-state">选择目录仅补充机构标识；城市请按本次就诊地点核对。</p>`;}
export function bindInstitutionPicker(form,{esc,icon}){
 const search=form.querySelector('#institution-search'),results=form.querySelector('#institution-results'),hospital=form.elements.hospital,id=form.elements.hospitalId,city=form.elements.city,hint=form.querySelector('#institution-selection-state');
 let selected=institutions.find(p=>p.id===id.value)||null;
 const render=()=>{const query=normalize(search.value);const matches=query?institutions.filter(p=>[...names(p),p.city].some(value=>normalize(value).includes(query))).slice(0,12):[];results.innerHTML=query?(matches.length?matches.map(p=>`<button type="button" data-institution-id="${esc(p.id)}">${institutionMark({hospitalId:p.id},{esc,icon})}<span><strong>${esc(p.name)}</strong><small>${esc(p.city||'多城市 · 请填写实际就诊城市')}</small></span></button>`).join(''):'<p class="muted">未找到匹配机构，可在下方直接填写医院 / 分院和城市，使用通用标识。</p>'):'';};
 search.addEventListener('input',render);
 results.addEventListener('click',e=>{const button=e.target.closest('[data-institution-id]');if(!button)return;selected=institutions.find(p=>p.id===button.dataset.institutionId);id.value=selected.id;hospital.value=selected.name;city.value=selected.city||'';search.value='';render();hint.textContent=selected.city?'已选择机构，请核对实际就诊城市与分院。':'已选择连锁机构，请手动填写本次就诊城市与分院。';hospital.dispatchEvent(new Event('change',{bubbles:true}));city.dispatchEvent(new Event('change',{bubbles:true}));});
 hospital.addEventListener('input',()=>{if(!selected)return;const current=normalize(hospital.value);const stillSelected=names(selected).some(name=>{const n=normalize(name);return current===n||(current.startsWith(n)&&/^(?:[（(].+[)）]|.*(?:分院|院区|门诊部))$/.test(current.slice(n.length)));});if(!stillSelected){selected=null;id.value='';hint.textContent='已改为自定义机构，使用通用标识。可重新搜索选择目录。';}});
}

if(typeof document!=='undefined')document.addEventListener('error',event=>{if(event.target.matches?.('[data-institution-logo]')){event.target.hidden=true;event.target.nextElementSibling.hidden=false;}},true);
