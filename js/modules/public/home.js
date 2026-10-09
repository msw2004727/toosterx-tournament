/**
 * 公開首頁 `#/`
 * ------------------------------------------------------------------
 * 規格：docs/03-功能規格-公開端.md §2
 *
 * 這一頁要回答的問題只有一個：
 *   **現場家長掏出手機，三秒內看到「我的孩子那場現在幾比幾」。**
 *
 * 所以順序是：進行中 → 接下來 → 剛結束 → 各組排名 → 射手榜。
 * 沒有 live 場次時整區隱藏，「接下來」上移（§2.3）。
 */

import { venueMapPopup } from './venue-map.js';
import { homeMetrics } from './home-metrics.js';
import { divisionThemeAttrs } from '../../core/division-theme.js';
import { el, mount, skeleton, toast } from '../../core/ui.js';
import { navigate } from '../../core/router.js';
import { icon, iconText } from '../../core/icons.js';
import { startTicker, now } from '../../core/clock.js';
import { activityTime } from '../../core/activity-clock.js';
import { selectedActivityDate } from '../../engine/challenge-days.js';
import { dateLabelFromYmd, hhmm } from '../../lib/format.js';
import { EVENT, CACHE_VERSION } from '../../config.js';
import * as data from './data.js';
import { splitHomeSections, isLiveMatch, hiddenScorerDivisions, publishedMatches, embedUrl } from './selectors.js';
import { matchRow, sectionCard, empty, statusBadge } from './bits.js';

const MATCH_TABS = [
  { key: 'all', label: '全部' }, { key: 'live', label: '進行中' },
  { key: 'next', label: '接下來' }, { key: 'done', label: '剛結束' }
];
const SCORER_TABS = [
  { key: 'all', label: '全部' }, { key: 'women', label: '女子組' },
  { key: 'adult-fun', label: '興趣組' }, { key: 'adult-open', label: '公開組' }
];

