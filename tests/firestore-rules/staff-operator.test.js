import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';
import { makeEnv, seedBaseline, asAdminSdk, authed, EVENT, MATCH, MATCH_B } from './helpers.js';
let env;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore(); await seedBaseline(env);
  await asAdminSdk(env, db => setDoc(doc(db, 'staff', 'operator'), { roles: ['staff'], active: true,
    assignment: { eventId: EVENT, venueIds: ['venue-a'], divisionIds: [], challengeIds: [] } }));
});
const ref = (db, id = MATCH) => doc(db, 'events', EVENT, 'matches', id);
test('STAFF-RULES can score and use operational records in assigned venue', async () => {
  const db = authed(env, 'operator');
  await assertSucceeds(updateDoc(ref(db), { score: { home: 1, away: 0 }, updatedBy: 'operator' }));
  await assertSucceeds(getDoc(doc(db, 'events', EVENT, 'teams', 't-101', 'members', 'm-101-07')));
  await assertSucceeds(setDoc(doc(db, 'events', EVENT, 'matchSheets', `${MATCH}__t-101`), {
    matchId: MATCH, teamId: 't-101', players: [], confirmed: true, confirmedBy: 'operator'
  }));
});
test('STAFF-RULES cannot operate another venue, promote anyone, or act as admin', async () => {
  const db = authed(env, 'operator');
  await assertFails(updateDoc(ref(db, MATCH_B), { score: { home: 1, away: 0 }, updatedBy: 'operator' }));
  await assertFails(setDoc(doc(db, 'staff', 'new-user'), { roles: ['staff'], active: true }));
  await assertFails(updateDoc(doc(db, 'events', EVENT, 'teams', 't-101'), { name: '越權改名' }));
  await asAdminSdk(env, db => updateDoc(ref(db), { status: 'finished', lock: { locked: true } }));
  await assertFails(updateDoc(ref(db), { status: 'confirmed', updatedBy: 'operator' }));
  await assertFails(updateDoc(ref(db), { status: 'live', lock: { locked: false }, updatedBy: 'operator' }));
});
test('STAFF-RULES suspended staff immediately loses write and private read access', async () => {
  await asAdminSdk(env, db => updateDoc(doc(db, 'staff', 'operator'), { active: false }));
  const db = authed(env, 'operator');
  await assertFails(updateDoc(ref(db), { score: { home: 1, away: 0 }, updatedBy: 'operator' }));
  await assertFails(getDoc(doc(db, 'events', EVENT, 'teams', 't-101', 'members', 'm-101-07')));
});
