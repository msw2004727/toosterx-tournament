/**
 * 圖示
 * ------------------------------------------------------------------
 * 規格：docs/08 §2.5、docs/10 §7
 *
 * 為什麼不用 emoji：
 *   1. 每個平台長得都不一樣。🟨 在 Android 是圓角、iOS 是方角、Windows 有邊框，
 *      裁判要在陽光下一眼分辨黃紅牌，這種差異不能接受。
 *   2. 顏色寫死在字型裡，深色主題下 ⚪ 會整顆消失在白底、🔴 在深底過亮。
 *   3. 字級一大就糊，⚽ 在 28px 以上會看到 emoji 字型的點陣邊緣。
 *   4. 螢幕閱讀器會把 ⚽ 念成「足球」混在句子裡。
 *
 * 全部 24×24、stroke=currentColor、fill=none，所以顏色一律由 CSS 決定，
 * 主題切換不需要換圖。sprite 直接內嵌在 JS 裡而不是外部 icons.svg：
 * 外部檔要多一次請求，而且 <use href="外部檔#id"> 在 file:// 與 E2E 的
 * 假環境下都拿不到；內嵌只有約 4KB，跟著模組一起帶版號（R-REL-015）。
 */

const P = {
  /* 賽事 */
  goal:        '<circle cx="12" cy="12" r="9"/><path d="m12 6.6 5.2 3.8-2 6.1H8.8l-2-6.1z"/>',
  card:        '<rect x="7" y="2.5" width="10" height="19" rx="2"/>',
  sub:         '<path d="M4 8.5h11m-3-3 3 3-3 3"/><path d="M20 15.5H9m3 3-3-3 3-3"/>',
  injury:      '<path d="M12 5.5v13M5.5 12h13"/>',
  note:        '<path d="M4 20.5h4L19.2 9.3a2.1 2.1 0 0 0-3-3L5 17.5z"/>',
  whistle:     '<path d="M13 8h7.5a1.5 1.5 0 0 1 0 3H13"/><circle cx="7.5" cy="13.5" r="5"/>',

  /* 時鐘與流程 */
  play:        '<path d="M8 5.2v13.6L19 12z"/>',
  pause:       '<path d="M9.5 5v14M14.5 5v14"/>',
  stop:        '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  clock:       '<circle cx="12" cy="12" r="9"/><path d="M12 6.8v5.4l3.4 2"/>',
  undo:        '<path d="M4.5 9h10.5a5 5 0 0 1 0 10H9"/><path d="m8.5 4.5-4 4.5 4 4.5"/>',

  /* 狀態 */
  check:       '<path d="m4.5 12.5 5 5.2L19.5 6.5"/>',
  warn:        '<path d="M12 3.2 2.6 20.3h18.8z"/><path d="M12 10v4.2"/><circle cx="12" cy="17.4" r=".9" fill="currentColor" stroke="none"/>',
  close:       '<path d="m6 6 12 12M18 6 6 18"/>',
  retry:       '<path d="M20.2 12a8.2 8.2 0 1 1-2.7-6.1"/><path d="M20.5 3.8v5.4h-5.4"/>',
  info:        '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none"/>',
  live:        '<circle cx="12" cy="12" r="2.8"/><path d="M6.6 6.6a7.6 7.6 0 0 0 0 10.8M17.4 6.6a7.6 7.6 0 0 1 0 10.8"/>',

  /* 導覽 */
  home:        '<path d="M4 10.4 12 3.6l8 6.8V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  back:        '<path d="m14.5 5-7 7 7 7"/>',
  forward:     '<path d="M4.5 12h15m-6-6 6 6-6 6"/>',
  up:          '<path d="M12 20V5m-6 6 6-6 6 6"/>',
  down:        '<path d="M12 4v15m-6-6 6 6 6-6"/>',
  more:        '<circle cx="12" cy="5.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.6" fill="currentColor" stroke="none"/>',

  /* 功能 */
  qr:          '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3.2v3.2H14zM20.8 14v3.2M14 20.8h3.2M20.8 20.6v.2"/>',
  list:        '<path d="M8.5 6h12M8.5 12h12M8.5 18h12"/><circle cx="4" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.1" fill="currentColor" stroke="none"/>',
  person:      '<circle cx="12" cy="8" r="3.6"/><path d="M4.6 20.2a7.4 7.4 0 0 1 14.8 0"/>',
  team:        '<circle cx="9" cy="8.4" r="3.2"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><path d="M16.2 6a3.2 3.2 0 0 1 0 6M17.6 14.6a6.2 6.2 0 0 1 3.6 5.4"/>',
  table:       '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 9.5h18M9 9.5V19.5"/>',
  // 抽獎券：一張票，中間有一道撕線的凹口。
  // ⚠️ 不畫禮物盒——那是「獎品」不是「資格」，而這一格顯示的是張數。
  ticket:      '<path d="M2.8 7.2h18.4v3.4a1.4 1.4 0 0 0 0 2.8v3.4H2.8v-3.4a1.4 1.4 0 0 0 0-2.8z"/>'
             + '<path d="M9.4 7.2v1.6M9.4 11.2v1.6M9.4 15.2v1.6"/>',
  // 抽籤（規章第十九條第 5 順位）：兩條交叉的線＋箭頭，也就是「換位」。
  // ⚠️ 不畫骰子：骰子的意思是「隨機」，而這裡的抽籤是**可重放**的
  //    （種子會被記下來），畫成骰子會讓主辦以為系統在亂決定。
  shuffle:     '<path d="M3 6.4h3.4l11.2 11.2h3.4M3 17.6h3.4L17.6 6.4H21"/>'
             + '<path d="m18.2 3.6 3 2.8-3 2.8M18.2 14.8l3 2.8-3 2.8"/>',

  /* 安裝（PWA） */
  install:     '<path d="M12 3.5v11m-4.2-4.2L12 14.5l4.2-4.2"/><path d="M4.5 16.5v2.2a1.8 1.8 0 0 0 1.8 1.8h11.4a1.8 1.8 0 0 0 1.8-1.8v-2.2"/>',
  share:       '<path d="M12 15.5V4m-3.4 3.4L12 4l3.4 3.4"/><path d="M6.5 11H5.3a1.8 1.8 0 0 0-1.8 1.8v6.4A1.8 1.8 0 0 0 5.3 21h13.4a1.8 1.8 0 0 0 1.8-1.8v-6.4a1.8 1.8 0 0 0-1.8-1.8h-1.2"/>',

  /* 挑戰區五關（docs/06 §3）
     規格書上是 emoji（🎯🦘🎪⚡），這裡一律改畫成線條圖（R-UI-004）。
     每一個都照那一關**實際的計分結構**畫，而不是找一個相關的物件：
     九宮格是格子、停球王是同心區、頭球量的是高度、球速王是速度。
     攤位工作人員整天只看自己那一關，圖示要在 1em 下一眼認得出來。 */
  // 九宮格射門：3×3 的格子（右上角那一格標成命中）
  target:      '<rect x="3.2" y="5.2" width="17.6" height="13.6" rx="1"/>'
             + '<path d="M9.1 5.2v13.6M14.9 5.2v13.6M3.2 9.7h17.6M3.2 14.3h17.6"/>'
             + '<circle cx="17.9" cy="7.5" r="1.15" fill="currentColor" stroke="none"/>',
  // C羅高空頭球：一級一級往上的階梯（＝這一關的 inputMode: 'ladder'），球在最高一級。
  // ⚠️ 別畫成「頭＋肩」：任何「圓形＋下方弧線」都會被讀成 person 圖示，
  //    我先畫了三個版本才發現，三個都變成人（2026-09-05 實際比對過）。
  ladder:      '<circle cx="17.8" cy="7.4" r="2.6"/><path d="M2.8 21.2h5v-5h5v-5h5"/>',
  // Ronaldinho 橫樑：球門的 Π 形框，球在框內。
  // ⚠️ 球放在橫樑「上方」的話整個圖會變成一張桌子，跟既有的 table 撞在一起。
  crossbar:    '<path d="M2.6 7.4h18.8"/><path d="M4 7.4V19.8M20 7.4V19.8"/>'
             + '<circle cx="12" cy="12.6" r="3.1"/>',
  // 足球球速王：球＋速度線
  speed:       '<circle cx="14.8" cy="12" r="5.4"/><path d="M2.2 8.4h5.2M1.2 12h4.2M2.2 15.6h5.2"/>',
  // 停球王：同心區（完美區／控制區／外圍），對應這一關的計分結構
  'first-touch': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.8"/>'
             + '<circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',

  /* 主題 */
  'theme-light':  '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.1M12 19.3v2.1M4.6 4.6 6.1 6.1M17.9 17.9l1.5 1.5M2.6 12h2.1M19.3 12h2.1M4.6 19.4 6.1 17.9M17.9 6.1l1.5-1.5"/>',
  'theme-dark':   '<path d="M20.3 14.8A8.6 8.6 0 0 1 9.2 3.7a8.6 8.6 0 1 0 11.1 11.1z"/>',
  'theme-system': '<rect x="2.8" y="4" width="18.4" height="12.4" rx="2"/><path d="M8 20.4h8M12 16.4v4"/>'
};

