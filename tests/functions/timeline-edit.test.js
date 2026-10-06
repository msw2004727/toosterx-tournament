import { jest } from '@jest/globals';
import { db } from '../../functions/admin.js';
import { editTimelineEventFor } from '../../functions/timeline-edit.js';
import { matchBasis } from '../../functions/management.js';
import { timelineEditBasis } from '../../js/engine/timeline-edit.js';
import { onTimelineWritten } from '../../functions/index.js';
import { RANKING_RULES } from '../../js/engine/formats.js';
jest.setTimeout(30000);
const E = 'timeline-edit-test', base = () => db().doc(`events/${E}`), mr = () => base().collection('matches').doc('m');
const er = () => mr().collection('timeline').doc('e');
const event = { timelineId: 'e', matchId: 'm', seq: 1, type: 'goal', side: 'home', teamId: 'h', periodId: 'h1',
  clockSec: 60, minute: 1, playerId: 'p', playerName: '甲', jerseyNo: 167, createdBy: 'scorer', note: '', voided: false, resetRevision: 2 };
const match = { matchId: 'm', divisionId: 'd', stageId: 'group', groupId: 'A', venueId: 'v', home: { teamId: 'h', name: '主队' }, away: { teamId: 'a', name: '客队' },
  status: 'live', period: 'h1', score: { home: 3, away: 2 }, penaltyScore: null, clock: { running: true, periodStartedAt: 123, elapsedSecAtPause: 0 },
  lock: { locked: false }, resetRevision: 2, managementRevision: 0 };
