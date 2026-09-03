/**
 * 賽程頁 `#/schedule`
 * ------------------------------------------------------------------
 * 規格：docs/03-功能規格-公開端.md §3
 *
 * 篩選狀態寫進網址（`#/schedule?date=2026-10-09&division=u10`），
 * 這樣家長可以把「我孩子那組的賽程」直接貼進 LINE 群組——
 * 那是這一頁最常被使用的方式，比篩選器本身還重要。
 */

import { el, mount, skeleton } from '../../core/ui.js';
import { navigate } from '../../core/router.js';
import { startTicker, now } from '../../core/clock.js';
import { dateLabelFromYmd, hhmm } from '../../lib/format.js';
import { EVENT } from '../../config.js';
import * as data from './data.js';
import { filterMatches, filterToQuery, queryToFilter, groupBySlot } from './selectors.js';
import { matchRow, slotHeading, empty, pageHead, statusBadge } from './bits.js';

export async function publicSchedule({ scope, view, query }) {
  const root = el('div', { class: 'pub' });
  mount(view, root);

  const q = queryToFilter(query);
  const state = {
    date: q.date || firstDate(),
    divisionId: q.divisionId,
    venueId: q.venueId,
    matches: [],
    divisions: [],
    venues: [],
    loading: true,
    error: null
  };

  Promise.all([data.getDivisions(), data.getVenues()])
    .then(([ds, vs]) => { state.divisions = ds; state.venues = vs; render(); })
    .catch(() => { /* 篩選器少一半，清單仍然可用 */ });

  let stop = null;
  watch();
  const stopTicker = startTicker(() => paintMinutes(), 1000);
  render();

  function watch() {
    stop?.();
    state.loading = true;
    stop = data.watchMatchesByDate(scope, state.date, rows => {
      state.matches = rows;
      state.loading = false;
      state.error = null;
      render();
    }, err => {
      state.loading = false;
      state.error = err;
      render();
    });
  }

  function syncUrl() {
    const s = filterToQuery(state);
    // replace 而不是 push：篩選不該把「上一頁」塞滿
    location.replace(`#/schedule${s ? '?' + s : ''}`);
  }

  // ⚠️ 用具名函式而不是 const 箭頭：這兩個會被 render() 用到，而 render()
  //    可能在 watch() 的第一筆快照裡就被呼叫——那時候 const 還在 TDZ，
  //    會直接 ReferenceError 而整頁空白（E2E 抓到過）。函式宣告會被提升。
  function divisionOf(id) { return state.divisions.find(d => d.divisionId === id) || null; }
  function open(m) { navigate(`/match/${encodeURIComponent(m.matchId)}`); }

  function render() {
    const rows = filterMatches(state.matches, state);
    const groups = groupBySlot(rows, ms => hhmm(ms));

    mount(root,
      pageHead('賽程', { sub: dateLabelFromYmd(state.date), onBack: () => navigate('/') }),
      dateTabs(),
      filterBar(),
      state.error
        ? empty('載入失敗', state.error.message || '請稍後再試。',
            { label: '重新載入', onClick: () => location.reload() })
        : state.loading
          ? skeleton(5)
          : rows.length === 0
            ? empty('這個條件下沒有場次', '換個日期或組別看看。')
            : el('div', { class: 'psched' }, groups.flatMap(g => [
                slotHeading(g.label),
                el('ul', { class: 'plist' }, g.matches.map(m =>
                  matchRow({ match: m, onOpen: open, division: divisionOf(m.divisionId) })))
              ]))
    );
    paintMinutes();
  }

  function dateTabs() {
    return el('div', { class: 'ptabs', role: 'tablist', 'aria-label': '日期' },
      EVENT.dates.map(d => el('button', {
        class: `ptabs__btn ${d === state.date ? 'is-active' : ''}`,
        type: 'button', role: 'tab', 'aria-selected': d === state.date ? 'true' : 'false',
        onClick: () => { if (d === state.date) return; state.date = d; syncUrl(); watch(); render(); }
      }, dateLabelFromYmd(d))));
  }

  function filterBar() {
    const sel = (label, value, options, onPick) => el('select', {
      class: 'pfilter__sel', 'aria-label': label,
      onChange: e => { onPick(e.target.value || null); syncUrl(); render(); }
    }, [
      el('option', { value: '', selected: !value }, label),
      ...options.map(o => el('option', { value: o.value, selected: value === o.value }, o.label))
    ]);

    return el('div', { class: 'pfilter' }, [
      sel('全部組別', state.divisionId,
        state.divisions.map(d => ({ value: d.divisionId, label: d.name || d.divisionId })),
        v => { state.divisionId = v; }),
      sel('全部場地', state.venueId,
        state.venues.map(v => ({ value: v.venueId, label: v.name || v.venueId })),
        v => { state.venueId = v; }),
    ]);
  }

  function paintMinutes() {
    const byId = new Map(state.matches.filter(m => m?.matchId).map(m => [m.matchId, m]));
    for (const node of root.querySelectorAll('.prow[data-match-id]')) {
      const m = byId.get(node.dataset.matchId);
      if (!m || m.status !== 'live') continue;
      node.querySelector('.pbadge')?.replaceWith(
        statusBadge(m, divisionOf(m.divisionId)?.matchDurationMin ?? 30));
    }
  }

  return () => { stopTicker?.(); };
}

function firstDate() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: EVENT.timezone }).format(new Date());
  return EVENT.dates.includes(today) ? today : EVENT.dates[0];
}

export { now };
