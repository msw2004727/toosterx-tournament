/**
 * 我的挑戰卡 `#/challenge/me`
 * ------------------------------------------------------------------
 * 規格：docs/06 §5.2、§7.2
 *
 * 玩家整個下午就是靠這一頁：把 QR 給攤位掃、看自己完成幾關、看抽獎張數。
 *
 * 四件不可協商：
 *   1. **QR 旁邊一定要同時印大字代號。** QR 掃不到的原因很多（螢幕太暗、
 *      有貼防窺片、鏡頭壞了、我的編碼器有 bug），而攤位本來就支援手動輸入。
 *      少了那行字，任何一種狀況都會讓人卡在攤位前面。
 *   2. **提醒把螢幕調亮。** 省電模式下的 OLED 幾乎掃不到，而玩家不會
 *      想到是這個原因。
 *   3. **用監聽而不是讀一次。** 玩家常常就站在攤位旁邊看著手機，
 *      成績一送出，進度與抽獎張數要自己跳。
 *   4. **抽獎張數用引擎算，不要讀 `player.luckyDrawEntries` 就好嗎？**
 *      要——那一格是 Function 寫的權威值。這裡顯示它，而**明細**
 *      （完成幾關、全破獎勵）用 `drawEntries` 算出來對照，兩者不一致時
 *      以權威值為準並顯示「計算中」。券發出去就收不回來，寧可慢一步。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式。
 */

import { el, mount, toast, skeleton } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';
import { qrSvg } from '../../lib/qr-render.js';
import { formatScore, drawEntries, normalizePhone, maskPhone } from '../../engine/challenge.js';
import * as data from './data.js';
import { savedPass, savePass, clearPass } from './pass.js';

