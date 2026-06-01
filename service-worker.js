// service-worker.js - PWA Service Worker
// Estrategia: NETWORK-FIRST para o app shell (HTML/JS/CSS) com fallback ao cache,
// cache-first apenas para imagens/icones, network-only para API GAS.
// Network-first evita o PWA ficar preso em versao antiga (causa do "trava no login").

// Bumpar junto com CONFIG.APP_VERSION em config.js a cada deploy
const CACHE_NAME = 'ger-tarefas-v7';

// Tempo maximo aguardando a rede antes de cair pro cache (shell)
const SHELL_TIMEOUT = 4000;

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

// Install: pre-cache tolerante a falha (um asset falho nao quebra o install)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(
        ASSETS_ESTATICOS.map(asset =>
          fetch(asset, { cache: 'no-store' })
            .then(r => r.ok && cache.put(asset, r))
            .catch(() => {})
        )
      ))
      .then(() => self.skipWaiting())
  );
});

// Activate: remove caches antigos, assume controle e avisa as paginas para recarregar
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(
        chaves
          .filter(chave => chave !== CACHE_NAME)
          .map(chave => caches.delete(chave))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' })))
  );
});

// Mensagens da pagina: permite forcar atualizacao/limpeza remotamente
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'PURGE_CACHE') {
    event.waitUntil(
      caches.keys().then(chaves => Promise.all(chaves.map(c => caches.delete(c))))
    );
  }
});

// Network-first: tenta rede; se demorar (SHELL_TIMEOUT) usa cache; se falhar usa cache/fallback.
// A rede sempre atualiza o cache em segundo plano para o proximo carregamento.
function networkFirst(request) {
  const networkPromise = fetch(request).then(response => {
    if (response && response.status === 200 && response.type === 'basic') {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
    }
    return response;
  });

  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done && v) { done = true; resolve(v); } };

    const timer = setTimeout(() => {
      caches.match(request).then(c => finish(c)); // so resolve se houver cache
    }, SHELL_TIMEOUT);

    networkPromise
      .then(r => { clearTimeout(timer); if (!done) { done = true; resolve(r); } })
      .catch(() => {
        clearTimeout(timer);
        if (done) return;
        caches.match(request).then(c => {
          if (c) { done = true; return resolve(c); }
          if (request.mode === 'navigate') {
            return caches.match('./index.html').then(idx => {
              done = true;
              resolve(idx || new Response('Offline', { status: 503 }));
            });
          }
          done = true;
          resolve(new Response('Offline', { status: 503 }));
        });
      });
  });
}

// Fetch: estrategia por tipo de request
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API GAS (script.google.com) e CDN (unpkg): sempre network direto
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('unpkg.com')) {
    return;
  }

  // So tratamos GET
  if (event.request.method !== 'GET') return;

  // App shell (paginas e codigo): network-first para nunca travar em versao velha
  const ehShell = event.request.mode === 'navigate' ||
                  /\.(?:js|css|html)$/.test(url.pathname);

  if (ehShell) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Imagens/icones/manifest: cache-first (mudam pouco)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => new Response('Offline', { status: 503 }));
    })
  );
});
