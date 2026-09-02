/**
 * 主題：系統／淺色／深色 三態
 * ------------------------------------------------------------------
 * 規格：docs/10-報名與球隊管理.md §7
 *
 * 兩層概念，不要混在一起：
 *   偏好 preference  'system' | 'light' | 'dark'   ← 使用者選的，存 localStorage
 *   實際 resolved    'light'  | 'dark'             ← 真正寫進 <html data-theme>
 *
 * FC 只有兩態：一旦按過切換就永遠被釘住，系統改回淺色它還是深色。
 * 這裡多一個 'system'，而且是**預設值**——大多數人根本不會去動它，
 * 跟著手機的日夜模式走才是對的行為。
 *
 * ⚠️ 這個檔案不負責首屏。首屏由 index.html 的 inline script 處理，
 *    否則會先閃一下白色再變深色。兩邊必須用同一組 KEY 與同一套解析邏輯，
 *    tests/unit/theme.test.js 有一條案例會去讀 index.html 對照。
 */

import { icon } from './icons.js';

export const THEME_KEY = 'feda_theme';
export const THEME_PREFS = ['system', 'light', 'dark'];

const LABEL = { system: '跟隨系統', light: '淺色', dark: '深色' };
const ICON = { system: 'theme-system', light: 'theme-light', dark: 'theme-dark' };

/** 瀏覽器分頁顏色（Android Chrome 的網址列）。跟著主題換，不然會很突兀。 */
const META_COLOR = { light: '#F1F5F3', dark: '#0C1210' };

/* ── 純函式（可單獨測試，不碰 DOM）─────────────────── */

/** 使用者偏好 + 系統偏好 → 實際主題 */
export function resolveTheme(pref, prefersDark) {
  if (pref === 'light' || pref === 'dark') return pref;
  return prefersDark ? 'dark' : 'light';
}

/** 把 localStorage 讀到的任何東西正規化成合法偏好值 */
export function normalizePref(raw) {
  return THEME_PREFS.includes(raw) ? raw : 'system';
}

/* ── 與環境互動 ─────────────────────────────────────── */

function readPref() {
  try {
    return normalizePref(localStorage.getItem(THEME_KEY));
  } catch {
    // 無痕模式／封鎖 storage：當作沒設定過，跟隨系統
    return 'system';
  }
}

function writePref(pref) {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch { /* 存不進去就算了，這一輪仍然生效 */ }
}

function mediaQuery() {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
  } catch {
    return null;
  }
}

function applyResolved(resolved) {
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_COLOR[resolved]);
}

/* ── 對外 ───────────────────────────────────────────── */

const listeners = new Set();
let current = 'system';

export function getPref() { return current; }

export function getResolved() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setPref(pref) {
  current = normalizePref(pref);
  writePref(current);
  applyResolved(resolveTheme(current, !!mediaQuery()?.matches));
  for (const fn of listeners) fn(current, getResolved());
}

/** 訂閱變化（切換元件自己重繪用）。回傳取消訂閱函式。 */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initTheme() {
  current = readPref();
  const mq = mediaQuery();
  applyResolved(resolveTheme(current, !!mq?.matches));

  // 系統日夜模式變了，只有在「跟隨系統」時才跟著動
  mq?.addEventListener?.('change', e => {
    if (current !== 'system') return;
    applyResolved(resolveTheme(current, e.matches));
    for (const fn of listeners) fn(current, getResolved());
  });

  // 另一個分頁改了偏好，這個分頁也要跟上（賽務常同時開好幾個分頁）
  window.addEventListener?.('storage', e => {
    if (e.key !== THEME_KEY) return;
    current = normalizePref(e.newValue);
    applyResolved(resolveTheme(current, !!mediaQuery()?.matches));
    for (const fn of listeners) fn(current, getResolved());
  });

  return current;
}

/**
 * 三態切換元件（分段控制）。
 * 用 radiogroup 而不是三顆 button：螢幕閱讀器會念出「三選一，目前第 1 項」。
 */
export function themeSwitch() {
  const wrap = document.createElement('div');
  wrap.className = 'theme-switch';
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', '主題');

  const btns = THEME_PREFS.map(pref => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-switch__opt';
    b.dataset.pref = pref;
    b.setAttribute('role', 'radio');
    b.title = LABEL[pref];
    b.append(icon(ICON[pref]));
    const label = document.createElement('span');
    label.className = 'theme-switch__label';
    label.textContent = LABEL[pref];
    b.append(label);
    b.addEventListener('click', () => setPref(pref));
    return b;
  });

  let off = () => {};
  const sync = () => {
    // 已經被換頁拔掉了就自己退訂，不然每換一次頁就多留一個閉包
    if (wrap.isConnected === false && wrap.dataset.mounted === '1') { off(); return; }
    if (wrap.isConnected) wrap.dataset.mounted = '1';
    for (const b of btns) {
      const on = b.dataset.pref === current;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
  };

  wrap.append(...btns);
  sync();
  off = onThemeChange(sync);
  wrap.destroy = off;          // 呼叫端若能明確回收就用這個，別依賴上面的自癒
  return wrap;
}
