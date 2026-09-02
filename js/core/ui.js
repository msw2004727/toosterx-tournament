/**
 * UI 基礎：escapeHTML、Toast、Modal、骨架
 * ------------------------------------------------------------------
 * 規格：docs/08-UI規範與前端架構.md §2、§4、§9
 *
 * R-CODE-002：隊名／球員名／暱稱／備註等不可信內容一律 escapeHTML() 或 textContent。
 * 這個檔案是唯一允許組 HTML 字串的地方，其餘模組請用這裡的 h() 或直接操作 DOM。
 */

import { icon } from './icons.js';

/** HTML 逸出。所有來自 Firestore 的文字進模板前都要過這一關。 */
export function escapeHTML(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** 標籤樣板：${} 插入的值自動逸出，需要原樣輸出時用 raw() */
export function html(strings, ...values) {
  return strings.reduce((out, s, i) => {
    if (i === 0) return s;
    const v = values[i - 1];
    const piece = v && v.__raw ? v.value : Array.isArray(v)
      ? v.map(x => (x && x.__raw ? x.value : escapeHTML(x))).join('')
      : escapeHTML(v);
    return out + piece + s;
  }, '');
}
export const raw = value => ({ __raw: true, value });

/**
 * 安全地替換子節點。
 *
 * ⚠️ 一定要用這個，不要直接 node.replaceChildren(...)：
 *    replaceChildren(null) 會把 null 轉成**字串 "null"** 顯示在畫面上，
 *    而且不會有任何錯誤。條件式渲染寫 `cond ? el(...) : null` 是常態，
 *    所以這個坑一定會踩到（E2E 已經抓到過一次）。
 */
export function mount(node, ...children) {
  node.replaceChildren(...children.flat().filter(c => c != null && c !== false && c !== ''));
  return node;
}

/** 建立元素的小工具，避免到處拼字串 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'html') node.innerHTML = v;         // 呼叫端負責已逸出
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// ── Toast ────────────────────────────────────────────────────
// docs/08 §2：成功綠／警示橘／錯誤紅，**錯誤不自動消失**

const TOAST_MS = { success: 2200, warn: 4000, error: 0 };

export function toast(message, kind = 'success', { action } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return () => {};

  const node = el('div', { class: `toast toast--${kind}`, role: kind === 'error' ? 'alert' : 'status' }, [
    el('span', { class: 'toast__msg', text: message }),
    action && el('button', { class: 'toast__action', type: 'button', onClick: () => { action.onClick?.(); close(); } }, action.label),
    kind === 'error' && el('button', { class: 'toast__close', type: 'button', 'aria-label': '關閉', onClick: () => close() }, icon('close'))
  ].filter(Boolean));

  root.append(node);
  // 連續操作會疊出一整排 toast，把畫面蓋掉。只留最新的三則。
  while (root.children.length > 3) root.firstElementChild.remove();

  let timer = null;
  const ms = TOAST_MS[kind] ?? 2500;
  if (ms > 0) timer = setTimeout(close, ms);

  function close() {
    clearTimeout(timer);
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 180);
  }
  return close;
}

// ── Modal ────────────────────────────────────────────────────

/**
 * 確認對話框。回傳 Promise<boolean>。
 * @param {object} o
 * @param {string} o.title
 * @param {Node|string} [o.body]
 * @param {string} [o.confirmText] 預設「確認」
 * @param {string} [o.cancelText]  預設「取消」
 * @param {'default'|'danger'} [o.tone]
 */
export function confirmDialog({ title, body, confirmText = '確認', cancelText = '取消', tone = 'default' }) {
  return new Promise(resolve => {
    const dlg = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('div', { class: 'modal__panel' }, [
        el('h2', { class: 'modal__title', text: title }),
        body ? el('div', { class: 'modal__body' }, body) : null,
        el('div', { class: 'modal__actions' }, [
          el('button', { class: 'btn btn--ghost', type: 'button', onClick: () => finish(false) }, cancelText),
          el('button', { class: `btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}`, type: 'button', onClick: () => finish(true) }, confirmText)
        ])
      ].filter(Boolean))
    ]);

    const onKey = e => { if (e.key === 'Escape') finish(false); };
    function finish(v) {
      document.removeEventListener('keydown', onKey);
      dlg.remove();
      resolve(v);
    }
    dlg.addEventListener('click', e => { if (e.target === dlg) finish(false); });
    document.addEventListener('keydown', onKey);
    document.body.append(dlg);
    dlg.querySelector('.btn--primary, .btn--danger')?.focus();
  });
}

/** 由下往上的大選單，用於「選隊伍 → 選球員」這種三步流程 */
export function sheet({ title, options, onPick, columns = 1 }) {
  return new Promise(resolve => {
    const wrap = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('div', { class: 'sheet__panel' }, [
        el('div', { class: 'sheet__head' }, [
          el('h2', { class: 'sheet__title', text: title }),
          el('button', { class: 'sheet__close', type: 'button', 'aria-label': '取消', onClick: () => finish(null) }, icon('close'))
        ]),
        el('div', { class: `sheet__grid sheet__grid--${columns}` },
          options.map(o => el('button', {
            class: `sheet__opt ${o.tone ? 'sheet__opt--' + o.tone : ''} ${o.disabled ? 'is-disabled' : ''}`,
            type: 'button', disabled: o.disabled || false,
            onClick: () => finish(o.value)
          }, [
            o.iconName ? el('span', { class: 'sheet__opt-icon' }, icon(o.iconName, { cls: o.iconCls })) : null,
            o.sub != null ? el('span', { class: 'sheet__opt-sub', text: o.sub }) : null,
            el('span', { class: 'sheet__opt-main', text: o.label }),
            o.note ? el('span', { class: 'sheet__opt-note', text: o.note }) : null
          ].filter(Boolean)))
        )
      ])
    ]);

    const onKey = e => { if (e.key === 'Escape') finish(null); };
    function finish(v) {
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      if (v != null) onPick?.(v);
      resolve(v);
    }
    wrap.addEventListener('click', e => { if (e.target === wrap) finish(null); });
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    wrap.querySelector('.sheet__opt:not(.is-disabled)')?.focus();
  });
}

// ── 骨架與空狀態 ─────────────────────────────────────────────

export function skeleton(lines = 3) {
  return el('div', { class: 'skeleton' }, Array.from({ length: lines }, () => el('div', { class: 'skeleton__line' })));
}

export function emptyState({ title, note, actionLabel, onAction, iconName }) {
  return el('div', { class: 'empty' }, [
    iconName ? el('span', { class: 'empty__icon' }, icon(iconName)) : null,
    el('p', { class: 'empty__title', text: title }),
    note ? el('p', { class: 'empty__note', text: note }) : null,
    actionLabel ? el('button', { class: 'btn btn--primary', type: 'button', onClick: onAction }, actionLabel) : null
  ].filter(Boolean));
}

/** 震動回饋。不支援的裝置直接略過，不要報錯。 */
export function buzz(pattern = 30) {
  try { navigator.vibrate?.(pattern); } catch { /* 使用者可能停用 */ }
}

export function initUi() {
  return { escapeHTML, toast, confirmDialog, sheet, el, html, raw };
}
