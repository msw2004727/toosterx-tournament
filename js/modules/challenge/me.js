/**
 * 我的挑戰卡 `#/challenge/me`
 * ------------------------------------------------------------------
 * 規格：docs/06 §5.2、§7.2（2026-09-06 主辦修訂：挑戰卡綁 LINE 帳號、由系統配發）
 *
 * 玩家整個下午就是靠這一頁：把 QR 給攤位掃、看自己完成幾關、看抽獎張數。
 *
 * 身分：用 LINE 登入的帳號就是卡主（users/{uid}.gamePassId）。這支手機會存一份
 * 代號當快取——離線、或還沒登入完成時也畫得出 QR；但填聯絡方式、改暱稱要登入。
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
import { onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { qrSvg } from '../../lib/qr-render.js';
import { formatScore, drawEntries, normalizePhone, maskPhone } from '../../engine/challenge.js';
import * as data from './data.js';
import { savedPass, savePass } from './pass.js';

/**
 * QR 的內容是攤位頁的網址，不是裸代號：攤位用手機相機掃就直接開攤位頁並帶入代號，
 * 不必再打字。攤位頁內的掃描器與輸入框都認得這種網址（parseScannedId）。
 * 長度約 50 個位元組，在 QR 產生器的上限（62）之內。
 */
function boothLink(playerId) {
  return `${location.origin}${location.pathname}#/booth?id=${encodeURIComponent(playerId)}`;
}

