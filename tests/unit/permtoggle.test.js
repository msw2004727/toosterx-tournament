/**
 * T37 權限開關
 * ------------------------------------------------------------------
 * 規格：docs/05、R-PERM-001、R-PERM-002
 *
 * 這一份守的是三件事，三件都是「開關按下去到底有沒有用」：
 *   ・總管的三條調不動（調得動就再也打不開了）
 *   ・繼承來的那幾條調不動（聯集會把它蓋回去，開關等於沒作用）
 *   ・關掉之後誰不受影響，要講得出來
 */

import {
  ownerRole, editableRole, stillAllowed, permState, permGroups, buildPermPatch
} from '../../js/engine/perms.js';
import {
  PERMISSIONS, PERMISSION_BY_CODE, PERMISSION_GROUPS, STAFF_CHAIN, effectivePerms
} from '../../js/config.js';

/** 種子寫進 rolePermissions 的形狀：每個角色列出自己**預設**拿得到的全部權限 */
const seedMatrix = () => Object.fromEntries(STAFF_CHAIN.map(role => {
  const mine = PERMISSIONS.filter(p => STAFF_CHAIN.slice(0, STAFF_CHAIN.indexOf(role) + 1).includes(p.minRole));
  return [role, { role, perms: Object.fromEntries(mine.map(p => [p.code, true])) }];
}));

const P = code => PERMISSION_BY_CODE[code];

describe('T37-A 調得動與調不動', () => {
  test('⭐ 總管的三條一律調不動', () => {
    // effectivePerms() 對 super_admin 直接回全部權限——這是刻意的
    // （關掉「調整權限開關」之後就再也打不開了）。
    // 所以開關按下去不會有任何效果，那就是一顆按了沒反應的按鈕。
    for (const code of ['staff.assign', 'perms.manage', 'registration.manage']) {
      const r = editableRole(P(code), 'super_admin');
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('總管');
    }
  });

  test('⭐ 在來源那一階調得動', () => {
    expect(editableRole(P('match.finish'), 'scorer').ok).toBe(true);
    expect(editableRole(P('checkin.write'), 'checkin').ok).toBe(true);
    expect(editableRole(P('matchsheet.write'), 'referee').ok).toBe(true);
  });

  test('⭐ 功能還沒上線的調不動（開關按了不會有效果）', () => {
    // 2026-09-04：`match.finish` 沒有標 pending，賽務台卻從來沒問過 can()——
    // 主辦關掉之後按鈕照樣在。現在 pending 由靜態掃描盯著（T42-8）。
    //
    // ⚠️ **不要在這裡寫死某一條權限碼。** 功能一上線那條的 pending 就會被
    //    拿掉，這條測試就跟著紅——但它要守的是「pending 會讓開關鎖住」
    //    這個行為，不是某一條權限的狀態。提醒拿掉旗標是 T42-8 的職責。
    //    （`schedule.manage` 與 `challenge.attempt.write` 各讓這裡紅過一次。）
    const pending = PERMISSIONS.filter(p => p.pending === true && p.minRole !== 'super_admin');
    expect(pending.length).toBeGreaterThan(0);      // 全部上線了就該改寫這條測試
    for (const p of pending) {
      const r = editableRole(p, p.minRole);
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('還沒上線');
    }
  });

  test('⭐ 繼承來的那一階調不動，而且說得出要去哪裡調', () => {
    // 這是這一頁最容易做錯的地方：在「記錄員」列關掉挑戰成績登錄，
    // 會被「挑戰攤位」列的 true 蓋過去——開關完全沒有作用。
    const r = editableRole(P('checkin.write'), 'scorer');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('檢錄員');
  });

  test('⭐ 這個限制是真的：在繼承的那一階寫 false 沒有效果', () => {
    // 上一條測的是「介面擋住了」，這一條測的是「擋住是對的」。
    // 少了這一條，把 editableRole 放寬會看起來沒有壞掉。
    const m = seedMatrix();
    m.scorer.perms['challenge.attempt.write'] = false;
    expect(effectivePerms(['scorer'], m).has('challenge.attempt.write')).toBe(true);
  });

  test('⭐ 在來源那一階寫 false 是真的會關掉', () => {
    const m = seedMatrix();
    m.booth.perms['challenge.attempt.write'] = false;
    expect(effectivePerms(['booth'], m).has('challenge.attempt.write')).toBe(false);
  });
});

