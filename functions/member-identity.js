import { FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { db } from './admin.js';
import { TeamImportError } from './team-import.js';
import { validateIdentity, validateJerseyNo, validateMemberName } from './engine/member-identity.js';
import { rosterProjection } from './engine/privacy.js';

const fail = (code, message) => { throw new TeamImportError(code, message); };
const authorized = s => s?.active === true && Array.isArray(s.roles) && s.roles.some(r => ['admin', 'super_admin'].includes(r));

/** 隊員更名、CSV 補件：公開名冊、版本、稽核與檢錄失效同一交易。 */
export async function updateMemberIdentityFor(request) {
  const uid = request.auth?.uid;
  if (!uid) fail('unauthenticated', '請先登入。');
  const { eventId, teamId, memberId, birthDate, idLast4, reason, revision } = request.data ?? {};
  const nameOnly = request.data?.nameOnly === true;
  const hasName = Object.hasOwn(request.data ?? {}, 'name');
  const name = hasName ? validateMemberName(request.data.name) : null;
  if (![eventId, teamId, memberId].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v))) fail('invalid-argument', '賽事、球隊或球員代碼不正確。');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 200 || !Number.isInteger(revision) || revision < 0) fail('invalid-argument', '請填修改原因（最多 200 字），並重新載入最新名冊。');
  if (hasName && name.error) fail('invalid-argument', name.error);
  if (hasName && typeof request.data.expectedName !== 'string') fail('invalid-argument', '請重新載入最新隊員姓名。');
  if (nameOnly && (!hasName || ['birthDate', 'idLast4', 'jerseyNo'].some(key => Object.hasOwn(request.data, key)))) fail('invalid-argument', '更名只允許修改姓名／暱稱。');
  if (!nameOnly && (typeof birthDate !== 'string' || typeof idLast4 !== 'string')) fail('invalid-argument', '生日與身分證後四碼必須是文字。');
  const identityFields = nameOnly ? {} : { birthDate: birthDate.trim(), idLast4: idLast4.trim() };
  const { operationId } = request.data;
  if ((hasName || operationId != null) && (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(operationId))) fail('invalid-argument', '操作代碼不正確，請重新載入表單。');
  const requestHash = operationId ? createHash('sha256').update(JSON.stringify(request.data, Object.keys(request.data).sort())).digest('hex') : null;
  // 舊前端未帶背號時保留原值，避免部署交替期間意外清空。
  const hasJersey = Object.hasOwn(request.data, 'jerseyNo');
  const jersey = validateJerseyNo(request.data.jerseyNo);
  if (hasJersey && jersey.error) fail('invalid-argument', jersey.error);
  const staffRef = db().doc(`staff/${uid}`);
  const eventRef = db().doc(`events/${eventId}`);
  const teamRef = eventRef.collection('teams').doc(teamId);
  const memberRef = teamRef.collection('members').doc(memberId);
  const auditRef = eventRef.collection('audits').doc();
  const receiptRef = operationId ? eventRef.collection('managementOperations').doc(operationId) : null;
  return db().runTransaction(async tx => {
    const [staffSnap, teamSnap] = await Promise.all([tx.get(staffRef), tx.get(teamRef)]);
    const team = teamSnap.data();
    const admin = authorized(staffSnap.data());
    if (!admin && (!team || team.captainUid !== uid)) fail('permission-denied', '只有管理員、大總管或該隊隊長能修改名冊。');
    if (!admin && team.managementLocked === true) fail('permission-denied', '球隊已上鎖，請聯絡管理員或大總管解鎖。');
    if (receiptRef) {
      const receipt = await tx.get(receiptRef);
      if (receipt.exists) {
        if (receipt.data().actorUid !== uid || receipt.data().requestHash !== requestHash) fail('already-exists', '操作代碼已被使用。');
        return receipt.data().result;
      }
    }
    const [eventSnap, memberSnap, checkinsSnap, membersSnap] = await Promise.all([
      tx.get(eventRef), tx.get(memberRef),
      tx.get(eventRef.collection('checkins').where('teamId', '==', teamId)), tx.get(teamRef.collection('members'))
    ]);
    const member = memberSnap.data();
    if (!eventSnap.exists || !team || !member) fail('not-found', '找不到球隊或球員。');
    if (!nameOnly && (member.source !== 'csv' || member.status !== 'approved')) fail('failed-precondition', '此入口只補件已通過的 CSV 球員名冊；其他隊員可修改姓名／暱稱。');
    if ((member.identityRevision ?? 0) !== revision) fail('aborted', '資料已被其他人修改，請關閉表單並重新載入球隊名單。');
    if (hasName && (member.name ?? '') !== request.data.expectedName) fail('aborted', '隊員姓名已被其他人修改，請關閉表單並重新載入名單。');
    const fields = { ...identityFields, ...(!nameOnly ? { jerseyNo: hasJersey ? jersey.value : (member.jerseyNo ?? null) } : {}), ...(hasName ? { name: name.value } : {}) };
    if (fields.jerseyNo != null && membersSnap.docs.some(d => d.id !== memberId
      && ['approved', 'pending'].includes(d.data().status) && d.data().jerseyNo === fields.jerseyNo)) {
      fail('already-exists', `同隊已有球員使用 ${fields.jerseyNo} 號，請更換背號或留空。`);
    }
    const divSnap = await tx.get(eventRef.collection('divisions').doc(team.divisionId));
    const asOf = eventSnap.data().dates?.[0];
    const identity = nameOnly ? { errors: [], complete: member.identityComplete } : validateIdentity(fields, divSnap.data(), asOf);
    if (identity.errors.length) fail('invalid-argument', identity.errors.join('\n'));
    const previous = { birthDate: member.birthDate ?? '', idLast4: member.idLast4 ?? '', jerseyNo: member.jerseyNo ?? null,
      ...(hasName ? { name: member.name ?? '', ...(Object.hasOwn(member, 'displayName') ? { displayName: member.displayName } : {}) } : {}) };
    if (Object.keys(fields).every(key => previous[key] === fields[key])) fail('invalid-argument', '資料沒有變更。');
    const jerseyChanged = !nameOnly && previous.jerseyNo !== fields.jerseyNo;
    const nameChanged = hasName && previous.name !== fields.name;
    const sheets = jerseyChanged || nameChanged ? (await tx.get(eventRef.collection('matchSheets').where('teamId', '==', teamId))).docs
      .filter(d => d.data().players?.some(p => p.memberId === memberId)) : [];
    const records = checkinsSnap.docs.filter(d => d.data().memberId === memberId && d.data().result != null);
    const matchIds = [...new Set([...records, ...sheets].map(d => d.data().matchId))];
    const matches = await Promise.all(matchIds.map(id => tx.get(eventRef.collection('matches').doc(id))));
    const boardRef = eventRef.collection('boards').doc('scorers');
    const board = nameChanged ? await tx.get(boardRef) : null;
    if (records.length + sheets.length + matches.length > 390) fail('resource-exhausted', '相關名冊資料超過一次修改的容量，請聯絡主辦協助。');
    const stamp = FieldValue.serverTimestamp();
    const patch = { ...fields, ...(!nameOnly ? { identityComplete: identity.complete } : {}),
      ...(nameChanged && Object.hasOwn(member, 'displayName') ? { displayName: fields.name } : {}), identityRevision: revision + 1, updatedBy: uid, updatedAt: stamp };
    const projection = member.status === 'approved' ? rosterProjection({ ...member, ...patch, memberId }, { teamId, divisionId: team.divisionId, asOf }) : null;
    tx.update(memberRef, patch);
    // 同隊修改共用一份鎖，兩人同時搶同一背號只能成功一位。
    tx.update(teamRef, { rosterRevision: (team.rosterRevision ?? 0) + 1, updatedBy: uid, updatedAt: stamp });
    if (projection) tx.set(teamRef.collection('roster').doc(memberId), projection);
    else tx.delete(teamRef.collection('roster').doc(memberId));
    if (board?.exists && Array.isArray(board.data().rows) && board.data().rows.some(r => r.teamId === teamId && r.playerId === memberId)) {
      tx.update(boardRef, { rows: board.data().rows.map(r => r.teamId === teamId && r.playerId === memberId
        ? { ...r, name: projection?.displayName ?? null } : r), updatedAt: stamp });
    }
    for (const rec of records) tx.update(rec.ref, { result: null, failReason: 'IDENTITY_CHANGED', note: '球員資料已修改，請重新核對背號與證件。', scannedBy: uid, scannedAt: stamp });
    const updatedSheets = [];
    for (const matchSnap of matches) {
      const match = matchSnap.data();
      if (!match || !['scheduled', 'checkin', 'ready', 'postponed'].includes(match.status)) continue;
      const side = match.home?.teamId === teamId ? 'home' : match.away?.teamId === teamId ? 'away' : null;
      if (!side) continue;
      // 未開賽陣容同步顯示名與背號；已開賽歷史快照保留。
      for (const sheet of sheets.filter(d => d.data().matchId === matchSnap.id)) {
        tx.update(sheet.ref, { players: sheet.data().players.map(p => p.memberId === memberId ? { ...p,
          ...(nameChanged ? { displayName: projection?.displayName ?? null } : {}),
          ...(jerseyChanged ? { jerseyNo: fields.jerseyNo } : {}) } : p), updatedBy: uid, updatedAt: stamp });
        updatedSheets.push(sheet.id);
      }
      tx.update(matchSnap.ref, { [`checkin.${side}Confirmed`]: false, [`checkin.${side}Present`]: null, 'checkin.confirmedAt': null,
        ...(match.status === 'ready' ? { status: 'checkin' } : {}), updatedBy: uid, updatedAt: stamp });
    }
    tx.create(auditRef, { auditId: auditRef.id, eventId, action: 'member.identity.update', entity: 'member', entityId: `${teamId}/${memberId}`,
      before: { ...previous, checkins: records.map(d => ({ checkinId: d.id, result: d.data().result, scannedBy: d.data().scannedBy ?? null, scannedAt: d.data().scannedAt ?? null })) },
      after: { ...fields, ...(nameChanged && Object.hasOwn(member, 'displayName') ? { displayName: fields.name } : {}),
        ...(!nameOnly ? { identityComplete: identity.complete } : {}), invalidatedCheckins: records.map(d => d.id), updatedSheets },
      reason: reason.trim(), actor: { uid, name: staffSnap.data()?.name ?? (team.captainUid === uid ? team.captainName ?? null : null) }, createdAt: stamp });
    const result = { memberId, ...fields, ...(!nameOnly ? { identityComplete: identity.complete } : {}), identityRevision: revision + 1, auditId: auditRef.id, ...(operationId ? { operationId } : {}) };
    if (receiptRef) tx.create(receiptRef, { requestHash, actorUid: uid, result, createdAt: stamp });
    return result;
  });
}
