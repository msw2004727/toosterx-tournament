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

import { route, lazy, navigate } from '../../core/router.js';
import { CACHE_VERSION } from '../../config.js';
import { el, mount } from '../../core/ui.js';
import { watchRegistrationVisibility, registrationVisible } from '../../core/registration.js';
import { getRegistration } from './data.js';

const page = (path, fn) => {
  const url = new URL(path, import.meta.url).href + `?v=${CACHE_VERSION}`;
  const load = lazy(() => import(/* @vite-ignore */ url), url);
  return async ctx => {
    if (path !== './waiver.js') {
      watchRegistrationVisibility(ctx.scope, visible => { if (!visible) navigate('/registration-closed'); });
    }
    const m = await load();
    return fn(m)(ctx);
  };
};

async function requireRegistration() {
  return registrationVisible(await getRegistration()) ? true : '/registration-closed';
}

export function registerRegistrationRoutes() {
  route('/registration-closed', ({ view }) => mount(view, el('section', { class: 'acct' }, [
    el('h1', { text: '線上報名已關閉' }),
    el('p', { text: '球隊名冊由主辦統一管理。如需調整資料，請聯絡主辦。' }),
    el('a', { class: 'btn btn--lg btn--primary', href: '#/' }, '回賽事首頁')
  ])), { title: '線上報名已關閉' });
  route('/register', page('./home.js', m => m.registerHome), { title: '球隊報名', guard: requireRegistration });
  route('/register/new', page('./new-team.js', m => m.newTeamPage), { title: '建立球隊', guard: requireRegistration });
  route('/join/:inviteCode', page('./join.js', m => m.joinPage), { title: '加入球隊', guard: requireRegistration });
  route('/team/:teamId/manage', page('./manage.js', m => m.managePage), { title: '管理球隊', guard: requireRegistration });
  route('/register/waiver', page('./waiver.js', m => m.waiverPage), { title: '眼鏡切結書' });
}
