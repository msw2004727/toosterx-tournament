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

import { el, mount } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';
import { user, onAuth } from '../../core/firebase.js';
import { initLiff, loginWithLine, isInLineClient, isLineLoggedIn, logoutLine, rememberNext } from '../../core/liff.js';
import { EVENT } from '../../config.js';

export async function loginPage({ view, query }) {
  const root = el('div', { class: 'acct' });
  mount(view, root);

  // 登入完要回哪一頁。預設回「我的」——那裡看得到自己的身分與球隊。
  const next = query?.get('next') || '/my';

  const state = { phase: 'checking', error: null, inLine: false };

  // 開機時處理 LINE 導回失敗的話，原因會被放在這裡（見 app.js）。
  // 使用者是被導回登入頁的，畫面上一定要說得出為什麼。
  try {
    const boot = sessionStorage.getItem('feda:loginError');
    if (boot) { sessionStorage.removeItem('feda:loginError'); state.phase = 'failed'; state.error = boot; }
  } catch { /* 無痕模式讀不到就算了 */ }

  // 已經登入就不必再看到登入頁
  // 已登入就直接導走，不必訂閱。
  // ⚠️ onAuth() 會**同步**呼叫一次回呼——在回呼裡參考 `off` 會撞到 TDZ
  //    （已登入時整頁「Cannot access 'off' before initialization」，驗收 D-02）。
  if (user()) { navigate(next); return; }
  const off = onAuth(u => { if (u) { off(); navigate(next); } });

  render();
  if (state.phase === 'failed') return;      // 已經有導回失敗的原因，不要再蓋掉

  try {
    await initLiff();
    state.inLine = await isInLineClient();

    // ⚠️ 這一段是整頁最關鍵的地方。
    //    liff.login() 會**離開這一頁**跳去 LINE 授權，授權完再導回來——
    //    回來時是全新的一次載入，LINE 那側已經是登入狀態，但 Firebase 這側還不是。
    //    少了下面這幾行，使用者授權完回來只會看到同一顆按鈕，
    //    以為登入失敗（第一版就是這樣，實測時 lineLogin 一次都沒被呼叫到）。
    //    在 LINE 內建瀏覽器裡也一樣受惠：那裡本來就已經登入，連按都不用按。
    if (await isLineLoggedIn()) {
      state.phase = 'exchanging';
      render();
      await start();
      return;
    }
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

    if (state.phase === 'exchanging') {
      return el('p', { class: 'acct__note', text: '已取得 LINE 授權，正在完成登入…' });
    }

    // 換發登入失敗（例如伺服器端少了簽章權限）。這種錯誤**必須留在畫面上**，
    // 不能只跳一個會自己消失的提示——否則使用者只會看到「按了沒反應」。
    if (state.phase === 'failed') {
      return el('div', { class: 'acct__box acct__box--warn' }, [
        el('strong', { text: '登入沒有完成' }),
        el('p', { class: 'acct__note', text: state.error || '未知原因' }),
        el('p', { class: 'acct__fine', text: '如果一直出現同樣的訊息，請把上面這句話回報給主辦。' }),
        el('button', {
          class: 'btn btn--lg', type: 'button', onClick: () => { state.phase = 'ready'; render(); }
        }, iconText('retry', '再試一次')),
        el('button', {
          class: 'btn btn--ghost', type: 'button', onClick: () => resetLine()
        }, '改用其他 LINE 帳號')
      ]);
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
      // ⚠️ 目的地存 sessionStorage，不靠網址的 hash——OAuth 導轉會把 `#` 之後
      //    的內容丟掉（實測回來是落在公開首頁）。導回後由 app.js 撿回來。
      rememberNext(next);
      // 尚未授權時這裡會導頁去 LINE，不會回來（回來時是新的一次載入）
      await loginWithLine(`${location.origin}/`);
      navigate(next);
    } catch (err) {
      console.error('[login]', err);
      state.phase = 'failed';
      state.error = err.message;
      render();
    }
  }

  /** 換一個 LINE 帳號：把 LINE 那側也登出，下一次才會重新問 */
  async function resetLine() {
    await logoutLine();
    state.phase = 'ready';
    state.error = null;
    render();
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
