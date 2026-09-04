/**
 * firestore.rules｜身分授權頁實際會發的請求（R99–R108）
 * 對應 docs/10 §5.1、R-RULES-003
 *
 * R34–R39 已經守住「誰改得動身分」。這一組守的是另一件事：
 * **`#/admin/staff` 這一頁真的跑得起來嗎**。
 *
 * 兩者不一樣。單一文件的 get 過得了，不代表 collection 的 list 過得了——
 * Firestore 對查詢的判定是「規則在不看文件內容的情況下能不能成立」。
 * 名錄列不出來的話這一頁是空的，而且**不會有任何錯誤訊息**：
 * 總管只會看到「還沒有人登入過」，然後以為系統壞了。
 */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, setDoc, updateDoc, getDoc, getDocs } from 'firebase/firestore';
import { makeEnv, seedBaseline, asAdminSdk, authed, guest, EVENT } from './helpers.js';

let env;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seedBaseline(env);
  // 名錄裡先有兩個登入過的人（真實情況：lineLogin Function 每次登入寫一筆）
  await asAdminSdk(env, async db => {
    await setDoc(doc(db, 'users', 'u-plain'), { uid: 'u-plain', displayName: '路人甲' });
    await setDoc(doc(db, 'users', 'u-scorer'), { uid: 'u-scorer', displayName: '記錄員' });
  });
});

const staffRef = (db, u) => doc(db, 'staff', u);
const staffDoc = (over = {}) => ({
  uid: 'u-plain', name: '路人甲', lineUserId: 'u-plain',
  roles: ['scorer'], active: true,
  assignment: { eventId: EVENT, date: null, venueIds: [], divisionIds: [], challengeIds: [] },
  deviceLabel: null,
  ...over
});

describe('R99–R102 這一頁讀得到東西嗎', () => {
  test('R99 ⭐ 大總管列得出 users 名錄', async () => {
    // 這是唯一查得到 LINE uid 的地方。列不出來就永遠指派不了任何人。
    await assertSucceeds(getDocs(collection(authed(env, 'u-super'), 'users')));
  });

  test('R100 ⭐ 大總管列得出 staff（要看得到現在有誰）', async () => {
    await assertSucceeds(getDocs(collection(authed(env, 'u-super'), 'staff')));
  });

  test('R101 ⭐ 一般登入者列不出名錄（那是全站每一個人的名字）', async () => {
    await assertFails(getDocs(collection(authed(env, 'u-plain'), 'users')));
    await assertFails(getDocs(collection(authed(env, 'u-plain'), 'staff')));
  });

  test('R102 訪客連列都不能列', async () => {
    await assertFails(getDocs(collection(guest(env), 'users')));
    await assertFails(getDocs(collection(guest(env), 'staff')));
  });
});

describe('R103–R108 這一頁寫得進去嗎', () => {
  test('R103 ⭐ 指派：整份 setDoc 寫得進去（頁面用的就是這一支）', async () => {
    // 用 setDoc 整份覆蓋而不是 merge：改身分時舊的 venueIds 一定要被換掉
    await assertSucceeds(setDoc(staffRef(authed(env, 'u-super'), 'u-plain'), staffDoc()));
  });

  test('R104 ⭐ 五種可指派的身分都放行，super_admin 擋住', async () => {
    for (const role of ['booth', 'checkin', 'referee', 'scorer', 'admin']) {
      await assertSucceeds(
        setDoc(staffRef(authed(env, 'u-super'), 'u-plain'), staffDoc({ roles: [role] })));
    }
    await assertFails(
      setDoc(staffRef(authed(env, 'u-super'), 'u-plain'), staffDoc({ roles: ['super_admin'] })));
  });

  test('R105 ⭐ 空的 roles 擋得住', async () => {
    // 「有身分文件但一個角色都沒有」比沒有文件更難查：
    // myRoles() 回空陣列，人看起來被指派了，實際上什麼都不能做。
    await assertFails(setDoc(staffRef(authed(env, 'u-super'), 'u-plain'), staffDoc({ roles: [] })));
  });

  test('R106 ⭐ 停用別人：只動 active、roles 不變要放行', async () => {
    // 頁面上的「停用」就是這一支。擋掉的話停用鈕按了會失敗，
    // 而 rules 給的訊息只有 permission-denied。
    await asAdminSdk(env, db => setDoc(staffRef(db, 'u-plain'), staffDoc()));
    await assertSucceeds(updateDoc(staffRef(authed(env, 'u-super'), 'u-plain'), { active: false }));
    await assertSucceeds(updateDoc(staffRef(authed(env, 'u-super'), 'u-plain'), { active: true }));
  });

  test('R107 ⭐ 管理員停用不了任何人（連自己都不行）', async () => {
    await asAdminSdk(env, db => setDoc(staffRef(db, 'u-plain'), staffDoc()));
    await assertFails(updateDoc(staffRef(authed(env, 'u-admin'), 'u-plain'), { active: false }));
    await assertFails(updateDoc(staffRef(authed(env, 'u-admin'), 'u-admin'), { active: false }));
  });

  test('R108 ⭐ 被停用的人立刻失去權限（active 是真的閘門）', async () => {
    // 停用如果只是畫面上灰掉，那停用等於沒有發生
    await asAdminSdk(env, db => setDoc(staffRef(db, 'u-plain'), staffDoc({ roles: ['scorer'] })));
    const mRef = db => doc(db, 'events', EVENT, 'matches', 'AO-G-A-01');
    const writeScore = (home) => updateDoc(mRef(authed(env, 'u-plain')), {
      score: { home, away: 0 }, updatedBy: 'u-plain'
    });
    await assertSucceeds(writeScore(1));

    await asAdminSdk(env, db => updateDoc(staffRef(db, 'u-plain'), { active: false }));
    await assertFails(writeScore(2));
  });
});

