/** 未開打的賽程重產：單一原子交易，無分批刪除／寫入。 */
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db, evRef, adminActor, writeAudit } from './store.js';
import { drawOrder, genericFormat } from './engine/schedule.js';
import { planGeneration, matchDocOf } from './engine/schedule-doc.js';
import { buildStanding, standingIdOf } from './engine/standing.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const idOK = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const canonical = v => JSON.stringify(v, (_, value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value);
const sha = v => createHash('sha256').update(canonical(v)).digest('hex');
export function scheduleHasStarted(m) {
  return ['live', 'halftime', 'finished', 'confirmed', 'walkover'].includes(m.status)
    || !!m.result?.winner || (m.revisionCount ?? 0) > 0 || m.lock?.locked === true
    || (m.period != null && m.period !== 'pre')
    || Number(m.score?.home) > 0 || Number(m.score?.away) > 0;
}

export async function generateScheduleFor(request) {
  const uid = request.auth?.uid;
  if (!uid) fail('unauthenticated', '請先登入');
  const { eventId, divisionId, operationId, expectedRevision, orderedTeamIds, formatId, generated = false, groupCount = null, drawSeed = null } = request.data ?? {};
  if (![eventId, divisionId, operationId].every(idOK) || !idOK(formatId)
      || !Number.isInteger(expectedRevision) || expectedRevision < 0
      || !Array.isArray(orderedTeamIds) || orderedTeamIds.length < 2 || orderedTeamIds.length > 64
      || orderedTeamIds.some(id => !idOK(id)) || new Set(orderedTeamIds).size !== orderedTeamIds.length
      || (drawSeed !== null && (!Number.isInteger(drawSeed) || drawSeed < 0 || drawSeed >= 2147483647))) fail('invalid-argument', '請重新載入有效的分組草稿');
  const base = evRef(eventId), divRef = base.collection('divisions').doc(divisionId);
  const opRef = base.collection('scheduleOperations').doc(operationId);
  const requestHash = sha(request.data);
  const generationId = sha({ divisionId, operationId }).slice(0, 20);
  return db().runTransaction(async tx => {
    const actor = await adminActor(tx, uid);
    const receipt = await tx.get(opRef);
    if (receipt.exists) {
      if (receipt.data().requestHash !== requestHash || receipt.data().actorUid !== uid) fail('already-exists', '操作代碼已被不同請求使用');
      return receipt.data().result;
    }
    const [eventSnap, divSnap, formatsSnap, rulesSnap, teamSnap, matchesSnap, stagesSnap, standingsSnap, checkinsSnap, sheetsSnap] = await Promise.all([
      tx.get(base), tx.get(divRef), tx.get(db().doc('config/formats')), tx.get(db().doc('config/rankingRules')),
      tx.get(base.collection('teams').where('divisionId', '==', divisionId)),
      tx.get(base.collection('matches').where('divisionId', '==', divisionId)), tx.get(divRef.collection('stages')),
      tx.get(base.collection('standings').where('divisionId', '==', divisionId)),
      tx.get(base.collection('checkins')), tx.get(base.collection('matchSheets'))
    ]);
    if (!eventSnap.exists || !divSnap.exists) fail('not-found', '賽事或組別不存在');
    const division = { ...divSnap.data(), divisionId };
    if ((division.scheduleRevision ?? 0) !== expectedRevision) fail('aborted', '賽程已被更新，請重新載入後確認');
    const old = matchesSnap.docs.map(d => ({ ...d.data(), matchId: d.id }));
    if (old.some(scheduleHasStarted)) fail('failed-precondition', '已有場次開打、結果、比分或鎖定，不能重新產生賽程');
    const approved = teamSnap.docs.map(d => ({ ...d.data(), teamId: d.id }))
      .filter(t => t.status === 'approved' && t.withdrawn !== true).sort((a,b) => a.teamId.localeCompare(b.teamId, 'en'));
    if (JSON.stringify(approved.map(t => t.teamId).sort()) !== JSON.stringify([...orderedTeamIds].sort())) fail('aborted', '核准或退賽名單已更新，請重新抽籤');
    if (drawSeed !== null && JSON.stringify(drawOrder(approved, drawSeed).map(t => t.teamId)) !== JSON.stringify(orderedTeamIds)) fail('invalid-argument', '抽籤順序與種子不一致');
    const teams = Object.fromEntries(approved.map(t => [t.teamId, t]));
    const format = generated === true ? genericFormat(approved.length, { groupCount: groupCount ?? undefined }) : formatsSnap.data()?.formats?.[formatId];
    if (!format || format.formatId !== formatId) fail('failed-precondition', '找不到目前賽制範本');
    const rule = rulesSnap.data()?.rules?.[division.rankingRuleId];
    if (!rule) fail('failed-precondition', '找不到排名規則，不能產生賽程');
    const plan = planGeneration({ division, orderedTeams: orderedTeamIds.map(id => teams[id]), format });
    const oldIds = new Set(matchesSnap.docs.map(d => d.id));
    const [groupsSnap, timelines] = await Promise.all([
      tx.get(db().collectionGroup('groups')),
      Promise.all(matchesSnap.docs.map(d => tx.get(d.ref.collection('timeline'))))
    ]);
    // collectionGroup 也能找到父 stage 已不存在的孤立 groups，僅刪除本組別的文件。
    const oldGroups = groupsSnap.docs.filter(d => d.ref.path.startsWith(`${divRef.path}/stages/`));
    const deletes = [...matchesSnap.docs, ...stagesSnap.docs, ...oldGroups, ...standingsSnap.docs,
      ...timelines.flatMap(s => s.docs), ...checkinsSnap.docs.filter(d => oldIds.has(d.data().matchId)),
      ...sheetsSnap.docs.filter(d => oldIds.has(d.data().matchId))];
    const stamp = FieldValue.serverTimestamp();
    const writes = [];
    const put = (ref, doc, update = false) => writes.push({ ref, doc, update });
    if (generated === true) put(db().doc('config/formats'), { [`formats.${formatId}`]: format }, true);
    for (const st of plan.stages) put(divRef.collection('stages').doc(st.stageId), { ...st, generationId });
    for (const g of plan.groupDocs) {
      put(divRef.collection('stages').doc(g.stageId).collection('groups').doc(g.groupId), { ...g, generationId });
      const id = standingIdOf(divisionId, g.stageId, g.groupId);
      put(base.collection('standings').doc(id), { ...buildStanding({ eventId, divisionId, stageId: g.stageId,
        groupId: g.groupId, teamIds: g.teamIds, matches: [], rule, opts: { teamMeta: Object.fromEntries(g.teamIds.map(id => [id, { name: teams[id].shortName ?? teams[id].name ?? null }])) } }), generationId, computedAt: stamp });
    }
    for (const a of plan.assignments) put(base.collection('teams').doc(a.teamId), { groupId: a.groupId, seed: a.seed, updatedAt: stamp, updatedBy: uid }, true);
    for (const t of teamSnap.docs.filter(d => !teams[d.id])) put(t.ref, { groupId: null, seed: null, updatedAt: stamp, updatedBy: uid }, true);
    const matchIds = [];
    for (const m of plan.matches) {
      // 新世代永遠不用舊 ID，未知子集合／歷史外部參照也不會黏到新比賽。
      const matchId = `${m.matchId}__g-${generationId}`; matchIds.push(matchId);
      put(base.collection('matches').doc(matchId), { ...matchDocOf({ m: { ...m, matchId }, division, eventId }), generationId, createdAt: stamp, updatedAt: stamp, updatedBy: uid });
    }
    const revision = expectedRevision + 1;
    put(divRef, { formatId, scheduleRevision: revision, scheduleGenerationId: generationId, schedulePublished: false,
      finalRankingPublished: false, finalRankingStale: division.finalRanking != null,
      draw: { seed: drawSeed, at: stamp, method: drawSeed === null ? 'manual' : 'random' }, updatedAt: stamp, updatedBy: uid }, true);
    const result = { operationId, generationId, revision, matches: matchIds.length, matchIds };
    put(opRef, { requestHash, actorUid: uid, result, createdAt: stamp });
    const audit = { entity: 'division', entityId: divisionId, action: 'schedule.generate', actor,
      before: { matches: oldIds.size, generationId: division.scheduleGenerationId ?? null, revision: expectedRevision, matchIds: [...oldIds],
        division: divSnap.data(), assignments: teamSnap.docs.map(d => ({ teamId: d.id, groupId: d.data().groupId ?? null, seed: d.data().seed ?? null })),
        deletedDocuments: deletes.map(d => ({ path: d.ref.path, doc: d.data() })) },
      after: { ...result, formatId, drawSeed, orderedTeamIds, deletedChildren: deletes.length - oldIds.size,
        // serverTimestamp 可以放在 map 中，但不能出現在陣列內。
        writtenDocuments: Object.fromEntries(writes.map(w => [w.ref.path, { path: w.ref.path, doc: w.doc, update: w.update }])) },
      reason: drawSeed === null ? '手動指定分組' : `抽籤（種子 ${drawSeed}）` };
    // 保守拒絕超出單交易容量的請求，絕不改成分批提交。
    const bytes = 2 * Buffer.byteLength(JSON.stringify({ writes: writes.map(w => ({ path: w.ref.path, doc: w.doc })),
      deletes: deletes.map(d => ({ path: d.ref.path, doc: d.data() })), audit })) + (writes.length + deletes.length + 1) * 2048;
    if (writes.length + deletes.length + 1 > 400 || bytes > 8 * 1024 * 1024) fail('resource-exhausted', '賽程或歷史子紀錄超過原子重產容量，請由維運規劃世代封存');
    if (Buffer.byteLength(JSON.stringify(audit)) > 900 * 1024) fail('resource-exhausted', '完整賽程稽核超過單筆文件容量，請由維運規劃世代封存');
    for (const d of deletes) tx.delete(d.ref);
    for (const w of writes) w.update ? tx.update(w.ref, w.doc) : tx.set(w.ref, w.doc);
    writeAudit(eventId, audit, tx);
    return result;
  });
}
