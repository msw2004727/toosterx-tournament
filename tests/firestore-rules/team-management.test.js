import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { makeEnv, seedBaseline, asAdminSdk, EVENT } from './helpers.js';
let env;
const ref = (db, ...parts) => doc(db, 'events', EVENT, 'teams', 'managed', ...parts);
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore(); await seedBaseline(env);
  await asAdminSdk(env, async db => {
    await setDoc(doc(db, 'config', 'registration'), { open: true, hidden: false });
    await setDoc(ref(db), { name: '球隊', captainUid: 'captain', status: 'draft', rosterLocked: false, managementLocked: true });
    await setDoc(ref(db, 'members', 'coach'), { name: '球員', kind: 'player', source: 'coach', addedBy: 'captain', guardianUid: null, status: 'approved', note: '' });
    await setDoc(ref(db, 'members', 'guardian'), { name: '申請球員', guardianUid: 'captain', status: 'pending', note: '' });
  });
});

test('隊長鎖定後可讀名冊但不能改球隊、備註、名冊或自行解鎖', async () => {
  const db = env.authenticatedContext('captain').firestore();
  await assertSucceeds(getDoc(ref(db, 'members', 'coach')));
  for (const patch of [{ name: '偷改' }, { announcement: '偷改公告' }, { managementLocked: false }]) await assertFails(updateDoc(ref(db), patch));
  await assertFails(updateDoc(ref(db, 'members', 'coach'), { note: '偷改備註' }));
  await assertFails(updateDoc(ref(db, 'members', 'coach'), { name: '偷改球員' }));
  // 同時是家長也不能繞過管理鎖。
  await assertFails(updateDoc(ref(db, 'members', 'guardian'), { name: '以家長入口偷改' }));
  await assertFails(setDoc(ref(db, 'members', 'new'), { name: '新增球員', kind: 'player', source: 'coach', addedBy: 'captain', guardianUid: null, status: 'approved' }));
});

test.each(['u-admin', 'u-super'])('管理員與總管可鎖定、解鎖與修改球隊：%s', async uid => {
  const db = env.authenticatedContext(uid).firestore();
  await assertSucceeds(updateDoc(ref(db), { managementLocked: false }));
  const cap = env.authenticatedContext('captain').firestore();
  await assertSucceeds(updateDoc(ref(cap), { name: '解鎖後可改' }));
  await assertSucceeds(updateDoc(ref(cap, 'members', 'coach'), { note: '解鎖後可改' }));
  await assertSucceeds(updateDoc(ref(db), { managementLocked: true, name: '管理員仍可改' }));
  await assertSucceeds(updateDoc(ref(db, 'members', 'coach'), { name: '管理員仍可改球員' }));
});

test('非隊長無法讀完整名冊，隊長無法偽造管理鎖欄位', async () => {
  const other = env.authenticatedContext('other').firestore(), cap = env.authenticatedContext('captain').firestore();
  await assertFails(getDoc(ref(other, 'members', 'coach')));
  await asAdminSdk(env, db => updateDoc(ref(db), { managementLocked: false }));
  await assertFails(updateDoc(ref(cap), { managementLocked: true }));
});

test('兼任記錄員的隊長也不能經由私密子集合修改已鎖球隊', async () => {
  await asAdminSdk(env, async db => {
    await setDoc(doc(db, 'staff', 'captain'), { active: true, roles: ['scorer'] });
    await setDoc(ref(db, 'private', 'contact'), { phone: '0900000000' });
  });
  await assertFails(updateDoc(ref(env.authenticatedContext('captain').firestore(), 'private', 'contact'), { phone: '0911111111' }));
  await assertSucceeds(updateDoc(ref(env.authenticatedContext('u-admin').firestore(), 'private', 'contact'), { phone: '0922222222' }));
});
