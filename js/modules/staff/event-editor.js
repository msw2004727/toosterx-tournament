/** Shared event editor: LIVE and adjudication use the same fields and correction API. */
import { el, mount, toast } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { hold } from '../../core/store.js';
import { periodLabel } from '../../lib/format.js';
import { EDIT_EVENT_TYPES, buildTimelineEdit, timelineEditMatchPatch } from '../../engine/timeline-edit.js';
import { correctTimelineEvent, explain } from '../admin/data.js';
import { getDivision, getTeamRoster } from './data.js';

export async function openEventEditor({ scope, match, event, events, context, onSaved }) {
  const previousFocus = document.activeElement;
  let active = true, busy = false;
  const off = hold(scope, () => close(true), 'timeline:editor');
  const error = el('p', { class: 'event-edit__error', role: 'alert', hidden: true });
  const form = el('form', { class: 'event-edit' });
  const save = el('button', { class: 'btn btn--primary', type: 'submit', disabled: true }, iconText('check', '儲存修改'));
  const cancel = el('button', { class: 'btn btn--ghost', type: 'button', onClick: () => close() }, '取消');
  const dlg = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '修改事件' },
    el('div', { class: 'modal__panel event-edit__panel' }, [
      el('h2', { class: 'modal__title' }, iconText('edit', '修改事件')),
      el('p', { class: 'event-edit__intro', text: '事件修正需連線。比分會依得分差異調整，並保留修改紀錄。' }),
      form
    ]));
  mount(form, el('p', { text: '讀取球員名單中…' }), error, el('div', { class: 'modal__actions' }, [cancel, save]));
  function close(force = false) {
    if (!active || (busy && !force)) return;
    document.removeEventListener('keydown', onKey);
    dlg.remove(); active = false; off();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const controls = [...dlg.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')].filter(n => !n.closest('[hidden]'));
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  document.addEventListener('keydown', onKey); document.body.append(dlg); cancel.focus();
  let division, rosters;
  try {
    [division, ...rosters] = await Promise.all([getDivision(match.divisionId),
      ...['home', 'away'].map(side => match[side]?.teamId ? getTeamRoster(match[side].teamId) : Promise.resolve([]))]);
    rosters = { home: rosters[0], away: rosters[1] };
    if (!division || ![1, 2].includes(division.periods)) throw new Error('讀不到比賽期別設定，請稍後再試');
  } catch (err) { if (active) { error.hidden = false; error.textContent = explain(err); } return close; }
  if (!active) return close;
  function field(label, input) { return el('label', { class: 'event-edit__field' }, [el('span', { text: label }), input]); }
  function select(name, options, value) {
    const input = el('select', { name, class: 'input' }, options.map(([key, text]) => el('option', { value: key, text })));
    input.value = value ?? ''; return input;
  }
  const type = select('type', Object.entries(EDIT_EVENT_TYPES), event.type);
  const side = select('side', [['home', match.home?.name ?? '主隊'], ['away', match.away?.name ?? '客隊'], ['neutral', '不分隊伍']], event.side);
  const periods = ['pre', 'h1', ...(division.periods === 2 ? ['ht', 'h2'] : []), 'et1', 'et2', 'pk', 'ft'];
  const period = select('periodId', periods.map(p => [p, periodLabel(p, division.periods)]), event.periodId);
  const mins = el('input', { class: 'input num', name: 'minutes', type: 'number', inputmode: 'numeric', min: 0, max: 1440, step: 1, required: true, value: Math.floor((event.clockSec ?? 0) / 60) });
  const secs = el('input', { class: 'input num', name: 'seconds', type: 'number', inputmode: 'numeric', min: 0, max: 59, step: 1, required: true, value: (event.clockSec ?? 0) % 60 });
  const player = select('playerId', [], ''); const incoming = select('subInPlayerId', [], ''); const assist = select('assistPlayerId', [], '');
  const card = select('cardType', [['yellow', '黃牌'], ['second_yellow', '兩黃換紅'], ['red', '紅牌']], event.cardType ?? 'yellow');
  const goal = select('goalType', [['open', '一般進球'], ['header', '頭球'], ['freekick', '自由球'], ['penalty', '罰球']], event.goalType ?? 'open');
  const note = el('textarea', { class: 'input', name: 'note', rows: 2, maxlength: 200, value: event.note ?? '' });
  const reason = el('textarea', { class: 'input', name: 'reason', rows: 2, maxlength: 500, required: true,
    placeholder: '例如：核對紀錄後修正球員或時間', value: '' });
  note.value = event.note ?? '';
  const voided = el('input', { name: 'voided', type: 'checkbox', checked: event.voided === true });
  const playerField = field('球員／換下球員', player), incomingField = field('換上球員', incoming);
  const assistField = field('助攻球員（選填）', assist), cardField = field('牌別', card), goalField = field('進球方式', goal);
  const preview = el('p', { class: 'event-edit__preview', 'aria-live': 'polite' });
  function patchOf() {
    return { type: type.value, side: side.value, periodId: period.value, clockSec: Number(mins.value) * 60 + Number(secs.value),
      playerId: player.value || null, subInPlayerId: incoming.value || null, assistPlayerId: assist.value || null,
      cardType: card.value, goalType: goal.value, note: note.value, voided: voided.checked };
  }
  function refreshPreview() {
    try {
      const after = buildTimelineEdit({ event, patch: patchOf(), match, division, rosters });
      const adjusted = timelineEditMatchPatch({ match, events, before: event, after, division });
      preview.textContent = `修改後比分：${adjusted.score?.home ?? '—'} : ${adjusted.score?.away ?? '—'}`;
    } catch { preview.textContent = '請完成事件資料後再儲存'; }
  }
  function populatePlayers(initial = false) {
    for (const [input, originalId, name, jersey] of [[player, event.playerId, event.playerName, event.jerseyNo],
      [incoming, event.subInPlayerId, event.subInPlayerName, event.subInJerseyNo], [assist, event.assistPlayerId, '原助攻球員', null]]) {
      const desired = initial ? originalId : input.value;
      const options = (rosters[side.value] ?? []).filter(p => ['player', 'start', 'bench'].includes(p.role ?? p.kind ?? 'player'))
        .map(p => [p.memberId, `${p.jerseyNo == null ? '' : '#' + p.jerseyNo + ' '}${p.displayName ?? p.name ?? '球員'}`]);
      if (side.value === event.side && originalId && !options.some(([id]) => id === originalId)) options.push([originalId, `${jersey == null ? '' : '#' + jersey + ' '}${name ?? '原球員'}（原紀錄）`]);
      mount(input, [['', '未指定球員'], ...options].map(([value, text]) => el('option', { value, text })));
      input.value = options.some(([id]) => id === desired) ? desired : '';
    }
    refreshPreview();
  }
  function showFields() {
    const neutral = ['note', 'period_start', 'period_end'].includes(type.value);
    side.disabled = neutral;
    if (neutral) side.value = 'neutral'; else if (side.value === 'neutral') side.value = 'home';
    playerField.hidden = neutral; incomingField.hidden = type.value !== 'substitution';
    assistField.hidden = !['goal', 'penalty_scored'].includes(type.value);
    cardField.hidden = type.value !== 'card'; goalField.hidden = type.value !== 'goal';
    if (neutral) player.value = '';
    if (incomingField.hidden) incoming.value = '';
    if (assistField.hidden) assist.value = '';
    refreshPreview();
  }
  type.addEventListener('change', () => { showFields(); populatePlayers(); });
  side.addEventListener('change', () => populatePlayers());
  form.addEventListener('input', refreshPreview);
  mount(form, el('div', { class: 'event-edit__grid' }, [field('事件類型', type), field('隊伍', side), field('期別', period),
    el('div', { class: 'event-edit__time' }, [field('該期別分鐘', mins), field('秒數', secs)]),
    playerField, incomingField, assistField, cardField, goalField]),
    field('備註（選填）', note), el('label', { class: 'event-edit__void' }, [voided, document.createTextNode('作廢此事件（取消勾選可恢復）')]),
    preview, field('修改原因', reason), error, el('div', { class: 'modal__actions' }, [cancel, save]));
  populatePlayers(true); showFields(); save.disabled = false; type.focus();
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return;
    const patch = patchOf();
    try { buildTimelineEdit({ event, patch, match, division, rosters }); }
    catch (err) { error.hidden = false; error.textContent = err.message; return; }
    busy = true; error.hidden = true;
    const controls = [...form.querySelectorAll('input,select,textarea,button')];
    const disabled = controls.map(c => c.disabled); controls.forEach(c => { c.disabled = true; });
    save.textContent = '儲存中…';
    try {
      const result = await correctTimelineEvent({ match, event, context, patch, reason: reason.value.trim() });
      if (!active) return;
      toast('事件已修改，比分與統計會同步更新'); busy = false; close(); await onSaved?.(result);
    } catch (err) {
      if (!active) return;
      error.hidden = false; error.textContent = explain(err, '事件修改失敗，請再試一次');
    } finally {
      busy = false; controls.forEach((c, i) => { c.disabled = disabled[i]; }); save.textContent = '儲存修改';
    }
  });
  return close;
}
