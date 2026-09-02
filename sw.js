/**
 * Service Worker
 * ------------------------------------------------------------------
 * ⚠️ R-REL-013：HTML 一律 network-first，禁止 cache-first。
 * ⚠️ R-REL-014：新資源必須由 scripts/bump-version.js 納管。
 */
const CACHE_NAME = 'feda-cup-0.20260902d';

const APP_SHELL = [
  '/css/tokens.css',
  '/css/base.css',
  '/css/components.css',
  '/css/modules/staff.css',
  '/css/modules/public.css',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      // 個別加入而非 addAll：任一個 404 就整批失敗，
      // SW 會安裝不起來而且沒有明顯錯誤，現場很難查。
      .then(c => Promise.all(APP_SHELL.map(u => c.add(u).catch(err => console.warn('[sw] skip', u, err)))))
      .then(() => self.skipWaiting())
  );
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

  // cache-first（帶版號的靜態資源）。
  // ⚠️ 網路失敗時要退回「忽略 query 的快取」再試一次：
  //    部署當下 ?v=舊版號 的資源會瞬間消失，賽務剛好按下按鈕就會看到「載入失敗」。
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).catch(async err => {
      const loose = await caches.match(req, { ignoreSearch: true });
      if (loose) return loose;
      throw err;
    }))
  );
});
