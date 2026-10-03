import { el, mount } from '../../core/ui.js';
import { can } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { divisionThemeAttrs } from '../../core/division-theme.js';
import { teamNameBasis, validateTeamNames } from '../../engine/team-name.js';
import { renameTeam, explain } from './data.js';

export function editTeamName({ team, division, scope, onSaved }) {
  if (!can('team.manage')) return;
  const expected = teamNameBasis(team);
  let active = true, busy = false;
  const name = el('input', { class: 'adm__identityInput', 'aria-label': '球隊名稱', value: team.name ?? '', maxlength: 60 });
  const shortName = el('input', { class: 'adm__identityInput', 'aria-label': '球隊簡稱', value: team.shortName ?? '', maxlength: 20 });
  name.addEventListener('input', () => { shortName.value = name.value.trim().slice(0, 20); });
  const reason = el('input', { class: 'adm__identityInput', 'aria-label': '修改原因', maxlength: 200, placeholder: '例如：依教練確認修正隊名' });
  const error = el('p', { class: 'adm__blocked', role: 'alert' });
  const status = el('p', { class: 'adm__note', role: 'status' });
  const cancel = el('button', { class: 'btn btn--lg', type: 'button', onClick: close }, '取消');
  const save = el('button', { class: 'btn btn--lg btn--primary', type: 'submit' }, '儲存隊名');
  const dialog = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '編輯球隊名稱' },
    el('form', { class: 'modal__panel adm__identityPanel adm__teamNamePanel', ...divisionThemeAttrs(division || team.divisionId), onSubmit: submit }, [
      el('h2', { class: 'modal__title', text: '編輯球隊名稱' }),
      el('div', { class: 'modal__body' }, [
        el('p', { class: 'adm__note', text: `目前隊名：${team.name || team.teamId}` }),
        el('label', { class: 'adm__identityField' }, ['球隊名稱（最多 60 字）', name]),
        el('label', { class: 'adm__identityField' }, ['球隊簡稱（最多 20 字）', shortName]),
        el('p', { class: 'adm__note', text: '更改名稱時會自動帶入簡稱，也可自行調整；簡稱用於賽程、比分與排名。留空時使用名稱前 20 字。同組別不可與另一支球隊同名。' }),
        el('label', { class: 'adm__identityField' }, ['修改原因（必填）', reason]),
        el('p', { class: 'adm__note', text: '儲存後同步賽程及各項看板，並保留修改紀錄。球隊審核狀態、名冊與比賽成績維持原樣。' }), error, status
      ]), el('div', { class: 'modal__actions' }, [cancel, save])
    ]));
  const onKey = event => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  document.body.append(dialog);
  const release = hold(scope, dispose, 'admin:team-name-dialog');
  name.focus();
  function dispose() { active = false; document.removeEventListener('keydown', onKey); dialog.remove(); }
  function close() { if (!busy) release(); }
  async function submit(event) {
    event.preventDefault();
    if (!active || busy) return;
    mount(error);
    if (!can('team.manage')) { error.textContent = '目前沒有修改球隊的權限。'; return; }
    if (!navigator.onLine) { error.textContent = '目前離線，請恢復連線後再儲存。'; return; }
    const validation = validateTeamNames({ name: name.value, shortName: shortName.value, reason: reason.value });
    if (validation.errors.length) { error.textContent = validation.errors.join(' '); return; }
    const fields = validation.fields;
    if (fields.name === expected.name && fields.shortName === expected.shortName) { error.textContent = '球隊名稱與簡稱沒有變更。'; return; }
    busy = true;
    for (const field of [name, shortName, reason, cancel, save]) field.disabled = true;
    status.textContent = '儲存中，請勿重複送出…';
    try {
      const result = await renameTeam(team.teamId, { expected, ...fields });
      if (!result?.auditId || result.teamId !== team.teamId || result.name !== fields.name || result.shortName !== fields.shortName || result.nameRevision !== expected.revision + 1) {
        throw new Error('尚未確認這次操作的結果，請重新載入球隊資料核對。');
      }
      if (!active) return;
      onSaved(result);
      release();
    } catch (err) { if (active) error.textContent = explain(err); }
    finally {
      busy = false;
      for (const field of [name, shortName, reason, cancel, save]) field.disabled = false;
      status.textContent = '';
    }
  }
}
