import { db } from '../../functions/admin.js';
import { assignTeamCaptainFor, setTeamManagementLockFor } from '../../functions/team-management.js';
import { updateMemberIdentityFor } from '../../functions/member-identity.js';
import { updateTeamNameFor } from '../../functions/team-name.js';
import { teamNameBasis } from '../../functions/engine/team-name.js';

const E = 'team-management-test', root = () => db().doc(`events/${E}`), team = id => root().collection('teams').doc(id);
const request = (uid, data) => ({ auth: uid ? { uid } : null, data: { eventId: E, ...data } });
const assign = (uid = 'super', over = {}) => request(uid, { teamId: 't1', divisionId: 'u10', captainUid: 'captain', previousCaptainUid: null, ...over });
const lock = (uid = 'admin', over = {}) => request(uid, { teamId: 't1', locked: true, ...over });
const edit = (uid = 'captain', over = {}) => request(uid, { teamId: 't1', memberId: 'm1', revision: 0, birthDate: '2017-01-02', idLast4: '0001', jerseyNo: 9, reason: '依證件更正', ...over });
beforeEach(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('只允許 Emulator');
  const project = process.env.GCLOUD_PROJECT || 'demo-fn-test';
  const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok) throw new Error('清空 Emulator 失敗');
  const batch = db().batch();
  batch.set(root(), { dates: ['2026-10-09'] });
  batch.set(root().collection('divisions').doc('u10'), { eligibility: { bornOnOrAfter: '2016-09-01' } });
  batch.set(db().doc('config/registration'), { hidden: true, open: false });
  for (const role of ['admin', 'super', 'scorer']) batch.set(db().doc(`staff/${role}`), { active: true, roles: [role === 'super' ? 'super_admin' : role], name: role });
  for (const uid of ['captain', 'next']) batch.set(db().doc(`users/${uid}`), { uid, displayName: uid === 'captain' ? '指定用戶' : '下一位' });
  for (const id of ['t1', 't2']) {
    batch.set(team(id), { divisionId: 'u10', name: id, captainUid: null, source: 'csv', status: 'approved', rosterLocked: true });
    batch.set(team(id).collection('members').doc('m1'), { source: 'csv', status: 'approved', kind: 'player', name: '小飛', jerseyNo: 7, birthDate: '2017-01-01', idLast4: '0012', identityRevision: 0 });
  }
  await batch.commit();
}, 30_000);

test('大總管指派隊長不建立全站角色，保留鎖定狀態並以交易留痕', async () => {
  await team('t1').update({ managementLocked: true });
  const result = await assignTeamCaptainFor(assign());
  expect((await team('t1').get()).data()).toMatchObject({ captainUid: 'captain', captainName: '指定用戶', status: 'approved', rosterLocked: true, managementLocked: true });
  expect((await db().doc('staff/captain').get()).exists).toBe(false);
  expect((await root().collection('audits').doc(result.auditId).get()).data()).toMatchObject({ action: 'team.captain.assign', actor: { uid: 'super' }, before: { captainUid: null }, after: { captainUid: 'captain' } });
});

test.each([null, 'admin', 'scorer', 'captain'])('非大總管不能指派或撤銷隊長：%s', async uid => {
  await expect(assignTeamCaptainFor(assign(uid))).rejects.toMatchObject({ code: uid ? 'permission-denied' : 'unauthenticated' });
  await expect(assignTeamCaptainFor(assign(uid, { captainUid: null }))).rejects.toMatchObject({ code: uid ? 'permission-denied' : 'unauthenticated' });
  expect((await team('t1').get()).data().captainUid).toBeNull();
  expect((await root().collection('audits').get()).empty).toBe(true);
});

