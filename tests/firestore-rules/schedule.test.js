/**
 * firestore.rules｜賽程管理（R118–R125）
 * ------------------------------------------------------------------
 * 規格：docs/05 §6、R-PERM-002
 *
 * `schedule.manage` 是 `destructive: true`，所以它擋的每一條路徑
 * **都要在 rules 裡也擋一次**——畫面上的 `can()` 只是為了不要畫出
 * 按了會失敗的按鈕，不是資料的邊界。
 *
 * 產生一次賽程會寫到六個地方，六個都要驗：
 *   matches／divisions/stages/groups／standings／teams（分組）／
 *   config/schedule／config/formats
 *
 * ⚠️ 少驗其中一個的後果不是「權限沒擋住」而是**功能整個做不完**：
 *    記錄員按下產生，前五個寫成功、第六個被擋，賽程就停在半套狀態。
 */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { makeEnv, seedBaseline, authed, guest, EVENT, baseMatch } from './helpers.js';

let env;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedBaseline(env); });

const NEW_MATCH = 'AO-G-A-99';

describe('R118 產生賽程：場次', () => {
  test('管理員可以新增場次', async () => {
    await assertSucceeds(setDoc(
      doc(authed(env, 'u-admin'), 'events', EVENT, 'matches', NEW_MATCH),
      baseMatch(NEW_MATCH)));
  });

  test('⭐ 記錄員與裁判不可以新增場次', async () => {
    for (const uid of ['u-scorer', 'u-referee', 'u-checkin', 'u-booth']) {
      await assertFails(setDoc(
        doc(authed(env, uid), 'events', EVENT, 'matches', NEW_MATCH),
        baseMatch(NEW_MATCH)));
    }
    await assertFails(setDoc(
      doc(guest(env), 'events', EVENT, 'matches', NEW_MATCH), baseMatch(NEW_MATCH)));
  });

  test('⭐ 重新產生要刪得掉舊場次，而且只有管理員刪得掉', async () => {
    await assertFails(deleteDoc(doc(authed(env, 'u-scorer'), 'events', EVENT, 'matches', 'AO-G-A-01')));
    await assertSucceeds(deleteDoc(doc(authed(env, 'u-admin'), 'events', EVENT, 'matches', 'AO-G-A-01')));
  });

  test('管理員可以改開賽時間與場地（記錄員不行——那不在他的白名單裡）', async () => {
    const patch = { kickoffAt: new Date('2026-10-11T02:00:00Z'), venueId: 'venue-b', venueName: 'B場' };
    await assertFails(updateDoc(
      doc(authed(env, 'u-scorer'), 'events', EVENT, 'matches', 'AO-G-A-01'), patch));
    await assertSucceeds(updateDoc(
      doc(authed(env, 'u-admin'), 'events', EVENT, 'matches', 'AO-G-A-01'), patch));
  });
});

describe('R119 產生賽程：階段與小組', () => {
  const stage = db => doc(db, 'events', EVENT, 'divisions', 'adult-open', 'stages', 'group');
  const group = db => doc(db, 'events', EVENT, 'divisions', 'adult-open', 'stages', 'group', 'groups', 'A');

  test('管理員寫得動階段與小組', async () => {
    const db = authed(env, 'u-admin');
    await assertSucceeds(setDoc(stage(db), { stageId: 'group', type: 'roundRobin', order: 1 }));
    await assertSucceeds(setDoc(group(db), { groupId: 'A', teamIds: ['t-101'], order: 1 }));
  });

  test('⭐ 記錄員寫不動（小組決定積分榜怎麼分堆）', async () => {
    const db = authed(env, 'u-scorer');
    await assertFails(setDoc(stage(db), { stageId: 'group', type: 'roundRobin', order: 1 }));
    await assertFails(setDoc(group(db), { groupId: 'A', teamIds: ['t-101'], order: 1 }));
  });
});

