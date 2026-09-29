import { db } from '../../functions/admin.js';
import { importTeamsFor } from '../../functions/team-import.js';
import { syncRosterFor, recountTeamMembers, rejectCrossTeamDuplicate } from '../../functions/pipeline.js';
import { IMPORT_COLUMNS } from '../../js/engine/team-import.js';
import { toCsv } from '../../js/engine/csv.js';
import { ROSTER_FIELDS } from '../../js/engine/privacy.js';
import { updateMemberIdentityFor } from '../../functions/member-identity.js';

const E = 'import-test';
const root = () => db().doc(`events/${E}`);
const row = over => ({ divisionId: 'youth', teamName: '匯入隊', shortName: '匯入', playerName: '小飛', jerseyNo: '7', birthDate: '2017-01-01', idLast4: '0012', isCaptain: '是', isGoalkeeper: '否', ...over });
const request = (rows = [row()], uid = 'admin') => ({ auth: uid ? { uid } : null, data: { eventId: E, confirmed: true, csv: toCsv(IMPORT_COLUMNS.map(([key, label]) => ({ key, label })), rows) } });

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error('只允許 Emulator');
  const project = process.env.GCLOUD_PROJECT || 'demo-fn-test';
  const res = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok) throw new Error('清空 Emulator 失敗');
  const b = db().batch();
  b.set(root(), { dates: ['2026-10-09'] });
  b.set(root().collection('divisions').doc('youth'), { name: '學童', eligibility: { bornOnOrAfter: '2016-09-01' } });
  b.set(db().doc('staff/admin'), { active: true, roles: ['admin'], name: '管理員' });
  b.set(db().doc('staff/scorer'), { active: true, roles: ['scorer'] });
  b.set(db().doc('config/registration'), { open: false, hidden: true });
  await b.commit();
});

