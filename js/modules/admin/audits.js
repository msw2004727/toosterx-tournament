/**
 * 稽核紀錄 `#/admin/audits`
 * ------------------------------------------------------------------
 * 規格：docs/05、R-SEC-002
 *
 * 「一切可修正、一切留痕」是不可協商的產品行為第 3 條。這一頁是那個
 * 「留痕」唯一看得到的地方。
 *
 * 四件不可協商：
 *   1. **整頁唯讀。** 稽核紀錄只能新增（R-SEC-002），所以這裡連一顆
 *      會改東西的按鈕都不該有——包括「清除」。
 *   2. **每一筆都是一句人話。** 一坨 JSON 對主辦沒有用；翻譯在
 *      `js/engine/audit.js`，不認得的動作照原樣印出來、不吞掉。
 *   3. **名字讀取時再查。** 紀錄上的 `actor.name` 不能信（custom token
 *      登入的人那一格永遠是 null）。先查 `users/{uid}`，查不到再查
 *      `staff/{uid}`——用腳本建立的總管與 demo 自助身分只有後者。
 *   4. **還沒同步的時間顯示「同步中」**，不要填本機時間——那會讓
 *      稽核的時間軸失真，而時間軸正是這一頁的用途。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式。
 */

import { el, mount, skeleton } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { can, onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { dateLabel, hhmm, toMillis } from '../../lib/format.js';
import { normalizeAudit, describeAudit, actorText, filterAudits, AUDIT_FILTERS } from '../../engine/audit.js';
import * as data from './data.js';
import { adminHead, denied } from './bits.js';

const MAX = 200;

export async function adminAuditsPage({ scope, view }) {
  const root = el('div', { class: 'adm' });
  mount(view, root);
  mount(root, skeleton(4));

  const state = {
    rows: null, lookup: { people: {}, teams: {} },
    filter: 'all', q: '', error: null
  };

  if (!can('audit.read')) { mount(root, denied('稽核紀錄', '管理員')); return; }

  data.getAudits(MAX)
    .then(raw => { state.rows = raw.map(normalizeAudit).filter(Boolean); render(); })
    .catch(err => { state.error = err; state.rows = []; render(); });

  // 名字查不到不影響主要內容（會退回 id），所以失敗只警告
  data.getAuditLookup()
    .then(lk => { state.lookup = lk; render(); })
    .catch(err => console.warn('[admin] audit lookup', err));

  hold(scope, onAuth(() => render()), 'auth:admin-audits');

  // ── 具名函式（會被提升）───────────────────────────────────

  function visible() {
    return filterAudits(state.rows ?? [], {
      filter: state.filter, q: state.q, lookup: state.lookup
    });
  }

  /**
   * 「by 誰」由引擎算，搜尋用的也是同一支——兩份實作分岔的結果是
   * 「畫面寫著金小麥、搜金小麥卻 0 筆」（2026-09-04 在真站上實測到）。
   *
   * ⚠️ 寫成具名函式而不是 `const`：render() 會用到它，而 render()
   *    可能在宣告之前就被呼叫（CLAUDE.md 的順序陷阱，踩過五次）。
   */
  function whoText(a) { return actorText(a, state.lookup); }

  /** 「10/9（四） 15:04」。還沒同步的一律說「同步中」，不猜。 */
  function whenText(a) {
    if (toMillis(a.at) == null) return '同步中';
    return `${dateLabel(a.at)} ${hhmm(a.at)}`;
  }

  // ── 畫面 ─────────────────────────────────────────────────

  function auditItem(a) {
    const d = describeAudit(a, state.lookup);
    return el('li', { class: 'adm__audit' }, [
      el('div', { class: 'adm__auditTop' }, [
        el('span', { class: 'adm__auditWhen num', text: whenText(a) }),
        el('span', { class: 'adm__badge', text: a.entityLabel })
      ]),
      el('p', { class: 'adm__auditTitle', text: d.title }),
      ...d.detail.map(t => el('p', { class: 'adm__auditNote', text: t })),
      el('p', { class: 'adm__auditWho', text: `by ${whoText(a)}` })
    ]);
  }

  function tabs() {
    return el('div', { class: 'adm__tabs', role: 'tablist' }, AUDIT_FILTERS.map(f => {
      const on = state.filter === f.key;
      const n = filterAudits(state.rows ?? [], { filter: f.key, q: state.q, lookup: state.lookup }).length;
      return el('button', {
        class: `adm__tab${on ? ' is-on' : ''}`, type: 'button',
        role: 'tab', 'aria-selected': on ? 'true' : 'false',
        onClick: () => { state.filter = f.key; render(); }
      }, [
        el('span', { text: f.label }),
        el('span', { class: 'adm__tabCount', text: String(n) })
      ]);
    }));
  }

  function render() {
    if (state.rows === null) { mount(root, adminHead('稽核紀錄'), skeleton(4)); return; }

    const list = visible();
    const total = state.rows.length;

    mount(root,
      adminHead('稽核紀錄', {
        // 滿 200 筆時要講出來，不然主辦會以為「就只有這些」
        sub: total >= MAX ? `最近 ${MAX} 筆` : `${total} 筆`
      }),

      state.error
        ? el('div', { class: 'adm__box adm__box--warn', role: 'alert' }, [
            el('strong', { text: '讀不到稽核紀錄' }),
            el('p', { class: 'adm__note', text: data.explain(state.error) })
          ])
        : null,

      tabs(),

      el('div', { class: 'adm__field' }, [
        el('input', {
          class: 'adm__search', type: 'search', value: state.q,
          placeholder: '搜尋球隊、姓名或 uid', 'aria-label': '搜尋稽核紀錄',
          onInput: e => { state.q = e.target.value; render(); }
        })
      ]),

      list.length
        ? el('ul', { class: 'adm__audits' }, list.map(auditItem))
        : el('p', {
            class: 'adm__empty',
            text: total ? '沒有符合的紀錄。' : '還沒有任何紀錄。核准報名、指派身分、調整權限都會留在這裡。'
          }),

      // 這一頁是唯讀的，而且「唯讀」本身是一條規則，值得寫出來
      el('p', { class: 'adm__note' }, [
        icon('info'),
        document.createTextNode(' 稽核紀錄只能新增，任何人都改不動也刪不掉。')
      ])
    );
  }
}
