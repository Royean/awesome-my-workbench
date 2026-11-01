// Escape every source value. Empty reference/flag means unrecorded, never 'normal'.
export function renderReportObservations(rows,esc){
 if(!Array.isArray(rows)||!rows.length)return '';
 return `<section class="report-observations" aria-label="结构化报告指标"><h3 class="clinical-label">报告指标 <span class="subtitle">${rows.length} 项</span></h3><p class="section-desc">按原报告摘录；参考范围和标记仅保留原文，未标记不代表正常。</p><table><thead><tr><th scope="col">项目</th><th scope="col">结果</th><th scope="col">单位</th><th scope="col">参考范围</th><th scope="col">原报告标记</th></tr></thead><tbody>${rows.map(r=>`<tr><th scope="row">${esc(r.label)}${r.code?`<small>${esc(r.code)}</small>`:''}</th><td data-label="结果"><strong>${esc(r.result)}</strong></td><td data-label="单位">${esc(r.unit||'未注明')}</td><td data-label="参考范围">${esc(r.reference||'未注明')}</td><td data-label="原报告标记">${r.flag?`<span class="report-source-flag">${esc(r.flag)}</span>`:'未标记'}</td></tr>`).join('')}</tbody></table></section>`;
}
