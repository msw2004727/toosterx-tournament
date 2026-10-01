import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { makeEnv, seedBaseline, asAdminSdk, authed, guest, EVENT, MATCH } from './helpers.js';
let env;
const publicRef = db => doc(db, 'events', EVENT, 'matches', MATCH, 'streamShares', 'share-1');
const ownerRef = db => doc(db, 'events', EVENT, 'matches', MATCH, 'streamShareOwners', 'share-1');
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore(); await seedBaseline(env);
  await asAdminSdk(env, async db => {
    await setDoc(publicRef(db), { shareId: 'share-1', displayName: '球迷', videoId: 'dQw4w9WgXcQ' });
    await setDoc(ownerRef(db), { ownerUid: 'owner' });
  });
});
test('所有人可讀直播分享，私人 LINE UID 僅本人／管理員可读', async () => {
  await assertSucceeds(getDoc(publicRef(guest(env))));
  await assertFails(getDoc(ownerRef(guest(env))));
  await assertFails(getDoc(ownerRef(authed(env, 'other'))));
  await assertSucceeds(getDoc(ownerRef(authed(env, 'owner'))));
  await assertSucceeds(getDoc(ownerRef(authed(env, 'u-admin'))));
  await assertSucceeds(getDoc(ownerRef(authed(env, 'u-super'))));
  await assertFails(getDoc(ownerRef(authed(env, 'u-suspended'))));
});
test('本人可查詢自己的移除權限，不能列出別人的所有權', async () => {
  const owners = db => collection(db, 'events', EVENT, 'matches', MATCH, 'streamShareOwners');
  await assertSucceeds(getDocs(query(owners(authed(env, 'owner')), where('ownerUid', '==', 'owner'))));
  await assertFails(getDocs(owners(authed(env, 'owner'))));
});
test.each(['owner', 'other', 'u-scorer', 'u-admin', 'u-super'])('任何客戶端不能繞過 callable 修改或刪除分享／所有權：%s', async uid => {
  const db = authed(env, uid);
  for (const ref of [publicRef(db), ownerRef(db)]) {
    await assertFails(setDoc(ref, { ownerUid: uid, videoId: 'M7lc1UVf-VE' }));
    await assertFails(updateDoc(ref, { displayName: '偽造', ownerUid: uid }));
    await assertFails(deleteDoc(ref));
  }
});
