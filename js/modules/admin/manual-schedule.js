/** Private, device-local schedule drafts. Only the reviewed batch reaches the server. */
import { el, mount, toast } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { can, user, onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { EVENT_ID } from '../../config.js';
import { taipeiMs, kickoffMsOf } from '../../engine/schedule.js';
import { createManualDraft, manualMatchesOf, getManualFindings } from '../../engine/manual-schedule.js';
import { venuesForDate } from './schedule-actions.js';
import * as data from './data.js';

const copy = value => JSON.parse(JSON.stringify(value));
const nameOf = team => team?.shortName || team?.name || team?.teamId || '未指定球隊';
const clockOf = ms => ms == null ? '未排定' : new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).format(ms);

export function createManualScheduler({ scope, context, onDone, onReload, onBusyChange }) {
  const ownerUid = user()?.uid;
  const { division, teams, venues, cfg } = context;
  const node = el('section', { class: 'manual', 'aria-label': '手動安排賽程' });
  const indexKey = `feda:manual-schedule:index:${ownerUid}:${EVENT_ID}:${division.divisionId}`;
  const keyFor = revision => `feda:manual-schedule:v1:${ownerUid}:${EVENT_ID}:${division.divisionId}:${revision}`;
  const currentKey = keyFor(division.scheduleRevision ?? 0);
  let active = true, drag = null, scrollFrame = null, highlight = null, suppressClick = false;
  let state = { draft: null, reason: '', selected: null, query: '', undo: [], replacement: null,
    preview: false, busy: false, pending: null, uncertain: false, stale: false,
    message: '', failure: '', storageFailure: false, restored: false, filter: 'all' };
  const baseline = context.existingMatches;
  const teamMap = new Map(teams.map(t => [t.teamId, t]));

  function freshDraft() { return createManualDraft(context); }
  function authorized() { return active && ownerUid && user()?.uid === ownerUid && can('schedule.manage'); }
  function editable() { return authorized() && !state.busy && !state.pending && !state.stale; }
  function teamSlotsEditable(match) { return editable() && match.isRoundRobin && !match.locked && !state.draft.structureLocked; }
  function groupOf(match) { return state.draft.groups?.find(g => g.stageId === match.stageId && g.groupId === match.groupId); }
  function allowed(match, teamId) { return groupOf(match)?.teamIds?.includes(teamId) === true; }
  function matchOf(id) { return state.draft.matches.find(m => m.matchId === id); }

  function restore() {
    state.draft = freshDraft();
    const currentBasis = state.draft.sourceBasis;
    try {
      const storedKey = localStorage.getItem(indexKey);
      const raw = localStorage.getItem(currentKey) || (storedKey ? localStorage.getItem(storedKey) : null);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.ownerUid !== ownerUid || saved.eventId !== EVENT_ID || saved.draft?.divisionId !== division.divisionId ||
          saved.draft.schemaVersion !== 1 || !Array.isArray(saved.draft.matches) || !Array.isArray(saved.draft.groups)) {
        state.failure = '裝置上的草稿格式不完整，請以目前賽程建立新草稿。'; state.stale = true; return;
      }
      state.draft = saved.draft; state.reason = typeof saved.reason === 'string' ? saved.reason : '';
      state.pending = saved.pending ?? null; state.uncertain = !!state.pending;
      state.stale = state.draft.expectedRevision !== (division.scheduleRevision ?? 0) || state.draft.sourceBasis !== currentBasis;
      state.restored = true;
    } catch {
      state.storageFailure = true;
      state.message = '裝置無法讀取草稿；目前修改只保留在本頁，離開前請先確認。';
    }
  }

  function persist() {
    if (!authorized()) return;
    try {
      const storageKey = keyFor(state.draft.expectedRevision);
      localStorage.setItem(storageKey, JSON.stringify({ ownerUid, eventId: EVENT_ID,
        draft: state.draft, reason: state.reason, pending: state.pending }));
      localStorage.setItem(indexKey, storageKey);
      state.storageFailure = false;
    } catch { state.storageFailure = true; }
  }

  function remember() {
    state.undo.push(copy(state.draft));
    if (state.undo.length > 50) state.undo.shift();
    state.failure = ''; state.preview = false;
  }
  function changed(message, focusKey) {
    state.message = message; persist(); render(focusKey);
  }
  function changeMatch(id, patch, focusKey) {
    const match = matchOf(id);
    if (!editable() || !match || match.locked) return;
    remember(); Object.assign(match, patch); changed('草稿已更新，尚未發布。', focusKey);
  }

  function selectTeam(teamId) {
    if (suppressClick) { suppressClick = false; return; }
    if (!editable() || state.draft.structureLocked) return;
    state.selected = state.selected === teamId ? null : teamId;
    state.message = state.selected ? `已選取 ${nameOf(teamMap.get(teamId))}，請點場次的主隊或客隊位置。` : '已取消選取。';
    render(`team:${teamId}`);
  }

  function assignTeam(id, side, teamId, confirmed = false) {
    const match = matchOf(id);
    if (!match || !teamSlotsEditable(match)) return;
    if (!allowed(match, teamId)) { state.message = '這支球隊不屬於該場的小組，請選擇同組球隊。'; render(); return; }
    const opposite = side === 'home' ? 'away' : 'home';
    if (match[`${opposite}TeamId`] === teamId) { state.message = '同一場的兩個位置不能安排同一支球隊。'; render(); return; }
    const old = match[`${side}TeamId`];
    if (old === teamId) { state.selected = null; render(`slot:${id}:${side}`); return; }
    if (old && !confirmed) {
      state.replacement = { id, side, teamId, old }; render('replacement:confirm'); return;
    }
    remember(); match[`${side}TeamId`] = teamId;
    state.selected = null; state.replacement = null;
    changed(`已將 ${nameOf(teamMap.get(teamId))} 安排在 ${match.label || id} 的${side === 'home' ? '主隊' : '客隊'}，尚未發布。`, `slot:${id}:${side}`);
  }

  function findings() {
    try { return getManualFindings({ ...context, draft: state.draft }); }
    catch { return [{ level: 'error', code: 'DRAFT_INVALID', message: '草稿格式無法檢查，請以目前賽程建立新草稿。' }]; }
  }
  function previewMatches() {
    try { return manualMatchesOf({ draft: state.draft, division, teams }); }
    catch { return []; }
  }
  function diffs() {
    const originals = new Map(baseline.map(m => [m.matchId, m]));
    return previewMatches().flatMap(next => {
      const old = originals.get(next.matchId);
      const before = old ? `${old.home?.displayName || old.home?.name || nameOf(teamMap.get(old.home?.teamId))} vs ${old.away?.displayName || old.away?.name || nameOf(teamMap.get(old.away?.teamId))}・${clockOf(kickoffMsOf(old))}・${old.venueName || '未指定場地'}` : '新增場次';
      const after = `${next.home?.displayName || next.home?.name || '晉級來源'} vs ${next.away?.displayName || next.away?.name || '晉級來源'}・${clockOf(kickoffMsOf(next))}・${venues.find(v => v.venueId === next.venueId)?.name || '未指定場地'}`;
      const hasChange = !old || old.home?.teamId !== next.home?.teamId || old.away?.teamId !== next.away?.teamId ||
        kickoffMsOf(old) !== kickoffMsOf(next) || (old.venueId ?? null) !== (next.venueId ?? null);
      return hasChange ? [{ id: next.matchId, label: next.label || next.matchId, before, after }] : [];
    });
  }

  async function publish(retry = false) {
    if (!authorized() || state.busy) return;
    if (!retry && (state.stale || findings().some(f => f.level === 'error') || !state.preview || !state.reason.trim())) return;
    if (navigator.onLine === false) { state.failure = '發布需要連線。草稿仍保留在此裝置。'; render(); return; }
    const request = retry ? state.pending : { draft: copy(state.draft), reason: state.reason.trim(), operationId: crypto.randomUUID() };
    if (!request) return;
    state.pending = request; state.busy = true; state.failure = ''; state.uncertain = false;
    persist(); render(); onBusyChange?.();
    try {
      const result = await data.publishManualSchedule(copy(request));
      if (result?.divisionId !== division.divisionId || result.scheduleRevision !== request.draft.expectedRevision + 1 ||
          result.published !== true || result.operationId !== request.operationId || result.matchCount !== request.draft.matches.length || typeof result.auditId !== 'string' || !result.auditId.trim()) {
        throw Object.assign(new Error('尚未確認整批發布的結果，請重新載入核對或重送原發布請求。'), { code: 'management-unconfirmed' });
      }
      if (!active || !authorized()) return;
      try {
        localStorage.removeItem(keyFor(request.draft.expectedRevision));
        if (localStorage.getItem(indexKey) === keyFor(request.draft.expectedRevision)) localStorage.removeItem(indexKey);
      } catch { /* Publication is authoritative even when local storage cleanup fails. */ }
      state.pending = null;
      toast(`已整批發布 ${result.matchCount} 場賽程，公開端已更新。`);
      await onDone?.(result);
    } catch (err) {
      if (!active) return;
      const code = String(err?.code || '').replace(/^functions\//, '');
      state.uncertain = code === 'management-unconfirmed';
      if (!state.uncertain) state.pending = null;
      if (code === 'aborted') state.stale = true;
      state.failure = data.explain(err, '整批發布沒有成功，草稿仍保留。'); persist();
    } finally { if (active) { state.busy = false; render(); onBusyChange?.(); } }
  }

  function pool() {
    const requirement = new Map();
    for (const row of state.draft.teamRequirements ?? []) requirement.set(row.teamId, (requirement.get(row.teamId) ?? 0) + row.matchCount);
    const planned = new Map();
    for (const match of state.draft.matches.filter(m => m.isRoundRobin)) for (const id of [match.homeTeamId, match.awayTeamId]) {
      if (id) planned.set(id, (planned.get(id) ?? 0) + 1);
    }
    const cards = [...requirement.keys()].map(id => teamMap.get(id)).filter(Boolean)
      .filter(team => `${team.name} ${team.shortName}`.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));
    return el('aside', { class: 'manual__pool', 'aria-label': '參賽球隊卡片' }, [
      el('div', { class: 'manual__sectionTitle' }, [el('h3', { text: '球隊卡片' }), el('span', { class: 'manual__muted', text: '可重複安排' })]),
      el('input', { class: 'adm__search', type: 'search', value: state.query, placeholder: '搜尋球隊', 'aria-label': '搜尋球隊卡片',
        onInput: event => { state.query = event.target.value; const old = node.querySelector('.manual__cards'); if (old) mount(old, cardsNode()); } }),
      el('p', { class: 'manual__muted', text: state.draft.structureLocked ? '本組已有場次開打，對戰隊伍已鎖定；未開打場次仍可調整時間與場地。' : '拖住手把放入主／客隊位置，也可點選卡片後指定位置。' }),
      el('div', { class: 'manual__cards' }, cards.map(teamCard))
    ]);
    function cardsNode() {
      return [...requirement.keys()].map(id => teamMap.get(id)).filter(Boolean)
        .filter(team => `${team.name} ${team.shortName}`.toLocaleLowerCase().includes(state.query.toLocaleLowerCase())).map(teamCard);
    }
    function teamCard(team) {
      const id = team.teamId, count = planned.get(id) ?? 0, expected = requirement.get(id) ?? 0;
      const groupNames = (state.draft.groups ?? []).filter(g => g.teamIds.includes(id)).map(g => `${g.groupId}組`).join('／');
      return el('div', { class: `manual__team${state.selected === id ? ' is-selected' : ''}`, dataset: { teamId: id } }, [
        el('button', { class: 'manual__handle', type: 'button', 'aria-label': `拖曳 ${nameOf(team)} 球隊卡片`,
          disabled: !editable() || state.draft.structureLocked, onPointerdown: event => beginDrag(event, id), onClick: () => selectTeam(id) }, icon('more')),
        el('button', { class: 'manual__teamPick', type: 'button', 'aria-label': `選擇 ${nameOf(team)} 球隊卡片`, 'aria-pressed': state.selected === id ? 'true' : 'false',
          dataset: { focusKey: `team:${id}` }, disabled: !editable() || state.draft.structureLocked, onClick: () => selectTeam(id) }, [
          el('strong', { text: nameOf(team) }), el('span', { text: `${groupNames}・已安排 ${count}／${expected} 場` })
        ])
      ]);
    }
  }

  function sideSlot(match, side) {
    const id = match[`${side}TeamId`], text = nameOf(teamMap.get(id));
    const editableSlot = teamSlotsEditable(match);
    const source = match[side === 'home' ? 'sourceHome' : 'sourceAway'] || match[side];
    if (!match.isRoundRobin) return el('div', { class: 'manual__source' }, [
      el('span', { class: 'manual__muted', text: side === 'home' ? '主隊晉級來源' : '客隊晉級來源' }),
      el('strong', { text: source?.displayName || source?.name || source?.placeholder?.label || '依賽制自動晉級' }),
      el('span', { class: 'manual__muted', text: '依來源結果決定，不指定球隊' })
    ]);
    return el('div', { class: `manual__slot${id ? ' is-filled' : ''}`, dataset: { matchId: match.matchId, side } }, [
      el('button', { class: 'manual__slotPick', type: 'button', disabled: !editableSlot,
        dataset: { focusKey: `slot:${match.matchId}:${side}` }, 'aria-label': `${match.matchId} ${side === 'home' ? '主隊' : '客隊'}：${id ? text : '未指定'}`,
        onClick: () => {
          if (state.selected) assignTeam(match.matchId, side, state.selected);
          else { state.message = '請先選擇球隊卡片，再點要安排的位置。'; render(`slot:${match.matchId}:${side}`); }
        } }, [el('span', { class: 'manual__muted', text: side === 'home' ? '主隊' : '客隊' }), el('strong', { text: id ? text : '拖入或點選球隊' })]),
      id && editableSlot ? el('button', { class: 'manual__clear', type: 'button', 'aria-label': `清除 ${match.matchId} ${side === 'home' ? '主隊' : '客隊'}`,
        onClick: () => changeMatch(match.matchId, { [`${side}TeamId`]: null }, `slot:${match.matchId}:${side}`) }, icon('close')) : null
    ]);
  }

  function timeOptions(match) {
    const options = [el('option', { value: '', selected: match.kickoffAt == null, text: '請選擇時間' })];
    const start = taipeiMs(division.date, cfg.startTime), end = taipeiMs(division.date, cfg.endTime);
    const values = [];
    if (start != null && end != null && end > start) for (let ms = start; ms <= end; ms += 5 * 60_000) values.push(ms);
    if (Number.isFinite(match.kickoffAt) && !values.includes(match.kickoffAt)) values.push(match.kickoffAt);
    values.sort((a, b) => a - b);
    for (const ms of values) options.push(el('option', { value: String(ms), selected: ms === match.kickoffAt,
      text: `${clockOf(ms)}${start != null && (ms < start || ms > end) ? '（既有時間，超出營運窗口）' : ''}` }));
    return options;
  }

  function matchCard(match, issues) {
    const mine = issues.filter(f => f.matchId === match.matchId || f.matchIds?.includes(match.matchId));
    const card = el('article', { class: `manual__match${match.locked ? ' is-locked' : ''}`, dataset: { matchId: match.matchId } }, [
      el('div', { class: 'manual__matchHead' }, [
        el('div', {}, [el('h4', { text: match.label || match.matchId }), el('span', { class: 'manual__muted', text: `${match.matchId}・${match.isRoundRobin ? `${match.groupId}組循環賽` : '名次／淘汰賽'}` })]),
        match.locked ? el('span', { class: 'adm__badge', text: '已開打／有結果' }) : null
      ]),
      el('div', { class: 'manual__opponents' }, [sideSlot(match, 'home'), el('span', { class: 'manual__vs', text: 'VS' }), sideSlot(match, 'away')]),
      el('div', { class: 'manual__fields' }, [
        el('label', {}, [el('span', { text: '開賽時間（24 小時制）' }), el('select', { class: 'adm__search', 'aria-label': `${match.matchId} 手動開賽時間`,
          dataset: { focusKey: `time:${match.matchId}` }, disabled: !editable() || match.locked,
          onChange: event => changeMatch(match.matchId, { kickoffAt: event.target.value === '' ? null : Number(event.target.value) }, `time:${match.matchId}`) }, timeOptions(match))]),
        el('label', {}, [el('span', { text: '比賽場地' }), el('select', { class: 'adm__search', 'aria-label': `${match.matchId} 手動場地`,
          dataset: { focusKey: `venue:${match.matchId}` }, disabled: !editable() || match.locked,
          onChange: event => changeMatch(match.matchId, { venueId: event.target.value || null }, `venue:${match.matchId}`) }, [
          el('option', { value: '', selected: !match.venueId, text: '請選擇場地' }),
          ...venuesForDate(cfg, division.date, venues).map(v => el('option', { value: v.venueId, selected: v.venueId === match.venueId, text: v.name || v.venueId }))
        ])])
      ]),
      match.locked ? el('p', { class: 'manual__muted', text: '此場已開打或已有結果，球隊、時間與場地均不可變更。' }) : null,
      mine.length ? el('ul', { class: 'manual__matchIssues' }, mine.map(f => el('li', { class: `manual__issue manual__issue--${f.level}`, text: f.message }))) : null
    ]);
    return card;
  }

  function checks(issues) {
    return el('section', { class: 'manual__checks', 'aria-label': '草稿檢查結果' }, [
      el('h3', { text: '檢查安排' }),
      issues.length ? el('ul', { class: 'adm__checks' }, issues.map(f => el('li', { class: `adm__check adm__check--${f.level}` }, [
        icon(f.level === 'error' ? 'warn' : 'info'), el('span', { class: 'adm__checkText', text: `${f.message}（${f.level === 'error' ? '須修正才能發布' : '提醒，可發布'}）` })
      ]))) : el('p', { class: 'manual__success', text: '對戰、時間與場地檢查通過。' })
    ]);
  }

  function previewPanel(issues) {
    if (!state.preview) return null;
    const changes = diffs();
    return el('section', { class: 'manual__preview', 'aria-label': '整批發布預覽' }, [
      el('h3', { text: '整批發布預覽' }),
      el('p', { class: 'manual__muted', text: `共 ${state.draft.matches.length} 場，${changes.length} 場有新增或修改。確認後整批更新公開賽程，已開打的場次與結果保留。` }),
      changes.length ? el('ul', { class: 'manual__diffs' }, changes.map(change => el('li', {}, [
        el('strong', { text: change.label }), el('div', { class: 'manual__muted', text: `原本：${change.before}` }), el('div', { text: `發布後：${change.after}` })
      ]))) : el('p', { class: 'manual__muted', text: '場次安排沒有變更；此次會發布目前的賽程。' }),
      issues.some(f => f.level === 'warn') ? el('p', { class: 'manual__issue manual__issue--warn', text: '有休息時間等提醒，請確認上方檢查結果後發布。' }) : null,
      el('label', { class: 'manual__reason' }, [el('span', { text: '安排／修改原因（必填）' }), el('textarea', {
        class: 'adm__search', rows: '2', maxlength: '200', 'aria-label': '手動賽程發布原因', disabled: !editable(),
        onInput: event => { state.reason = event.target.value; persist(); const button = node.querySelector('[data-publish]'); if (button) button.disabled = !editable() || issues.some(f => f.level === 'error') || !state.reason.trim(); }
      }, state.reason)]),
      el('div', { class: 'manual__previewActions' }, [
        el('button', { class: 'btn', type: 'button', disabled: state.busy || !!state.pending, onClick: () => { state.preview = false; render('preview:open'); } }, '返回調整'),
        el('button', { class: 'btn btn--primary', type: 'button', dataset: { publish: 'true' }, disabled: !editable() || issues.some(f => f.level === 'error') || !state.reason.trim(), onClick: () => publish() }, iconText('check', '確認整批發布'))
      ])
    ]);
  }

  function render(focusKey) {
    if (!active) return;
    if (drag) stopDrag();
    if (!authorized()) {
      stopDrag(); mount(node, el('div', { class: 'adm__box adm__box--warn', role: 'alert', text: '登入身分或賽程權限已改變，草稿保留在原使用者的裝置空間，不能發布。' })); return;
    }
    const issues = findings(), errors = issues.filter(f => f.level === 'error').length;
    const warnings = issues.filter(f => f.level === 'warn').length;
    const complete = state.draft.matches.filter(m => (!m.isRoundRobin || (m.homeTeamId && m.awayTeamId)) && m.kickoffAt != null && m.venueId).length;
    const replacement = state.replacement;
    const visible = state.draft.matches.filter(match => state.filter === 'all' ||
      state.filter === `group:${match.stageId}:${match.groupId}` || state.filter === `stage:${match.stageId}`);
    const stageIds = [...new Set(state.draft.matches.filter(match => !match.isRoundRobin).map(match => match.stageId))];
    mount(node,
      el('div', { class: 'manual__intro' }, [
        el('div', {}, [el('h2', { text: '手動安排賽程' }), el('p', { text: `${division.name}・${division.date || '尚未設定日期'}・沿用現有賽制` })]),
        el('div', { class: 'manual__status', role: 'status', text: state.busy ? '整批發布中…' : state.pending ? '上次發布尚未確認' : state.stale ? '草稿版本已過期' : '此裝置私有草稿・尚未發布' })
      ]),
      el('p', { class: 'manual__muted', text: '修改只儲存在此裝置，不會逐場寫入公開賽程。確認預覽後才會整批發布。日期沿用組別設定，時間每 5 分鐘一格。' +
        (state.draft.mode === 'edit' ? '已有場次會沿用目前分組；尚未送出的分組對調不會套用到既有場次。' : '') }),
      el('div', { class: 'manual__summary' }, [
        el('span', { text: `已完成 ${complete}／${state.draft.matches.length} 場` }),
        el('span', { class: errors ? 'manual__danger' : '', text: `${errors} 項須修正` }),
        el('span', { text: `${warnings} 項提醒` })
      ]),
      state.restored ? el('p', { class: 'manual__restored', text: '已恢復此使用者在本裝置儲存的草稿。' }) : null,
      state.storageFailure ? el('p', { class: 'manual__issue manual__issue--warn', role: 'alert', text: '裝置無法儲存草稿；目前修改只保留在本頁，關閉或重載可能遺失。' }) : null,
      state.stale ? el('div', { class: 'adm__box adm__box--warn', role: 'alert' }, [
        el('strong', { text: '賽程已有新版，這份草稿不能直接發布。' }),
        el('p', { text: '舊草稿保留在本裝置。請重新載入核對新版，再明確選擇建立新草稿。' }),
        el('button', { class: 'btn', type: 'button', disabled: state.busy, onClick: () => onReload?.() }, '重新載入賽程'),
        !state.pending ? el('button', { class: 'btn', type: 'button', onClick: () => {
          state.draft = freshDraft(); state.stale = false; state.restored = false; state.undo = []; state.reason = ''; state.failure = '';
          changed('已以目前載入的賽程建立新草稿，舊版草稿仍保留在本裝置。');
        } }, '以目前賽程建立新草稿') : null
      ]) : null,
      state.failure ? el('p', { class: 'manual__failure', role: 'alert', text: state.failure }) : null,
      state.pending && !state.busy ? el('div', { class: 'manual__retry' }, [
        el('p', { text: '請先核對此次發布。重送會使用同一筆請求，避免重複發布。' }),
        el('button', { class: 'btn btn--primary', type: 'button', onClick: () => publish(true) }, '重送原發布請求'),
        el('button', { class: 'btn', type: 'button', onClick: () => onReload?.() }, '重新載入核對')
      ]) : null,
      el('p', { class: 'manual__announce', role: 'status', 'aria-live': 'polite', text: state.message || '先安排球隊，再選擇時間與場地。' }),
      replacement ? el('div', { class: 'manual__replacement', role: 'alert' }, [
        el('p', { text: `要將 ${nameOf(teamMap.get(replacement.old))} 替換成 ${nameOf(teamMap.get(replacement.teamId))}？此次只修改草稿，可撤銷。` }),
        el('button', { class: 'btn', type: 'button', onClick: () => { state.replacement = null; render(); } }, '取消替換'),
        el('button', { class: 'btn btn--primary', type: 'button', dataset: { focusKey: 'replacement:confirm' }, onClick: () => assignTeam(replacement.id, replacement.side, replacement.teamId, true) }, '確認替換')
      ]) : null,
      el('div', { class: 'manual__workspace' }, [pool(), el('section', { class: 'manual__fixtures', 'aria-label': '手動安排場次' }, [
        el('div', { class: 'manual__sectionTitle' }, [el('h3', { text: '對戰與時段' }), el('span', { class: 'manual__muted', text: '主隊／客隊只是記錄位置' })]),
        el('label', { class: 'manual__filter' }, [el('span', { text: '顯示場次' }), el('select', { class: 'adm__search', 'aria-label': '顯示手動賽程場次',
          dataset: { focusKey: 'filter:matches' }, disabled: state.busy, onChange: event => { state.filter = event.target.value; render('filter:matches'); } }, [
          el('option', { value: 'all', selected: state.filter === 'all', text: `全部（${state.draft.matches.length} 場）` }),
          ...(state.draft.groups ?? []).map(group => { const value = `group:${group.stageId}:${group.groupId}`;
            return el('option', { value, selected: state.filter === value, text: `${group.groupId}組循環賽` }); }),
          ...stageIds.map(stageId => { const value = `stage:${stageId}`;
            return el('option', { value, selected: state.filter === value, text: context.format.stages.find(stage => stage.stageId === stageId)?.name || stageId }); })
        ])]),
        el('p', { class: 'manual__muted', text: `顯示 ${visible.length}／${state.draft.matches.length} 場；檢查與發布仍包含全部場次。` }),
        ...visible.map(m => matchCard(m, issues))
      ])]),
      checks(issues), previewPanel(issues),
      el('div', { class: 'manual__footer' }, [
        el('span', { class: 'manual__muted', text: state.selected ? `已選取 ${nameOf(teamMap.get(state.selected))}，請指定主／客隊位置` : state.storageFailure ? '草稿尚未存到裝置' : '草稿自動保存在此裝置' }),
        el('div', {}, [
          el('button', { class: 'btn', type: 'button', disabled: !editable() || !state.undo.length, onClick: () => {
            if (!editable() || !state.undo.length) return; state.draft = state.undo.pop(); state.replacement = null; changed('已撤銷上一個草稿調整。');
          } }, iconText('undo', '撤銷')),
          el('button', { class: 'btn btn--primary', type: 'button', dataset: { focusKey: 'preview:open' }, disabled: !editable() || !!replacement,
            onClick: () => { state.preview = true; render(); node.querySelector('.manual__preview')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }, iconText('list', '預覽整批發布'))
        ])
      ])
    );
    if (focusKey) [...node.querySelectorAll('[data-focus-key]')].find(n => n.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
  }

  function updateDropTarget() {
    highlight?.classList.remove('is-dropTarget', 'is-dropInvalid'); highlight = null;
    if (!drag?.started) return;
    const hit = document.elementFromPoint(drag.x, drag.y)?.closest('.manual__slot');
    if (!hit || !node.contains(hit)) return;
    const match = matchOf(hit.dataset.matchId), side = hit.dataset.side;
    const opposite = side === 'home' ? 'away' : 'home';
    highlight = hit;
    const valid = match && teamSlotsEditable(match) && allowed(match, drag.teamId) && match[`${opposite}TeamId`] !== drag.teamId;
    hit.classList.add(valid ? 'is-dropTarget' : 'is-dropInvalid');
  }

  function scrollDuringDrag() {
    if (!drag?.started) return;
    const edge = 80, height = window.innerHeight;
    const amount = drag.y < edge ? -12 : drag.y > height - edge ? 12 : 0;
    if (amount) { window.scrollBy(0, amount); updateDropTarget(); }
    scrollFrame = requestAnimationFrame(scrollDuringDrag);
  }
  function beginDrag(event, teamId) {
    if (!editable() || state.draft.structureLocked || (event.pointerType === 'mouse' && event.button !== 0)) return;
    stopDrag();
    drag = { teamId, pointerId: event.pointerId, handle: event.currentTarget,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, started: false, ghost: null };
    drag.handle.setPointerCapture?.(event.pointerId);
  }
  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.started && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 8) {
      drag.started = true; suppressClick = true;
      drag.ghost = el('div', { class: 'manual__dragGhost', 'aria-hidden': 'true', text: nameOf(teamMap.get(drag.teamId)) });
      document.body.append(drag.ghost); document.body.classList.add('manual-dragging');
      scrollFrame = requestAnimationFrame(scrollDuringDrag);
    }
    if (drag.started) {
      event.preventDefault(); drag.ghost.style.transform = `translate3d(${drag.x + 12}px,${drag.y + 12}px,0)`;
      updateDropTarget();
    }
  }
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) {
      if (!drag && suppressClick) setTimeout(() => { suppressClick = false; }, 0);
      return;
    }
    const wasStarted = drag.started;
    const dropped = drag.started && event.type === 'pointerup';
    const teamId = drag.teamId, target = highlight;
    stopDrag();
    if (dropped && target) assignTeam(target.dataset.matchId, target.dataset.side, teamId);
    // Pointer capture sends a click to the handle after a drag. Consume it,
    // then reset so the next intentional card click still works.
    if (wasStarted) setTimeout(() => { suppressClick = false; }, 0);
  }
  function stopDrag() {
    if (scrollFrame != null) cancelAnimationFrame(scrollFrame);
    scrollFrame = null; highlight?.classList.remove('is-dropTarget', 'is-dropInvalid'); highlight = null;
    drag?.ghost?.remove();
    try { if (drag?.handle?.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId); } catch { /* Pointer was already released. */ }
    drag = null; document.body.classList.remove('manual-dragging');
  }
  function onKey(event) {
    if (event.key !== 'Escape' || !active) return;
    stopDrag(); state.selected = null; state.replacement = null; state.message = '已取消安排操作。'; render();
  }
  document.addEventListener('pointermove', moveDrag, { passive: false });
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  document.addEventListener('keydown', onKey);
  function cleanup() {
    if (!active) return; active = false; stopDrag();
    document.removeEventListener('pointermove', moveDrag);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);
    document.removeEventListener('keydown', onKey);
  }
  const release = hold(scope, cleanup, 'manual-schedule:input');
  const releaseAuth = hold(scope, onAuth(() => { if (state.draft) render(); }), 'manual-schedule:auth');
  restore(); render();
  return { node, get busy() { return state.busy; }, refreshAuthorization: () => render(), dispose: () => { releaseAuth(); release(); } };
}
