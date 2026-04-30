// service-worker.js - PWA Service Worker
// Estrategia: cache-first para assets estaticos, network-only para API GAS

const CACHE_NAME = 'ger-tarefas-v2';

const ASSETS_ESTATICOS = [
  './',
  './index.html',
  './painel.html',
  './carregamento.html',
  './gestor.html',
  './css/style.css',
  './js/config.js',
  './js/api.js',
  './js/auth.js',
  './js/tarefas.js',
  './js/carregamento.js',
  './js/gestor.js',
  './js/scanner.js',
  './js/ui.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install: pre-cache todos os assets estaticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_ESTATICOS))
      .then(() => self.skipWaiting())
  );
});

// Activate: remove caches antigos de versoes anteriores
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(
        chaves
          .filter(chave => chave !== CACHE_NAME)
          .map(chave => caches.delete(chave))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: estrategia por tipo de request
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Requisicoes para a API GAS (script.google.com) ou JSONP: sempre network
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('unpkg.com')) {
    return;
  }

  // Assets estaticos proprios: cache-first
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;

        return fetch(event.request)
          .then(response => {
            // Cachear apenas respostas validas do mesmo dominio
            if (response && response.status === 200 && response.type === 'basic') {
              const responseClone = response.clone();
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, responseClone));
            }
            return response;
          })
          .catch(() => {
            // Offline e nao esta em cache: retornar pagina de fallback
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
          });
      })
  );
});
