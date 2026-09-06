/**
 * 公開 LIVE 比賽頁 `#/match/:matchId`
 * ------------------------------------------------------------------
 * 規格：docs/03-功能規格-公開端.md §4
 *
 * 這是全站最重要的頁面。家長點進來只想知道兩件事：
 * 現在幾比幾、我的孩子有沒有上場。所以記分板最大、事件流是預設分頁。
 *
 * 監聽剛好 2 個（match ＋ timeline），在 docs/03 §12.4 的預算內。
 */

import { el, mount, skeleton, buzz } from '../../core/ui.js';
import { navigate } from '../../core/router.js';
import { icon, iconText } from '../../core/icons.js';
import { startTicker, now, elapsedSec } from '../../core/clock.js';
import {
  hhmm, dateLabelFromYmd, displayMinute, scoreText, pkText,
  STATUS_LABEL, periodLabel
} from '../../lib/format.js';
import * as data from './data.js';
import { sideLabel, isLiveMatch, isDoneMatch, embedUrl, publicMember, sortRoster } from './selectors.js';
import {
  pageHead, empty, videoFacade, stopAllVideos, shareButton, statusText
} from './bits.js';
import { EVENT_ICON } from '../staff/live-actions.js';
import { APPEAL_STATUS_LABEL } from '../../lib/format.js';

const TABS = [
  { key: 'events', label: '事件', icon: 'list' },
  { key: 'stream', label: '直播', icon: 'play' },
  { key: 'lineup', label: '陣容', icon: 'team' },
  { key: 'stats', label: '統計', icon: 'table' }
];

