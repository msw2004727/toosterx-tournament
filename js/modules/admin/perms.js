/**
 * 權限開關 `#/admin/perms`
 * ------------------------------------------------------------------
 * 規格：docs/05、R-PERM-001、R-PERM-002、R-RULES-002
 *
 * 總管在這裡逐條調整每個身分能做的事。
 *
 * 四件不可協商：
 *   1. **開關按下去要真的有效果。** 調不動的那幾條（總管的三條、
 *      繼承來的那幾條）連開關都不畫，只寫原因——一顆按了沒反應的
 *      按鈕是最難回報的故障。
 *   2. **關掉之後誰不受影響，要寫在畫面上。** 關掉記錄員的送出完賽
 *      不會讓管理員也不能送出。少了這句，主辦會以為整個功能被關掉。
 *   3. **破壞性的那幾條要標出來**：那些同時寫在 `firestore.rules` 裡
 *      （R-PERM-002），關掉只是把按鈕收起來，資料還是由規則保護。
 *   4. **留痕**。誰在幾點關掉了哪一條。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式。
 */

import { el, mount, toast, skeleton, confirmDialog } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { can, onAuth, reloadIdentity } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { PERMISSION_BY_CODE } from '../../config.js';
import { permGroups, buildPermPatch } from '../../engine/perms.js';
import * as data from './data.js';
import { adminHead, denied } from './bits.js';

export async function adminPermsPage({ scope, view }) {
  const root = el('div', { class: 'adm' });
  mount(view, root);
  mount(root, skeleton(4));

  const state = { matrix: null, busy: null, error: null };

  if (!can('perms.manage')) { mount(root, denied('權限開關', '總管')); return; }

  data.watchRolePermissions(scope, m => { state.matrix = m; render(); }, err => {
    state.error = err;
    state.matrix = state.matrix ?? {};
    render();
  });

  hold(scope, onAuth(() => render()), 'auth:admin-perms');

  // ── 具名函式（會被提升）───────────────────────────────────

  async function toggle(row) {
    const p = PERMISSION_BY_CODE[row.code];
    const next = !row.on;

    if (!next) {
      // 關掉是收窄權限，現場會少一顆按鈕——先講清楚後果再關
      const keeps = row.stillAllowed.length
        ? `${row.stillAllowed.join('、')}仍然可以。`
        : '沒有其他身分保有這一項。';
      const ok = await confirmDialog({
        title: `關掉「${row.label}」？`,
        body: `${row.roleLabel}會立刻少掉這個功能。${keeps}`,
        confirmText: '關掉',
        tone: 'danger'
      });
      if (!ok) return;
    }

    const { role, patch } = buildPermPatch(p, next);
    state.busy = row.code; render();
    try {
      await data.setRolePermission(role, patch);
      await data.writeAudit({
        action: 'perms.toggle',
        targetType: 'rolePermissions', targetId: role,
        before: { [row.code]: row.on },
        after: { [row.code]: next },
        reason: null
      });
      toast(next ? `已打開「${row.label}」` : `已關掉「${row.label}」`);
      // 自己的權限也可能受影響（總管不會，但頁面別假設）——重讀一次身分
      await reloadIdentity();
    } catch (err) {
      toast(data.explain(err, '沒有改成功。'), 'error');
    } finally {
      state.busy = null; render();
    }
  }

  // ── 畫面 ─────────────────────────────────────────────────

  function permRow(row) {
    const busy = state.busy === row.code;
    return el('li', { class: `adm__perm${row.on ? '' : ' is-off'}` }, [
      el('div', { class: 'adm__permMain' }, [
        el('div', { class: 'adm__permTop' }, [
          el('span', { class: 'adm__permLabel', text: row.label }),
          row.pending
            ? el('span', { class: 'adm__tag' }, iconText('clock', '尚未上線'))
            : null,
          row.destructive
            ? el('span', {
                class: 'adm__tag',
                title: '這一條同時寫在 firestore.rules 裡，關掉只是把按鈕收起來'
              }, iconText('warn', '規則也擋'))
            : null
        ].filter(Boolean)),
        el('span', { class: 'adm__permMeta', text: `${row.roleLabel}（含以上）` }),
        // 關掉之後誰不受影響——這句話少了，主辦會以為整個功能被關掉
        !row.on && row.stillAllowed.length
          ? el('span', { class: 'adm__permNote', text: `${row.stillAllowed.join('、')}仍然可以` })
          : null,
        // 設定寫著「關」卻還是開著：某個下層角色留著一個 true。
        // 不講的話那位總管會一直按同一個開關。
        row.conflict
          ? el('span', {
              class: 'adm__permNote',
              text: `這一條被設成關閉，但仍然生效——${row.roleLabel}以下有一階把它打開著，設定沒有作用。`
            })
          : null,
        !row.editable
          ? el('span', { class: 'adm__permNote', text: row.lockReason })
          : null
      ].filter(Boolean)),

      row.editable
        ? el('button', {
            class: `adm__switch${row.on ? ' is-on' : ''}`, type: 'button',
            role: 'switch', 'aria-checked': row.on ? 'true' : 'false',
            'aria-label': `${row.label}（${row.roleLabel}）`,
            disabled: busy || state.busy !== null,
            onClick: () => toggle(row)
          }, el('span', { class: 'adm__switchKnob' }))
        // 調不動的不畫開關。畫一顆按了沒反應的開關比沒有更糟。
        : el('span', { class: 'adm__lock', 'aria-label': '不可調整' }, icon('warn'))
    ]);
  }

  function group(g) {
    return el('section', { class: 'adm__permGroup' }, [
      el('h3', { class: 'adm__sectionHead', text: g.group }),
      el('ul', { class: 'adm__perms' }, g.rows.map(permRow))
    ]);
  }

  function render() {
    if (state.matrix === null) { mount(root, adminHead('權限開關'), skeleton(4)); return; }

    const groups = permGroups(state.matrix);
    const rows = groups.flatMap(g => g.rows);
    const offCount = rows.filter(r => !r.on).length;
    const pendingCount = rows.filter(r => r.pending).length;

    mount(root,
      adminHead('權限開關', {
        sub: [offCount ? `${offCount} 項已關閉` : '全部維持預設',
              pendingCount ? `${pendingCount} 項功能尚未上線` : null].filter(Boolean).join('　·　')
      }),

      el('div', { class: 'adm__box' }, [
        el('p', {
          class: 'adm__note',
          text: '這裡調的是「畫面上看得到什麼」。標著「規則也擋」的那幾條同時寫在資料庫規則裡，關掉只是把按鈕收起來，資料仍然受保護。'
            + '改動不會推到已經開著賽務台的手機——那邊要重新整理或重新登入才會生效。'
        })
      ]),

      // 讀不到設定時走預設，不是全部關閉——把賽務按鈕全收掉，現場會以為系統壞了
      state.error
        ? el('div', { class: 'adm__box adm__box--warn', role: 'alert' }, [
            el('strong', { text: '讀不到權限設定，畫面顯示的是預設值' }),
            el('p', { class: 'adm__note', text: data.explain(state.error) })
          ])
        : null,

      ...groups.map(group)
    );
  }
}
