/**
 * 報名端路由
 * ------------------------------------------------------------------
 * 規格：docs/10 §3
 *
 * ⚠️ `/team/:teamId/manage` 必須註冊在公開端的 `/team/:teamId` **之前**：
 *    路由是先註冊先贏，而公開端那條的 pattern 不會吃到多一層路徑，
 *    但順序寫對比較不容易在日後改壞。
 *
 * 動態 import 照 js/modules/staff/index.js 的 page()：
 *   ① 網址帶版號（R-REL-015）　② 用 lazy() 包重試（R-REL-016）
 */

import { route, lazy } from '../../core/router.js';
import { CACHE_VERSION } from '../../config.js';

const page = (path, fn) => {
  const url = new URL(path, import.meta.url).href + `?v=${CACHE_VERSION}`;
  const load = lazy(() => import(/* @vite-ignore */ url), url);
  return ctx => load().then(m => fn(m)(ctx));
};

export function registerRegistrationRoutes() {
  route('/register', page('./home.js', m => m.registerHome), { title: '球隊報名' });
  route('/register/new', page('./new-team.js', m => m.newTeamPage), { title: '建立球隊' });
  route('/join/:inviteCode', page('./join.js', m => m.joinPage), { title: '加入球隊' });
  route('/team/:teamId/manage', page('./manage.js', m => m.managePage), { title: '管理球隊' });
}
