/**
 * 賽務首頁
 * ------------------------------------------------------------------
 * 路由：#/staff
 * 規格：docs/04-功能規格-賽務裁判端.md §3
 *
 * 驗收條件 S01：登入後直接看到自己的場地與場次，**0 次額外點選**。
 * 場地由 staff.assignment 限定；日期預設跟隨今日，也可手動切換活動日期。
 */

import { divisionThemeAttrs } from '../../core/division-theme.js';
import { el, emptyState, toast, mount, sheet } from '../../core/ui.js';
import { iconText } from '../../core/icons.js';
import { hhmm, dateLabelFromYmd, STATUS_LABEL } from '../../lib/format.js';
import { staff, user, isPersistenceDegraded, can, isAdmin, onAuth, reloadIdentity } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { now } from '../../core/clock.js';
import { navigate } from '../../core/router.js';
import { watchMyMatches, getVenues } from './data.js';
import { syncIndicator } from './sync-indicator.js';
import { isOnline, subscribe as onSyncChange } from '../../core/sync.js';
import { EVENT } from '../../config.js';
import { selectedEventDate, eventDateAt } from '../../engine/staff-date.js';
import { readDateChoice, saveDateChoice } from './date-selection.js';

/** 現場最關心的那一場：進行中 > 檢錄中 > 下一場未開始 */
export function pickCurrent(matches, nowMs = Date.now()) {
  const live = matches.find(m => ['live', 'halftime'].includes(m.status));
  if (live) return live;
  const checkin = matches.find(m => ['checkin', 'ready'].includes(m.status));
  if (checkin) return checkin;
  const upcoming = matches
    .filter(m => m.status === 'scheduled')
    .sort((a, b) => msOf(a.kickoffAt) - msOf(b.kickoffAt));
  return upcoming[0] || null;
}

const msOf = v => (v?.toMillis ? v.toMillis() : Date.parse(v ?? '') || Number.MAX_SAFE_INTEGER);

const DONE = new Set(['finished', 'confirmed', 'walkover']);

