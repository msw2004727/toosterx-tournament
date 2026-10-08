import { el, mount } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { canEditTeamRoster } from '../../core/team-management.js';
import { hold } from '../../core/store.js';
import { divisionThemeAttrs } from '../../core/division-theme.js';
import { EVENT } from '../../config.js';
import { rocToIso } from '../../lib/roc.js';
import { MAX_PLAYERS_PER_ADD, validateTeamPlayers } from '../../engine/team-player-add.js';
import { addTeamPlayers, explain } from './data.js';

export function addPlayersDialog({ team, division, scope, onSaved }) {
  if (!canEditTeamRoster(team)) return;
  const opener = document.activeElement;
  let active = true, busy = false;
  const rows = [], list = el('div', { class: 'adm__newPlayers' });
  const error = el('p', { class: 'adm__blocked', role: 'alert' });
  const status = el('p', { class: 'adm__note', role: 'status' });
  const add = el('button', { class: 'btn adm__addPlayerRow', type: 'button', onClick: () => appendRow(true) }, iconText('injury', '再新增球員'));
  const cancel = el('button', { class: 'btn btn--lg', type: 'button', onClick: close }, '取消');
  const save = el('button', { class: 'btn btn--primary btn--lg', type: 'submit' });
  const panel = el('form', { class: 'modal__panel adm__addPlayersPanel', novalidate: true,
    ...divisionThemeAttrs(division || team.divisionId), onSubmit: submit }, [
    el('div', { class: 'adm__addPlayersHead' }, [
      el('h2', { class: 'modal__title', text: '新增球員' }),
      el('p', { class: 'adm__addPlayersTeam', text: team.name || team.teamId })
    ]),
    el('div', { class: 'modal__body adm__addPlayersBody' }, [
      el('p', { class: 'adm__note', text: '只有姓名必填，其餘可留空。未成年球員請填暱稱。' }),
      list, add, error, status
    ]),
    el('div', { class: 'modal__actions adm__addPlayersActions' }, [cancel, save])
  ]);
  const dialog = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '新增球員' }, panel);
  appendRow(false);
  document.body.append(dialog);
  const release = hold(scope, dispose, 'admin:add-players-dialog');
  document.addEventListener('keydown', onKey);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  rows[0].name.focus();

  function appendRow(focus) {
    if (busy || rows.length >= MAX_PLAYERS_PER_ADD) return;
    const input = (label, props = {}) => el('input', { class: 'adm__identityInput', 'aria-label': label, autocomplete: 'off', ...props });
    const name = input('姓名／暱稱', { maxlength: 40, placeholder: '必填' });
    const jersey = input('背號', { inputmode: 'numeric', maxlength: 3, placeholder: '可留空' });
    const year = input('出生民國年', { inputmode: 'numeric', maxlength: 3, placeholder: '年' });
    const month = input('出生月', { inputmode: 'numeric', maxlength: 2, placeholder: '月' });
    const day = input('出生日', { inputmode: 'numeric', maxlength: 2, placeholder: '日' });
    const last4 = input('身分證後四碼', { inputmode: 'numeric', maxlength: 4, placeholder: '可留空' });
    const captain = el('input', { type: 'checkbox' }), goalkeeper = el('input', { type: 'checkbox' });
    const title = el('legend', { class: 'adm__newPlayerTitle' });
    const row = { name, jersey, year, month, day, last4, captain, goalkeeper, title };
    row.remove = el('button', { class: 'btn btn--ghost adm__removePlayerRow', type: 'button', onClick: () => {
      if (busy || rows.length <= 1) return;
      const index = rows.indexOf(row); rows.splice(index, 1); renderRows();
      rows[Math.min(index, rows.length - 1)].name.focus();
    } }, icon('close'));
    row.node = el('fieldset', { class: 'adm__newPlayer' }, [title, row.remove,
      el('div', { class: 'adm__newPlayerMain' }, [
        el('label', {}, ['姓名／暱稱（必填）', name]), el('label', {}, ['背號（選填）', jersey])
      ]),
      el('details', { class: 'adm__newPlayerOptional' }, [el('summary', { text: '其他資料（選填）' }),
        el('fieldset', { class: 'adm__identityDate' }, [el('legend', { text: '出生日期（民國年）' }),
          el('label', {}, ['年', year]), el('label', {}, ['月', month]), el('label', {}, ['日', day])]),
        el('label', { class: 'adm__identityField' }, ['身分證後四碼', last4]),
        el('div', { class: 'adm__newPlayerFlags' }, [el('label', {}, [goalkeeper, '守門員']), el('label', {}, [captain, '場上隊長'])])
      ])
    ]);
    rows.push(row); renderRows();
    if (focus) { name.focus(); row.node.scrollIntoView({ block: 'nearest' }); }
  }
  function renderRows() {
    rows.forEach((row, i) => {
      row.title.textContent = `球員 ${i + 1}`;
      row.remove.setAttribute('aria-label', `移除第 ${i + 1} 位球員`);
      row.remove.hidden = rows.length === 1;
    });
    mount(list, rows.map(row => row.node));
    add.disabled = rows.length >= MAX_PLAYERS_PER_ADD;
    save.textContent = `新增 ${rows.length} 位球員`;
  }
  function dispose() {
    active = false; document.removeEventListener('keydown', onKey); dialog.remove();
    if (opener?.isConnected) opener.focus();
  }
  function close() { if (!busy) release(); }
  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const targets = [...panel.querySelectorAll('input, button, summary')].filter(node => !node.disabled && !node.hidden && node.getClientRects().length);
    const first = targets[0], last = targets.at(-1);
    if (!first) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  async function submit(event) {
    event.preventDefault();
    if (!active || busy) return;
    mount(error);
    if (!canEditTeamRoster(team)) { error.textContent = '目前沒有新增球員的權限。'; return; }
    if (!navigator.onLine) { error.textContent = '目前離線，請恢復連線後再新增球員。'; return; }
    const inputs = [];
    for (const [i, row] of rows.entries()) {
      const parts = [row.year.value.trim(), row.month.value.trim(), row.day.value.trim()];
      const birthDate = parts.some(Boolean) ? rocToIso(...parts) : '';
      if (birthDate === null) { error.textContent = `第 ${i + 1} 位球員：請填完整且有效的出生年月日，或全部留空。`; row.node.querySelector('details').open = true; row.year.focus(); return; }
      inputs.push({ name: row.name.value, jerseyNo: row.jersey.value, birthDate, idLast4: row.last4.value,
        isGoalkeeper: row.goalkeeper.checked, isCaptain: row.captain.checked });
    }
    const validation = validateTeamPlayers(inputs, { division, asOf: EVENT.dates[0] });
    if (validation.errors.length) { error.textContent = validation.errors.join(' '); return; }
    const players = validation.players.map(({ name, jerseyNo, birthDate, idLast4, isGoalkeeper, isCaptain }) => ({ name, jerseyNo, birthDate, idLast4, isGoalkeeper, isCaptain }));
    busy = true;
    const controls = [...panel.querySelectorAll('input, button')];
    controls.forEach(node => { node.disabled = true; });
    status.textContent = '新增中，請勿重複送出…';
    try {
      const result = await addTeamPlayers(team.teamId, players);
      if (!active) return;
      release(); onSaved(result);
    } catch (err) { if (active) error.textContent = explain(err); }
    finally {
      busy = false;
      if (active) { controls.forEach(node => { node.disabled = false; }); add.disabled = rows.length >= MAX_PLAYERS_PER_ADD; status.textContent = ''; }
    }
  }
}
