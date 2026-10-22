// ==============================================================================
// GOMEX FROTA · SERVICE WORKER (OFFLINE FIRST & PWA)
// ==============================================================================

const CACHE_NAME = 'gomex-frota-v2.0';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('Cache fallback durante install:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Ignora chamadas de API do Supabase/backend para que sejam sempre ao vivo
  if (event.request.url.includes('/api/')) {
    return;
  }

  // Para navegação HTML (document), busca sempre da rede primeiro para receber as atualizações
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request).then(netRes => {
        const clone = netRes.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return netRes;
      }).catch(() => {
        return caches.match('/index.html') || caches.match('/');
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedRes => {
      if (cachedRes) return cachedRes;
      return fetch(event.request).then(networkRes => {
        return networkRes;
      }).catch(() => {
        return caches.match('/index.html');
      });
    })
  );
});
