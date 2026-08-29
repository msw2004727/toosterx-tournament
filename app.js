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

const App = {
  env: ENV,
  event: EVENT,
  modules: {}
};

// 讓其他模組掛載，但不污染全域命名空間
window.App = App;

async function boot() {
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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 註冊失敗不影響使用 */ });
  }
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
  btn.textContent = '進入賽務端 →';
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
