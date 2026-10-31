const CACHE='zhiheng-entry-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/offline.html','/app-icon-192.png','/app-icon-512.png'])));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('zhiheng-entry-')&&k!==CACHE).map(k=>caches.delete(k))))]))});
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate'&&new URL(event.request.url).origin===self.location.origin){event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')))}});
