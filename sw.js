const CACHE = 'gtbot-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './sw.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Кешируем статику
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// Политика:
//  - API: network-first с таймаутом, потом кеш last-response (если есть)
//  - статика: cache-first
const API_HINT = '/exec';

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (url.pathname.includes(API_HINT)) {
    // Network-first для API
    e.respondWith(networkFirst(e.request));
  } else {
    // Cache-first для статики
    e.respondWith(cacheFirst(e.request));
  }
});

async function cacheFirst(req){
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req){
  const cache = await caches.open(CACHE);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 8000); // 8с
    const res = await fetch(req, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch(_){
    const cached = await cache.match(req);
    if (cached) return cached;
    // мягкий оффлайн-ответ
    return new Response(JSON.stringify({ error:"offline" }), { status: 200, headers: {'Content-Type':'application/json'} });
  }
}
