/**
 * 報名端共用小元件
 * ------------------------------------------------------------------
 * 只放「報名流程用得到、其他地方用不到」的東西。
 * 通用的（escapeHTML / mount / toast）在 js/core/ui.js。
 */

import { el } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';

export const TEAM_STATUS = {
  draft: '草稿', submitted: '待主辦審核', approved: '已通過',
  rejected: '已退回', withdrawn: '已撤銷'
};

export const MEMBER_STATUS = {
  pending: '待你同意', approved: '已加入', rejected: '已婉拒', removed: '已移除'
};

export const KIND_LABEL = { player: '球員', coach: '教練', staff: '隊職員' };

/** 各種時間型別 → 台北時間的「10/8（三）00:00」 */
export function ymdLabel(v) {
  const ms = v?.toMillis ? v.toMillis()
    : typeof v === 'number' ? v
    : typeof v === 'string' ? Date.parse(v.length === 10 ? `${v}T00:00:00+08:00` : v)
    : NaN;
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const opt = { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short' };
  const date = new Intl.DateTimeFormat('zh-TW', opt).format(d);
  const time = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(d);
  return time === '00:00' ? date : `${date} ${time}`;
}

export function statusBadge(status, dict = TEAM_STATUS) {
  return el('span', {
    class: `reg__badge reg__badge--${status || 'draft'}`,
    text: dict[status] || status || '—'
  });
}

export function pageHead(title, { sub, onBack } = {}) {
  return el('div', { class: 'reg__head' }, [
    onBack
      ? el('button', { class: 'reg__back', type: 'button', 'aria-label': '返回', onClick: onBack }, icon('back'))
      : null,
    el('div', { class: 'reg__headText' }, [
      el('strong', { text: title }),
      sub ? el('span', { class: 'reg__headSub', text: sub }) : null
    ].filter(Boolean))
  ].filter(Boolean));
}

/**
 * 表單欄位。
 * label 一律用 <label for>，不是把文字放旁邊——螢幕閱讀器與點擊放大區都靠它。
 */
export function field(id, label, input, { hint, required } = {}) {
  return el('div', { class: 'reg__field' }, [
    el('label', { class: 'reg__label', for: id }, [
      el('span', { text: label }),
      required ? el('span', { class: 'reg__req', text: '必填' }) : null
    ].filter(Boolean)),
    input,
    hint ? el('p', { class: 'reg__hint', text: hint }) : null
  ].filter(Boolean));
}

export function textInput(id, { value = '', placeholder = '', maxlength, type = 'text', inputmode, onInput }) {
  return el('input', {
    class: 'reg__input', id, name: id, type, value, placeholder,
    ...(maxlength ? { maxlength: String(maxlength) } : {}),
    ...(inputmode ? { inputmode } : {}),
    onInput: e => onInput?.(e.target.value)
  });
}

export function selectInput(id, options, { value, onChange }) {
  return el('select', { class: 'reg__input', id, name: id, onChange: e => onChange?.(e.target.value) },
    options.map(o => el('option', { value: o.value, selected: o.value === value }, o.label)));
}

/** 錯誤留在畫面上，不用會自己消失的提示——送出失敗最需要被看見 */
export function errorBox(message) {
  if (!message) return null;
  return el('div', { class: 'reg__box reg__box--warn', role: 'alert' }, [
    el('strong', { text: '沒有送出去' }),
    el('p', { class: 'reg__note', text: message })
  ]);
}

export { iconText };
