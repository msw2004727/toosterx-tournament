/**
 * 帳號路由（登入與「我的」）
 * ------------------------------------------------------------------
 * 規格：docs/10 §1.4
 *
 * 一個登入入口通吃隊長、家長、工作人員——登入之後是誰、能做什麼，
 * 由 `staff/{uid}.roles` 與 `teams/{id}.captainUid` 決定，不在路由層分流。
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

export function registerAccountRoutes() {
  route('/login', page('./login.js', m => m.loginPage), { title: '登入' });
  route('/my', page('./my.js', m => m.myPage), { title: '我的' });
}
