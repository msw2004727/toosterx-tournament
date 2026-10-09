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
import { splitHomeSections, isLiveMatch, hiddenScorerDivisions, publishedMatches, hasBoardContent } from './selectors.js';
import { matchRow, sectionCard, empty, pageHead, statusBadge } from './bits.js';

const MATCH_TABS = [
  { key: 'all', label: '全部' }, { key: 'live', label: '進行中' },
  { key: 'next', label: '接下來' }, { key: 'done', label: '剛結束' }
];

export async function publicHome({ scope, view, query }) {
  const root = el('div', { class: 'pub p-home' });
  mount(view, root);
  const venueMap = venueMapPopup();
  venueMap.open({ automatic: true });

  const state = {
    date: EVENT.dates.includes(query?.get('date')) ? query.get('date') : todayInEvent(),
    matches: [],
    divisions: [],
    divisionsStatus: 'loading',
    board: null,
    boardMissing: false,
    scorers: null,
    featureFlags: {},
    loading: true,
    matchTab: 'all'
  };

  let disposed = false;
  let closeRankingsToast = null;

  // 組別讀取狀態與比分分開，快捷入口才能說明尚未載入的原因。
  void loadDivisions();
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
      state.scorers = boards.scorers;
      state.featureFlags = flags;
      render();
    })
    .catch(() => {});

  // docs/03 §2.2：首頁只監聽 1 份文件。
  // 但 boards/live 是 Function 扇出的，還沒上線；不存在就退回直接監聽今日場次。
  //
  // ⚠️ stopBoard 一定要先宣告成 let。onSnapshot 的第一筆快照可能在
  //    watchLiveBoard() 還沒回傳時就送到（本機快取命中、或替身 SDK 同步呼叫），
  //    這時回呼裡碰 const stopBoard 會直接 ReferenceError，整頁空白。
  //    這條路徑現在**一定會走到**（看板文件還不存在），所以不是理論問題。
  let stopMatches = null;
  let stopBoard = null;

  const dropBoard = () => { const f = stopBoard; stopBoard = null; f?.(); };

  stopBoard = data.watchLiveBoard(scope, board => {
    if (disposed || state.boardMissing) return;
    // ⚠️ **空的看板不算看板**（2026-09-05 在真站上看到）。
    //    種子會建一份三個陣列都是空的 `boards/live` 空殼，而 Function
    //    只在有比賽結果時才重建它——結果首頁整天顯示「這個日期沒有待進行
    //    的場次」，而那一天明明排了 35 場。
    //
    //    退回去監聽當日場次**永遠不會比較差**：真的沒有場次時，
    //    splitHomeSections 算出來也是空的；看板還沒建好時，它算出來才是對的。
    //    看板是效能最佳化，不是功能的前提（這一段的原始註解就是這樣寫的）。
    const boardRows = ['liveMatches', 'nextMatches', 'justFinished'].flatMap(key => board?.[key] ?? []);
    if (hasBoardContent(board) && boardRows.every(row => row.date === state.date)) {
      state.board = board;
      state.boardMissing = false;
      state.loading = false;
      render();
      return;
    }
    // 看板不存在或是空的 → 換成監聽當日場次（同樣只有 1 個監聽，先收掉看板那個）
    if (!state.boardMissing) {
      state.boardMissing = true;
      // 排到下一個 tick：此刻 watchLiveBoard() 可能還沒回傳，stopBoard 還是 null
      queueMicrotask(() => { dropBoard(); startMatchFallback(); });
    }
  }, () => {
    if (state.boardMissing) return;
    state.boardMissing = true;
    queueMicrotask(() => { dropBoard(); startMatchFallback(); });
  });

  function startMatchFallback() {
    if (disposed) return;
    stopMatches?.();
    const date = state.date;
    state.matches = []; state.loading = true;
    stopMatches = data.watchMatchesByDate(scope, date, rows => {
      if (disposed || date !== state.date) return;
      state.matches = rows;
      state.loading = false;
      render();
    }, err => {
      if (disposed || date !== state.date) return;
      state.loading = false;
      mount(root, pageHead(EVENT.name, { sub: EVENT.slogan }), empty(
        '載入失敗',
        err?.code === 'permission-denied'
          ? '公開資料暫時讀不到，請稍後再試。'
          : (err?.message || '請稍後再試。'),
        { label: '重新載入', onClick: () => location.reload() }
      ));
    });
  }

  // 進行中的分鐘數要自己跑，不靠伺服器推播（§2.3）
  let autoDate = todayInEvent();
  const stopTicker = startTicker(() => {
    const date = todayInEvent();
    if (date !== autoDate) { autoDate = date; selectDate(date); }
    paintMinutes();
  }, 1000);

  function selectDate(date) {
    if (disposed || date === state.date) return;
    state.date = date; state.board = null; state.boardMissing = true;
    dropBoard(); startMatchFallback(); render();
  }

  render();

  function sections() {
    // 還沒發布賽程的組別一律不出現在首頁（主辦可能正在排到一半）。
    // ⚠️ 看板（boards/live）是 Cloud Function 產的，裡面**沒有**過濾，
    //    所以這裡兩條路都要過一次——只濾其中一條，首頁會在看板還沒
    //    產生時正確、產生之後又漏出來。
    const gate = list => publishedMatches(list, state.divisions);
    if (state.board) {
      return {
        live: gate(state.board.liveMatches || []),
        next: gate(state.board.nextMatches || []),
        done: gate(state.board.justFinished || [])
      };
    }
    return splitHomeSections({
      matches: gate(state.matches),
      nowMs: now()
    });
  }

  // 具名函式（會被提升）：第一筆快照可能同步送達，那時 const 還在 TDZ
  function divisionOf(id) { return state.divisions.find(d => d.divisionId === id) || null; }
  function open(m) { navigate(`/match/${encodeURIComponent(m.matchId)}`); }

  function render() {
    if (state.loading) { mount(root, homeHero(), skeleton(4)); return; }
    const { live, next, done } = sections();

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
        'aria-labelledby': `home-match-tab-${state.matchTab}` }, [
        (state.matchTab === 'all' && live.length) || state.matchTab === 'live'
          ? matchSection('現在進行中', 'live', live, '目前沒有正在進行的場次') : null,
        ['all', 'next'].includes(state.matchTab)
          ? matchSection('接下來', 'clock', next, '這個日期沒有待進行的場次', true) : null,
        (state.matchTab === 'all' && done.length) || state.matchTab === 'done'
          ? matchSection('剛結束', 'check', done, '目前沒有剛結束的場次') : null
      ].filter(Boolean)),

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

  function matchSection(title, glyph, matches, emptyTitle, showSchedule = false) {
    return sectionCard(title, glyph,
      matches.length ? el('ul', { class: `plist${glyph === 'live' ? ' plist--live' : ''}` },
        matches.map(m => matchRow({ match: m, onOpen: open, division: divisionOf(m.divisionId) })))
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
    // 兒童組預設不進個人榜（docs/03 §9.1）。首頁的 TOP 3 是全組別混排，
    // 所以這裡一定要篩，不能只在統計頁篩。
    const hidden = hiddenScorerDivisions(state.divisions, state.featureFlags);
    const rows = (state.scorers?.rows || [])
      .filter(r => !hidden.has(r.divisionId))
      .slice(0, 3);
    return sectionCard('射手榜', 'goal',
      rows.length
        ? el('ol', { class: 'ptop' }, rows.map((r, i) => el('li', { class: 'ptop__row', ...divisionThemeAttrs(r.divisionId) }, [
            el('span', { class: 'ptop__rank num', text: String(i + 1) }),
            el('span', { class: 'ptop__name', text: r.displayName || r.name || '' }),
            el('span', { class: 'ptop__team', text: r.teamName || '' }),
            el('span', { class: 'ptop__val num', text: String(r.goals ?? 0) })
          ])))
        : empty('射手榜整理中', '比賽開始後就會出現。'),
      el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => navigate('/stats')
      }, iconText('forward', '完整統計', { trailing: true }))
    );
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
      ])
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
        ])))
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

  return () => { venueMap.close(); disposed = true; closeRankingsToast?.(); stopTicker?.(); stopMatches?.(); dropBoard(); };
}

/** 與攤位共用活動時區及測試時間，賽前保留首日、賽後保留末日。 */
function todayInEvent() {
  return selectedActivityDate(activityTime(), EVENT.dates, EVENT.timezone);
}

export { todayInEvent, hhmm };
