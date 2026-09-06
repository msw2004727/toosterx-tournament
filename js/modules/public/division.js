/**
 * 組別頁 `#/division/:divisionId`
 * ------------------------------------------------------------------
 * 規格：docs/03-功能規格-公開端.md §6
 *
 * ⚠️ **積分榜一個數字都不重算**（R-ENG-001）。
 *    這一頁讀 standings/{divisionId}__{stageId}__{groupId} 的 rows 直接畫。
 *    排名邏輯只有一份實作，在 js/engine/standing.js，由 Function 執行。
 *
 * 三種必須畫得出來的狀態：
 *   1. rows 是空的        → Function 還沒重算完，畫「積分榜整理中」而不是崩掉
 *   2. hasUnresolvedTie   → 「名次待主辦裁定」，**絕不自己挑一個名次填進去**
 *   3. 某一列 rank 為 null → 那一列標「待裁定」，其餘照常顯示
 */

import { el, mount, skeleton } from '../../core/ui.js';
import { navigate } from '../../core/router.js';
import { icon, iconText } from '../../core/icons.js';
import { hhmm } from '../../lib/format.js';
import * as data from './data.js';
import { viewStanding, sortStandings, sortByKickoff, stageLabel } from './selectors.js';
import { pageHead, empty, matchRow, sectionCard } from './bits.js';

const TABS = [
  { key: 'table', label: '積分榜', icon: 'table' },
  { key: 'schedule', label: '賽程', icon: 'list' },
  { key: 'teams', label: '球隊', icon: 'team' }
];