export async function challengeMePage({ scope, view }) {
  const root = el('div', { class: 'chal' });
  mount(view, root);
  mount(root, skeleton(3));

  const cached = savedPass();
  const state = {
    playerId: cached?.playerId ?? null,
    player: undefined,          // undefined = 還沒載入；null = 查無此人
    owner: false,               // 目前登入的 LINE 帳號是這張卡的主人
    authKnown: false,           // 已經知道有沒有登入（避免一開頁就閃登入卡）
    challenges: [],
    bests: [],
    rewards: null,
    contact: { phone: '', masked: cached?.contactMasked ?? null, editing: false, busy: false, error: null },
    error: null
  };
  let watching = null;
  let issued = false;
  let offWatch = null;

  // 有快取先畫（離線也看得到 QR）；登入到位後再向伺服器要權威的那一張
  if (state.playerId) startWatch();

  hold(scope, onAuth(u => {
    state.authKnown = true;
    if (!data.isLineUser(u)) { state.owner = false; render(); return; }
    state.owner = true;
    if (!issued) { issued = true; ensurePass(); }
    render();
  }), 'auth:challenge-me');

  data.getChallenges().then(c => { state.challenges = c; render(); }).catch(() => {});
  data.getRewards().then(r => { state.rewards = r; render(); }).catch(() => {});

  // ── 資料 ─────────────────────────────────────────────────

  /** 向伺服器要這個帳號的卡：沒有就配一張、有就拿同一張（快取過期時會換到正確的代號） */
  async function ensurePass() {
    try {
      const r = await data.issuePass();
      if (!r?.playerId) throw new Error('沒有拿到代號');
      if (r.playerId !== state.playerId) {
        state.playerId = r.playerId;
        state.player = undefined;
        state.error = null;
      }
      savePass({ playerId: r.playerId, nickname: r.nickname ?? null, contactMasked: state.contact.masked });
      startWatch();
    } catch (err) {
      issued = false;
      if (!state.playerId) { state.error = err; state.player = null; }
      else toast(data.explain(err, '連不上伺服器，先用這支手機上的卡。'), 'warn');
      render();
    }
  }

  function startWatch() {
    if (!state.playerId || watching === state.playerId) return;
    watching = state.playerId;
    offWatch?.();
    offWatch = data.watchPlayer(scope, state.playerId, p => {
      state.player = p;
      if (p?.nickname) savePass({ playerId: state.playerId, nickname: p.nickname, contactMasked: state.contact.masked });
      render();
    }, err => { state.error = err; state.player = null; render(); });
    data.getMyBests(state.playerId).then(b => { state.bests = b; render(); }).catch(() => {});
  }

  function bestOf(challengeId) {
    return state.bests.find(b => b.challengeId === challengeId) ?? null;
  }

  function completedIds() {
    const c = state.player?.completedChallengeIds;
    return Array.isArray(c) ? c : [];
  }

  function goLogin() {
    navigate('/login?next=' + encodeURIComponent('/challenge/me'));
  }

  async function copyId() {
    try {
      await navigator.clipboard.writeText(state.playerId);
      toast('代號已複製');
    } catch {
      toast('複製不了，請照著畫面上的代號念給工作人員', 'warn');
    }
  }

  // ── 畫面 ─────────────────────────────────────────────────

  function loginCard(note) {
    return el('div', { class: 'chal__card chal__login' }, [
      el('strong', { text: '用 LINE 登入就有挑戰卡' }),
      el('p', { class: 'chal__hint', text: note ?? '系統會配一張專屬的挑戰卡，一個 LINE 帳號一張。換手機用同一個帳號登入，卡還在。' }),
      el('button', { class: 'btn btn--xl btn--line chal__go', type: 'button', onClick: goLogin },
        iconText('person', '用 LINE 領挑戰卡'))
    ]);
  }

  function qrCard() {
    return el('div', { class: 'chal__card chal__qrCard' }, [
      // ⚠️ QR 是 SVG 字串，這裡用 innerHTML 塞進去。內容是 qrSvg() 自己產生的
      //    （攤位頁網址＋代號），不含任何使用者輸入，所以不是 R-CODE-002 的情形。
      el('div', { class: 'chal__qr', html: qrSvg(boothLink(state.playerId), { label: `我的代號 ${state.playerId}` }) }),
      el('strong', { class: 'chal__pid', text: state.playerId }),
      el('span', { class: 'chal__nick', text: state.player?.nickname ?? '' }),
      el('p', { class: 'chal__hint', text: '把這一頁拿給攤位工作人員，用手機相機掃就會帶入你的代號。掃不到的話，念代號給他們也可以。' }),
      el('div', { class: 'chal__row' }, [
        el('button', { class: 'btn btn--sm', type: 'button', onClick: copyId },
          iconText('note', '複製代號'))
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
      pending
        ? el('p', { class: 'chal__hint', text: '剛剛的成績還在計算，張數稍後會更新。' })
        : null
    ].filter(Boolean));
  }

  // ── 中獎聯絡方式（docs/06 §7.2）────────────────────────────
  //
  // 選填，只用來通知中獎。電話不放在任何人都讀得到的 players 文件上，
  // 走 Function 寫進只有主辦讀得到的地方；身分就是登入的 LINE 帳號（卡主）。
  // 沒登入（只有這支手機的快取）就說清楚要登入，不畫一個會失敗的表單。
  function contactCard() {
    const c = state.contact;
    const body = [];
    if (c.masked && !c.editing) {
      body.push(el('p', { class: 'chal__hint', text: `已填：${c.masked}（只用來通知中獎，不會公開）` }));
      if (state.owner) {
        body.push(el('button', {
          class: 'btn btn--sm', type: 'button',
          onClick: () => { c.editing = true; c.error = null; render(); }
        }, '修改'));
      }
    } else if (!state.owner) {
      body.push(el('p', { class: 'chal__hint', text: '要填聯絡方式請先用領卡的 LINE 帳號登入。中獎要通知的話，也可以到任一攤位登記手機號碼。' }));
      body.push(el('button', { class: 'btn btn--sm', type: 'button', onClick: goLogin }, iconText('person', '用 LINE 登入')));
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
      const r = await data.setContact({ playerId: state.playerId, phone });
      c.masked = r?.maskedPhone ?? maskPhone(phone);
      c.editing = false;
      savePass({ playerId: state.playerId, nickname: state.player?.nickname ?? null, contactMasked: c.masked });
      toast('聯絡方式已登記');
    } catch (err) {
      // callable 會 reject（離線也是）：原因留在畫面上，不是跳一下就消失
      c.error = data.explain(err, '沒有登記成功，請再試一次。');
    } finally {
      c.busy = false; render();
    }
  }

  function render() {
    // 沒有卡也還不知道登入狀態：等一下，不要一開頁就閃登入卡
    if (!state.playerId) {
      if (!state.authKnown) { mount(root, skeleton(3)); return; }
      if (state.owner) {
        mount(root, state.error
          ? el('div', { class: 'chal__card chal__card--warn', role: 'alert' }, [
              el('strong', { text: '挑戰卡沒有配發成功' }),
              el('p', { class: 'chal__hint', text: data.explain(state.error, '請再試一次。') }),
              el('button', { class: 'btn btn--lg', type: 'button', onClick: () => { state.error = null; issued = true; ensurePass(); render(); } },
                iconText('retry', '再試一次'))
            ])
          : el('div', { class: 'chal__card' }, [el('p', { class: 'chal__hint', text: '正在配發你的挑戰卡…' })]));
        return;
      }
      mount(root, loginCard(), backButton());
      return;
    }
    if (state.player === undefined) { mount(root, skeleton(3)); return; }
    if (state.player === null) {
      mount(root,
        el('div', { class: 'chal__card chal__card--warn', role: 'alert' }, [
          el('strong', { text: `找不到 ${state.playerId}` }),
          el('p', { class: 'chal__hint', text: state.error
            ? data.explain(state.error)
            : '這組代號在伺服器上不存在了。用 LINE 登入會重新配發一張。' }),
          state.owner
            ? el('button', { class: 'btn btn--lg', type: 'button', onClick: () => { issued = true; state.player = undefined; ensurePass(); render(); } },
                iconText('retry', '重新配發'))
            : el('button', { class: 'btn btn--lg btn--line', type: 'button', onClick: goLogin },
                iconText('person', '用 LINE 登入重新配發'))
        ]),
        backButton());
      return;
    }
    mount(root,
      qrCard(),
      progressCard(),
      drawCard(),
      contactCard(),
      backButton()
    );
  }

  function backButton() {
    return el('button', {
      class: 'btn chal__back', type: 'button', onClick: () => navigate('/')
    }, iconText('back', '回賽事首頁'));
  }
}
