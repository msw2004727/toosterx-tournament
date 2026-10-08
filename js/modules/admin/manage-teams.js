import { el, mount, skeleton, toast, confirmDialog } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { user, onAuth, whenAuthReady, callFunction } from '../../core/firebase.js';
import { canManageAllTeams, canEditTeamRoster, watchCaptainTeams } from '../../core/team-management.js';
import { hold } from '../../core/store.js';
import { divisionThemeAttrs } from '../../core/division-theme.js';
import { EVENT_ID } from '../../config.js';
import { needLogin } from '../account/login.js';
import { adminHead } from './bits.js';
import { teamRosterDetail } from './team-roster.js';
import { editTeamName } from './team-name.js';
import { addPlayersDialog } from './team-player-add.js';
import * as data from './data.js';

export async function manageTeamsPage({ scope, view }) {
  const root = el('div', { class: 'adm adm--manageTeams' });
  mount(view, root); mount(root, skeleton(3));
  await whenAuthReady();
  const state = { teams: null, divisions: [], openDivisions: new Set(), open: null, members: {}, memberErrors: {}, error: null, busy: false };
  let source = null, stopTeams = null, active = true;
  hold(scope, () => { active = false; }, 'teams:page');
  hold(scope, onAuth(connect), 'auth:manage-teams');
  await loadDivisions();

  async function loadDivisions() {
    try { const divisions = await data.getDivisions(); if (active) state.divisions = divisions; }
    catch (err) { if (active) state.error = data.explain(err, '讀不到組別。'); }
    if (active) render();
  }

  function connect() {
    const uid = user()?.uid;
    const key = uid ? `${uid}:${canManageAllTeams()}` : null;
    if (key === source) { render(); return; }
    stopTeams?.(); source = key;
    state.teams = null; state.members = {}; state.memberErrors = {}; state.open = null;
    if (!uid) { render(); return; }
    const receive = rows => {
      if (!active || source !== key) return;
      state.teams = rows; state.error = null;
      for (const id of Object.keys(state.members)) if (!rows.some(t => t.teamId === id)) delete state.members[id];
      if (!rows.some(t => t.teamId === state.open)) state.open = null;
      render();
    };
    const failed = err => {
      if (!active || source !== key) return;
      state.teams = []; state.error = data.explain(err, '讀不到球隊清單。'); render();
    };
    stopTeams = canManageAllTeams() ? data.watchTeams(scope, receive, failed) : watchCaptainTeams(scope, uid, receive, failed);
    render();
  }

  function groups() {
    const known = state.divisions.map(d => ({ ...d, teams: state.teams.filter(t => t.divisionId === d.divisionId) }));
    const other = [...new Set(state.teams.map(t => t.divisionId).filter(id => !state.divisions.some(d => d.divisionId === id)))];
    return [...known, ...other.map(id => ({ divisionId: id, name: id || '未設定組別', teams: state.teams.filter(t => t.divisionId === id) }))].filter(d => d.teams.length);
  }

  function render() {
    if (!active) return;
    if (!user()) { mount(root, needLogin('/my/teams')); return; }
    const rows = state.teams;
    mount(root,
      adminHead('管理球隊', { sub: rows ? `${rows.length} 支球隊 · ${rows.filter(t => t.managementLocked === true).length} 支已上鎖` : '載入中' }),
      el('p', { class: 'adm__note', text: canManageAllTeams() ? '依組別展開球隊，點擊球隊查看並編輯名冊。上鎖後隊長只能查看，管理員與大總管仍可修改。' : '只列出你擔任隊長的球隊。可修改範圍與報名審核相同；球隊上鎖時只能查看。' }),
      state.error ? el('p', { class: 'adm__box adm__box--warn', role: 'alert', text: state.error }) : null,
      canManageAllTeams() && rows?.length ? el('div', { class: 'adm__lockActions' }, [
        el('button', { type: 'button', class: 'btn btn--primary btn--lg', disabled: state.busy, onClick: () => setLock(true) }, iconText('lock', '一鍵全鎖')),
        el('button', { type: 'button', class: 'btn btn--lg', disabled: state.busy, onClick: () => setLock(false) }, iconText('unlock', '一鍵全解'))
      ]) : null,
      rows === null ? skeleton(3) : !rows.length ? el('p', { class: 'adm__empty', text: '目前沒有可管理的球隊。請由大總管在身分授權中指派隊長。' })
        : el('div', { class: 'adm__teamGroups' }, groups().map(divisionGroup))
    );
  }

  function divisionGroup(div) {
    const open = state.openDivisions.has(div.divisionId);
    return el('section', { class: 'adm__teamGroup division-card', ...divisionThemeAttrs(div) }, [
      el('button', { type: 'button', class: 'adm__itemHead adm__divisionHead', 'aria-expanded': String(open),
        onClick: () => { if (open) state.openDivisions.delete(div.divisionId); else state.openDivisions.add(div.divisionId); render(); } }, [
        el('strong', { class: 'adm__itemMain', text: div.name || div.divisionId }),
        el('span', { class: 'adm__badge', text: `${div.teams.length} 隊` }), icon(open ? 'up' : 'down')
      ]),
      open ? el('ul', { class: 'adm__list adm__groupTeams' }, div.teams.map(t => teamRow(t, div))) : null
    ]);
  }

  function teamRow(team, div) {
    const open = state.open === team.teamId, locked = team.managementLocked === true;
    return el('li', { class: `adm__item${open ? ' is-open' : ''}`, dataset: { teamId: team.teamId } }, [
      el('button', { type: 'button', class: 'adm__itemHead', 'aria-expanded': String(open), onClick: () => toggle(team) }, [
        el('span', { class: 'adm__itemMain' }, [
          el('strong', { class: 'adm__teamName', text: team.name || team.teamId }),
          el('span', { class: 'adm__teamMeta', text: `隊長：${team.captainName || (team.captainUid ? '已指派' : '未指派')} · ${team.memberCount ?? 0} 人` })
        ]),
        el('span', { class: `adm__badge${locked ? ' adm__badge--rejected' : ' adm__badge--approved'}`, text: locked ? '已上鎖' : '可編輯' }), icon(open ? 'up' : 'down')
      ]),
      canEditTeamRoster(team) ? el('div', { class: 'adm__teamTools' }, [el('button', {
        class: 'btn btn--sm', type: 'button', disabled: state.busy, 'aria-label': `編輯 ${team.name || team.teamId} 的球隊名稱`,
        onClick: () => editTeamName({ team, division: div, scope, onSaved: result => {
          Object.assign(team, { name: result.name, shortName: result.shortName, nameRevision: result.nameRevision });
          render(); toast('球隊名稱已儲存，修改紀錄已保留。', 'success');
        } })
      }, iconText('note', '編輯球隊名稱')), el('button', {
        class: 'btn btn--primary btn--sm', type: 'button', disabled: state.busy, 'aria-label': `新增 ${team.name || team.teamId} 的球員`,
        onClick: () => addPlayersDialog({ team, division: div, scope, onSaved: result => {
          Object.assign(team, { memberCount: result.memberCount, playerCount: result.playerCount, rosterRevision: result.rosterRevision });
          state.open = team.teamId; state.openDivisions.add(team.divisionId); delete state.members[team.teamId];
          loadMembers(team); toast(`已新增 ${result.addedCount} 位球員`, 'success');
        } })
      }, iconText('injury', '新增球員'))]) : null,
      open ? el('div', { class: 'adm__detail' }, [
        canManageAllTeams() ? el('div', { class: 'adm__lockActions' }, [
          el('button', { type: 'button', class: 'btn btn--primary', disabled: state.busy, onClick: () => setLock(!locked, team) }, iconText(locked ? 'unlock' : 'lock', locked ? '解鎖球隊' : '上鎖球隊'))
        ]) : locked ? el('p', { class: 'adm__box adm__box--warn', role: 'status', text: '球隊已上鎖，目前只能查看；請聯絡管理員或大總管解鎖。' }) : null,
        state.memberErrors[team.teamId] ? el('div', { role: 'alert', class: 'adm__box adm__box--warn' }, [
          el('p', { text: state.memberErrors[team.teamId] }), el('button', { class: 'btn', type: 'button', onClick: () => loadMembers(team) }, '重試載入名單')
        ]) : state.members[team.teamId] ? teamRosterDetail({ team, members: state.members[team.teamId], division: div, scope,
          onSaved: () => render(), onReload: () => loadMembers(team) }) : skeleton(3)
      ]) : null
    ]);
  }

  async function toggle(team) {
    if (state.open === team.teamId) { state.open = null; render(); return; }
    state.open = team.teamId; render();
    if (!state.members[team.teamId]) await loadMembers(team);
  }

  async function loadMembers(team) {
    const key = source;
    delete state.memberErrors[team.teamId]; render();
    try {
      const members = await data.getMembers(team.teamId);
      if (active && key === source && state.teams?.some(t => t.teamId === team.teamId)) state.members[team.teamId] = members;
    } catch (err) { if (active && key === source) state.memberErrors[team.teamId] = data.explain(err, '讀不到球員名單。'); }
    render();
  }

  async function setLock(locked, team) {
    if (state.busy || !canManageAllTeams()) return;
    if (!navigator.onLine) { toast('目前離線，請恢復連線後再調整球隊鎖定。', 'warn'); return; }
    const label = team ? `「${team.name || team.teamId}」` : `全部 ${state.teams.length} 支球隊`;
    const ok = await confirmDialog({ title: `${locked ? '上鎖' : '解鎖'}${label}？`,
      body: locked ? '隊長將無法修改球隊資料；管理員與大總管仍可編輯。' : '隊長可再次修改自己球隊的名冊資料。', confirmText: team ? (locked ? '上鎖' : '解鎖') : (locked ? '全部上鎖' : '全部解鎖') });
    if (!ok || !active || !canManageAllTeams() || state.busy) return;
    state.busy = true; state.error = null; render();
    try {
      const result = await callFunction('setTeamManagementLock', { eventId: EVENT_ID, locked, ...(team ? { teamId: team.teamId } : { all: true }) });
      if (!Number.isInteger(result?.teamCount) || result.locked !== locked) throw new Error('伺服器未回傳完整結果，請重新載入確認。');
      toast(`已${locked ? '上鎖' : '解鎖'} ${result.teamCount} 支球隊`, 'success');
    } catch (err) { if (active) state.error = data.explain(err); }
    finally { state.busy = false; render(); }
  }
}
