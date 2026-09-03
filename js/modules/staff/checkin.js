/**
 * 檢錄台 `#/staff/checkin/:matchId`
 * ------------------------------------------------------------------
 * 規格：競賽規章第十八條第 3 款、docs/04 §4
 *
 *   「應於賽前 30 分鐘至大會檢錄，如有冒名頂替者立即停止該球隊繼續比賽
 *     資格，已賽成績不予計算。」
 *
 * 學童三組的檢錄方式（主辦 2026-09-03 指定）：
 *   球隊負責人帶證件到檢錄處 → 檢錄員開這一頁 → 逐筆核對
 *   「暱稱／背號／出生年月日／身分證後四碼」→ 勾選確認出賽 → 送出。
 *
 * **不掃 QR。** 小球員沒有手機也沒有球員證，能核對的只有大人手上的證件。
 * 這一頁把後四碼與民國年生日印得夠大，讓檢錄員拿著健保卡就對得起來。
 *
 * ⚠️ 三件不可協商的事：
 *   1. **送出三態**（docs/04 §5.7）。這裡不 await Firestore 的 Promise——
 *      離線時它永遠 pending，畫面會卡住（R-UI-002）。
 *   2. **離線可用**。檢錄處常常在場邊訊號最差的角落，勾選必須照常能完成，
 *      恢復連線自動補送。
 *   3. **一切留痕**。每一筆都寫 scannedBy／scannedAt，改判也留紀錄。
 */

import { el, mount, toast, skeleton, confirmDialog } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';
import { user, canCheckin } from '../../core/firebase.js';
import { watchMatch } from './data.js';
import { watchCheckins, saveCheckin, getCheckinRoster } from './checkin-data.js';
import { buildCheckin, checkinSummary, presentIds } from './checkin-actions.js';

