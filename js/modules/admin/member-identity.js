import { divisionThemeAttrs } from '../../core/division-theme.js';
import { el, mount } from '../../core/ui.js';
import { can } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { EVENT } from '../../config.js';
import { isoToRoc, rocToIso } from '../../lib/roc.js';
import { validateIdentity, validateJerseyNo, validateMemberName } from '../../engine/member-identity.js';
import { updateMemberIdentity, explain } from './data.js';

export function editCsvIdentity({ team, member, division, scope, onSaved }) {
  if (!can('team.manage')) return;
  const roc = isoToRoc(member.birthDate);
  const nameOnly = member.source !== 'csv' || member.status !== 'approved';
  const expectedName = member.name ?? '';
  const revision = member.identityRevision ?? 0;
  let active = true, busy = false;
  const name = el('input', { class: 'adm__identityInput', 'aria-label': '隊員姓名／暱稱', value: expectedName, maxlength: 40, autocomplete: 'off' });
  const field = (label, value, maxLength) => el('input', { class: 'adm__identityInput', 'aria-label': label, value: value ?? '', inputmode: 'numeric', maxlength: maxLength });
  const year = field('出生民國年', roc?.y, 3), month = field('出生月', roc?.m, 2), day = field('出生日', roc?.d, 2);
  const last4 = field('身分證後四碼', member.idLast4, 4);
  const jersey = field('背號（可留空）', member.jerseyNo, 2);
  const reason = el('textarea', { class: 'adm__textarea', 'aria-label': '修改原因', maxlength: 200, rows: 2, placeholder: '例如：依教練提供的證件補齊資料' });
  const error = el('p', { role: 'alert', class: 'adm__blocked' });
  const cancel = el('button', { type: 'button', class: 'btn btn--lg', onClick: close }, '取消');
  const save = el('button', { type: 'submit', class: 'btn btn--lg btn--primary' }, '儲存資料');
  const status = el('p', { role: 'status', class: 'adm__note' });
  const form = el('form', { class: 'modal__panel adm__identityPanel', ...divisionThemeAttrs(division || team.divisionId), onSubmit: submit }, [
    el('h2', { class: 'modal__title', text: `補填／修改 ${member.jerseyNo != null ? `#${member.jerseyNo} ` : ''}${member.name}` }),
    el('div', { class: 'modal__body' }, [
      el('p', { class: 'adm__note', text: '可修改隊員姓名／暱稱，最多 40 字。未成年隊員請使用暱稱；既有公開姓名遮蔽規則仍適用。修改後需重新檢錄，並保留修改紀錄。' }),
      el('label', { class: 'adm__identityField' }, ['隊員姓名／暱稱（必填）', name]),
      !nameOnly ? el('p', { class: 'adm__note', text: '背號可留空或清空；填寫 0–99，同隊已填背號不可重複。生日與身分證後四碼未補齊不能確認出賽。賽務頁請重新載入最新名單。' }) : null,
      !nameOnly ? el('label', { class: 'adm__identityField' }, ['背號（0–99，可留空）', jersey]) : null,
      !nameOnly ? el('fieldset', { class: 'adm__identityDate' }, [el('legend', { text: '出生日期（民國年；未知時三格全留空）' }),
        el('label', {}, ['年', year]), el('label', {}, ['月', month]), el('label', {}, ['日', day])]) : null,
      !nameOnly ? el('label', { class: 'adm__identityField' }, ['身分證後四碼（保留開頭 0，可留空）', last4]) : null,
      el('label', { class: 'adm__identityField' }, ['修改原因（必填）', reason]), error, status
    ]),
    el('div', { class: 'modal__actions' }, [cancel, save])
  ]);
  const dialog = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '補填或修改隊員資料' }, form);
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  document.body.append(dialog);
  const release = hold(scope, () => dispose(), 'admin:identity-dialog');
  name.focus();

  function dispose() { active = false; document.removeEventListener('keydown', onKey); dialog.remove(); }
  function close() { if (!busy) release(); }
  async function submit(event) {
    event.preventDefault();
    if (busy || !active) return;
    mount(error);
    if (!can('team.manage')) { error.textContent = '目前沒有修改名冊的權限。'; return; }
    if (!navigator.onLine) { error.textContent = '目前離線，請恢復連線後再儲存。'; return; }
    const nameResult = validateMemberName(name.value);
    if (nameResult.error) { error.textContent = nameResult.error; name.focus(); return; }
    const parts = [year.value, month.value, day.value].map(v => v.trim());
    const birthDate = parts.every(v => !v) ? '' : rocToIso(...parts);
    if (!nameOnly && birthDate === null) { error.textContent = '請填完整且有效的民國出生年月日，或三格全留空。'; return; }
    const jerseyResult = validateJerseyNo(jersey.value);
    if (!nameOnly && jerseyResult.error) { error.textContent = jerseyResult.error; jersey.focus(); return; }
    const fields = nameOnly ? { name: nameResult.value } : { name: nameResult.value, birthDate, idLast4: last4.value.trim(), jerseyNo: jerseyResult.value };
    const validation = validateIdentity(fields, division, EVENT.dates[0]);
    if (!nameOnly && validation.errors.length) { error.textContent = validation.errors.join(' '); return; }
    if (Object.entries(fields).every(([key, value]) => value === (member[key] ?? (key === 'jerseyNo' ? null : '')))) { error.textContent = '資料沒有變更。'; return; }
    if (!reason.value.trim()) { error.textContent = '請填修改原因。'; reason.focus(); return; }
    busy = true;
    for (const input of [name, year, month, day, last4, jersey, reason, cancel, save]) input.disabled = true;
    status.textContent = '儲存中，請勿重複送出…';
    try {
      const result = await updateMemberIdentity({ teamId: team.teamId, memberId: member.memberId,
        ...fields, nameOnly, expectedName, reason: reason.value.trim(), revision });
      if (!result?.auditId || result.memberId !== member.memberId || result.identityRevision !== revision + 1
        || Object.entries(fields).some(([key, value]) => result[key] !== value)) throw new Error('尚未確認這次操作的結果，請重新載入名冊核對。');
      if (!active) return;
      onSaved(result);
      release();
    } catch (err) { if (active) error.textContent = explain(err, '儲存失敗，請稍後再試。'); }
    finally {
      busy = false;
      for (const input of [name, year, month, day, last4, jersey, reason, cancel, save]) input.disabled = false;
      status.textContent = '';
    }
  }
}
