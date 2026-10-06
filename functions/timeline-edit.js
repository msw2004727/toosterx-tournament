/** Atomic event correction with current authority, stale-data guards and idempotent receipts. */
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db, evRef, writeAudit } from './store.js';
import { matchBasis } from './management.js';
import { timelineEditBasis, buildTimelineEdit, timelineEditMatchPatch } from './engine/timeline-edit.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const idOK = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export async function editTimelineEventFor(request) {
  const uid = request.auth?.uid;
  if (!uid) fail('unauthenticated', '請先登入');
  const { eventId, matchId, timelineId, operationId, context, expected, patch, reason } = request.data ?? {};
  if (![eventId, matchId, timelineId, operationId].every(idOK) || !['live', 'admin'].includes(context)) fail('invalid-argument', '事件修正請求不正確');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) fail('invalid-argument', '請填寫修改原因（最多 500 字）');
  const base = evRef(eventId), matchRef = base.collection('matches').doc(matchId);
  const eventRef = matchRef.collection('timeline').doc(timelineId), receiptRef = base.collection('managementOperations').doc(operationId);
  const requestHash = createHash('sha256').update(canonical(request.data)).digest('hex');
  return db().runTransaction(async tx => {
    const staff = (await tx.get(db().doc(`staff/${uid}`))).data();
    const admin = Array.isArray(staff?.roles) && staff.roles.some(r => ['admin', 'super_admin'].includes(r));
    if (staff?.active !== true || !Array.isArray(staff.roles) || (!admin && !staff.roles.includes('scorer')) || (context === 'admin' && !admin)) fail('permission-denied', '沒有修改比賽事件的權限');
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data().actorUid !== uid || receipt.data().requestHash !== requestHash) fail('already-exists', '操作代碼已被使用');
      return receipt.data().result;
    }
    const matchSnap = await tx.get(matchRef), eventSnap = await tx.get(eventRef);
    if (!matchSnap.exists || !eventSnap.exists) fail('not-found', '找不到場次或事件，請重新載入');
    const match = { ...matchSnap.data(), matchId }, before = { ...eventSnap.data(), timelineId };
    if (context === 'live' && (!['live', 'halftime'].includes(match.status) || match.lock?.locked !== false)) fail('failed-precondition', '比賽已結束或鎖定，請到場次改判頁修改');
    const venues = staff.assignment?.venueIds ?? [];
    if (!admin && (!Array.isArray(venues) || (venues.length && !venues.includes(match.venueId)))) fail('permission-denied', '此場次不在你的指派場地');
    if (canonical(expected?.match) !== canonical(matchBasis(match)) || canonical(expected?.event) !== canonical(timelineEditBasis(before))) fail('aborted', '場次或事件已更新，請關閉後重新開啟修改');
    if ((before.resetRevision ?? 0) !== (match.resetRevision ?? 0)) fail('aborted', '事件屬於歸零前的紀錄，請重新載入');
    const divisionSnap = await tx.get(base.collection('divisions').doc(match.divisionId));
    if (!divisionSnap.exists) fail('failed-precondition', '讀不到組別設定');
    const division = divisionSnap.data(), rosters = {};
    for (const side of ['home', 'away']) {
      const teamId = match[side]?.teamId;
      rosters[side] = teamId ? (await tx.get(base.collection('teams').doc(teamId).collection('roster'))).docs.map(d => ({ ...d.data(), memberId: d.id })) : [];
    }
    const timeline = await tx.get(matchRef.collection('timeline'));
    const events = timeline.docs.map(d => ({ ...d.data(), timelineId: d.id }));
    const after = buildTimelineEdit({ event: before, patch, match, division, rosters });
    const matchPatch = timelineEditMatchPatch({ match, events, before, after, division });
    const stamp = FieldValue.serverTimestamp();
    Object.assign(after, { editedBy: uid, editedAt: stamp, editReason: reason.trim(),
      ...(after.voided !== before.voided ? { voidedBy: after.voided ? uid : null, voidedAt: after.voided ? stamp : null, voidReason: after.voided ? reason.trim() : null } : {}) });
    Object.assign(matchPatch, { managementRevision: (match.managementRevision ?? 0) + 1,
      ...(context === 'admin' ? { revisionCount: (match.revisionCount ?? 0) + 1 } : {}), updatedBy: uid, updatedAt: stamp });
    const actor = { uid, name: staff.name ?? null, source: 'function' };
    const auditId = `timeline-${operationId}`;
    // Event, score/result, audit and receipt are committed together; a failed audit rolls back the correction.
    tx.set(eventRef, after);
    tx.update(matchRef, matchPatch);
    if (division.finalRankingPublished === true) {
      writeAudit(eventId, { entity: 'division', entityId: match.divisionId, action: 'finalRanking.invalidate', actor,
        before: { published: true, ranking: division.finalRanking ?? null }, after: { published: false }, reason: 'timeline.edit' }, tx);
      tx.update(divisionSnap.ref, {
      finalRankingPublished: false, finalRankingStale: true, finalRankingInvalidatedAt: stamp, finalRankingInvalidationReason: 'timeline.edit'
      });
    }
    writeAudit(eventId, { entity: 'match', entityId: matchId, action: 'timeline.edit', actor, reason: reason.trim(),
      before: { event: before, score: match.score ?? null, result: match.result ?? null },
      after: { event: after, score: matchPatch.score ?? null, result: matchPatch.result ?? match.result ?? null } }, tx, base.collection('audits').doc(auditId));
    const result = { operationId, matchId, timelineId, editRevision: after.editRevision, auditId, score: matchPatch.score, penaltyScore: matchPatch.penaltyScore ?? match.penaltyScore ?? null };
    tx.create(receiptRef, { requestHash, actorUid: uid, result, createdAt: stamp });
    return result;
  });
}
