import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTravel,travelDays,travelMapUrl,travelSafeUrl,travelSorted} from '../public/travel.js';
import {workbenchTheme} from '../public/shell.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fixture=()=>({items:[],today:'2026-11-02',page:'dashboard',workbench:'travel',space:'personal',account:{user:{id:'fictional'}},esc,icon:()=>'',btn:(label,action)=>`<button data-action="${esc(action)}">${esc(label)}</button>`,field:()=>''});
const t={id:'trip-a',kind:'travel_trip',title:'虚构旅行',destination:'虚构目的地',date:'2026-11-03',startDate:'2026-11-03',endDate:'2026-11-05',status:'planned'};
test('travel renders an honest empty personal space and labels demo explicitly',()=>{const c=fixture(),u=createTravel(c);assert.match(u.render(),/还没有旅行计划/);assert.doesNotMatch(u.render(),/虚构旅行/);c.space='demo';assert.match(u.render(),/示例空间/);assert.match(u.render(),/体验记录均为虚构/);});
test('travel itinerary groups stops and bookings by local day and excludes other trip records',()=>{const c=fixture();c.items=[t,{id:'s1',kind:'travel_stop',tripId:'trip-a',date:'2026-11-04',time:'10:00',title:'地点甲',category:'attraction'},{id:'b1',kind:'travel_booking',tripId:'trip-a',date:'2026-11-04',time:'09:00',title:'预订甲',bookingType:'hotel',status:'confirmed'},{id:'other',kind:'travel_stop',tripId:'other-trip',date:'2026-11-04',title:'不应展示'}];c.page='trip';const text=createTravel(c).render();assert.match(text,/2026-11-03/);assert.match(text,/DAY 3/);assert.ok(text.indexOf('预订甲')<text.indexOf('地点甲'));assert.doesNotMatch(text,/不应展示/);assert.match(text,/高德地图搜索/);});
test('travel content escapes markup, rejects executable booking links and keeps missing coordinates usable',()=>{const c=fixture();c.items=[{...t,title:'<script>evil</script>'},{id:'s1',kind:'travel_stop',tripId:t.id,date:t.date,title:'<img onerror=evil>',category:'other'},{id:'b1',kind:'travel_booking',tripId:t.id,date:t.date,title:'虚构票据',bookingType:'ticket',status:'planned',referenceUrl:'javascript:alert(1)'}];c.page='places';const u=createTravel(c),map=u.render();assert.match(map,/&lt;script&gt;/);assert.match(map,/&lt;img/);assert.match(map,/未标注坐标/);assert.match(map,/加载地图/);assert.doesNotMatch(map,/<img onerror/);c.page='bookings';assert.doesNotMatch(u.render(),/javascript:|打开预订链接/);});
test('travel map links are fixed HTTPS searches, encoding user text without treating WGS84 as navigation coordinates',()=>{const u=new URL(travelMapUrl({title:'北京 & 上海?<script>',address:'路口#1',lat:30,lng:120}));assert.equal(u.origin,'https://uri.amap.com');assert.equal(u.pathname,'/search');assert.equal(u.searchParams.get('keyword'),'北京 & 上海?<script> 路口#1');assert.equal(u.searchParams.has('position'),false);assert.equal(travelSafeUrl('javascript:alert(1)'),'');assert.equal(travelSafeUrl('https://example.invalid/a'),'https://example.invalid/a');});
test('travel date and ordering helpers respect leap days and do not mutate source rows',()=>{assert.deepEqual(travelDays('2028-02-28','2028-03-01'),['2028-02-28','2028-02-29','2028-03-01']);assert.deepEqual(travelDays('2026-11-04','2026-11-03'),[]);const a=[{title:'late',date:'2026-11-03',time:'16:00'},{title:'early',date:'2026-11-03',time:'09:00'}];assert.equal(travelSorted(a)[0].title,'early');assert.equal(a[0].title,'late');});
test('travel selection is cleared across owner/space changes and its default theme is independent',()=>{const c=fixture();c.items=[t];c.page='trip';const u=createTravel(c);assert.match(u.render(),/虚构旅行/);c.account.user.id='another';c.items=[];assert.doesNotMatch(u.render(),/虚构旅行/);assert.match(u.render(),/先选择或新建/);assert.equal(workbenchTheme(undefined,'travel')['--theme-accent'],'#356A98');assert.equal(workbenchTheme(undefined,'finance')['--theme-accent'],'#A65343');assert.equal(workbenchTheme(undefined,'health')['--theme-accent'],'#2C6B51');});
test('preparation forms allow dates before departure while stop dates stay inside the trip',async()=>{const c=fixture(),fields=[];c.items=[t];c.openDrawer=()=>{};c.toast=()=>{};c.field=(label,name,value,type,attrs)=>{fields.push({name,attrs});return '';};const previous=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:()=>({})}});try{const u=createTravel(c);await u.handle('travel-add','travel_check');assert.equal(fields.find(x=>x.name==='date').attrs,'required');fields.length=0;await u.handle('travel-add','travel_stop');assert.match(fields.find(x=>x.name==='date').attrs,/min="2026-11-03"/);assert.match(fields.find(x=>x.name==='date').attrs,/max="2026-11-05"/);}finally{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;}});
test('travel dashboard summarizes only the selected trip and leaves map loading explicit',()=>{const c=fixture();c.items=[t,{id:'s1',kind:'travel_stop',tripId:t.id,date:t.date,time:'09:00',title:'本次旅行地点'},{id:'check',kind:'travel_check',tripId:t.id,date:c.today,title:'本次准备事项',done:true},{id:'b1',kind:'travel_booking',tripId:t.id,date:t.date,title:'本次预订',status:'confirmed'},{id:'other-stop',kind:'travel_stop',tripId:'other',date:t.date,title:'另一旅行地点'},{id:'other-check',kind:'travel_check',tripId:'other',date:c.today,title:'另一旅行准备事项'}];const html=createTravel(c).render();for(const text of ['旅行总览','每日行程','准备进度','本次旅行地点','本次预订','本次准备事项','加载地图'])assert.match(html,new RegExp(text));assert.doesNotMatch(html,/另一旅行地点|另一旅行准备事项|<img|<iframe/);assert.match(html,/--progress:100%/);assert.match(html,/travel-selected-trip/);});
test('daily travel views omit cancelled bookings before limiting the preview', () => {
  const c = fixture();
  const booking = {kind:'travel_booking',tripId:t.id,date:t.date,bookingType:'flight'};
  const cancelled = {...booking,id:'cancelled-first',title:'取消机票',time:'07:00',status:'cancelled'};
  c.items = [
    t,
    {...booking,id:'confirmed',title:'确认机票',time:'10:00',status:'confirmed'},
    cancelled,
    {...booking,id:'legacy',title:'旧机票',time:'11:00'},
    {kind:'travel_stop',tripId:t.id,date:t.date,id:'stop',title:'参观展览',time:'09:00'},
    {...booking,id:'planned',title:'待确认机票',time:'08:00',status:'planned'},
    {...booking,id:'cancelled-second',title:'取消住宿',date:'2026-11-04',status:'cancelled'},
  ];
  const travel = createTravel(c);
  const preview = () => travel.render().match(/<section class="card domain-day-preview">([\s\S]*?)<\/section>/)[1];
  const previewIds = () => Array.from(preview().matchAll(/class="domain-itinerary-row" data-action="travel-edit:([^"]+)"/g), match => match[1]);
  const orderedIds = ['planned', 'stop', 'confirmed', 'legacy'];
  assert.deepEqual(previewIds(), orderedIds);
  assert.match(travel.render(), /<strong>5<\/strong><small>笔预订记录/);

  c.page = 'trip';
  const itinerary = travel.render();
  const dailyIds = html => Array.from(html.matchAll(/data-action="travel-edit:([^"]+)" aria-label="编辑/g), match => match[1]);
  assert.deepEqual(dailyIds(itinerary), orderedIds);
  assert.match(itinerary, /<h2>2026-11-04<\/h2>.*?<\/header><p class="travel-day-empty">这一天还没有安排/);

  c.page = 'bookings';
  assert.match(travel.render(), /取消机票<\/strong><span class="travel-status cancelled">已取消<\/span>.*?data-action="travel-edit:cancelled-first"/);

  c.page = 'dashboard';
  c.today = '2026-11-04';
  assert.deepEqual(previewIds(), []);
  assert.match(preview(), /这一天还没有安排/);

  cancelled.status = 'confirmed';
  c.today = t.date;
  assert.deepEqual(previewIds(), ['cancelled-first', ...orderedIds.slice(0, 3)]);
  c.page = 'trip';
  assert.deepEqual(dailyIds(travel.render()), ['cancelled-first', ...orderedIds]);
});
