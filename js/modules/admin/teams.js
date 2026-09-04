/**
 * 報名審核 `#/admin/teams`
 * ------------------------------------------------------------------
 * 規格：docs/05 §8.2、docs/10 §3
 *
 * 主辦在這裡看送出來的球隊，逐隊核准或退回。
 *
 * 三件不可協商：
 *   1. **核准前一定看得到檢核結果**。超齡的罰則是取消整隊資格
 *      （規章第十八條第 3 款），在這裡擋下來比在比賽當天好得多。
 *   2. **退回一定要填原因**。沒有原因的退回，隊長只會看到「被退回」
 *      然後打電話問主辦。
 *   3. **留痕**。每一次核准／退回都寫一筆 audit（before/after/who/why）。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式，
 *    onSnapshot 的第一筆快照可能同步送達。
 */

import { el, mount, toast, skeleton, confirmDialog } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { user, can, onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { REGISTRATION_LIMITS } from '../../engine/formats.js';
import { reviewTeam as review, buildApprovePatch, buildRejectPatch } from '../../engine/review.js';
import { rocShort } from '../../lib/roc.js';
import * as data from './data.js';
import { adminHead, denied, TEAM_STATUS } from './bits.js';

/** 分頁。順序照「主辦一天要做的事」排：待審的排最前面。 */
const TABS = [
  { key: 'submitted', label: '待審核' },
  { key: 'approved',  label: '已通過' },
  { key: 'rejected',  label: '已退回' },
  { key: 'draft',     label: '草稿' }
];

export async function adminTeamsPage({ scope, view }) {
  const root = el('div', { class: 'adm' });
  mount(view, root);
  mount(root, skeleton(4));

  const state = {
    teams: null, divisions: [], tab: 'submitted',
    open: null,           // 展開中的 teamId
    members: {},          // teamId → members
    busy: false, error: null, loaded: false
  };

  if (!can('team.manage')) { mount(root, denied('報名審核', '管理員')); return; }

  data.getDivisions().then(d => { state.divisions = d; render(); })
    .catch(err => console.warn('[admin] divisions', err));

  data.watchTeams(scope, rows => {
    state.teams = rows;
    state.loaded = true;
    render();
  }, err => {
    state.loaded = true;
    mount(root, adminHead('報名審核'), errBox('讀不到球隊清單', err));
  });

  hold(scope, onAuth(() => render()), 'auth:admin-teams');

  // ── 具名函式（會被提升）───────────────────────────────────
  function divisionOf(id) { return state.divisions.find(d => d.divisionId === id) ?? null; }

  function rowsOf(tab) {
    return (state.teams ?? []).filter(t => (t.status || 'draft') === tab);
  }

  function errBox(title, err) {
    return el('div', { class: 'adm__box adm__box--warn', role: 'alert' }, [
      el('strong', { text: title }),
      el('p', { class: 'adm__note', text: data.explain(err) })
    ]);
  }

  function render() {
    if (!state.loaded) return;
    mount(root,
      adminHead('報名審核', { sub: `${(state.teams ?? []).length} 支球隊` }),
      state.error ? errBox('沒有送出去', { message: state.error }) : null,
      tabs(),
      list()
    );
  }

  function tabs() {
    return el('div', { class: 'adm__tabs', role: 'tablist' }, TABS.map(t => {
      const n = rowsOf(t.key).length;
      return el('button', {
        class: `adm__tab${t.key === state.tab ? ' is-on' : ''}`,
        type: 'button', role: 'tab',
        'aria-selected': t.key === state.tab ? 'true' : 'false',
        onClick: () => { state.tab = t.key; state.open = null; render(); }
      }, [
        el('span', { text: t.label }),
        el('span', { class: 'adm__tabCount num', text: String(n) })
      ]);
    }));
  }

  function list() {
    const rows = rowsOf(state.tab);
    if (!rows.length) {
      return el('p', { class: 'adm__empty', text: emptyTextOf(state.tab) });
    }
    return el('ul', { class: 'adm__list' }, rows.map(teamRow));
  }

  function emptyTextOf(tab) {
    if (tab === 'submitted') return '目前沒有待審核的球隊。隊長送出報名之後會出現在這裡。';
    if (tab === 'approved') return '還沒有通過的球隊。';
    if (tab === 'rejected') return '沒有被退回的球隊。';
    return '沒有還在草稿的球隊。';
  }

  function teamRow(t) {
    const open = state.open === t.teamId;
    const div = divisionOf(t.divisionId);
    return el('li', { class: `adm__item${open ? ' is-open' : ''}` }, [
      el('button', {
        class: 'adm__itemHead', type: 'button',
        'aria-expanded': open ? 'true' : 'false',
        onClick: () => toggle(t)
      }, [
        el('div', { class: 'adm__itemMain' }, [
          el('strong', { class: 'adm__teamName', text: t.name || t.teamId }),
          el('span', {
            class: 'adm__teamMeta',
            text: [div?.name || t.divisionId, `${t.memberCount ?? 0} 人`].filter(Boolean).join('　·　')
          })
        ]),
        el('span', { class: `adm__badge adm__badge--${t.status || 'draft'}`, text: TEAM_STATUS[t.status] || t.status }),
        icon(open ? 'up' : 'down')
      ]),
      open ? detail(t, div) : null
    ].filter(Boolean));
  }

  function detail(t, div) {
    const members = state.members[t.teamId];
    if (!members) return el('div', { class: 'adm__detail' }, skeleton(3));

    const r = review({ team: t, members, division: div, limits: REGISTRATION_LIMITS });

    return el('div', { class: 'adm__detail' }, [
      // ── 名單檢核 ──
      el('h3', { class: 'adm__sectionHead', text: '名單檢核' }),
      el('ul', { class: 'adm__checks' }, r.findings.map(f => el('li', {
        class: `adm__check adm__check--${f.level}`
      }, [
        icon(f.level === 'ok' ? 'check' : f.level === 'warn' ? 'info' : 'warn'),
        el('div', { class: 'adm__checkText' }, [
          el('span', { text: f.message }),
          el('span', { class: 'adm__checkSrc', text: f.source })
        ])
      ]))),

      // ── 名單 ──
      el('h3', { class: 'adm__sectionHead', text: `名單（球員 ${r.players}・隊職員 ${r.staff}）` }),
      el('ul', { class: 'adm__roster' }, members
        .filter(m => m.status === 'approved')
        .map(m => el('li', { class: 'adm__member' }, [
          el('span', { class: 'adm__no num', text: m.jerseyNo != null ? String(m.jerseyNo) : '—' }),
          el('span', { class: 'adm__memberName', text: m.name || '（未填）' }),
          el('span', {
            class: 'adm__memberMeta',
            // 審核要核對的就是這兩格；生日用民國年，跟證件一致
            text: [m.birthDate ? rocShort(m.birthDate) : null,
                   m.idLast4 ? `末四碼 ${m.idLast4}` : null].filter(Boolean).join('　·　')
          })
        ]))),

      t.rejectReason
        ? el('p', { class: 'adm__note', text: `上次退回原因：${t.rejectReason}` })
        : null,

      actions(t, r)
    ].filter(Boolean));
  }

  function actions(t, r) {
    const status = t.status || 'draft';
    if (status === 'approved') {
      return el('div', { class: 'adm__actions' }, [
        el('p', { class: 'adm__note', text: '已通過，名單已鎖定。要改名單請先退回。' }),
        el('button', {
          class: 'btn btn--lg', type: 'button', disabled: state.busy,
          onClick: () => doReject(t, '（已通過後退回）')
        }, '退回這支球隊')
      ]);
    }
    if (status === 'draft') {
      return el('p', { class: 'adm__note', text: '這支球隊還沒送出報名，不用審核。' });
    }

    return el('div', { class: 'adm__actions' }, [
      // 有 error 就不畫核准鈕——畫一顆按了會被擋的按鈕比沒有更糟
      r.canApprove
        ? el('button', {
            class: 'btn btn--lg btn--primary', type: 'button', disabled: state.busy,
            onClick: () => doApprove(t)
          }, iconText('check', '核准並鎖定名單'))
        : el('p', { class: 'adm__blocked' },
            iconText('warn', '有必須修正的問題，先請隊長改完再送。')),
      el('button', {
        class: 'btn btn--lg', type: 'button', disabled: state.busy,
        onClick: () => doReject(t)
      }, '退回補件')
    ]);
  }

  // ── 動作 ────────────────────────────────────────────────

  async function toggle(t) {
    if (state.open === t.teamId) { state.open = null; render(); return; }
    state.open = t.teamId;
    render();
    if (state.members[t.teamId]) return;
    try {
      state.members[t.teamId] = await data.getMembers(t.teamId);
    } catch (err) {
      console.error('[admin] members', err);
      state.members[t.teamId] = [];
      state.error = data.explain(err, '讀不到這支球隊的名單。');
    }
    render();
  }

  async function doApprove(t) {
    const ok = await confirmDialog({
      title: `核准「${t.name}」？`,
      body: '核准後名單會鎖定，隊長不能再增減。要改只能由你退回。',
      confirmText: '核准'
    });
    if (!ok) return;
    await run(t, buildApprovePatch(user()?.uid ?? null), 'team.approve', null, `已核准「${t.name}」`);
  }

  async function doReject(t, preset) {
    const reason = await askReason(t, preset);
    if (reason == null) return;
    let patch;
    try {
      patch = buildRejectPatch(user()?.uid ?? null, reason);
    } catch (err) {
      state.error = err.message; render(); return;
    }
    await run(t, patch, 'team.reject', reason, `已退回「${t.name}」`);
  }

  async function run(t, patch, action, reason, okMsg) {
    state.busy = true; state.error = null; render();
    try {
      await data.reviewTeam(t.teamId, patch);
      // 留痕：before/after/who/when/why（不可協商的產品行為第 3 條）
      await data.writeAudit({
        action, targetType: 'team', targetId: t.teamId,
        before: { status: t.status ?? null, rosterLocked: t.rosterLocked ?? false },
        after: { status: patch.status, rosterLocked: patch.rosterLocked },
        reason
      });
      toast(okMsg, 'success');
      state.open = null;
    } catch (err) {
      console.error('[admin] review', err);
      state.error = data.explain(err);
    } finally {
      state.busy = false;
      render();
    }
  }

  /** 退回原因。必填——沒有原因的退回，隊長只會看到「被退回」。 */
  function askReason(t, preset) {
    return new Promise(resolve => {
      let text = preset ?? '';
      const input = el('textarea', {
        class: 'adm__textarea', rows: '3',
        placeholder: '例：12 號球員超齡，請確認出生年月日',
        value: text,
        onInput: e => { text = e.target.value; hint.hidden = !!text.trim(); }
      });
      const hint = el('p', { class: 'adm__blocked', text: '一定要填原因，隊長才知道要改什麼。', hidden: !!text.trim() });

      const dlg = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '退回補件' }, [
        el('div', { class: 'modal__panel' }, [
          el('h2', { class: 'modal__title', text: `退回「${t.name}」` }),
          el('div', { class: 'modal__body' }, [
            el('p', { class: 'adm__note', text: '退回之後名單會解凍，隊長可以修改再送一次。' }),
            input, hint
          ]),
          el('div', { class: 'modal__actions' }, [
            el('button', { class: 'btn btn--ghost', type: 'button', onClick: () => done(null) }, '取消'),
            el('button', {
              class: 'btn btn--danger', type: 'button',
              onClick: () => { if (text.trim()) done(text.trim()); else hint.hidden = false; }
            }, '確定退回')
          ])
        ])
      ]);
      const onKey = e => { if (e.key === 'Escape') done(null); };
      function done(v) { document.removeEventListener('keydown', onKey); dlg.remove(); resolve(v); }
      dlg.addEventListener('click', e => { if (e.target === dlg) done(null); });
      document.addEventListener('keydown', onKey);
      document.body.append(dlg);
      input.focus();
    });
  }
}
