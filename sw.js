/**
 * Service Worker
 * ------------------------------------------------------------------
 * ⚠️ R-REL-013：HTML 一律 network-first，禁止 cache-first。
 * ⚠️ R-REL-014：新資源必須由 scripts/bump-version.js 納管。
 */
const CACHE_NAME = 'feda-cup-0.20261005g';

// 由 bump-version.js 依 js/ 目錄產生，新增模組不會漏掉離線快取。
const OFFLINE_MODULES = [
  "/js/config.js",
  "/js/core/activity-clock.js",
  "/js/core/appbar.js",
  "/js/core/clock.js",
  "/js/core/division-theme.js",
  "/js/core/firebase.js",
  "/js/core/icons.js",
  "/js/core/install.js",
  "/js/core/liff.js",
  "/js/core/registration.js",
  "/js/core/router.js",
  "/js/core/store.js",
  "/js/core/sync.js",
  "/js/core/theme.js",
  "/js/core/ui.js",
  "/js/engine/admin-match.js",
  "/js/engine/advancement.js",
  "/js/engine/appeal.js",
  "/js/engine/assign.js",
  "/js/engine/audit.js",
  "/js/engine/awards.js",
  "/js/engine/berger.js",
  "/js/engine/challenge-days.js",
  "/js/engine/challenge.js",
  "/js/engine/csv.js",
  "/js/engine/eligibility.js",
  "/js/engine/formats.js",
  "/js/engine/group-name.js",
  "/js/engine/manual-schedule.js",
  "/js/engine/member-identity.js",
  "/js/engine/perms.js",
  "/js/engine/privacy.js",
  "/js/engine/ranking.js",
  "/js/engine/refund.js",
  "/js/engine/registration.js",
  "/js/engine/result.js",
  "/js/engine/review.js",
  "/js/engine/schedule-doc.js",
  "/js/engine/schedule.js",
  "/js/engine/standing.js",
  "/js/engine/stream-share.js",
  "/js/engine/tally.js",
  "/js/engine/team-import.js",
  "/js/engine/team-name.js",
  "/js/engine/timeline.js",
  "/js/firebase-config.js",
  "/js/lib/csv-file.js",
  "/js/lib/format.js",
  "/js/lib/match-write.js",
  "/js/lib/ping.js",
  "/js/lib/qr-render.js",
  "/js/lib/roc.js",
  "/js/lib/vendor/jsqr.js",
  "/js/lib/youtube.js",
  "/js/modules/account/index.js",
  "/js/modules/account/login.js",
  "/js/modules/account/my-players.js",
  "/js/modules/account/my.js",
  "/js/modules/admin/audits.js",
  "/js/modules/admin/bits.js",
  "/js/modules/admin/data.js",
  "/js/modules/admin/export.js",
  "/js/modules/admin/index.js",
  "/js/modules/admin/manual-schedule.js",
  "/js/modules/admin/match-actions.js",
  "/js/modules/admin/match.js",
  "/js/modules/admin/member-identity.js",
  "/js/modules/admin/perms.js",
  "/js/modules/admin/registration.js",
  "/js/modules/admin/schedule-actions.js",
  "/js/modules/admin/schedule.js",
  "/js/modules/admin/staff.js",
  "/js/modules/admin/standing-actions.js",
  "/js/modules/admin/standings.js",
  "/js/modules/admin/stream.js",
  "/js/modules/admin/team-import.js",
  "/js/modules/admin/team-name.js",
  "/js/modules/admin/teams.js",
  "/js/modules/booth/actions.js",
  "/js/modules/booth/booth.js",
  "/js/modules/booth/data.js",
  "/js/modules/booth/index.js",
  "/js/modules/booth/scan.js",
  "/js/modules/challenge/board.js",
  "/js/modules/challenge/daily-cards.js",
  "/js/modules/challenge/data.js",
  "/js/modules/challenge/days.js",
  "/js/modules/challenge/home.js",
  "/js/modules/challenge/index.js",
  "/js/modules/challenge/join.js",
  "/js/modules/challenge/me.js",
  "/js/modules/challenge/pass.js",
  "/js/modules/public/bits.js",
  "/js/modules/public/data.js",
  "/js/modules/public/division.js",
  "/js/modules/public/home.js",
  "/js/modules/public/index.js",
  "/js/modules/public/match.js",
  "/js/modules/public/schedule.js",
  "/js/modules/public/selectors.js",
  "/js/modules/public/stats.js",
  "/js/modules/public/stream-shares.js",
  "/js/modules/public/team.js",
  "/js/modules/register/bits.js",
  "/js/modules/register/data.js",
  "/js/modules/register/guide-steps.js",
  "/js/modules/register/home.js",
  "/js/modules/register/index.js",
  "/js/modules/register/join.js",
  "/js/modules/register/manage.js",
  "/js/modules/register/new-team.js",
  "/js/modules/register/tutorial.js",
  "/js/modules/register/waiver.js",
  "/js/modules/staff/checkin-actions.js",
  "/js/modules/staff/checkin-data.js",
  "/js/modules/staff/checkin.js",
  "/js/modules/staff/data.js",
  "/js/modules/staff/home.js",
  "/js/modules/staff/index.js",
  "/js/modules/staff/live-actions.js",
  "/js/modules/staff/live.js",
  "/js/modules/staff/sheet.js",
  "/js/modules/staff/sync-indicator.js"
];
const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/12.0.0';

