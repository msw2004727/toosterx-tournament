/** 管理員 CSV 匯入：驗證、球隊、私密名冊、公開投影與稽核在同一交易提交。 */
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin.js';
import { parseTeamCsv, validateTeamImport } from './engine/team-import.js';
import { rosterProjection } from './engine/privacy.js';

export class TeamImportError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new TeamImportError(code, message); };

export async function importTeamsFor(request) {
  const uid = request.auth?.uid;
  if (!uid) fail('unauthenticated', '請先登入。');
  const { eventId, csv, confirmed } = request.data ?? {};
  if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(eventId)) fail('invalid-argument', '賽事代碼不正確。');
  if (confirmed !== true) fail('invalid-argument', '請先確認名冊內容及未成年球員使用暱稱。');
  // 先驗證角色，避免未授權者借用此 API 探測現有名冊。
  const staffRef = db().doc(`staff/${uid}`);
  const authorized = s => s?.active === true && Array.isArray(s.roles) && s.roles.some(r => ['admin', 'super_admin'].includes(r));
  if (!authorized((await staffRef.get()).data())) fail('permission-denied', '只有管理員或總管能匯入球隊名冊。');
  let rows;
  try { rows = parseTeamCsv(csv); } catch (err) { fail('invalid-argument', err.message); }
  const eventRef = db().doc(`events/${eventId}`);
  const auditRef = eventRef.collection('audits').doc();
  return db().runTransaction(async tx => {
    const [staffSnap, eventSnap, divSnap, teamSnap] = await Promise.all([
      tx.get(staffRef), tx.get(eventRef), tx.get(eventRef.collection('divisions')), tx.get(eventRef.collection('teams'))
    ]);
    if (!authorized(staffSnap.data())) fail('permission-denied', '管理權限已變更，請重新登入。');
    if (!eventSnap.exists) fail('failed-precondition', '賽事不存在。');
    const asOf = eventSnap.data().dates?.[0];
    const divisions = divSnap.docs.map(d => ({ ...d.data(), divisionId: d.id }));
    const existingTeams = teamSnap.docs.map(d => ({ ...d.data(), teamId: d.id }));
    const plan = validateTeamImport(rows, { divisions, existingTeams, asOf });
    if (plan.errors.length) fail('invalid-argument', plan.errors.slice(0, 10).map(e => `${e.row ? `第 ${e.row} 列：` : ''}${e.message}`).join('\n'));
    const prepared = plan.teams.map(team => ({ ...team, teamId: `csv-${createHash('sha256').update(team.key).digest('hex').slice(0, 32)}` }));
    const targetSnaps = await tx.getAll(...prepared.map(t => eventRef.collection('teams').doc(t.teamId)));
    if (targetSnaps.some(s => s.exists)) fail('already-exists', '檔案內的球隊已匯入過，不能重複匯入。');
    const stamp = FieldValue.serverTimestamp();
    for (const team of prepared) {
      const ref = eventRef.collection('teams').doc(team.teamId);
      tx.create(ref, {
        teamId: team.teamId, eventId, divisionId: team.divisionId, name: team.name, shortName: team.shortName,
        captainUid: null, captainName: null, inviteCode: null, publicRoster: true,
        status: 'approved', rosterLocked: true, memberCount: team.members.length, playerCount: team.members.length,
        source: 'csv', importId: auditRef.id, reviewedBy: uid, reviewedAt: stamp, createdAt: stamp, updatedAt: stamp, updatedBy: uid
      });
      for (const [index, m] of team.members.entries()) {
        // 與背號分離，跨隊也唯一；同一交易重試仍得到相同 ID。
        const memberId = `p-${team.teamId.slice(4)}-${index + 1}`;
        const member = { ...m, memberId, teamId: team.teamId, eventId, divisionId: team.divisionId,
          guardianUid: null, isSelf: false, source: 'csv', addedBy: uid, appliedAt: stamp, approvedAt: stamp, updatedAt: stamp };
        tx.create(ref.collection('members').doc(memberId), member);
        tx.create(ref.collection('roster').doc(memberId), rosterProjection(member, { teamId: team.teamId, divisionId: team.divisionId, asOf }));
      }
    }
    const result = { importId: auditRef.id, teamCount: prepared.length, playerCount: rows.length, teamIds: prepared.map(t => t.teamId) };
    tx.create(auditRef, {
      auditId: auditRef.id, eventId, action: 'team.import', entity: 'event', entityId: eventId,
      before: null, after: result, reason: '管理員確認 CSV 名冊後匯入，直接核准並鎖定名單。',
      actor: { uid, name: staffSnap.data().name ?? null }, createdAt: stamp
    });
    return result;
  });
}
