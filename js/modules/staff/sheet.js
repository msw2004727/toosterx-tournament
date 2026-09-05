/**
 * 出場名單
 * ------------------------------------------------------------------
 * 路由：#/staff/sheet/:matchId
 * 規格：docs/04-功能規格-賽務裁判端.md §7
 *
 * M3 先做「勾選先發／替補 → 確認」。拖曳排序與 QR 檢錄狀態在 M5 接上，
 * 現在未檢錄的球員一律視為可排入（否則沒有檢錄資料時整頁不能用）。
 */

import { el, toast, confirmDialog, emptyState, mount } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { navigate } from '../../core/router.js';
import { can, assignedToVenue } from '../../core/firebase.js';
import { watchMatch, getTeamRoster, getMatchSheet, saveMatchSheet, patchMatch } from './data.js';
import { getDivision } from './data.js';
import { syncIndicator } from './sync-indicator.js';
import { isPlayerRow, ROSTER_ROLE_TEXT } from './live-actions.js';

export async function matchSheetPage({ params, scope, view }) {
  const { matchId } = params;
  const indicator = syncIndicator();
  const root = el('div', { class: 'sheetpage' });
  view.replaceChildren(root);

  const state = {
    match: null, division: null, active: 'home',
    rosters: { home: [], away: [] },
    picked: { home: new Map(), away: new Map() },   // memberId → 'start'|'bench'
    loaded: false
  };

  watchMatch(scope, matchId, async m => {
    const first = !state.match;
    state.match = m;
    if (m && first) {
      state.division = await getDivision(m.divisionId).catch(() => null);
      await load();
      state.loaded = true;
    }
    render();
  });

  async function load() {
    for (const side of ['home', 'away']) {
      const teamId = state.match[side]?.teamId;
      if (!teamId) continue;
      state.rosters[side] = await getTeamRoster(teamId).catch(() => []);
      const saved = await getMatchSheet(matchId, teamId).catch(() => null);
      const map = new Map();
      for (const p of saved?.players || []) map.set(p.memberId, p.role === 'start' ? 'start' : 'bench');
      state.picked[side] = map;
    }
  }

  function render() {
    const m = state.match;
    if (!m) {
      mount(root, state.loaded
        ? emptyState({ title: '找不到這個場次', actionLabel: '回賽務首頁', onAction: () => navigate('/staff') })
        : el('p', { text: '載入中…' }));
      return;
    }
    // ⚠️ 這裡的權限碼是 `matchsheet.write`（裁判），**不是** `match.score.write`
    //    （記錄員）。用後者的話裁判會看得到名單卻一個人都勾不了——
    //    而「名單與檢錄」正是裁判在這個系統裡唯一的職能（見 CLAUDE.md 的角色矩陣）。
    //    2026-09-04 在真站上實測到：裁判的名單頁只有 4 顆按鈕，記錄員有 25 顆。
    const mayEdit = can('matchsheet.write');
    const readOnly = !mayEdit || !assignedToVenue(m.venueId);
    const side = state.active;
    const needStart = state.division?.playersOnField ?? 9;
    const picked = state.picked[side];
    const starters = [...picked.values()].filter(v => v === 'start').length;

    mount(root,
      el('div', { class: 'staff__head' }, [
        el('button', { class: 'live__back', type: 'button', 'aria-label': '返回', onClick: () => navigate('/staff') }, icon('back')),
        el('div', { class: 'staff__who' }, [
          el('strong', { text: `${m.label || m.matchId} 出場名單` }),
          el('span', { class: 'staff__date', text: `先發 ${starters} / ${needStart}` })
        ]),
        indicator.node
      ]),
      el('div', { class: 'tabs' }, ['home', 'away'].map(s => el('button', {
        class: `tabs__btn ${s === side ? 'is-active' : ''}`, type: 'button',
        onClick: () => { state.active = s; render(); }
      }, m[s]?.name || (s === 'home' ? '主隊' : '客隊')))),
      rosterList(side, readOnly),
      readOnly ? null : el('div', { class: 'finishbar' }, [
        el('button', {
          class: 'btn btn--xl btn--primary', type: 'button', onClick: () => confirmSheet(side, needStart)
        }, '確認出場名單')
      ])
    );
  }

  function rosterList(side, readOnly) {
    const list = state.rosters[side];
    if (!list.length) {
      return el('div', { class: 'card' }, [
        el('p', { class: 'muted', text: '這一隊還沒有球員名單。請先由管理員匯入球隊名冊。' })
      ]);
    }
    const picked = state.picked[side];
    return el('ul', { class: 'roster' }, list.map(p => {
      const role = picked.get(p.memberId) || null;
      // 隊職員（教練／領隊）不上場：不畫先發／替補鈕，只標身分（驗收 D-08）
      if (!isPlayerRow(p)) {
        return el('li', { class: 'roster__row is-staff' }, [
          el('span', { class: 'roster__no num', text: '—' }),
          el('span', { class: 'roster__name', text: p.displayName || p.name || '（未命名）' }),
          el('span', { class: 'roster__pos', text: '' }),
          el('span', { class: 'roster__role', text: ROSTER_ROLE_TEXT[p.role ?? p.kind] || '隊職員' })
        ]);
      }
      return el('li', { class: `roster__row ${role ? 'is-' + role : ''}` }, [
        el('span', { class: 'roster__no num', text: p.jerseyNo != null ? `#${p.jerseyNo}` : '—' }),
        el('span', { class: 'roster__name', text: p.displayName || p.name || '（未命名）' }),
        el('span', { class: 'roster__pos', text: p.position || '' }),
        readOnly ? el('span', { class: 'roster__role', text: role === 'start' ? '先發' : role === 'bench' ? '替補' : '未列入' })
          : el('div', { class: 'roster__btns' }, [
              toggleBtn(side, p, 'start', '先發', role),
              toggleBtn(side, p, 'bench', '替補', role)
            ])
      ]);
    }));
  }

  function toggleBtn(side, p, value, label, role) {
    return el('button', {
      class: `chip ${role === value ? 'is-on' : ''}`, type: 'button',
      'aria-pressed': role === value ? 'true' : 'false',
      onClick: () => {
        const map = state.picked[side];
        if (map.get(p.memberId) === value) map.delete(p.memberId);
        else map.set(p.memberId, value);
        render();
      }
    }, label);
  }

  async function confirmSheet(side, needStart) {
    const m = state.match;
    const teamId = m[side]?.teamId;
    if (!teamId) return toast('這一隊還沒確定（待晉級），無法確認名單。', 'warn');

    const map = state.picked[side];
    const players = state.rosters[side]
      .filter(p => map.has(p.memberId))
      .map(p => ({
        memberId: p.memberId, displayName: p.displayName ?? p.name ?? null,
        jerseyNo: p.jerseyNo ?? null, position: p.position ?? null,
        role: map.get(p.memberId)
      }));
    const starters = players.filter(p => p.role === 'start').length;

    if (starters !== needStart) {
      // 警示但不阻擋：現場可能因傷缺人，系統不該比裁判更有主見
      const go = await confirmDialog({
        title: '先發人數不符',
        body: `目前先發 ${starters} 人，這個組別是 ${needStart} 人制。仍要確認嗎？`,
        confirmText: '仍要確認'
      });
      if (!go) return;
    }

    saveMatchSheet(matchId, teamId, {
      players, startingCount: starters, confirmed: true
    }, `確認出場名單　${m[side]?.name ?? side}`);

    // 名單確認後把場次推進到 checkin／ready，賽務首頁才看得出進度
    if (m.status === 'scheduled') {
      patchMatch(matchId, { status: 'checkin' }, '進入檢錄', { kind: 'status' });
    }
    toast('已確認出場名單。狀態請看右上角。', 'success');
  }

  return () => indicator.destroy();
}