export async function checkinPage({ params, scope, view }) {
  const { matchId } = params;
  const root = el('div', { class: 'chk' });
  mount(view, root);
  mount(root, skeleton(5));

  // ⚠️ 每一個 render()／loadRosters() 會讀到的可變狀態都要放進這個物件，
  //    而且宣告在監聽之前。onSnapshot 的第一筆快照可能**同步**送達，
  //    寫成 `let x` 放在監聽下面就會撞 TDZ，callback 整個拋掉——
  //    而且畫面看起來只是「名單是空的」，不像壞掉。
  //    這是這個 codebase 第五次踩到同一個坑（見 CLAUDE.md）。
  const state = {
    match: null, rosters: {}, checkins: {},
    side: 'home', loaded: false, busy: false,
    rosterKey: null
  };

  if (!canCheckin()) {
    mount(root, denied());
    return;
  }

  watchMatch(scope, matchId, m => {
    state.match = m;
    state.loaded = true;
    loadRosters();
    render();
  }, err => {
    console.error('[checkin] match', err);
    state.loaded = true;
    mount(root, errorBox('讀不到這場比賽', err));
  });

  watchCheckins(scope, matchId, rows => {
    state.checkins = Object.fromEntries(rows.map(r => [r.memberId, r]));
    render();
  }, err => console.warn('[checkin] checkins', err));

  // ── 名單 ────────────────────────────────────────────────
  // 一律具名函式（會被提升）。
  async function loadRosters() {
    const key = `${state.match?.homeTeamId}|${state.match?.awayTeamId}`;
    if (!state.match?.homeTeamId || state.rosterKey === key) return;
    state.rosterKey = key;
    for (const side of ['home', 'away']) {
      const teamId = state.match[`${side}TeamId`];
      if (!teamId) continue;
      try {
        state.rosters[side] = await getCheckinRoster(teamId);
      } catch (err) {
        console.warn('[checkin] roster', teamId, err);
        state.rosters[side] = [];
      }
      render();
    }
  }

  function teamName(side) {
    return state.match?.[`${side}TeamName`] || state.match?.[`${side}TeamId`] || (side === 'home' ? '主隊' : '客隊');
  }

  function rows() { return state.rosters[state.side] || []; }

  function render() {
    if (!state.loaded) return;
    if (!state.match) {
      mount(root, errorBox('找不到這場比賽', null));
      return;
    }

    const list = rows();
    const sum = checkinSummary(list, state.checkins);

    mount(root,
      head(),
      tabs(sum),
      guide(),
      !list.length
        ? el('p', { class: 'chk__empty', text: '這一隊還沒有公開名單。請確認球隊已完成報名並通過審核。' })
        : el('ul', { class: 'chk__list' }, list.map(memberRow)),
      footer(sum)
    );
  }

  function head() {
    return el('div', { class: 'chk__head' }, [
      el('button', {
        class: 'chk__back', type: 'button', 'aria-label': '返回',
        onClick: () => navigate('/staff')
      }, icon('back')),
      el('div', { class: 'chk__headText' }, [
        el('strong', { text: '檢錄' }),
        el('span', { class: 'chk__headSub', text: `${teamName('home')} vs ${teamName('away')}` })
      ])
    ]);
  }

  function tabs(sum) {
    return el('div', { class: 'chk__tabs', role: 'tablist' }, ['home', 'away'].map(side => {
      const list = state.rosters[side] || [];
      const s = side === state.side ? sum : checkinSummary(list, state.checkins);
      return el('button', {
        class: `chk__tab${side === state.side ? ' is-on' : ''}`,
        type: 'button', role: 'tab',
        'aria-selected': side === state.side ? 'true' : 'false',
        onClick: () => { state.side = side; render(); }
      }, [
        el('span', { class: 'chk__tabName', text: teamName(side) }),
        el('span', { class: 'chk__tabCount', text: `${s.present} / ${s.total}` })
      ]);
    }));
  }

  /** 檢錄員要看的一句話：核對什麼、勾什麼 */
  function guide() {
    return el('p', { class: 'chk__guide' },
      iconText('info', '請球隊負責人出示證件，逐筆核對「出生年月日」與「身分證後四碼」，相符再勾選。'));
  }

  function memberRow(m) {
    const rec = state.checkins[m.memberId];
    const present = rec?.result === 'pass';
    const failed = rec?.result === 'fail';

    return el('li', { class: `chk__row${present ? ' is-present' : ''}${failed ? ' is-failed' : ''}` }, [
      el('label', { class: 'chk__pick' }, [
        el('input', {
          class: 'chk__box', type: 'checkbox', checked: present, disabled: state.busy,
          'aria-label': `${m.displayName || m.memberId} 出賽`,
          onChange: e => mark(m, e.target.checked ? 'pass' : null)
        }),
        el('span', { class: 'chk__no num', text: m.jerseyNo != null ? String(m.jerseyNo) : '—' }),
        el('span', { class: 'chk__info' }, [
          el('strong', { class: 'chk__name', text: m.displayName || '（未填）' }),
          // 檢錄員拿證件對的就是這兩格，所以字要夠大、位置要固定
          el('span', { class: 'chk__verify' }, [
            el('span', { class: 'chk__vLabel', text: '生日' }),
            el('span', { class: 'chk__vValue num', text: m.birthRoc || '—' }),
            el('span', { class: 'chk__vLabel', text: '末四碼' }),
            el('span', { class: 'chk__vValue num', text: m.idLast4 || '—' })
          ])
        ])
      ]),
      el('button', {
        class: `btn btn--sm${failed ? ' btn--danger' : ''}`, type: 'button', disabled: state.busy,
        onClick: () => mark(m, failed ? null : 'fail')
      }, failed ? '取消註記' : '有問題')
    ]);
  }

  function footer(sum) {
    const min = state.match?.checkin?.requiredMin ?? null;
    const short = min != null && sum.present < min;
    return el('div', { class: 'chk__footer' }, [
      el('div', { class: 'chk__tally' }, [
        el('strong', { class: 'num', text: `${sum.present}` }),
        el('span', { text: ` / ${sum.total} 人已確認出賽` }),
        sum.failed ? el('span', { class: 'chk__warn', text: `　·　${sum.failed} 筆有問題` }) : null
      ].filter(Boolean)),
      short
        ? el('p', { class: 'chk__warn', text: `不足開賽人數（至少 ${min} 人）。人數不足請找主辦，不要自行放行。` })
        : null,
      el('button', {
        class: 'btn btn--lg btn--primary', type: 'button', disabled: state.busy,
        onClick: () => finish(sum)
      }, iconText('check', '完成這一隊的檢錄'))
    ].filter(Boolean));
  }

  // ── 動作 ────────────────────────────────────────────────

  /**
   * 勾選／取消。
   * **不 await**：離線時 Firestore 的 Promise 永遠 pending，await 會讓
   * 整個畫面卡住（R-UI-002）。狀態由 sync.js 追蹤並反映在右上角燈號。
   */
  function mark(m, result) {
    const doc = buildCheckin({
      matchId, teamId: state.match[`${state.side}TeamId`],
      member: m, result, uid: user()?.uid ?? null
    });
    // 先更新本機狀態，畫面立刻有反應——現場一筆一筆勾，不能等網路
    state.checkins = result == null
      ? Object.fromEntries(Object.entries(state.checkins).filter(([k]) => k !== m.memberId))
      : { ...state.checkins, [m.memberId]: { ...doc, memberId: m.memberId } };
    render();
    saveCheckin(matchId, m.memberId, doc, result == null);
  }

  async function finish(sum) {
    const ok = await confirmDialog({
      title: `完成 ${teamName(state.side)} 的檢錄？`,
      body: `已確認出賽 ${sum.present} / ${sum.total} 人${sum.failed ? `，${sum.failed} 筆標記有問題` : ''}。送出後仍可修改。`,
      confirmText: '完成檢錄'
    });
    if (!ok) return;
    toast(`${teamName(state.side)} 檢錄完成`, 'success');
    // 兩隊都檢完就回賽務首頁；否則切到另一隊繼續
    const other = state.side === 'home' ? 'away' : 'home';
    const otherSum = checkinSummary(state.rosters[other] || [], state.checkins);
    if (otherSum.present === 0 && otherSum.total > 0) { state.side = other; render(); }
    else navigate('/staff');
  }

  function denied() {
    return el('div', { class: 'chk__deny' }, [
      el('strong', { text: '你沒有檢錄權限' }),
      el('p', { text: '這一頁需要「檢錄員」以上的身分。請聯絡主辦指派。' }),
      el('button', { class: 'btn btn--lg', type: 'button', onClick: () => navigate('/staff') }, '回賽務首頁')
    ]);
  }

  function errorBox(title, err) {
    return el('div', { class: 'chk__deny' }, [
      el('strong', { text: title }),
      err ? el('p', { text: String(err?.message ?? err) }) : null,
      el('button', { class: 'btn btn--lg', type: 'button', onClick: () => navigate('/staff') }, '回賽務首頁')
    ].filter(Boolean));
  }
}

