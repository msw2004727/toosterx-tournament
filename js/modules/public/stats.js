/**
 * 統計頁 `#/stats` 與直播牆 `#/live`
 * ------------------------------------------------------------------
 * 規格：docs/03-功能規格-公開端.md §9、§5.3
 */

import { el, mount, skeleton } from '../../core/ui.js';
import { navigate } from '../../core/router.js';
import { iconText } from '../../core/icons.js';
import { startTicker } from '../../core/clock.js';
import * as data from './data.js';
import { embedUrl, isLiveMatch, hiddenScorerDivisions } from './selectors.js';
import { pageHead, empty, videoFacade, stopAllVideos, sectionCard, statusBadge } from './bits.js';
import { EVENT } from '../../config.js';

/* ── 統計頁 ─────────────────────────────────────────────── */

/**
 * 兩張榜，兩份文件（docs/01b §1.13）。rows 的形狀不同，所以各自有 renderer——
 * 射手榜的一列是**球員**，行為分的一列是**球隊**。
 *
 * docs/03 §9.1 還列了「助攻榜」，這裡沒有：賽務端目前根本不記錄助攻
 * （`buildGoalEvent` 有 assistPlayerId 欄位，但沒有任何介面會填它），
 * 引擎也沒有這張榜。掛一個永遠「整理中」的分頁只會讓人以為網站壞了，
 * 等 M6 賽務端補上記錄之後再開。球隊進攻／防守同理，資料在積分榜上。
 */
const BOARDS = [
  { key: 'scorers',  source: 'scorers',  label: '射手榜', icon: 'goal', valueKey: 'goals',          unit: '球', kind: 'player' },
  { key: 'fairplay', source: 'fairplay', label: '行為分', icon: 'card', valueKey: 'fairPlayPoints', unit: '分', kind: 'team' }
];

export async function publicStats({ view, query }) {
  const root = el('div', { class: 'pub' });
  mount(view, root);
  mount(root, skeleton(4));

  const state = {
    boards: { scorers: null, fairplay: null }, featureFlags: {}, divisions: [], loaded: false,
    tab: BOARDS.some(b => b.key === query?.get('tab')) ? query.get('tab') : 'scorers',
    divisionId: query?.get('division') || null
  };

  const [boards, divisions, flags] = await Promise.all([
    data.getBoards().catch(() => ({ scorers: null, fairplay: null })),
    data.getDivisions().catch(() => []),
    data.getFeatureFlags().catch(() => ({}))
  ]);
  state.boards = boards;
  state.divisions = divisions;
  state.featureFlags = flags;
  state.loaded = true;
  render();

  function render() {
    mount(root,
      pageHead('統計', { sub: EVENT.name, onBack: () => navigate('/') }),
      tabBar(),
      divisionFilter(),
      body()
    );
  }

  function tabBar() {
    return el('div', { class: 'ptabs ptabs--sub', role: 'tablist', 'aria-label': '榜單' },
      BOARDS.map(b => el('button', {
        class: `ptabs__btn ${state.tab === b.key ? 'is-active' : ''}`,
        type: 'button', role: 'tab', 'aria-selected': state.tab === b.key ? 'true' : 'false',
        onClick: () => { state.tab = b.key; syncUrl(); render(); }
      }, iconText(b.icon, b.label))));
  }

  function divisionFilter() {
    if (!state.divisions.length) return null;
    return el('div', { class: 'pfilter' }, [
      el('select', {
        class: 'pfilter__sel', 'aria-label': '組別',
        onChange: e => { state.divisionId = e.target.value || null; syncUrl(); render(); }
      }, [
        el('option', { value: '', selected: !state.divisionId }, '全部組別'),
        ...state.divisions.map(d => el('option', {
          value: d.divisionId, selected: state.divisionId === d.divisionId
        }, d.name || d.divisionId))
      ])
    ]);
  }

  function syncUrl() {
    const p = new URLSearchParams();
    p.set('tab', state.tab);
    if (state.divisionId) p.set('division', state.divisionId);
    location.replace(`#/stats?${p.toString()}`);
  }

  function body() {
    const conf = BOARDS.find(b => b.key === state.tab);
    const board = state.boards[conf.source];

    // ⚠️ 榜單由 Function 算好寫進 boards/*，前端**不自己從 timeline 重算**（R-ENG-001）。
    //    拿不到就誠實說「整理中」，不要生一份可能跟官方榜不一致的數字出來。
    //    每張榜看自己那一份文件，**不可以退回另一張榜的 rows** 當備援——
    //    射手榜的列是球員、行為分的列是球隊，混用會畫出一張看起來正常的錯表。
    if (!board) {
      return empty(`${conf.label}整理中`, '榜單在每一場完賽後自動更新，賽事開始後就會出現。');
    }

    let rows = board.rows || [];

    // 兒童組預設不公開個人射手榜（docs/03 §9.1：避免比較壓力）。
    // 這一段要在**選了組別之前**就篩掉，否則「全部組別」照樣把兒童列出來。
    const hidden = conf.kind === 'player'
      ? hiddenScorerDivisions(state.divisions, state.featureFlags)
      : new Set();
    if (state.divisionId && hidden.has(state.divisionId)) {
      return empty('這一組不公開個人射手榜',
        '兒童組以參與為主，個人排名不對外顯示。想看球隊成績請到組別頁的積分榜。');
    }
    rows = rows.filter(r => !hidden.has(r.divisionId));
    if (state.divisionId) rows = rows.filter(r => r.divisionId === state.divisionId);
    if (!rows.length) return empty('還沒有資料', '比賽開始後就會出現。');

    return sectionCard(conf.label, conf.icon,
      el('ol', { class: 'ptop ptop--full' },
        rows.slice(0, 20).map((r, i) => boardRow(conf, r, i))));
  }

  /**
   * 一列。兩張榜的欄位不同：
   *   球員榜 name 是（已遮蔽的）球員名、teamName 是隊名、playerId 可以點進球員頁
   *   球隊榜 name 就是隊名，沒有第二層
   */
  function boardRow(conf, r, i) {
    const rank = el('span', { class: 'ptop__rank num', text: String(r.rank ?? i + 1) });
    const value = el('span', { class: 'ptop__val num', text: `${r[conf.valueKey] ?? 0} ${conf.unit}` });

    if (conf.kind === 'team') {
      return el('li', { class: 'ptop__row' }, [
        rank,
        el('button', {
          class: 'ptop__name', type: 'button',
          onClick: () => r.teamId && navigate(`/team/${encodeURIComponent(r.teamId)}`)
        }, r.name || ''),
        el('span', { class: 'ptop__team', text: `${r.yellow ?? 0} 黃 / ${r.red ?? 0} 紅` }),
        value
      ]);
    }

    // ⚠️ 看板上的球員鍵是 playerId（＝ memberId），不是 memberId。
    //    先前寫成 r.memberId，欄位不存在，點下去完全沒有反應。
    const name = r.name || (r.jerseyNo != null ? `#${r.jerseyNo}` : '未提供姓名');
    return el('li', { class: 'ptop__row' }, [
      rank,
      el('button', {
        class: 'ptop__name', type: 'button',
        onClick: () => r.teamId && r.playerId
          && navigate(`/player/${encodeURIComponent(r.teamId)}/${encodeURIComponent(r.playerId)}`)
      }, name),
      el('span', { class: 'ptop__team', text: r.teamName || '' }),
      value
    ]);
  }
}