describe('T37-B 關掉之後誰不受影響', () => {
  test('⭐ 記錄員的權限關掉，管理員與總管仍然有', () => {
    // 少了這句話，主辦會以為整個功能被關掉了，然後在現場找不到人送出完賽
    expect(stillAllowed(P('match.finish'))).toEqual(['admin', 'super_admin']);
  });

  test('挑戰攤位的權限關掉，上面四階都還有', () => {
    expect(stillAllowed(P('challenge.attempt.write')))
      .toEqual(['checkin', 'referee', 'scorer', 'admin', 'super_admin']);
  });

  test('管理員的權限關掉，只剩總管', () => {
    expect(stillAllowed(P('team.manage'))).toEqual(['super_admin']);
  });

  test('⭐ 這句話是真的：關掉記錄員之後管理員仍然拿得到', () => {
    const m = seedMatrix();
    m.scorer.perms['match.finish'] = false;
    expect(effectivePerms(['scorer'], m).has('match.finish')).toBe(false);
    expect(effectivePerms(['admin'], m).has('match.finish')).toBe(true);
  });

  test('不認得的角色不會炸掉', () => {
    expect(stillAllowed({ minRole: 'venue_lead' })).toEqual([]);
  });
});

describe('T37-C 現在的狀態', () => {
  test('種子的矩陣＝全部開著', () => {
    const m = seedMatrix();
    for (const p of PERMISSIONS) expect(permState(p, m).on).toBe(true);
  });

  test('⭐ 讀不到矩陣走預設，不是全部關閉', () => {
    // 規矩 3：設定讀取失敗的當下把賽務按鈕全部收掉，現場會以為系統壞了
    for (const p of PERMISSIONS) {
      expect(permState(p, {}).on).toBe(true);
      expect(permState(p, undefined).on).toBe(true);
      expect(permState(p, null).on).toBe(true);
    }
  });

  test('關掉之後 on 變 false、changed 變 true', () => {
    const m = seedMatrix();
    m.scorer.perms['match.finish'] = false;
    const st = permState(P('match.finish'), m);
    expect(st.on).toBe(false);
    expect(st.stored).toBe(false);
    expect(st.changed).toBe(true);
  });

  test('沒動過的不算「已調整」（畫面上不要到處是黃點）', () => {
    expect(permState(P('match.finish'), seedMatrix()).changed).toBe(false);
    expect(permState(P('match.finish'), {}).changed).toBe(false);
  });

  test('⭐ 設定寫著「關」但被下層蓋過去時，on 要說實話', () => {
    // 這是唯一分得出「用 effectivePerms」與「直接讀 stored」的情境：
    // 某個下層角色還留著一個 true，「開優先於關」讓它贏了。
    // 介面若照 stored 顯示成「關」，那位總管會一直按同一個開關，
    // 然後以為系統壞了——實際上是設定真的沒有生效。
    const m = seedMatrix();
    m.referee.perms['matchsheet.write'] = false;
    m.booth.perms['matchsheet.write'] = true;      // 下層殘留的 true
    const st = permState(P('matchsheet.write'), m);
    expect(st.stored).toBe(false);
    expect(st.on).toBe(true);                      // 實際上還是開著
    expect(st.conflict).toBe(true);
    expect(effectivePerms(['referee'], m).has('matchsheet.write')).toBe(true);
  });

  test('正常關掉不算衝突', () => {
    const m = seedMatrix();
    m.scorer.perms['match.finish'] = false;
    expect(permState(P('match.finish'), m).conflict).toBe(false);
  });

  test('⭐ on 用的是 effectivePerms 本尊，不是另外算一份', () => {
    // 兩份實作遲早分岔，而分岔的方向是「畫面說開著、實際上關著」
    const m = seedMatrix();
    for (const role of STAFF_CHAIN) {
      if (role === 'super_admin') continue;
      const eff = effectivePerms([role], m);
      for (const p of PERMISSIONS.filter(x => x.minRole === role)) {
        expect(permState(p, m).on).toBe(eff.has(p.code));
      }
    }
  });
});

