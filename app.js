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
import { mountAppBar } from './js/core/appbar.js';
import { initInstall } from './js/core/install.js';

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
  initInstall();

  const { initFirebase } = await import('./js/core/firebase.js');
  const { initRouter, route, navigate } = await import('./js/core/router.js');
  const { initSync } = await import('./js/core/sync.js');

  initSync();
  await initFirebase();

  // 頁首要等 firebase 模組載好才掛：右上角那一格依登入狀態顯示
  // 「登入」或「我的」。appbar 自己不 import firebase（見那個檔的說明），
  // 所以由這裡把兩支函式傳進去。
  const { user, onAuth } = await import('./js/core/firebase.js');
  mountAppBar({ isSignedIn: () => !!user(), onAuthChange: onAuth });

  Object.assign(App, { navigate });

  // 賽務端（M3）
  const staff = await import('./js/modules/staff/index.js');
  staff.registerStaffRoutes();

  // 帳號（登入與「我的」，M4-b）。註冊在公開端之前——路由是先註冊先贏，
  // 而 /login 與 /my 不該被任何萬用路由接走。
  (await import('./js/modules/account/index.js')).registerAccountRoutes();

  // ⚠️ 從 LINE 授權導回來時，落腳的**不一定是登入頁**：
  //    liff.login() 走 OAuth 導轉，網址 `#` 之後的內容會被丟掉，
  //    實測是回到公開首頁。所以換發登入必須在開機時做，不能只寫在登入頁
  //    （第一版就是這樣，使用者授權完停在首頁，看起來像什麼都沒發生）。
  //    只有偵測到網址上有 LINE 的導回參數才會載入 LINE 的 SDK。
  const liffMod = await import('./js/core/liff.js');
  const back = await liffMod.completeLineRedirect();
  if (back.error) {
    console.error('[line] 導回後換發失敗', back.error);
    sessionStorage.setItem('feda:loginError', back.error);
  }

  // 管理後台（M4-c）。註冊在公開端之前——路由先註冊先贏。
  (await import('./js/modules/admin/index.js')).registerAdminRoutes();

  // 報名（M4-b）。必須註冊在公開端之前——路由是先註冊先贏，
  // 而 /team/:id/manage 不該被公開端的 /team/:id 之類的樣式接走。
  (await import('./js/modules/register/index.js')).registerRegistrationRoutes();

  // 公開端（M5）
  (await import('./js/modules/public/index.js')).registerPublicRoutes();

  // Demo 專屬功能：正式版整段不載入（不是用 flag 關掉）
  if (IS_DEMO) {
    const demo = await import('./js/modules/demo/index.js');
    demo.mount(App);
  }

  initRouter(App);

  // 導回成功就把人送到原本要去的地方（預設「我的」）。
  // 一定要在 initRouter() 之後——不然這一跳會被開機時的路由解析蓋掉。
  if (back.done && back.next) navigate(back.next);
  else if (back.error) navigate('/login');

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
