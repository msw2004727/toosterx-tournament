import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { makeEnv, seedBaseline, asAdminSdk, authed, guest, EVENT, MATCH, MATCH_B, CHALLENGE } from './helpers.js';

let env;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedBaseline(env); });
const ref = (db, ...parts) => doc(db, 'events', EVENT, ...parts);

test.each([MATCH_B, 'missing'])('賽務事件不能寫到未指派或不存在的場次 %s', async id => {
  await assertFails(setDoc(ref(authed(env, 'u-scorer'), 'matches', id, 'timeline', 'e'), {
    matchId: id, createdBy: 'u-scorer', type: 'card', teamId: 't-101'
  }));
});

test('鎖定場次不能補登或作廢事件；管理員仍可更正', async () => {
  await asAdminSdk(env, async db => {
    await setDoc(ref(db, 'matches', MATCH, 'timeline', 'e'), { matchId: MATCH, type: 'card' });
    await updateDoc(ref(db, 'matches', MATCH), { 'lock.locked': true, status: 'finished' });
  });
  const db = authed(env, 'u-scorer');
  await assertFails(setDoc(ref(db, 'matches', MATCH, 'timeline', 'new'), { matchId: MATCH, createdBy: 'u-scorer' }));
  await assertFails(updateDoc(ref(db, 'matches', MATCH, 'timeline', 'e'), { voided: true, voidedBy: 'u-scorer' }));
  await assertSucceeds(updateDoc(ref(authed(env, 'u-admin'), 'matches', MATCH, 'timeline', 'e'), { voided: true }));
});

test('作廢事件須符合指派場地並由本人留痕', async () => {
  await asAdminSdk(env, db => setDoc(ref(db, 'matches', MATCH, 'timeline', 'e'), { matchId: MATCH, type: 'card' }));
  await assertFails(updateDoc(ref(authed(env, 'u-scorer-b'), 'matches', MATCH, 'timeline', 'e'), { voided: true, voidedBy: 'u-scorer-b' }));
  await assertFails(updateDoc(ref(authed(env, 'u-scorer'), 'matches', MATCH, 'timeline', 'e'), { voided: true, voidedBy: 'someone' }));
  await assertSucceeds(updateDoc(ref(authed(env, 'u-scorer'), 'matches', MATCH, 'timeline', 'e'), { voided: true, voidedBy: 'u-scorer' }));
});

test('出場名單限制場地、對戰球隊、場次存在性；不能挪用既有名單', async () => {
  const db = authed(env, 'u-referee');
  for (const [id, teamId] of [[MATCH_B, 't-101'], ['missing', 't-101'], [MATCH, 'other-team']]) {
    await assertFails(setDoc(ref(db, 'matchSheets', `${id}__${teamId}`), { matchId: id, teamId, players: [] }));
  }
  const target = ref(db, 'matchSheets', `${MATCH}__t-101`);
  await assertSucceeds(setDoc(target, { matchId: MATCH, teamId: 't-101', players: [] }));
  await assertFails(updateDoc(target, { matchId: MATCH_B }));
});

test('檢錄限制場地與對戰球隊，不能替不存在的場次留紀錄', async () => {
  const db = authed(env, 'u-checkin');
  for (const [id, teamId] of [[MATCH_B, 't-101'], ['missing', 't-101'], [MATCH, 'other-team']]) {
    await assertFails(setDoc(ref(db, 'checkins', `${id}__m-101-07`), {
      matchId: id, teamId, memberId: 'm-101-07', result: 'fail', scannedBy: 'u-checkin'
    }));
  }
  await asAdminSdk(env, db => setDoc(ref(db, 'checkins', `${MATCH_B}__m-101-07`), {
    matchId: MATCH_B, teamId: 't-101', memberId: 'm-101-07', result: null, scannedBy: 'u-checkin'
  }));
  await assertFails(updateDoc(ref(db, 'checkins', `${MATCH_B}__m-101-07`), { result: 'fail', scannedBy: 'u-checkin' }));
});

test('挑戰成績建立時間必須由伺服器決定，不能延長十分鐘作廢窗', async () => {
  const target = ref(authed(env, 'u-booth'), 'attempts', 'new');
  const data = { challengeId: CHALLENGE, playerId: 'FEDA-0001', staffUid: 'u-booth', rawValue: 2 };
  await assertFails(setDoc(target, { ...data, createdAt: Timestamp.fromMillis(Date.now() + 86400000) }));
  await assertFails(setDoc(target, data));
  await assertSucceeds(setDoc(target, { ...data, createdAt: serverTimestamp() }));
});

test('舊 registrations 路徑也必須遵守關閉及隱藏報名設定', async () => {
  const target = ref(guest(env), 'registrations', 'legacy');
  for (const config of [{ open: false }, { open: true, hidden: true }]) {
    await asAdminSdk(env, db => setDoc(doc(db, 'config', 'registration'), config));
    await assertFails(setDoc(target, { status: 'pending' }));
  }
});
