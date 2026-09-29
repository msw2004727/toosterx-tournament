import { divisionThemeAttrs } from '../../core/division-theme.js';
import { el, mount } from '../../core/ui.js';
import { can, callFunction } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { EVENT_ID, EVENT } from '../../config.js';
import { isoToRoc, rocToIso } from '../../lib/roc.js';
import { validateIdentity } from '../../engine/member-identity.js';

export function editCsvIdentity({ team, member, division, scope, onSaved }) {
  if (!can('team.manage')) return;
  const roc = isoToRoc(member.birthDate);
  let active = true, busy = false;
  const field = (label, value, maxLength) => el('input', { class: 'adm__identityInput', 'aria-label': label, value: value ?? '', inputmode: 'numeric', maxlength: maxLength });
  const year = field('出生民國年', roc?.y, 3), month = field('出生月', roc?.m, 2), day = field('出生日', roc?.d, 2);
  const last4 = field('身分證後四碼', member.idLast4, 4);
  const reason = el('textarea', { class: 'adm__textarea', 'aria-label': '修改原因', maxlength: 200, rows: 2, placeholder: '例如：依教練提供的證件補齊資料' });
  const error = el('p', { role: 'alert', class: 'adm__blocked' });
  const cancel = el('button', { type: 'button', class: 'btn btn--lg', onClick: close }, '取消');
  const save = el('button', { type: 'submit', class: 'btn btn--lg btn--primary' }, '儲存資料');
  const status = el('p', { role: 'status', class: 'adm__note' });
  const form = el('form', { class: 'modal__panel', ...divisionThemeAttrs(division || team.divisionId), onSubmit: submit }, [
    el('h2', { class: 'modal__title', text: `補填／修改 #${member.jerseyNo} ${member.name}` }),
    el('div', { class: 'modal__body' }, [
      el('p', { class: 'adm__note', text: '生日與身分證後四碼可稍後補齊。未補齊不能確認出賽；更改後需重新核對證件，並留下修改紀錄。' }),
      el('fieldset', { class: 'adm__identityDate' }, [el('legend', { text: '出生日期（民國年；未知時三格全留空）' }),
        el('label', {}, ['年', year]), el('label', {}, ['月', month]), el('label', {}, ['日', day])]),
      el('label', { class: 'adm__identityField' }, ['身分證後四碼（保留開頭 0，可留空）', last4]),
      el('label', { class: 'adm__identityField' }, ['修改原因（必填）', reason]), error, status
    ]),
    el('div', { class: 'modal__actions' }, [cancel, save])
  ]);
  const dialog = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '補填或修改球員資料' }, form);
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  document.body.append(dialog);
  hold(scope, () => dispose(), 'admin:identity-dialog');
  year.focus();

  function dispose() { active = false; document.removeEventListener('keydown', onKey); dialog.remove(); }
  function close() { if (!busy) dispose(); }
  async function submit(event) {
    event.preventDefault();
    if (busy || !active) return;
    mount(error);
    if (!can('team.manage')) { error.textContent = '目前沒有修改名冊的權限。'; return; }
    if (!navigator.onLine) { error.textContent = '目前離線，請恢復連線後再儲存。'; return; }
    const parts = [year.value, month.value, day.value].map(v => v.trim());
    const birthDate = parts.every(v => !v) ? '' : rocToIso(...parts);
    if (birthDate === null) { error.textContent = '請填完整且有效的民國出生年月日，或三格全留空。'; return; }
    const fields = { birthDate, idLast4: last4.value.trim() };
    const validation = validateIdentity(fields, division, EVENT.dates[0]);
    if (validation.errors.length) { error.textContent = validation.errors.join(' '); return; }
    if (!reason.value.trim()) { error.textContent = '請填修改原因。'; reason.focus(); return; }
    busy = true;
    for (const input of [year, month, day, last4, reason, cancel, save]) input.disabled = true;
    status.textContent = '儲存中，請勿重複送出…';
    try {
      const result = await callFunction('updateMemberIdentity', { eventId: EVENT_ID, teamId: team.teamId, memberId: member.memberId,
        ...fields, reason: reason.value.trim(), revision: member.identityRevision ?? 0 });
      if (!result?.auditId || result.memberId !== member.memberId || !Number.isInteger(result.identityRevision)) throw new Error('伺服器未回傳完整結果，請重新載入名冊確認。');
      if (!active) return;
      onSaved(result);
      dispose();
    } catch (err) { if (active) error.textContent = err?.message || '儲存失敗，請稍後再試。'; }
    finally {
      busy = false;
      for (const input of [year, month, day, last4, reason, cancel, save]) input.disabled = false;
      status.textContent = '';
    }
  }
}
