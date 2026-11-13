// Offline support: keeps a copy of the app (and the Google sign-in scripts)
// on the device so Yahtzee opens and scores with no internet connection.
const CACHE = 'yahtzee-app-v1';
const FIREBASE_VERSION = '12.2.1';
const FIREBASE_SCRIPTS = ['app', 'auth', 'firestore'].map(name => `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-${name}-compat.js`);
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './apple-touch-icon.png', './icons/yahtzee-192.png', './icons/yahtzee-512.png'];

async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(SHELL.map(url => cache.add(url)));
  // Cache the built JS/CSS that index.html points at, so the very first
  // visit is already enough to work offline later.
  try {
    const html = await (await fetch('./index.html', { cache: 'no-store' })).text();
    const assets = [...html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)].map(match => match[1]);
    await Promise.allSettled(assets.map(url => cache.add(url)));
  } catch {}
  await Promise.allSettled(FIREBASE_SCRIPTS.map(async url => cache.put(url, await fetch(url, { mode: 'no-cors' }))));
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(precache());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const firebaseScript = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (!sameOrigin && !firebaseScript) return; // never touch Firestore or Google sign-in traffic

  // Pages: try the network for the newest version, fall back to the saved copy.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE)).put('./index.html', response.clone());
        return response;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Everything else: use the saved copy, refreshing it in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    const network = fetch(request).then(response => {
      if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
      return response;
    }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    return (await network) || Response.error();
  })());
});
