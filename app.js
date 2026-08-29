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
  const { initRouter }   = await import('./js/core/router.js');
  const { initSync }     = await import('./js/core/sync.js');

  await initFirebase();
  initSync();

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

boot().catch(err => {
  console.error('[boot]', err);
  document.getElementById('app-view').textContent = '載入失敗，請重新整理頁面。';
});

export { App };
