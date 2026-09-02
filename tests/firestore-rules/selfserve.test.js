/**
 * firestore.rules｜Demo 自助工作人員身分
 * ------------------------------------------------------------------
 * 這是一次刻意的權限放寬（讓 demo 站免 LINE 登入就能試用賽務台），
 * 所以測試的重點不是「它能用」，而是「它擋得住什麼」：
 *   ・沒有 config/env 的專案（＝正式站）完全不能自助建立
 *   ・不能給自己 admin
 *   ・不能建立或改別人的身分
 */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { makeEnv, seedBaseline, asAdminSdk, authed, guest, EVENT } from './helpers.js';

let env;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedBaseline(env); });

const selfDoc = (uid, over = {}) => ({
  uid, name: '自助賽務', selfServe: true, active: true,
  roles: ['scorer'],
  assignment: { eventId: EVENT, date: null, venueIds: ['venue-a'], divisionIds: [], challengeIds: [] },
  ...over
});

const enableSelfServe = (on = true) => asAdminSdk(env, db =>
  setDoc(doc(db, 'config', 'env'), { env: 'demo', allowSelfServeStaff: on }));

describe('正式站行為（沒有 config/env）', () => {
  test('⭐ 沒有 config/env 時，任何人都不能自助建立工作人員身分', async () => {
    await assertFails(setDoc(doc(authed(env, 'u-new'), 'staff', 'u-new'), selfDoc('u-new')));
  });

  test('allowSelfServeStaff = false 時同樣擋下', async () => {
    await enableSelfServe(false);
    await assertFails(setDoc(doc(authed(env, 'u-new'), 'staff', 'u-new'), selfDoc('u-new')));
  });

  test('一般使用者不能改 config/env 把它打開', async () => {
    await assertFails(setDoc(doc(authed(env, 'u-new'), 'config', 'env'), { allowSelfServeStaff: true }));
    await assertFails(setDoc(doc(authed(env, 'u-scorer'), 'config', 'env'), { allowSelfServeStaff: true }));
  });
});

describe('Demo 站行為（config/env.allowSelfServeStaff = true）', () => {
  beforeEach(() => enableSelfServe(true));

  test('可以建立自己的賽務身分', async () => {
    await assertSucceeds(setDoc(doc(authed(env, 'u-new'), 'staff', 'u-new'), selfDoc('u-new')));
  });

  test('⭐ 不能給自己 admin 或 super_admin', async () => {
    for (const role of ['admin', 'super_admin']) {
      await assertFails(setDoc(doc(authed(env, 'u-new'), 'staff', 'u-new'), selfDoc('u-new', { roles: [role] })));
      await assertFails(setDoc(doc(authed(env, 'u-new'), 'staff', 'u-new'), selfDoc('u-new', { roles: ['scorer', role] })));
    }
  });

  test('不能建立別人的身分', async () => {
    await assertFails(setDoc(doc(authed(env, 'u-new'), 'staff', 'u-other'), selfDoc('u-other')));
  });

  test('uid 欄位必須等於自己（不可冒名）', async () => {
    await assertFails(setDoc(doc(authed(env, 'u-new'), 'staff', 'u-new'), selfDoc('u-someone-else')));
  });

  test('不能把既有的正式工作人員文件改掉', async () => {
    // u-scorer 是 seed 出來的正式身分，沒有 selfServe 標記
    await assertFails(updateDoc(doc(authed(env, 'u-scorer'), 'staff', 'u-scorer'), { roles: ['admin'] }));
  });

  test('自助身分可以改自己的角色，但仍限於白名單', async () => {
    await setDoc(doc(authed(env, 'u-new'), 'staff', 'u-new'), selfDoc('u-new'));
    await assertSucceeds(updateDoc(doc(authed(env, 'u-new'), 'staff', 'u-new'), {
      ...selfDoc('u-new', { roles: ['referee'] })
    }));
    await assertFails(updateDoc(doc(authed(env, 'u-new'), 'staff', 'u-new'), {
      ...selfDoc('u-new', { roles: ['admin'] })
    }));
  });

  test('不能拿掉 selfServe 標記把自己「升級」成正式身分', async () => {
    await setDoc(doc(authed(env, 'u-new'), 'staff', 'u-new'), selfDoc('u-new'));
    await assertFails(updateDoc(doc(authed(env, 'u-new'), 'staff', 'u-new'), {
      ...selfDoc('u-new'), selfServe: false
    }));
  });

  test('未登入者不能自助建立', async () => {
    await assertFails(setDoc(doc(guest(env), 'staff', 'anon'), selfDoc('anon')));
  });

  test('roles 不能是空陣列（空陣列等於沒有身分，但會佔用文件）', async () => {
    await assertFails(setDoc(doc(authed(env, 'u-new'), 'staff', 'u-new'), selfDoc('u-new', { roles: [] })));
  });

  test('active 必須為 true（不可建立停權中的身分規避檢查）', async () => {
    await assertFails(setDoc(doc(authed(env, 'u-new'), 'staff', 'u-new'), selfDoc('u-new', { active: false })));
  });
});

describe('自助身分的實際權限與正式賽務相同（不多也不少）', () => {
  beforeEach(async () => {
    await enableSelfServe(true);
    await setDoc(doc(authed(env, 'u-new'), 'staff', 'u-new'), selfDoc('u-new'));
  });

  test('可以寫自己指派場地的比分', async () => {
    await assertSucceeds(updateDoc(doc(authed(env, 'u-new'), 'events', EVENT, 'matches', 'AO-G-A-01'), {
      score: { home: 1, away: 0 }, updatedBy: 'u-new'
    }));
  });

  test('不能寫別的場地', async () => {
    await assertFails(updateDoc(doc(authed(env, 'u-new'), 'events', EVENT, 'matches', 'AO-G-B-01'), {
      score: { home: 1, away: 0 }, updatedBy: 'u-new'
    }));
  });

  test('不能改設定、不能建場次（沒有 admin 權限）', async () => {
    await assertFails(setDoc(doc(authed(env, 'u-new'), 'config', 'featureFlags'), { x: 1 }));
    await assertFails(setDoc(doc(authed(env, 'u-new'), 'events', EVENT, 'matches', 'NEW-1'), { matchId: 'NEW-1' }));
  });
});
