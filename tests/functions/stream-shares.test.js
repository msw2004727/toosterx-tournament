import { db } from '../../functions/admin.js';
import { shareMatchStreamFor } from '../../functions/stream-shares.js';

const EVENT = 'stream-share-test', MATCH = 'match-a', UID = 'line-user';
const base = () => db().doc(`events/${EVENT}/matches/${MATCH}`);
const req = (over = {}, uid = UID, provider = 'custom') => ({
  auth: uid ? { uid, token: { firebase: { sign_in_provider: provider } } } : null,
  data: { eventId: EVENT, matchId: MATCH, operationId: 'op-1', action: 'share',
    url: 'https://youtube.com/live/dQw4w9WgXcQ', ...over }
});
const share = async () => (await shareMatchStreamFor(req())).shareId;
const audits = () => db().collection(`events/${EVENT}/audits`).get();

beforeEach(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Emulator required');
  const project = process.env.GCLOUD_PROJECT || 'demo-fn-test';
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  if (!response.ok) throw Error('Emulator reset failed');
  const batch = db().batch();
  batch.set(base(), { status: 'scheduled' });
  batch.set(db().doc(`users/${UID}`), { uid: UID, displayName: 'LINE 球迷', phone: '0912345678' });
  batch.set(db().doc('users/other'), { displayName: '另一位球迷' });
  for (const [uid, roles, active] of [['admin', ['admin'], true], ['super', ['super_admin'], true],
    ['scorer', ['scorer'], true], ['referee', ['referee'], true], ['booth', ['booth'], true], ['inactive', ['admin'], false]]) {
    batch.set(db().doc(`staff/${uid}`), { roles, active });
  }
  await batch.commit();
});

test('LINE 一般用戶可分享，公開資料不含私人資料或 UID，身份由伺服器取用', async () => {
  const result = await shareMatchStreamFor(req({ displayName: '偽造名字', ownerUid: 'other' }));
  const published = (await base().collection('streamShares').doc(result.shareId).get()).data();
  expect(Object.keys(published).sort()).toEqual(['createdAt', 'displayName', 'shareId', 'videoId']);
  expect(published).toMatchObject({ displayName: 'LINE 球迷', videoId: 'dQw4w9WgXcQ' });
  expect((await base().collection('streamShareOwners').doc(result.shareId).get()).data().ownerUid).toBe(UID);
  const audit = (await audits()).docs[0].data();
  expect(audit).toMatchObject({ action: 'streamShare.created', actor: { uid: UID }, before: null,
    after: { matchId: MATCH, videoId: 'dQw4w9WgXcQ', displayName: 'LINE 球迷' } });
});

test.each(['anonymous', 'password', 'google.com'])('非 LINE 登入不能分享：%s', async provider => {
  await expect(shareMatchStreamFor(req({}, UID, provider))).rejects.toMatchObject({ code: 'permission-denied' });
  expect((await base().collection('streamShares').get()).size).toBe(0);
});
test('未登入、無名稱、無場次與偽裝網址都不寫入', async () => {
  await expect(shareMatchStreamFor(req({}, null))).rejects.toMatchObject({ code: 'unauthenticated' });
  await expect(shareMatchStreamFor(req({}, 'unknown'))).rejects.toMatchObject({ code: 'failed-precondition' });
  await expect(shareMatchStreamFor(req({ matchId: 'missing' }))).rejects.toMatchObject({ code: 'not-found' });
  await expect(shareMatchStreamFor(req({ url: 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ' }))).rejects.toMatchObject({ code: 'invalid-argument' });
  expect((await audits()).size).toBe(0);
});

test('同一操作重試只建立一筆，其他操作不能重複分享同一影片', async () => {
  expect(await shareMatchStreamFor(req())).toEqual(await shareMatchStreamFor(req()));
  await expect(shareMatchStreamFor(req({ operationId: 'op-2', url: 'https://youtu.be/dQw4w9WgXcQ?t=20' }))).rejects.toMatchObject({ code: 'already-exists' });
  expect((await base().collection('streamShares').get()).size).toBe(1);
  expect((await audits()).size).toBe(1);
});
test('同場可有多人及同一人多個影片，場次之間互相獨立', async () => {
  await share();
  await shareMatchStreamFor(req({ operationId: 'op-2' }, 'other'));
  await shareMatchStreamFor(req({ operationId: 'op-3', url: 'https://youtu.be/M7lc1UVf-VE' }));
  await db().doc(`events/${EVENT}/matches/match-b`).set({ status: 'finished' });
  await shareMatchStreamFor(req({ operationId: 'op-4', matchId: 'match-b' }));
  expect((await base().collection('streamShares').get()).size).toBe(3);
  expect((await db().collection(`events/${EVENT}/matches/match-b/streamShares`).get()).size).toBe(1);
});

test.each(['other', 'scorer', 'referee', 'booth', 'inactive'])('他人與管理員以下／停用身份不能移除：%s', async uid => {
  const shareId = await share();
  await expect(shareMatchStreamFor(req({ action: 'remove', shareId, operationId: 'remove-1' }, uid))).rejects.toMatchObject({ code: 'permission-denied' });
  expect((await base().collection('streamShares').doc(shareId).get()).exists).toBe(true);
  expect((await audits()).size).toBe(1);
});
test.each([UID, 'admin', 'super'])('本人、管理員與總管可以移除，保留稽核且可重試：%s', async uid => {
  const shareId = await share();
  const command = req({ action: 'remove', shareId, operationId: 'remove-1' }, uid, uid === UID ? 'custom' : 'anonymous');
  expect(await shareMatchStreamFor(command)).toEqual(await shareMatchStreamFor(command));
  expect((await base().collection('streamShares').doc(shareId).get()).exists).toBe(false);
  expect((await base().collection('streamShareOwners').doc(shareId).get()).exists).toBe(false);
  const removed = (await audits()).docs.map(doc => doc.data()).find(a => a.action === 'streamShare.removed');
  expect(removed).toMatchObject({ actor: { uid }, before: { matchId: MATCH, videoId: 'dQw4w9WgXcQ' }, after: null });
});
// Firestore 交易競爭會退避重試，CI Emulator 可能超過 Jest 預設的 5 秒。
test('收據不能重用於另一個連結，並行同片分享只成立一次', async () => {
  await share();
  await expect(shareMatchStreamFor(req({ url: 'https://youtu.be/M7lc1UVf-VE' }))).rejects.toMatchObject({ code: 'already-exists' });
  const results = await Promise.allSettled([shareMatchStreamFor(req({ operationId: 'op-a' }, 'other')),
    shareMatchStreamFor(req({ operationId: 'op-b' }, 'other'))]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect((await base().collection('streamShares').get()).size).toBe(2);
  expect((await audits()).size).toBe(2);
}, 20_000);
