import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { makeEnv, seedBaseline, asAdminSdk, authed, EVENT, MATCH } from './helpers.js';

let env;
const path = (db, ...parts) => doc(db, 'events', EVENT, ...parts);
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore(); await seedBaseline(env);
  await asAdminSdk(env, db => updateDoc(path(db, 'matches', MATCH), { status: 'scheduled', period: 'pre',
    score: { home: 0, away: 0 }, resetRevision: 2, writeNonce: null, lock: { locked: false } }));
});

test('歸零後舊離線開賽或比分不能補傳；新裝置可正常記分', async () => {
  for (const who of ['u-scorer', 'u-admin']) {
    const ref = path(authed(env, who), 'matches', MATCH);
    await assertFails(updateDoc(ref, { status: 'live', updatedBy: who }));
    await assertFails(updateDoc(ref, { score: { home: 1, away: 0 }, updatedBy: who, resetRevision: 1, writeNonce: crypto.randomUUID() }));
    await assertFails(updateDoc(ref, { status: 'live', updatedBy: who, resetRevision: 2, writeNonce: null }));
  }
  const ref = path(authed(env, 'u-scorer'), 'matches', MATCH);
  await assertSucceeds(updateDoc(ref, { status: 'live', updatedBy: 'u-scorer', resetRevision: 2, writeNonce: crypto.randomUUID() }));
  const nonce=crypto.randomUUID();
  await assertSucceeds(updateDoc(ref, { score: { home: 1, away: 0 }, updatedBy: 'u-scorer', resetRevision: 2, writeNonce: nonce }));
  await assertFails(updateDoc(ref, { score: { home: 7, away: 0 }, updatedBy: 'u-scorer', resetRevision: 2, writeNonce: nonce }));
  await assertSucceeds(updateDoc(ref, { score: { home: 2, away: 0 }, updatedBy: 'u-scorer', resetRevision: 2, writeNonce: crypto.randomUUID() }));
});

test('歸零後舊事件、檢錄、出場名單皆擋下；新世代可重新建立', async () => {
  const scorer = authed(env, 'u-scorer'), checkin = authed(env, 'u-checkin'), referee = authed(env, 'u-referee');
  const targets = [
    [path(scorer, 'matches', MATCH, 'timeline', 'new'), { matchId: MATCH, createdBy: 'u-scorer', type: 'goal' }],
    [path(checkin, 'checkins', `${MATCH}__m-101-07`), { matchId: MATCH, memberId: 'm-101-07', teamId: 't-101', result: 'pass', scannedBy: 'u-checkin' }],
    [path(referee, 'matchSheets', `${MATCH}__t-101`), { matchId: MATCH, teamId: 't-101', players: [] }]
  ];
  for (const [ref, record] of targets) {
    await assertFails(setDoc(ref, record));
    await assertFails(setDoc(ref, { ...record, resetRevision: 1 }));
    await assertSucceeds(setDoc(ref, { ...record, resetRevision: 2 }));
  }
});