const audits = () => base().collection('audits').where('action', '==', 'timeline.edit').get();
async function request(patch = { type: 'own_goal' }, { uid = 'scorer', context = 'live', operationId = 'edit-1' } = {}) {
  return { auth: uid ? { uid } : null, data: { eventId: E, matchId: 'm', timelineId: 'e', operationId, context, patch, reason: '核對現場紀錄',
    expected: { match: matchBasis((await mr().get()).data()), event: timelineEditBasis((await er().get()).data()) } } };
}
beforeEach(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw Error('demo Emulator required');
  const r = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (!r.ok) throw Error('Emulator reset failed');
  const b = db().batch(); b.set(base(), { dates: ['2026-10-09'] });
  for (const [uid, roles, active, venueIds] of [['admin', ['admin'], true, []], ['scorer', ['scorer'], true, ['v']], ['other', ['scorer'], true, ['wrong']], ['booth', ['booth'], true, []], ['inactive', ['admin'], false, []]])
    b.set(db().doc(`staff/${uid}`), { roles, active, assignment: { venueIds }, name: uid });
  b.set(mr(), match); b.set(er(), event);
  b.set(base().collection('divisions').doc('d'), { periods: 1, matchDurationMin: 30, formatId: 'EDIT', rankingRuleId: 'RR_FEDA_DEFAULT', withdrawalPolicy: 'voidAll', finalRankingPublished: true });
  b.set(db().doc('config/formats'), { formats: { EDIT: { stages: [{ stageId: 'group', slots: [] }] } } });
  b.set(db().doc('config/rankingRules'), { rules: RANKING_RULES });
  b.set(base().collection('divisions').doc('d').collection('stages').doc('group').collection('groups').doc('A'), { teamIds: ['h', 'a'] });
  for (const tid of ['h', 'a']) b.set(base().collection('teams').doc(tid), { teamId: tid, divisionId: 'd', name: tid, status: 'approved' });
  for (const [tid, id, name, jerseyNo] of [['h', 'p', '甲', 167], ['h', 'q', '乙', null], ['a', 'r', '丙', 9]])
    b.set(base().collection('teams').doc(tid).collection('roster').doc(id), { displayName: name, jerseyNo });
  await b.commit();
});
afterEach(() => jest.restoreAllMocks());
test('EDIT-ATOMIC live correction adjusts only score delta, retains clock, records before/after and is idempotent', async () => {
  const req = await request(); const result = await editTimelineEventFor(req);
  expect(result).toMatchObject({ matchId: 'm', timelineId: 'e', editRevision: 1, score: { home: 2, away: 3 } });
  expect((await mr().get()).data()).toMatchObject({ status: 'live', score: { home: 2, away: 3 }, clock: match.clock, managementRevision: 1 });
  expect((await er().get()).data()).toMatchObject({ type: 'own_goal', goalType: 'own', createdBy: 'scorer', editedBy: 'scorer', seq: 1 });
  expect((await audits()).docs[0].data()).toMatchObject({ actor: { uid: 'scorer' }, reason: '核對現場紀錄', before: { event: { type: 'goal' } }, after: { event: { type: 'own_goal' } } });
  expect(await editTimelineEventFor(req)).toEqual(result); expect((await audits()).size).toBe(1);
  expect((await base().collection('divisions').doc('d').get()).data().finalRankingPublished).toBe(false);
});
test('EDIT-AUTH current role, assigned venue, final lock and admin context are enforced', async () => {
  const req = await request();
  for (const uid of ['booth', 'inactive', 'other']) await expect(editTimelineEventFor({ ...req, auth: { uid } })).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(editTimelineEventFor({ ...req, auth: null })).rejects.toMatchObject({ code: 'unauthenticated' });
  await expect(editTimelineEventFor({ ...req, data: { ...req.data, context: 'admin' } })).rejects.toMatchObject({ code: 'permission-denied' });
  await mr().update({ status: 'finished', lock: { locked: true } });
  await expect(editTimelineEventFor(await request())).rejects.toMatchObject({ code: 'failed-precondition' });
  await expect(editTimelineEventFor(await request({}, { uid: 'admin', context: 'live' }))).rejects.toMatchObject({ code: 'failed-precondition' });
  const result = await editTimelineEventFor(await request({ playerId: 'q' }, { uid: 'admin', context: 'admin' }));
  expect(result.editRevision).toBe(1); expect((await mr().get()).data()).toMatchObject({ status: 'finished', lock: { locked: true }, revisionCount: 1 });
});
test('EDIT-STALE changed event, manual scoreboard, reset generation and concurrent corrections cannot be overwritten', async () => {
  const req = await request(); await er().update({ note: '其他人先修改' });
  await expect(editTimelineEventFor(req)).rejects.toMatchObject({ code: 'aborted' });
  const fresh = await request(); await mr().update({ score: { home: 4, away: 2 } });
  await expect(editTimelineEventFor(fresh)).rejects.toMatchObject({ code: 'aborted' });
  const a = await request(), b = await request({ type: 'card', cardType: 'red' }, { operationId: 'other-edit' });
  const result = await Promise.allSettled([editTimelineEventFor(a), editTimelineEventFor(b)]);
  expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect((await audits()).size).toBe(1);
  await er().update({ resetRevision: 1 }); await expect(editTimelineEventFor(await request({}, { operationId: 'reset-check' }))).rejects.toMatchObject({ code: 'aborted' });
});
test('EDIT-ROLLBACK audit failure leaves event, score, ranking and receipt untouched', async () => {
  const req = await request(); const old = db().runTransaction.bind(db());
  jest.spyOn(db(), 'runTransaction').mockImplementation(cb => old(async tx => {
    const create = tx.create.bind(tx); tx.create = (ref, doc) => { if (ref.path.includes('/audits/')) throw Error('audit fault'); return create(ref, doc); }; return cb(tx);
  }));
  await expect(editTimelineEventFor(req)).rejects.toThrow('audit fault');
  expect((await er().get()).data()).toEqual(event); expect((await mr().get()).data()).toEqual(match);
  expect((await base().collection('divisions').doc('d').get()).data().finalRankingPublished).toBe(true);
  expect((await base().collection('managementOperations').doc('edit-1').get()).exists).toBe(false);
});
test('EDIT-VALIDATION reason, protected fields, roster membership and minutes are validated on server', async () => {
  const req = await request();
  for (const data of [{ reason: '' }, { patch: { playerName: '偽造' } }, { patch: { playerId: 'r' } }, { patch: { periodId: 'h2' } }, { patch: { clockSec: -1 } }])
    await expect(editTimelineEventFor({ ...req, data: { ...req.data, ...data } })).rejects.toMatchObject({ code: 'invalid-argument' });
  expect((await audits()).size).toBe(0);
});
test('EDIT-STATS finished corrections update result, standing, scorer board and card deductions through the existing trigger', async () => {
  await mr().update({ status: 'confirmed', lock: { locked: true }, result: { winner: 'home', method: 'regulation', homePoints: 3, awayPoints: 0 } });
  await editTimelineEventFor(await request({ playerId: 'q' }, { uid: 'admin', context: 'admin' }));
  await onTimelineWritten.run({ params: { eventId: E, matchId: 'm', timelineId: 'e' } });
  const board = (await base().collection('boards').doc('scorers').get()).data();
  expect(board.rows[0]).toMatchObject({ playerId: 'q', goals: 1 });
  await editTimelineEventFor(await request({ type: 'own_goal' }, { uid: 'admin', context: 'admin', operationId: 'own-goal' }));
  await onTimelineWritten.run({ params: { eventId: E, matchId: 'm', timelineId: 'e' } });
  expect((await mr().get()).data()).toMatchObject({ result: { winner: 'away' }, score: { home: 2, away: 3 } });
  const standings = (await base().collection('standings').get()).docs[0].data();
  expect(standings.rows.find(r => r.teamId === 'a').points).toBe(3);
  expect((await base().collection('boards').doc('scorers').get()).data().rows).toHaveLength(0);
  await editTimelineEventFor(await request({ type: 'card', cardType: 'red' }, { uid: 'admin', context: 'admin', operationId: 'red' }));
  await onTimelineWritten.run({ params: { eventId: E, matchId: 'm', timelineId: 'e' } });
  expect((await base().collection('boards').doc('fairplay').get()).data().rows.find(r => r.teamId === 'h').fairPlayPoints).toBe(-4);
}, 30000);
