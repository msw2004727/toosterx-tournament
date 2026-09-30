const {runJestMutants}=require('./lib/jest-mutation.cjs');
const spec='tests/functions/consistency.test.js';
const m=(id,file,from,to,test,assertions,minTests=1)=>{
  if(['C07','C08'].includes(id)){
    const scope='export async function resolveAdvancementForStage({ eventId, divisionId, stageId, force = false, actorUid = null }) {\n';
    from=scope+from;to=scope+to;
  }
  return {id,name:id,file,from,to,spec,grep:`^${test} `,failure:test,assertions,minTests};
};
const pipeline='functions/pipeline.js',schedule='functions/schedule.js';
const prefix="  return db().runTransaction(async tx => {\n  const actor = await adminActor(tx, actorUid);\n  const division = await loadDivision(eventId, divisionId, tx);\n  const format = await loadFormat(division.formatId, tx);\n  const ctx = await advancementCtx(eventId, divisionId, format, tx, division);";
const MUTANTS=[
  m('C01',schedule,'const oldGroups = groupsSnap.docs.filter(d => d.ref.path.startsWith(`${divRef.path}/stages/`));','const oldGroups = [];','MC1',["expect((await div().collection('stages').doc('obsolete').collection('groups').get()).size).toBe(0)"]),
  m('C02',schedule,'if (old.some(scheduleHasStarted))','if (false)','MC2',["await expect(generateScheduleFor(generation())).rejects.toMatchObject({code:'failed-precondition'})"],5),
  m('C03',schedule,'if ((division.scheduleRevision ?? 0) !== expectedRevision)','if (false)','MC4',["await expect(generateScheduleFor(generation('stale',{expectedRevision:7}))).rejects.toMatchObject({code:'aborted'})"]),
  m('C04',schedule,'if (writes.length + deletes.length + 1 > 400 || bytes > 8 * 1024 * 1024)','if (false)','MC5',["await expect(generateScheduleFor(generation())).rejects.toMatchObject({code:'resource-exhausted'})"]),
  m('C05',schedule,'const matchId = `${m.matchId}__g-${generationId}`;','const matchId = m.matchId;','MC1',["expect(r.matchIds.every(id=>id.includes('__g-'))).toBe(true)"]),
  m('C06',schedule,'if (drawSeed !== null && JSON.stringify(drawOrder(approved, drawSeed).map(t => t.teamId)) !== JSON.stringify(orderedTeamIds))','if (false)','MC6',["await expect(generateScheduleFor(generation('draw',{drawSeed:123}))).rejects.toMatchObject({code:'invalid-argument'})"]),
  m('C07',pipeline,prefix,"  const division = await loadDivision(eventId, divisionId);\n  const format = await loadFormat(division.formatId);\n  const ctx = await advancementCtx(eventId, divisionId, format, null, division);\n  return db().runTransaction(async tx => {\n  const actor = await adminActor(tx, actorUid);",'MC7',["expect((await match('F1').get()).data().home.teamId).toBe('t2')"]),
  m('C08',pipeline,prefix,"  const division = await loadDivision(eventId, divisionId);\n  const format = await loadFormat(division.formatId);\n  const ctx = await advancementCtx(eventId, divisionId, format, null, division);\n  return db().runTransaction(async tx => {\n  const actor = await adminActor(tx, actorUid);",'MC8',["expect((await match('F1').get()).data().status).toBe('live')","expect((await match('F1').get()).data().score.home).toBe(1)"]),
  m('C09',pipeline,"if (target?.lock?.locked === true) { u.locked = true;","if (false) { u.locked = true;",'MC9',["expect(r.blocked.some(b=>b.matchId==='F1')).toBe(true)"]),
  m('C10',pipeline,'if (division.manualHold !== true) {','if (false) {','MC10',["expect((await match('F1').get()).data().teamIds).toEqual([])"]),
  m('C11','functions/index.js','await refreshDivisionFor({ eventId, divisionId });','void divisionId;','MC11',["expect(first.played).toBe(2)"]),
  m('C12','functions/management.js',"if(invalidateDivision?.finalRankingPublished===true){","if(false){",'MC12',["expect((await div().get()).data().finalRankingPublished).toBe(false)"]),
  m('C13','functions/store.js','if (tx) { tx.create(ref, doc); return ref.id; }','if (tx) { return ref.id; }','MC13',["await expect(manageEventFor(req)).rejects.toThrow('audit submission fault')"]),
  m('C14','functions/store.js',"staff?.active !== true || !Array.isArray(staff.roles)","false || !Array.isArray(staff.roles)",'MC15',["await expect(manageEventFor(a)).rejects.toMatchObject({code:'permission-denied'})"]),
  m('C15',pipeline,'tx.delete(rosterRef);   // 不存在也成功；提交錯誤傳出，由 trigger 重試','try { tx.delete(rosterRef); } catch {}','MC17',["await expect(syncRosterFor({eventId:E,teamId:'t1',memberId:'member'})).rejects.toThrow('projection transport failed')"]),
  m('C16',pipeline,"if (current?.status !== 'pending' || !current.guardianUid)","if (!current?.guardianUid)",'MC19',["expect((await member('early').get()).data().status).toBe('approved')"]),
  m('C17',pipeline,"pending.sort((a, b) => (ms(a) - ms(b)) || a.id.localeCompare(b.id, 'en'));","pending.sort((a, b) => (ms(b) - ms(a)) || b.id.localeCompare(a.id, 'en'));",'MC19',["expect(pending.map(d=>d.id)).toEqual(['early'])"]),
  m('C18',pipeline,"  return db().runTransaction(async tx => {\n  const memberRef = evRef(eventId).collection('teams').doc(teamId).collection('members').doc(memberId);\n  const snap = await tx.get(memberRef);","  const memberRef = evRef(eventId).collection('teams').doc(teamId).collection('members').doc(memberId);\n  const snap = await memberRef.get();\n  return db().runTransaction(async tx => {",'MC21',["expect((await roster('member').get()).exists).toBe(false)"]),
  m('C19',pipeline,"  return db().runTransaction(async tx => {\n  const query = evRef(eventId).collection('teams').doc(teamId)\n    .collection('members').where('status', '==', 'approved');\n  const snap = await tx.get(query);","  const query = evRef(eventId).collection('teams').doc(teamId)\n    .collection('members').where('status', '==', 'approved');\n  const snap = await query.get();\n  return db().runTransaction(async tx => {",'MC21',["expect((await team('t1').get()).data().memberCount).toBe(0)"]),
  {...m('C20','storage.rules',"&& staffData().get('active', false) == true","&& true",'ST1',["await assertFails(read(s,raw))","await assertFails(upload(s,p))"],8),spec:'tests/storage-rules/storage.test.js'},
  {...m('C21','storage.rules',"&& staffData().get('roles', []).hasAny(['booth', 'checkin', 'referee', 'scorer', 'admin', 'super_admin'])","&& true",'ST1',["await assertFails(read(s,raw))","await assertFails(upload(s,p))"],8),spec:'tests/storage-rules/storage.test.js'},
  m('C22',pipeline,"const pending = snap.docs.filter(d => d.data().status === 'pending');","const pending = snap.docs;",'MC25',["expect((await member('new').get()).data().status).toBe('pending')"]),
  m('C23',pipeline,'if (manualChange?.expectedVersion != null && prev.version !== manualChange.expectedVersion)','if (false)','MC22',["expect(out.filter(r=>r.status==='fulfilled')).toHaveLength(1)"]),
  m('C24','functions/management.js','if((div.scheduleRevision??0)!==expected)','if(false)','MC23',["await expect(manageEventFor({...req,data:{...req.data,operationId:'stale-move'}})).rejects.toMatchObject({code:'aborted'})"]),
  m('C25',pipeline,'sourceHash: conflictSourceHash }, actor);','sourceHash: ctx.sourceHash }, actor);','MC9',["expect((await audit('advancement.conflict')).size).toBe(1)"]),
  m('C26',pipeline,'if (!complete) return { published: false, missing, ranking };','if (false) return { published: false, missing, ranking };','MC12',["expect((await publishFinalRankingFor({eventId:E,divisionId:D,actorUid:'admin'})).published).toBe(false)"]),
  m('C27',pipeline,'if (!gate.ready && (!force || division.manualHold === true))','if (!gate.ready && !force)','MC27',["expect(held.ready).toBe(false)"]),
  m('C28',schedule,'if (Buffer.byteLength(JSON.stringify(audit)) > 900 * 1024)','if (false)','MC28',["await expect(generateScheduleFor(generation())).rejects.toMatchObject({code:'resource-exhausted'})"]),
  m('C29',pipeline,'if (!team) {','if (false) {','MC29',["expect((await roster('member').get()).exists).toBe(false)"]),
  m('C30','functions/management.js',"if(action.startsWith('appeal.'))after.match={...m,...resultPatch};","if(action.startsWith('appeal.'))void 0;",'MC16',["expect((await audit('appeal.decided')).docs[0].data().after.match).toMatchObject({managementRevision:2,updatedBy:'admin'})"]),
  m('C31','functions/management.js','managementRevision:m.managementRevision??0,','', 'MC30',["await expect(manageEventFor(stale)).rejects.toMatchObject({code:'aborted'})"]),
  m('C32',schedule,"|| (m.period != null && m.period !== 'pre')",'|| false','MC31',["await expect(generateScheduleFor(generation())).rejects.toMatchObject({code:'failed-precondition'})"]),
  m('C33',pipeline,'if (manualChange && (division.scheduleRevision ?? 0) !== (manualChange.expectedScheduleRevision ?? 0))','if (false)','MC32',["await expect(setManualRankingFor(args)).rejects.toMatchObject({code:'aborted'})"])
];
MUTANTS.find(m=>m.id==='C25').anchorCount=2;MUTANTS.find(m=>m.id==='C25').occurrence=1;
for(const mutant of MUTANTS.filter(m=>m.id==='C20'||m.id==='C21')){mutant.grep='^ST[12] ';mutant.minTests=14;}
module.exports={MUTANTS};
if(require.main===module){
  const args=process.argv.slice(2);if(args[0]==='--list'){console.log(MUTANTS.map(m=>m.id).join('\n'));process.exit(0);}
  if(args.length&&!(args.length===2&&args[0]==='--only'))throw Error('Use --list or --only ID1,ID2');
  runJestMutants({mutants:MUTANTS,ids:args[1]}).then(code=>{process.exitCode=code;},e=>{console.error(e);process.exitCode=1;});
}