export async function publicMatch({ params, scope, view, query }) {
  const { matchId } = params;
  const root = el('div', { class: 'pub pmatch' });
  mount(view, root);
  mount(root, skeleton(4));

  const state = {
    match: null, events: [], division: null, venue: null,
    rosters: { home: [], away: [] },
    tab: TABS.some(t => t.key === query?.get('tab')) ? query.get('tab') : 'events',
    loaded: false, notFound: false, lastScore: null
  };

  data.watchMatch(scope, matchId, async (m) => {
    const first = !state.match;
    if (!m) { state.notFound = true; state.loaded = true; render(); return; }

    // 比分變了就彈跳一下＋震動（§4.3）。第一次載入不算「變了」。
    const key = `${m.score?.home ?? ''}:${m.score?.away ?? ''}`;
    const changed = !first && state.lastScore != null && state.lastScore !== key;
    state.lastScore = key;

    state.match = m;
    state.loaded = true;

    if (first) {
      // 這三筆只讀一次：組別設定與名單在比賽期間不會變
      state.division = await data.getDivision(m.divisionId).catch(() => null);
      const venues = await data.getVenues().catch(() => []);
      state.venue = venues.find(v => v.venueId === m.venueId) || null;
      await loadRosters(m);
    }
    render();
    if (changed) bounceScore();
  }, err => {
    state.loaded = true;
    mount(root, pageHead('比賽', { onBack: () => navigate('/schedule') }),
      empty('讀不到這場比賽', err?.message || '請回賽程頁重新選擇。',
        { label: '回賽程', onClick: () => navigate('/schedule') }));
  });

  data.watchTimeline(scope, matchId, evs => { state.events = evs; render(); });

  const stopTicker = startTicker(() => paintClock(), 1000);
  render();

  async function loadRosters(m) {
    for (const side of ['home', 'away']) {
      const teamId = m?.[side]?.teamId;
      if (!teamId) continue;
      try {
        const raw = await data.getRoster(teamId);
        // 公開欄位投影再擋一次：私密欄位絕不進 DOM（R-PRIV-001）
        state.rosters[side] = sortRoster(raw.map(publicMember));
      } catch { state.rosters[side] = []; }
    }
  }

  function render() {
    if (!state.loaded) { mount(root, skeleton(4)); return; }
    if (state.notFound) {
      mount(root,
        pageHead('找不到這場比賽', { onBack: () => navigate('/schedule') }),
        empty('查無此比賽', `代碼 ${matchId} 不存在，可能是連結有誤。`,
          { label: '回賽程', onClick: () => navigate('/schedule') }));
      return;
    }

    const m = state.match;
    mount(root,
      // 標題只放組別與輪次，場地跟時間放副標：三段串在標題上會在 390px 被截掉
      pageHead(
        [state.division?.name, m.label].filter(Boolean).join('　'),
        { sub: [m.venueName || m.venueId, `${dateLabelFromYmd(m.date)}　${hhmm(m.kickoffAt)}`].filter(Boolean).join('　·　'), onBack: () => history.back() }
      ),
      scoreboard(m),
      tabBar(),
      tabBody(),
      el('div', { class: 'pmatch__actions' }, [
        shareButton(shareText(m), location.href)
      ])
    );
    paintClock();
  }

  // 具名函式（會被提升）：第一筆快照可能同步送達，那時 const 還在 TDZ
  function dur() { return state.division?.matchDurationMin ?? 30; }

  function scoreboard(m) {
    // 分頁標題跟分享文字用同一句：路由給的「比賽」只是資料到之前的暫時標題
    document.title = shareText(m);
    const sc = scoreText(m.score, state.division?.display?.mercyRule);
    const started = isLiveMatch(m) || isDoneMatch(m);
    // 單節的組別（規章第十八條第 2 款：不分上下半場）沒有「半場」這回事（驗收 D-07）
    const ht = (state.division?.periods ?? 2) > 1 && m.htScore && m.htScore.home != null
      ? `半場 ${m.htScore.home}-${m.htScore.away}` : null;

    return el('div', { class: 'psb', dataset: { status: m.status || 'scheduled' } }, [
      el('div', { class: 'psb__status' }, [
        el('span', { class: 'dot', dataset: { status: m.status || 'scheduled' }, 'aria-hidden': 'true' }),
        el('span', { class: 'psb__statusText', id: 'pmatch-status', text: statusText(m, dur()) })
      ]),
      el('div', { class: 'psb__row' }, [
        el('span', { class: 'psb__team', text: sideLabel(m, 'home') }),
        el('div', { class: 'psb__nums num', 'aria-live': 'polite', 'aria-atomic': 'true' }, [
          el('span', { class: 'psb__num', id: 'psb-home', text: started ? sc.home : '–' }),
          el('span', { class: 'psb__dash', text: '-' }),
          el('span', { class: 'psb__num', id: 'psb-away', text: started ? sc.away : '–' })
        ]),
        el('span', { class: 'psb__team', text: sideLabel(m, 'away') })
      ]),
      ht ? el('p', { class: 'psb__ht', text: ht }) : null,
      // PK 決勝：正規時間平手時勝負是 PK 決定的，只印 2-2 家長看不出誰晉級
      // （2026-09-06 驗收：「比分要有同分發生 PK 時的欄位」）
      pkText(m) ? el('p', { class: 'psb__ht psb__pk', id: 'psb-pk', text: pkText(m) }) : null,
      // 申訴（規章第二十條）：只顯示狀態與哪一隊，事由與電話不公開
      m.appeal?.status
        ? el('p', { class: 'psb__note psb__appeal', dataset: { status: m.appeal.status }, text:
            `${APPEAL_STATUS_LABEL[m.appeal.status] ?? m.appeal.status}` +
            (m.appeal.teamId ? `（${m.home?.teamId === m.appeal.teamId ? sideLabel(m, 'home') : sideLabel(m, 'away')} 提出）` : '') })
        : null,
      sc.masked ? el('p', { class: 'psb__note', text: '兒童組比分達分差上限，以 7+ 顯示' }) : null,
      // 未開賽時把開賽時間講清楚，不要只留一個空的 0-0（§4.5）
      !started ? el('p', { class: 'psb__note', text: `${hhmm(m.kickoffAt)} 開賽` }) : null
    ].filter(Boolean));
  }


  function tabBar() {
    return el('div', { class: 'ptabs ptabs--sub', role: 'tablist', 'aria-label': '比賽資訊' },
      TABS.map(t => el('button', {
        class: `ptabs__btn ${state.tab === t.key ? 'is-active' : ''}`,
        type: 'button', role: 'tab', 'aria-selected': state.tab === t.key ? 'true' : 'false',
        onClick: () => {
          state.tab = t.key;
          location.replace(`#/match/${encodeURIComponent(matchId)}?tab=${t.key}`);
          render();
        }
      }, iconText(t.icon, t.label))));
  }

  function tabBody() {
    if (state.tab === 'stream') return streamTab();
    if (state.tab === 'lineup') return lineupTab();
    if (state.tab === 'stats') return statsTab();
    return eventsTab();
  }

  function streamTab() {
    const url = embedUrl({ match: state.match, venue: state.venue });
    if (!url) {
      return empty('目前沒有直播',
        isDoneMatch(state.match) ? '這場比賽沒有留下錄影。' : '直播通常在開賽前 10 分鐘開始。');
    }
    return videoFacade(url, { title: `${sideLabel(state.match, 'home')} vs ${sideLabel(state.match, 'away')}` });
  }

  function eventsTab() {
    const rows = state.events.filter(e => !e.voided);
    if (!rows.length) {
      return empty(
        isLiveMatch(state.match) ? '還沒有事件' : '尚未開賽',
        isLiveMatch(state.match) ? '進球、出牌與換人會即時出現在這裡。' : '開賽後這裡會即時更新。');
    }
    return el('ul', { class: 'ptl' }, rows.map(e => el('li', {
      class: `ptl__item ptl__item--${e.side || 'none'}`
    }, [
      el('span', { class: 'ptl__min num', text: displayMinute(e.clockSec ?? 0, e.periodId, dur(), state.division?.periods ?? 2) }),
      // 黃牌與紅牌一定要看得出差別——這是家長掃時間軸時真正在找的東西
      el('span', { class: 'ptl__icon' }, icon(iconFor(e), {
        cls: e.type === 'card'
          ? `icon--card-fill ${e.cardType === 'yellow' ? 'icon--yellow' : 'icon--red'}`
          : undefined
      })),
      el('span', { class: 'ptl__text', text: eventLine(e, state.division?.periods ?? 2) }),
      // 開賽／結束這類沒有隊伍的事件，右邊留白；印「待定」會讓人以為資料壞了
      el('span', { class: 'ptl__team', text: e.side ? sideLabel(state.match, e.side) : '' })
    ])));
  }

  function lineupTab() {
    const col = side => {
      const list = state.rosters[side];
      return el('div', { class: 'plineup__col' }, [
        el('h3', { class: 'plineup__team', text: sideLabel(state.match, side) }),
        list.length
          ? el('ul', { class: 'plineup__list' }, list.map(p => el('li', { class: 'plineup__row' }, [
              el('span', { class: 'plineup__no num', text: p.jerseyNo != null ? String(p.jerseyNo) : '' }),
              el('button', {
                class: 'plineup__name', type: 'button',
                onClick: () => navigate(`/player/${encodeURIComponent(p.teamId)}/${encodeURIComponent(p.memberId)}`)
              }, p.displayName || ''),
              el('span', { class: 'plineup__pos', text: p.position || (p.role === 'coach' ? '教練' : '') })
            ])))
          : empty('名單未公開', '這一隊選擇不公開球員名單。')
      ]);
    };
    return el('div', { class: 'plineup' }, [col('home'), col('away')]);
  }

  function statsTab() {
    const live = state.events.filter(e => !e.voided);
    const count = (side, pred) => live.filter(e => e.side === side && pred(e)).length;
    const rows = [
      ['進球', e => ['goal', 'penalty_scored'].includes(e.type)],
      ['黃牌', e => e.type === 'card' && e.cardType === 'yellow'],
      ['紅牌', e => e.type === 'card' && ['red', 'second_yellow'].includes(e.cardType)],
      ['換人', e => e.type === 'substitution']
    ];
    return el('table', { class: 'pstats' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { scope: 'col', text: sideLabel(state.match, 'home') }),
        el('th', { scope: 'col', text: '' }),
        el('th', { scope: 'col', text: sideLabel(state.match, 'away') })
      ])),
      el('tbody', {}, rows.map(([label, pred]) => el('tr', {}, [
        el('td', { class: 'num', text: String(count('home', pred)) }),
        el('th', { scope: 'row', text: label }),
        el('td', { class: 'num', text: String(count('away', pred)) })
      ])))
    ]);
  }

  /** 每秒只換狀態文字，不重畫整頁 */
  function paintClock() {
    const m = state.match;
    if (!m || m.status !== 'live') return;
    const node = document.getElementById('pmatch-status');
    if (node) node.textContent = displayMinute(elapsedSec(m.clock, now()), m.period, dur(), state.division?.periods ?? 2) || STATUS_LABEL.live;
  }

  function bounceScore() {
    for (const id of ['psb-home', 'psb-away']) {
      const n = document.getElementById(id);
      if (!n) continue;
      n.classList.remove('is-bump');
      void n.offsetWidth;              // 強制重排，否則同一個 class 加回去不會重播動畫
      n.classList.add('is-bump');
    }
    buzz(200);
  }

  function shareText(m) {
    const sc = scoreText(m.score, state.division?.display?.mercyRule);
    const started = isLiveMatch(m) || isDoneMatch(m);
    const mid = started ? `${sc.home}-${sc.away}` : 'vs';
    return `${sideLabel(m, 'home')} ${mid} ${sideLabel(m, 'away')}｜FEDA CUP 2026 ${state.division?.name ?? ''}`.trim();
  }

  return () => { stopTicker?.(); stopAllVideos(); };
}

/** 事件圖示沿用賽務端那一份對照表，不要另外維護一份 */
function iconFor(e) {
  return EVENT_ICON[e?.type] || 'note';
}

function eventLine(e, periods = 2) {
  const who = e?.playerName
    ? `${e.jerseyNo != null ? '#' + e.jerseyNo + ' ' : ''}${e.playerName}`
    : '';
  switch (e?.type) {
    case 'goal':           return `進球　${who}`;
    case 'penalty_scored': return `罰球進　${who}`;
    case 'penalty_missed': return `罰球失　${who}`;
    case 'own_goal':       return `烏龍球　${who}`;
    case 'card':           return `${{ yellow: '黃牌', second_yellow: '兩黃換紅', red: '紅牌' }[e.cardType] || '出牌'}　${who}`;
    case 'substitution':   return `換人　${who} 下場`;
    case 'period_start':   return `${periodLabel(e.periodId, periods)} 開始`;
    case 'period_end':     return `${periodLabel(e.periodId, periods)} 結束`;
    default:               return e?.note || e?.type || '';
  }
}

export { eventLine, iconFor };
