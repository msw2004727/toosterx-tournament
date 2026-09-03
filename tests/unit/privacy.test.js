/**
 * T33 隱私與公開投影（js/engine/privacy.js）
 * ------------------------------------------------------------------
 * 規格：R-PRIV-001、docs/03 §7.3、docs/01b §1.6.1
 *
 * 這一組守的是「什麼東西可以離開 members」。錯的方向只有一個方向會痛：
 * 漏遮一個小孩的真名。所以每一條邊界都往 fail-closed 那邊測。
 */
import {
  maskName, isMinor, publicDisplayName, rosterProjection,
  extraRosterFields, ROSTER_FIELDS, MASK_AGE
} from '../../js/engine/privacy.js';

describe('T33-1 遮蔽姓名', () => {
  test('姓氏＋名字首字＋＊（docs/03 §7.3）', () => {
    expect(maskName('王小明')).toBe('王小＊');
    expect(maskName('歐陽小明')).toBe('歐陽＊');
  });

  test('兩個字以下維持原樣', () => {
    // 「王＊」只剩姓，家長在名單上找不到自己的小孩會直接打電話問主辦
    expect(maskName('王明')).toBe('王明');
    expect(maskName('王')).toBe('王');
    expect(maskName('')).toBe('');
    expect(maskName(null)).toBe('');
  });
});

describe('T33-2 年齡判定', () => {
  test('滿 13 歲就不遮', () => {
    expect(isMinor('2013-10-09', '2026-10-09')).toBe(false);   // 生日當天剛好滿 13
    expect(isMinor('2013-10-08', '2026-10-09')).toBe(false);
    expect(isMinor('2000-01-01', '2026-10-09')).toBe(false);
  });

  test('⭐ 生日還沒到就還沒滿，要遮', () => {
    expect(isMinor('2013-10-10', '2026-10-09')).toBe(true);    // 差一天
    expect(isMinor('2013-11-01', '2026-10-09')).toBe(true);
    expect(isMinor('2016-03-14', '2026-10-09')).toBe(true);
  });

  test('⭐ 生日缺漏或格式不對一律當成未成年（fail-closed）', () => {
    // 反過來寫的話，一筆沒填生日的兒童資料會直接以真名出現在公開端
    for (const bad of [null, undefined, '', '2016/03/14', '20160314', '2016-13-01', '2016-03-99', 'abc']) {
      expect(isMinor(bad, '2026-10-09')).toBe(true);
    }
    expect(isMinor('2000-01-01', null)).toBe(true);            // 基準日也讀不到
  });

  test('門檻可調，預設 13', () => {
    expect(MASK_AGE).toBe(13);
    expect(isMinor('2010-01-01', '2026-10-09', 18)).toBe(true);
    expect(isMinor('2010-01-01', '2026-10-09', 13)).toBe(false);
  });
});

describe('T33-3 公開顯示名', () => {
  const asOf = '2026-10-09';

  test('⭐ 依年齡決定，不是依組別', () => {
    // 兒童組偶爾有超齡的隨隊職員，成人組也可能有未滿 13 歲的球員
    expect(publicDisplayName({ name: '王小明', birthDate: '2016-03-14' }, asOf)).toBe('王小＊');
    expect(publicDisplayName({ name: '李教練', birthDate: '1985-06-02' }, asOf)).toBe('李教練');
  });

  test('沒有 birthDate 就遮', () => {
    expect(publicDisplayName({ name: '王小明' }, asOf)).toBe('王小＊');
  });
});

