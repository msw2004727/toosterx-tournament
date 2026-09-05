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
import { feeOf, refundPolicy, refundAmount, buildWithdrawPatch } from '../../engine/refund.js';
import { rocShort } from '../../lib/roc.js';
import { toMillis, dateLabel, hhmm } from '../../lib/format.js';
import * as data from './data.js';
import { adminHead, denied, TEAM_STATUS, KIND_LABEL } from './bits.js';

/** 分頁。順序照「主辦一天要做的事」排：待審的排最前面。 */
const TABS = [
  { key: 'submitted', label: '待審核' },
  { key: 'approved',  label: '已通過' },
  { key: 'rejected',  label: '已退回' },
  { key: 'withdrawn', label: '已取消' },
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

  function isStaffMember(m) { return (m?.kind ?? m?.role ?? 'player') !== 'player'; }

  /** 已核准的成員：球員先（依背號），隊職員後 */
  function sortForReview(list) {
    const rows = (list ?? []).filter(m => m.status === 'approved');
    const byNo = (a, b) => (a.jerseyNo ?? 999) - (b.jerseyNo ?? 999);
    return [
      ...rows.filter(m => !isStaffMember(m)).sort(byNo),
      ...rows.filter(isStaffMember)
    ];
  }

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
    if (tab === 'withdrawn') return '沒有取消報名的球隊。';
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
      // ⚠️ 球員排前面。Firestore 的 orderBy('jerseyNo') 會把 null 排在最前，
      //    於是沒有背號的隊職員擋在名單開頭——而審核要看的是球員。
      el('ul', { class: 'adm__roster' }, sortForReview(members).map(m => el('li', {
        class: `adm__member${isStaffMember(m) ? ' adm__member--staff' : ''}`
      }, [
          el('span', { class: 'adm__no num', text: m.jerseyNo != null ? String(m.jerseyNo) : '—' }),
          el('span', { class: 'adm__memberName', text: m.name || '（未填）' }),
          el('span', {
            class: 'adm__memberMeta',
            // 審核要核對的就是這兩格；生日用民國年，跟證件一致
            text: isStaffMember(m)
              ? (KIND_LABEL[m.kind || m.role] || '隊職員')
              : [m.birthDate ? rocShort(m.birthDate) : null,
                 m.idLast4 ? `末四碼 ${m.idLast4}` : null].filter(Boolean).join('　·　')
          })
        ]))),

      t.rejectReason
        ? el('p', { class: 'adm__note', text: `上次退回原因：${t.rejectReason}` })
        : null,

      cancelBox(t, div),
      actions(t, r)
    ].filter(Boolean));
  }

  // ── 取消報名與退費（規章第二十七條）────────────────────
  function policyFor(t, div, forceMajeure = false) {
    const requestedAtMs = toMillis(t.cancelRequest?.at) ?? Date.now();
    return refundPolicy({ requestedAtMs, eventDateIso: div?.date ?? null, forceMajeure });
  }

  function cancelBox(t, div) {
    const req = t.cancelRequest;
    if (t.status === 'withdrawn') {
      const r = t.refund;
      return el('div', { class: 'adm__box adm__box--warn' }, [
        el('strong', { text: '已取消報名' }),
        r
          ? el('p', { class: 'adm__note', text:
              `退費 NT$ ${Number(r.amount ?? 0).toLocaleString()}（規章算 NT$ ${Number(r.suggested ?? 0).toLocaleString()}）` +
              (r.forceMajeure ? '・不可抗力' : '') + (r.note ? `・${r.note}` : '') })
          : null
      ].filter(Boolean));
    }
    if (req?.status !== 'requested') return null;
    const p = policyFor(t, div);
    return el('div', { class: 'adm__box adm__box--warn', role: 'status' }, [
      el('strong', {}, iconText('warn', '隊長申請取消報名')),
      el('p', { class: 'adm__note', text: `原因：${req.reason ?? '（沒填）'}` +
        (req.at ? `・${dateLabel(req.at)} ${hhmm(req.at)}` : '') }),
      el('p', { class: 'adm__note', text: p.ready ? `${p.text}。報名費 NT$ ${feeOf(div).toLocaleString()}，規章算出來退 NT$ ${refundAmount({ fee: feeOf(div), policy: p }).toLocaleString()}。` : p.reason })
    ]);
  }

  async function doWithdraw(t, div, forceMajeure) {
    const fee = feeOf(div);
    const policy = policyFor(t, div, forceMajeure);
    if (!policy.ready) { state.error = policy.reason; render(); return; }
    const suggested = refundAmount({ fee, policy });
    const ok = await confirmDialog({
      title: `取消「${t.name}」的報名？`,
      body: `${policy.text}。\n報名費 NT$ ${fee.toLocaleString()}，規章算出來退 NT$ ${suggested.toLocaleString()}。\n` +
            '取消後這支球隊不再排賽程，公開端也不會顯示。這個動作不能復原。',
      confirmText: '取消報名並記退費', tone: 'danger'
    });
    if (!ok) return;
    // 金額用瀏覽器的 prompt（同 #/admin/match）：一天用不到幾次，少一個自製元件就少一處要驗的版面
    const amountText = window.prompt(`實際退費金額（規章算 NT$ ${suggested.toLocaleString()}）：`, String(suggested));
    if (amountText == null) return;
    const amount = Number.parseInt(String(amountText).replace(/[^\d]/g, ''), 10);
    let note = '';
    if (amount !== suggested) {
      note = window.prompt('退費金額跟規章算出來的不一樣，請寫原因（會寫進紀錄）：') ?? '';
      if (!note.trim()) { toast('金額不同就一定要寫原因', 'warn'); return; }
    }
    let patch;
    try { patch = buildWithdrawPatch({ team: t, fee, policy, amount, note, forceMajeure, actorUid: user()?.uid ?? null }); }
    catch (err) { toast(err.message, 'warn'); return; }
    await run(t, patch, 'team.withdraw', note || policy.text, `已取消「${t.name}」的報名，退費 NT$ ${amount.toLocaleString()}`);
  }

  function withdrawButtons(t) {
    const div = divisionOf(t.divisionId);
    return [
      el('button', {
        class: 'btn btn--lg', type: 'button', disabled: state.busy, dataset: { act: 'withdraw' },
        onClick: () => doWithdraw(t, div, false)
      }, iconText('close', '取消報名／退費')),
      el('button', {
        class: 'btn btn--lg', type: 'button', disabled: state.busy, dataset: { act: 'withdraw-fm' },
        onClick: () => doWithdraw(t, div, true)
      }, '不可抗力：全額退費')
    ];
  }

  function actions(t, r) {
    const status = t.status || 'draft';
    if (status === 'withdrawn') {
      return el('p', { class: 'adm__note', text: '已取消報名。要恢復請聯絡開發者（退費紀錄不會自動回復）。' });
    }
    if (status === 'approved') {
      return el('div', { class: 'adm__actions' }, [
        el('p', { class: 'adm__note', text: '已通過，名單已鎖定。要改名單請先退回。' }),
        el('button', {
          class: 'btn btn--lg', type: 'button', disabled: state.busy,
          onClick: () => doReject(t, '（已通過後退回）')
        }, '退回這支球隊'),
        ...withdrawButtons(t)
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
      }, '退回補件'),
      ...withdrawButtons(t)
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
        after: {
          status: patch.status,
          rosterLocked: patch.rosterLocked ?? t.rosterLocked ?? false,
          // 取消報名時把退費依據與金額留在紀錄上
          ...(patch.refund ? { refund: { rule: patch.refund.rule, amount: patch.refund.amount, suggested: patch.refund.suggested } } : {})
        },
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
