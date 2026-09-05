/**
 * 挑戰區（玩家端）路由
 * ------------------------------------------------------------------
 * 規格：docs/06 §5、§8
 *
 * ⚠️ **完全沒有守衛。** 這一端免註冊、免登入——掛一個 `requireLogin`
 *    上去就等於把「不需要註冊」這件事整個推翻掉。身分是 localStorage
 *    裡的一組 `FEDA-0182`，沒有的話頁面自己導去建立。
 *
 * ⚠️ 必須註冊在公開端**之前**（路由先註冊先贏）：`app.js` 已經照這個
 *    順序排。`/challenge/...` 不該被公開端的萬用樣式接走。
 */

import { route, lazy } from '../../core/router.js';
import { CACHE_VERSION } from '../../config.js';

// 動態 import 帶版號＋lazy() 重試（同 staff/index.js，見 R-REL-016）
const page = (path, fn) => {
  const url = new URL(path, import.meta.url).href + `?v=${CACHE_VERSION}`;
  const load = lazy(() => import(/* @vite-ignore */ url), url);
  return ctx => load().then(m => fn(m)(ctx));
};

export function registerChallengeRoutes() {
  route('/challenge/join', page('../challenge/join.js', m => m.challengeJoinPage),
    { title: '開始挑戰' });
  route('/challenge/me', page('../challenge/me.js', m => m.challengeMePage),
    { title: '我的挑戰卡' });
}
