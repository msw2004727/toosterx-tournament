/**
 * 公開端共用元件
 * ------------------------------------------------------------------
 * 規格：docs/03-功能規格-公開端.md §3.2、§5.2、§12.3、§12.5
 *
 * 每一頁都會用到的小塊：狀態徽章、比分列、時段標題、空狀態、
 * YouTube 的點擊才載入外框、關注星號、分享。
 *
 * R-UI-004：功能性 UI 一律 icon()/iconText()，狀態圓點用 .dot[data-status]。
 * R-CODE-002：隊名、球員名一律 textContent（el 的 text 屬性就是 textContent）。
 */

import { el, mount, toast } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { STATUS_LABEL, hhmm, displayMinute, scoreText } from '../../lib/format.js';
import { elapsedSec, now } from '../../core/clock.js';
import { isLiveMatch, isPlaceholder, sideLabel } from './selectors.js';

/* ── 狀態徽章（docs/03 §3.2）────────────────────────────── */

/**
 * 一場比賽現在該顯示什麼字。
 * 進行中顯示分鐘數（前端推算，不靠伺服器推播，docs/03 §2.3）。
 */
export function statusText(m, matchDurationMin = 30) {
  if (m?.status === 'live') {
    const sec = elapsedSec(m.clock, now());
    return displayMinute(sec, m.period, matchDurationMin) || STATUS_LABEL.live;
  }
  if (m?.status === 'halftime') return '中場';
  // docs/03 §3.2 寫的是「scheduled 顯示時間」，但那份表格假設徽章是唯一
  // 有時間的地方。實作上每一列左邊已經有開賽時間，徽章再印一次就是噪音，
  // 所以這裡改印狀態（未開始）。時間沒有消失，只是不重複。
  return STATUS_LABEL[m?.status] || m?.status || '';
}

/** 狀態徽章：**顏色一定伴隨文字**（docs/03 §12.5，色盲可及性） */
export function statusBadge(m, matchDurationMin = 30) {
  return el('span', { class: 'pbadge', dataset: { status: m?.status || 'scheduled' } }, [
    el('span', { class: 'dot', dataset: { status: m?.status || 'scheduled' }, 'aria-hidden': 'true' }),
    el('span', { class: 'pbadge__text', text: statusText(m, matchDurationMin) })
  ]);
}

/* ── 場次列（賽程頁與各處共用）──────────────────────────── */

/**
 * @param {object} o
 * @param {object} o.match
 * @param {Function} o.onOpen  點擊時進 LIVE 頁
 * @param {object} [o.division] 用來取 matchDurationMin 與仁慈規則
 */
export function matchRow({ match: m, onOpen, division }) {
  const dur = division?.matchDurationMin ?? 30;
  // ⚠️ 是 display.mercyRule，不是 division.mercyRule。
  // 寫錯路徑不會噴錯，只會讓仁慈規則永遠不生效——兒童組的 12:0 就這樣照實印出來。
  const sc = scoreText(m?.score, division?.display?.mercyRule);
  const started = isLiveMatch(m) || ['finished', 'confirmed', 'walkover'].includes(m?.status);

  const side = (key, align) => el('span', {
    class: `prow__team prow__team--${align}`,
    text: sideLabel(m, key)
  });

  const body = el('button', {
    class: 'prow__btn', type: 'button',
    'aria-label': `${sideLabel(m, 'home')} 對 ${sideLabel(m, 'away')}，${statusText(m, dur)}`,
    onClick: () => onOpen?.(m)
  }, [
    el('div', { class: 'prow__head' }, [
      el('span', { class: 'prow__time num', text: hhmm(m?.kickoffAt) }),
      el('span', { class: 'prow__meta', text: [m?.venueName || m?.venueId, m?.label].filter(Boolean).join('　·　') }),
      statusBadge(m, dur)
    ]),
    el('div', { class: 'prow__score' }, [
      side('home', 'home'),
      el('span', { class: 'prow__nums num' }, [
        el('span', { class: 'prow__num', text: started ? sc.home : '' }),
        el('span', { class: 'prow__dash', text: started ? '-' : 'vs' }),
        el('span', { class: 'prow__num', text: started ? sc.away : '' })
      ]),
      side('away', 'away')
    ]),
    sc.masked ? el('span', { class: 'prow__note', text: '兒童組比分達分差上限，以 7+ 顯示' }) : null
  ].filter(Boolean));

  return el('li', {
    class: `prow ${isPlaceholder(m) ? 'is-placeholder' : ''}`,
    // 每秒只換分鐘數而不重畫整列，靠這個 id 找回對應的節點
    dataset: { matchId: m?.matchId ?? '' }
  }, [body]);
}