const APP_SHELL = [
  '/index.html',
  ...OFFLINE_MODULES,
  ...['app', 'firestore', 'auth', 'functions'].map(name => `${FIREBASE_SDK}/firebase-${name}.js`),
  '/css/tokens.css',
  '/css/base.css',
  '/css/components.css',
  '/css/modules/staff.css',
  '/css/modules/public.css',
  '/css/modules/account.css',
  '/css/modules/register.css',
  '/css/modules/admin.css',
  '/css/modules/booth.css',
  '/css/modules/challenge.css',
  '/app.js',
  '/manifest.json',
  `/img/brands/hongming-sports.png?v=${CACHE_NAME.replace('feda-cup-', '')}`,
  `/img/brands/mizuno.png?v=${CACHE_NAME.replace('feda-cup-', '')}`,
  // PWA 圖示。裝到主畫面之後第一次離線開啟時，圖示與 manifest 都要拿得到，
  // 不然 iOS 會退回一張網頁截圖當圖示。由 scripts/make-icons.mjs 產生。
  //
  // ⚠️ 網址一定要跟 manifest.json 與 index.html 上的**完全一樣**（含 ?v=），
  //    否則預先快取的是另一個鍵，離線時照樣抓不到。
  //    版號從 CACHE_NAME 推，才不會有第三個地方要跟著改。
  ...['icon-192', 'icon-512', 'icon-maskable', 'apple-touch-icon']
    .map(n => `/img/${n}.png?v=${CACHE_NAME.replace('feda-cup-', '')}`)
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
      .then(keys => Promise.all(keys.filter(k => k.startsWith('feda-cup-') && k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const local = url.origin === self.location.origin;
  const firebaseModule = url.origin === 'https://www.gstatic.com'
    && /^\/firebasejs\/12\.0\.0\/[^/]+\.js$/.test(url.pathname);
  if (!local && !firebaseModule) return; // 只快取固定版本 SDK，資料庫及登入 API 不經快取

  const isHTML = req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html');

  if (isHTML) {
    // OAuth 導回網址不能進快取；一般 HTML 永遠先向網路確認新版。
    if (url.search) return;
    e.respondWith(networkFirst(e, '/index.html'));
    return;
  }

  if (local && !/\.(?:js|css|png|jpg|jpeg|svg|webp|json)$/.test(url.pathname)) return;
  e.respondWith(networkFirst(e));
});

/** 寫入成功的靜態回應，失去網路時才使用此版本快取。 */
async function networkFirst(event, fallback = null) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(event.request);
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
    if (response.ok) {
      event.waitUntil(cache.put(event.request, response.clone()).catch(err => console.warn('[sw] cache', err)));
    }
    return response;
  } catch (err) {
    const hit = await cache.match(event.request) || await cache.match(event.request, { ignoreSearch: true })
      || (fallback ? await cache.match(fallback) : null);
    if (hit) return hit;
    throw err;
  }
}
