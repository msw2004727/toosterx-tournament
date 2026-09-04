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

import { el, mount, skeleton } from '../../core/ui.js';
import { navigate } from '../../core/router.js';
import { iconText } from '../../core/icons.js';
import { startTicker, now } from '../../core/clock.js';
import { dateLabelFromYmd, hhmm } from '../../lib/format.js';
import { EVENT } from '../../config.js';
import * as data from './data.js';
import { splitHomeSections, isLiveMatch, hiddenScorerDivisions, publishedMatches } from './selectors.js';
import { matchRow, sectionCard, empty, pageHead, statusBadge } from './bits.js';

export async function publicHome({ scope, view, query }) {
  const root = el('div', { class: 'pub' });
  mount(view, root);

  const state = {
    date: query?.get('date') || todayInEvent(),
    matches: [],
    divisions: [],
    board: null,
    boardMissing: false,
    scorers: null,
    featureFlags: {},
    loading: true
  };

  // 組別清單一次性讀取，用來畫「各組即時排名」入口與取得 matchDurationMin
  data.getDivisions()
    .then(ds => { state.divisions = ds; render(); })
    .catch(() => { /* 讀不到就少一個區塊，不影響比分 */ });

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
    if (board) {
      state.board = board;
      state.boardMissing = false;
      state.loading = false;
      render();
      return;
    }
    // 看板不存在 → 換成監聽當日場次（同樣只有 1 個監聽，先收掉看板那個）
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
    stopMatches?.();
    stopMatches = data.watchMatchesByDate(scope, state.date, rows => {
      state.matches = rows;
      state.loading = false;
      render();
    }, err => {
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
  const stopTicker = startTicker(() => paintMinutes(), 1000);

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
    if (state.loading) { mount(root, pageHead(EVENT.name, { sub: EVENT.slogan }), skeleton(4)); return; }
    const { live, next, done } = sections();

    mount(root,
      pageHead(EVENT.name, { sub: `${EVENT.slogan}　·　${EVENT.venueName}` }),
      dateTabs(),

      // 只在真的有進行中場次時才出現（§2.3）
      live.length ? sectionCard('現在進行中', 'live',
        el('ul', { class: 'plist plist--live' }, live.map(m =>
          // 首頁不放關注：這一頁最擠，而且這裡的主要動作是「點進去看比分」。
          // 關注放在賽程頁與比賽頁，那裡有空間也比較是「整理自己清單」的情境。
          matchRow({ match: m, onOpen: open, division: divisionOf(m.divisionId) })))
      ) : null,

      sectionCard('接下來', 'clock',
        next.length
          ? el('ul', { class: 'plist' }, next.map(m =>
              matchRow({ match: m, onOpen: open, division: divisionOf(m.divisionId) })))
          : empty('這個日期沒有待進行的場次', '換一個日期看看，或看完整賽程。'),
        el('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          onClick: () => navigate(`/schedule?date=${encodeURIComponent(state.date)}`)
        }, iconText('forward', '看完整賽程', { trailing: true }))
      ),

      done.length ? sectionCard('剛結束', 'check',
        el('ul', { class: 'plist' }, done.map(m =>
          matchRow({ match: m, onOpen: open, division: divisionOf(m.divisionId) })))
      ) : null,

      state.divisions.length ? sectionCard('各組即時排名', 'table',
        el('div', { class: 'pchips' }, state.divisions.map(d =>
          el('button', {
            class: 'chip', type: 'button',
            onClick: () => navigate(`/division/${encodeURIComponent(d.divisionId)}`)
          }, d.name || d.divisionId)))
      ) : null,

      scorerCard(),
      sponsorCard()
    );
    paintMinutes();
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
        ? el('ol', { class: 'ptop' }, rows.map((r, i) => el('li', { class: 'ptop__row' }, [
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

  function sponsorCard() {
    return el('section', { class: 'psponsor' }, [
      el('span', { class: 'psponsor__label', text: '贊助合作夥伴' }),
      el('span', { class: 'psponsor__name', text: '台灣美津濃股份有限公司' })
    ]);
  }

  function dateTabs() {
    return el('div', { class: 'ptabs', role: 'tablist', 'aria-label': '日期' },
      EVENT.dates.map(d => el('button', {
        class: `ptabs__btn ${d === state.date ? 'is-active' : ''}`,
        type: 'button', role: 'tab', 'aria-selected': d === state.date ? 'true' : 'false',
        onClick: () => {
          if (d === state.date) return;
          state.date = d;
          if (state.boardMissing) startMatchFallback(); else render();
          render();
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
        statusBadge(m, divisionOf(m.divisionId)?.matchDurationMin ?? 30));
    }
  }

  return () => { stopTicker?.(); };
}

/** 活動期間就用今天，否則落在活動第一天（賽前預覽不會看到空畫面） */
function todayInEvent() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: EVENT.timezone }).format(new Date());
  return EVENT.dates.includes(today) ? today : EVENT.dates[0];
}

export { todayInEvent, hhmm };
