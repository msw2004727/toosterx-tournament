/**
 * 賽務端路由
 * ------------------------------------------------------------------
 * 規格：docs/04-功能規格-賽務裁判端.md
 *
 * 守衛的原則：**擋不住的東西不要假裝擋得住**。
 * 這裡的檢查只是為了給出好的錯誤畫面；真正的防線是 firestore.rules。
 */

import { route, navigate, lazy } from '../../core/router.js';
import { whenAuthReady, user, can } from '../../core/firebase.js';
import { el, mount, emptyState } from '../../core/ui.js';
import { CACHE_VERSION } from '../../config.js';

async function requireStaff() {
  await whenAuthReady();
  if (!user()) return '/staff/login';
  return true;
}

// 兩件事一起處理：
//   ① 動態 import 的網址帶上版號——沒有打包工具，這是唯一能讓快取確實失效的方法
//   ② 用 lazy() 包一層重試——部署當下的瞬間失效會讓 import() 永久記住失敗
const page = (path, fn) => {
  const url = new URL(path, import.meta.url).href + `?v=${CACHE_VERSION}`;
  const load = lazy(() => import(/* @vite-ignore */ url), url);
  return async ctx => {
    if (!can('staff.access')) {
      mount(ctx.view, emptyState({ title: '沒有賽務台權限', note: '請主辦指派有效的賽務身分，或確認身分是否已停用。', actionLabel: '回我的', onAction: () => navigate('/my') }));
      return;
    }
    const module = await load();
    return fn(module)(ctx);
  };
};

export function registerStaffRoutes() {
  route('/staff', page('../staff/home.js', m => m.staffHome),
    { title: '賽務首頁', guard: requireStaff });

  route('/staff/match/:matchId', page('../staff/live.js', m => m.liveConsole),
    { title: 'LIVE 賽務台', guard: requireStaff });

  route('/staff/sheet/:matchId', page('../staff/sheet.js', m => m.matchSheetPage),
    { title: '出場名單', guard: requireStaff });

  // 檢錄（規章第十八條第 3 款：賽前 30 分鐘）。守衛只擋到「有沒有登入」，
  // 「是不是檢錄員」由頁面自己顯示原因——擋在路由層只會得到一個空白頁。
  route('/staff/checkin/:matchId', page('../staff/checkin.js', m => m.checkinPage),
    { title: '檢錄', guard: requireStaff });

  route('/staff/login', ({ view }) => {
    view.replaceChildren(loginView());
  }, { title: '工作人員登入' });
}

function loginView() {
  return el('div', { class: 'login' }, [
    el('h1', { class: 'login__title', text: '工作人員登入' }),
    el('p', { class: 'login__note', text: '用 LINE 登入，系統會自動辨識你的身分與指派場地。' }),
    el('p', { class: 'login__note muted', text: '登入後若仍看到這個畫面，代表你的帳號還沒有被指派為工作人員，請聯絡主辦。' }),
    // 登入畫面只有一個入口（js/modules/account/login.js），賽務端不另做一套：
    // 兩套登入等於兩套「拿不到 idToken 該怎麼辦」的處理，遲早會分岔。
    el('button', {
      class: 'btn btn--xl btn--primary', type: 'button',
      onClick: () => navigate('/login?next=/staff')
    }, '前往 LINE 登入'),
    el('button', { class: 'btn btn--ghost', type: 'button', onClick: () => navigate('/') }, '回首頁')
  ]);
}
