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
 * | 其他（事件沒來、Firefox、裝過但用瀏覽器開）| 沒有                | 教從瀏覽器選單安裝（2026-09-06 驗收反饋：頁首每一台都要長一樣）|
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
const INSTALLED_KEY = 'feda_pwa_installed';
function rememberedInstall() {
  try { return window.localStorage?.getItem(INSTALLED_KEY) === '1'; } catch { return false; }
}
function rememberInstall(installed) {
  try {
    if (installed) window.localStorage?.setItem(INSTALLED_KEY, '1');
    else window.localStorage?.removeItem(INSTALLED_KEY);
  } catch { /* 禁止儲存時仍使用本次頁面的狀態 */ }
}
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
 * @returns {{installed:boolean, canInstall:boolean, mode:'prompt'|'ios'|'inapp'|'manual'|null}}
 */
export function installState() {
  const b = bucket();
  if (b.installed || isStandalone()) return { installed: true, canInstall: false, mode: null };
  if (b.deferred) return { installed: false, canInstall: true, mode: 'prompt' };
  if (rememberedInstall()) return { installed: true, canInstall: false, mode: null };
  if (isInAppBrowser()) return { installed: false, canInstall: true, mode: 'inapp' };
  if (isIos()) return { installed: false, canInstall: true, mode: 'ios' };
  // 沒有已安裝證據、也沒有原生提示時，保留瀏覽器選單安裝教學。
  return { installed: false, canInstall: true, mode: 'manual' };
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
    if (outcome === 'accepted') { b.installed = true; rememberInstall(true); emit(); }
    return outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'unavailable';
  }
}

// ── 教學（沒有 API 的兩種環境） ───────────────────────────────

const IOS_STEPS = [
  '按 Safari 的「分享」（方框向上箭頭）。若沒看到，先按網址列旁的「⋯」選單，再選「分享」。',
  '往下捲，選「加入主畫面」',
  '若有「打開為網頁 App」，請保持開啟，再按「加入」。'
];

const INAPP_STEPS = [
  '按畫面右上角的「⋯」或「≡」',
  '選「在瀏覽器開啟」（Safari 或 Chrome）',
  '在瀏覽器裡再按一次這顆「安裝」'
];
const MANUAL_STEPS = [
  '電腦 Chrome／Edge：按網址列的安裝圖示，或右上角選單（⋮）。手機：開啟瀏覽器選單。',
  '選「安裝應用程式」或「加到主畫面」。Mac Safari 可從「檔案」選「加入 Dock」。',
  '安裝完成後，從桌面或主畫面的 FEDA CUP 圖示開啟'
];

/** 教學彈窗。用 .modal 的樣式，跟 confirmDialog 同一套視覺。 */
export function showInstallHelp(mode = installState().mode, returnFocus = document.activeElement) {
  const ios = mode === 'ios';
  const manual = mode === 'manual' || mode === 'prompt' || mode == null;
  const steps = ios ? IOS_STEPS : manual ? MANUAL_STEPS : INAPP_STEPS;
  const title = ios ? '加到主畫面' : manual ? '安裝到裝置' : '請改用瀏覽器開啟';
  const note = ios
    ? '用 Safari 開啟本站，照下面 3 步加入主畫面，下次點 FEDA CUP 圖示就能開啟。'
    : manual
      ? '這個瀏覽器沒有主動跳出安裝框，但多半可以從選單安裝。已經裝過的話，請直接從主畫面開啟。'
      : 'LINE 內建的瀏覽器沒辦法安裝網頁應用程式。用 Safari 或 Chrome 開啟後就可以了。';

  const list = el('ol', { class: 'install__steps' },
    steps.map((s, i) => el('li', {}, [
      el('span', { class: 'install__stepNumber', 'aria-hidden': 'true', text: String(i + 1) }),
      el('div', { class: 'install__stepContent' }, [
        icon(ios ? ['share', 'home', 'check'][i] : 'install'),
        el('span', { text: s })
      ])
    ])));

  const dlg = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    el('div', { class: 'modal__panel' }, [
      el('h2', { class: 'modal__title' }, [icon(ios ? 'share' : manual ? 'install' : 'info'), document.createTextNode(' ' + title)]),
      el('div', { class: 'modal__body' }, [el('p', { class: 'install__note', text: note }), list]),
      el('div', { class: 'modal__actions' }, [
        el('button', { class: 'btn btn--primary', type: 'button', onClick: () => close() }, '知道了')
      ])
    ])
  ]);

  const previousFocus = returnFocus;
  const onKey = e => { if (e.key === 'Escape') close(); };
  function close() {
    document.removeEventListener('keydown', onKey);
    dlg.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
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
  if (b.installed || isStandalone()) rememberInstall(true);
  else if (b.deferred) rememberInstall(false);

  // 模組載入之後才派發的那一次（Chrome 有時會在 SW 就緒後才發）
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    // 再次收到可安裝事件代表目前能重裝，清掉解除安裝前的紀錄。
    b.installed = false;
    rememberInstall(false);
    b.deferred = e;
    emit();
  });

  window.addEventListener('appinstalled', () => {
    b.installed = true;
    b.deferred = null;
    rememberInstall(true);
    emit();
  });

  // 從瀏覽器分頁切到已安裝的視窗時，display-mode 會變
  window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', () => {
    if (isStandalone()) rememberInstall(true);
    emit();
  });
  window.addEventListener('storage', e => {
    if (e.key !== INSTALLED_KEY) return;
    b.installed = e.newValue === '1';
    if (b.installed) b.deferred = null;
    emit();
  });

  // 支援此 API 的瀏覽器能在一般分頁確認本站 PWA 已安裝。
  // 僅接受本站 manifest 與既有 start_url 身分，其他相關 App 不算。
  if (typeof navigator.getInstalledRelatedApps === 'function') {
    const installEvent = b.deferred;
    Promise.resolve().then(() => navigator.getInstalledRelatedApps()).then(apps => {
      if (b.deferred !== installEvent) return; // 判定期間新到的可安裝事件優先
      const installed = apps.some(app => {
        if (app.platform !== 'webapp' || !app.url) return false;
        try {
          const url = new URL(app.url, location.href);
          return url.origin === location.origin && url.pathname === '/manifest.json'
            && (!app.id || new URL(app.id, location.href).href === new URL('/?src=pwa', location.href).href);
        } catch { return false; }
      });
      if (!installed) return;
      b.installed = true;
      b.deferred = null;
      rememberInstall(true);
      emit();
    }).catch(() => { /* 不支援或被拒絕時保留既有安裝／教學功能 */ });
  }
}
