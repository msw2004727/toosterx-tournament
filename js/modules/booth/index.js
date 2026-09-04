/**
 * 挑戰攤位路由
 * ------------------------------------------------------------------
 * 規格：docs/06 §4
 *
 * 守衛只擋到「有沒有登入」。「是不是攤位人員」由頁面自己顯示原因——
 * 擋在路由層只會得到一個空白頁，使用者看不出是權限問題還是壞掉。
 */

import { route, lazy } from '../../core/router.js';
import { onAuth, user } from '../../core/firebase.js';
import { CACHE_VERSION } from '../../config.js';

function whenAuthReady() {
  return new Promise(resolve => {
    let done = false;
    const off = onAuth(() => {
      if (done) return;
      done = true;
      setTimeout(() => { off(); resolve(); }, 0);
    });
  });
}

async function requireLogin() {
  await whenAuthReady();
  return user() ? true : '/login?next=/booth';
}

// 動態 import 帶版號＋lazy() 重試（同 staff/index.js，見 R-REL-016）
const page = (path, fn) => {
  const url = new URL(path, import.meta.url).href + `?v=${CACHE_VERSION}`;
  const load = lazy(() => import(/* @vite-ignore */ url), url);
  return ctx => load().then(m => fn(m)(ctx));
};

export function registerBoothRoutes() {
  route('/booth', page('../booth/booth.js', m => m.boothPage),
    { title: '挑戰攤位', guard: requireLogin });

  // 一個人被指派到兩關以上時，選完關卡就固定在這條網址上——
  // 現場把它加進主畫面，開機就是自己那一關（§4.1：整天不需再選）
  route('/booth/:challengeId', page('../booth/booth.js', m => m.boothPage),
    { title: '挑戰攤位', guard: requireLogin });
}
