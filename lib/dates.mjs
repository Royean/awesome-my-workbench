export const DATE_ERROR='日期格式不对，请按 2026-11-01 这样填写';
// Strict YYYY-MM-DD that is a real calendar date (rejects 2026-02-30). Never throws.
export function isValidDate(v){
 if(typeof v!=='string')return false;
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v);if(!m)return false;
 const y=+m[1],mo=+m[2],d=+m[3];if(mo<1||mo>12||d<1)return false;
 const leap=(y%4===0&&y%100!==0)||y%400===0;return d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][mo-1];
}
