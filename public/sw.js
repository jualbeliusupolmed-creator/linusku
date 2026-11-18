const CACHE_NAME = 'linusku-shell-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/linus-maskot.svg'];
const NEVER_CACHE_PATHS = ['/admin', '/driver'];
const STATIC_DESTINATIONS = new Set([
  'font',
  'image',
  'manifest',
  'script',
  'style',
  'worker',
]);

function isNeverCachedPath(pathname) {
  if (pathname.startsWith('/api/') && ![
    '/api/positions',
    '/api/stops',
    '/api/settings',
    '/api/route',
  ].includes(pathname)) {
    return true;
  }
  return NEVER_CACHE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

function hasRequestCredentials(request) {
  return (
    request.headers.has('authorization') || request.headers.has('cookie')
  );
}

function isCacheableResponse(response) {
  if (
    !response ||
    !response.ok ||
    response.status !== 200 ||
    response.type === 'opaque' ||
    response.type === 'opaqueredirect'
  ) {
    return false;
  }

  const cacheControl = response.headers.get('cache-control') ?? '';
  const vary = response.headers.get('vary') ?? '';
  if (/private|no-store/i.test(cacheControl)) return false;
  if (/cookie|authorization/i.test(vary)) return false;
  if (response.headers.has('set-cookie')) return false;
  return true;
}

function isStaticAsset(request, pathname) {
  return (
    pathname.startsWith('/_next/static/') ||
    STATIC_DESTINATIONS.has(request.destination) ||
    pathname === '/icon.svg' ||
    pathname === '/linus-maskot.svg' ||
    pathname === '/manifest.webmanifest'
  );
}

async function cacheShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.allSettled(
    SHELL.map(async (path) => {
      const request = new Request(path, {
        cache: 'reload',
        credentials: 'omit',
      });
      const response = await fetch(request);
      if (isCacheableResponse(response)) {
        await cache.put(request, response);
      }
    })
  );
}

async function networkFirstPassengerShell(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cachedResponse =
      (await cache.match(request)) || (await cache.match('/'));
    return (
      cachedResponse ||
      new Response('LINUSKU belum tersedia secara luring.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

async function cacheFirstStaticAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse;

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith('linusku-') && key !== CACHE_NAME
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isNeverCachedPath(url.pathname)) return;
  if (hasRequestCredentials(request)) return;

  if (request.mode === 'navigate') {
    if (url.pathname !== '/') {
      event.respondWith(networkFirstPassengerShell(request));
      return;
    }
    event.respondWith(networkFirstPassengerShell(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstPassengerShell(request));
    return;
  }

  if (!isStaticAsset(request, url.pathname)) return;
  event.respondWith(cacheFirstStaticAsset(request));
});
