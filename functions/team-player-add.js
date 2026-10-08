import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin.js';
import { TeamImportError } from './team-import.js';
import { validateTeamPlayers } from './engine/team-player-add.js';
import { rosterProjection } from './engine/privacy.js';
import { isPlayer } from './engine/review.js';
import { REGISTRATION_LIMITS } from './engine/formats.js';

const fail = (code, message) => { throw new TeamImportError(code, message); };
const validId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const canonical = v => JSON.stringify(v, (_, value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);

/** 多人新增、公開投影、人數與稽核原子提交；相同請求重送不重複建人。 */
export async function addTeamPlayersFor(request) {
  const uid = request.auth?.uid;
  if (!uid) fail('unauthenticated', '請先登入。');
  const { eventId, teamId, operationId, players } = request.data ?? {};
  if (![eventId, teamId, operationId].every(validId)) fail('invalid-argument', '賽事、球隊或操作代碼不正確。');
  const base = db().doc(`events/${eventId}`), teamRef = base.collection('teams').doc(teamId);
  const receiptRef = base.collection('managementOperations').doc(operationId);
  const requestHash = createHash('sha256').update(canonical({ action: 'team.players.add', ...request.data })).digest('hex');
  return db().runTransaction(async tx => {
    const [staffSnap, event, teamSnap] = await Promise.all([tx.get(db().doc(`staff/${uid}`)), tx.get(base), tx.get(teamRef)]);
    const staff = staffSnap.data(), team = teamSnap.data();
    const admin = staff?.active === true && Array.isArray(staff.roles) && staff.roles.some(r => ['admin', 'super_admin'].includes(r));
    if (!admin && (!team || team.captainUid !== uid)) fail('permission-denied', '只有管理員、大總管或該隊隊長能新增球員。');
    if (!admin && team.managementLocked === true) fail('permission-denied', '球隊已上鎖，請聯絡管理員或大總管解鎖。');
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.get('actorUid') !== uid || receipt.get('requestHash') !== requestHash) fail('already-exists', '操作代碼已被使用。');
      return receipt.get('result');
    }
    if (!event.exists || !teamSnap.exists) fail('not-found', '找不到賽事或球隊。');
    if (!validId(team.divisionId)) fail('failed-precondition', '球隊缺少有效組別。');
    const [division, members] = await Promise.all([tx.get(base.collection('divisions').doc(team.divisionId)), tx.get(teamRef.collection('members'))]);
    const existingMembers = members.docs.map(d => d.data());
    const plan = validateTeamPlayers(players, { division: division.data(), asOf: event.get('dates')?.[0], existingMembers });
    if (plan.errors.length) fail('invalid-argument', plan.errors.slice(0, 10).join('\n'));
    const approved = existingMembers.filter(m => m.status === 'approved');
    const playerCount = approved.filter(isPlayer).length + plan.players.length;
    // 與現有 roster cap trigger 相同：已鎖定且沒有帳號隊長的行政匯入名冊不套用線上報名人數限制。
    const imported = team.source === 'csv' && team.captainUid === null && team.rosterLocked === true;
    if (!imported && playerCount > REGISTRATION_LIMITS.maxPlayers) fail('failed-precondition', `球員最多 ${REGISTRATION_LIMITS.maxPlayers} 人，請先確認現有名單。`);
    const stamp = FieldValue.serverTimestamp();
    const prepared = plan.players.map((p, i) => ({ ...p,
      memberId: 'mg-' + createHash('sha256').update(`${eventId}|${teamId}|${operationId}|${i}`).digest('hex').slice(0, 28),
      eventId, teamId, divisionId: team.divisionId, source: 'csv', createdVia: 'team-management',
      guardianUid: null, isSelf: false, identityRevision: 0, addedBy: uid, appliedAt: stamp, approvedAt: stamp, updatedBy: uid, updatedAt: stamp }));
    for (const member of prepared) {
      tx.create(teamRef.collection('members').doc(member.memberId), member);
      tx.create(teamRef.collection('roster').doc(member.memberId), rosterProjection(member, { teamId, divisionId: team.divisionId, asOf: event.get('dates')[0] }));
    }
    const memberCount = approved.length + prepared.length, rosterRevision = (team.rosterRevision ?? 0) + 1;
    tx.update(teamRef, { memberCount, playerCount, rosterRevision, updatedBy: uid, updatedAt: stamp });
    const audit = base.collection('audits').doc();
    tx.create(audit, { auditId: audit.id, eventId, action: 'team.players.add', entity: 'team', entityId: teamId,
      before: { memberCount: approved.length, playerCount: approved.filter(isPlayer).length },
      after: { memberCount, playerCount, members: prepared.map(({ appliedAt, approvedAt, updatedAt, ...m }) => m) },
      actor: { uid, name: staff?.name ?? team.captainName ?? null }, reason: '管理球隊新增球員', createdAt: stamp });
    const result = { teamId, operationId, auditId: audit.id, addedCount: prepared.length,
      memberIds: prepared.map(m => m.memberId), memberCount, playerCount, rosterRevision };
    tx.create(receiptRef, { actorUid: uid, requestHash, result, createdAt: stamp });
    return result;
  });
}
