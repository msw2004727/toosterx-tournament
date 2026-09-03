/**
 * 安裝到裝置（PWA）
 * ------------------------------------------------------------------
 * 規格：docs/08 §1.3
 *
 * 「安裝」在三種環境下是三件完全不同的事，而且**只有一種**有 API：
 *
 * | 環境                       | 有 beforeinstallprompt？ | 我們怎麼做 |
 * |---------------------------|-------------------------|-----------|
 * | Android Chrome／桌面 Chrome | 有                       | 叫原生安裝對話框 |
 * | iOS Safari                 | 沒有，永遠不會有            | 教使用者「分享 → 加入主畫面」 |
 * | LINE／FB 內建瀏覽器          | 沒有，而且**根本裝不了**     | 教使用者改用外部瀏覽器開 |
 *
 * 第三種對這個專案特別重要：報名的家長是從 LINE 點連結進來的，
 * 預設就在 LINE 的內建瀏覽器裡。在那裡畫一顆按了沒反應的「安裝」，
 * 就是「按了沒反應」這種最難回報的故障。
 *
 * ⚠️ `beforeinstallprompt` 會在**模組載入之前**就派發（Chrome 通常在
 *    首次繪製前後）。所以真正的攔截寫在 index.html 的 inline script 裡，
 *    存到 window.__fedaInstall；這支只是接手。少了那一段，這顆按鈕
 *    在多數情況下永遠不會出現。
 */

import { el } from './ui.js';
import { icon } from './icons.js';

const listeners = new Set();
const emit = () => { for (const fn of listeners) { try { fn(); } catch { /* 單一訂閱者壞掉不影響其他人 */ } } };

/** @returns {() => void} 取消訂閱 */
export function onInstallableChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── 環境判斷 ─────────────────────────────────────────────────

const ua = () => navigator.userAgent || '';

export function isStandalone() {
  // iOS Safari 用的是非標準的 navigator.standalone，兩個都要看
  return window.matchMedia?.('(display-mode: standalone)')?.matches === true
    || window.navigator.standalone === true;
}

export function isIos() {
  if (/iphone|ipad|ipod/i.test(ua())) return true;
  // iPadOS 13 之後預設回報成 Mac，只能靠有沒有觸控來分辨
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

/** LINE／Facebook／Instagram 的內建瀏覽器：裝不了 PWA，也沒有分享到主畫面 */
export function isInAppBrowser() {
  return /\bLine\/|FBAN|FBAV|Instagram/i.test(ua());
}

// ── 狀態 ─────────────────────────────────────────────────────

/** window.__fedaInstall 由 index.html 建立；沒有的話（測試、舊快取）自己補一個 */
function bucket() {
  const w = window;
  if (!w.__fedaInstall) w.__fedaInstall = { deferred: null, installed: false };
  return w.__fedaInstall;
}

/**
 * @returns {{installed:boolean, canInstall:boolean, mode:'prompt'|'ios'|'inapp'|null}}
 */
export function installState() {
  const b = bucket();
  if (b.installed || isStandalone()) return { installed: true, canInstall: false, mode: null };
  if (b.deferred) return { installed: false, canInstall: true, mode: 'prompt' };
  if (isInAppBrowser()) return { installed: false, canInstall: true, mode: 'inapp' };
  if (isIos()) return { installed: false, canInstall: true, mode: 'ios' };
  // 桌面 Firefox、已經裝過但沒開 standalone、瀏覽器判定還沒完成——一律不畫
  return { installed: false, canInstall: false, mode: null };
}

/**
 * 叫出原生安裝對話框。
 * `prompt()` 一個 deferred 事件只能用一次，用完就丟——留著會在下一次
 * 按下時丟 InvalidStateError。
 * @returns {Promise<'accepted'|'dismissed'|'unavailable'>}
 */
export async function promptInstall() {
  const b = bucket();
  const ev = b.deferred;
  if (!ev) return 'unavailable';
  b.deferred = null;
  emit();
  try {
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === 'accepted') { b.installed = true; emit(); }
    return outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'unavailable';
  }
}

// ── 教學（沒有 API 的兩種環境） ───────────────────────────────

const IOS_STEPS = [
  '在畫面最下方按「分享」（往上的箭頭）',
  '往下捲，選「加入主畫面」',
  '右上角按「加入」'
];

const INAPP_STEPS = [
  '按畫面右上角的「⋯」或「≡」',
  '選「在瀏覽器開啟」（Safari 或 Chrome）',
  '在瀏覽器裡再按一次這顆「安裝」'
];

/** 教學彈窗。用 .modal 的樣式，跟 confirmDialog 同一套視覺。 */
export function showInstallHelp(mode = installState().mode) {
  const ios = mode === 'ios';
  const steps = ios ? IOS_STEPS : INAPP_STEPS;
  const title = ios ? '加到主畫面' : '請改用瀏覽器開啟';
  const note = ios
    ? 'iPhone 的 Safari 不支援一鍵安裝，要手動加入。加入後從主畫面點開，畫面會全螢幕、載入也更快。'
    : 'LINE 內建的瀏覽器沒辦法安裝網頁應用程式。用 Safari 或 Chrome 開啟後就可以了。';

  const list = el('ol', { class: 'install__steps' },
    steps.map(s => el('li', { text: s })));

  const dlg = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    el('div', { class: 'modal__panel' }, [
      el('h2', { class: 'modal__title' }, [icon(ios ? 'share' : 'info'), document.createTextNode(' ' + title)]),
      el('div', { class: 'modal__body' }, [el('p', { class: 'install__note', text: note }), list]),
      el('div', { class: 'modal__actions' }, [
        el('button', { class: 'btn btn--primary', type: 'button', onClick: () => close() }, '知道了')
      ])
    ])
  ]);

  const onKey = e => { if (e.key === 'Escape') close(); };
  function close() {
    document.removeEventListener('keydown', onKey);
    dlg.remove();
  }
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(dlg);
  dlg.querySelector('.btn')?.focus();
  return close;
}

// ── 接手 index.html 攔到的事件 ───────────────────────────────

export function initInstall() {
  const b = bucket();

  // 模組載入之後才派發的那一次（Chrome 有時會在 SW 就緒後才發）
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    b.deferred = e;
    emit();
  });

  window.addEventListener('appinstalled', () => {
    b.installed = true;
    b.deferred = null;
    emit();
  });

  // 從瀏覽器分頁切到已安裝的視窗時，display-mode 會變
  window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', emit);
}
