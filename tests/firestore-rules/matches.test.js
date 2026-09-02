/**
 * firestore.rules｜場次與公開讀取
 * 對應 docs/07 §2.4 的 R01–R10、R18、R21–R23
 */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collectionGroup, getDocs, query, where } from 'firebase/firestore';
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


  // ── R31：完賽即鎖定 ────────────────────────────────────────
  // 「完賽就鎖定」是三分鐘自撤回（分支 D）的前提。前提沒被規則守住的話，
  // 賽務只要在送出完賽時不寫 lock.locked = true，就得到一個永遠可改的成績。

  test('R31 ⭐ 賽務不可以「完賽但不上鎖」', async () => {
    await asAdminSdk(env, db => setDoc(
      doc(db, 'events', EVENT, 'matches', MATCH),
      baseMatch(MATCH, 'venue-a', { status: 'live' })
    ));
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer')), {
      status: 'finished', period: 'ft',
      score: { home: 3, away: 0 },
      lock: { locked: false, lockedAt: null, lockedBy: null },
      scoreSubmittedBy: 'u-scorer',
      updatedBy: 'u-scorer'
    }));
  });

  test('R31b 完賽時同時上鎖則允許（正常路徑）', async () => {
    await asAdminSdk(env, db => setDoc(
      doc(db, 'events', EVENT, 'matches', MATCH),
      baseMatch(MATCH, 'venue-a', { status: 'live' })
    ));
    await assertSucceeds(updateDoc(matchRef(authed(env, 'u-scorer')), {
      status: 'finished', period: 'ft',
      score: { home: 3, away: 0 },
      lock: { locked: true, lockedAt: null, lockedBy: 'u-scorer' },
      scoreSubmittedBy: 'u-scorer',
      updatedBy: 'u-scorer'
    }));
  });

  test('R31c ⭐ 已完賽但未鎖定的場次，賽務也不能再改比分', async () => {
    // 這是 R31 沒守住時真正會痛的那一步：狀態停在 finished、lock 是 false，
    // 分支 (B) 的 from == to 讓比分可以一直改，而且完全沒有時間上限。
    await asAdminSdk(env, db => setDoc(
      doc(db, 'events', EVENT, 'matches', MATCH),
      baseMatch(MATCH, 'venue-a', {
        status: 'finished', period: 'ft',
        score: { home: 3, away: 0 },
        lock: { locked: false, lockedAt: null, lockedBy: null }
      })
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

  test('R22 Admin 可把 finished 覆核為 confirmed（即使已鎖定）', async () => {
    await asAdminSdk(env, db => setDoc(
      doc(db, 'events', EVENT, 'matches', MATCH),
      baseMatch(MATCH, 'venue-a', { status: 'finished', lock: { locked: true, lockedAt: null, lockedBy: 'x' } })
    ));
    await assertSucceeds(updateDoc(matchRef(authed(env, 'u-admin')), {
      status: 'confirmed', updatedBy: 'u-admin'
    }));
  });

  test('R23 一般賽務不可覆核已鎖定的場次（覆核僅限 Admin）', async () => {
    await asAdminSdk(env, db => setDoc(
      doc(db, 'events', EVENT, 'matches', MATCH),
      baseMatch(MATCH, 'venue-a', { status: 'finished', lock: { locked: true, lockedAt: null, lockedBy: 'x' } })
    ));
    // 2026-08-29 拿掉 venue_lead 之後，這條要證明的是「賽務碰不到已鎖定的場次」，
    // 而不是原本的「主任覆核時不能順便改比分」。
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer')), {
      status: 'confirmed', updatedBy: 'u-scorer'
    }));
  });

  test('回歸：完賽送出一次更新 10 個欄位，不得撞到 rules 的 1000 運算式上限', async () => {
    // 這是現場最耗運算式的單一操作。若 rules 的角色判斷寫成巢狀鏈，
    // 這裡會以 "maximum of 1000 expressions" 失敗——而且是「合法操作被誤擋」。
    await assertSucceeds(updateDoc(matchRef(authed(env, 'u-scorer')), {
      score: { home: 2, away: 1 },
      htScore: { home: 1, away: 0 },
      penaltyScore: { home: null, away: null },
      status: 'finished',
      period: 'ft',
      clock: { running: false, periodStartedAt: null, elapsedSecAtPause: 1800, addedTimeSec: 0 },
      result: { winner: 'home', method: 'regulation', homePoints: 3, awayPoints: 0 },
      checkin: { homeConfirmed: true, awayConfirmed: true, confirmedAt: null },
      lock: { locked: true, lockedAt: null, lockedBy: 'u-scorer' },
      scoreSubmittedBy: 'u-scorer',
      scoreMismatch: false,
      updatedBy: 'u-scorer'
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

  test('R33 ⭐ 訪客可以用 collectionGroup 查某位球員的出賽紀錄', async () => {
    // 巢狀路徑的 allow read 吃不到 collectionGroup 查詢，要有專門的一條規則。
    // 少了它，球員頁的「出賽紀錄」永遠是 PERMISSION_DENIED。
    await asAdminSdk(env, db => setDoc(
      doc(db, 'events', EVENT, 'matches', MATCH, 'timeline', 'tl-9'),
      { matchId: MATCH, type: 'goal', side: 'home', playerId: 'm-101-07', seq: 1, createdBy: 'u-scorer', voided: false }
    ));
    await assertSucceeds(getDocs(query(
      collectionGroup(guest(env), 'timeline'), where('playerId', '==', 'm-101-07')
    )));
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
