import {test} from 'node:test';
import assert from 'node:assert/strict';
import {travelMapPoints} from '../public/travel-map.js';

test('travel map accepts zero coordinates and rejects untyped or invalid coordinates',()=>{
 const good={id:'fictional',title:'<img src=x onerror=alert(1)>',lat:0,lng:0};
 assert.deepEqual(travelMapPoints([good,{lat:null,lng:null},{lat:'30',lng:100},{lat:91,lng:0},{lat:0,lng:181},{lat:NaN,lng:0}]),[good]);
 assert.deepEqual(travelMapPoints(null),[]);
});

function setup(t){
 const original={window:globalThis.window,document:globalThis.document};
 const requests=[],nodes=[],events={};let maps=0,removed=0;
 const element=tag=>({tag,isConnected:true,textContent:'',setAttribute(){},remove(){},replaceChildren(){}});
 const map={setView(){return this;},fitBounds(){},on(name,handler){events[name]=handler;return this;},remove(){removed++;},removeLayer(){}};
 globalThis.window={L:{map(){maps++;return map;},tileLayer(url,options){requests.push({url,options});return {addTo(){return this;},on(){return this;}};},divIcon:x=>x,marker(){return {addTo(){return this;},bindPopup(content){assert.equal(content.textContent,'<script>fictional</script>');}};},circleMarker(){return {addTo(){return this;}};}}};
 globalThis.document={createElement:element,head:{append(node){nodes.push(node);}}};
 t.after(()=>{globalThis.window=original.window;globalThis.document=original.document;});
 return {nodes,events,requests,container:element('div'),stats:()=>({maps,removed})};
}

test('unmounted travel map never requests external tiles when local library finishes late',async t=>{
 const f=setup(t),{mountTravelMap}=await import('../public/travel-map.js?late');
 const cleanup=mountTravelMap(f.container,{points:[]});cleanup();
 assert.equal(f.requests.length,0);f.nodes.find(n=>n.tag==='link').onload();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.requests.length,0);assert.equal(f.stats().maps,0);
});

test('travel map preserves attribution, limits referrer to origin and releases click handlers on close',async t=>{
 const f=setup(t),{mountTravelMap}=await import('../public/travel-map.js?active');let selection;
 const cleanup=mountTravelMap(f.container,{points:[{id:'fictional',title:'<script>fictional</script>',lat:0,lng:0}],onPick:p=>{selection=p;}});
 assert.equal(f.requests.length,0);f.nodes.find(n=>n.tag==='link').onload();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
 assert.equal(f.requests[0].options.referrerPolicy,'strict-origin-when-cross-origin');assert.match(f.requests[0].options.attribution,/OpenStreetMap/);
 f.events.click({latlng:{lat:30.12345678,lng:190}});assert.deepEqual(selection,{lat:30.123457,lng:-170});
 cleanup();assert.equal(f.stats().removed,1);selection=undefined;f.events.click({latlng:{lat:20,lng:20}});assert.equal(selection,undefined);
});
