/**
 * FR01–FR08｜報名的公開投影與計數（Firestore Emulator）
 * ------------------------------------------------------------------
 * 執行：npm run test:fn
 *
 * 引擎的 rosterProjection() 已經有純函式測試證明「挑對欄位」。
 * 這一組要證的是接線：Function 真的在成員狀態變動時重投影、
 * 不該公開的狀態真的會把投影**刪掉**、以及重複申請真的會被退件。
 *
 * 最重要的一條是 FR03：它掃整份投影文件，只要 members 上的任何私密欄位
 * 漏進去就會紅——那是唯一會真正傷到人的錯。
 */
import { db as adminDb } from '../../functions/admin.js';
import {
  syncRosterFor, recountTeamMembers, recountUserTeams, rejectDuplicateApplication,
  rejectCrossTeamDuplicate, enforceRosterCap
} from '../../functions/pipeline.js';
import { liffConfig, upsertUser } from '../../functions/line.js';

const E = 'feda-cup-2026';
const TEAM = 't-1';
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-fn-test';
const ASOF = '2026-10-09';

let db;

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error('這組測試必須在 Firestore Emulator 底下跑（npm run test:fn）');
  const res = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' });
  if (!res.ok) throw new Error(`清空 Emulator 失敗：${res.status}`);
}

const memberRef = (mid, tid = TEAM) => db.doc(`events/${E}/teams/${tid}/members/${mid}`);
const rosterRef = (mid, tid = TEAM) => db.doc(`events/${E}/teams/${tid}/roster/${mid}`);
const teamRef = (tid = TEAM) => db.doc(`events/${E}/teams/${tid}`);

const member = (over = {}) => ({
  memberId: 'm-1', guardianUid: 'u-parent', isSelf: false,
  name: '王小明', birthDate: '2016-03-14', idLast4: '1234',
  jerseyNo: 7, position: 'MF', role: 'player',
  isCaptain: true, isGoalkeeper: false, photoUrl: 'https://example.com/kid.jpg',
  stats: { apps: 3, goals: 2, assists: 1, yellow: 1, red: 0 },
  note: '隊長的備註', consent: { given: true, at: null, byUid: 'u-parent' },
  source: 'guardian', status: 'approved',
  ...over
});

async function seed() {
  const b = db.batch();
  b.set(db.doc(`events/${E}`), { eventId: E, name: 'FEDA CUP 2026', dates: [ASOF, '2026-10-10'] });
  b.set(teamRef(), {
    teamId: TEAM, eventId: E, divisionId: 'u10', name: '大甲金剛', shortName: '大甲',
    captainUid: 'u-captain', status: 'approved', rosterLocked: true, memberCount: 0
  });
  await b.commit();
}

beforeAll(() => { db = adminDb(); });
beforeEach(async () => { await clearFirestore(); await seed(); });

