/** Atomic clock correction with authority, optimistic concurrency and receipts. */
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db, evRef, writeAudit } from './store.js';
import { clockEditBasis, buildClockCorrection } from './engine/match-clock.js';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const idOK = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const canonical = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k,x[k]])) : x);
export async function editMatchClockFor(request) {
  const uid = request.auth?.uid;
  if (!uid) fail('unauthenticated','請先登入');
  const { eventId, matchId, operationId, context, expected, seconds, reason } = request.data ?? {};
  if (![eventId,matchId,operationId].every(idOK) || !['live','admin'].includes(context)) fail('invalid-argument','時間修改請求不正確');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) fail('invalid-argument','請填寫修改原因（最多 500 字）');
  const base = evRef(eventId), ref = base.collection('matches').doc(matchId), receiptRef = base.collection('managementOperations').doc(operationId);
  const hash = createHash('sha256').update(canonical(request.data)).digest('hex');
  return db().runTransaction(async tx => {
    const staff = (await tx.get(db().doc(`staff/${uid}`))).data();
    const admin = staff?.roles?.some(r => ['admin','super_admin'].includes(r));
    if (staff?.active !== true || (!admin && !staff?.roles?.includes('scorer')) || (context === 'admin' && !admin)) fail('permission-denied','沒有修改比賽時間的權限');
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data().actorUid !== uid || receipt.data().requestHash !== hash) fail('already-exists','操作代碼已被使用');
      return receipt.data().result;
    }
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not-found','找不到場次');
    const match = snap.data();
    if (context === 'live' && (!['live','halftime'].includes(match.status) || match.lock?.locked !== false)) fail('failed-precondition','比賽已結束或鎖定，請到場次改判頁修改');
    const venues = staff.assignment?.venueIds ?? [];
    if (!admin && (!Array.isArray(venues) || (venues.length && !venues.includes(match.venueId)))) fail('permission-denied','此場次不在你的指派場地');
    if (canonical(expected) !== canonical(clockEditBasis(match))) fail('aborted','比賽時鐘已更新，請關閉後重新開啟修改');
    const d = await tx.get(base.collection('divisions').doc(match.divisionId));
    if (!d.exists) fail('failed-precondition','讀不到組別設定');
    const clock = buildClockCorrection({ match, division: d.data(), seconds, nowMs: Date.now() });
    const revision = (match.managementRevision ?? 0) + 1, auditId = `clock-${operationId}`;
    tx.update(ref, { clock, managementRevision: revision, updatedBy: uid, updatedAt: FieldValue.serverTimestamp() });
    writeAudit(eventId, { entity:'match', entityId:matchId, action:'match.clock.edit', actor:{ uid, name:staff.name ?? null, source:'function' },
      before:{ clock:match.clock ?? null }, after:{ clock }, reason:reason.trim() }, tx, base.collection('audits').doc(auditId));
    const result = { operationId, matchId, auditId, seconds, addedTimeSec:clock.addedTimeSec, managementRevision:revision };
    tx.create(receiptRef, { actorUid:uid, requestHash:hash, result, createdAt:FieldValue.serverTimestamp() });
    return result;
  });
}
