/**
 * T43 報名審核的名單檢核
 * ------------------------------------------------------------------
 * 規格：docs/05 §8.2、docs/10 §3；競賽規章第十一、十二條
 *
 * 這一組守兩件事，兩件的方向相反：
 *   ① 該擋的要擋住——超齡的罰則是**取消整隊資格**（第十八條第 3 款），
 *      在核准前擋下來比在比賽當天被檢錄員抓到好得多
 *   ② 不該擋的不要擋——規章沒寫、也不會弄錯結果的事情升成 error，
 *      等於系統替主辦訂了一條規章沒有的規則
 */

import { reviewTeam, buildApprovePatch, buildRejectPatch, personKeysOf } from '../../js/engine/review.js';
import { DIVISIONS, REGISTRATION_LIMITS as L } from '../../js/engine/formats.js';

const byId = Object.fromEntries(DIVISIONS.map(d => [d.divisionId, d]));
const U10 = byId['u10'];          // 2016-09-01 以後
const ADULT = byId['adult-open'];

const player = (over = {}) => ({
  memberId: 'm-1', name: '小豆子', kind: 'player', status: 'approved',
  birthDate: '2017-03-05', idLast4: '1234', jerseyNo: 7, ...over
});
const staff = (over = {}) => player({ kind: 'coach', name: '林教練', birthDate: null, idLast4: null, jerseyNo: null, ...over });

/** n 位合法的學童球員，背號與 memberId 都不重複 */
const squad = (n, over = {}) => Array.from({ length: n }, (_, i) =>
  player({ memberId: `m-${i}`, name: `小球員${i}`, jerseyNo: i + 1, idLast4: String(1000 + i), ...over }));

const run = (members, division = U10) =>
  reviewTeam({ team: { teamId: 't-1' }, members, division, limits: L });

const codes = r => r.findings.map(f => f.code);
const errors = r => r.findings.filter(f => f.level === 'error').map(f => f.code);

describe('T43-1 人數（規章第十二條）', () => {
  test('⭐ 沒有球員不能核准', () => {
    const r = run([staff()]);
    expect(r.canApprove).toBe(false);
    expect(errors(r)).toContain('NO_PLAYERS');
  });

  test('⭐ 球員超過 15 人擋下來', () => {
    expect(run(squad(15)).canApprove).toBe(true);
    const r = run(squad(16));
    expect(r.canApprove).toBe(false);
    expect(errors(r)).toContain('TOO_MANY_PLAYERS');
    expect(r.findings.find(f => f.code === 'TOO_MANY_PLAYERS').source).toBe('規章第十二條');
  });

  test('⭐ 隊職員超過 3 人擋下來，而且與球員分開算', () => {
    const three = [staff({ memberId: 's1' }), staff({ memberId: 's2' }), staff({ memberId: 's3' })];
    expect(run([...squad(5), ...three]).canApprove).toBe(true);
    expect(errors(run([...squad(5), ...three, staff({ memberId: 's4' })]))).toContain('TOO_MANY_STAFF');
  });

  test('只算 approved 的成員（pending／removed 不進名單）', () => {
    const r = run([
      ...squad(3),
      player({ memberId: 'x1', status: 'pending', jerseyNo: 90 }),
      player({ memberId: 'x2', status: 'removed', jerseyNo: 91 })
    ]);
    expect(r.players).toBe(3);
  });
});

describe('T43-2 背號', () => {
  test('⭐ 背號重複擋下來，而且說得出是哪幾號', () => {
    // 兩個 7 號在賽務台上分不出來，進球會記到錯的人身上
    const r = run([...squad(3), player({ memberId: 'dup', jerseyNo: 1, idLast4: '9999' })]);
    expect(r.canApprove).toBe(false);
    const f = r.findings.find(x => x.code === 'DUPLICATE_JERSEY');
    expect(f.message).toContain('1');
  });

  test('⭐ 背號重複標成「系統限制」而不是「規章」（規章沒有這一條）', () => {
    // 來源標錯會讓主辦以為規章這樣規定，而規章其實沒有寫
    const r = run([...squad(2), player({ memberId: 'dup', jerseyNo: 1, idLast4: '9' })]);
    expect(r.findings.find(x => x.code === 'DUPLICATE_JERSEY').source).toBe('系統限制');
  });

  test('沒有背號只是提醒，不擋核准', () => {
    // 背號之後還能改，卡在這裡會讓報名期間卡住
    const r = run([...squad(3), player({ memberId: 'nn', jerseyNo: null, idLast4: '5555' })]);
    expect(r.canApprove).toBe(true);
    expect(codes(r)).toContain('MISSING_JERSEY');
  });
});

