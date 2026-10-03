/** 管理員更名：隊伍、公開顯示、稽核與重送收據同一交易提交。 */
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db, evRef, adminActor, writeAudit } from './store.js';
import { importTeamKey } from './engine/team-import.js';
import { teamNameBasis, validateTeamNames, renamedMatchPatch, renamedRankingRows, renamedBoardPatch } from './engine/team-name.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const idOK = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);

export async function updateTeamNameFor(request) {
  const uid = request.auth?.uid;
  if (!uid) fail('unauthenticated', '請先登入。');
  const { eventId, teamId, operationId, expected, name, shortName, reason } = request.data ?? {};
  if (![eventId, teamId, operationId].every(idOK)) fail('invalid-argument', '賽事、球隊或操作代碼不正確。');
  const validation = validateTeamNames({ name, shortName, reason });
  if (validation.errors.length) fail('invalid-argument', validation.errors.join(' '));
  if (!Number.isInteger(expected?.revision) || expected.revision < 0) fail('invalid-argument', '請重新載入最新球隊資料。');
  const names = validation.fields;
  const base = evRef(eventId), teamRef = base.collection('teams').doc(teamId);
  const receiptRef = base.collection('managementOperations').doc(operationId);
  const requestHash = createHash('sha256').update(canonical({ action: 'team.rename', ...request.data })).digest('hex');
  return db().runTransaction(async tx => {
    const actor = await adminActor(tx, uid);
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data().requestHash !== requestHash || receipt.data().actorUid !== uid) fail('already-exists', '操作代碼已被使用。');
      return receipt.data().result;
    }
    const [eventSnap, teamSnap] = await Promise.all([tx.get(base), tx.get(teamRef)]);
    if (!eventSnap.exists || !teamSnap.exists) fail('not-found', '找不到賽事或球隊。');
    const team = teamSnap.data();
    if (canonical(teamNameBasis(team)) !== canonical(expected)) fail('aborted', '球隊名稱已被其他管理員修改，請關閉表單並重新載入後再試。');
    if (team.name === names.name && team.shortName === names.shortName) fail('invalid-argument', '球隊名稱與簡稱沒有變更。');
    if (!idOK(team.divisionId)) fail('failed-precondition', '球隊缺少有效的組別。');
    const [teams, homeMatches, awayMatches, standings, boards, division] = await Promise.all([
      tx.get(base.collection('teams').where('divisionId', '==', team.divisionId)),
      tx.get(base.collection('matches').where('home.teamId', '==', teamId)),
      tx.get(base.collection('matches').where('away.teamId', '==', teamId)),
      tx.get(base.collection('standings').where('divisionId', '==', team.divisionId)),
      tx.get(base.collection('boards')), tx.get(base.collection('divisions').doc(team.divisionId))
    ]);
    if (teams.docs.some(doc => doc.id !== teamId && importTeamKey(team.divisionId, doc.data().name) === importTeamKey(team.divisionId, names.name))) {
      fail('already-exists', '此組別已有同名球隊，請使用不同的球隊名稱。');
    }
    const stamp = FieldValue.serverTimestamp(), writes = [];
    for (const match of new Map([...homeMatches.docs, ...awayMatches.docs].map(doc => [doc.id, doc])).values()) {
      writes.push({ ref: match.ref, patch: renamedMatchPatch(match.data(), teamId, names) });
    }
    for (const standing of standings.docs) if (standing.data().rows?.some(row => row.teamId === teamId)) {
      writes.push({ ref: standing.ref, patch: { rows: renamedRankingRows(standing.data().rows, teamId, names) } });
    }
    for (const board of boards.docs) {
      const patch = renamedBoardPatch(board.data(), board.id, teamId, names);
      if (Object.keys(patch).length) writes.push({ ref: board.ref, patch });
    }
    if (division.data()?.finalRanking?.some(row => row.teamId === teamId)) {
      writes.push({ ref: division.ref, patch: { finalRanking: renamedRankingRows(division.data().finalRanking, teamId, names) } });
    }
    if (writes.length > 200 || Buffer.byteLength(canonical(writes.map(write => write.patch))) > 8 * 1024 * 1024) {
      fail('resource-exhausted', '相關賽事資料超過一次更名的容量，請聯絡主辦協助。');
    }
    const revision = (team.nameRevision ?? 0) + 1;
    tx.update(teamRef, { name: names.name, shortName: names.shortName, nameRevision: revision, updatedBy: uid, updatedAt: stamp });
    for (const write of writes) tx.update(write.ref, { ...write.patch, updatedBy: uid, updatedAt: stamp });
    const auditId = writeAudit(eventId, { entity: 'team', entityId: teamId, action: 'team.rename', actor,
      before: teamNameBasis(team), after: { name: names.name, shortName: names.shortName, revision, updatedDocuments: writes.map(write => write.ref.path) },
      reason: names.reason }, tx);
    const result = { teamId, name: names.name, shortName: names.shortName, nameRevision: revision, auditId, operationId };
    tx.create(receiptRef, { requestHash, actorUid: uid, result, createdAt: stamp });
    return result;
  });
}
