/**
 * 賽務端路由
 * ------------------------------------------------------------------
 * 規格：docs/04-功能規格-賽務裁判端.md
 *
 * 守衛的原則：**擋不住的東西不要假裝擋得住**。
 * 這裡的檢查只是為了給出好的錯誤畫面；真正的防線是 firestore.rules。
 */

import { route, navigate } from '../../core/router.js';
import { onAuth, user, staff } from '../../core/firebase.js';
import { el } from '../../core/ui.js';

/** 等待第一次 auth 狀態回報（避免重新整理時誤判為未登入） */
function whenAuthReady() {
  return new Promise(resolve => {
    let done = false;
    const off = onAuth((u, s) => {
      if (done) return;
      done = true;
      // onAuth 會立刻用目前值呼叫一次；若當下還沒初始化完，等下一次
      setTimeout(() => { off(); resolve({ user: u, staff: s }); }, 0);
    });
  });
}

async function requireStaff() {
  await whenAuthReady();
  if (!user()) return '/staff/login';
  return true;
}

export function registerStaffRoutes() {
  route('/staff', ctx => import('./home.js').then(m => m.staffHome(ctx)),
    { title: '賽務首頁', guard: requireStaff });

  route('/staff/match/:matchId', ctx => import('./live.js').then(m => m.liveConsole(ctx)),
    { title: 'LIVE 賽務台', guard: requireStaff });

  route('/staff/sheet/:matchId', ctx => import('./sheet.js').then(m => m.matchSheetPage(ctx)),
    { title: '出場名單', guard: requireStaff });

  route('/staff/login', ({ view }) => {
    view.replaceChildren(loginView());
  }, { title: '工作人員登入' });
}

function loginView() {
  return el('div', { class: 'login' }, [
    el('h1', { class: 'login__title', text: '工作人員登入' }),
    el('p', { class: 'login__note', text: '請從主辦提供的 LINE 連結進入，系統會自動辨識你的身分與指派場地。' }),
    el('p', { class: 'login__note muted', text: '若你已收到連結卻仍看到這個畫面，可能是登入逾時，請重新點一次連結。' }),
    el('button', { class: 'btn btn--primary', type: 'button', onClick: () => navigate('/') }, '回首頁')
  ]);
}
