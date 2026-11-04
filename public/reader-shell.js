const PREFERENCE_KEY='reading-appearance-v1';
export function readerPreferences(value){return {theme:['white','sepia','night'].includes(value?.theme)?value.theme:'sepia',fontSize:Number.isFinite(value?.fontSize)?Math.max(16,Math.min(30,Math.round(value.fontSize))):21};}
// The existing drawer remains the dialog owner (Escape, focus trap, scope changes).
export function mountReaderShell(root,{title='',onClose}={}){
 const drawer=root.closest('.drawer');if(!drawer)return ()=>{};
 const fullscreenSurface=drawer.closest('#overlay')||drawer;
 let disposed=false,ownsFullscreen=false,prefs;try{prefs=readerPreferences(JSON.parse(localStorage.getItem(PREFERENCE_KEY)||'null'));}catch{prefs=readerPreferences();}
 drawer.classList.add('immersive-reader');document.body.classList.add('immersive-reading');
 const header=document.createElement('header');header.className='reader-topbar';
 const button=(label,action)=>{const el=document.createElement('button');el.type='button';el.className='reader-control';el.textContent=label;if(action)el.onclick=action;return el;};
 const back=button('‹ 书架');back.dataset.action='close';if(onClose)back.onclick=onClose;
 const name=document.createElement('span');name.className='reader-title';name.textContent=title;
 const controls=document.createElement('div');controls.className='reader-appearance';controls.setAttribute('aria-label','阅读外观');
 const apply=()=>{drawer.dataset.readerTheme=prefs.theme;drawer.style.setProperty('--reader-font-size',prefs.fontSize+'px');try{localStorage.setItem(PREFERENCE_KEY,JSON.stringify(prefs));}catch{}};
 const smaller=button('A−',()=>{prefs.fontSize=Math.max(16,prefs.fontSize-1);apply();});smaller.setAttribute('aria-label','缩小字号');const larger=button('A＋',()=>{prefs.fontSize=Math.min(30,prefs.fontSize+1);apply();});larger.setAttribute('aria-label','放大字号');
 const theme=document.createElement('select');theme.className='reader-control';theme.setAttribute('aria-label','阅读背景');for(const [value,label] of [['white','明亮'],['sepia','纸色'],['night','夜间']]){const o=document.createElement('option');o.value=value;o.textContent=label;theme.append(o);}theme.value=prefs.theme;theme.onchange=()=>{prefs.theme=theme.value;apply();};
 const full=button('全屏',async()=>{if(disposed)return;try{if(ownsFullscreen&&document.fullscreenElement===fullscreenSurface){await document.exitFullscreen();ownsFullscreen=false;}else if(!document.fullscreenElement){await fullscreenSurface.requestFullscreen();ownsFullscreen=document.fullscreenElement===fullscreenSurface;if(disposed&&ownsFullscreen){await document.exitFullscreen();ownsFullscreen=false;}}}catch{if(!disposed){full.textContent='窗口阅读';full.title='当前环境不支持浏览器全屏，已使用整页阅读';}}});full.hidden=typeof fullscreenSurface.requestFullscreen!=='function';
 const restore=document.createElement('div');restore.className='reader-floating-controls';restore.hidden=true;const restoreBack=button('‹ 书架');restoreBack.dataset.action='close';if(onClose)restoreBack.onclick=onClose;
 const show=button('显示工具',()=>{drawer.classList.remove('reader-chrome-hidden');restore.hidden=true;hide.focus();});const hide=button('专注阅读',()=>{drawer.classList.add('reader-chrome-hidden');restore.hidden=false;show.focus();});restore.append(restoreBack,show);
 controls.append(smaller,larger,theme,full,hide);header.append(back,name,controls);drawer.prepend(header);drawer.append(restore);apply();back.focus({preventScroll:true});
 return ()=>{if(disposed)return;disposed=true;drawer.classList.remove('immersive-reader','reader-chrome-hidden');header.remove();restore.remove();if(!document.querySelector('.immersive-reader'))document.body.classList.remove('immersive-reading');if(ownsFullscreen&&document.fullscreenElement===fullscreenSurface)Promise.resolve(document.exitFullscreen()).catch(()=>{});ownsFullscreen=false;};
}
