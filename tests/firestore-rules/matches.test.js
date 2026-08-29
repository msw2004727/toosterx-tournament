/**
 * firestore.rules｜場次與公開讀取
 * 對應 docs/07 §2.4 的 R01–R10、R18、R21–R23
 */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import {
  makeEnv, seedBaseline, asAdminSdk, authed, guest,
  EVENT, MATCH, MATCH_B, baseMatch
} from './helpers.js';

let env;

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seedBaseline(env);
});

const matchRef = (db, id = MATCH) => doc(db, 'events', EVENT, 'matches', id);

describe('公開讀取', () => {
  test('R01 訪客可讀賽程與比分', async () => {
    await assertSucceeds(getDoc(matchRef(guest(env))));
  });

  test('R02 訪客不可讀 members（含生日與身分證後四碼）', async () => {
    await assertFails(getDoc(
      doc(guest(env), 'events', EVENT, 'teams', 't-101', 'members', 'm-101-07')
    ));
  });

  test('R03 訪客可讀 roster 公開投影', async () => {
    await assertSucceeds(getDoc(
      doc(guest(env), 'events', EVENT, 'teams', 't-101', 'roster', 'm-101-07')
    ));
  });
});

describe('場次寫入', () => {
  test('R04 訪客不可寫比分', async () => {
    await assertFails(updateDoc(matchRef(guest(env)), {
      score: { home: 1, away: 0 }, updatedBy: 'anonymous'
    }));
  });

  test('R05 賽務不可寫非指派場地的場次', async () => {
    // u-scorer 指派 venue-a，MATCH_B 在 venue-b
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer'), MATCH_B), {
      score: { home: 1, away: 0 }, updatedBy: 'u-scorer'
    }));
  });

  test('R05b 賽務可寫自己指派場地的場次', async () => {
    await assertSucceeds(updateDoc(matchRef(authed(env, 'u-scorer')), {
      score: { home: 1, away: 0 }, updatedBy: 'u-scorer'
    }));
  });

  test('R06 賽務不可寫已鎖定的場次', async () => {
    await asAdminSdk(env, db => setDoc(
      doc(db, 'events', EVENT, 'matches', MATCH),
      baseMatch(MATCH, 'venue-a', { status: 'finished', lock: { locked: true, lockedAt: null, lockedBy: 'u-scorer' } })
    ));
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer')), {
      score: { home: 9, away: 0 }, updatedBy: 'u-scorer'
    }));
  });

  test('R07 賽務不可竄改對戰隊伍', async () => {
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer')), {
      home: { teamId: 't-999', name: '假球隊' }, updatedBy: 'u-scorer'
    }));
  });

  test('R08 比分不可為負數', async () => {
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer')), {
      score: { home: -1, away: 0 }, updatedBy: 'u-scorer'
    }));
  });

  test('R08b 比分不可超過 99', async () => {
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer')), {
      score: { home: 100, away: 0 }, updatedBy: 'u-scorer'
    }));
  });

  test('R09 賽務不可把 finished 退回 live', async () => {
    await asAdminSdk(env, db => setDoc(
      doc(db, 'events', EVENT, 'matches', MATCH),
      baseMatch(MATCH, 'venue-a', { status: 'finished' })
    ));
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer')), {
      status: 'live', updatedBy: 'u-scorer'
    }));
  });

  test('R10 Admin 可把 finished 退回 live', async () => {
    await asAdminSdk(env, db => setDoc(
      doc(db, 'events', EVENT, 'matches', MATCH),
      baseMatch(MATCH, 'venue-a', { status: 'finished', lock: { locked: true, lockedAt: null, lockedBy: 'x' } })
    ));
    await assertSucceeds(updateDoc(matchRef(authed(env, 'u-admin')), {
      status: 'live', updatedBy: 'u-admin'
    }));
  });

  test('R18 已停權的賽務不可寫比分', async () => {
    await assertFails(updateDoc(matchRef(authed(env, 'u-suspended')), {
      score: { home: 1, away: 0 }, updatedBy: 'u-suspended'
    }));
  });

  test('R21 賽務不可把 scheduled 改成 postponed（延期僅 Admin）', async () => {
    await asAdminSdk(env, db => setDoc(
      doc(db, 'events', EVENT, 'matches', MATCH),
      baseMatch(MATCH, 'venue-a', { status: 'scheduled' })
    ));
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer')), {
      status: 'postponed', updatedBy: 'u-scorer'
    }));
  });

  test('R22 場地主任可把 finished 覆核為 confirmed（即使已鎖定）', async () => {
    await asAdminSdk(env, db => setDoc(
      doc(db, 'events', EVENT, 'matches', MATCH),
      baseMatch(MATCH, 'venue-a', { status: 'finished', lock: { locked: true, lockedAt: null, lockedBy: 'x' } })
    ));
    await assertSucceeds(updateDoc(matchRef(authed(env, 'u-lead')), {
      status: 'confirmed', updatedBy: 'u-lead'
    }));
  });

  test('R23 場地主任覆核時不可順便改比分', async () => {
    await asAdminSdk(env, db => setDoc(
      doc(db, 'events', EVENT, 'matches', MATCH),
      baseMatch(MATCH, 'venue-a', { status: 'finished', lock: { locked: true, lockedAt: null, lockedBy: 'x' } })
    ));
    await assertFails(updateDoc(matchRef(authed(env, 'u-lead')), {
      status: 'confirmed', score: { home: 9, away: 0 }, updatedBy: 'u-lead'
    }));
  });

  test('附加：updatedBy 必須等於自己的 uid（不可冒名）', async () => {
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer')), {
      score: { home: 1, away: 0 }, updatedBy: 'u-admin'
    }));
  });

  test('附加：只有 Admin 可以建立場次', async () => {
    await assertFails(setDoc(matchRef(authed(env, 'u-scorer'), 'AO-G-A-99'), baseMatch('AO-G-A-99')));
    await assertSucceeds(setDoc(matchRef(authed(env, 'u-admin'), 'AO-G-A-99'), baseMatch('AO-G-A-99')));
  });
});

describe('積分榜與比賽事件', () => {
  test('附加：訪客不可寫積分榜', async () => {
    await assertFails(setDoc(
      doc(guest(env), 'events', EVENT, 'standings', 'adult-open__group__A'),
      { rows: [] }
    ));
  });

  test('附加：賽務可新增比賽事件，但不可刪除', async () => {
    const db = authed(env, 'u-scorer');
    const ref = doc(db, 'events', EVENT, 'matches', MATCH, 'timeline', 'tl-1');
    await assertSucceeds(setDoc(ref, {
      matchId: MATCH, type: 'goal', side: 'home', playerId: 'm-101-07',
      seq: 1, createdBy: 'u-scorer', voided: false
    }));
    await assertFails(deleteDoc(ref));
  });
});
