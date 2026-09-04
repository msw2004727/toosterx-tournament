/**
 * T39 稽核紀錄
 * ------------------------------------------------------------------
 * 規格：docs/05、R-SEC-002
 *
 * 兩件事：
 *   ・**兩種欄位形狀都讀得懂**。稽核紀錄不可以改寫，所以舊資料
 *     只能在讀取時收斂——這條正規化要永遠留著。
 *   ・**每一筆都變成人看得懂的一句話**。一坨 JSON 對主辦沒有用。
 */

import {
  normalizeAudit, describeAudit, actorText, filterAudits, AUDIT_FILTERS
} from '../../js/engine/audit.js';

/** 管理後台早期的形狀（demo 上真的有 14 筆） */
const oldShape = (over = {}) => ({
  auditId: 'a1', action: 'team.approve',
  targetType: 'team', targetId: 't-113',
  before: { status: 'submitted' }, after: { status: 'approved' },
  reason: null, actor: { uid: 'U-mai', at: '2026-09-04T03:00:00Z' },
  createdAt: null, ...over
});

/** 賽務端與結果管線的形狀 */
const newShape = (over = {}) => ({
  action: 'match.finish.undo', entity: 'match', entityId: 'AO-G-A-01',
  before: null, after: null, reason: null,
  actor: { uid: 'U-sc', name: '陳賽務' },
  createdAt: '2026-09-04T04:00:00Z', ...over
});

const LOOKUP = {
  teams: { 't-113': '臺中晨星足球隊' },
  people: { 'U-mai': '金小麥', 'demo-user-1': '王小明' }
};

describe('T39-A 兩種欄位形狀', () => {
  test('⭐ 舊形狀（targetType / targetId）讀得懂', () => {
    const a = normalizeAudit(oldShape());
    expect(a.entity).toBe('team');
    expect(a.entityId).toBe('t-113');
  });

  test('⭐ 新形狀（entity / entityId）讀得懂', () => {
    const a = normalizeAudit(newShape());
    expect(a.entity).toBe('match');
    expect(a.entityId).toBe('AO-G-A-01');
  });

  test('⭐ 兩邊都有時以 entity 為準（管理後台已經改用它）', () => {
    const a = normalizeAudit({ entity: 'staff', entityId: 'u-1', targetType: 'team', targetId: 't-9' });
    expect(a.entity).toBe('staff');
    expect(a.entityId).toBe('u-1');
  });

  test('目標種類翻成中文，不認得的照原樣', () => {
    expect(normalizeAudit(oldShape()).entityLabel).toBe('球隊');
    expect(normalizeAudit(newShape({ entity: 'weird' })).entityLabel).toBe('weird');
    expect(normalizeAudit({ action: 'x' }).entityLabel).toBe('—');
  });

  test('⭐ 讀不到的欄位回 null，不猜', () => {
    // 猜錯的方向是「把某個人的操作算到另一個人頭上」，比顯示「未知」糟得多
    const a = normalizeAudit({ action: 'x' });
    expect(a.actorUid).toBeNull();
    expect(a.actorName).toBeNull();
    expect(a.entityId).toBeNull();
  });

  test('⭐ 還沒同步的時間戳是 null，不填本機時間', () => {
    // serverTimestamp 在本機快照上是 null。填本機時間會讓稽核的時間軸失真。
    expect(normalizeAudit(newShape({ createdAt: null, actor: { uid: 'u' } })).at).toBeNull();
  });

  test('舊形狀退回 actor.at（那時候時間存在 actor 裡）', () => {
    expect(normalizeAudit(oldShape()).at).toBe('2026-09-04T03:00:00Z');
  });

  test('壞資料不會炸掉整頁', () => {
    expect(normalizeAudit(null)).toBeNull();
    expect(normalizeAudit('x')).toBeNull();
    expect(normalizeAudit({}).action).toBeNull();
    expect(normalizeAudit({ action: 123 }).action).toBeNull();
  });
});