test('停用總管、缺少用戶、错误組別、非法路徑及過期隊長不能留下變更', async () => {
  await expect(assignTeamCaptainFor(assign('super', { captainUid: 'missing' }))).rejects.toMatchObject({ code: 'not-found' });
  await expect(assignTeamCaptainFor(assign('super', { divisionId: 'other' }))).rejects.toMatchObject({ code: 'failed-precondition' });
  await expect(assignTeamCaptainFor(assign('super', { previousCaptainUid: 'old' }))).rejects.toMatchObject({ code: 'aborted' });
  for (const over of [{ eventId: '../staff' }, { teamId: '../staff' }, { captainUid: '../staff' }, { previousCaptainUid: undefined }]) {
    await expect(assignTeamCaptainFor(assign('super', over))).rejects.toMatchObject({ code: 'invalid-argument' });
  }
  await db().doc('staff/super').update({ active: false });
  await expect(assignTeamCaptainFor(assign())).rejects.toMatchObject({ code: 'permission-denied' });
  expect((await root().collection('audits').get()).empty).toBe(true);
});

test('同時重新指派隊長只有一人成功，撤銷之後原隊長無法修改', async () => {
  const results = await Promise.allSettled([assignTeamCaptainFor(assign()), assignTeamCaptainFor(assign('super', { captainUid: 'next' }))]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(r => r.status === 'rejected').reason.code).toBe('aborted');
  const captainUid = (await team('t1').get()).data().captainUid;
  await assignTeamCaptainFor(assign('super', { captainUid: null, previousCaptainUid: captainUid }));
  await expect(updateMemberIdentityFor(edit(captainUid))).rejects.toMatchObject({ code: 'permission-denied' });
});

test('指派隊長可在報名關閉且已核准的自己球隊修改原有欄位，別隊不能改', async () => {
  await assignTeamCaptainFor(assign());
  const result = await updateMemberIdentityFor(edit());
  expect(result).toMatchObject({ jerseyNo: 9, birthDate: '2017-01-02', idLast4: '0001', identityRevision: 1 });
  expect((await team('t1').collection('members').doc('m1').get()).data()).toMatchObject({ name: '小飛', status: 'approved', source: 'csv' });
  const audit = (await root().collection('audits').doc(result.auditId).get()).data();
  expect(audit.actor).toMatchObject({ uid: 'captain', name: '指定用戶' });
  await expect(updateMemberIdentityFor(edit('captain', { teamId: 't2' }))).rejects.toMatchObject({ code: 'permission-denied' });
});

test('隊長共用最新更名與補件範圍，上鎖與跨隊更名都拒絕且不寫入', async () => {
  await assignTeamCaptainFor(assign());
  const rename = async (uid, id, operationId) => updateTeamNameFor(request(uid, {
    teamId: id, operationId, expected: teamNameBasis((await team(id).get()).data()), name: '修正隊名', shortName: '修正隊名', reason: '教練確認'
  }));
  await expect(rename('captain', 't2', 'wrong-team')).rejects.toMatchObject({ code: 'permission-denied' });
  await setTeamManagementLockFor(lock());
  await expect(rename('captain', 't1', 'locked')).rejects.toMatchObject({ code: 'permission-denied' });
  expect((await team('t1').get()).data().name).toBe('t1');
  await expect(rename('admin', 't1', 'admin-rename')).resolves.toMatchObject({ name: '修正隊名' });
  await setTeamManagementLockFor(lock('admin', { locked: false }));
  await team('t1').update({ name: '原始隊名' });
  await expect(rename('captain', 't1', 'captain-rename')).resolves.toMatchObject({ name: '修正隊名' });
  await expect(updateMemberIdentityFor(edit('captain', { name: '小飛修正', expectedName: '小飛', operationId: 'captain-member-name', jerseyNo: 999 })))
    .resolves.toMatchObject({ name: '小飛修正', jerseyNo: 999 });
  await team('t1').collection('members').doc('m1').update({ source: 'manual' });
  await expect(updateMemberIdentityFor(request('captain', { teamId: 't1', memberId: 'm1', nameOnly: true, name: '新暱稱', expectedName: '小飛修正', operationId: 'captain-nickname', revision: 1, reason: '教練確認暱稱' })))
    .resolves.toMatchObject({ name: '新暱稱', identityRevision: 2 });
});

