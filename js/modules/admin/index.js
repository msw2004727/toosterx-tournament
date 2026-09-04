/**
 * 管理後台路由
 * ------------------------------------------------------------------
 * 規格：docs/05
 *
 * 每一頁對應 js/config.js 的 FEATURES 一行。新增一個功能：
 *   1. PERMISSIONS 加一條權限碼
 *   2. FEATURES 加一行（含 route）
 *   3. 這裡註冊路由
 * 三個地方，`tests/unit/perms.test.js` 會檢查前兩者對得起來。
 *
 * 守衛只擋到「有沒有登入」。「有沒有這項權限」由頁面自己顯示原因——
 * 擋在路由層只會得到一個空白頁，使用者看不出是權限問題還是壞掉。
 */

import { route, lazy } from '../../core/router.js';
import { onAuth, user } from '../../core/firebase.js';
import { CACHE_VERSION } from '../../config.js';

/** 等待第一次 auth 狀態回報（避免重新整理時誤判為未登入） */
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
  return user() ? true : '/login?next=/my';
}

// 動態 import 帶版號＋lazy() 重試（同 staff/index.js，見 R-REL-016）
const page = (path, fn) => {
  const url = new URL(path, import.meta.url).href + `?v=${CACHE_VERSION}`;
  const load = lazy(() => import(/* @vite-ignore */ url), url);
  return ctx => load().then(m => fn(m)(ctx));
};

export function registerAdminRoutes() {
  route('/admin/teams', page('../admin/teams.js', m => m.adminTeamsPage),
    { title: '報名審核', guard: requireLogin });
  route('/admin/staff', page('../admin/staff.js', m => m.adminStaffPage),
    { title: '身分授權', guard: requireLogin });
}
