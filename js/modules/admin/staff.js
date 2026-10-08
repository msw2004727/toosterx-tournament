/**
 * 身分授權 `#/admin/staff`
 * ------------------------------------------------------------------
 * 規格：docs/10 §5.1、R-RULES-003、R-ROLE-002
 *
 * 總管在這裡把賽務身分指派給人。
 *
 * 四件不可協商：
 *   1. **指派不出總管**。介面不提供這個選項，`firestore.rules` 也擋
 *      （`staffRolesAssignable()` 的白名單沒有 super_admin）。
 *      總管只能由 `scripts/grant-super-admin.mjs` 建立。
 *   2. **身分是單選**。向上包含（R-ROLE-002）之下選一個就夠了，
 *      而且畫面要把「這個身分含哪些」列出來——不然總管會四個各指派一次。
 *   3. **只列得出登入過的人**。LINE uid 沒辦法憑空產生，所以找不到人時
 *      要給的訊息是「請對方先登入一次」，不是「查無此人」。
 *   4. **停用不是刪除**。賽後要查得到某一筆比分是誰記的。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式。
 */

import { el, mount, toast, skeleton, confirmDialog } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { user, can, onAuth, reloadIdentity, callFunction } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { ROLE_INFO, EVENT_ID } from '../../config.js';
import {
  ASSIGNABLE_ROLES, impliedBy, validateAssignment, onlyStaffScoped, assignableHere,
  unmanagedRoles, buildStaffDoc, buildDeactivatePatch, buildReactivatePatch, mergeDirectory
} from '../../engine/assign.js';
import * as data from './data.js';
import { adminHead, denied } from './bits.js';

/** 選單順序：權限大的排上面，總管最常指派的是記錄員與檢錄員。 */
const ROLE_ORDER = [...ASSIGNABLE_ROLES].reverse();