// ══════════════════════════════════════════════════════════════
describe('FR01–FR04 公開投影', () => {
  test('FR01 已核准的成員會出現在公開名冊', async () => {
    await memberRef('m-1').set(member());
    const r = await syncRosterFor({ eventId: E, teamId: TEAM, memberId: 'm-1' });

    expect(r.projected).toBe(true);
    const doc = (await rosterRef('m-1').get()).data();
    expect(doc.jerseyNo).toBe(7);
    expect(doc.divisionId).toBe('u10');      // 從球隊帶過來，不是從成員
    expect(doc.stats.goals).toBe(2);
  });

  test('FR02 ⭐ 未滿 13 歲遮名，照片不公開', async () => {
    await memberRef('m-1').set(member());
    await syncRosterFor({ eventId: E, teamId: TEAM, memberId: 'm-1' });

    const doc = (await rosterRef('m-1').get()).data();
    expect(doc.displayName).toBe('王小＊');
    expect(doc.photoUrl).toBeNull();
  });

  test('FR02b 成年人不遮', async () => {
    await memberRef('m-9').set(member({ memberId: 'm-9', name: '李教練', birthDate: '1985-06-02', role: 'coach' }));
    await syncRosterFor({ eventId: E, teamId: TEAM, memberId: 'm-9' });
    expect((await rosterRef('m-9').get()).data().displayName).toBe('李教練');
  });

  test('FR03 ⭐ 私密欄位一個都不准出現在公開名冊', async () => {
    // 這是唯一會真正傷到人的錯，所以掃整份文件而不是逐欄位檢查——
    // members 之後新增欄位時，這條會自己抓到。
    await memberRef('m-1').set(member());
    await syncRosterFor({ eventId: E, teamId: TEAM, memberId: 'm-1' });

    const doc = (await rosterRef('m-1').get()).data();
    const json = JSON.stringify(doc);
    for (const secret of ['u-parent', '2016-03-14', '1234', '隊長的備註', 'guardian', '王小明']) {
      expect(json).not.toContain(secret);
    }
    for (const k of ['guardianUid', 'birthDate', 'idLast4', 'note', 'consent', 'source', 'status']) {
      expect(doc).not.toHaveProperty(k);
    }
  });

  test('FR04 ⭐ 不是 approved 的狀態一律把投影刪掉', async () => {
    await memberRef('m-1').set(member());
    await syncRosterFor({ eventId: E, teamId: TEAM, memberId: 'm-1' });
    expect((await rosterRef('m-1').get()).exists).toBe(true);

    // 被移除的隊員留在公開名冊上，比沒有更糟
    for (const status of ['removed', 'rejected', 'pending']) {
      await memberRef('m-1').update({ status });
      await syncRosterFor({ eventId: E, teamId: TEAM, memberId: 'm-1' });
      expect((await rosterRef('m-1').get()).exists).toBe(false);

      await memberRef('m-1').update({ status: 'approved' });
      await syncRosterFor({ eventId: E, teamId: TEAM, memberId: 'm-1' });
      expect((await rosterRef('m-1').get()).exists).toBe(true);
    }
  });

  test('FR04b 成員文件不存在時也不會炸，只是把投影清掉', async () => {
    await rosterRef('m-ghost').set({ memberId: 'm-ghost', displayName: '幽靈' });
    const r = await syncRosterFor({ eventId: E, teamId: TEAM, memberId: 'm-ghost' });
    expect(r.projected).toBe(false);
    expect((await rosterRef('m-ghost').get()).exists).toBe(false);
  });

  test('FR04c ⭐ 賽事日期讀不到時一律遮（fail-closed）', async () => {
    await db.doc(`events/${E}`).update({ dates: null });
    await memberRef('m-9').set(member({ memberId: 'm-9', name: '李教練', birthDate: '1985-06-02' }));
    await syncRosterFor({ eventId: E, teamId: TEAM, memberId: 'm-9' });
    // 算不出年齡就當未成年——寧可遮過頭，不可漏
    expect((await rosterRef('m-9').get()).data().displayName).toBe('李教＊');
  });
});

describe('FR05 已核准人數', () => {
  test('FR05 memberCount 只算 approved，而且是一個數字', async () => {
    await memberRef('m-1').set(member({ memberId: 'm-1', status: 'approved' }));
    await memberRef('m-2').set(member({ memberId: 'm-2', status: 'approved' }));
    await memberRef('m-3').set(member({ memberId: 'm-3', status: 'pending' }));
    await memberRef('m-4').set(member({ memberId: 'm-4', status: 'removed' }));

    const r = await recountTeamMembers({ eventId: E, teamId: TEAM });
    expect(r.memberCount).toBe(2);
    // 公開端拿它直接印「N 人」，物件會變成「[object Object] 人」
    expect(typeof (await teamRef().get()).data().memberCount).toBe('number');
  });

  test('FR05b 沒有變動就不寫（免得跟其他 trigger 互相打）', async () => {
    await memberRef('m-1').set(member());
    await recountTeamMembers({ eventId: E, teamId: TEAM });
    const again = await recountTeamMembers({ eventId: E, teamId: TEAM });
    expect(again.changed).toBe(false);
  });
});