describe('T43-3 參賽資格（規章第十一條）', () => {
  test('⭐ 超齡擋下來（罰則是取消整隊資格）', () => {
    const r = run([...squad(3), player({ memberId: 'old', name: '大明', birthDate: '2015-01-01', jerseyNo: 20 })]);
    expect(r.canApprove).toBe(false);
    expect(errors(r)).toContain('TOO_OLD');
    expect(r.findings.find(f => f.code === 'TOO_OLD').message).toContain('大明');
  });

  test('⭐ 沒填生日也擋（驗不了就是驗不了）', () => {
    const r = run([...squad(2), player({ memberId: 'nb', name: '小華', birthDate: null, jerseyNo: 30 })]);
    expect(r.canApprove).toBe(false);
    expect(errors(r)).toContain('BIRTHDATE_MISSING');
  });

  test('⭐ 門檻當天出生可以（規章的「以後」含當日）', () => {
    const r = run([player({ memberId: 'edge', birthDate: '2016-09-01' })]);
    expect(r.canApprove).toBe(true);
  });

  test('成人組沒有年齡門檻，連生日都不必填', () => {
    const r = reviewTeam({
      team: {}, division: ADULT, limits: L,
      members: [player({ birthDate: null, idLast4: null })]
    });
    expect(r.canApprove).toBe(true);
    expect(errors(r)).toEqual([]);
  });

  test('隊職員不查年齡（兒童組偶爾有超齡的隨隊職員）', () => {
    const r = run([...squad(2), staff({ memberId: 's1', birthDate: '1980-01-01' })]);
    expect(r.canApprove).toBe(true);
  });

  test('名字最多列三個，其餘用「等 N 位」帶過', () => {
    const bad = Array.from({ length: 5 }, (_, i) =>
      player({ memberId: `o${i}`, name: `超齡${i}`, birthDate: '2010-01-01', jerseyNo: 50 + i }));
    const msg = run([...squad(2), ...bad]).findings.find(f => f.code === 'TOO_OLD').message;
    expect(msg).toContain('等 5 位');
    expect(msg).not.toContain('超齡4');
  });
});

describe('T43-4 檢錄要用的欄位', () => {
  test('⭐ 學童組沒有身分證後四碼擋下來', () => {
    // 只存暱稱，檢錄當天唯一能跟證件對起來的就是「後四碼＋生日」
    const r = run([...squad(2), player({ memberId: 'ni', name: '阿光', idLast4: null, jerseyNo: 40 })]);
    expect(r.canApprove).toBe(false);
    expect(errors(r)).toContain('ID_LAST4_MISSING');
  });

  test('後四碼格式不對也算沒填', () => {
    for (const v of ['12', 'abcd', '12345', '']) {
      const r = run([player({ idLast4: v })]);
      expect(errors(r)).toContain('ID_LAST4_MISSING');
    }
  });

  test('成人組不強制後四碼', () => {
    const r = reviewTeam({ team: {}, division: ADULT, limits: L, members: [player({ idLast4: null })] });
    expect(errors(r)).not.toContain('ID_LAST4_MISSING');
  });
});

describe('T43-5 一切正常時', () => {
  test('⭐ 全部通過就可以核准，而且有正面的檢核項目可看', () => {
    // 只列問題的話，主辦沒辦法分辨「檢查過了沒問題」與「根本沒檢查」
    const r = run(squad(10));
    expect(r.canApprove).toBe(true);
    expect(errors(r)).toEqual([]);
    expect(codes(r)).toContain('PLAYERS');
    expect(codes(r)).toContain('AGE');
  });

  test('每一條都標出依據（規章第幾條，還是系統限制）', () => {
    for (const f of run(squad(3)).findings) expect(f.source).toBeTruthy();
  });
});