export const ICON_NAMES = Object.keys(P);

const SPRITE_ID = 'icon-sprite';
let injected = false;

/** 把 symbol 表塞進文件（只做一次）。icon() 會自動呼叫。 */
export function injectSprite(doc = globalThis.document) {
  if (injected || !doc?.body) return;
  if (doc.getElementById(SPRITE_ID)) { injected = true; return; }

  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = SPRITE_ID;
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  // 這裡的內容全部是本檔案的常數，沒有任何使用者輸入，innerHTML 是安全的
  svg.innerHTML = Object.entries(P).map(([name, d]) => (
    `<symbol id="i-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor"` +
    ` stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</symbol>`
  )).join('');

  doc.body.prepend(svg);
  injected = true;
}

/**
 * 產生一個圖示節點。
 *
 * @param {string} name       ICON_NAMES 之一
 * @param {object} [opts]
 * @param {string} [opts.cls] 額外 class
 * @param {string} [opts.label] 有值時圖示自己帶語意（單獨當按鈕內容時用）；
 *                              預設 aria-hidden，因為旁邊通常已經有文字了
 */
export function icon(name, opts = {}) {
  if (!P[name]) {
    // 靜默退回會讓打錯的名字永遠不被發現，現場才看到空白
    console.warn('[icons] 沒有這個圖示：', name);
  }
  injectSprite();

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', ['icon', opts.cls].filter(Boolean).join(' '));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '1em');
  svg.setAttribute('height', '1em');
  svg.setAttribute('focusable', 'false');

  if (opts.label) {
    svg.setAttribute('role', 'img');
    const title = document.createElementNS(NS, 'title');
    title.textContent = opts.label;
    svg.append(title);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }

  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/**
 * 圖示 + 文字，回傳可直接丟進 mount()／el() 的陣列。
 * 按鈕內容一律用這個，才不會有人又把 emoji 串進字串裡。
 *
 * @param {object} [opts]
 * @param {boolean} [opts.trailing] 圖示放在文字後面（「進入賽務台 →」這種）
 */
export function iconText(name, text, opts = {}) {
  const span = document.createElement('span');
  span.textContent = text;
  const ic = icon(name, opts);
  return opts.trailing ? [span, ic] : [ic, span];
}

/** 測試用：讓下一次 icon() 重新注入 sprite */
export function _resetSprite() { injected = false; }