/* ── 時段標題與空狀態 ───────────────────────────────────── */

export function slotHeading(label) {
  return el('h3', { class: 'pslot', text: label });
}

/** docs/03 §12.3：空狀態一律有話說，不留白畫面 */
export function empty(title, note, action) {
  return el('div', { class: 'empty' }, [
    el('p', { class: 'empty__title', text: title }),
    note ? el('p', { class: 'empty__note', text: note }) : null,
    action ? el('button', { class: 'btn btn--primary', type: 'button', onClick: action.onClick }, action.label) : null
  ].filter(Boolean));
}

/**
 * 區塊卡片。footer 放「看完整賽程 →」這類延伸動作——
 * 放進 <h2> 裡雖然畫得出來，但標題裡塞一顆按鈕對螢幕閱讀器是噪音。
 */
export function sectionCard(title, iconName, children, footer) {
  return el('section', { class: 'pcard' }, [
    el('h2', { class: 'pcard__head' },
      iconName ? iconText(iconName, title) : [el('span', { text: title })]),
    ...[].concat(children).filter(Boolean),
    footer ? el('div', { class: 'pcard__foot' }, footer) : null
  ].filter(Boolean));
}

/* ── YouTube（docs/03 §5.2：點擊才載入）─────────────────── */

/**
 * 播放器外框。**預設不載入 iframe**，先畫一張佔位卡，點了才插入。
 *
 * 理由（規格 §5.2）：同一頁可能有好幾個播放器（直播牆），
 * 全部預先載入會讓中階 Android 直接卡死，而且吃掉家長的行動網路。
 *
 * 同一時間只允許一個在播：插入新的之前先把別人的收掉。
 */
const openFrames = new Set();

export function videoFacade(url, { title = 'FEDA CUP 直播', poster } = {}) {
  const wrap = el('div', { class: 'video' });

  if (!url) {
    mount(wrap, el('div', { class: 'video__off' }, [
      icon('info'),
      el('span', { text: '這個場地目前沒有直播' })
    ]));
    return wrap;
  }

  const play = () => {
    // 行動裝置同時播兩個以上會卡到不能操作，所以先收掉其他人的
    for (const other of [...openFrames]) { if (other !== wrap) closeFrame(other); }
    const frame = document.createElement('iframe');
    frame.src = url;
    frame.title = title;
    frame.loading = 'lazy';
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    mount(wrap, frame);
    openFrames.add(wrap);
  };

  mount(wrap, el('button', {
    class: 'video__poster', type: 'button', 'aria-label': `播放${title}`, onClick: play
  }, [
    poster ? el('img', { src: poster, alt: '', loading: 'lazy' }) : null,
    el('span', { class: 'video__play' }, icon('play')),
    el('span', { class: 'video__hint', text: '點擊播放' })
  ].filter(Boolean)));

  wrap.__play = play;
  return wrap;
}

function closeFrame(wrap) {
  openFrames.delete(wrap);
  const btn = el('button', {
    class: 'video__poster', type: 'button', 'aria-label': '播放', onClick: () => wrap.__play?.()
  }, [
    el('span', { class: 'video__play' }, icon('play')),
    el('span', { class: 'video__hint', text: '點擊播放' })
  ]);
  mount(wrap, btn);
}

/** 換頁時把所有播放器收掉，否則 iframe 會在背景繼續跑 */
export function stopAllVideos() {
  for (const w of [...openFrames]) closeFrame(w);
  openFrames.clear();
}

/* ── 分享（docs/03 §12.2）───────────────────────────────── */

export async function share(text, url) {
  try {
    if (navigator.share) { await navigator.share({ text, url }); return; }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('已複製連結。', 'success');
  } catch (err) {
    if (err?.name === 'AbortError') return;      // 使用者自己取消，不是錯誤
    toast('這個瀏覽器不支援分享，請直接複製網址列。', 'warn');
  }
}

export function shareButton(text, url) {
  return el('button', {
    class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => share(text, url)
  }, iconText('forward', '分享'));
}

/* ── 頁首 ───────────────────────────────────────────────── */

export function pageHead(title, { sub, onBack } = {}) {
  return el('div', { class: 'phead' }, [
    onBack ? el('button', {
      class: 'phead__back', type: 'button', 'aria-label': '返回', onClick: onBack
    }, icon('back')) : null,
    el('div', { class: 'phead__title' }, [
      el('strong', { text: title }),
      sub ? el('span', { class: 'phead__sub', text: sub }) : null
    ].filter(Boolean))
  ].filter(Boolean));
}
