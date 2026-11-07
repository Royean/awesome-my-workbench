import {test} from 'node:test';
import assert from 'node:assert/strict';
import {latestStepRecord} from '../public/capture.js';

test('latest steps retain explicit zero, ignore future dates and never add snapshots or manual records together',()=>{
 const rows=[
  {id:'old',kind:'metric',type:'steps',date:'2026-11-04',value:7500},
  {id:'new',kind:'metric',type:'steps',date:'2026-11-05',value:0,source:'health-connect',observedAt:'2026-11-05T03:00:00Z'},
  {id:'manual',kind:'metric',type:'steps',date:'2026-11-05',value:100},
  {id:'future',kind:'metric',type:'steps',date:'2026-11-06',value:9999},
  {id:'weight',kind:'metric',type:'weight',date:'2026-11-05',value:60},
 ];
 const before=structuredClone(rows);
 assert.equal(latestStepRecord(rows,'2026-11-05').id,'new');
 assert.equal(latestStepRecord(rows,'2026-11-05').value,0);
 assert.equal(latestStepRecord(rows,'2026-11-04').id,'old');
 assert.equal(latestStepRecord(rows,'2026-11-03'),null);
 assert.deepEqual(rows,before);
});