describe('T33-4 公開投影（docs/01b §1.6.1）', () => {
  const asOf = '2026-10-09';
  const member = {
    memberId: 'm-1', guardianUid: 'u-parent', isSelf: false,
    name: '王小明', birthDate: '2016-03-14', idLast4: '1234',
    jerseyNo: 7, position: 'MF', role: 'player',
    isCaptain: true, isGoalkeeper: false,
    photoUrl: 'https://example.com/kid.jpg',
    stats: { apps: 3, goals: 2, assists: 1, yellow: 1, red: 0 },
    note: '隊長備註', consent: { given: true }, source: 'guardian',
    status: 'approved'
  };

  test('⭐ 私密欄位一個都不准出現', () => {
    const p = rosterProjection(member, { teamId: 't-1', divisionId: 'u10', asOf });
    for (const k of ['guardianUid', 'birthDate', 'idLast4', 'note', 'consent', 'source', 'status', 'name']) {
      expect(p).not.toHaveProperty(k);
    }
    expect(extraRosterFields(p)).toEqual([]);
    expect(Object.keys(p).sort()).toEqual([...ROSTER_FIELDS].sort());
  });

  test('⭐ 用「挑出來」而不是「刪掉不要的」：members 多長一個欄位不會外洩', () => {
    const p = rosterProjection({ ...member, secretNewField: '不該出現' },
      { teamId: 't-1', divisionId: 'u10', asOf });
    expect(JSON.stringify(p)).not.toContain('不該出現');
  });

  test('⭐ 未滿 13 歲遮名，且照片預設不公開', () => {
    const p = rosterProjection(member, { teamId: 't-1', divisionId: 'u10', asOf });
    expect(p.displayName).toBe('王小＊');
    expect(p.photoUrl).toBeNull();
  });

  test('明確同意才帶照片，"沒說不要" 不算同意', () => {
    const adult = { ...member, birthDate: '1990-01-01' };
    expect(rosterProjection(adult, { asOf, photoConsent: true }).photoUrl).toBe('https://example.com/kid.jpg');
    for (const c of [undefined, null, false, 'true', 1]) {
      expect(rosterProjection(adult, { asOf, photoConsent: c }).photoUrl).toBeNull();
    }
  });

  test('排序：球員依背號，職員排在後面', () => {
    expect(rosterProjection({ ...member, jerseyNo: 7 }, { asOf }).order).toBe(7);
    expect(rosterProjection({ ...member, role: 'player', jerseyNo: null }, { asOf }).order).toBe(900);
    expect(rosterProjection({ ...member, role: 'coach' }, { asOf }).order).toBeGreaterThan(900);
    expect(rosterProjection({ ...member, role: 'staff' }, { asOf }).order)
      .toBeGreaterThan(rosterProjection({ ...member, role: 'coach' }, { asOf }).order);
  });

  test('stats 缺漏補 0，不會是 undefined', () => {
    const p = rosterProjection({ memberId: 'm-2', name: '李四', birthDate: '1990-01-01' }, { asOf });
    expect(p.stats).toEqual({ apps: 0, goals: 0, assists: 0, yellow: 0, red: 0 });
  });

  test('docs/10 用 kind、docs/01b 用 role，兩種都吃得下', () => {
    expect(rosterProjection({ ...member, role: undefined, kind: 'coach' }, { asOf }).role).toBe('coach');
  });
});

describe('T40 暱稱名單（學童組由教練建立）', () => {
  const ASOF = '2026-10-09';

  test('⭐ nameKind:nickname 不再遮一次', () => {
    // 那一格填的本來就是暱稱不是真名，系統從頭到尾沒存過孩子的全名。
    // 遮成「小豆＊」遮不到任何個資，只會讓家長以為名字被打錯。
    const m = { name: '小豆子', nameKind: 'nickname', birthDate: '2017-03-05' };
    expect(publicDisplayName(m, ASOF)).toBe('小豆子');
  });

  test('⭐ 沒有 nameKind 的還是照年齡遮（家長自己填的那條路）', () => {
    // applyMember() 不會寫 nameKind，所以家長填的真名仍然受保護。
    // 這個例外只對 addMemberByCoach() 寫進來的那幾筆生效。
    const m = { name: '王小明', birthDate: '2017-03-05' };
    expect(publicDisplayName(m, ASOF)).toBe('王小＊');
  });

  test('⭐ nameKind 是別的值也照樣遮（白名單，不是黑名單）', () => {
    for (const k of ['legal', '', null, undefined, 'nick', 'NICKNAME']) {
      const m = { name: '王小明', nameKind: k, birthDate: '2017-03-05' };
      expect(publicDisplayName(m, ASOF)).toBe('王小＊');
    }
  });

  test('成年人不受影響（本來就不遮）', () => {
    expect(publicDisplayName({ name: '王大明', birthDate: '1990-01-01' }, ASOF)).toBe('王大明');
  });

  test('公開投影帶著暱稱出去，私密欄位一個都沒有', () => {
    const out = rosterProjection({
      memberId: 'm-1', name: '小豆子', nameKind: 'nickname',
      birthDate: '2017-03-05', idLast4: '1234', guardianUid: 'u-cap',
      jerseyNo: 9, kind: 'player', status: 'approved'
    }, { teamId: 't-1', divisionId: 'u10', asOf: ASOF });

    expect(out.displayName).toBe('小豆子');
    expect(out.birthDate).toBeUndefined();
    expect(out.idLast4).toBeUndefined();
    expect(out.nameKind).toBeUndefined();
    expect(extraRosterFields(out)).toEqual([]);
  });
});
