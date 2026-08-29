/**
 * 賽務首頁
 * ------------------------------------------------------------------
 * 路由：#/staff
 * 規格：docs/04-功能規格-賽務裁判端.md §3
 *
 * 驗收條件 S01：登入後直接看到自己的場地與場次，**0 次額外點選**。
 * 所以這頁不做任何篩選器——staff.assignment 就是篩選條件。
 */

import { el, emptyState, toast, mount } from '../../core/ui.js';
import { hhmm, dateLabelFromYmd, STATUS_LABEL } from '../../lib/format.js';
import { staff, user, isPersistenceDegraded } from '../../core/firebase.js';
import { navigate } from '../../core/router.js';
import { watchMyMatches, getVenues } from './data.js';
import { syncIndicator } from './sync-indicator.js';
import { isOnline } from '../../core/sync.js';
import { EVENT } from '../../config.js';

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
const STATUS_DOT = {
  confirmed: '✅', finished: '✅', walkover: '✅',
  live: '🔴', halftime: '🟠', checkin: '🔵', ready: '🔵',
  scheduled: '⚪', postponed: '⏸', cancelled: '✖'
};

export async function staffHome({ scope, view }) {
  const me = staff();
  const indicator = syncIndicator();
  const root = el('div', { class: 'staff' });
  view.replaceChildren(root);

  // 沒有指派日期時用活動第一天；三日活動由 assignment.date 決定今天負責哪一天
  const date = me?.assignment?.date || todayInEvent();
  const venueIds = me?.assignment?.venueIds || [];
  const divisionIds = me?.assignment?.divisionIds || [];

  let matches = [];
  let fromCache = false;
  let venueNames = {};

  // 場地名稱只讀一次；讀不到就退回代碼，不要讓整頁失敗
  getVenues()
    .then(vs => { venueNames = Object.fromEntries(vs.map(v => [v.venueId, v.name || v.venueId])); render(); })
    .catch(() => {});
  const venueLabel = id => venueNames[id] || id;

  watchMyMatches(scope, { date, venueIds, divisionIds }, (rows, meta) => {
    matches = rows;
    fromCache = meta?.fromCache === true;
    render();
  }, err => {
    console.error('[staff] matches', err);
    mount(root, header(), emptyState({
      title: '讀不到賽程',
      note: err.code === 'permission-denied'
        ? '你的帳號可能還沒被指派為工作人員，請聯絡主辦。'
        : err.message
    }));
  });

  render();

  function render() {
    const current = pickCurrent(matches);
    mount(root,
      header(),
      isPersistenceDegraded() ? degradedNotice() : null,
      // 只有「資料來自快取」且「確實離線」才提示。
      // 單看 fromCache 會在開頁那一瞬間閃一則假的離線警告，久了賽務就不信燈號了。
      (fromCache && !isOnline()) ? el('div', { class: 'notice notice--info' }, '目前顯示的是手機裡的資料，恢復連線後會自動更新。') : null,
      currentCard(current),
      listCard(),
      toolsBar()
    );
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
        el('p', { class: 'muted', text: '今天沒有待進行的場次。' })
      ]);
    }
    return el('section', { class: 'card card--current' }, [
      el('h2', { class: 'card__head', text: '⚡ 目前場次' }),
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
        }, '進入賽務台 →')
      ])
    ]);
  }

  function listCard() {
    if (!matches.length) {
      return el('section', { class: 'card' }, [
        el('h2', { class: 'card__head', text: '今日我的場次' }),
        el('p', { class: 'muted', text: '這個日期沒有指派給你的場次。若不正確，請聯絡主辦確認你的指派設定。' })
      ]);
    }
    return el('section', { class: 'card' }, [
      el('h2', { class: 'card__head', text: `今日我的場次（${matches.length}）` }),
      el('ul', { class: 'mlist' }, matches.map(m => el('li', { class: `mlist__item ${DONE.has(m.status) ? 'is-done' : ''}` }, [
        el('button', {
          class: 'mlist__btn', type: 'button',
          onClick: () => navigate(`/staff/match/${encodeURIComponent(m.matchId)}`)
        }, [
          el('span', { class: 'mlist__dot', 'aria-hidden': 'true', text: STATUS_DOT[m.status] || '⚪' }),
          el('span', { class: 'mlist__time num', text: hhmm(m.kickoffAt) }),
          el('span', { class: 'mlist__label', text: m.label || m.matchId }),
          el('span', { class: 'mlist__teams', text: `${m.home?.name || '待定'} vs ${m.away?.name || '待定'}` }),
          el('span', { class: 'mlist__status', text: STATUS_LABEL[m.status] || m.status })
        ])
      ])))
    ]);
  }

  function toolsBar() {
    return el('div', { class: 'toolbar' }, [
      el('button', {
        class: 'btn btn--lg', type: 'button',
        onClick: () => toast('QR 檢錄在 M5 開放。目前可先用「出場名單」手動確認。', 'warn')
      }, '📷 檢錄掃碼'),
      el('button', {
        class: 'btn btn--lg', type: 'button',
        onClick: () => {
          const m = pickCurrent(matches);
          if (!m) return toast('目前沒有可管理的場次。', 'warn');
          navigate(`/staff/sheet/${encodeURIComponent(m.matchId)}`);
        }
      }, '📋 出場名單')
    ]);
  }

  return () => indicator.destroy();
}

/** 活動期間就用今天，否則落在活動第一天（賽前試用不會看到空畫面） */
function todayInEvent() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
  return EVENT.dates.includes(today) ? today : EVENT.dates[0];
}
