const CACHE = 'french-flashcards-shell-__BUILD_REVISION__';
const SHELL = ['./', './index.html', './__APP_SCRIPT__', './icon.png', './manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))));
  // A replacement waits for the old app's windows to close, preserving active rounds.
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('french-flashcards-shell-') && key !== CACHE).map(key => caches.delete(key)))));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const allowed = SHELL.map(asset => new URL(asset, self.registration.scope).pathname);
  if (!allowed.includes(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(url.pathname);
    return cached ?? fetch(event.request);
  }));
});
