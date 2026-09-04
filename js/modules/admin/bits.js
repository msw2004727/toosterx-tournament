/**
 * 管理後台的共用小元件
 * ------------------------------------------------------------------
 * 只放「管理後台用得到、其他地方用不到」的東西。
 */

import { el } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';

export const TEAM_STATUS = {
  draft: '草稿', submitted: '待審核', approved: '已通過',
  rejected: '已退回', withdrawn: '已撤銷'
};

/**
 * 管理後台的頁首。
 *
 * 「返回」一律回專屬首頁（`#/my`）而不是瀏覽器上一頁：
 * 管理員常常從幾個功能之間跳來跳去，回到功能區比回到上一個功能有用。
 */
export function adminHead(title, { sub } = {}) {
  return el('div', { class: 'adm__head' }, [
    el('button', {
      class: 'adm__back', type: 'button', 'aria-label': '回我的功能',
      onClick: () => navigate('/my')
    }, icon('back')),
    el('div', { class: 'adm__headText' }, [
      el('strong', { text: title }),
      sub ? el('span', { class: 'adm__headSub', text: sub }) : null
    ].filter(Boolean))
  ]);
}

/**
 * 沒有權限時的畫面。
 *
 * 說清楚「需要什麼身分」而不是只寫「沒有權限」——
 * 現場最常見的情況是身分剛被指派、瀏覽器還拿著舊的快取。
 */
export function denied(what, needRole) {
  return el('div', { class: 'adm__box adm__box--warn' }, [
    el('strong', { text: `你沒有「${what}」的權限` }),
    el('p', { class: 'adm__note', text: `這一頁需要${needRole}以上的身分。如果剛被指派，請重新整理一次。` }),
    el('button', {
      class: 'btn btn--lg', type: 'button', onClick: () => navigate('/my')
    }, iconText('back', '回我的功能'))
  ]);
}
