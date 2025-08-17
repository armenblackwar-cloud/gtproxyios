/* Simple offline cache for shell */
const CACHE = 'gtbot-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k!==CACHE ? caches.delete(k) : null)))
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // network-first for API, cache-first for static
  if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/v5/') || url.pathname.startsWith('/spot/')){
    e.respondWith(
      fetch(e.request).catch(()=>caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(resp => resp || fetch(e.request))
    );
  }
});