describe('R109–R112 權限開關（`#/admin/perms` 實際會發的請求）', () => {
  const permRef = (db, role) => doc(db, 'rolePermissions', role);

  beforeEach(async () => {
    await asAdminSdk(env, db => setDoc(permRef(db, 'scorer'), {
      role: 'scorer',
      perms: { 'match.finish': true, 'match.score.write': true, 'match.undo': true }
    }));
  });

  test('R109 ⭐ merge 寫入只動一條，其他權限原封不動', async () => {
    // 這一條在測**真的 Firestore**，不是我們的替身。
    // 替身的 setDoc 原本是淺層合併，會把 perms 底下其他十幾條整組刪掉——
    // 而畫面看起來完全正常（讀不到值就走預設）。
    // 沒有這一條，替身漂移就沒有人會發現。
    await assertSucceeds(setDoc(permRef(authed(env, 'u-super'), 'scorer'),
      { role: 'scorer', perms: { 'match.finish': false } }, { merge: true }));

    const after = await asAdminSdk(env, db => getDoc(permRef(db, 'scorer')));
    expect(after.data().perms).toEqual({
      'match.finish': false, 'match.score.write': true, 'match.undo': true
    });
  });

  test('R110 ⭐ 只有總管改得動權限矩陣', async () => {
    const patch = { perms: { 'match.finish': false } };
    await assertFails(setDoc(permRef(authed(env, 'u-admin'), 'scorer'), patch, { merge: true }));
    await assertFails(setDoc(permRef(authed(env, 'u-scorer'), 'scorer'), patch, { merge: true }));
    await assertFails(setDoc(permRef(guest(env), 'scorer'), patch, { merge: true }));
  });

  test('R111 權限矩陣是公開可讀的（每個裝置載入時都要讀）', async () => {
    await assertSucceeds(getDocs(collection(guest(env), 'rolePermissions')));
  });

  test('R112 ⭐ 關掉畫面上的權限**不會**讓 rules 跟著放行', async () => {
    // R-PERM-002：動態權限只用在 UI 層。反過來說也要成立——
    // 把 match.score.write 關掉之後，rules 仍然照角色判斷；
    // 這一頁不是安全邊界，也不該假裝是。
    await asAdminSdk(env, db => setDoc(permRef(db, 'scorer'),
      { role: 'scorer', perms: { 'match.score.write': false } }, { merge: true }));
    await assertSucceeds(updateDoc(doc(authed(env, 'u-scorer'), 'events', EVENT, 'matches', 'AO-G-A-01'), {
      score: { home: 1, away: 0 }, updatedBy: 'u-scorer'
    }));
  });
});

describe('R113–R117 報名開關（`#/admin/registration`）', () => {
  const regRef = db => doc(db, 'config', 'registration');
  const patch = { open: false };

  beforeEach(async () => {
    await asAdminSdk(env, db => setDoc(regRef(db), {
      open: true, opensAt: null, closesAt: null, maxTeamsPerAccount: 3
    }));
  });

  test('R113 ⭐ 只有總管改得動報名開關', async () => {
    await assertSucceeds(setDoc(regRef(authed(env, 'u-super')), patch, { merge: true }));
  });

  test('R114 ⭐⭐ 管理員改不動——`config/{key}` 那條萬用字元不可以放行它', async () => {
    // ⚠️ Firestore 的規則在多條路徑同時命中時是 **OR**，不是「以最具體的為準」。
    //    所以「另外寫一條 match /config/registration 收緊」是**沒有用的**：
    //    萬用字元那條照樣會放行管理員，而且看起來完全像收緊了。
    //    這一條就是在守那個陷阱。
    await assertFails(setDoc(regRef(authed(env, 'u-admin')), patch, { merge: true }));
    await assertFails(updateDoc(regRef(authed(env, 'u-admin')), patch));
  });

  test('R115 記錄員與訪客更不用說', async () => {
    await assertFails(setDoc(regRef(authed(env, 'u-scorer')), patch, { merge: true }));
    await assertFails(setDoc(regRef(guest(env)), patch, { merge: true }));
  });

  test('R116 其他 config 仍然是管理員可寫（沒有被一起收緊）', async () => {
    await assertSucceeds(setDoc(doc(authed(env, 'u-admin'), 'config', 'featureFlags'),
      { scorerBoard: true }, { merge: true }));
  });

  test('R117 ⭐ 報名設定是公開可讀的（報名頁沒登入也要判斷得出開不開放）', async () => {
    await assertSucceeds(getDoc(regRef(guest(env))));
  });
});