export async function adminStaffPage({ scope, view }) {
  const root = el('div', { class: 'adm' });
  mount(view, root);
  mount(root, skeleton(4));

  const state = {
    staff: null, users: [], venues: [], challenges: [], challengesError: null, teams: null, divisions: [], teamError: null,
    q: '',                 // 搜尋字串
    open: null,            // 展開中的 uid
    draft: null,           // { role, venueIds }
    busy: false, usersError: null
  };

  if (!can('staff.assign')) { mount(root, denied('身分授權', '總管')); return; }

  data.getUsers()
    .then(rows => { state.users = rows; render(); })
    .catch(err => { state.usersError = err; render(); });

  data.getVenues()
    .then(rows => { state.venues = rows; render(); })
    .catch(err => console.warn('[admin] venues', err));

  data.watchStaff(scope, rows => { state.staff = rows; render(); }, err => {
    mount(root, adminHead('身分授權'), errBox('讀不到工作人員清單', err));
  });

  data.watchTeams(scope, teams => { state.teams = teams; state.teamError = null; render(); }, err => { state.teamError = err; render(); });
  void loadDivisions();
  hold(scope, onAuth(() => render()), 'auth:admin-staff');
  void loadChallenges();

  async function loadDivisions() {
    try { state.divisions = await data.getDivisions(); render(); }
    catch (err) { state.teamError = err; render(); }
  }

  async function loadChallenges() {
    try { state.challenges = await data.getChallenges(); state.challengesError = null; }
    catch (err) { state.challengesError = err; }
    render();
  }

  // ── 具名函式（會被提升）───────────────────────────────────

  function errBox(title, err) {
    return el('div', { class: 'adm__box adm__box--warn', role: 'alert' }, [
      el('strong', { text: title }),
      el('p', { class: 'adm__note', text: data.explain(err) })
    ]);
  }

  function rows() {
    const all = mergeDirectory(state.users, state.staff ?? []);
    const q = state.q.trim().toLowerCase();
    if (!q) return all;
    return all.filter(r =>
      String(r.name ?? '').toLowerCase().includes(q) || r.uid.toLowerCase().includes(q));
  }

  function venueName(id) {
    return state.venues.find(v => v.venueId === id)?.name ?? id;
  }

  /** 這一列現在的身分敘述。停用的要講出來，不然看起來還有權限。 */
  function roleText(r) {
    if (!r.role) {
      // 有身分文件卻沒有賽務角色：舊版本留下的（venue_lead）或 FC 同步過來的。
      // 顯示成「未指派」的話總管永遠不會發現它還在資料庫裡。
      const other = unmanagedRoles(r.roles);
      if (other.length) return `其他身分：${other.join('、')}`;
      return '未指派';
    }
    const label = ROLE_INFO[r.role]?.label ?? r.role;
    if (!r.active) return `${label}（已停用）`;
    if (onlyStaffScoped(r.role) && r.challengeIds?.length) {
      const venue = r.role !== 'booth' && r.venueIds?.length ? ` · ${r.venueIds.map(venueName).join('、')}` : '';
      return `${label}${venue} · ${r.challengeIds.map(id => state.challenges.find(c => c.challengeId === id)?.shortName ?? id).join('、')}`;
    }
    if (r.role === 'booth') return `${label} · 尚未指派攤位`;
    // ⚠️ 只有受場地限制的角色才印場地。管理員以上在 rules 裡不受場地限制
    //    （`assignedVenue()` 對 admin 直接放行），印出「管理員 · A場」
    //    等於告訴總管一個根本不成立的限制。demo 上真的有這種舊資料
    //    （自助身分寫進去的 venueIds），2026-09-04 實測看到。
    if (onlyStaffScoped(r.role) && r.venueIds?.length) {
      return `${label} · ${r.venueIds.map(venueName).join('、')}`;
    }
    return label;
  }

  function openRow(uid_) {
    if (state.open === uid_) { state.open = null; state.draft = null; render(); return; }
    const row = rows().find(r => r.uid === uid_);
    state.open = uid_;
    // 已經有身分就帶出來當預設，沒有就留空——預選一個身分等於誘導誤按
    state.draft = { role: row?.role && ASSIGNABLE_ROLES.includes(row.role) ? row.role : '',
                    venueIds: [...(row?.venueIds ?? [])], challengeIds: [...(row?.challengeIds ?? [])], divisionId: '', teamId: '' };
    render();
  }

  function pickRole(role) {
    state.draft.role = role;
    // 換成管理員時把場地清掉：留著會顯示一組其實不生效的限制
    if (!onlyStaffScoped(role)) state.draft.venueIds = [];
    if (role === 'booth') state.draft.venueIds = [];
    if (!onlyStaffScoped(role)) state.draft.challengeIds = [];
    render();
  }

  function toggleVenue(id) {
    const v = state.draft.venueIds;
    const i = v.indexOf(id);
    if (i >= 0) v.splice(i, 1); else v.push(id);
    render();
  }

  async function save(row) {
    const { role, venueIds, challengeIds } = state.draft;
    if (state.challengesError) { toast('讀不到攤位設定，請重新整理後再指派。', 'warn'); return; }
    const check = validateAssignment({
      uid: row.uid, role, venueIds, challengeIds, knownChallengeIds: state.challenges.map(c => c.challengeId),
      knownVenueIds: state.venues.length ? state.venues.map(v => v.venueId) : null
    });
    if (!check.ok) { toast(check.message, 'warn'); return; }

    const before = row.role ? { roles: [row.role], active: row.active, venueIds: row.venueIds, challengeIds: row.challengeIds } : null;
    const doc_ = buildStaffDoc({
      uid: row.uid, name: row.name, role, venueIds, challengeIds, eventId: EVENT_ID
    });

    state.busy = true; render();
    try {
      await data.saveStaff(row.uid, doc_);
      await data.writeAudit({
        action: before ? 'staff.update' : 'staff.assign',
        targetType: 'staff', targetId: row.uid,
        before,
        after: { roles: doc_.roles, active: true, venueIds: doc_.assignment.venueIds, challengeIds: doc_.assignment.challengeIds },
        reason: null
      });
      toast(`已把「${ROLE_INFO[role]?.label ?? role}」指派給 ${row.name ?? row.uid}`);
      state.open = null; state.draft = null;
      // 改到自己身上時要立刻反映（不然總管把自己降級後畫面還停在舊權限）
      if (row.uid === user()?.uid) await reloadIdentity();
    } catch (err) {
      toast(data.explain(err, '指派沒有成功。'), 'error');
    } finally {
      state.busy = false; render();
    }
  }

  async function toggleActive(row) {
    const off = row.active;
    const ok = await confirmDialog({
      title: off ? '停用這個身分？' : '重新啟用？',
      body: off
        ? `${row.name ?? row.uid} 會立刻失去全部賽務權限。紀錄會留著，之後可以再啟用。`
        : `${row.name ?? row.uid} 會拿回「${ROLE_INFO[row.role]?.label ?? row.role}」的權限。`,
      confirmText: off ? '停用' : '啟用',
      tone: off ? 'danger' : 'default'
    });
    if (!ok) return;

    state.busy = true; render();
    try {
      await data.setStaffActive(row.uid, off ? buildDeactivatePatch() : buildReactivatePatch());
      await data.writeAudit({
        action: off ? 'staff.deactivate' : 'staff.reactivate',
        targetType: 'staff', targetId: row.uid,
        before: { active: off }, after: { active: !off }, reason: null
      });
      toast(off ? '已停用' : '已啟用');
      if (row.uid === user()?.uid) await reloadIdentity();
    } catch (err) {
      toast(data.explain(err, '沒有成功。'), 'error');
    } finally {
      state.busy = false; render();
    }
  }

  // ── 畫面 ─────────────────────────────────────────────────

  function captainPicker(row) {
    const assigned = (state.teams ?? []).filter(t => t.captainUid === row.uid);
    const options = (state.teams ?? []).filter(t => t.divisionId === state.draft.divisionId);
    return el('section', { class: 'adm__captainPicker' }, [
      el('h3', { class: 'adm__sectionHead', text: '指派球隊隊長' }),
      el('p', { class: 'adm__note', text: '先選組別，再選球隊。指派後該用戶的「我的」會出現管理球隊按鈕，可編輯自己球隊的名冊。' }),
      state.teamError ? errBox('讀不到組別或球隊', state.teamError) : null,
      state.teams === null ? skeleton(2) : null,
      assigned.length ? el('ul', { class: 'adm__captainAssignments' }, assigned.map(team => el('li', { class: 'adm__captainAssignment' }, [
        el('span', { text: `${state.divisions.find(d => d.divisionId === team.divisionId)?.name || team.divisionId} · ${team.name || team.teamId}（隊長）` }),
        el('button', { type: 'button', class: 'btn btn--sm', disabled: state.busy, 'aria-label': `撤銷 ${team.name || team.teamId} 的隊長指派`, onClick: () => assignCaptain(row, team, true) }, '撤銷指派')
      ]))) : null,
      el('label', { class: 'adm__field' }, [el('span', { class: 'adm__fieldLabel', text: '組別' }),
        el('select', { 'aria-label': '隊長組別', disabled: state.busy || !!state.teamError, value: state.draft.divisionId,
          onChange: e => { state.draft.divisionId = e.target.value; state.draft.teamId = ''; render(); } }, [
          el('option', { value: '', text: '請選擇組別', selected: !state.draft.divisionId }),
          ...state.divisions.map(d => el('option', { value: d.divisionId, text: d.name || d.divisionId, selected: d.divisionId === state.draft.divisionId }))
        ])]),
      el('label', { class: 'adm__field' }, [el('span', { class: 'adm__fieldLabel', text: '球隊' }),
        el('select', { 'aria-label': '隊長球隊', disabled: state.busy || !state.draft.divisionId || !!state.teamError, value: state.draft.teamId,
          onChange: e => { state.draft.teamId = e.target.value; render(); } }, [
          el('option', { value: '', text: options.length ? '請選擇球隊' : '此組別目前沒有球隊', selected: !state.draft.teamId }),
          ...options.map(t => el('option', { value: t.teamId, text: `${t.name || t.teamId}${t.captainUid ? `（隊長：${t.captainName || '已指派'}）` : ''}`, selected: t.teamId === state.draft.teamId }))
        ])]),
      el('button', { type: 'button', class: 'btn btn--primary btn--lg', disabled: state.busy || !state.draft.teamId || !!state.teamError,
        onClick: () => assignCaptain(row, state.teams.find(t => t.teamId === state.draft.teamId)) }, iconText('team', '指派為球隊隊長'))
    ]);
  }

  async function assignCaptain(row, team, revoke = false) {
    if (!team || state.busy || !can('staff.assign')) return;
    if (!navigator.onLine) { toast('目前離線，請恢復連線後再指派。', 'warn'); return; }
    if (revoke || (team.captainUid && team.captainUid !== row.uid)) {
      const ok = await confirmDialog({ title: revoke ? `撤銷「${team.name}」的隊長指派？` : `更換「${team.name}」的隊長？`,
        body: revoke ? `${row.name || row.uid} 將失去這支球隊的管理權限。` : `原隊長 ${team.captainName || team.captainUid} 將失去這支球隊的管理權限，改由 ${row.name || row.uid} 管理。`,
        confirmText: revoke ? '撤銷指派' : '更換隊長' });
      if (!ok) return;
    }
    if (state.busy || !can('staff.assign')) return;
    state.busy = true; render();
    try {
      const result = await callFunction('assignTeamCaptain', { eventId: EVENT_ID, teamId: team.teamId, divisionId: team.divisionId,
        captainUid: revoke ? null : row.uid, previousCaptainUid: team.captainUid ?? null });
      if (result?.teamId !== team.teamId || !result.auditId) throw new Error('伺服器未回傳完整結果，請重新載入確認。');
      toast(revoke ? '已撤銷隊長指派' : `已指派 ${row.name || row.uid} 為「${team.name}」隊長`, 'success');
      if (state.open === row.uid && state.draft) state.draft.teamId = '';
    } catch (err) { toast(data.explain(err, '隊長指派未成功。'), 'error'); }
    finally { state.busy = false; render(); }
  }

  function roleChoice(role) {
    const on = state.draft.role === role;
    const info = ROLE_INFO[role] ?? {};
    // 向上包含要寫出來，不然總管會一個一個指派
    const implied = impliedBy(role).filter(r => r !== role);
    return el('button', {
      class: `adm__choice${on ? ' is-on' : ''}`, type: 'button',
      role: 'radio', 'aria-checked': on ? 'true' : 'false',
      onClick: () => pickRole(role)
    }, [
      el('span', { class: 'adm__choiceName', text: info.label ?? role }),
      implied.length
        ? el('span', {
            class: 'adm__choiceNote',
            text: `含 ${implied.map(r => ROLE_INFO[r]?.label ?? r).join('、')}`
          })
        : el('span', { class: 'adm__choiceNote', text: '不含其他身分' })
    ]);
  }

  function venuePicker() {
    if (!state.venues.length) return null;
    if (!onlyStaffScoped(state.draft.role) || state.draft.role === 'booth') return null;
    return el('div', { class: 'adm__field' }, [
      el('span', { class: 'adm__fieldLabel', text: '指派場地（不選＝全部場地）' }),
      el('div', { class: 'adm__choices' }, state.venues.map(v =>
        el('button', {
          class: `adm__chip${state.draft.venueIds.includes(v.venueId) ? ' is-on' : ''}`,
          type: 'button', 'aria-pressed': state.draft.venueIds.includes(v.venueId) ? 'true' : 'false',
          onClick: () => toggleVenue(v.venueId)
        }, el('span', { text: v.name ?? v.venueId }))))
    ]);
  }

  function challengePicker() {
    if (!onlyStaffScoped(state.draft.role)) return null;
    return el('div', { class: 'adm__field', id: 'staff-challenges' }, [
      el('span', { class: 'adm__fieldLabel', text: '負責的挑戰攤位（可複選）' }),
      el('p', { class: 'adm__note', text: '挑戰攤位身分必須至少選一關；其他賽務人員只可登錄這裡勾選的攤位。管理員與總管可登錄所有攤位。' }),
      state.challengesError ? errBox('讀不到攤位設定', state.challengesError) : null,
      el('div', { class: 'adm__choices', role: 'group', 'aria-label': '負責的挑戰攤位' }, state.challenges.map(c =>
        el('button', { class: `adm__chip${state.draft.challengeIds.includes(c.challengeId) ? ' is-on' : ''}`,
          type: 'button', 'aria-pressed': String(state.draft.challengeIds.includes(c.challengeId)),
          onClick: () => {
            const ids = state.draft.challengeIds;
            state.draft.challengeIds = ids.includes(c.challengeId) ? ids.filter(id => id !== c.challengeId) : [...ids, c.challengeId];
            render();
          }
        }, c.shortName ?? c.name)))
    ]);
  }

  function editor(row) {
    // 總管那一列連編輯器都不畫。把總管降成管理員在 rules 上是合法的
    // （admin 在白名單裡），所以擋不擋得住完全取決於這裡——
    // 而降下去之後再也升不回來。
    if (!assignableHere(row)) {
      return el('div', { class: 'adm__detail' }, [
        el('div', { class: 'adm__box adm__box--warn' }, [
          el('strong', { text: '總管的身分不能在這裡調整' }),
          el('p', {
            class: 'adm__note',
            text: '降級之後升不回來（可指派的清單裡沒有總管）。要增減總管請用 scripts/grant-super-admin.mjs。'
          })
        ]),
        captainPicker(row),
        el('p', { class: 'adm__uid', text: `uid ${row.uid}` })
      ]);
    }
    return el('div', { class: 'adm__detail' }, [
      el('h3', { class: 'adm__sectionHead', text: '指派身分' }),
      unmanagedRoles(row.roles).length
        ? el('p', {
            class: 'adm__note',
            text: `這個人身上還有這一頁管不到的角色：${unmanagedRoles(row.roles).join('、')}。指派新身分會把它們一起換掉。`
          })
        : null,
      el('div', { class: 'adm__choices', role: 'radiogroup', 'aria-label': '身分' },
        ROLE_ORDER.map(roleChoice)),
      // 總管是這一頁唯一給不出去的身分，講清楚為什麼比讓人到處找好
      el('p', { class: 'adm__note', text: '總管不在清單裡：那是唯一能指派身分的人，只能用後台腳本建立。' }),
      venuePicker(),
      challengePicker(),
      el('p', { class: 'adm__note', text: '儲存後，請人員到「FEDA CUP 挑戰區 → 攤位登錄」並按「更新權限」，即可掃碼或輸入挑戰卡號。' }),
      el('div', { class: 'adm__actions' }, [
        el('button', {
          class: 'btn btn--primary btn--lg', type: 'button',
          disabled: state.busy || !state.draft.role,
          onClick: () => save(row)
        }, iconText('check', row.assigned ? '更新身分' : '指派身分')),
        row.assigned
          ? el('button', {
              class: 'btn btn--lg', type: 'button', disabled: state.busy,
              onClick: () => toggleActive(row)
            }, iconText(row.active ? 'close' : 'check', row.active ? '停用' : '重新啟用'))
          : null
      ].filter(Boolean)),
      captainPicker(row),
      el('p', { class: 'adm__uid', text: `uid ${row.uid}` })
    ]);
  }

  function personItem(row) {
    const open = state.open === row.uid;
    const captainTeams = (state.teams ?? []).filter(t => t.captainUid === row.uid);
    const identity = captainTeams.length
      ? [row.assigned ? roleText(row) : null, `球隊隊長 · ${captainTeams.map(t => t.name || t.teamId).join('、')}`].filter(Boolean).join(' · ')
      : roleText(row);
    return el('li', { class: `adm__item${open ? ' is-open' : ''}` }, [
      el('button', {
        class: 'adm__itemHead', type: 'button',
        'aria-expanded': open ? 'true' : 'false',
        onClick: () => openRow(row.uid)
      }, [
        el('span', { class: 'adm__itemMain' }, [
          el('span', { class: 'adm__teamName', text: row.name || row.uid }),
          el('span', { class: 'adm__teamMeta', text: identity })
        ]),
        row.assigned
          ? el('span', {
              class: `adm__badge${row.active ? ' adm__badge--approved' : ''}`,
              text: row.active ? '已授權' : '已停用'
            })
          : null,
        icon(open ? 'up' : 'down')
      ].filter(Boolean)),
      open ? editor(row) : null
    ].filter(Boolean));
  }

  function render() {
    if (state.staff === null) { mount(root, adminHead('身分授權'), skeleton(4)); return; }

    const list = rows();
    const assigned = list.filter(r => r.assigned && r.active).length;

    mount(root,
      adminHead('身分授權', { sub: `${assigned} 位在職工作人員 · ${list.length} 人` }),

      // uid 查不到人時，正確的下一步是「請他登入一次」，不是繼續找
      el('div', { class: 'adm__box' }, [
        el('p', {
          class: 'adm__note',
          text: '這裡只列得出用 LINE 登入過的人。找不到某個人，請先請他到網站登入一次，名字就會出現。'
        })
      ]),

      state.usersError ? errBox('讀不到使用者名錄', state.usersError) : null,

      el('div', { class: 'adm__field' }, [
        el('input', {
          class: 'adm__search', type: 'search', value: state.q,
          placeholder: '搜尋名字或 uid', 'aria-label': '搜尋名字或 uid',
          onInput: e => { state.q = e.target.value; render(); }
        })
      ]),

      list.length
        ? el('ul', { class: 'adm__list' }, list.map(personItem))
        : el('p', { class: 'adm__empty', text: state.q ? '沒有符合的人。' : '還沒有人登入過。' })
    );
  }
}
