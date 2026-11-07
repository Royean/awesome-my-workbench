import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeleteUndo} from '../public/delete-undo.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
const response=id=>({deleted:{id,kind:'task'},undoExpiresAt:900012000,serverNow:900000000});
function fixture(){
 let clock=0,scope={owner:'fictional-owner',space:'personal',workbench:'health'};
 const calls=[],messages=[],events=[];
 const f={calls,messages,events,clock:value=>clock=value,scope:value=>scope=value,
  request:async(url)=>url.startsWith('/api/items/')?response(url.split('/').pop()):{},refresh:async()=>{}};
 f.undo=createDeleteUndo({context:()=>scope,now:()=>clock,api:async(...args)=>{calls.push(args);return f.request(...args);},refresh:()=>{events.push('refresh');return f.refresh();},show:(...args)=>{events.push('show');messages.push(args);},hide:()=>events.push('hide')});
 return f;
}

test('a pending list refresh does not block deletion undo at nine seconds or renew its deadline',async()=>{
 const f=fixture(),refresh=deferred(),refreshStarted=deferred();let refreshes=0;
 f.refresh=()=>{refreshStarted.resolve();return ++refreshes===1?refresh.promise:Promise.resolve();};
 const removing=f.undo.remove('a','健康');await refreshStarted.promise;
 assert.equal(f.messages.length,1);assert.equal(f.messages[0][2],12000);
 assert.ok(f.events.indexOf('show')<f.events.indexOf('refresh'));
 f.clock(9000);await f.undo.restore();
 assert.deepEqual(f.calls[1],['/api/restore',{method:'POST',body:'{"id":"a"}'},'personal','health']);
 assert.equal(f.messages.at(-1)[0],'记录已恢复到健康工作台');
 refresh.resolve();await removing;assert.equal(f.messages.length,2,'late refresh cannot revive the removed action');
});

test('successful DELETE response transit consumes the window, independent of client wall clock',async()=>{
 const f=fixture(),pending=deferred();f.request=()=>pending.promise;
 const removing=f.undo.remove('a','健康');f.clock(4800);pending.resolve(response('a'));await removing;
 assert.equal(f.messages[0][2],7200);
 f.clock(12000);await assert.rejects(f.undo.restore(),/撤销已失效/);
 assert.equal(f.calls.length,1,'expired click must not send restore');
});

test('an already expired slow response offers no action; old servers fall back from request start',async()=>{
 for(const result of [response('a'),{deleted:{id:'a'}}]){
  const f=fixture(),pending=deferred();f.request=()=>pending.promise;
  const removing=f.undo.remove('a','健康');f.clock(13000);pending.resolve(result);await removing;
  assert.equal(f.messages.length,1);assert.equal(f.messages[0][1],undefined);
  await assert.rejects(f.undo.restore(),/撤销已失效/);assert.equal(f.calls.length,1);
 }
 const f=fixture();f.request=async()=>({deleted:{id:'a'}});f.clock(1000);await f.undo.remove('a','健康');
 f.clock(10000);await f.undo.restore();assert.equal(f.calls.length,2);
});

test('invalid or partial metadata cannot create an action, and oversized metadata cannot extend twelve seconds',async()=>{
 for(const metadata of [{undoExpiresAt:1},{serverNow:1},{undoExpiresAt:'900012000',serverNow:900000000},{undoExpiresAt:null,serverNow:null},{undoExpiresAt:900000000,serverNow:900000001}]){
  const f=fixture();f.request=async()=>({deleted:{id:'a'},...metadata});await f.undo.remove('a','健康');
  assert.equal(f.messages[0][1],undefined);await assert.rejects(f.undo.restore());assert.equal(f.calls.length,1);
 }
 const f=fixture();f.request=async()=>({...response('a'),undoExpiresAt:999999999});await f.undo.remove('a','健康');
 f.clock(12000);await assert.rejects(f.undo.restore());assert.equal(f.calls.length,1);
});

test('owner, space and workbench changes suppress late success and failure in the new source',async()=>{
 for(const change of [{owner:'other'},{space:'demo'},{workbench:'custom'}])for(const fail of [false,true]){
  const f=fixture(),pending=deferred();f.request=()=>pending.promise;
  let closed=false;const removing=f.undo.remove('a','健康',()=>closed=true);
  f.scope({owner:'fictional-owner',space:'personal',workbench:'health',...change});
  if(fail)pending.reject(Error('old failure'));else pending.resolve(response('a'));
  await removing;assert.equal(closed,false);assert.equal(f.messages.length,0);assert.equal(f.events.includes('refresh'),false);
 }
});

test('clearing the source also invalidates a late response after switching away and back',async()=>{
 const f=fixture(),pending=deferred();f.request=()=>pending.promise;
 const removing=f.undo.remove('a','健康');f.undo.clear();pending.resolve(response('a'));await removing;
 assert.equal(f.messages.length,0);assert.equal(f.events.includes('refresh'),false);
});

test('new deletion supersedes earlier pending response; dismiss cannot resurrect its action',async()=>{
 const f=fixture(),first=deferred();f.request=async url=>url.endsWith('/a')?first.promise:response('b');
 const removing=f.undo.remove('a','健康');await f.undo.remove('b','健康');first.resolve(response('a'));await removing;
 assert.equal(f.messages.length,1);f.undo.dismiss();await assert.rejects(f.undo.restore());
 assert.equal(f.calls.length,2);
});

test('restore is single use, reports current failures, and suppresses results after source invalidation',async()=>{
 const f=fixture();await f.undo.remove('a','健康');const pending=deferred();f.request=()=>pending.promise;
 const restoring=f.undo.restore();await assert.rejects(f.undo.restore());assert.equal(f.calls.length,2);
 f.undo.clear();pending.resolve({});await restoring;assert.equal(f.messages.length,1);
 const g=fixture();await g.undo.remove('a','健康');g.request=async()=>{throw Error('server expired');};
 await assert.rejects(g.undo.restore(),/server expired/);await assert.rejects(g.undo.restore(),/撤销已失效/);
 assert.equal(g.calls.length,2);
});
