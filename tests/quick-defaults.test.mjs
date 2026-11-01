import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mealTypeForHour,shanghaiHour,exerciseDefaults,lastMetricType,systolicComplete} from '../public/quick-defaults.js';
test('meal type follows Asia/Shanghai hour ranges',()=>{
 const expect={0:'加餐',4:'加餐',5:'早餐',9:'早餐',10:'午餐',14:'午餐',15:'加餐',16:'加餐',17:'晚餐',21:'晚餐',22:'加餐',23:'加餐'};
 for(const [h,t] of Object.entries(expect))assert.equal(mealTypeForHour(Number(h)),t,'hour '+h);
 assert.equal(shanghaiHour(new Date('2026-11-01T00:30:00Z')),8);
 assert.equal(shanghaiHour(new Date('2026-11-01T16:00:00Z')),0);
 assert.equal(mealTypeForHour(shanghaiHour(new Date('2026-11-01T04:00:00Z'))),'午餐');
});
test('exercise defaults to newest exercise record type and duration',()=>{
 assert.deepEqual(exerciseDefaults([]),{type:'步行',duration:30});
 const items=[{kind:'exercise',type:'跑步',duration:25,date:'2026-10-30',time:'07:00'},{kind:'exercise',type:'游泳',duration:45,date:'2026-10-31',time:'19:00'},{kind:'meal',date:'2026-11-01'},{kind:'exercise',type:'瑜伽',duration:20,date:'2026-10-31',time:'08:00'}];
 assert.deepEqual(exerciseDefaults(items),{type:'游泳',duration:45});
 assert.deepEqual(exerciseDefaults([{kind:'exercise',type:'骑行',date:'2026-10-01'}]),{type:'骑行',duration:30});
});
test('metric defaults to newest metric type',()=>{
 assert.equal(lastMetricType([]),'weight');
 assert.equal(lastMetricType([{kind:'metric',type:'glucose',date:'2026-10-01'},{kind:'metric',type:'pressure',date:'2026-10-02',time:'08:00'}]),'pressure');
 assert.equal(lastMetricType([{kind:'metric',type:'unknown',date:'2026-10-02'}]),'weight');
});
test('systolic auto-advance after 2–3 digits',()=>{
 for(const v of ['85','99','120','135','200'])assert.equal(systolicComplete(v),true,v);
 for(const v of ['','1','12','2','9','abc'])assert.equal(systolicComplete(v),false,v);
});
