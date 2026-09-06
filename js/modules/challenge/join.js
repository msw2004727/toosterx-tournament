/**
 * 領挑戰卡 `#/challenge/join`
 * ------------------------------------------------------------------
 * 規格：docs/06 §5.1（2026-09-06 主辦修訂：挑戰卡綁 LINE 帳號、由系統配發）
 *
 * 玩家不再自己取暱稱建卡。用 LINE 登入，系統就配一張專屬挑戰卡（代號＋QR），
 * 暱稱先用 LINE 名稱、之後可以改。一個 LINE 帳號一張卡；換手機用同一個帳號
 * 登入就是同一張，所以也不再需要「找回」。
 *
 * 小朋友沒有 LINE：家長用自己的帳號領（一個帳號一張），第二個孩子請到攤位代建。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式。
 */
import { el, mount, skeleton } from '../../core/ui.js';
import { iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';
import { onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import * as data from './data.js';
import { savePass } from './pass.js';

export async function challengeJoinPage({ scope, view }) {
  const root = el('div', { class: 'chal' });
  mount(view, root);
  mount(root, skeleton(2));

  const state = { phase: 'checking', error: null };   // checking | login | issuing | failed
  let started = false;

  // onAuth 會**同步**用目前狀態叫一次；登入狀態一到位就配卡，沒登入就畫登入卡
  hold(scope, onAuth(u => {
    if (data.isLineUser(u)) { if (!started) { started = true; issue(); } return; }
    state.phase = 'login';
    render();
  }), 'auth:challenge-join');

  async function issue() {
    state.phase = 'issuing'; state.error = null; render();
    try {
      const r = await data.issuePass();
      if (!r?.playerId) throw new Error('沒有拿到代號，請再試一次');
      // 存一份在這支手機：離線也看得到 QR；權威仍是伺服器（users/{uid}.gamePassId）
      savePass({ playerId: r.playerId, nickname: r.nickname ?? null });
      navigate('/challenge/me');
    } catch (err) {
      started = false;
      state.phase = 'failed'; state.error = err; render();
    }
  }

  function loginCard() {
    return el('div', { class: 'chal__card chal__login' }, [
      el('strong', { text: '用 LINE 登入就有挑戰卡' }),
      el('p', { class: 'chal__hint', text: '系統會配一張專屬的挑戰卡（代號與 QR），一個 LINE 帳號一張。換手機用同一個帳號登入，卡還在。' }),
      el('button', {
        class: 'btn btn--xl btn--line chal__go', type: 'button',
        onClick: () => navigate('/login?next=' + encodeURIComponent('/challenge/join'))
      }, iconText('person', '用 LINE 領挑戰卡')),
      el('p', { class: 'chal__hint chal__hint--dim', text: '小朋友沒有 LINE？家長用自己的帳號領一張，第二個孩子請到攤位由工作人員代建。' })
    ]);
  }

  function render() {
    mount(root,
      el('div', { class: 'chal__hero' }, [
        el('strong', { class: 'chal__heroTitle', text: 'FEDA CUP 挑戰區' }),
        el('p', { class: 'chal__heroSub', text: '完成一關就有一次抽獎機會' })
      ]),
      state.phase === 'checking' || state.phase === 'issuing'
        ? el('div', { class: 'chal__card' }, [
            el('p', { class: 'chal__hint', text: state.phase === 'issuing' ? '正在配發你的挑戰卡…' : '正在確認登入狀態…' })
          ])
        : state.phase === 'failed'
          ? el('div', { class: 'chal__card chal__card--warn', role: 'alert' }, [
              el('strong', { text: '挑戰卡沒有配發成功' }),
              el('p', { class: 'chal__hint', text: data.explain(state.error, '請再試一次。') }),
              el('button', { class: 'btn btn--lg', type: 'button', onClick: () => { started = true; issue(); } },
                iconText('retry', '再試一次'))
            ])
          : loginCard(),
      el('button', {
        class: 'btn chal__back', type: 'button', onClick: () => navigate('/')
      }, iconText('back', '回賽事首頁'))
    );
  }
}