export async function challengeMePage({ scope, view }) {
  const root = el('div', { class: 'chal' });
  mount(view, root);
  mount(root, skeleton(3));

  const pass = savedPass();
  if (!pass) { navigate('/challenge/join'); return; }

  const state = {
    playerId: pass.playerId,
    player: undefined,          // undefined = 還沒載入；null = 查無此人
    challenges: [],
    bests: [],
    rewards: null,
    // 中獎聯絡方式（docs/06 §7.2）：遮罩後的號碼留在本機，整支號碼只有主辦看得到
    contact: { phone: '', masked: pass.contactMasked ?? null, editing: false, busy: false, error: null },
    error: null
  };

  data.watchPlayer(scope, state.playerId, p => {
    state.player = p;
    // 伺服器上的暱稱才是權威（現場代建的那些一開始是用 ID 當暱稱，
    // 玩家改過之後這台裝置也要跟著更新）
    if (p?.nickname) savePass({ playerId: state.playerId, nickname: p.nickname });
    render();
  }, err => { state.error = err; state.player = null; render(); });

  data.getChallenges().then(c => { state.challenges = c; render(); }).catch(() => {});
  data.getMyBests(state.playerId).then(b => { state.bests = b; render(); }).catch(() => {});
  data.getRewards().then(r => { state.rewards = r; render(); }).catch(() => {});

  // ── 具名函式（會被提升）───────────────────────────────────

  function bestOf(challengeId) {
    return state.bests.find(b => b.challengeId === challengeId) ?? null;
  }

  function completedIds() {
    const c = state.player?.completedChallengeIds;
    return Array.isArray(c) ? c : [];
  }

  function switchPass() {
    clearPass();
    navigate('/challenge/join');
  }

  async function copyId() {
    try {
      await navigator.clipboard.writeText(state.playerId);
      toast('代號已複製');
    } catch {
      // 沒有剪貼簿權限（http、舊瀏覽器）就不要假裝成功
      toast('複製不了，請照著畫面上的代號念給工作人員', 'warn');
    }
  }

  // ── 畫面 ─────────────────────────────────────────────────

  function qrCard() {
    return el('div', { class: 'chal__card chal__qrCard' }, [
      // ⚠️ QR 是 SVG 字串，這裡用 innerHTML 塞進去。內容是
      //    `qrSvg()` 自己產生的、不含任何使用者輸入（只有 FEDA-0182），
      //    所以不是 R-CODE-002 的情形——但 label 有暱稱，那一段已經
      //    在 qrSvg 裡走過 escape，這裡刻意只傳代號當 label。
      el('div', { class: 'chal__qr', html: qrSvg(state.playerId, { label: `我的代號 ${state.playerId}` }) }),
      el('strong', { class: 'chal__pid', text: state.playerId }),
      el('span', { class: 'chal__nick', text: state.player?.nickname ?? '' }),
      el('p', { class: 'chal__hint', text: '把這一頁拿給攤位工作人員掃。掃不到的話，念代號給他們也可以。' }),
      el('div', { class: 'chal__row' }, [
        el('button', { class: 'btn btn--sm', type: 'button', onClick: copyId },
          iconText('note', '複製代號')),
        el('button', { class: 'btn btn--sm', type: 'button', onClick: switchPass },
          iconText('person', '換一張卡'))
      ]),
      el('p', { class: 'chal__hint chal__hint--dim', text: '螢幕調亮一點比較好掃。' })
    ]);
  }

  function progressCard() {
    const done = completedIds();
    const total = state.challenges.length;
    return el('div', { class: 'chal__card' }, [
      el('div', { class: 'chal__cardHead' }, [
        el('strong', { text: '我的進度' }),
        el('span', { class: 'chal__count', text: total ? `${done.length} / ${total}` : '—' })
      ]),
      total === 0
        ? el('p', { class: 'chal__hint', text: '關卡還沒公布。' })
        : el('ul', { class: 'chal__list' }, state.challenges.map(c => {
            const b = bestOf(c.challengeId);
            const ok = done.includes(c.challengeId);
            return el('li', { class: 'chal__item', 'data-done': String(ok) }, [
              el('span', { class: 'chal__itemIcon' }, icon(c.icon || 'target')),
              el('div', { class: 'chal__itemMain' }, [
                el('strong', { class: 'chal__itemName', text: c.shortName || c.name || c.challengeId }),
                el('span', { class: 'chal__itemVenue', text: c.boothLocation ?? '' })
              ]),
              el('span', { class: 'chal__itemScore', text: b ? formatScore(b.rawValue, c) : '未挑戰' }),
              ok ? el('span', { class: 'chal__itemDone' }, icon('check')) : null
            ].filter(Boolean));
          }))
    ]);
  }

  function drawCard() {
    // 權威是 Function 寫進 player 的那一格——券發出去就收不回來（FN#17）
    const authoritative = Number.isInteger(state.player?.luckyDrawEntries)
      ? state.player.luckyDrawEntries : null;
    const derived = state.rewards
      ? drawEntries({
          completedChallengeIds: completedIds(),
          challengeTotal: state.challenges.length,
          rewards: state.rewards
        })
      : null;
    const pending = authoritative != null && derived != null && derived.entries !== authoritative;

    return el('div', { class: 'chal__card chal__card--draw' }, [
      el('div', { class: 'chal__cardHead' }, [
        el('strong', {}, iconText('ticket', '我的抽獎資格')),
        el('span', { class: 'chal__count', text: authoritative == null ? '—' : `${authoritative} 張` })
      ]),
      derived
        ? el('ul', { class: 'chal__breakdown' }, [
            el('li', { text: `完成關卡 ${completedIds().length} / ${state.challenges.length}　→　${derived.fromCompletion} 張` }),
            derived.bonus ? el('li', { text: `全破獎勵　→　${derived.bonus} 張` }) : null
          ].filter(Boolean))
        : el('p', { class: 'chal__hint', text: '抽獎規則還沒公布。' }),
      // 兩個數字不一致時**不要自己改**，說「計算中」就好
      pending
        ? el('p', { class: 'chal__hint', text: '剛剛的成績還在計算，張數稍後會更新。' })
        : null
    ].filter(Boolean));
  }

  function render() {
    if (state.player === undefined) { mount(root, skeleton(3)); return; }

    if (state.player === null) {
      mount(root,
        el('div', { class: 'chal__card chal__card--warn', role: 'alert' }, [
          el('strong', { text: `找不到 ${state.playerId}` }),
          el('p', { class: 'chal__hint', text: state.error
            ? data.explain(state.error)
            : '這組代號在伺服器上不存在了。可以重新建立一張挑戰卡。' }),
          el('button', { class: 'btn btn--lg', type: 'button', onClick: switchPass },
            iconText('retry', '重新建立'))
        ]));
      return;
    }

    mount(root,
      qrCard(),
      progressCard(),
      drawCard(),
      contactCard(),
      el('button', {
        class: 'btn chal__back', type: 'button', onClick: () => navigate('/')
      }, iconText('back', '回賽事首頁'))
    );
  }

  // ── 中獎聯絡方式（docs/06 §7.2）────────────────────────────
  //
  // 選填，只用來通知中獎。電話不放在任何人都讀得到的 players 文件上，
  // 走 Function 寫進只有主辦讀得到的地方；身分靠建卡時留在這支手機的憑證。
  // 找回的卡（別的裝置建的）沒有憑證——說清楚要到攤位登記，不畫一個會失敗的表單。
  function contactCard() {
    const c = state.contact;
    const hasKey = !!pass.contactKey;
    const body = [];
    if (c.masked && !c.editing) {
      body.push(el('p', { class: 'chal__hint', text: `已填：${c.masked}（只用來通知中獎，不會公開）` }));
      body.push(el('button', {
        class: 'btn btn--sm', type: 'button',
        onClick: () => { c.editing = true; c.error = null; render(); }
      }, '修改'));
    } else if (!hasKey) {
      body.push(el('p', { class: 'chal__hint', text:
        '這張卡是在別的裝置建立或由攤位代建的，這裡填不了聯絡方式。中獎要通知的話，請到任一攤位登記手機號碼。' }));
    } else {
      body.push(el('p', { class: 'chal__hint', text: '選填。抽獎時若中獎，主辦用這支手機通知你。不填的話現場唱名。' }));
      body.push(el('div', { class: 'chal__contact' }, [
        el('input', {
          class: 'chal__input', id: 'contact-phone', type: 'tel', inputmode: 'tel',
          placeholder: '09xx-xxx-xxx', maxlength: '20', value: c.phone,
          'aria-label': '手機號碼',
          onInput: e => { c.phone = e.target.value; }
        }),
        el('button', {
          class: 'btn btn--primary', type: 'button', id: 'contact-save', disabled: c.busy,
          onClick: () => saveContact()
        }, c.busy ? '儲存中…' : iconText('check', '儲存'))
      ]));
      if (c.error) body.push(el('p', { class: 'chal__contactErr', role: 'alert', text: c.error }));
    }
    return el('div', { class: 'chal__card chal__card--contact' }, [
      el('div', { class: 'chal__cardHead' }, [el('strong', {}, iconText('person', '中獎聯絡方式'))]),
      ...body
    ]);
  }

  async function saveContact() {
    const c = state.contact;
    const phone = normalizePhone(c.phone);
    if (!phone) { c.error = '手機號碼要是 09 開頭的 10 碼，例如 0912-345-678'; render(); return; }
    c.busy = true; c.error = null; render();
    try {
      const r = await data.setContact({ playerId: state.playerId, key: pass.contactKey, phone });
      c.masked = r?.maskedPhone ?? maskPhone(phone);
      c.editing = false;
      savePass({ ...pass, contactMasked: c.masked });
      toast('已儲存聯絡方式');
    } catch (err) {
      // 錯誤留在畫面上：callable 離線會直接失敗，跳一個會消失的提示等於沒說
      c.error = data.explain(err, '沒有儲存成功，請再試一次。');
    } finally {
      c.busy = false; render();
    }
  }
}
