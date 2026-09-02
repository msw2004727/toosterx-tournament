/**
 * 主入口
 * ------------------------------------------------------------------
 * 規則（沿用 FC 的 CLAUDE.md）：
 *   ・模組一律用 Object.assign(App, {...}) 掛載，禁止新增全域變數
 *   ・新增邏輯用 async/await，禁止新增 .then() 鏈
 *   ・不可信內容一律 escapeHTML() 或 textContent
 */

import { IS_DEMO, ENV } from './js/firebase-config.js';
import { EVENT } from './js/config.js';
import { iconText } from './js/core/icons.js';
import { themeSwitch } from './js/core/theme.js';

const App = {
  env: ENV,
  event: EVENT,
  modules: {}
};

// 讓其他模組掛載，但不污染全域命名空間
window.App = App;

async function boot() {
  // 主題要在任何畫面出現之前就定案。首屏的 data-theme 由 index.html 的
  // inline script 設好，這裡接手三態偏好、系統變化與跨分頁同步。
  const { initTheme } = await import('./js/core/theme.js');
  initTheme();
  mountAppHeader();

  const { initFirebase } = await import('./js/core/firebase.js');
  const { initRouter, route, navigate } = await import('./js/core/router.js');
  const { initSync } = await import('./js/core/sync.js');

  initSync();
  await initFirebase();

  Object.assign(App, { navigate });

  // 賽務端（M3）
  const staff = await import('./js/modules/staff/index.js');
  staff.registerStaffRoutes();

  // 公開端首頁在 M4；先給一個可以走到賽務端的落地頁
  route('/', ({ view }) => { view.replaceChildren(landing(navigate)); }, { title: '首頁' });

  // Demo 專屬功能：正式版整段不載入（不是用 flag 關掉）
  if (IS_DEMO) {
    const demo = await import('./js/modules/demo/index.js');
    demo.mount(App);
  }

  initRouter(App);

  watchForNewVersion();
}

/**
 * 部署新版時，讓已經開著的分頁自己換上新版。
 *
 * sw.js 用了 skipWaiting() + clients.claim()，新版 SW 會直接接管現有分頁。
 * 但分頁上跑的還是舊版 HTML 與舊的模組圖，接下來任何一次延遲載入
 * （例如點進賽務台）都可能因為舊檔已被換掉而失敗。
 * 所以偵測到接管就重新載入一次——只做一次，避免無限重整。
 */
function watchForNewVersion() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => { /* 註冊失敗不影響使用 */ });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    // 第一次安裝（原本沒有 controller）不需要重整
    if (!sessionStorage.getItem('sw-claimed')) {
      sessionStorage.setItem('sw-claimed', '1');
      return;
    }
    reloading = true;
    location.reload();
  });
  if (navigator.serviceWorker.controller) sessionStorage.setItem('sw-claimed', '1');
}

/**
 * 全站頁首只放主題切換。
 * 賽務端有自己的頁首（.staff__head），所以進到 /staff 之後這一列會收起來，
 * 由 staffHome 自己那顆切換接手——否則畫面上會同時出現兩個。
 */
function mountAppHeader() {
  const host = document.getElementById('app-header');
  if (!host) return;
  // themeSwitch() 會向 theme.js 註冊一個訂閱者。直接 replaceChildren() 把它
  // 拔掉的話，那個閉包要等到下一次主題變動才會自己退訂，每進一次 /staff 就多留一個。
  let current = null;
  const drop = () => { current?.destroy?.(); current = null; host.replaceChildren(); };
  const sync = () => {
    const inStaff = location.hash.startsWith('#/staff');
    if (inStaff) { if (current) drop(); return; }
    if (host.firstElementChild) return;      // 已經有了就不要重建，切換會閃
    const bar = document.createElement('div');
    bar.className = 'apphead';
    const spacer = document.createElement('div');
    spacer.className = 'apphead__spacer';
    current = themeSwitch();
    bar.append(spacer, current);
    host.replaceChildren(bar);
  };
  sync();
  window.addEventListener('hashchange', sync);
}

function landing(navigate) {
  const wrap = document.createElement('div');
  wrap.className = 'landing';

  const h = document.createElement('h1');
  h.className = 'landing__title';
  h.textContent = EVENT.name;

  const p = document.createElement('p');
  p.className = 'landing__sub';
  p.textContent = `${EVENT.slogan}・${EVENT.dates[0].replaceAll('-', '/')}–${EVENT.dates.at(-1).slice(-2)}・${EVENT.venueName}`;

  const note = document.createElement('p');
  note.className = 'landing__note';
  note.textContent = '公開端（賽程、即時比分、積分榜）在 M4 開放。目前可先進入賽務端。';

  const btn = document.createElement('button');
  btn.className = 'btn btn--xl btn--primary';
  btn.type = 'button';
  btn.append(...iconText('forward', '進入賽務端', { trailing: true }));
  btn.addEventListener('click', () => navigate('/staff'));

  wrap.append(h, p, note, btn);
  return wrap;
}

boot().catch(err => {
  console.error('[boot]', err);
  const view = document.getElementById('app-view');
  if (view) {
    view.replaceChildren();
    const p = document.createElement('p');
    p.style.padding = '24px';
    p.textContent = `載入失敗：${err?.message ?? err}。請重新整理頁面。`;
    view.append(p);
  }
});

export { App };
