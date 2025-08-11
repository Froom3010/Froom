
const CACHE = 'froom-cache-v1';
const ASSETS = ['.','/index.html','/styles.css','/app.js','/manifest.json'];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e)=>{
  const url = new URL(e.request.url);
  if (ASSETS.includes(url.pathname) || url.origin === location.origin){
    e.respondWith(caches.match(e.request).then(res=> res || fetch(e.request)));
  }
});