export async function publicDivision({ params, scope, view, query }) {
  const { divisionId } = params;
  const root = el('div', { class: 'pub' });
  mount(view, root);
  mount(root, skeleton(4));

  const state = {
    division: null, standings: [], matches: [],
    tab: TABS.some(t => t.key === query?.get('tab')) ? query.get('tab') : 'table',
    loaded: false, error: null
  };

  data.getDivision(divisionId)
    .then(d => { state.division = d; render(); })
    .catch(() => {});

  data.watchStandings(scope, divisionId, docs => {
    state.standings = sortStandings(docs);
    state.loaded = true;
    render();
  }, err => { state.error = err; state.loaded = true; render(); });

  // 賽程分頁是次要資訊，用一次性讀取，不佔監聽預算
  data.getDivisionMatches(divisionId)
    .then(rows => { state.matches = rows; render(); })
    .catch(() => { /* 賽程讀不到就少一個分頁，積分榜仍然可看 */ });

  render();

  function render() {
    if (!state.loaded) { mount(root, skeleton(4)); return; }
    mount(root,
      pageHead(state.division?.name || divisionId, {
        sub: state.division ? `${state.division.playersOnField ?? ''}人制　·　每場 ${state.division.matchDurationMin ?? ''} 分鐘`.trim() : '',
        onBack: () => navigate('/')
      }),
      tabBar(),
      state.error
        ? empty('讀不到積分榜', state.error.message || '請稍後再試。',
            { label: '重新載入', onClick: () => location.reload() })
        : body()
    );
  }

  function tabBar() {
    return el('div', { class: 'ptabs ptabs--sub', role: 'tablist', 'aria-label': '組別資訊' },
      TABS.map(t => el('button', {
        class: `ptabs__btn ${state.tab === t.key ? 'is-active' : ''}`,
        type: 'button', role: 'tab', 'aria-selected': state.tab === t.key ? 'true' : 'false',
        onClick: () => {
          state.tab = t.key;
          location.replace(`#/division/${encodeURIComponent(divisionId)}?tab=${t.key}`);
          render();
        }
      }, iconText(t.icon, t.label))));
  }

  function body() {
    if (state.tab === 'schedule') return scheduleTab();
    if (state.tab === 'teams') return teamsTab();
    return tableTab();
  }

  function tableTab() {
    if (!state.standings.length) {
      return empty('積分榜整理中', '每一場完賽送出後會自動更新，通常在幾秒內。');
    }
    return el('div', { class: 'pstand' },
      state.standings.map(doc => standingBlock(viewStanding(doc, { qualifyCount: qualifyCount() }))));
  }

  /** 前幾名晉級。standingBlock 也要用，所以拉成函式而不是 tableTab 的區域變數。 */
  // 晉級區反白。規格沒有定義這個欄位，本屆的 division 文件也沒有設，
  // 所以預設 0＝不反白（不顯示總比顯示錯的好）。日後主辦要用，
  // 在 divisions/{id}.display.qualifyCount 填一個數字就會生效。
  function qualifyCount() { return state.division?.display?.qualifyCount ?? 0; }

  // 具名函式（會被提升）：第一筆快照可能同步送達，那時 const 還在 TDZ
  function th(label, align) {
    return el('th', { class: align === 'left' ? 'is-left' : '', scope: 'col', text: label });
  }

  function standingBlock(v) {
    const title = [stageLabel(v.stageId), v.groupId ? `${v.groupId} 組` : null].filter(Boolean).join('　');
    return sectionCard(title || '積分榜', 'table', [
      // 整份待裁定：講清楚原因，不要讓家長以為是網站壞了
      v.hasUnresolvedTie
        ? el('div', { class: 'notice notice--warn' }, [
            icon('warn'),
            el('span', { text: '名次待主辦裁定：同分條件已用盡，最終名次由主辦決定後公布。' })
          ])
        : null,
      v.isEmpty
        ? empty('這一組還沒有成績', '第一場完賽後就會出現。')
        : el('div', { class: 'ptable-wrap' }, el('table', { class: 'ptable' }, [
            el('thead', {}, el('tr', {}, [
              th('名'), th('球隊', 'left'), th('賽'), th('勝'), th('和'), th('負'),
              th('進'), th('失'), th('差'), th('積分')
            ])),
            el('tbody', {}, v.rows.map(r => el('tr', {
              class: `${r.qualified ? 'is-qualified' : ''} ${r.unresolved ? 'is-unresolved' : ''}`
            }, [
              el('td', { class: 'num', text: r.unresolved ? '—' : String(r.rank ?? '') }),
              el('td', { class: 'is-left' }, el('button', {
                class: 'ptable__team', type: 'button',
                onClick: () => r.teamId && navigate(`/team/${encodeURIComponent(r.teamId)}`)
              }, r.name || r.teamId || '')),
              el('td', { class: 'num', text: String(r.played) }),
              el('td', { class: 'num', text: String(r.win) }),
              el('td', { class: 'num', text: String(r.draw) }),
              el('td', { class: 'num', text: String(r.loss) }),
              el('td', { class: 'num', text: String(r.goalsFor) }),
              el('td', { class: 'num', text: String(r.goalsAgainst) }),
              el('td', { class: 'num', text: r.goalDiff > 0 ? `+${r.goalDiff}` : String(r.goalDiff) }),
              el('td', { class: 'num ptable__pts', text: String(r.points) })
            ])))
          ])),
      // 窄機上表格會橫向捲動，但沒有任何視覺線索——不講的話大家以為只有三欄
      !v.isEmpty
        ? el('p', { class: 'pstand__legend' }, [
            // ⚠️ iconText() 回傳的是**陣列**，一定要展開。
            //    直接塞進去 el() 會把整個陣列 String() 成 "[object SVGSVGElement],…"
            //    印在畫面上——跟 R-UI-001 的 "null" 是同一類問題，
            //    而且測試看不到，是看截圖才發現的。
            ...iconText('forward', '左右滑動可看進球、失球、淨勝球與積分'),
            qualifyCount() > 0
              ? el('span', { class: 'pstand__legend-q', text: `　淡綠底為前 ${qualifyCount()} 名（晉級區）` })
              : null
          ].filter(Boolean))
        : null
    ].filter(Boolean));
  }


  function scheduleTab() {
    // 還沒發布就當成「準備中」——主辦排到一半的賽程給家長看，比什麼都不給更糟
    const rows = state.division?.schedulePublished === false
      ? [] : sortByKickoff(state.matches);
    if (!rows.length) return empty('賽程準備中', '敬請期待。');
    return el('ul', { class: 'plist' }, rows.map(m => matchRow({
      match: m, division: state.division,
      onOpen: x => navigate(`/match/${encodeURIComponent(x.matchId)}`)
    })));
  }

  function teamsTab() {
    // 從積分榜的 rows 取隊伍；沒有積分榜時退回從場次抓
    const fromStandings = state.standings.flatMap(d => (d.rows || [])
      .map(r => ({ teamId: r.teamId, name: r.name })));
    const fromMatches = state.matches.flatMap(m => [m.home, m.away])
      .filter(t => t?.teamId).map(t => ({ teamId: t.teamId, name: t.name }));
    const seen = new Map();
    for (const t of [...fromStandings, ...fromMatches]) {
      if (t.teamId && !seen.has(t.teamId)) seen.set(t.teamId, t);
    }
    const teams = [...seen.values()];
    if (!teams.length) return empty('球隊名單準備中', '報名截止後公布。');
    return el('ul', { class: 'pteams' }, teams.map(t => el('li', {}, el('button', {
      class: 'pteams__btn', type: 'button',
      onClick: () => navigate(`/team/${encodeURIComponent(t.teamId)}`)
    }, [
      el('span', { class: 'pteams__name', text: t.name || t.teamId }),
      icon('forward')
    ]))));
  }
}

export { hhmm };
