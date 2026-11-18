const CACHE = 'french-flashcards-shell-__BUILD_REVISION__';
const SHELL = ['./', './index.html', './__APP_SCRIPT__', './icon.png', './manifest.webmanifest'];

async function installShell() {
  const requests = SHELL.map(asset => new Request(new URL(asset, self.registration.scope), { cache: 'reload' }));
  try {
    const cache = await caches.open(CACHE);
    await cache.addAll(requests);
    for (const request of requests.slice(0, 2)) {
      const page = await cache.match(request);
      if (!page || !(await page.text()).includes('src="./__APP_SCRIPT__"')) {
        throw new Error('The app update contains assets from different releases.');
      }
    }
  } catch (error) {
    await caches.delete(CACHE);
    throw error;
  }
}

self.addEventListener('install', event => {
  event.waitUntil(installShell());
  // A replacement waits for the old app's windows to close, preserving active rounds.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('french-flashcards-shell-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'flashcards-activate-update') event.waitUntil(self.skipWaiting());
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
