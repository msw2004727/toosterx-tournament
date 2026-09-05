/**
 * Hash 路由與頁面生命週期
 * ------------------------------------------------------------------
 * 規格：docs/03-功能規格-公開端.md §1、docs/08 §5
 *
 * ⚠️ 離開頁面時必須回收該頁註冊的所有 onSnapshot（交付檢查表第 8 項）。
 *    做法：每個頁面拿到一個 scope 字串，換頁時 store.releaseScope(scope)。
 *    頁面自己不需要記得取消監聽——忘記取消是這類 App 最常見的漏洞。
 *
 * 用 hash 路由是因為 Cloudflare Pages 是純靜態託管，
 * history API 需要 SPA fallback 設定，hash 不需要，少一個會壞的地方。
 */

import { releaseScope } from './store.js';
import { skeleton, toast, mount } from './ui.js';

const routes = [];
let currentScope = null;
let currentCleanup = null;
let booted = false;

/**
 * 註冊路由。
 * @param {string} pattern 例：'/staff/match/:matchId'
 * @param {(ctx:{params:object, query:URLSearchParams, scope:string, view:HTMLElement}) => (void|Function|Promise<void|Function>)} handler
 *        handler 可回傳 cleanup 函式，換頁時會被呼叫（監聽已由 scope 自動回收）
 * @param {object} [opts] { title, guard }
 */
export function route(pattern, handler, opts = {}) {
  routes.push({ pattern, handler, opts, ...compile(pattern) });
}

/**
 * 延遲載入頁面模組，失敗時重試一次。
 *
 * ⚠️ 為什麼需要重試：部署當下（Cloudflare Pages 換檔 ＋ Service Worker 換版）
 *    如果賽務剛好按下按鈕，`import()` 會拿到瞬間的 404 或被中斷的回應，
 *    畫面就停在「載入失敗」。而且瀏覽器會**記住這個失敗的模組**，
 *    同一個網址再 import 幾次都一樣失敗——所以重試一定要換一個 query 才有用。
 *
 *    這在比賽當天等於「賽務點進賽務台，看到一片紅」。實測發生過一次。
 *
 * @param {() => Promise<any>} load 例：() => import('./live.js')
 * @param {string} url  重試時要打的網址（帶 cache-busting query）
 */
export function lazy(load, url) {
  return async () => {
    try {
      return await load();
    } catch (err) {
      console.warn('[router] 模組載入失敗，重試一次', url, err);
      return import(/* @vite-ignore */ `${url}?retry=${Date.now()}`);
    }
  };
}

