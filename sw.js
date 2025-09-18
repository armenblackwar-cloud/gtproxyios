self.addEventListener('install', function(e) {
  self.skipWaiting();
});
self.addEventListener('activate', function(e) {
  self.clients.claim();
});
self.addEventListener('fetch', function(e) {
  e.respondWith(
    caches.open('gt-cache').then(function(cache) {
      return cache.match(e.request).then(function(response) {
        return response || fetch(e.request).then(function(resp) {
          cache.put(e.request, resp.clone());
          return resp;
        });
      });
    })
  );
});