describe('R120 產生賽程：空的積分榜', () => {
  const ref = db => doc(db, 'events', EVENT, 'standings', 'adult-open__group__A');
  const row = { standingId: 'adult-open__group__A', divisionId: 'adult-open', stageId: 'group', groupId: 'A', rows: [], version: 0 };

  test('管理員建得起來（不建的話晉級永遠解不開）', async () => {
    await assertSucceeds(setDoc(ref(authed(env, 'u-admin')), row));
  });

  test('⭐ 記錄員建不起來', async () => {
    await assertFails(setDoc(ref(authed(env, 'u-scorer')), row));
  });
});

describe('R121 產生賽程：球隊的小組與種子序', () => {
  const ref = db => doc(db, 'events', EVENT, 'teams', 't-101');

  test('管理員回填得了 groupId 與 seed', async () => {
    await assertSucceeds(updateDoc(ref(authed(env, 'u-admin')), { groupId: 'A', seed: 1 }));
  });

  test('⭐ 記錄員與隊長都改不動分組（分組是抽籤的結果）', async () => {
    await assertFails(updateDoc(ref(authed(env, 'u-scorer')), { groupId: 'A', seed: 1 }));
    await assertFails(updateDoc(ref(authed(env, 'u-referee')), { groupId: 'B', seed: 9 }));
  });
});

describe('R122 排程設定 config/schedule', () => {
  const ref = db => doc(db, 'config', 'schedule');
  const cfg = { startTime: '08:30', endTime: '18:00', bufferMin: 10, minRestMin: 20 };

  test('管理員改得動（開賽時間與場地是營運決定，不是規章）', async () => {
    await assertSucceeds(setDoc(ref(authed(env, 'u-admin')), cfg));
  });

  test('⭐ 記錄員改不動', async () => {
    await assertFails(setDoc(ref(authed(env, 'u-scorer')), cfg));
    await assertFails(setDoc(ref(guest(env)), cfg));
  });
});

describe('R123 通用賽制範本 config/formats', () => {
  const ref = db => doc(db, 'config', 'formats');

  test('⭐ 管理員寫得進去（Cloud Functions 解晉級讀的就是這一份）', async () => {
    // 只改 division.formatId 而沒有把範本寫進來的話，
    // 晉級會在比賽當天才失敗
    await assertSucceeds(setDoc(ref(authed(env, 'u-admin')),
      { formats: { GEN_7T_2G: { formatId: 'GEN_7T_2G', teamCount: 7, stages: [] } } }, { merge: true }));
  });

  test('記錄員寫不進去', async () => {
    await assertFails(setDoc(ref(authed(env, 'u-scorer')), { formats: {} }, { merge: true }));
  });
});

describe('R124 發布旗標', () => {
  const ref = db => doc(db, 'events', EVENT, 'divisions', 'adult-open');

  test('管理員改得動 schedulePublished', async () => {
    await assertSucceeds(setDoc(ref(authed(env, 'u-admin')), { schedulePublished: true }, { merge: true }));
  });

  test('⭐ 記錄員改不動（一按下去全世界就看得到）', async () => {
    await assertFails(setDoc(ref(authed(env, 'u-scorer')), { schedulePublished: true }, { merge: true }));
  });
});

describe('R125 賽程留痕', () => {
  test('⭐ 管理員寫得了稽核，但改不掉也刪不掉（R-SEC-002）', async () => {
    const db = authed(env, 'u-admin');
    const ref = doc(db, 'events', EVENT, 'audits', 'a-sched');
    await assertSucceeds(setDoc(ref, {
      eventId: EVENT, entity: 'division', entityId: 'adult-open', action: 'schedule.generate',
      before: { matches: 0 }, after: { matches: 8, drawSeed: 12345 },
      reason: '抽籤（種子 12345）', actor: { uid: 'u-admin', name: 'u-admin' }
    }));
    await assertFails(updateDoc(ref, { reason: '改過了' }));
    await assertFails(deleteDoc(ref));
  });
});
