/**
 * firestore.rules｜賽務角色的繼承鏈（R83–R92）
 * ------------------------------------------------------------------
 * 主辦 2026-09-03 指定：**向上包含**
 *
 *   挑戰攤位 < 檢錄員 < 裁判 < 記錄員 < 管理員 < 總管
 *
 * 這一組守兩個方向，兩個都會壞而且都不會有錯誤訊息：
 *   ① 往上：高階角色拿得到低階的全部權限（少了就變成要指派一堆身分）
 *   ② 往下：低階角色拿不到高階的（多了就是安靜的權限外洩）
 *
 * ⚠️ 特別守 `venue_owner`：它是 FC 的角色、level 3，數值正好夾在
 *    記錄員(2.4)與管理員(4)之間。規則若用 level 比大小，一個從 FC
 *    同步過來的「場主」會自動拿到記錄員的全部權限——那個人可能只是
 *    租場地的老闆。鏈是明列的，所以不會。
 */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';
import { makeEnv, seedBaseline, asAdminSdk, authed, EVENT, MATCH } from './helpers.js';

let env;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seedBaseline(env);
});

const matchRef = db => doc(db, 'events', EVENT, 'matches', MATCH);
const sheetRef = db => doc(db, 'events', EVENT, 'matchSheets', `${MATCH}__t-101`);
const memberRef = db => doc(db, 'events', EVENT, 'teams', 't-101', 'members', 'm-101-07');
const checkinRef = db => doc(db, 'events', EVENT, 'checkins', `${MATCH}__m-101-07`);

/** 所有測試角色都指派在 venue-a（MATCH 所在），讓「場地」不是變因 */
async function asRole(uid, roles) {
  await asAdminSdk(env, db => setDoc(doc(db, 'staff', uid), {
    uid, name: uid, roles, active: true,
    assignment: { eventId: EVENT, venueIds: ['venue-a'], divisionIds: [], challengeIds: ['g03-crossbar'] }
  }));
  return authed(env, uid);
}

const writeScore = db => updateDoc(matchRef(db), { score: { home: 1, away: 0 }, updatedBy: db._uid });
const writeSheet = db => setDoc(sheetRef(db), {
  matchId: MATCH, teamId: 't-101', starters: [], substitutes: [], status: 'draft'
});
const writeCheckin = (db, uid) => setDoc(checkinRef(db), {
  checkinId: `${MATCH}__m-101-07`, matchId: MATCH, teamId: 't-101', memberId: 'm-101-07',
  result: 'pass', method: 'manual', scannedBy: uid
});

describe('R83–R86 往上：高階拿得到低階的權限', () => {
  test('R83 ⭐ 記錄員做得了檢錄（繼承檢錄員）', async () => {
    const db = await asRole('u-h-scorer', ['scorer']);
    await assertSucceeds(writeCheckin(db, 'u-h-scorer'));
  });

  test('R84 ⭐ 裁判做得了檢錄，也讀得到球員個資', async () => {
    const db = await asRole('u-h-ref', ['referee']);
    await assertSucceeds(writeCheckin(db, 'u-h-ref'));
    await assertSucceeds(getDoc(memberRef(db)));
  });

  test('R85 ⭐ 記錄員編輯得了出場名單（繼承裁判）', async () => {
    const db = await asRole('u-h-scorer2', ['scorer']);
    await assertSucceeds(writeSheet(db));
  });

  test('R86 ⭐ 管理員什麼都做得了，不必另外指派賽務身分', async () => {
    const db = await asRole('u-h-admin', ['admin']);
    await assertSucceeds(writeCheckin(db, 'u-h-admin'));
    await assertSucceeds(writeSheet(db));
    await assertSucceeds(updateDoc(matchRef(db), { score: { home: 2, away: 1 }, updatedBy: 'u-h-admin' }));
  });
});

describe('R87–R90 往下：低階拿不到高階的權限', () => {
  test('R87 ⭐ 檢錄員記不了分', async () => {
    // 現場檢錄多半交給志工。這一條破了，等於每個志工都能改比分。
    const db = await asRole('u-h-chk', ['checkin']);
    await assertSucceeds(writeCheckin(db, 'u-h-chk'));          // 本職可以
    await assertFails(updateDoc(matchRef(db), { score: { home: 9, away: 0 }, updatedBy: 'u-h-chk' }));
  });

  test('R88 ⭐ 裁判記不了分（裁判 < 記錄員）', async () => {
    // 這是 2026-09-03 的階層調整帶來的行為改變：改動前裁判寫得了比分。
    const db = await asRole('u-h-ref2', ['referee']);
    await assertSucceeds(writeSheet(db));                        // 本職可以
    await assertFails(updateDoc(matchRef(db), { score: { home: 3, away: 0 }, updatedBy: 'u-h-ref2' }));
  });

  test('R89 ⭐ 挑戰攤位連檢錄都不行', async () => {
    const db = await asRole('u-h-booth', ['booth']);
    await assertFails(writeCheckin(db, 'u-h-booth'));
    await assertFails(getDoc(memberRef(db)));
  });

  test('R90 ⭐ 記錄員不能覆核完賽（覆核是第二雙眼睛）', async () => {
    // 記分的人自己覆核自己等於沒有覆核（主辦 2026-09-03 決定）
    await asAdminSdk(env, db => updateDoc(matchRef(db), {
      status: 'finished', lock: { locked: true, lockedBy: 'someone' }
    }));
    const db = await asRole('u-h-scorer3', ['scorer']);
    await assertFails(updateDoc(matchRef(db), { status: 'confirmed', updatedBy: 'u-h-scorer3' }));

    const admin = await asRole('u-h-admin2', ['admin']);
    await assertSucceeds(updateDoc(matchRef(admin), { status: 'confirmed', updatedBy: 'u-h-admin2' }));
  });
});

describe('R91–R92 鏈外的角色不繼承任何東西', () => {
  test('R91 ⭐ FC 的「場主」拿不到賽務權限（level 3 夾在記錄員與管理員之間）', async () => {
    // 用 level 比大小的話，venue_owner(3) > scorer(2.4)，
    // 一個租場地的老闆會自動拿到記分權。鏈是明列的，所以不會。
    const db = await asRole('u-h-venue', ['venue_owner']);
    await assertFails(updateDoc(matchRef(db), { score: { home: 1, away: 0 }, updatedBy: 'u-h-venue' }));
    await assertFails(writeCheckin(db, 'u-h-venue'));
    await assertFails(writeSheet(db));
    await assertFails(getDoc(memberRef(db)));
  });

  test('R92 ⭐ 領隊與教練也一樣（他們是球隊身分，不是賽務身分）', async () => {
    for (const role of ['captain', 'coach']) {
      const db = await asRole(`u-h-${role}`, [role]);
      await assertFails(updateDoc(matchRef(db), { score: { home: 1, away: 0 }, updatedBy: `u-h-${role}` }));
      await assertFails(writeCheckin(db, `u-h-${role}`));
    }
  });

  test('R92b 完全不認識的角色不會被當成任何身分', async () => {
    const db = await asRole('u-h-wat', ['wizard']);
    await assertFails(updateDoc(matchRef(db), { score: { home: 1, away: 0 }, updatedBy: 'u-h-wat' }));
    await assertFails(writeCheckin(db, 'u-h-wat'));
  });
});
