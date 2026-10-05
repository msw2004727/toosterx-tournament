import { db } from '../../functions/admin.js';
import { FORMATS, RANKING_RULES } from '../../js/engine/formats.js';
import { planGeneration, matchDocOf } from '../../js/engine/schedule-doc.js';
import { recalcStandingsForStage, resolveDownstreamOf, computeFinalRankingFor } from '../../functions/pipeline.js';

const E = 'top-seed-bye-test', D = 'd', base = () => db().doc(`events/${E}`);
const format = FORMATS.F8_GROUP_TOP_SEED_BYE;
const division = { divisionId: D, code: 'D', date: '2026-10-10', formatId: format.formatId,
  rankingRuleId: 'RR_FEDA_2026', matchDurationMin: 30, playersOnField: 9 };
const teams = Array.from({ length: 8 }, (_, i) => ({ teamId: `t${i + 1}`, name: `隊${i + 1}`, divisionId: D, status: 'approved' }));
let plan;
beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST, project = process.env.GCLOUD_PROJECT;
  if (!host || !project?.startsWith('demo-')) throw new Error('Emulator required');
  const r = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  if (!r.ok) throw new Error('Reset failed');
  plan = planGeneration({ division, orderedTeams: teams, format });
  const b = db().batch();
  b.set(base(), { dates: [division.date] }); b.set(base().collection('divisions').doc(D), division);
  b.set(db().doc('config/formats'), { formats: { [format.formatId]: format } });
  b.set(db().doc('config/rankingRules'), { rules: RANKING_RULES });
  for (const t of teams) b.set(base().collection('teams').doc(t.teamId), t);
  for (const g of plan.groupDocs) {
    b.set(base().collection('divisions').doc(D).collection('stages').doc(g.stageId).collection('groups').doc(g.groupId), g);
    b.set(base().collection('standings').doc(`${D}__group__${g.groupId}`), { standingId: `${D}__group__${g.groupId}`, divisionId: D, stageId: 'group', groupId: g.groupId, rows: [] });
  }
  for (const m of plan.matches) b.set(base().collection('matches').doc(m.matchId), matchDocOf({ m, division, eventId: E }));
  await b.commit();
});

const byKey = async key => (await base().collection('matches').where('matchKey', '==', key).get()).docs[0];
async function completeStage(stageId) {
  const snap = await base().collection('matches').where('stageId', '==', stageId).get();
  const b = db().batch();
  for (const d of snap.docs) {
    const m = d.data();
    const homeWins = stageId !== 'group' || Number(m.home.teamId.slice(1)) < Number(m.away.teamId.slice(1));
    b.update(d.ref, { status: 'confirmed', score: { home: homeWins ? 1 : 0, away: homeWins ? 0 : 1 }, result: { winner: homeWins ? 'home' : 'away' } });
  }
  await b.commit();
}

test('四個階段依序從資料庫解算，首名輪空、淘汰敗隊五六名及末位七八名均接對', async () => {
  expect((await resolveDownstreamOf({ eventId: E, divisionId: D, stageId: 'group' }))[0].ready).toBe(false);
  await completeStage('group');
  await recalcStandingsForStage({ eventId: E, divisionId: D, stageId: 'group' });
  const q = await resolveDownstreamOf({ eventId: E, divisionId: D, stageId: 'group' });
  expect(q[0].stageId).toBe('qualifier'); expect(q[0].applied).toHaveLength(2);
  expect((await byKey('SF1')).data().teamIds).toEqual([]);
  await completeStage('qualifier');
  const s = await resolveDownstreamOf({ eventId: E, divisionId: D, stageId: 'qualifier' });
  expect(s[0].stageId).toBe('placement'); expect(s[0].applied).toHaveLength(2);
  expect((await byKey('SF1')).data().teamIds).toEqual(['t1', 't5']);
  expect((await byKey('SF2')).data().teamIds).toEqual(['t2', 't4']);
  await completeStage('placement');
  const f = await resolveDownstreamOf({ eventId: E, divisionId: D, stageId: 'placement' });
  expect(f[0].applied).toHaveLength(4);
  expect((await byKey('F5')).data().teamIds).toEqual(['t6', 't3']);
  expect((await byKey('F7')).data().teamIds).toEqual(['t8', 't7']);
  await completeStage('final');
  const ranking = await computeFinalRankingFor({ eventId: E, divisionId: D });
  expect(ranking.complete).toBe(true);
  expect(new Set(ranking.ranking.map(r => r.teamId)).size).toBe(8);
}, 20000);