describe('FR06–FR07 重複申請（docs/10 §3.3）', () => {
  test('FR06 ⭐ 同一帳號對同一隊的第二筆待審申請會被退件，先送的留著', async () => {
    await memberRef('m-1').set(member({ memberId: 'm-1', status: 'pending' }));
    await memberRef('m-2').set(member({ memberId: 'm-2', status: 'pending' }));

    const rejected = await rejectDuplicateApplication({
      eventId: E, teamId: TEAM, memberId: 'm-2', member: member({ memberId: 'm-2', status: 'pending' })
    });

    expect(rejected).toBe(true);
    expect((await memberRef('m-2').get()).data().status).toBe('rejected');
    expect((await memberRef('m-1').get()).data().status).toBe('pending');   // 先送的不動
    // 退件而不是刪除——申請人看得到自己被退了、為什麼被退
    expect((await memberRef('m-2').get()).data().rejectReason).toMatch(/已經有一筆待審/);
  });

  test('FR07 ⭐ 家長替第二個小孩報名不算重複（前一筆已經被決定了）', async () => {
    // 一個 LINE 帳號可以對應多個球員（docs/10 §1.3）。
    // 擋的是「還沒被決定的重複申請」，不是「同一個 guardianUid 的第二筆」。
    await memberRef('m-1').set(member({ memberId: 'm-1', status: 'approved' }));
    const rejected = await rejectDuplicateApplication({
      eventId: E, teamId: TEAM, memberId: 'm-2', member: member({ memberId: 'm-2', status: 'pending' })
    });
    expect(rejected).toBe(false);
  });

  test('FR07b 不同帳號各送一筆，互不影響', async () => {
    await memberRef('m-1').set(member({ memberId: 'm-1', guardianUid: 'u-a', status: 'pending' }));
    const rejected = await rejectDuplicateApplication({
      eventId: E, teamId: TEAM, memberId: 'm-2',
      member: member({ memberId: 'm-2', guardianUid: 'u-b', status: 'pending' })
    });
    expect(rejected).toBe(false);
  });
});

describe('FR08 每個帳號建了幾支隊', () => {
  test('FR08 依 captainUid 計數，寫進 users/{uid}.teamCount', async () => {
    await teamRef('t-2').set({ teamId: 't-2', captainUid: 'u-captain', divisionId: 'u10' });
    await teamRef('t-3').set({ teamId: 't-3', captainUid: 'u-other', divisionId: 'u10' });

    const r = await recountUserTeams({ eventId: E, uid: 'u-captain' });
    expect(r.teamCount).toBe(2);                                  // t-1 與 t-2
    expect((await db.doc('users/u-captain').get()).data().teamCount).toBe(2);
  });

  test('FR08b 沒有 uid 就不寫，不要生出一份 users/undefined', async () => {
    const r = await recountUserTeams({ eventId: E, uid: null });
    expect(r.teamCount).toBe(0);
    expect((await db.doc('users/undefined').get()).exists).toBe(false);
  });
});

describe('FR09–FR13 LINE 登入的名錄與身分（docs/10 §1.4）', () => {
  const UID = 'U7774e1410479bafff4997f51b2c47b95';
  const profile = { uid: UID, displayName: '小麥', pictureUrl: 'https://example.com/p.jpg' };

  test('FR09 ⭐ config/liff 讀不到 channelId 就拒絕登入（fail-closed）', async () => {
    // 沒有 channelId 就沒辦法確認「這個 token 是發給我們的」，
    // 那時候放行等於誰的 token 都收。
    await expect(liffConfig()).rejects.toThrow(/config\/liff/);

    await db.doc('config/liff').set({ liffId: 'x', channelId: null });
    await expect(liffConfig()).rejects.toThrow(/config\/liff/);

    await db.doc('config/liff').set({ liffId: 'x-1', channelId: '2011382448' });
    expect((await liffConfig()).channelId).toBe('2011382448');
  });

  test('FR10 登入會留下使用者名錄', async () => {
    const r = await upsertUser(profile);
    expect(r.isStaff).toBe(false);

    const doc = (await db.doc(`users/${UID}`).get()).data();
    expect(doc.displayName).toBe('小麥');
    expect(doc.roles).toEqual([]);
    expect(doc.firstSeenAt).toBeTruthy();
  });

  test('FR11 ⭐ roles 從 staff 讀出來，不是相信呼叫端傳了什麼', async () => {
    await db.doc(`staff/${UID}`).set({
      uid: UID, name: '小麥', roles: ['super_admin'], active: true,
      assignment: { eventId: E, venueIds: [], divisionIds: [], challengeIds: [] }
    });
    // 就算呼叫端硬塞 roles 也不該被採用
    const r = await upsertUser({ ...profile, roles: ['admin', 'hacker'] });
    expect(r.roles).toEqual(['super_admin']);
    expect((await db.doc(`users/${UID}`).get()).data().roles).toEqual(['super_admin']);
  });

  test('FR12 ⭐ 停權的工作人員在名錄上就是沒有身分', async () => {
    await db.doc(`staff/${UID}`).set({
      uid: UID, name: '小麥', roles: ['admin'], active: false,
      assignment: { eventId: E, venueIds: [], divisionIds: [], challengeIds: [] }
    });
    const r = await upsertUser(profile);
    expect(r.roles).toEqual([]);
    expect(r.isStaff).toBe(false);
  });

  test('FR13 再次登入只更新 lastSeenAt，firstSeenAt 保留第一次的', async () => {
    await upsertUser(profile);
    const first = (await db.doc(`users/${UID}`).get()).data().firstSeenAt;

    await new Promise(r => setTimeout(r, 50));
    await upsertUser({ ...profile, displayName: '小麥（改名）' });

    const after = (await db.doc(`users/${UID}`).get()).data();
    expect(after.displayName).toBe('小麥（改名）');
    expect(after.firstSeenAt.toMillis()).toBe(first.toMillis());
  });
});

