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
import { user, can, canCheckin } from '../../core/firebase.js';
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
    match: null, rosters: {}, rosterError: {}, checkins: {},
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
    // ⚠️ 場次文件的隊伍是巢狀的 `home.teamId` / `away.teamId`（seed 與賽程引擎都這樣寫）。
    //    第一版讀頂層的 homeTeamId——那個欄位不存在，整段名單載入從來沒有執行過，
    //    而 E2E 的替身種子照著錯的 schema 寫所以一直是綠的（驗收 D-01，第五次同類事故）。
    const key = `${state.match?.home?.teamId}|${state.match?.away?.teamId}`;
    if (!state.match?.home?.teamId || state.rosterKey === key) return;
    state.rosterKey = key;
    for (const side of ['home', 'away']) {
      const teamId = state.match?.[side]?.teamId;
      if (!teamId) continue;
      try {
        state.rosters[side] = await getCheckinRoster(teamId);
        state.rosterError[side] = null;
      } catch (err) {
        // ⚠️ 讀不到跟「沒有名單」是兩件事。這個查詢要複合索引（members: status + jerseyNo），
        //    正式站沒部署索引會回 failed-precondition，而模擬器與替身不查索引——
        //    2026-09-06 在 demo 實地驗證才發現（D-01 修好之後才走得到這一行）。
        console.warn('[checkin] roster', teamId, err);
        state.rosters[side] = [];
        state.rosterError[side] = rosterErrorText(err);
      }
      render();
    }
  }

  /** 錯誤翻成人話（檢錄員看不懂 failed-precondition） */
  function rosterErrorText(err) {
    const code = err?.code || '';
    if (code.includes('failed-precondition')) return '資料庫缺少這個查詢需要的索引（主辦要部署 firestore 索引）。';
    if (code.includes('permission-denied')) return '你的身分沒有讀取名單的權限。';
    if (code.includes('unavailable')) return '目前連不上伺服器，而且本機沒有這份名單的快取。';
    return err?.message ? `錯誤：${err.message}` : '原因不明。';
  }

  function teamName(side) {
    const t = state.match?.[side];
    return t?.displayName || t?.name || t?.teamId || (side === 'home' ? '主隊' : '客隊');
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
      state.rosterError[state.side]
        ? el('div', { class: 'chk__empty chk__error', role: 'alert', id: 'chk-roster-error' }, [
            el('strong', { text: '讀不到這一隊的名單' }),
            el('p', { text: `${state.rosterError[state.side]} 這不代表球隊沒有名單，請先不要完成檢錄，聯絡主辦。` })
          ])
        : !list.length
          ? el('p', { class: 'chk__empty', text: '這一隊還沒有名單。請確認球隊已完成報名並通過審核。' })
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
          // 配戴眼鏡上場（規章附件二）：切結書沒收到的要提醒裁判賽前檢查裝備
          m.glasses
            ? el('span', {
                class: `chk__tag${m.glassesWaiver ? ' chk__tag--ok' : ''}`,
                text: m.glassesWaiver ? '眼鏡・切結書已收' : '眼鏡・切結書未收'
              })
            : null,
          // 檢錄員拿證件對的就是這兩格，所以字要夠大、位置要固定。
          //
          // ⚠️ 「看球員個資」是獨立的一條權限（`member.read`）。主辦關掉之後
          //    這兩格要收起來，但**頁面仍然可用**（照名字核對），並且說明
          //    為什麼看不到——直接顯示空白會被當成資料沒填。
          can('member.read')
            ? el('span', { class: 'chk__verify' }, [
                el('span', { class: 'chk__vLabel', text: '生日' }),
                el('span', { class: 'chk__vValue num', text: m.birthRoc || '—' }),
                el('span', { class: 'chk__vLabel', text: '末四碼' }),
                el('span', { class: 'chk__vValue num', text: m.idLast4 || '—' })
              ])
            : el('span', { class: 'chk__verify chk__verify--hidden', text: '主辦已關閉個資顯示' })
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
      matchId, teamId: state.match?.[state.side]?.teamId ?? null,
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