function compile(pattern) {
  const keys = [];
  const re = new RegExp('^' + pattern
    .split('/')
    .map(seg => {
      if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '([^/]+)'; }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/') + '$');
  return { re, keys };
}

export function navigate(path, { replace = false } = {}) {
  const target = '#' + (path.startsWith('/') ? path : '/' + path);
  if (location.hash === target) return handle(true);   // 明確要求重跑同一頁
  if (replace) location.replace(target);
  else location.hash = target;
}

export function currentPath() {
  const raw = location.hash.replace(/^#/, '') || '/';
  return raw.split('?')[0] || '/';
}

function currentQuery() {
  const raw = location.hash.replace(/^#/, '');
  const i = raw.indexOf('?');
  return new URLSearchParams(i >= 0 ? raw.slice(i + 1) : '');
}

/**
 * 上一次真正處理過的位置（含 query）。
 *
 * ⚠️ 同一個位置被連續處理兩次是**真的會發生**的：initRouter() 在沒有 hash 時
 *    會 `location.replace('#/')`（排一個 hashchange），接著又直接呼叫一次
 *    handle()。重複掛載不只是多畫一次——頁面會註冊兩份監聽、跑兩次一次性讀取。
 *    navigate() 對「已經在這一頁」的情況會明確要求重跑，那時候傳 force。
 */
let lastHandled = null;

/**
 * 導頁世代。**每一個 await 之後都要確認自己還是最新的那一次。**
 *
 * ⚠️ handle() 中間有好幾個 await（cleanup、guard、動態 import 頁面模組），
 *    這期間使用者可以再導一次頁，於是兩個 handle() 同時在跑。
 *    實測：LINE 導回後 app.js 先讓路由停在首頁、隨即導向 /login，
 *    首頁的模組較慢載完，結果網址是 /login、畫面卻是首頁。
 *    快速連點兩個分頁也會看到同一種錯亂。
 */
let generation = 0;

async function handle(force = false) {
  const path = currentPath();
  const key = location.hash;                 // 連 query 一起比，?tab=x 換頁要算數
  if (!force && key === lastHandled) return;
  lastHandled = key;

  const gen = ++generation;
  const stale = () => gen !== generation;

  const host = document.getElementById('app-view');
  if (!host) return;

  // 每一次導頁都有自己的容器。頁面模組是「邊載入邊畫」的（先骨架、拿到資料
  // 再重畫），所以光在最後檢查 stale 沒有用——過期的那一頁在 await 還沒回來
  // 之前就已經把東西畫進去了。給它獨立的容器，被換掉之後它繼續畫也只是畫在
  // 一個離開文件的節點上。
  const view = document.createElement('div');

  // 先收乾淨舊頁面：先 cleanup 再 releaseScope，
  // 讓頁面有機會在監聽被切斷前做最後的寫入（例如暫停計時器）
  try { await currentCleanup?.(); } catch (e) { console.error('[router] cleanup', e); }
  if (stale()) return;
  currentCleanup = null;
  if (currentScope) releaseScope(currentScope);

  const match = routes.map(r => ({ r, m: r.re.exec(path) })).find(x => x.m);
  if (!match) {
    currentScope = null;
    // 404 也要換標題，不然瀏覽器分頁還掛著上一頁的名字（驗收 D-14）
    document.title = '找不到頁面｜FEDA CUP 2026';
    host.replaceChildren(view);
    mount(view, notFound(path));
    return;
  }

  const { r, m } = match;
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  const scope = `${r.pattern}|${JSON.stringify(params)}`;
  currentScope = scope;

  if (r.opts.title) document.title = `${r.opts.title}｜FEDA CUP 2026`;

  // 守衛（例如賽務頁需要登入）。回傳字串代表改導向該路徑。
  if (typeof r.opts.guard === 'function') {
    const verdict = await r.opts.guard({ params });
    if (stale()) return;
    if (typeof verdict === 'string') return navigate(verdict, { replace: true });
    if (verdict === false) return;
  }

  if (stale()) return;
  mount(view, skeleton(4));
  host.replaceChildren(view);          // 這一刻起，畫面就是這一次導頁的了
  window.scrollTo({ top: 0 });

  try {
    const cleanup = await r.handler({ params, query: currentQuery(), scope, view });
    if (stale()) {
      // 已經被後來的導頁取代了。這一頁自己的清理仍要跑，
      // 否則它註冊的計時器與監聽會留在背景。
      try { await cleanup?.(); } catch { /* 收尾失敗不影響現在那一頁 */ }
      releaseScope(scope);
      return;
    }
    currentCleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (err) {
    if (stale()) return;
    console.error('[router]', path, err);
    mount(view, errorView(err));
    toast('頁面載入失敗，請重新整理。', 'error');
  }
}

function notFound(path) {
  const d = document.createElement('div');
  d.className = 'empty';
  d.innerHTML = '<p class="empty__title">找不到這個頁面</p>';
  const p = document.createElement('p');
  p.className = 'empty__note';
  p.textContent = path;
  d.append(p);
  const a = document.createElement('a');
  a.className = 'btn btn--primary';
  a.href = '#/';
  a.textContent = '回首頁';
  d.append(a);
  return d;
}

function errorView(err) {
  const d = document.createElement('div');
  d.className = 'empty';
  const t = document.createElement('p');
  t.className = 'empty__title';
  t.textContent = '載入失敗';
  const n = document.createElement('p');
  n.className = 'empty__note';
  // 錯誤訊息可能含使用者資料，一律用 textContent
  n.textContent = err?.message || String(err);
  const b = document.createElement('button');
  b.className = 'btn btn--primary';
  b.type = 'button';
  b.textContent = '重新載入';
  b.addEventListener('click', () => location.reload());
  d.append(t, n, b);
  return d;
}

export function initRouter(App) {
  if (booted) return;
  booted = true;
  App.navigate = navigate;
  // 包一層：事件物件會被當成 force 參數（Event 是 truthy）
  window.addEventListener('hashchange', () => handle());
  // 進站沒有 hash 時導到首頁，讓分享出去的網址永遠有明確路徑
  if (!location.hash) location.replace('#/');
  handle();
  console.info('[router] ready', App.env);
}
