/**
 * 開始挑戰 `#/challenge/join`
 * ------------------------------------------------------------------
 * 規格：docs/06 §5.1；驗收 C01（掃 QR 到拿到玩家 QR ≤ 20 秒，不需註冊）
 *
 * 取一個暱稱就開始。**不要手機、不要 Email、不要註冊、不要 LINE 登入**——
 * 挑戰區的客人是路過的家長跟小孩，多問一格就少一個人玩。
 *
 * 三件不可協商：
 *   1. **配號撞了要自己重試，不要把錯誤丟給玩家。** rules 只放行 create，
 *      撞號會被擋（fail-closed），這一頁換一組再送，最多五次。
 *   2. **年齡層是選填。** 總榜不分齡（主辦決定），但獎品日後想分兒童組時
 *      補問不回來——所以問，但不擋。
 *   3. **找回只要 ID。** 現場活動，安全性要求低（§5.1 明文）。
 *      多一道驗證只會讓換手機的家長卡在那裡。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式。
 */

import { el, mount, toast } from '../../core/ui.js';
import { iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';
import * as data from './data.js';
import {
  savedPass, savePass, newPlayerId, parsePlayerId, checkNickname, AGE_BANDS
} from './pass.js';

export async function challengeJoinPage({ view }) {
  const root = el('div', { class: 'chal' });
  mount(view, root);

  const state = {
    mode: 'create',           // create | recover
    nickname: '',
    ageBand: null,
    idInput: '',
    busy: false,
    error: null
  };

  // 已經有 Game Pass 的人不該停在這一頁——但**不自動跳走**：
  // 有人是特地來換一個新身分的（借朋友的手機玩）。畫一條捷徑就好。
  const existing = savedPass();

  render();

  // ── 具名函式（會被提升）───────────────────────────────────

  async function create() {
    const n = checkNickname(state.nickname);
    if (!n.ok) { toast(n.reason, 'warn'); return; }

    state.busy = true; state.error = null; render();
    try {
      const { playerId } = await data.createPass({
        nextId: newPlayerId, nickname: n.nickname, ageBand: state.ageBand
      });
      // 存不進去不算失敗（無痕視窗）——ID 仍然有效，只是下次要自己輸入。
      // 所以下一頁一定會把代號印得很大。
      savePass({ playerId, nickname: n.nickname });
      navigate('/challenge/me');
    } catch (err) {
      state.error = err;
      toast(data.explain(err, '沒有建立成功。'), 'error');
    } finally {
      state.busy = false; render();
    }
  }

  async function recover() {
    const pid = parsePlayerId(state.idInput);
    if (!pid) { toast('代號看起來不對，格式像 FEDA-0182', 'warn'); return; }

    state.busy = true; state.error = null; render();
    try {
      const p = await data.getPlayer(pid);
      if (!p) {
        // 「查無此人」不是錯誤，是打錯字。說清楚下一步怎麼做
        state.error = new Error(`找不到 ${pid}。請確認代號，或直接建立一組新的。`);
        return;
      }
      savePass({ playerId: p.playerId, nickname: p.nickname ?? null });
      navigate('/challenge/me');
    } catch (err) {
      state.error = err;
      toast(data.explain(err, '找不回來，請再試一次。'), 'error');
    } finally {
      state.busy = false; render();
    }
  }

  // ── 畫面 ─────────────────────────────────────────────────

  function tabs() {
    const tab = (key, label) => el('button', {
      class: 'chal__tab', type: 'button', 'aria-pressed': String(state.mode === key),
      onClick: () => { state.mode = key; state.error = null; render(); }
    }, label);
    return el('div', { class: 'chal__tabs' }, [
      tab('create', '第一次來'),
      tab('recover', '我已經有代號')
    ]);
  }

  function createForm() {
    return el('div', { class: 'chal__card' }, [
      el('label', { class: 'chal__label', for: 'chal-nick', text: '取一個暱稱就可以開始' }),
      el('input', {
        class: 'chal__input', id: 'chal-nick', type: 'text', maxlength: '12',
        placeholder: '例如：阿哲', value: state.nickname, autocomplete: 'off',
        onInput: e => { state.nickname = e.target.value; }
      }),
      el('p', { class: 'chal__hint', text: '不用手機號碼、不用註冊。最多 12 個字。' }),

      el('span', { class: 'chal__label', text: '年齡層（可以跳過）' }),
      el('div', { class: 'chal__chips' }, AGE_BANDS.map(b => el('button', {
        class: 'chal__chip', type: 'button', 'aria-pressed': String(state.ageBand === b.value),
        onClick: () => { state.ageBand = state.ageBand === b.value ? null : b.value; render(); }
      }, b.label))),

      el('button', {
        class: 'btn btn--lg btn--primary chal__go', type: 'button',
        disabled: state.busy, onClick: create
      }, iconText('play', state.busy ? '建立中…' : '開始挑戰'))
    ]);
  }

  function recoverForm() {
    return el('div', { class: 'chal__card' }, [
      el('label', { class: 'chal__label', for: 'chal-id', text: '輸入你的代號' }),
      el('input', {
        class: 'chal__input chal__input--id', id: 'chal-id', type: 'text',
        inputmode: 'numeric', placeholder: 'FEDA-0182', value: state.idInput,
        autocomplete: 'off', autocapitalize: 'characters',
        onInput: e => { state.idInput = e.target.value; }
      }),
      el('p', { class: 'chal__hint', text: '只打數字也可以，例如 182。' }),
      el('button', {
        class: 'btn btn--lg btn--primary chal__go', type: 'button',
        disabled: state.busy, onClick: recover
      }, iconText('retry', state.busy ? '找回中…' : '找回我的挑戰卡'))
    ]);
  }

  function render() {
    mount(root,
      el('div', { class: 'chal__hero' }, [
        el('strong', { class: 'chal__heroTitle', text: 'FEDA CUP 挑戰區' }),
        el('p', { class: 'chal__heroSub', text: '完成一關就有一次抽獎機會' })
      ]),

      existing
        ? el('div', { class: 'chal__note' }, [
            el('span', { text: `這台手機上已經有 ${existing.playerId}` }),
            el('button', {
              class: 'btn btn--sm', type: 'button', onClick: () => navigate('/challenge/me')
            }, '打開我的挑戰卡')
          ])
        : null,

      tabs(),
      state.mode === 'create' ? createForm() : recoverForm(),

      // 錯誤留在畫面上，不是只跳一個會自己消失的提示——
      // 「按了沒反應」是最難回報的故障
      state.error
        ? el('div', { class: 'chal__card chal__card--warn', role: 'alert' }, [
            el('strong', { text: '沒有成功' }),
            el('p', { class: 'chal__hint', text: data.explain(state.error) })
          ])
        : null,

      el('button', {
        class: 'btn chal__back', type: 'button', onClick: () => navigate('/')
      }, iconText('back', '回賽事首頁'))
    );
  }
}
