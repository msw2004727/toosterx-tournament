/**
 * 公開端路由
 * ------------------------------------------------------------------
 * 規格：docs/03-功能規格-公開端.md §1
 *
 * 公開端**完全免登入**，所以這裡沒有 guard——
 * 真正的邊界在 firestore.rules（公開集合 `allow read: if true`，
 * members 這類私密資料連讀都讀不到）。前端不假裝擋任何東西。
 *
 * 動態 import 的寫法照抄 js/modules/staff/index.js：
 *   ① 網址帶版號——沒有打包工具，這是唯一能讓快取確實失效的方法（R-REL-015）
 *   ② 用 lazy() 包一層重試——部署當下的瞬間失效會讓 import() 永久記住失敗（R-REL-016）
 */

import { route, lazy } from '../../core/router.js';
import { CACHE_VERSION } from '../../config.js';

const page = (path, fn) => {
  const url = new URL(path, import.meta.url).href + `?v=${CACHE_VERSION}`;
  const load = lazy(() => import(/* @vite-ignore */ url), url);
  return ctx => load().then(m => fn(m)(ctx));
};

export function registerPublicRoutes() {
  route('/', page('./home.js', m => m.publicHome),
    { title: '首頁' });

  route('/schedule', page('./schedule.js', m => m.publicSchedule),
    { title: '賽程' });

  route('/match/:matchId', page('./match.js', m => m.publicMatch),
    { title: '比賽' });

  route('/division/:divisionId', page('./division.js', m => m.publicDivision),
    { title: '組別' });

  route('/team/:teamId', page('./team.js', m => m.publicTeam),
    { title: '球隊' });

  route('/player/:teamId/:memberId', page('./team.js', m => m.publicPlayer),
    { title: '球員' });

  route('/stats', page('./stats.js', m => m.publicStats),
    { title: '統計' });

  route('/live', page('./stats.js', m => m.publicLiveWall),
    { title: '直播牆' });
}