// ══════════════════════════════════════════════════════════════
describe('FR14 每人限報乙隊（規章第十二條）', () => {
  const OTHER = 't-2';
  async function seedOtherTeam() {
    await teamRef(OTHER).set({
      teamId: OTHER, eventId: E, divisionId: 'u10', name: '清水海鷗', shortName: '清水',
      captainUid: 'u-captain-2', status: 'draft', rosterLocked: false, memberCount: 0
    });
  }

  test('⭐ FR14 同一個小孩（後四碼＋生日相同）在別隊已核准，這一隊的新申請會被退件', async () => {
    await seedOtherTeam();
    await memberRef('m-x', OTHER).set(member({ memberId: 'm-x', status: 'approved', idLast4: '5566', birthDate: '2016-05-05' }));
    await memberRef('m-new').set(member({ memberId: 'm-new', status: 'pending', idLast4: '5566', birthDate: '2016-05-05', guardianUid: 'u-other-parent' }));

    const r = await rejectCrossTeamDuplicate({ eventId: E, teamId: TEAM, memberId: 'm-new', member: (await memberRef('m-new').get()).data() });
    expect(r).toEqual({ otherTeamId: OTHER });
    const m = (await memberRef('m-new').get()).data();
    expect(m.status).toBe('rejected');
    expect(m.rejectReason).toContain('清水海鷗');
    expect(m.decidedBy).toBe('fn:onePlayerOneTeam');
    // 別隊那一筆不動
    expect((await memberRef('m-x', OTHER).get()).data().status).toBe('approved');
  });

  test('⭐ FR14b 教練直接新增（一開始就是 approved）也會被擋——學童組不走申請', async () => {
    await seedOtherTeam();
    await memberRef('m-x', OTHER).set(member({ memberId: 'm-x', status: 'approved', idLast4: '7788', birthDate: '2017-01-02', guardianUid: null, source: 'coach' }));
    await memberRef('m-c').set(member({ memberId: 'm-c', status: 'approved', idLast4: '7788', birthDate: '2017-01-02', guardianUid: null, source: 'coach' }));

    const r = await rejectCrossTeamDuplicate({ eventId: E, teamId: TEAM, memberId: 'm-c', member: (await memberRef('m-c').get()).data() });
    expect(r).toBeTruthy();
    expect((await memberRef('m-c').get()).data().status).toBe('rejected');
  });

  test('⭐ FR14c 後四碼相同但生日不同不算同一個人（寧可漏擋，不要把不同的人當同一個）', async () => {
    await seedOtherTeam();
    await memberRef('m-x', OTHER).set(member({ memberId: 'm-x', status: 'approved', idLast4: '5566', birthDate: '2016-05-05' }));
    await memberRef('m-new').set(member({ memberId: 'm-new', status: 'pending', idLast4: '5566', birthDate: '2015-12-31' }));

    expect(await rejectCrossTeamDuplicate({ eventId: E, teamId: TEAM, memberId: 'm-new', member: (await memberRef('m-new').get()).data() })).toBe(false);
    expect((await memberRef('m-new').get()).data().status).toBe('pending');
  });

  test('⭐ FR14d 別隊那一筆已經被移除／退回就不算（換隊是合法的）', async () => {
    await seedOtherTeam();
    await memberRef('m-x', OTHER).set(member({ memberId: 'm-x', status: 'removed', idLast4: '5566', birthDate: '2016-05-05' }));
    await memberRef('m-new').set(member({ memberId: 'm-new', status: 'pending', idLast4: '5566', birthDate: '2016-05-05' }));
    expect(await rejectCrossTeamDuplicate({ eventId: E, teamId: TEAM, memberId: 'm-new', member: (await memberRef('m-new').get()).data() })).toBe(false);
  });

  test('FR14e 本人用自己的帳號報兩隊：uid 相同就擋', async () => {
    await seedOtherTeam();
    await memberRef('m-x', OTHER).set(member({ memberId: 'm-x', status: 'approved', isSelf: true, guardianUid: 'u-me', idLast4: null, birthDate: null }));
    await memberRef('m-new').set(member({ memberId: 'm-new', status: 'pending', isSelf: true, guardianUid: 'u-me', idLast4: null, birthDate: null }));
    expect(await rejectCrossTeamDuplicate({ eventId: E, teamId: TEAM, memberId: 'm-new', member: (await memberRef('m-new').get()).data() })).toBeTruthy();
  });

  test('⭐ FR14f 家長替兩個小孩報不同隊不算重複（家長 uid 不是人的鍵）', async () => {
    await seedOtherTeam();
    await memberRef('m-x', OTHER).set(member({ memberId: 'm-x', status: 'approved', guardianUid: 'u-parent', idLast4: '1111', birthDate: '2016-01-01' }));
    await memberRef('m-new').set(member({ memberId: 'm-new', status: 'pending', guardianUid: 'u-parent', idLast4: '2222', birthDate: '2018-02-02' }));
    expect(await rejectCrossTeamDuplicate({ eventId: E, teamId: TEAM, memberId: 'm-new', member: (await memberRef('m-new').get()).data() })).toBe(false);
  });

  test('FR14g 沒有可比對的身分（沒後四碼也不是本人）就不查、不擋', async () => {
    await memberRef('m-new').set(member({ memberId: 'm-new', status: 'pending', idLast4: null, birthDate: null, isSelf: false }));
    expect(await rejectCrossTeamDuplicate({ eventId: E, teamId: TEAM, memberId: 'm-new', member: (await memberRef('m-new').get()).data() })).toBe(false);
  });
});