describe('T37-D 整張表', () => {
  const groups = permGroups(seedMatrix());

  test('分組順序照 PERMISSION_GROUPS', () => {
    expect(groups.map(g => g.group)).toEqual(PERMISSION_GROUPS);
  });

  test('⭐ 每一條權限都出現，剛好一次', () => {
    // 漏掉一條的話那條權限就永遠關不掉，而且沒有人會發現
    const codes = groups.flatMap(g => g.rows.map(r => r.code));
    expect(codes.sort()).toEqual(PERMISSIONS.map(p => p.code).sort());
  });

  test('⭐ 角色標在每一列，不標在組標題', () => {
    // 「賽務」組裡同時有裁判的（出場名單）與記錄員的（比分、完賽）
    const 賽務 = groups.find(g => g.group === '賽務');
    expect(new Set(賽務.rows.map(r => r.role))).toEqual(new Set(['referee', 'scorer']));
    expect(賽務).not.toHaveProperty('role');
  });

  test('破壞性的那幾條標得出來（rules 也擋，畫面要講）', () => {
    const rows = groups.flatMap(g => g.rows);
    expect(rows.find(r => r.code === 'match.finish').destructive).toBe(true);
    expect(rows.find(r => r.code === 'member.read').destructive).toBe(false);
  });

  test('總管那三條 editable 是 false', () => {
    const 總管 = groups.find(g => g.group === '總管');
    expect(總管.rows.every(r => r.editable === false)).toBe(true);
    expect(總管.rows.every(r => r.on === true)).toBe(true);
  });

  test('其他每一條都調得動（每條權限都在自己的來源那一列）', () => {
    for (const g of groups) {
      if (g.group === '總管') continue;
      for (const r of g.rows) {
        if (r.pending) { expect(r.editable).toBe(false); continue; }   // 功能還沒上線
        expect(r.editable).toBe(true);
      }
    }
  });

  test('⭐ 功能還沒上線的那幾條標得出來', () => {
    // ⚠️ **不要寫死某一條權限碼。** 功能一上線那條的 pending 就會被拿掉，
    //    這條測試就跟著紅——但它要守的是「pending 有沒有被帶到畫面那一層」，
    //    不是某一條權限現在的狀態。提醒拿掉旗標是 T42-8 的職責。
    //    （`schedule.manage`、`challenge.attempt.write`、`match.confirm`
    //      各讓這裡紅過一次。）
    const rows = groups.flatMap(g => g.rows);
    for (const p of PERMISSIONS) {
      const row = rows.find(r => r.code === p.code);
      expect(row).toBeTruthy();
      expect(row.pending).toBe(p.pending === true);
    }
    // 至少要有一條已經上線的，不然這條斷言等於沒測到東西
    expect(rows.some(r => r.pending === false)).toBe(true);
  });
});

describe('T37-E 寫入的內容', () => {
  test('⭐ 只動一個欄位（整份覆蓋會把其他設定一起抹掉）', () => {
    const { role, patch } = buildPermPatch(P('match.finish'), false);
    expect(role).toBe('scorer');
    expect(patch).toEqual({ role: 'scorer', perms: { 'match.finish': false } });
  });

  test('打開也是同一支', () => {
    expect(buildPermPatch(P('checkin.write'), true).patch.perms)
      .toEqual({ 'checkin.write': true });
  });

  test('⭐ 總管的權限丟錯，不是安靜地寫進去', () => {
    expect(() => buildPermPatch(P('perms.manage'), false)).toThrow(/總管/);
  });

  test('⭐ 只收 boolean（undefined 寫進去會變成「沒設定」）', () => {
    expect(() => buildPermPatch(P('match.finish'), undefined)).toThrow();
    expect(() => buildPermPatch(P('match.finish'), null)).toThrow();
    expect(() => buildPermPatch(P('match.finish'), 'false')).toThrow();
    expect(() => buildPermPatch(P('match.finish'), 0)).toThrow();
  });

  test('ownerRole 就是 minRole', () => {
    for (const p of PERMISSIONS) expect(ownerRole(p)).toBe(p.minRole);
  });
});