/* ── 直播牆 ─────────────────────────────────────────────── */

/**
 * 各場地並列。docs/03 §5.3：同一時間**最多播 1 個**——
 * 這件事由 bits.videoFacade 統一管，點另一個會自動把前一個收掉。
 */
export async function publicLiveWall({ scope, view }) {
  const root = el('div', { class: 'pub' });
  mount(view, root);
  mount(root, skeleton(3));

  const state = { venues: [], matches: [], divisions: [], loaded: false };

  const [venues, divisions] = await Promise.all([
    data.getVenues().catch(() => []),
    data.getDivisions().catch(() => [])
  ]);
  state.venues = venues;
  state.divisions = divisions;

  data.watchMatchesByDate(scope, todayInEvent(), rows => {
    state.matches = rows;
    state.loaded = true;
    render();
  }, () => { state.loaded = true; render(); });

  const stopTicker = startTicker(() => paint(), 1000);
  render();

  function render() {
    if (!state.loaded) { mount(root, skeleton(3)); return; }
    if (!state.venues.length) {
      mount(root, pageHead('直播牆', { onBack: () => navigate('/') }),
        empty('還沒有場地資料', '賽事開始前會公布。'));
      return;
    }
    mount(root,
      pageHead('直播牆', { sub: '同一時間只播一個，點另一個會自動切換', onBack: () => navigate('/') }),
      el('div', { class: 'pwall' }, state.venues.map(venueCard))
    );
  }

  function venueCard(v) {
    const m = state.matches.find(x => x.venueId === v.venueId && isLiveMatch(x))
      || state.matches.find(x => x.venueId === v.venueId);
    const div = m ? state.divisions.find(d => d.divisionId === m.divisionId) : null;
    const url = embedUrl({ match: m, venue: v });

    return el('section', { class: 'pwall__cell', dataset: { venueId: v.venueId } }, [
      el('div', { class: 'pwall__head' }, [
        el('strong', { text: v.name || v.venueId }),
        m ? statusBadge(m, div?.matchDurationMin ?? 30) : el('span', { class: 'muted', text: '今日無場次' })
      ]),
      m ? el('button', {
        class: 'pwall__score', type: 'button',
        onClick: () => navigate(`/match/${encodeURIComponent(m.matchId)}`)
      }, [
        el('span', { text: m.home?.name || '待定' }),
        el('span', { class: 'num', text: `${m.score?.home ?? '–'} - ${m.score?.away ?? '–'}` }),
        el('span', { text: m.away?.name || '待定' })
      ]) : null,
      videoFacade(url, { title: `${v.name || v.venueId} 直播` })
    ].filter(Boolean));
  }

  function paint() {
    for (const node of root.querySelectorAll('.pwall__cell')) {
      const v = node.dataset.venueId;
      const m = state.matches.find(x => x.venueId === v && isLiveMatch(x));
      if (!m) continue;
      const div = state.divisions.find(d => d.divisionId === m.divisionId);
      node.querySelector('.pbadge')?.replaceWith(statusBadge(m, div?.matchDurationMin ?? 30));
    }
  }

  return () => { stopTicker?.(); stopAllVideos(); };
}

function todayInEvent() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: EVENT.timezone }).format(new Date());
  return EVENT.dates.includes(today) ? today : EVENT.dates[0];
}
