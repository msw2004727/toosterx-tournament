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

import { setDivisionTheme } from '../../core/division-theme.js';
import { groupNameOf } from '../../engine/group-name.js';
import { el, mount, skeleton } from '../../core/ui.js';
import { hold } from '../../core/store.js';
import { navigate } from '../../core/router.js';
import { icon, iconText } from '../../core/icons.js';
import { hhmm } from '../../lib/format.js';
import * as data from './data.js';
import { viewStanding, sortStandings, sortByKickoff, stageLabel } from './selectors.js';
import { pageHead, empty, matchRow, sectionCard } from './bits.js';
import { DIVISION_TABS, divisionTabs } from './division-tabs.js';
import { publicBracket } from './bracket.js';
import { advancementLabels, publishedFinalRanking, finalRankLabel } from './division-progress.js';

const TABS = DIVISION_TABS;

export async function publicDivision({ params, scope, view, query }) {
  if (query?.get('tab') === 'bracket') return publicBracket({ params, scope, view });
  const { divisionId } = params;
  const root = el('div', { class: 'pub' });
  mount(view, root);
  mount(root, skeleton(4));
  const updateNameFade = node => {
    const overflow = node.scrollWidth > node.clientWidth + 1;
    node.toggleAttribute('data-overflow', overflow);
    node.tabIndex = overflow ? 0 : -1;
    node.toggleAttribute('data-at-end', node.scrollLeft + node.clientWidth >= node.scrollWidth - 1);
  };
  const nameObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(entries => entries.forEach(entry => updateNameFade(entry.target))) : null;
  let disposed = false;
  hold(scope, () => { disposed = true; nameObserver?.disconnect(); });

  const state = {
    division: null, formats: {}, standings: [], matches: [], teams: [], teamsLoaded: false, teamsError: null,
    tab: TABS.some(t => t.key === query?.get('tab')) ? query.get('tab') : 'table',
    loaded: false, error: null
  };

  // 與積分榜／球隊合計三個監聽；發布或撤回名次時即時更新，離頁由 scope 回收。
  data.watchBracketDivision(scope, divisionId, d => { state.division = d; render(); },
    () => { state.division = null; render(); });
  data.getBracketFormats().then(formats => { state.formats = formats; render(); }).catch(() => {});

  data.watchStandings(scope, divisionId, docs => {
    state.standings = sortStandings(docs);
    state.loaded = true;
    render();
  }, err => { state.error = err; state.loaded = true; render(); });

  data.watchDivisionTeams(scope, divisionId, teams => {
    state.teams = teams; state.teamsLoaded = true; state.teamsError = null; render();
  }, err => { state.teamsError = err; state.teamsLoaded = true; render(); });

  // 賽程分頁是次要資訊，用一次性讀取，不佔監聽預算
  data.getDivisionMatches(divisionId)
    .then(rows => { state.matches = rows; render(); })
    .catch(() => { /* 賽程讀不到就少一個分頁，積分榜仍然可看 */ });

  render();

  function render() {
    if (disposed) return;
    nameObserver?.disconnect();
    setDivisionTheme(root, state.division || divisionId);
    if (state.tab === 'table' && !state.loaded) { mount(root, skeleton(4)); return; }
    mount(root,
      pageHead(state.division?.name || divisionId, {
        sub: state.division ? `${state.division.playersOnField ?? ''}人制　·　每場 ${state.division.matchDurationMin ?? ''} 分鐘`.trim() : '',
        onBack: () => navigate('/')
      }),
      tabBar(),
      state.tab === 'table' && state.error
        ? empty('讀不到積分榜', state.error.message || '請稍後再試。',
            { label: '重新載入', onClick: () => location.reload() })
        : body()
    );
    for (const name of root.querySelectorAll('.ptable__nameScroll')) {
      updateNameFade(name);
      nameObserver?.observe(name);
    }
  }

  function tabBar() {
    return divisionTabs(divisionId, state.tab);
  }

  function body() {
    if (state.tab === 'schedule') return scheduleTab();
    if (state.tab === 'teams') return teamsTab();
    return tableTab();
  }

  function tableTab() {
    const progress = advancementLabels(state.formats[state.division?.formatId], state.division, state.standings);
    const standings = state.standings.length
      ? state.standings.map(doc => standingBlock(viewStanding(doc, { qualifyCount: qualifyCount() }), progress))
      : [empty('積分榜整理中', '每一場完賽送出後會自動更新，通常在幾秒內。')];
    const final = finalRankingBlock();
    const hasChampion = publishedFinalRanking(state.division).some(row => row.rank === 1);
    return el('div', { class: 'pstand' }, hasChampion ? [final, ...standings] : [...standings, final]);
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

  function standingBlock(v, progress) {
    const title = [stageLabel(v.stageId), v.groupId ? groupNameOf(v.groupId, state.division, ' ') : null].filter(Boolean).join('　');
    return sectionCard(title || '積分榜', 'table', [
      // 進度說明：一場都沒打就寫「尚未開賽」、打到一半寫「暫時排名」，
      // 只有分組賽打完仍同分才是「待主辦裁定」（驗收反饋 A-5：開賽前就看到「待裁定」會以為壞了）
      v.phase === 'notStarted' && !v.isEmpty
        ? el('div', { class: 'notice notice--info pstand__phase' }, [
            icon('info'),
            el('span', { text: '尚未開賽：第一場完賽後名次就會開始計算。' })
          ])
        : v.phase === 'inProgress'
          ? el('div', { class: 'notice notice--info pstand__phase' }, [
              icon('info'),
              el('span', { text: '分組賽進行中：這是暫時排名，同分的隊伍在全部打完後才依規章第十九條排序。' })
            ])
          : v.hasUnresolvedTie
            ? el('div', { class: 'notice notice--warn' }, [
                icon('warn'),
                el('span', { text: '名次待主辦裁定：同分條件已用盡，最終名次由主辦決定後公布。' })
              ])
            : null,
      v.isEmpty
        ? empty('這一組還沒有成績', '第一場完賽後就會出現。')
        : el('div', { class: 'ptable-wrap' }, el('table', { class: 'ptable' }, [
            el('thead', {}, el('tr', {}, [
              th('名次'), th('球隊', 'left'), th('賽'), th('勝'), th('和'), th('負'),
              th('進'), th('失'), th('差'), th('積分')
            ])),
            el('tbody', {}, v.rows.map(r => { const advancement = progress.get(`${v.stageId}:${v.groupId}:${r.teamId}`); return el('tr', {
              class: `${r.qualified ? 'is-qualified' : ''} ${r.unresolved ? 'is-unresolved' : ''} ${advancement ? advancement.bye ? 'pstand__row--bye' : 'pstand__row--advance' : ''}`
            }, [
              el('td', { class: 'num', text: r.unresolved ? '—' : String(r.rank ?? '') }),
              el('td', { class: 'is-left' }, [el('div', {
                class: 'ptable__nameScroll', role: 'region',
                'aria-label': `球隊名稱：${r.name || r.teamId || ''}，可左右滑動`,
                onScroll: e => updateNameFade(e.currentTarget)
              }, el('button', {
                class: 'ptable__team', type: 'button', title: r.name || r.teamId || '',
                onClick: () => r.teamId && navigate(`/team/${encodeURIComponent(r.teamId)}`)
              }, el('span', { class: 'ptable__teamName', text: r.name || r.teamId || '' }))),
              advancement ? el('button', {
                class: `pstand__advance${advancement.bye ? ' pstand__advance--bye' : ''}`, type: 'button',
                'aria-label': `${r.name || r.teamId}，${advancement.label}，查看晉級／名次圖`,
                onClick: () => navigate(`/division/${encodeURIComponent(divisionId)}?tab=bracket`)
              }, el('span', { class: 'pstand__advance-pill' }, [icon(advancement.bye ? 'up' : 'check'), el('span', { text: advancement.label })])) : null]),
              el('td', { class: 'num', text: String(r.played) }),
              el('td', { class: 'num', text: String(r.win) }),
              el('td', { class: 'num', text: String(r.draw) }),
              el('td', { class: 'num', text: String(r.loss) }),
              el('td', { class: 'num', text: String(r.goalsFor) }),
              el('td', { class: 'num', text: String(r.goalsAgainst) }),
              el('td', { class: 'num', text: r.goalDiff > 0 ? `+${r.goalDiff}` : String(r.goalDiff) }),
              el('td', { class: 'num ptable__pts', text: String(r.points) })
            ]); }))
          ])),
      // 只有隊名欄捲動；所有成績欄始終留在畫面內。
      !v.isEmpty
        ? el('p', { class: 'pstand__legend' }, [
            // ⚠️ iconText() 回傳的是**陣列**，一定要展開。
            //    直接塞進去 el() 會把整個陣列 String() 成 "[object SVGSVGElement],…"
            //    印在畫面上——跟 R-UI-001 的 "null" 是同一類問題，
            //    而且測試看不到，是看截圖才發現的。
            ...iconText('forward', '隊名可左右滑動，成績固定顯示'),
            qualifyCount() > 0
              ? el('span', { class: 'pstand__legend-q', text: `　淡綠底為前 ${qualifyCount()} 名（晉級區）` })
              : null
          ].filter(Boolean))
        : null
    ].filter(Boolean));
  }

  function finalRankingBlock() {
    const ranking = publishedFinalRanking(state.division);
    const nameOf = row => {
      const team = state.teams.find(t => t.teamId === row.teamId);
      return team?.shortName || team?.name || row.name || row.teamId;
    };
    const teamButton = row => el('button', {
      class: 'pstand-final__team', type: 'button', text: nameOf(row),
      onClick: () => navigate(`/team/${encodeURIComponent(row.teamId)}`)
    });
    return sectionCard('最終名次', 'trophy', ranking.length ? [
      el('div', { class: 'pstand-final__podium', 'aria-label': '前三名' }, [2, 1, 3].map(rank => {
        const row = ranking.find(r => r.rank === rank);
        if (!row) return null;
        return el('div', { class: `pstand-final__place pstand-final__place--${rank}` }, [
          teamButton(row),
          el('div', { class: 'pstand-final__base' }, [icon(rank === 1 ? 'trophy' : 'medal'),
            el('span', { text: finalRankLabel(rank) })])
        ]);
      })),
      ranking.some(r => r.rank > 3) ? el('ol', { class: 'pstand-final__list', start: 4 }, ranking.filter(r => r.rank > 3).map(row =>
        el('li', { class: 'pstand-final__row' }, [el('span', { class: 'pstand-final__rank', text: finalRankLabel(row.rank) }), teamButton(row)]))) : null,
      el('p', { class: 'pstand__legend', text: '主辦已發布正式最終名次' })
    ] : el('p', { class: 'pstand-final__pending', text: '最終名次尚未公布，主辦發布後會顯示於此。' }));
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
    if (!state.teamsLoaded) return skeleton(3);
    if (state.teamsError) return empty('讀不到球隊名單', '請重新載入，或稍後再試。', { label: '重新載入', onClick: () => location.reload() });
    const teams = state.teams;
    if (!teams.length) return empty('球隊名單準備中', '此組別尚無已核准球隊，主辦匯入或核准後會顯示於此。');
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