describe('FR15 球員最多 15 人（規章第十二條）', () => {
  const fill = async (n, { kind = 'player', at0 = 1700000000000 } = {}) => {
    const b = db.batch();
    for (let i = 1; i <= n; i++) {
      b.set(memberRef(`m-${kind}-${i}`), member({
        memberId: `m-${kind}-${i}`, status: 'approved', kind, role: kind,
        idLast4: String(1000 + i), decidedAt: new Date(at0 + i * 1000)
      }));
    }
    await b.commit();
  };

  test('⭐ FR15 playerCount 只數球員，隊職員不算', async () => {
    await fill(3);
    await fill(2, { kind: 'coach' });
    const r = await recountTeamMembers({ eventId: E, teamId: TEAM });
    expect(r).toMatchObject({ memberCount: 5, playerCount: 3 });
    expect((await teamRef().get()).data().playerCount).toBe(3);
  });

  test('⭐ FR15b 第 16 位起退件，而且退的是晚核准的那幾位', async () => {
    await fill(17);
    const r = await enforceRosterCap({ eventId: E, teamId: TEAM });
    expect(r.rejected.sort()).toEqual(['m-player-16', 'm-player-17']);
    expect((await memberRef('m-player-16').get()).data().status).toBe('rejected');
    expect((await memberRef('m-player-16').get()).data().decidedBy).toBe('fn:rosterCap');
    expect((await memberRef('m-player-15').get()).data().status).toBe('approved');   // 第 15 位留下
  });

  test('FR15c 剛好 15 位什麼都不動', async () => {
    await fill(15);
    expect(await enforceRosterCap({ eventId: E, teamId: TEAM })).toEqual({ rejected: [] });
  });

  test('⭐ FR15d 上限只數球員：15 位球員＋3 位隊職員不會退任何人', async () => {
    await fill(15);
    await fill(3, { kind: 'coach' });
    expect(await enforceRosterCap({ eventId: E, teamId: TEAM })).toEqual({ rejected: [] });
  });

  test('FR15e 重跑結果一樣（冪等）', async () => {
    await fill(16);
    await enforceRosterCap({ eventId: E, teamId: TEAM });
    expect(await enforceRosterCap({ eventId: E, teamId: TEAM })).toEqual({ rejected: [] });
  });
});
