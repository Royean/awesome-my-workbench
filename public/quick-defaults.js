// Pure defaults for the quick-capture sheets (unit-tested in tests/quick-defaults.test.mjs).
// Meal type by Asia/Shanghai local hour:
//   05:00–09:59 早餐 · 10:00–14:59 午餐 · 15:00–16:59 加餐 · 17:00–21:59 晚餐 · 22:00–04:59 加餐
export function mealTypeForHour(hour){const h=Number(hour);return h>=5&&h<10?'早餐':h>=10&&h<15?'午餐':h>=17&&h<22?'晚餐':'加餐';}
export function shanghaiHour(date=new Date()){return Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(date))%24;}
const newest=list=>[...list].sort((a,b)=>(b.date+(b.time||'')+(b.createdAt||'')).localeCompare(a.date+(a.time||'')+(a.createdAt||'')))[0];
// Exercise: type and duration from the newest exercise record; first-time default 步行 · 30 分钟.
export function exerciseDefaults(items=[]){const x=newest(items.filter(i=>i.kind==='exercise'));return {type:x?.type||'步行',duration:Number(x?.duration)>0?Number(x.duration):30};}
// Metric: type of the newest metric record; first-time default weight.
export function lastMetricType(items=[],known=['weight','pressure','glucose','sleep','heart']){const t=newest(items.filter(i=>i.kind==='metric'))?.type;return known.includes(t)?t:'weight';}
// Blood pressure: systolic is complete after 3 digits when it starts with 1–2 (100–299), otherwise after 2 digits (30–99).
export function systolicComplete(value){const v=String(value??'').trim();if(!/^\d+$/.test(v))return false;return /^[12]/.test(v)?v.length>=3:v.length>=2;}