test('整份匯入直接核准，公開名冊白名單、私密資料與稽核正確，trigger 重跑後仍一致', async () => {
  const result = await importTeamsFor(request([row(), row({ teamName: '另一隊', idLast4: '9876' })]));
  expect(result).toMatchObject({ teamCount: 2, playerCount: 2 });
  const ref = root().collection('teams').doc(result.teamIds[0]);
  expect((await ref.get()).data()).toMatchObject({ status: 'approved', rosterLocked: true, captainUid: null, playerCount: 1 });
  const member = (await ref.collection('members').doc('p-7').get()).data();
  expect(member).toMatchObject({ idLast4: '0012', nameKind: 'nickname', status: 'approved' });
  const projection = (await ref.collection('roster').doc('p-7').get()).data();
  expect(Object.keys(projection).sort()).toEqual([...ROSTER_FIELDS].sort());
  expect(projection.displayName).toBe('小飛');
  expect(projection).not.toHaveProperty('birthDate');
  expect((await root().collection('audits').doc(result.importId).get()).data()).toMatchObject({ action: 'team.import', actor: { uid: 'admin' }, after: { teamCount: 2 } });
  expect(await rejectCrossTeamDuplicate({ eventId: E, teamId: result.teamIds[0], memberId: 'p-7', member })).toBe(false);
  await syncRosterFor({ eventId: E, teamId: result.teamIds[0], memberId: 'p-7' });
  await recountTeamMembers({ eventId: E, teamId: result.teamIds[0] });
  expect((await ref.collection('roster').doc('p-7').get()).data()).toMatchObject(projection);
});
test.each([null, 'scorer', 'missing'])('未登入或非管理員不得匯入：%s', async uid => {
  await expect(importTeamsFor(request([row()], uid))).rejects.toMatchObject({ code: uid ? 'permission-denied' : 'unauthenticated' });
  expect((await root().collection('teams').get()).empty).toBe(true);
});
test('停用管理員、未確認名冊及惡意 eventId 不能寫入', async () => {
  await db().doc('staff/admin').update({ active: false });
  await expect(importTeamsFor(request())).rejects.toMatchObject({ code: 'permission-denied' });
  const req = request(); req.data.confirmed = false;
  await expect(importTeamsFor(req)).rejects.toMatchObject({ code: 'invalid-argument' });
  req.data.eventId = '../staff/admin';
  await expect(importTeamsFor(req)).rejects.toMatchObject({ code: 'invalid-argument' });
});
test('伺服器重新驗證：壞資料混在後面不會留下前面的隊伍或稽核', async () => {
  await expect(importTeamsFor(request([row(), row({ teamName: '壞隊', idLast4: '9999', birthDate: '2010-01-01' })]))).rejects.toMatchObject({ code: 'invalid-argument' });
  expect((await root().collection('teams').get()).empty).toBe(true);
  expect((await root().collection('audits').get()).empty).toBe(true);
});
test('重送及兩位管理員同時匯入只能成功一次', async () => {
  const results = await Promise.allSettled([importTeamsFor(request()), importTeamsFor(request())]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect((await root().collection('teams').get()).size).toBe(1);
  expect((await root().collection('audits').get()).size).toBe(1);
  await expect(importTeamsFor(request())).rejects.toMatchObject({ code: 'invalid-argument' });
});
test('與既有球隊重名或跨隊球員重複時不覆蓋、不新增', async () => {
  await importTeamsFor(request());
  await expect(importTeamsFor(request([row({ teamName: '另一隊' })]))).rejects.toMatchObject({ code: 'already-exists' });
  await expect(importTeamsFor(request([row({ idLast4: '9999' })]))).rejects.toMatchObject({ code: 'invalid-argument' });
  expect((await root().collection('teams').get()).size).toBe(1);
});
test('不存在的賽事與缺少日期一律擋下', async () => {
  await root().delete();
  await expect(importTeamsFor(request())).rejects.toMatchObject({ code: 'failed-precondition' });
  await root().set({ name: '缺日期' });
  await expect(importTeamsFor(request())).rejects.toMatchObject({ code: 'invalid-argument' });
});

const editRequest = (teamId, over = {}, uid = 'admin') => ({ auth: uid ? { uid } : null, data: { eventId: E, teamId, memberId: 'p-7', birthDate: '2017-01-02', idLast4: '0001', revision: 0, reason: '依證件補填', ...over } });

test('留白匯入、部分補件、補齊及再修改，私密欄位不外洩且稽核完整', async () => {
  const imported = await importTeamsFor(request([row({ birthDate: '', idLast4: '' }), row({ jerseyNo: '8', birthDate: '', idLast4: '', isCaptain: '' })]));
  const teamId = imported.teamIds[0], ref = root().collection('teams').doc(teamId);
  expect((await ref.get()).data().status).toBe('approved');
  expect((await ref.collection('members').doc('p-7').get()).data().identityComplete).toBe(false);
  const part = await updateMemberIdentityFor(editRequest(teamId, { idLast4: '' }));
  expect(part.identityComplete).toBe(false);
  const full = await updateMemberIdentityFor(editRequest(teamId, { revision: 1 }));
  expect(full).toMatchObject({ identityComplete: true, idLast4: '0001', identityRevision: 2 });
  await updateMemberIdentityFor(editRequest(teamId, { revision: 2, idLast4: '0012' }));
  expect((await ref.collection('members').doc('p-7').get()).data().idLast4).toBe('0012');
  const projection = (await ref.collection('roster').doc('p-7').get()).data();
  expect(Object.keys(projection).sort()).toEqual([...ROSTER_FIELDS].sort());
  expect(projection).not.toHaveProperty('identityComplete');
  const audit = (await root().collection('audits').doc(full.auditId).get()).data();
  expect(audit).toMatchObject({ action: 'member.identity.update', before: { idLast4: '' }, after: { idLast4: '0001' }, actor: { uid: 'admin' }, reason: '依證件補填' });
});
test.each([null, 'scorer', 'missing'])('補件仍需管理權限：%s', async uid => {
  const { teamIds } = await importTeamsFor(request());
  await expect(updateMemberIdentityFor(editRequest(teamIds[0], {}, uid))).rejects.toMatchObject({ code: uid ? 'permission-denied' : 'unauthenticated' });
});
test('拒绝超齡、壞日期、完整證號、無原因、停用管理員與惡意路徑', async () => {
  const { teamIds: [id] } = await importTeamsFor(request());
  for (const over of [{ birthDate: '2010-01-01' }, { birthDate: '2017-02-30' }, { idLast4: 'A123456789' }, { reason: '' }, { teamId: '../staff/admin' }, { birthDate: null }]) {
    await expect(updateMemberIdentityFor(editRequest(id, over))).rejects.toMatchObject({ code: 'invalid-argument' });
  }
  await db().doc('staff/admin').update({ active: false });
  await expect(updateMemberIdentityFor(editRequest(id))).rejects.toMatchObject({ code: 'permission-denied' });
  expect((await root().collection('audits').get()).size).toBe(1);
});
test('補件檢查跨隊重複與同時修改：後到者不能覆蓋新值', async () => {
  const { teamIds: [id, other] } = await importTeamsFor(request([row(), row({ teamName: '第二隊', birthDate: '', idLast4: '' })]));
  await expect(updateMemberIdentityFor(editRequest(other, { birthDate: '2017-01-01', idLast4: '0012' }))).rejects.toMatchObject({ code: 'already-exists' });
  const results = await Promise.allSettled([updateMemberIdentityFor(editRequest(id)), updateMemberIdentityFor(editRequest(id, { idLast4: '0002' }))]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(r => r.status === 'rejected').reason.code).toBe('aborted');
  await expect(updateMemberIdentityFor(editRequest(id, { memberId: 'missing' }))).rejects.toMatchObject({ code: 'not-found' });
});
test('更改身分讓舊檢錄失效，待開賽場次退回檢錄且不動對隊確認與比分', async () => {
  const { teamIds: [id] } = await importTeamsFor(request());
  await root().collection('checkins').doc('match__p-7').set({ matchId: 'match', teamId: id, memberId: 'p-7', result: 'pass' });
  await root().collection('matches').doc('match').set({ home: { teamId: id }, away: { teamId: 'other' }, status: 'ready', score: { home: 0, away: 0 }, checkin: { homeConfirmed: true, awayConfirmed: true, homePresent: 5 } });
  const saved = await updateMemberIdentityFor(editRequest(id));
  expect((await root().collection('checkins').doc('match__p-7').get()).data()).toMatchObject({ result: null, failReason: 'IDENTITY_CHANGED' });
  expect((await root().collection('matches').doc('match').get()).data()).toMatchObject({ status: 'checkin', score: { home: 0, away: 0 }, checkin: { homeConfirmed: false, awayConfirmed: true, homePresent: null } });
  expect((await root().collection('audits').doc(saved.auditId).get()).data().before.checkins).toEqual([{ checkinId: 'match__p-7', result: 'pass', scannedBy: null, scannedAt: null }]);
});