export async function staffHome({ scope, view }) {
  let me = staff();
  const indicator = syncIndicator();
  const root = el('div', { class: 'staff' });
  mount(view, root);

  // 舊 assignment.date 不再綁定首頁；所有人都能查看活動的每個日期。
  let manualDate = readDateChoice(user()?.uid);
  let automaticDate = eventDateAt(now(), EVENT.dates, EVENT.timezone);
  let date = currentDate();
  let venueIds = isAdmin() ? [] : me?.assignment?.venueIds || [];
  let divisionIds = isAdmin() ? [] : me?.assignment?.divisionIds || [];

  let matches = [];
  let fromCache = false;
  let venueNames = {};
  let rendered = false;
  let disposed = false, stopMatches = null, generation = 0, loadError = null, refreshing = false;

  // 場地名稱只讀一次；讀不到就退回代碼，不要讓整頁失敗
  void loadVenues();
  async function loadVenues() {
    try {
      const vs = await getVenues();
      if (disposed) return;
      venueNames = Object.fromEntries(vs.map(v => [v.venueId, v.name || v.venueId])); render();
    } catch { /* fall back to venue IDs */ }
  }
  const venueLabel = id => venueNames[id] || id;

  // ⚠️ 連線狀態會在開頁後才穩定下來：
  //    Firestore 的第一筆快照來自本機快取，會讓 sync 先判定為離線，
  //    伺服器確認後才轉回線上。若不跟著重畫，開頁瞬間那則「你在離線」
  //    就會永遠掛在畫面上——實機上真的發生過。
  const offSync = onSyncChange(() => { if (rendered) { checkDate(); render(); } });
  const offAuth = onAuth(() => {
    if (disposed) return;
    me = staff();
    manualDate = readDateChoice(user()?.uid);
    date = currentDate();
    venueIds = isAdmin() ? [] : me?.assignment?.venueIds || [];
    divisionIds = isAdmin() ? [] : me?.assignment?.divisionIds || [];
    subscribeMatches();
  });
  // 手機背景可能暫停計時器，回到頁面時立即核對日期。
  let timer = setTimeout(tickDate, 1000);
  function tickDate() {
    checkDate();
    if (!disposed) timer = setTimeout(tickDate, 1000);
  }
  document.addEventListener('visibilitychange', checkDate);
  window.addEventListener('focus', checkDate);
  const dispose = hold(scope, () => {
    disposed = true; generation++;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', checkDate);
    window.removeEventListener('focus', checkDate);
    stopMatches?.(); offAuth(); offSync(); indicator.destroy();
  }, 'staff:date-lifecycle');

  function currentDate() {
    return selectedEventDate({ nowMs: now(), dates: EVENT.dates, timezone: EVENT.timezone, manualDate });
  }

  function checkDate() {
    if (disposed || !can('staff.access')) return;
    const nextAutomatic = eventDateAt(now(), EVENT.dates, EVENT.timezone);
    const automaticChanged = nextAutomatic !== automaticDate;
    automaticDate = nextAutomatic;
    const next = currentDate();
    if (next !== date) { date = next; subscribeMatches(); }
    else if (automaticChanged) render();
  }

  function selectDate(next) {
    manualDate = next;
    saveDateChoice(user()?.uid, next);
    date = currentDate();
    subscribeMatches();
  }

  function subscribeMatches() {
    stopMatches?.(); stopMatches = null;
    const request = ++generation;
    matches = []; fromCache = false; loadError = null;
    render();
    if (!can('staff.access')) return;
    stopMatches = watchMyMatches(scope, { date, venueIds, divisionIds }, (rows, meta) => {
      if (disposed || request !== generation) return;
      matches = rows; fromCache = meta?.fromCache === true; loadError = null; render();
    }, err => {
      if (disposed || request !== generation) return;
      loadError = err; render();
    });
  }

  async function refreshIdentity() {
    if (refreshing) return;
    refreshing = true; render();
    try { await reloadIdentity(); toast(can('staff.access') ? '已更新權限' : '目前沒有有效的賽務身分', can('staff.access') ? 'success' : 'warn'); }
    catch (err) { toast(err.message || '權限更新失敗，請稍後重試。', 'error'); }
    finally { refreshing = false; render(); }
  }

  function render() {
    if (disposed) return;
    rendered = true;
    if (!can('staff.access')) {
      mount(root, emptyState({ title: '沒有賽務台權限', note: '請主辦指派有效的賽務身分，或確認身分是否已停用。' }));
      return;
    }
    const current = pickCurrent(matches);
    mount(root,
      header(),
      dateTabs(),
      isPersistenceDegraded() ? degradedNotice() : null,
      // 只有「資料來自快取」且「確實離線」才提示。
      // 單看 fromCache 會在開頁那一瞬間閃一則假的離線警告，久了賽務就不信燈號了。
      (fromCache && !isOnline()) ? el('div', { class: 'notice notice--info' }, '目前顯示的是手機裡的資料，恢復連線後會自動更新。') : null,
      loadError ? emptyState({ title: '讀不到賽程', note: loadError.message, actionLabel: '重試', onAction: subscribeMatches })
        : el('div', { role: 'tabpanel', id: 'staff-matches', 'aria-label': `${shortDate(date)} 場次` }, [currentCard(current), listCard(), toolsBar()])
    );
  }

  function shortDate(ymd) { return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`; }

  function dateTabs() {
    const today = automaticDate;
    return el('section', { class: 'staff__dates', 'aria-label': '賽務日期' }, [
      el('div', { class: 'staff__dateTabs', role: 'tablist', 'aria-label': '切換賽務日期' }, EVENT.dates.map(ymd =>
        el('button', { type: 'button', role: 'tab', class: `btn${date === ymd ? ' btn--primary' : ''}`,
          'aria-selected': String(date === ymd), 'aria-controls': 'staff-matches', onClick: () => selectDate(ymd) }, shortDate(ymd)))),
      el('div', { class: 'staff__dateMode' }, [
        el('button', { type: 'button', class: 'btn btn--sm', 'aria-pressed': String(!manualDate), onClick: () => selectDate(null) }, `跟隨今日（${shortDate(today)}）`),
        el('span', { class: 'muted', text: manualDate ? '手動選擇日期' : '自動依台北日期切換' }),
        el('button', { type: 'button', class: 'btn btn--sm', disabled: refreshing, onClick: refreshIdentity }, refreshing ? '更新中…' : '更新權限')
      ])
    ]);
  }

  function header() {
    const line = [me?.name || user()?.displayName || '工作人員'];
    if (venueIds.length) line.push(venueIds.map(venueLabel).join('、'));
    if (divisionIds.length) line.push(divisionIds.join('、'));
    return el('div', { class: 'staff__head' }, [
      el('div', { class: 'staff__who' }, [
        el('strong', { text: line.join('　·　') }),
        el('span', { class: 'staff__date', text: `${dateLabelFromYmd(date)}　${EVENT.venueName}` })
      ]),
      indicator.node
    ]);
  }

  function degradedNotice() {
    return el('div', { class: 'notice notice--warn' }, [
      el('strong', { text: '離線佇列未啟用' }),
      el('span', { text: '這個瀏覽器不允許本機儲存（可能是無痕模式）。斷線時的記錄在關閉分頁後會遺失，請改用一般視窗。' })
    ]);
  }

  function currentCard(m) {
    if (!m) {
      return el('section', { class: 'card' }, [
        el('h2', { class: 'card__head', text: '目前場次' }),
        el('p', { class: 'muted', text: '所選日期沒有待進行的場次。' })
      ]);
    }
    return el('section', { class: 'card card--current division-card', ...divisionThemeAttrs(m.divisionId) }, [
      el('h2', { class: 'card__head' }, iconText('live', '目前場次')),
      el('div', { class: 'cur' }, [
        el('span', { class: 'cur__meta', text: `${m.label || m.matchId}　${hhmm(m.kickoffAt)}　${m.venueName || venueLabel(m.venueId) || ''}` }),
        el('div', { class: 'cur__teams' }, [
          el('span', { class: 'cur__team', text: m.home?.name || m.home?.displayName || '待定' }),
          el('span', { class: 'cur__vs num', text: DONE.has(m.status) || m.status === 'live' ? `${m.score?.home ?? 0} - ${m.score?.away ?? 0}` : 'vs' }),
          el('span', { class: 'cur__team', text: m.away?.name || m.away?.displayName || '待定' })
        ]),
        el('span', { class: 'cur__status', text: `狀態：${STATUS_LABEL[m.status] || m.status}` }),
        el('button', {
          class: 'btn btn--xl btn--primary', type: 'button',
          onClick: () => navigate(`/staff/match/${encodeURIComponent(m.matchId)}`)
        }, [...iconText('forward', '進入賽務台', { trailing: true })])
      ])
    ]);
  }

  function listCard() {
    if (!matches.length) {
      return el('section', { class: 'card' }, [
        el('h2', { class: 'card__head', text: manualDate ? `${shortDate(date)} 我的場次` : '今日我的場次' }),
        el('p', { class: 'muted', text: '這個日期沒有指派給你的場次。若不正確，請聯絡主辦確認你的指派設定。' })
      ]);
    }
    return el('section', { class: 'card' }, [
      el('h2', { class: 'card__head', text: `${manualDate ? `${shortDate(date)} 我的場次` : '今日我的場次'}（${matches.length}）` }),
      el('ul', { class: 'mlist' }, matches.map(m => el('li', { ...divisionThemeAttrs(m.divisionId), class: `mlist__item division-card ${DONE.has(m.status) ? 'is-done' : ''}` }, [
        el('button', {
          class: 'mlist__btn', type: 'button',
          onClick: () => openMatch(m)
        }, [
          // 狀態是 CSS 圓點（.dot[data-status]），不是 emoji：
          // 顏色要跟著主題走，而且 emoji 在各平台的形狀不一致
          el('span', { class: 'dot', dataset: { status: m.status || 'scheduled' }, 'aria-hidden': 'true' }),
          el('span', { class: 'mlist__time num', text: hhmm(m.kickoffAt) }),
          el('span', { class: 'mlist__label', text: m.label || m.matchId }),
          el('span', { class: 'mlist__teams', text: `${m.home?.name || '待定'} vs ${m.away?.name || '待定'}` }),
          el('span', { class: 'mlist__status', text: STATUS_LABEL[m.status] || m.status })
        ])
      ])))
    ]);
  }

  /**
   * 點清單裡的任一場：有檢錄或出場名單權限的人先選要做什麼，其他人直接進賽務台。
   *
   * 檢錄**沒有時間限制**：規章第十八條第 3 款是「賽前 30 分鐘檢錄」，但那是對球隊的要求，
   * 檢錄員可以提早把當天的場次一場一場做完。工具列的「檢錄」只開「目前這一場」，
   * 沒有這條路的話，其他場次只能自己打網址（主辦 2026-09-06 問的）。
   */
  async function openMatch(m) {
    const opts = [{ value: 'match', label: '賽務台', sub: '比分、事件、時鐘' }];
    if (can('checkin.write')) opts.push({ value: 'checkin', label: '檢錄', sub: '可以提早做，不必等這一場輪到' });
    if (can('matchsheet.write')) opts.push({ value: 'sheet', label: '出場名單', sub: '先發與替補' });
    let pick = 'match';
    if (opts.length > 1) {
      pick = await sheet({
        title: `${m.label || m.matchId}　${m.home?.name || '待定'} vs ${m.away?.name || '待定'}`,
        options: opts
      });
      if (!pick) return;
    }
    navigate(`/staff/${pick}/${encodeURIComponent(m.matchId)}`);
  }

  // 依權限畫按鈕（R-PERM-001）。攤位人員點「檢錄」只會進到「你沒有檢錄權限」——
  // 一顆按了會失敗的按鈕比沒有按鈕更糟（驗收 D-13）。
  function toolsBar() {
    const btns = [];
    if (can('checkin.write')) {
      btns.push(el('button', {
        class: 'btn btn--lg', type: 'button',
        onClick: () => {
          const m = pickCurrent(matches);
          if (!m) return toast('目前沒有可管理的場次。', 'warn');
          navigate(`/staff/checkin/${encodeURIComponent(m.matchId)}`);
        }
      }, [...iconText('list', '檢錄')]));
    }
    if (can('matchsheet.write')) {
      btns.push(el('button', {
        class: 'btn btn--lg', type: 'button',
        onClick: () => {
          const m = pickCurrent(matches);
          if (!m) return toast('目前沒有可管理的場次。', 'warn');
          navigate(`/staff/sheet/${encodeURIComponent(m.matchId)}`);
        }
      }, [...iconText('list', '出場名單')]));
    }
    if (!btns.length) return null;
    return el('div', { class: 'toolbar' }, btns);
  }

  return dispose;
}
