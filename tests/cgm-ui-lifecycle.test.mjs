import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCgmUI} from '../public/cgm.js';
test('CGM visible refresh, stale data and scope cleanup have one bounded timer',async()=>{
const original={setInterval,clearInterval,now:Date.now};
let clock=Date.parse('2026-11-01T14:00:00Z'),ticks=new Map(),next=0,visibleRect={top:0,bottom:300},form=false,calls=0;
const listeners=new Map();let node={isConnected:true,innerHTML:'',getBoundingClientRect:()=>visibleRect};
globalThis.window={innerHeight:844};globalThis.document={hidden:false,visibilityState:'visible',querySelector:s=>s==='#cgm-panel'?node:s==='#cgm-connect-form'&&form?{}:null,addEventListener:(s,fn)=>listeners.set(s,fn),removeEventListener:(s,fn)=>{if(listeners.get(s)===fn)listeners.delete(s);}};
globalThis.setInterval=(fn,ms)=>{assert.equal(ms,60000);ticks.set(++next,fn);return next;};globalThis.clearInterval=id=>ticks.delete(id);Date.now=()=>clock;
const readingAt=clock-300000;
const ctx={space:'personal',workbench:'health',today:'2026-11-01',userId:'fictional',esc:x=>String(x??''),icon:()=>'',btn:()=>'',api:async(url)=>{calls++;if(url.includes('providers'))return {providers:[{id:'silite',name:'硅基轻享'}]};if(url.includes('connections'))return {connections:[{id:'fictional-1',provider:'silite',enabled:true,lastReadingAt:readingAt}]};return {points:[{t:readingAt,value:5}],latest:{t:readingAt,value:5},lastReadingAt:readingAt,stale:false,summary:{count:1,min:5,max:5,mean:5}};}};
const flush=()=>new Promise(r=>setImmediate(r));
try{
 const ui=createCgmUI(ctx);ui.card();ui.mount();ui.mount();await flush();assert.equal(ticks.size,1);assert.equal(listeners.size,1);assert.equal(calls,3);assert.match(node.innerHTML,/页面更新于/);assert.doesNotMatch(node.innerHTML,/超过 30 分钟/);
 const tick=[...ticks.values()][0];clock+=31*60000;tick();await flush();assert.equal(calls,6);assert.match(node.innerHTML,/超过 30 分钟/);
 document.hidden=true;document.visibilityState='hidden';tick();await flush();assert.equal(calls,6);
 document.hidden=false;document.visibilityState='visible';form=true;tick();await flush();assert.equal(calls,6);form=false;
 visibleRect={top:900,bottom:1300};tick();await flush();assert.equal(calls,6);visibleRect={top:0,bottom:300};
 listeners.get('visibilitychange')();await flush();assert.equal(calls,9);
 node=null;tick();await flush();assert.equal(ticks.size,0);assert.equal(listeners.size,0);
 node={isConnected:true,innerHTML:'',getBoundingClientRect:()=>visibleRect};ui.mount();await flush();assert.equal(ticks.size,1);assert.equal(calls,12);
 ui.cleanup();assert.equal(ticks.size,0);assert.equal(listeners.size,0);tick();await flush();assert.equal(calls,12);
 ctx.space='demo';assert.match(ui.card(),/切换到个人空间/);ui.mount();await flush();assert.equal(calls,12);
}finally{globalThis.setInterval=original.setInterval;globalThis.clearInterval=original.clearInterval;Date.now=original.now;delete globalThis.document;delete globalThis.window;}
});
