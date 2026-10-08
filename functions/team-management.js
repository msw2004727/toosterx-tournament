import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin.js';
import { TeamImportError } from './team-import.js';

const fail = (code, message) => { throw new TeamImportError(code, message); };
const validId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const permitted = (staff, roles) => staff?.active === true && Array.isArray(staff.roles) && roles.some(r => staff.roles.includes(r));
function actor(request) {
  if (!request.auth?.uid) fail('unauthenticated', '請先登入。');
  if (!validId(request.data?.eventId)) fail('invalid-argument', '賽事代碼不正確。');
  return request.auth.uid;
}

/** 指派與撤銷隊長不更動全站身分；確認過的舊隊長須仍相同。 */
export async function assignTeamCaptainFor(request) {
  const uid = actor(request);
  const { eventId, teamId, divisionId, captainUid, previousCaptainUid } = request.data;
  const validUid = v => typeof v === 'string' && v.length > 0 && v.length <= 128 && !v.includes('/');
  if (!validId(teamId) || !validId(divisionId) || (captainUid !== null && !validUid(captainUid))
    || (previousCaptainUid !== null && !validUid(previousCaptainUid))) fail('invalid-argument', '請選擇組別與球隊，並重新載入目前的隊長指派。');
  const eventRef = db().doc(`events/${eventId}`), teamRef = eventRef.collection('teams').doc(teamId);
  const auditRef = eventRef.collection('audits').doc();
  return db().runTransaction(async tx => {
    const [staff, event, team, target] = await Promise.all([
      tx.get(db().doc(`staff/${uid}`)), tx.get(eventRef), tx.get(teamRef),
      captainUid === null ? null : tx.get(db().doc(`users/${captainUid}`))
    ]);
    if (!permitted(staff.data(), ['super_admin'])) fail('permission-denied', '只有大總管能指派或撤銷隊長。');
    if (!event.exists || !team.exists || (captainUid !== null && !target.exists)) fail('not-found', '找不到賽事、球隊或使用者，請先請該用戶登入一次。');
    const before = team.data();
    if (before.divisionId !== divisionId) fail('failed-precondition', '球隊的組別已變更，請重新選擇。');
    if ((before.captainUid ?? null) !== previousCaptainUid) fail('aborted', '隊長已被其他人重新指派，請重新載入後確認。');
    const captainName = captainUid === null ? null : (target.data().displayName || captainUid);
    const stamp = FieldValue.serverTimestamp();
    tx.update(teamRef, { captainUid, captainName, updatedBy: uid, updatedAt: stamp });
    tx.create(auditRef, { auditId: auditRef.id, eventId, action: 'team.captain.assign', entity: 'team', entityId: teamId,
      before: { captainUid: before.captainUid ?? null, captainName: before.captainName ?? null },
      after: { captainUid, captainName }, reason: captainUid === null ? '撤銷隊長指派' : '身分授權指派隊長',
      actor: { uid, name: staff.data().name ?? null }, createdAt: stamp });
    return { teamId, captainUid, captainName, auditId: auditRef.id };
  });
}

/** 單隊或全隊上鎖／解鎖，一次交易完成並留痕；只改管理鎖。 */
export async function setTeamManagementLockFor(request) {
  const uid = actor(request);
  const { eventId, teamId, all, locked } = request.data;
  if (typeof locked !== 'boolean' || (all === true ? teamId != null : !validId(teamId))) fail('invalid-argument', '請指定一支球隊或全部球隊，以及上鎖／解鎖狀態。');
  const eventRef = db().doc(`events/${eventId}`), teamsRef = eventRef.collection('teams'), auditRef = eventRef.collection('audits').doc();
  return db().runTransaction(async tx => {
    const [staff, event, targets] = await Promise.all([tx.get(db().doc(`staff/${uid}`)), tx.get(eventRef),
      tx.get(all === true ? teamsRef : teamsRef.doc(teamId))]);
    if (!permitted(staff.data(), ['admin', 'super_admin'])) fail('permission-denied', '只有管理員與大總管能上鎖或解鎖球隊。');
    if (!event.exists || (all !== true && !targets.exists)) fail('not-found', '找不到賽事或球隊。');
    const rows = all === true ? targets.docs : [targets];
    const changed = rows.filter(d => (d.data().managementLocked === true) !== locked);
    if (changed.length > 450) fail('failed-precondition', '本次需變更的球隊過多，請分隊處理。');
    if (!changed.length) return { teamCount: 0, locked, auditId: null };
    const stamp = FieldValue.serverTimestamp();
    for (const team of changed) tx.update(team.ref, { managementLocked: locked, updatedBy: uid, updatedAt: stamp });
    tx.create(auditRef, { auditId: auditRef.id, eventId, action: locked ? 'team.management.lock' : 'team.management.unlock',
      entity: 'team', entityId: all === true ? 'all' : teamId,
      before: { teams: changed.map(d => ({ teamId: d.id, managementLocked: d.data().managementLocked === true })) },
      after: { teamIds: changed.map(d => d.id), managementLocked: locked }, reason: all === true ? '一鍵調整全部球隊管理鎖' : '調整球隊管理鎖',
      actor: { uid, name: staff.data().name ?? null }, createdAt: stamp });
    return { teamCount: changed.length, locked, auditId: auditRef.id };
  });
}
