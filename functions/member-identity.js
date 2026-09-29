import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin.js';
import { TeamImportError } from './team-import.js';
import { validateIdentity, validateJerseyNo } from './engine/member-identity.js';
import { rosterProjection } from './engine/privacy.js';

const fail = (code, message) => { throw new TeamImportError(code, message); };
const authorized = s => s?.active === true && Array.isArray(s.roles) && s.roles.some(r => ['admin', 'super_admin'].includes(r));

/** CSV 名冊身分補件／修正：資格、版本、稽核與檢錄失效同一交易。 */
export async function updateMemberIdentityFor(request) {
  const uid = request.auth?.uid;
  if (!uid) fail('unauthenticated', '請先登入。');
  const { eventId, teamId, memberId, birthDate, idLast4, reason, revision } = request.data ?? {};
  if (![eventId, teamId, memberId].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v))) fail('invalid-argument', '賽事、球隊或球員代碼不正確。');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 200 || !Number.isInteger(revision) || revision < 0) fail('invalid-argument', '請填修改原因（最多 200 字），並重新載入最新名冊。');
  if (typeof birthDate !== 'string' || typeof idLast4 !== 'string') fail('invalid-argument', '生日與身分證後四碼必須是文字。');
  const identityFields = { birthDate: birthDate.trim(), idLast4: idLast4.trim() };
  // 舊前端未帶背號時保留原值，避免部署交替期間意外清空。
  const hasJersey = Object.hasOwn(request.data, 'jerseyNo');
  const jersey = validateJerseyNo(request.data.jerseyNo);
  if (hasJersey && jersey.error) fail('invalid-argument', jersey.error);
  const staffRef = db().doc(`staff/${uid}`);
  if (!authorized((await staffRef.get()).data())) fail('permission-denied', '只有管理員或總管能修改名冊。');
  const eventRef = db().doc(`events/${eventId}`);
  const teamRef = eventRef.collection('teams').doc(teamId);
  const memberRef = teamRef.collection('members').doc(memberId);
  const auditRef = eventRef.collection('audits').doc();
  return db().runTransaction(async tx => {
    const [staffSnap, eventSnap, teamSnap, memberSnap, checkinsSnap, membersSnap] = await Promise.all([
      tx.get(staffRef), tx.get(eventRef), tx.get(teamRef), tx.get(memberRef),
      tx.get(eventRef.collection('checkins').where('teamId', '==', teamId)), tx.get(teamRef.collection('members'))
    ]);
    if (!authorized(staffSnap.data())) fail('permission-denied', '管理權限已變更。');
    const team = teamSnap.data(), member = memberSnap.data();
    if (!eventSnap.exists || !team || !member) fail('not-found', '找不到球隊或球員。');
    if (member.source !== 'csv' || member.status !== 'approved') fail('failed-precondition', '此入口只修改已通過的 CSV 球員名冊。');
    if ((member.identityRevision ?? 0) !== revision) fail('aborted', '資料已被其他管理員修改，請關閉表單並重新載入球隊名單。');
    const fields = { ...identityFields, jerseyNo: hasJersey ? jersey.value : (member.jerseyNo ?? null) };
    if (fields.jerseyNo != null && membersSnap.docs.some(d => d.id !== memberId
      && ['approved', 'pending'].includes(d.data().status) && d.data().jerseyNo === fields.jerseyNo)) {
      fail('already-exists', `同隊已有球員使用 ${fields.jerseyNo} 號，請更換背號或留空。`);
    }
    const divSnap = await tx.get(eventRef.collection('divisions').doc(team.divisionId));
    const asOf = eventSnap.data().dates?.[0];
    const identity = validateIdentity(fields, divSnap.data(), asOf);
    if (identity.errors.length) fail('invalid-argument', identity.errors.join('\n'));
    const previous = { birthDate: member.birthDate ?? '', idLast4: member.idLast4 ?? '', jerseyNo: member.jerseyNo ?? null };
    if (Object.keys(previous).every(key => previous[key] === fields[key])) fail('invalid-argument', '資料沒有變更。');
    const jerseyChanged = previous.jerseyNo !== fields.jerseyNo;
    const sheets = jerseyChanged ? (await tx.get(eventRef.collection('matchSheets').where('teamId', '==', teamId))).docs
      .filter(d => d.data().players?.some(p => p.memberId === memberId)) : [];
    const records = checkinsSnap.docs.filter(d => d.data().memberId === memberId && d.data().result != null);
    const matchIds = [...new Set([...records, ...sheets].map(d => d.data().matchId))];
    const matches = await Promise.all(matchIds.map(id => tx.get(eventRef.collection('matches').doc(id))));
    const stamp = FieldValue.serverTimestamp();
    const patch = { ...fields, identityComplete: identity.complete, identityRevision: revision + 1, updatedBy: uid, updatedAt: stamp };
    tx.update(memberRef, patch);
    // 同隊修改共用一份鎖，兩人同時搶同一背號只能成功一位。
    tx.update(teamRef, { rosterRevision: (team.rosterRevision ?? 0) + 1, updatedBy: uid, updatedAt: stamp });
    tx.set(teamRef.collection('roster').doc(memberId), rosterProjection({ ...member, ...patch }, { teamId, divisionId: team.divisionId, asOf }));
    for (const rec of records) tx.update(rec.ref, { result: null, failReason: 'IDENTITY_CHANGED', note: '球員資料已修改，請重新核對背號與證件。', scannedBy: uid, scannedAt: stamp });
    const updatedSheets = [];
    for (const matchSnap of matches) {
      const match = matchSnap.data();
      if (!match || !['scheduled', 'checkin', 'ready', 'postponed'].includes(match.status)) continue;
      const side = match.home?.teamId === teamId ? 'home' : match.away?.teamId === teamId ? 'away' : null;
      if (!side) continue;
      // 未開賽陣容同步背號；保留球員 ID、先發／替補與已開賽歷史快照。
      for (const sheet of sheets.filter(d => d.data().matchId === matchSnap.id)) {
        tx.update(sheet.ref, { players: sheet.data().players.map(p => p.memberId === memberId ? { ...p, jerseyNo: fields.jerseyNo } : p), updatedBy: uid, updatedAt: stamp });
        updatedSheets.push(sheet.id);
      }
      tx.update(matchSnap.ref, { [`checkin.${side}Confirmed`]: false, [`checkin.${side}Present`]: null, 'checkin.confirmedAt': null,
        ...(match.status === 'ready' ? { status: 'checkin' } : {}), updatedBy: uid, updatedAt: stamp });
    }
    tx.create(auditRef, { auditId: auditRef.id, eventId, action: 'member.identity.update', entity: 'member', entityId: `${teamId}/${memberId}`,
      before: { ...previous, checkins: records.map(d => ({ checkinId: d.id, result: d.data().result, scannedBy: d.data().scannedBy ?? null, scannedAt: d.data().scannedAt ?? null })) },
      after: { ...fields, identityComplete: identity.complete, invalidatedCheckins: records.map(d => d.id), updatedSheets },
      reason: reason.trim(), actor: { uid, name: staffSnap.data().name ?? null }, createdAt: stamp });
    return { memberId, ...fields, identityComplete: identity.complete, identityRevision: revision + 1, auditId: auditRef.id };
  });
}