describe('T43-6 核准與退回要寫的欄位', () => {
  test('⭐ 核准會鎖名單', () => {
    const p = buildApprovePatch('u-admin');
    expect(p).toMatchObject({ status: 'approved', rosterLocked: true, reviewedBy: 'u-admin' });
    // 之前被退回過的話要把原因清掉，否則畫面上會留著一條過期的說明
    expect(p.rejectReason).toBeNull();
  });

  test('⭐ 退回**不可以**鎖名單（鎖了隊長就改不動，卻看不出為什麼）', () => {
    const p = buildRejectPatch('u-admin', '球員 12 號超齡');
    expect(p).toMatchObject({ status: 'rejected', rosterLocked: false });
    expect(p.rejectReason).toBe('球員 12 號超齡');
  });

  test('⭐ 退回一定要填原因', () => {
    // 沒有原因的退回，隊長只會看到「被退回」然後打電話問主辦
    for (const v of ['', '   ', null, undefined]) {
      expect(() => buildRejectPatch('u-admin', v)).toThrow('原因');
    }
  });

  test('原因過長會截斷（避免一整篇文章塞進文件）', () => {
    expect(buildRejectPatch('u', 'x'.repeat(999)).rejectReason).toHaveLength(500);
  });

  test('⭐ 不自己填時間戳（R-ENG-004，由寫入層填 serverTimestamp）', () => {
    expect(buildApprovePatch('u').reviewedAt).toBeUndefined();
    expect(buildRejectPatch('u', 'r').reviewedAt).toBeUndefined();
  });
});

describe('T43-7 personKeysOf：跨隊查重的「同一個人」（規章第十二條，每人限報乙隊）', () => {
  test('後四碼＋生日兩個都有才算', () => {
    expect(personKeysOf({ idLast4: '1234', birthDate: '2017-03-05' })).toEqual(['id:1234:2017-03-05']);
  });

  test('⭐ 只有後四碼、沒有生日 → 不可比對（寧可漏擋，也不把不同的人當成同一個）', () => {
    // 後四碼只有一萬種，一個組別裡撞到同後四碼的兩個孩子並不稀奇
    expect(personKeysOf({ idLast4: '1234' })).toEqual([]);
    expect(personKeysOf({ idLast4: '1234', birthDate: null })).toEqual([]);
    expect(personKeysOf({ birthDate: '2017-03-05' })).toEqual([]);
  });

  test('格式不對的不算（後四碼要四位數字、生日要 ISO）', () => {
    expect(personKeysOf({ idLast4: 'abcd', birthDate: '2017-03-05' })).toEqual([]);
    expect(personKeysOf({ idLast4: '1234', birthDate: '106-03-05' })).toEqual([]);   // 民國年混進來（R-REG-002）
    expect(personKeysOf({ idLast4: ' 1234 ', birthDate: ' 2017-03-05 ' })).toEqual(['id:1234:2017-03-05']);
  });

  test('本人用自己的帳號報名時，uid 就是他', () => {
    expect(personKeysOf({ isSelf: true, guardianUid: 'U-me' })).toEqual(['uid:U-me']);
    expect(personKeysOf({ isSelf: true, guardianUid: 'U-me', idLast4: '1234', birthDate: '1990-01-01' }))
      .toEqual(['id:1234:1990-01-01', 'uid:U-me']);
  });

  test('⭐ 家長的 uid 不算——一位家長替兩個小孩報不同隊是合法的（FR07）', () => {
    expect(personKeysOf({ isSelf: false, guardianUid: 'U-parent' })).toEqual([]);
    expect(personKeysOf({ guardianUid: 'U-parent' })).toEqual([]);
    const a = personKeysOf({ guardianUid: 'U-parent', idLast4: '1111', birthDate: '2018-05-05' });
    const b = personKeysOf({ guardianUid: 'U-parent', idLast4: '2222', birthDate: '2020-07-07' });
    expect(a.filter(k => b.includes(k))).toEqual([]);   // 兄弟姊妹沒有任何一把共同的鍵
  });

  test('沒有資料時回空陣列，不丟例外', () => {
    expect(personKeysOf(null)).toEqual([]);
    expect(personKeysOf({})).toEqual([]);
    expect(personKeysOf({ isSelf: true, guardianUid: '' })).toEqual([]);
  });
});
