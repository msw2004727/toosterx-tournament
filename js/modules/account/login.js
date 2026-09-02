/**
 * LINE 登入頁 `#/login`
 * ------------------------------------------------------------------
 * 規格：docs/04 §2、docs/10 §1.4
 *
 * 一個入口通吃三種人：隊長、家長、工作人員。
 * 登入之後是誰、能做什麼，由 `staff/{uid}.roles` 與
 * `teams/{id}.captainUid` 決定，不在這裡分流。
 *
 * ⚠️ 這一頁最重要的行為是**不要假裝可用**：
 *    LIFF SDK 載不到、Endpoint 設錯、scope 少勾 openid——
 *    每一種都要換成看得懂的說明，而不是留一顆按了沒反應的按鈕。
 */

import { el, mount, toast } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';
import { user, onAuth } from '../../core/firebase.js';
import { initLiff, loginWithLine, isInLineClient } from '../../core/liff.js';
import { EVENT } from '../../config.js';

export async function loginPage({ view, query }) {
  const root = el('div', { class: 'acct' });
  mount(view, root);

  // 登入完要回哪一頁。預設回「我的」——那裡看得到自己的身分與球隊。
  const next = query?.get('next') || '/my';

  const state = { phase: 'checking', error: null, inLine: false };

  // 已經登入就不必再看到登入頁
  const off = onAuth(u => { if (u) { off(); navigate(next); } });
  if (user()) return;

  render();
  try {
    await initLiff();
    state.inLine = await isInLineClient();
    state.phase = 'ready';
  } catch (err) {
    state.phase = 'unavailable';
    state.error = err.message;
  }
  render();

  function render() {
    mount(root,
      el('div', { class: 'acct__hero' }, [
        el('h1', { class: 'acct__title', text: EVENT.name }),
        el('p', { class: 'acct__sub', text: '用 LINE 登入就可以報名球隊、管理名單、查看自己的球員' })
      ]),
      body()
    );
  }

  function body() {
    if (state.phase === 'checking') {
      return el('p', { class: 'acct__note', text: '正在準備 LINE 登入…' });
    }

    if (state.phase === 'unavailable') {
      // 講清楚是什麼壞了，而不是「登入失敗」四個字
      return el('div', { class: 'acct__box acct__box--warn' }, [
        el('strong', { text: '現在沒辦法用 LINE 登入' }),
        el('p', { class: 'acct__note', text: state.error || '未知原因' }),
        el('button', {
          class: 'btn btn--lg', type: 'button',
          onClick: () => { state.phase = 'checking'; render(); retry(); }
        }, iconText('retry', '再試一次'))
      ]);
    }

    return el('div', { class: 'acct__box' }, [
      el('button', {
        class: 'btn btn--xl btn--line', type: 'button', onClick: () => start()
      }, iconText('person', '使用 LINE 登入')),

      el('p', { class: 'acct__fine', text: '我們只會取得你的 LINE 名稱與大頭貼，不會拿到你的聯絡方式，也不會發訊息給你。' }),

      state.inLine ? null : el('p', { class: 'acct__fine', text: '按下之後會跳到 LINE 完成授權，再自動回到這一頁。' })
    ].filter(Boolean));
  }

  async function retry() {
    try {
      await initLiff();
      state.phase = 'ready';
      state.error = null;
    } catch (err) {
      state.phase = 'unavailable';
      state.error = err.message;
    }
    render();
  }

  async function start() {
    try {
      // 尚未授權時這裡會導頁去 LINE，不會回來（回來時是新的一次載入）
      await loginWithLine(location.href);
      navigate(next);
    } catch (err) {
      console.error('[login]', err);
      toast(`登入沒有成功：${err.message}`, 'error');
    }
  }
}

/** 給其他頁面用的「請先登入」區塊 */
export function needLogin(nextPath) {
  return el('div', { class: 'acct__box acct__box--warn' }, [
    el('span', { class: 'acct__icon' }, icon('person')),
    el('strong', { text: '請先用 LINE 登入' }),
    el('p', { class: 'acct__note', text: '登入之後才看得到你的球隊與球員。' }),
    el('button', {
      class: 'btn btn--lg btn--primary', type: 'button',
      onClick: () => navigate(`/login?next=${encodeURIComponent(nextPath)}`)
    }, iconText('forward', '前往登入', { trailing: true }))
  ]);
}
