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
  if (location.hash === target) return handle();
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

async function handle() {
  const path = currentPath();
  const view = document.getElementById('app-view');
  if (!view) return;

  // 先收乾淨舊頁面：先 cleanup 再 releaseScope，
  // 讓頁面有機會在監聽被切斷前做最後的寫入（例如暫停計時器）
  try { await currentCleanup?.(); } catch (e) { console.error('[router] cleanup', e); }
  currentCleanup = null;
  if (currentScope) releaseScope(currentScope);

  const match = routes.map(r => ({ r, m: r.re.exec(path) })).find(x => x.m);
  if (!match) {
    currentScope = null;
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
    if (typeof verdict === 'string') return navigate(verdict, { replace: true });
    if (verdict === false) return;
  }

  view.replaceChildren(skeleton(4));
  view.scrollTop = 0;
  window.scrollTo({ top: 0 });

  try {
    const cleanup = await r.handler({ params, query: currentQuery(), scope, view });
    currentCleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (err) {
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
  window.addEventListener('hashchange', handle);
  // 進站沒有 hash 時導到首頁，讓分享出去的網址永遠有明確路徑
  if (!location.hash) location.replace('#/');
  handle();
  console.info('[router] ready', App.env);
}