describe('T39-B 變成人話', () => {
  const d = (raw, lk = LOOKUP) => describeAudit(normalizeAudit(raw), lk);

  test('⭐ 核准：帶得出球隊名字，而且講出後果', () => {
    const r = d(oldShape());
    expect(r.title).toBe('核准了「臺中晨星足球隊」的報名');
    expect(r.detail.join(' ')).toContain('名單已鎖定');
  });

  test('⭐ 退回：一定看得到原因', () => {
    // 沒有原因的退回，隊長只會打電話問主辦——稽核頁也要看得到那句話
    const r = d(oldShape({ action: 'team.reject', reason: '兩位球員都是 1 號' }));
    expect(r.title).toContain('退回');
    expect(r.detail.join(' ')).toContain('兩位球員都是 1 號');
    expect(r.detail.join(' ')).toContain('解凍');
  });

  test('⭐ 指派身分：角色代碼要翻成中文', () => {
    const r = d(oldShape({
      action: 'staff.assign', targetType: 'staff', targetId: 'demo-user-1',
      before: null, after: { roles: ['scorer'] }
    }));
    expect(r.title).toBe('把「記錄員」指派給 王小明');
  });

  test('改身分看得出「從什麼變成什麼」', () => {
    const r = d(oldShape({
      action: 'staff.update', targetType: 'staff', targetId: 'demo-user-1',
      before: { roles: ['booth'] }, after: { roles: ['referee'] }
    }));
    expect(r.title).toContain('從「挑戰攤位」改成「裁判」');
  });

  test('停用講出「紀錄留著」（不然會以為被刪了）', () => {
    const r = d(oldShape({ action: 'staff.deactivate', targetType: 'staff', targetId: 'demo-user-1' }));
    expect(r.title).toContain('停用');
    expect(r.detail.join(' ')).toContain('紀錄留著');
  });

  test('⭐ 權限開關：權限碼與角色都要翻成中文', () => {
    const r = d(oldShape({
      action: 'perms.toggle', targetType: 'rolePermissions', targetId: 'scorer',
      before: { 'match.finish': true }, after: { 'match.finish': false }
    }));
    expect(r.title).toBe('關閉了「記錄員」的「送出完賽」');
  });

  test('權限打開的敘述不一樣', () => {
    const r = d(oldShape({
      action: 'perms.toggle', targetType: 'rolePermissions', targetId: 'checkin',
      before: { 'member.read': false }, after: { 'member.read': true }
    }));
    expect(r.title).toContain('打開');
    expect(r.title).toContain('檢錄員');
  });

  test('賽務端的撤回與作廢也有分支', () => {
    expect(d(newShape()).title).toContain('撤回');
    expect(d(newShape({ action: 'timeline.void' })).detail.join(' ')).toContain('不會被刪除');
    expect(d(newShape({ action: 'advancement.resolve', entityId: 'u10' })).title).toContain('晉級');
  });

  test('⭐ 不認得的動作照原樣印出來，不吞掉', () => {
    // 日後新增的動作在這裡沒有分支時，主辦仍然要看得到「發生過某件事」
    const r = d(newShape({ action: 'future.thing', entity: 'team', entityId: 't-1' }));
    expect(r.title).toContain('future.thing');
    expect(r.title).toContain('t-1');
  });

  test('⭐ 查不到名字時退回 id，不顯示空白', () => {
    const r = describeAudit(normalizeAudit(oldShape({ targetId: 't-999' })), {});
    expect(r.title).toContain('t-999');
  });
});

describe('T39-B2 「by 誰」', () => {
  const a = normalizeAudit(oldShape());

  test('⭐ 名字用 lookup 查（紀錄上的 actor.name 不能信）', () => {
    expect(actorText(a, LOOKUP)).toBe('金小麥');
  });

  test('⭐ 查不到就退回 uid，不顯示空白', () => {
    expect(actorText(a, {})).toBe('U-mai');
    expect(actorText(normalizeAudit({ action: 'x' }), LOOKUP)).toBe('（不明）');
  });

  test('結果管線寫的那些顯示「系統」', () => {
    expect(actorText(normalizeAudit({ action: 'advancement.resolve', actor: { uid: null, name: 'system' } }), LOOKUP))
      .toBe('系統');
  });

  test('壞輸入不炸', () => {
    expect(actorText(null)).toBe('（不明）');
    expect(actorText(undefined, LOOKUP)).toBe('（不明）');
  });
});

describe('T39-C 篩選與搜尋', () => {
  const rows = [
    oldShape(),
    oldShape({ action: 'staff.assign', targetType: 'staff', targetId: 'demo-user-1', after: { roles: ['scorer'] } }),
    oldShape({ action: 'perms.toggle', targetType: 'rolePermissions', targetId: 'scorer', after: { 'match.finish': false } }),
    newShape()
  ].map(normalizeAudit);

  test('分組把每一筆都收得進去（沒有孤兒）', () => {
    for (const a of rows) {
      const hit = AUDIT_FILTERS.filter(f => f.key !== 'all' && f.match(a));
      expect(hit.length).toBe(1);
    }
  });

  test('依分組篩選', () => {
    expect(filterAudits(rows, { filter: 'team' })).toHaveLength(1);
    expect(filterAudits(rows, { filter: 'staff' })).toHaveLength(1);
    expect(filterAudits(rows, { filter: 'match' })).toHaveLength(1);
    expect(filterAudits(rows, { filter: 'all' })).toHaveLength(4);
  });

  test('⭐ 搜尋比對的是畫面上那句話，不是原始欄位', () => {
    // 使用者搜的是他看到的字。搜 t-113 找不到「臺中晨星」等於搜尋壞了。
    expect(filterAudits(rows, { q: '臺中晨星', lookup: LOOKUP })).toHaveLength(1);
    expect(filterAudits(rows, { q: '記錄員', lookup: LOOKUP })).toHaveLength(2);
  });

  test('⭐ 搜得到畫面上那個「by 誰」', () => {
    // 2026-09-04 在真站上實測到：每一列都寫著「by 金小麥」，
    // 搜「金小麥」卻是 0 筆——畫面與搜尋各算了一份「by 誰」。
    // 現在兩邊都用 actorText()。
    expect(filterAudits(rows, { q: '金小麥', lookup: LOOKUP })).toHaveLength(3);
    expect(filterAudits(rows, { q: '陳賽務', lookup: { people: { 'U-sc': '陳賽務' } } })).toHaveLength(1);
  });

  test('也搜得到 uid 與原始 id（跨系統對帳用）', () => {
    expect(filterAudits(rows, { q: 'U-mai', lookup: LOOKUP })).toHaveLength(3);   // 第 4 筆是 U-sc
    expect(filterAudits(rows, { q: 'U-sc', lookup: LOOKUP })).toHaveLength(1);
    expect(filterAudits(rows, { q: 't-113', lookup: LOOKUP })).toHaveLength(1);
  });

  test('篩選與搜尋可以疊加', () => {
    expect(filterAudits(rows, { filter: 'staff', q: '記錄員', lookup: LOOKUP })).toHaveLength(1);
  });

  test('壞輸入不會炸掉', () => {
    expect(filterAudits(null, {})).toEqual([]);
    expect(filterAudits(rows, { filter: '不存在' })).toHaveLength(4);
    expect(filterAudits(rows, {})).toHaveLength(4);
  });
});
