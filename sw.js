/**
 * Service Worker
 * ------------------------------------------------------------------
 * ⚠️ R-REL-013：HTML 一律 network-first，禁止 cache-first。
 * ⚠️ R-REL-014：新資源必須由 scripts/bump-version.js 納管。
 */
const CACHE_NAME = 'feda-cup-0.20260829';

const APP_SHELL = [
  '/css/tokens.css',
  '/css/base.css',
  '/css/components.css',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Firestore／YouTube 交給 SDK 與瀏覽器

  const isHTML = req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html');

  if (isHTML) {
    // network-first
    e.respondWith(fetch(req).catch(() => caches.match(req).then(r => r || caches.match('/index.html'))));
    return;
  }
  // cache-first（帶版號的靜態資源）
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