export async function publicHome({ scope, view, query }) {
  const root = el('div', { class: 'pub p-home' });
  const metrics = homeMetrics();
  mount(view, root);
  const venueMap = venueMapPopup();
  venueMap.open({ automatic: true });

  const state = {
    date: EVENT.dates.includes(query?.get('date')) ? query.get('date') : todayInEvent(),
    matches: [],
    divisions: [],
    venues: [],
    divisionsStatus: 'loading',
    matchError: null,
    scorers: null,
    featureFlags: {},
    loading: true,
    matchTab: 'all',
    scorerTab: 'all'
  };

  let disposed = false;
  let closeRankingsToast = null;

  // 組別讀取狀態與比分分開，快捷入口才能說明尚未載入的原因。
  void loadDivisions();
  void loadVenues();
  async function loadVenues() {
    try { state.venues = await data.getVenues(); } catch { return; }
    if (!disposed) refreshMatches();
  }
  async function loadDivisions() {
    try {
      state.divisions = await data.getDivisions();
      state.divisionsStatus = 'ready';
    } catch {
      state.divisionsStatus = 'error';
    }
    if (!disposed) render();
  }

  Promise.all([data.getBoards(), data.getFeatureFlags()])
    .then(([boards, flags]) => {
      if (disposed) return;
      state.scorers = boards.scorers;
      state.featureFlags = flags;
      render();
    })
    .catch(() => {});

  // 直接監聽所選日期的權威場次，維持一個監聽。
  // boards/live 未持續重建，不能讓它阻擋完賽與比分更正的即時更新。
  let stopMatches = null;
  let matchGeneration = 0;

  function startMatches(preserve = false) {
    if (disposed) return;
    stopMatches?.();
    const date = state.date;
    const generation = ++matchGeneration;
    if (!preserve) { state.matches = []; state.loading = true; state.matchError = null; }
    stopMatches = data.watchMatchesByDate(scope, date, rows => {
      if (disposed || generation !== matchGeneration || date !== state.date) return;
      state.matches = rows;
      state.loading = false; state.matchError = null;
      refreshMatches();
    }, err => {
      if (disposed || generation !== matchGeneration || date !== state.date) return;
      state.loading = false; state.matchError = err;
      refreshMatches();
    });
  }
  startMatches();

  const resumeMatches = () => {
    if (!disposed && document.visibilityState !== 'hidden') startMatches(true);
  };
  const matchVisibility = () => {
    if (document.visibilityState === 'hidden') { stopMatches?.(); stopMatches = null; ++matchGeneration; }
    else resumeMatches();
  };
  document.addEventListener('visibilitychange', matchVisibility);
  window.addEventListener('online', resumeMatches);

  // 進行中的分鐘數要自己跑，不靠伺服器推播（§2.3）
  let autoDate = todayInEvent();
  const stopTicker = startTicker(() => {
    const date = todayInEvent();
    if (date !== autoDate) { autoDate = date; selectDate(date); }
    paintMinutes();
  }, 1000);

  function selectDate(date) {
    if (disposed || date === state.date) return;
    state.date = date;
    startMatches(); render();
  }

  render();

  function sections() {
    // 未發布賽程一律不出現在首頁。
    return splitHomeSections({
      matches: publishedMatches(state.matches, state.divisions),
      nowMs: now()
    });
  }

  // 具名函式（會被提升）：第一筆快照可能同步送達，那時 const 還在 TDZ
  function divisionOf(id) { return state.divisions.find(d => d.divisionId === id) || null; }
  function open(m) { navigate(`/match/${encodeURIComponent(m.matchId)}`); }

  function render() {
    if (state.loading) { mount(root, homeHero(), skeleton(4)); return; }
    mount(root,
      homeHero(),
      homeShortcuts(),
      dateTabs(),

      // 挑戰區入口（docs/06 §9：賽事與挑戰區並列兩個入口）。
      //
      // ⚠️ **放在最上面、live 之前。** 現場立牌的 QR 掃進來就是首頁，
      //    而掃那張立牌的人多半是路過想玩遊戲的，不是來看比分的。
      //    藏在最底下的話他找不到，攤位就沒有人。
      //    這一格不看有沒有 Game Pass——判斷要多讀一份文件，
      //    而「挑戰區在哪裡」對兩種人都是同一個答案。
      el('button', {
        class: 'pub__challengeEntry', type: 'button',
        onClick: () => navigate('/challenge')
      }, [
        el('span', { class: 'pub__challengeIcon' }, icon('goal')),
        el('span', { class: 'pub__challengeMain' }, [
          el('strong', { text: '足球挑戰區' }),
          el('span', { class: 'pub__challengeSub', text: '完成當日開放攤位，取得當日抽獎機會' })
        ]),
        el('span', { class: 'pub__challengeGo' }, icon('forward'))
      ]),

      matchTabs(),
      el('div', { class: 'p-homeMatches', id: 'home-matches', role: 'tabpanel',
        'aria-labelledby': `home-match-tab-${state.matchTab}` }, matchContent()),

      state.divisions.length ? sectionCard('各組即時排名', 'table',
        el('div', { class: 'pchips' }, state.divisions.map(d =>
          el('button', {
            ...divisionThemeAttrs(d), class: 'chip pdiv', type: 'button', dataset: { div: d.divisionId },
            onClick: () => navigate(`/division/${encodeURIComponent(d.divisionId)}`)
          }, [
            el('span', { class: 'pdiv__dot', 'aria-hidden': 'true' }),
            el('span', { class: 'pdiv__name', text: d.name || d.divisionId })
          ])))
      ) : null,

      scorerCard(),
      sponsorCard(),
      // 版號印在最底下：回報問題時第一句就是「你看到的版號是多少」（驗收 P-1）
      el('p', { class: 'pver', text: `系統版本 ${CACHE_VERSION}` })
    );
    paintMinutes();
  }

  function matchContent() {
    if (state.matchError) return empty('載入失敗',
      state.matchError.code === 'permission-denied'
        ? '公開資料暫時讀不到，請稍後再試。'
        : (state.matchError.message || '請稍後再試。'),
      { label: '重新載入', onClick: () => { startMatches(); refreshMatches(); } });
    if (state.loading) return skeleton(4);
    const { live, next, done } = sections();
    return [
      (state.matchTab === 'all' && live.length) || state.matchTab === 'live'
        ? matchSection('現在進行中', 'live', live, '目前沒有正在進行的場次') : null,
      ['all', 'next'].includes(state.matchTab)
        ? matchSection('接下來', 'clock', next, '這個日期沒有待進行的場次', true) : null,
      (state.matchTab === 'all' && done.length) || state.matchTab === 'done'
        ? matchSection('剛結束', 'check', done, '目前沒有剛結束的場次') : null
    ].filter(Boolean);
  }

  /** 比賽快照只更新比賽欄位，保留頁首、其他分頁、焦點與其他區塊。 */
  function refreshMatches() {
    const matchesRoot = root.querySelector('#home-matches');
    if (!matchesRoot) { render(); return; }
    mount(matchesRoot, matchContent());
    paintMinutes();
  }

  function matchSection(title, glyph, matches, emptyTitle, showSchedule = false) {
    return sectionCard(title, glyph,
      matches.length ? el('ul', { class: `plist${glyph === 'live' ? ' plist--live' : ''}` },
        matches.map(m => matchRow({ match: m, onOpen: open, division: divisionOf(m.divisionId),
          streamAvailable: Boolean(embedUrl({ match: m, venue: state.venues.find(v => v.venueId === m.venueId), parent: location.hostname })) })))
        : empty(emptyTitle, '換一個日期看看，或看完整賽程。'),
      showSchedule ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button',
        onClick: () => navigate(`/schedule?date=${encodeURIComponent(state.date)}`)
      }, iconText('forward', '看完整賽程', { trailing: true })) : null);
  }

  function matchTabs() {
    const select = key => {
      if (key === state.matchTab) return;
      state.matchTab = key;
      render();
      root.querySelector(`#home-match-tab-${key}`)?.focus({ preventScroll: true });
    };
    return el('div', { class: 'p-matchTabs', role: 'tablist', 'aria-label': '賽事狀態' },
      MATCH_TABS.map((tab, i) => el('button', {
        id: `home-match-tab-${tab.key}`, class: `p-matchTabs__btn${tab.key === state.matchTab ? ' is-active' : ''}`,
        type: 'button', role: 'tab', 'aria-selected': String(tab.key === state.matchTab),
        'aria-controls': 'home-matches', tabindex: tab.key === state.matchTab ? '0' : '-1',
        onClick: () => select(tab.key),
        onKeydown: e => {
          const next = e.key === 'ArrowRight' ? (i + 1) % MATCH_TABS.length
            : e.key === 'ArrowLeft' ? (i + MATCH_TABS.length - 1) % MATCH_TABS.length
            : e.key === 'Home' ? 0 : e.key === 'End' ? MATCH_TABS.length - 1 : null;
          if (next != null) { e.preventDefault(); select(MATCH_TABS[next].key); }
        }
      }, tab.label)));
  }

  function scorerCard() {
    // 首頁僅列女子、興趣、公開組；官方看板數字不從 timeline 重算。
    const hidden = hiddenScorerDivisions(state.divisions, state.featureFlags);
    const rows = (state.scorers?.rows || [])
      .filter(r => SCORER_TABS.some(tab => tab.key === r.divisionId) && !hidden.has(r.divisionId))
      .filter(r => state.scorerTab === 'all' || r.divisionId === state.scorerTab)
      .sort((a, b) => (b.goals ?? 0) - (a.goals ?? 0))
      .slice(0, 3);
    const card = sectionCard('射手榜', 'goal', [
      scorerTabs(),
      el('div', { id: 'home-scorers', role: 'tabpanel', 'aria-labelledby': `home-scorer-tab-${state.scorerTab}` }, rows.length
        ? el('ol', { class: 'ptop' }, rows.map((r, i) => el('li', { class: 'ptop__row', ...divisionThemeAttrs(r.divisionId) }, [
            el('span', { class: 'ptop__rank num', text: String(i + 1) }),
            el('span', { class: 'ptop__name', text: r.displayName || r.name || '' }),
            el('span', { class: 'ptop__team', text: r.teamName || '' }),
            el('span', { class: 'ptop__val num', text: String(r.goals ?? 0) })
          ])))
        : empty('射手榜整理中', state.scorerTab === 'all' ? '比賽開始後就會出現。' : '此組目前尚無射手榜資料。'))
      ],
      el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button',
        onClick: () => navigate(state.scorerTab === 'all' ? '/stats' : `/stats?division=${encodeURIComponent(state.scorerTab)}`)
      }, iconText('forward', '完整統計', { trailing: true }))
    );
    card.classList.add('p-homeScorers');
    return card;
  }

  function scorerTabs() {
    const select = key => {
      if (key === state.scorerTab) return;
      state.scorerTab = key;
      render();
      root.querySelector(`#home-scorer-tab-${key}`)?.focus({ preventScroll: true });
    };
    return el('div', { class: 'p-matchTabs p-scorerTabs', role: 'tablist', 'aria-label': '射手榜組別' },
      SCORER_TABS.map((tab, i) => el('button', {
        id: `home-scorer-tab-${tab.key}`, class: `p-matchTabs__btn${tab.key === state.scorerTab ? ' is-active' : ''}`,
        type: 'button', role: 'tab', 'aria-selected': String(tab.key === state.scorerTab),
        'aria-controls': 'home-scorers', tabindex: tab.key === state.scorerTab ? '0' : '-1',
        onClick: () => select(tab.key),
        onKeydown: e => {
          const next = e.key === 'ArrowRight' ? (i + 1) % SCORER_TABS.length
            : e.key === 'ArrowLeft' ? (i + SCORER_TABS.length - 1) % SCORER_TABS.length
            : e.key === 'Home' ? 0 : e.key === 'End' ? SCORER_TABS.length - 1 : null;
          if (next != null) { e.preventDefault(); select(SCORER_TABS[next].key); }
        }
      }, tab.label)));
  }

  function homeHero() {
    const parts = EVENT.name.split('｜');
    const date = d => d.slice(5).replace('-', '.');
    const range = [EVENT.dates[0], EVENT.dates.at(-1)].filter(Boolean).map(date).join(' — ');
    return el('section', { class: 'p-homeHero' }, [
      el('div', { class: 'p-homeHero__copy' }, [
        el('div', { class: 'p-homeHero__brand' }, [
          el('p', { class: 'p-homeHero__eyebrow', text: parts.length > 1 ? parts[0] : 'TOURNAMENT' }),
          el('h1', { class: 'p-homeHero__title', 'aria-label': EVENT.name, text: parts.at(-1) })
        ]),
        el('p', { class: 'p-homeHero__sponsor', text: '主要贊助商：宏明體育用品社' }),
        el('p', { class: 'p-homeHero__slogan', text: EVENT.slogan }),
        el('p', { class: 'p-homeHero__meta' }, [
          el('span', { text: range }), el('span', { text: EVENT.venueName })
        ])
      ]), metrics.element
    ]);
  }

  function homeShortcuts() {
    return el('nav', { class: 'p-homeShortcuts', 'aria-label': '賽事快捷功能' }, [
      ['table', '場地配置', () => venueMap.open()],
      ['list', '完整賽程', () => navigate(`/schedule?date=${encodeURIComponent(state.date)}`)],
      ['table', '各組排名', showRankings],
      ['goal', '射手榜', () => navigate('/stats')]
    ].map(([glyph, label, onClick]) => el('button', { type: 'button', onClick }, [icon(glyph), el('span', { text: label })])));
  }

  function showRankings() {
    closeRankingsToast?.();
    if (state.divisionsStatus === 'loading') {
      closeRankingsToast = toast('組別資料載入中，請稍候再試。', 'warn');
      return;
    }
    if (state.divisionsStatus === 'error') {
      closeRankingsToast = toast('讀不到組別資料，請重新整理或稍後再試。', 'error');
      return;
    }
    if (!state.divisions.length) {
      closeRankingsToast = toast('目前尚未設定組別，請稍後再查看。', 'warn');
      return;
    }
    const choices = root.querySelector('.pchips');
    choices.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center'
    });
    choices.querySelector('button')?.focus({ preventScroll: true });
    closeRankingsToast = toast('請選擇組別查看排名');
  }

  function sponsorCard() {
    const partners = [
      { key: 'hongming', file: 'hongming-sports', alt: '宏明體育用品社', name: '宏明體育用品社' },
      { key: 'mizuno', file: 'mizuno', alt: '美津濃 Mizuno', name: '台灣美津濃股份有限公司' }
    ];
    return el('section', { class: 'psponsor', 'aria-label': '贊助合作夥伴' }, [
      el('span', { class: 'psponsor__label', text: '贊助合作夥伴' }),
      el('div', { class: 'psponsor__partners' }, partners.map(partner =>
        el('figure', { class: 'psponsor__partner' }, [
          el('div', { class: 'psponsor__art' },
            el('div', { class: `psponsor__logoCrop psponsor__logoCrop--${partner.key}` },
              el('img', {
                class: `psponsor__logo psponsor__logo--${partner.key}`,
                src: `/img/brands/${partner.file}.png?v=${CACHE_VERSION}`, alt: partner.alt,
                width: 1254, height: 1254, loading: 'lazy', decoding: 'async'
              }))),
          el('figcaption', { class: 'psponsor__name', text: partner.name })
        ]))),
      el('div', { class: 'psponsor__toosterx' }, el('img', {
        class: 'psponsor__toosterxLogo', src: `/img/brands/toosterx.png?v=${CACHE_VERSION}`,
        alt: 'ToosterX', width: 466, height: 96, loading: 'lazy', decoding: 'async'
      }))
    ]);
  }

  function dateTabs() {
    return el('div', { class: 'ptabs', role: 'tablist', 'aria-label': '日期' },
      EVENT.dates.map(d => el('button', {
        class: `ptabs__btn ${d === state.date ? 'is-active' : ''}`,
        type: 'button', role: 'tab', 'aria-selected': d === state.date ? 'true' : 'false',
        onClick: () => {
          selectDate(d);
        }
      }, dateLabelFromYmd(d))));
  }

  /** 只更新分鐘數字，不重畫整頁——重畫會把手指下的按鈕抽掉 */
  function paintMinutes() {
    const { live } = sections();
    if (!live.length) return;
    const byId = new Map(live.filter(m => m?.matchId).map(m => [m.matchId, m]));
    for (const node of root.querySelectorAll('.prow[data-match-id]')) {
      const m = byId.get(node.dataset.matchId);
      if (!m || !isLiveMatch(m)) continue;
      node.querySelector('.pbadge')?.replaceWith(
        statusBadge(m, divisionOf(m.divisionId)?.matchDurationMin ?? 30, divisionOf(m.divisionId)?.periods ?? 2));
    }
  }

  return () => {
    disposed = true;
    document.removeEventListener('visibilitychange', matchVisibility);
    window.removeEventListener('online', resumeMatches);
    metrics.dispose(); venueMap.close(); closeRankingsToast?.(); stopTicker?.(); stopMatches?.();
  };
}

/** 與攤位共用活動時區及測試時間，賽前保留首日、賽後保留末日。 */
function todayInEvent() {
  return selectedActivityDate(activityTime(), EVENT.dates, EVENT.timezone);
}

export { todayInEvent, hhmm };