test('上鎖阻擋已開表單的隊長；管理員與總管仍可編輯，解鎖不動審核狀態', async () => {
  await assignTeamCaptainFor(assign());
  await setTeamManagementLockFor(lock());
  await expect(updateMemberIdentityFor(edit())).rejects.toMatchObject({ code: 'permission-denied' });
  expect((await team('t1').collection('members').doc('m1').get()).data().identityRevision).toBe(0);
  await expect(updateMemberIdentityFor(edit('admin'))).resolves.toMatchObject({ identityRevision: 1 });
  await expect(updateMemberIdentityFor(edit('super', { revision: 1, idLast4: '0002' }))).resolves.toMatchObject({ identityRevision: 2 });
  await setTeamManagementLockFor(lock('super', { locked: false }));
  await expect(updateMemberIdentityFor(edit('captain', { revision: 2, idLast4: '0003' }))).resolves.toMatchObject({ identityRevision: 3 });
  expect((await team('t1').get()).data()).toMatchObject({ status: 'approved', rosterLocked: true, managementLocked: false });
});

test.each([null, 'scorer', 'captain'])('非管理員不能單隊或全隊上鎖與解鎖：%s', async uid => {
  for (const locked of [true, false]) {
    await expect(setTeamManagementLockFor(lock(uid, { locked }))).rejects.toMatchObject({ code: uid ? 'permission-denied' : 'unauthenticated' });
    await expect(setTeamManagementLockFor(request(uid, { all: true, locked }))).rejects.toMatchObject({ code: uid ? 'permission-denied' : 'unauthenticated' });
  }
  expect((await root().collection('audits').get()).empty).toBe(true);
});

test('單隊上鎖與一鍵全鎖全解涵蓋全部球隊，交易稽核正確且重送無副作用', async () => {
  await setTeamManagementLockFor(lock());
  expect((await team('t2').get()).data().managementLocked).toBeUndefined();
  const first = await setTeamManagementLockFor(request('super', { all: true, locked: true }));
  expect(first.teamCount).toBe(1);
  await expect(setTeamManagementLockFor(request('admin', { all: true, locked: true }))).resolves.toMatchObject({ teamCount: 0, auditId: null });
  const result = await setTeamManagementLockFor(request('admin', { all: true, locked: false }));
  expect(result.teamCount).toBe(2);
  for (const id of ['t1', 't2']) expect((await team(id).get()).data()).toMatchObject({ managementLocked: false, status: 'approved', rosterLocked: true });
  const audit = (await root().collection('audits').doc(result.auditId).get()).data();
  expect(audit).toMatchObject({ action: 'team.management.unlock', actor: { uid: 'admin' }, entityId: 'all', after: { teamIds: ['t1', 't2'], managementLocked: false } });
  expect(audit.before.teams).toHaveLength(2);
  expect((await root().collection('audits').get()).size).toBe(3);
});

test('停用管理員、找不到球隊與無效鎖定參數不得寫入', async () => {
  for (const over of [{ locked: 'true' }, { teamId: '../staff' }, { all: true }, { eventId: '../staff' }]) {
    await expect(setTeamManagementLockFor(lock('admin', over))).rejects.toMatchObject({ code: 'invalid-argument' });
  }
  await expect(setTeamManagementLockFor(lock('admin', { teamId: 'missing' }))).rejects.toMatchObject({ code: 'not-found' });
  await db().doc('staff/admin').update({ active: false });
  await expect(setTeamManagementLockFor(lock())).rejects.toMatchObject({ code: 'permission-denied' });
  expect((await root().collection('audits').get()).empty).toBe(true);
});
