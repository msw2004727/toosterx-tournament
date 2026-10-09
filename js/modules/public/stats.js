/**
 * 統計頁 `#/stats` 與直播牆 `#/live`
 * ------------------------------------------------------------------
 * 規格：docs/03-功能規格-公開端.md §9、§5.3
 */

import { divisionThemeAttrs, setDivisionTheme } from '../../core/division-theme.js';
import { el, mount, skeleton } from '../../core/ui.js';
import { navigate } from '../../core/router.js';
import { iconText } from '../../core/icons.js';
import { startTicker } from '../../core/clock.js';
import * as data from './data.js';
import { embedUrl, isLiveMatch, hiddenScorerDivisions } from './selectors.js';
import { pageHead, empty, videoFacade, stopAllVideos, sectionCard, statusBadge } from './bits.js';
import { EVENT } from '../../config.js';
import { clockText, dateTimeLabel, dateLabelFromYmd, periodLabel } from '../../lib/format.js';

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
  { key: 'fairplay', source: 'fairplay', label: '紅黃牌統計', icon: 'card', valueKey: 'fairPlayPoints', unit: '分', kind: 'team' }
];

export async function publicStats({ view, query }) {
  const root = el('div', { class: 'pub' });
  mount(view, root);
  mount(root, skeleton(4));

  const state = {
    boards: { scorers: null, fairplay: null }, featureFlags: {}, divisions: [], loaded: false, boardsError: false,
    tab: BOARDS.some(b => b.key === query?.get('tab')) ? query.get('tab') : 'scorers',
    divisionId: query?.get('division') || null
  };
  const detailsState = new Map();
  const detailsBodies = new Map();

  const [boards, divisions, flags] = await Promise.all([
    readBoards(),
    data.getDivisions().catch(() => []),
    data.getFeatureFlags().catch(() => ({}))
  ]);
  state.boards = boards;
  state.divisions = divisions;
  state.featureFlags = flags;
  state.loaded = true;
  render();

  async function readBoards() {
    try { return await data.getBoards(); }
    catch { state.boardsError = true; return { scorers: null, fairplay: null }; }
  }

  function render() {
    detailsBodies.clear();
    setDivisionTheme(root, state.divisions.find(d => d.divisionId === state.divisionId) || state.divisionId);
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

    if (state.boardsError) return empty('統計資料暫時讀取失敗', '請重新載入，或稍後再試。',
      { label: '重新載入', onClick: () => location.reload() });
    if (conf.kind === 'team') return disciplineBody(board);

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

  function disciplineBody(board) {
    const rows = (board?.rows || []).filter(r => !state.divisionId || r.divisionId === state.divisionId);
    const ids = [...new Set(rows.map(r => r.divisionId))];
    const ordered = [...state.divisions.map(d => d.divisionId), ...ids.filter(id => !state.divisions.some(d => d.divisionId === id))];
    const explanation = el('div', { class: 'pdiscipline__intro' }, [
      el('p', { text: '依已完賽場次累計，包含小組賽與淘汰賽。每隊各列一筆，紀律扣分越接近 0，代表扣分越少。' }),
      el('p', { class: 'muted', text: '紀律扣分不是比賽積分；運動精神獎由主辦評選。' }),
      el('details', { class: 'pdiscipline__rules' }, [
        el('summary', { text: '扣分怎麼計算？' }),
        board?.scoringRules ? el('ul', {}, [
          ['黃牌', 'yellow'], ['兩黃換紅', 'secondYellow'],
          ['直接紅牌', 'directRed'], ['黃牌後直接紅牌', 'yellowThenRed']
        ].map(([label, key]) => el('li', { text: `${label}：${board.scoringRules[key]} 分` }))) : null,
        el('p', { text: '同一球員、同一場比賽按上述情況合併計算，不重複扣分。黃牌張數含第二張黃牌，紅牌張數含兩黃換紅。' })
      ])
    ]);
    return el('div', { class: 'pdiscipline' }, [
      sectionCard('紅黃牌統計', 'card', explanation),
      ...ordered.filter(id => ids.includes(id)).map(id => {
        const division = state.divisions.find(d => d.divisionId === id);
        const card = sectionCard(division?.name || id, 'card', el('ul', { class: 'pdiscipline__list' },
          rows.filter(r => r.divisionId === id).map(r => el('li', { class: 'pdiscipline__row' }, [
            el('button', { class: 'pdiscipline__team', type: 'button',
              onClick: () => navigate(`/team/${encodeURIComponent(r.teamId)}`) }, iconText('forward', r.name || r.teamId, { trailing: true })),
            el('p', { class: 'pdiscipline__played', text: `已完賽 ${r.played ?? 0} 場` }),
            el('dl', { class: 'pdiscipline__metrics' }, [
              ['黃牌', `${r.yellow ?? 0} 張`], ['紅牌', `${r.red ?? 0} 張`], ['紀律扣分', `${r.fairPlayPoints ?? 0} 分`]
            ].map(([label, value]) => el('div', {}, [el('dt', { text: label }), el('dd', { class: 'num', text: value })]))),
            r.secondYellow ? el('p', { class: 'pdiscipline__played', text: `紅牌包含 ${r.secondYellow} 次兩黃換紅` }) : null,
            teamDetails(r, division)
          ]))));
        setDivisionTheme(card, division || id);
        return card;
      }),
      !rows.length ? empty('目前沒有可公布的紅黃牌統計', '有有效完賽紀錄後，會顯示球隊的牌數與紀律扣分；尚未出賽的球隊不列入。') : null
    ]);
  }

  function teamDetails(row, division) {
    const key = `${row.divisionId}|${row.teamId}`;
    if (!detailsState.has(key)) detailsState.set(key, { open: false, status: 'idle', rows: [] });
    const entry = detailsState.get(key);
    const content = el('div', { class: 'pdiscipline__detail-body' });
    detailsBodies.set(key, { content, division });
    const disclosure = el('details', { class: 'pdiscipline__details', open: entry.open,
      onToggle: () => {
        if (!disclosure.isConnected) return;
        entry.open = disclosure.open;
        if (entry.open && entry.status === 'idle') loadDetails();
      }
    }, [el('summary', { text: '查看吃牌明細' }), content]);
    paintDetails(key);
    return disclosure;

    async function loadDetails() {
      if (entry.status === 'loading') return;
      entry.status = 'loading';
      paintDetails(key);
      try {
        entry.rows = await data.getDisciplineDetails(row.teamId, row.divisionId);
        entry.status = 'ready';
      } catch { entry.status = 'error'; }
      entry.retry = loadDetails;
      paintDetails(key);
    }
  }

  function paintDetails(key) {
    const entry = detailsState.get(key);
    const target = detailsBodies.get(key);
    if (!target) return;
    const { content, division } = target;
    if (entry.status === 'idle' || entry.status === 'loading') {
      mount(content, el('p', { class: 'muted', role: 'status', text: '讀取吃牌明細中…' }));
    } else if (entry.status === 'error') {
      mount(content, el('p', { role: 'alert', text: '吃牌明細暫時讀取失敗' }),
        el('button', { type: 'button', class: 'btn btn--ghost', onClick: () => entry.retry() }, '重新讀取'));
    } else if (!entry.rows.length) {
      mount(content, el('p', { class: 'muted', text: '有效完賽場次沒有吃牌紀錄。' }));
    } else {
      mount(content, el('table', { class: 'pdiscipline__table', 'aria-label': '吃牌明細' }, [
        el('thead', {}, el('tr', {}, ['賽程', '時間', '選手'].map(text => el('th', { scope: 'col', text })))),
        el('tbody', {}, entry.rows.map(r => el('tr', {}, [
          el('td', {}, [
            el('button', { type: 'button', class: 'pdiscipline__match',
              onClick: () => navigate(`/match/${encodeURIComponent(r.matchId)}`) }, [
              el('strong', { text: r.label }), el('span', { text: `${r.homeName} vs ${r.awayName}` })
            ]),
            el('small', { text: dateTimeLabel(r.kickoffAt) || dateLabelFromYmd(r.date) || '開賽時間未定' })
          ]),
          el('td', {}, [
            el('span', { text: r.periodId ? periodLabel(r.periodId, division?.periods ?? 2) : '期別未記錄' }),
            el('strong', { class: 'num', text: r.clockSec == null ? '時間未記錄' : clockText(r.clockSec) })
          ]),
          el('td', {}, [
            el('span', { text: `${r.jerseyNo == null ? '' : `#${r.jerseyNo} `}${r.playerName}` }),
            el('span', { class: 'pdiscipline__card-type', dataset: { card: r.cardType },
              text: { yellow: '黃牌', red: '紅牌', second_yellow: '第二黃／兩黃換紅' }[r.cardType] })
          ])
        ])))
      ]));
    }
  }

  /**
   * 一列。兩張榜的欄位不同：
   *   球員榜 name 是（已遮蔽的）球員名、teamName 是隊名、playerId 可以點進球員頁
   *   球隊榜 name 就是隊名，沒有第二層
   */
  function boardRow(conf, r, i) {
    const rank = el('span', { class: 'ptop__rank num', text: String(r.rank ?? i + 1) });
    const value = el('span', { class: 'ptop__val num', text: `${r[conf.valueKey] ?? 0} ${conf.unit}` });

    // ⚠️ 看板上的球員鍵是 playerId（＝ memberId），不是 memberId。
    //    先前寫成 r.memberId，欄位不存在，點下去完全沒有反應。
    const name = r.name || (r.jerseyNo != null ? `#${r.jerseyNo}` : '未提供姓名');
    return el('li', { class: 'ptop__row', ...divisionThemeAttrs(r.divisionId) }, [
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

    return el('section', { class: 'pwall__cell division-card', ...divisionThemeAttrs(div || m?.divisionId), dataset: { venueId: v.venueId } }, [
      el('div', { class: 'pwall__head' }, [
        el('strong', { text: v.name || v.venueId }),
        m ? statusBadge(m, div?.matchDurationMin ?? 30, div?.periods ?? 2) : el('span', { class: 'muted', text: '今日無場次' })
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
      node.querySelector('.pbadge')?.replaceWith(statusBadge(m, div?.matchDurationMin ?? 30, div?.periods ?? 2));
    }
  }

  return () => { stopTicker?.(); stopAllVideos(); };
}

function todayInEvent() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: EVENT.timezone }).format(new Date());
  return EVENT.dates.includes(today) ? today : EVENT.dates[0];
}
