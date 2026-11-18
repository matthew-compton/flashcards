const CACHE = 'french-flashcards-shell-__BUILD_REVISION__';
const SHELL = ['./', './index.html', './__APP_SCRIPT__', './icon.png', './manifest.webmanifest'];
const scope = new URL(self.registration.scope);
const shellPaths = new Set(SHELL.map(asset => new URL(asset, scope).pathname));
const indexPath = new URL('index.html', scope).pathname;
const bundleName = /^app\.[a-f0-9]{16}\.js$/;

async function installShell() {
  const requests = SHELL.map(asset => new Request(new URL(asset, scope), { cache: 'reload' }));
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

async function loadPage() {
  const cache = await caches.open(CACHE);
  try {
    const page = await fetch(scope.href, { cache: 'no-cache' });
    if (!page.ok) throw new Error('The app page is unavailable.');
    const html = await page.clone().text();
    const bundle = html.match(/<script\b[^>]*\bsrc="\.\/(app\.[a-f0-9]{16}\.js)"/)?.[1];
    if (!bundle) throw new Error('The app page has no versioned bundle.');
    const scriptUrl = new URL(bundle, scope).href;
    if (!await cache.match(scriptUrl)) {
      const script = await fetch(scriptUrl, { cache: 'no-cache' });
      if (!script.ok || !/javascript/i.test(script.headers.get('Content-Type') ?? '')) {
        throw new Error('The updated bundle is unavailable.');
      }
      await cache.put(scriptUrl, script);
    }
    // Make the page available offline only after its exact bundle has been cached.
    await cache.put(scope.href, page.clone());
    return page;
  } catch {
    return (await cache.match(scope.href)) ?? Response.error();
  }
}

self.addEventListener('install', event => {
  // A complete replacement can take over requests without reloading open study rounds.
  event.waitUntil(installShell().then(() => self.skipWaiting()));
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
  if (event.request.mode === 'navigate' && (url.pathname === scope.pathname || url.pathname === indexPath)) {
    event.respondWith(loadPage());
    return;
  }
  const isBundle = url.pathname.startsWith(scope.pathname) && bundleName.test(url.pathname.slice(scope.pathname.length));
  if (!shellPaths.has(url.pathname) && !isBundle) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(url.pathname);
    return cached ?? fetch(event.request);
  }));
});
