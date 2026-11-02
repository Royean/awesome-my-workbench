// Local Leaflet code; third-party tiles are requested only after an explicit UI action.
let leafletLoad;
const mounts=new WeakMap();
export function travelMapPoints(points){return (Array.isArray(points)?points:[]).filter(p=>p&&typeof p.lat==='number'&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&typeof p.lng==='number'&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180).slice(0,1000);}
function loadLeaflet(){
 if(leafletLoad)return leafletLoad;
 leafletLoad=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='/vendor/leaflet-1.9.4/leaflet.js';script.async=true;
  const css=document.createElement('link');css.rel='stylesheet';css.href='/vendor/leaflet-1.9.4/leaflet.css';
  let cssReady=false,jsReady=!!window.L?.map;
  const fail=()=>{clearTimeout(timer);script.remove();css.remove();reject(Error('地图组件加载失败'));};
  const complete=()=>{if(cssReady&&jsReady){clearTimeout(timer);resolve(window.L);}};
  const timer=setTimeout(fail,12000);
  script.onload=()=>{jsReady=!!window.L?.map;jsReady?complete():fail();};script.onerror=fail;
  css.onload=()=>{cssReady=true;complete();};css.onerror=fail;
  document.head.append(css);if(!jsReady)document.head.append(script);
 }).catch(error=>{leafletLoad=undefined;throw error;});
 return leafletLoad;
}
export function mountTravelMap(container,{points=[],onPick}={}){
 if(!container||typeof container.replaceChildren!=='function')return ()=>{};
 mounts.get(container)?.();
 let stopped=false,map,observer,picked;
 const surface=document.createElement('div');surface.className='travel-map-surface';surface.setAttribute('aria-label','旅行地点地图');
 const status=document.createElement('p');status.className='travel-map-status';status.setAttribute('role','status');status.textContent='正在加载地图…';
 container.replaceChildren(surface,status);
 const cleanup=()=>{if(stopped)return;stopped=true;observer?.disconnect();map?.remove();if(mounts.get(container)===cleanup)mounts.delete(container);};
 mounts.set(container,cleanup);
 loadLeaflet().then(L=>{
  if(stopped||!surface.isConnected)return;
  const valid=travelMapPoints(points);
  map=L.map(surface,{scrollWheelZoom:false,worldCopyJump:true,minZoom:2,maxZoom:19}).setView(valid.length?[valid[0].lat,valid[0].lng]:[35,105],valid.length?12:4);
  const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).addTo(map);
  let failed=false;
  tiles.on('tileerror',()=>{failed=true;if(!stopped)status.textContent='底图暂时无法加载。地点清单、已存坐标和外部地图入口仍可使用。';});
  tiles.on('load',()=>{if(!stopped&&!failed)status.textContent=onPick?'点击地图选择地点坐标；滚动页面不会缩放地图。':'点选标记查看地点；路线和路况请在导航应用中查看。';});
  const bounds=[];
  valid.forEach((point,i)=>{
   const content=document.createElement('span');content.textContent=String(point.title||'地点');
   L.marker([point.lat,point.lng],{icon:L.divIcon({className:'travel-map-marker',html:String(i+1),iconSize:[28,28],iconAnchor:[14,28]}),title:String(point.title||'地点'),keyboard:true}).addTo(map).bindPopup(content);
   bounds.push([point.lat,point.lng]);
  });
  if(bounds.length>1)map.fitBounds(bounds,{padding:[24,24],maxZoom:14});
  if(onPick)map.on('click',event=>{
   if(stopped)return;
   const lat=Number(Math.max(-90,Math.min(90,event.latlng.lat)).toFixed(6));
   const lng=Number((((event.latlng.lng+180)%360+360)%360-180).toFixed(6));
   if(picked)map.removeLayer(picked);
   picked=L.circleMarker([lat,lng],{radius:8,color:'#356A98',fillOpacity:.8}).addTo(map);
   status.textContent='已选坐标，可继续填写地点名称并保存。';onPick({lat,lng});
  });
  if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(()=>{if(!stopped)map.invalidateSize({pan:false});});observer.observe(surface);}
 }).catch(()=>{if(!stopped)status.textContent='地图暂时无法加载，请稍后重试。地点清单与外部地图入口仍可使用。';});
 return cleanup;
}
