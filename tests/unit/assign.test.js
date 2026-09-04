/**
 * T36 身分授權
 * ------------------------------------------------------------------
 * 規格：docs/10 §5.1、R-RULES-003、R-ROLE-002
 *
 * 這一份守的是「介面指派不出總管」與「向上包含要講出來」。
 * 前者是提權漏洞，後者是誤用——總管會以為要一個一個指派。
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ASSIGNABLE_ROLES, impliedBy, validateAssignment, onlyStaffScoped, assignableHere,
  unmanagedRoles, buildStaffDoc, buildDeactivatePatch, buildReactivatePatch, mergeDirectory
} from '../../js/engine/assign.js';
import { STAFF_CHAIN, ROLE_INFO } from '../../js/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('T36-A 可指派的身分', () => {
  test('⭐ 不含 super_admin', () => {
    // R-RULES-003。這是整份檔案最重要的一條：介面上指派得出總管，
    // 等於「只要當過一次管理員就能永久掌控整個系統」。
    expect(ASSIGNABLE_ROLES).not.toContain('super_admin');
  });

  test('⭐ 與 firestore.rules 的 staffRolesAssignable() 白名單完全一致', () => {
    // 分岔的兩個方向都很糟：介面多一個 → 送出被擋、看起來像壞掉；
    // rules 多一個 → 有人手動送請求就拿得到，介面上完全看不出來。
    const src = fs.readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
    const start = src.indexOf('function staffRolesAssignable(');
    const rest = src.slice(start + 1);
    const end = start + 1 + (rest.indexOf('function ') < 0 ? rest.length : rest.indexOf('function '));
    const m = /hasOnly\(\[([^\]]+)\]\)/.exec(src.slice(start, end));
    const rules = m[1].split(',').map(s => s.trim().replace(/'/g, ''));
    expect([...ASSIGNABLE_ROLES].sort()).toEqual([...rules].sort());
  });

  test('就是繼承鏈扣掉最上面那一階', () => {
    expect(ASSIGNABLE_ROLES).toEqual(STAFF_CHAIN.slice(0, -1));
    expect(ASSIGNABLE_ROLES).toContain('admin');
    expect(ASSIGNABLE_ROLES).toContain('booth');
  });

  test('每一個都在全站角色字典裡', () => {
    for (const r of ASSIGNABLE_ROLES) expect(ROLE_INFO).toHaveProperty(r);
  });
});

describe('T36-B 向上包含要看得見', () => {
  test('⭐ 指派記錄員＝同時給了挑戰攤位／檢錄員／裁判', () => {
    // 介面不講的話，總管會四個角色各指派一次
    expect(impliedBy('scorer')).toEqual(['booth', 'checkin', 'referee', 'scorer']);
  });

  test('挑戰攤位只有自己', () => {
    expect(impliedBy('booth')).toEqual(['booth']);
  });

  test('管理員含全部賽務角色', () => {
    expect(impliedBy('admin')).toEqual(['booth', 'checkin', 'referee', 'scorer', 'admin']);
  });
});

describe('T36-C 指派前的驗證', () => {
  const base = { uid: 'U123', role: 'scorer' };

  test('正常的指派放行', () => {
    expect(validateAssignment(base).ok).toBe(true);
  });

  test('⭐ super_admin 被擋，而且訊息說得出唯一的正路', () => {
    const r = validateAssignment({ ...base, role: 'super_admin' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('SUPER_ADMIN_FORBIDDEN');
    expect(r.message).toContain('grant-super-admin');
  });

  test('沒選人、沒選身分都擋得住', () => {
    expect(validateAssignment({ ...base, uid: '' }).code).toBe('NO_UID');
    expect(validateAssignment({ ...base, uid: '   ' }).code).toBe('NO_UID');
    expect(validateAssignment({ ...base, uid: null }).code).toBe('NO_UID');
    expect(validateAssignment({ ...base, role: '' }).code).toBe('NO_ROLE');
  });

  test('不認得的身分擋得住（不是安靜地寫進去）', () => {
    expect(validateAssignment({ ...base, role: 'venue_owner' }).code).toBe('UNKNOWN_ROLE');
    expect(validateAssignment({ ...base, role: 'captain' }).code).toBe('UNKNOWN_ROLE');
  });

  test('⭐ 指派到不存在的場地要擋', () => {
    // 放行的話那個人什麼場次都經手不到，而且完全沒有錯誤訊息
    const r = validateAssignment({ ...base, venueIds: ['venue-z'], knownVenueIds: ['venue-a'] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('UNKNOWN_VENUE');
    expect(r.message).toContain('venue-z');
  });

  test('沒給場地清單就不檢查（設定讀不到時不要卡住指派）', () => {
    expect(validateAssignment({ ...base, venueIds: ['venue-z'] }).ok).toBe(true);
  });

  test('⭐ 管理員不受場地限制，給了場地要擋', () => {
    // rules 的 assignedVenue() 對 admin 直接放行，畫面上讓人選場地
    // 只會製造「我明明限制了他只能在 A 場」的錯覺
    const r = validateAssignment({ uid: 'U1', role: 'admin', venueIds: ['venue-a'] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('VENUE_NOT_APPLICABLE');
    expect(r.message).toContain('管理員');
  });

  test('管理員不給場地就放行', () => {
    expect(validateAssignment({ uid: 'U1', role: 'admin' }).ok).toBe(true);
  });

  test('onlyStaffScoped：賽務角色受限、管理員不受限', () => {
    expect(onlyStaffScoped('scorer')).toBe(true);
    expect(onlyStaffScoped('booth')).toBe(true);
    expect(onlyStaffScoped('admin')).toBe(false);
    expect(onlyStaffScoped('super_admin')).toBe(false);
  });
});

describe('T36-C2 總管那一列動不得', () => {
  test('⭐ 總管不能在介面上被改身分', () => {
    // rules 會放行（admin 在白名單裡），所以擋不擋得住完全看這裡。
    // 降下去之後升不回來，最後一位總管降級＝再也沒有人指派得了身分。
    expect(assignableHere({ role: 'super_admin' })).toBe(false);
  });

  test('其他人都可以', () => {
    for (const role of [...ASSIGNABLE_ROLES, null]) {
      expect(assignableHere({ role })).toBe(true);
    }
    expect(assignableHere(null)).toBe(true);
  });
});

describe('T36-C3 這一頁管不到的角色', () => {
  test('⭐ 已移除的舊角色要照原樣印出來', () => {
    // venue_lead 在 M3.5 已從角色字典移除，但 demo 上還留著一份 staff 文件。
    // 顯示成「未指派」的話總管永遠不會發現它還在資料庫裡。
    expect(unmanagedRoles(['venue_lead'])).toEqual(['venue_lead']);
  });

  test('FC 同步過來的角色也算（captain／coach／venue_owner）', () => {
    expect(unmanagedRoles(['captain', 'scorer', 'coach'])).toEqual(['captain', 'coach']);
  });

  test('賽務角色與總管都不算', () => {
    for (const r of [...ASSIGNABLE_ROLES, 'super_admin']) {
      expect(unmanagedRoles([r])).toEqual([]);
    }
  });

  test('壞資料不會炸掉整頁', () => {
    expect(unmanagedRoles()).toEqual([]);
    expect(unmanagedRoles(null)).toEqual([]);
    expect(unmanagedRoles('scorer')).toEqual([]);
  });
});

describe('T36-D 組出 staff 文件', () => {
  test('⭐ roles 只存被指派的那一個，不存展開後的四個', () => {
    // 存展開的話「他到底被指派了什麼」就再也看不出來，
    // 而且之後調整階層要重寫所有人的資料
    const d = buildStaffDoc({ uid: 'U1', name: '阿明', role: 'scorer', eventId: 'e1' });
    expect(d.roles).toEqual(['scorer']);
  });

  test('lineUserId 等於 uid（跨專案對帳的鍵）', () => {
    const d = buildStaffDoc({ uid: 'U1', name: '阿明', role: 'booth', eventId: 'e1' });
    expect(d.lineUserId).toBe('U1');
    expect(d.uid).toBe('U1');
  });

  test('active 預設 true、assignment 的四個欄位都在', () => {
    const d = buildStaffDoc({ uid: 'U1', role: 'referee', eventId: 'e1', venueIds: ['venue-a'] });
    expect(d.active).toBe(true);
    expect(d.assignment).toEqual({
      eventId: 'e1', date: null, venueIds: ['venue-a'], divisionIds: [], challengeIds: []
    });
  });

  test('⭐ 管理員的場地一律清空', () => {
    const d = buildStaffDoc({ uid: 'U1', role: 'admin', eventId: 'e1', venueIds: ['venue-a'] });
    expect(d.assignment.venueIds).toEqual([]);
  });

  test('場地是複本，不是同一個陣列（呼叫端之後改了不會污染文件）', () => {
    const v = ['venue-a'];
    const d = buildStaffDoc({ uid: 'U1', role: 'scorer', eventId: 'e1', venueIds: v });
    v.push('venue-b');
    expect(d.assignment.venueIds).toEqual(['venue-a']);
  });

  test('沒填名字存 null，不存 undefined（Firestore 不收 undefined）', () => {
    expect(buildStaffDoc({ uid: 'U1', role: 'booth', eventId: 'e1' }).name).toBeNull();
  });
});

describe('T36-E 停用', () => {
  test('⭐ 停用是改 active，不是刪文件', () => {
    // 刪掉的話「這筆比分是誰記的」就查不到人了
    const p = buildDeactivatePatch();
    expect(p).toEqual({ active: false });
    expect(p).not.toHaveProperty('roles');
  });

  test('可以復用', () => {
    expect(buildReactivatePatch()).toEqual({ active: true });
  });
});

describe('T36-F 名錄合併', () => {
  const users = [
    { uid: 'U1', displayName: '阿明' },
    { uid: 'U2', displayName: '小華' },
    { uid: 'U3', displayName: '阿美' }
  ];
  const staff = [
    { uid: 'U2', name: '小華', roles: ['scorer'], active: true, assignment: { venueIds: ['venue-a'] } }
  ];

  test('登入過但沒身分的人也要列出來（不然指派不到）', () => {
    const rows = mergeDirectory(users, staff);
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.uid).sort()).toEqual(['U1', 'U2', 'U3']);
  });

  test('⭐ 有身分的排前面', () => {
    expect(mergeDirectory(users, staff)[0].uid).toBe('U2');
  });

  test('⭐ 有身分的排前面，即使名字排在後面', () => {
    // 上一條其實分不出「有沒有身分」與「level 高低」——記錄員的 level
    // 本來就比未指派高。這一條的角色不在繼承鏈上（level 與未指派相同），
    // 所以只剩「有沒有身分」決定得了順序。
    const rows = mergeDirectory(
      [{ uid: 'U-a', displayName: 'AAA' }, { uid: 'U-z', displayName: 'ZZZ' }],
      [{ uid: 'U-z', roles: ['captain'], active: true }]
    );
    expect(rows.map(r => r.uid)).toEqual(['U-z', 'U-a']);
  });

  test('帶出角色、啟用狀態與場地', () => {
    const row = mergeDirectory(users, staff)[0];
    expect(row.role).toBe('scorer');
    expect(row.active).toBe(true);
    expect(row.assigned).toBe(true);
    expect(row.venueIds).toEqual(['venue-a']);
  });

  test('⭐ 只在 staff 裡、不在名錄裡的人也要列出來', () => {
    // 用腳本建立的大總管就是這種：staff 有、users 沒有。
    // 漏掉的話總管在自己的授權頁上看不到自己。
    const rows = mergeDirectory([], [{ uid: 'U9', name: '大總管', roles: ['super_admin'], active: true }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('大總管');
    expect(rows[0].role).toBe('super_admin');
  });

  test('名錄的 LINE 名稱優先於 staff 上的名字', () => {
    const rows = mergeDirectory([{ uid: 'U2', displayName: 'LINE小華' }], staff);
    expect(rows[0].name).toBe('LINE小華');
  });

  test('停用的身分仍然列出來（要看得到才復用得了）', () => {
    const rows = mergeDirectory(users, [{ uid: 'U1', roles: ['booth'], active: false }]);
    expect(rows[0].uid).toBe('U1');
    expect(rows[0].active).toBe(false);
    expect(rows[0].assigned).toBe(true);
  });

  test('⭐ 同樣有身分時照 level 由高到低', () => {
    const rows = mergeDirectory(users, [
      { uid: 'U1', roles: ['booth'], active: true },
      { uid: 'U2', roles: ['admin'], active: true },
      { uid: 'U3', roles: ['scorer'], active: true }
    ]);
    expect(rows.map(r => r.uid)).toEqual(['U2', 'U3', 'U1']);
  });

  test('非繼承鏈的角色（captain 等）不會被誤認成賽務身分', () => {
    const rows = mergeDirectory(users, [{ uid: 'U1', roles: ['captain'], active: true }]);
    expect(rows[0].role).toBeNull();
  });

  test('⭐ 但原始的 roles 要留著（畫面才印得出「其他身分」）', () => {
    // 只留 chainRole 的話，一份 venue_lead 的殘留身分會顯示成
    // 「已授權 · 未指派」——看起來像壞掉，而且沒有人會去清它。
    const rows = mergeDirectory(users, [{ uid: 'U1', roles: ['venue_lead'], active: true }]);
    expect(rows[0].roles).toEqual(['venue_lead']);
    expect(unmanagedRoles(rows[0].roles)).toEqual(['venue_lead']);
  });

  test('沒有 staff 文件的人 roles 是空陣列，不是 undefined', () => {
    expect(mergeDirectory([{ uid: 'U9', displayName: '路人' }], [])[0].roles).toEqual([]);
  });

  test('缺 uid 的資料略過，不會炸掉整頁', () => {
    expect(mergeDirectory([{ displayName: '沒有uid' }, null], [null, {}])).toHaveLength(0);
    expect(mergeDirectory(null, null)).toHaveLength(0);
    expect(mergeDirectory()).toHaveLength(0);
  });
});
