import { db } from '../../functions/admin.js';
import { importTeamsFor } from '../../functions/team-import.js';
import { syncRosterFor, recountTeamMembers } from '../../functions/pipeline.js';
import { onMemberWritten } from '../../functions/index.js';
import { IMPORT_COLUMNS } from '../../js/engine/team-import.js';
import { toCsv } from '../../js/engine/csv.js';
import { ROSTER_FIELDS } from '../../js/engine/privacy.js';
import { updateMemberIdentityFor } from '../../functions/member-identity.js';

async function nameFixture(over = {}) {
  const teamRef = root().collection('teams').doc('rename-team');
  const member = { memberId: 'rename-member', source: 'csv', status: 'approved', name: '小飛', nameKind: 'nickname',
    birthDate: '2017-01-01', idLast4: '0012', jerseyNo: 7, identityComplete: true, identityRevision: 0, ...over };
  await teamRef.set({ teamId: teamRef.id, name: '更名測試隊', divisionId: 'youth', status: 'approved', rosterLocked: true, rosterRevision: 0 });
  await teamRef.collection('members').doc(member.memberId).set(member);
  await syncRosterFor({ eventId: E, teamId: teamRef.id, memberId: member.memberId });
  const req = { auth: { uid: 'admin' }, data: { eventId: E, teamId: teamRef.id, memberId: member.memberId, name: '飛達小將', nameOnly: true,
    expectedName: member.name, revision: 0, reason: '依教練確認更正暱稱', operationId: 'rename-operation' } };
  return { teamRef, member, req };
}

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

test('MEMBERNAME 更名同一交易更新私密、公開催名、射手榜與稽核，保留球員 ID 和身分欄位', async () => {
  const { teamRef, member, req } = await nameFixture({ displayName: '舊顯示名' });
  const boardRef = root().collection('boards').doc('scorers');
  await boardRef.set({ rows: [{ playerId: member.memberId, teamId: teamRef.id, name: '舊名', goals: 2, rank: 1 },
    { playerId: member.memberId, teamId: 'other-team', name: '另一隊同 ID', goals: 3 }] });
  const saved = await updateMemberIdentityFor(req);
  expect(saved).toMatchObject({ name: '飛達小將', memberId: member.memberId, identityRevision: 1 });
  expect((await teamRef.collection('members').doc(member.memberId).get()).data()).toMatchObject({ ...member, name: '飛達小將', displayName: '飛達小將', identityRevision: 1 });
  const publicRoster = (await teamRef.collection('roster').doc(member.memberId).get()).data();
  expect(publicRoster).toMatchObject({ memberId: member.memberId, displayName: '飛達小將', jerseyNo: 7 });
  expect(Object.keys(publicRoster).sort()).toEqual([...ROSTER_FIELDS].sort());
  expect((await boardRef.get()).data().rows).toEqual([{ playerId: member.memberId, teamId: teamRef.id, name: '飛達小將', goals: 2, rank: 1 },
    { playerId: member.memberId, teamId: 'other-team', name: '另一隊同 ID', goals: 3 }]);
  expect((await teamRef.get()).data()).toMatchObject({ status: 'approved', rosterLocked: true, rosterRevision: 1 });
  expect((await root().collection('audits').doc(saved.auditId).get()).data()).toMatchObject({ before: { name: '小飛' }, after: { name: '飛達小將' }, actor: { uid: 'admin' }, reason: req.data.reason });
  await syncRosterFor({ eventId: E, teamId: teamRef.id, memberId: member.memberId });
  expect((await teamRef.collection('roster').doc(member.memberId).get()).data()).toEqual(publicRoster);
});

test.each([['approved', 'legacy'], ['pending', 'legacy'], ['approved', 'csv']])('MEMBERNAME 更名適用 %s 的 %s 名冊且不要求補生日', async (status, source) => {
  const { teamRef, member, req } = await nameFixture({ status, source, birthDate: '', idLast4: '', kind: 'coach' });
  const saved = await updateMemberIdentityFor(req);
  expect(saved.name).toBe('飛達小將');
  expect((await teamRef.collection('members').doc(member.memberId).get()).data()).toMatchObject({ status, source, kind: 'coach', birthDate: '', idLast4: '', nameKind: 'nickname' });
  expect((await teamRef.collection('roster').doc(member.memberId).get()).exists).toBe(status === 'approved');
});

test('MEMBERNAME 既有真名遮蔽仍套用到公開名單與射手榜', async () => {
  const { teamRef, member, req } = await nameFixture({ nameKind: 'real' });
  await root().collection('boards').doc('scorers').set({ rows: [{ playerId: member.memberId, teamId: teamRef.id, name: '旧名', goals: 2 }] });
  req.data.name = '陳小飛';
  await updateMemberIdentityFor(req);
  expect((await teamRef.collection('roster').doc(member.memberId).get()).data().displayName).toBe('陳小＊');
  expect((await root().collection('boards').doc('scorers').get()).data().rows[0].name).toBe('陳小＊');
  expect((await teamRef.collection('members').doc(member.memberId).get()).data()).toMatchObject({ name: '陳小飛', nameKind: 'real' });
});

test('MEMBERNAME CSV 可一次修改姓名與身分，未開賽陣容同步，歷史比賽與進球保留', async () => {
  const { teamRef, member, req } = await nameFixture();
  for (const [matchId, status] of [['future-name', 'ready'], ['past-name', 'finished']]) {
    await root().collection('matches').doc(matchId).set({ status, home: { teamId: teamRef.id }, away: { teamId: 'other' }, score: { home: 1, away: 0 }, checkin: { homeConfirmed: true, awayConfirmed: true } });
    await root().collection('matchSheets').doc(matchId).set({ matchId, teamId: teamRef.id, confirmed: true, players: [{ memberId: member.memberId, jerseyNo: 7, role: 'start', displayName: '小飛' }] });
  }
  const goalRef = root().collection('matches').doc('past-name').collection('timeline').doc('goal');
  await goalRef.set({ type: 'goal', playerId: member.memberId, playerName: '小飛' });
  await root().collection('checkins').doc('future-name-check').set({ matchId: 'future-name', teamId: teamRef.id, memberId: member.memberId, result: 'pass' });
  Object.assign(req.data, { nameOnly: false, birthDate: member.birthDate, idLast4: '0033', jerseyNo: 0 });
  const saved = await updateMemberIdentityFor(req);
  expect(saved).toMatchObject({ name: '飛達小將', jerseyNo: 0, idLast4: '0033', identityRevision: 1 });
  expect((await root().collection('matchSheets').doc('future-name').get()).data().players[0]).toMatchObject({ memberId: member.memberId, displayName: '飛達小將', jerseyNo: 0, role: 'start' });
  expect((await root().collection('matchSheets').doc('past-name').get()).data().players[0]).toMatchObject({ displayName: '小飛', jerseyNo: 7 });
  expect((await goalRef.get()).data()).toEqual({ type: 'goal', playerId: member.memberId, playerName: '小飛' });
  expect((await root().collection('matches').doc('future-name').get()).data()).toMatchObject({ status: 'checkin', checkin: { homeConfirmed: false, awayConfirmed: true }, score: { home: 1, away: 0 } });
  expect((await root().collection('checkins').doc('future-name-check').get()).data().result).toBeNull();
});

test('MEMBERNAME 僅更名也同步未開賽陣容且保留既有背號', async () => {
  const { teamRef, member, req } = await nameFixture();
  await root().collection('matches').doc('only-name').set({ status: 'scheduled', home: { teamId: teamRef.id }, away: { teamId: 'other' } });
  await root().collection('matchSheets').doc('only-name').set({ matchId: 'only-name', teamId: teamRef.id, players: [{ memberId: member.memberId, jerseyNo: 7, displayName: '小飛' }] });
  await updateMemberIdentityFor(req);
  expect((await root().collection('matchSheets').doc('only-name').get()).data().players[0]).toMatchObject({ displayName: '飛達小將', jerseyNo: 7 });
});

test('MEMBERNAME 重送同一請求只建立一份稽核；收據仍驗權限與請求內容', async () => {
  const { req } = await nameFixture();
  const first = await updateMemberIdentityFor(req);
  expect(await updateMemberIdentityFor(req)).toEqual(first);
  expect((await root().collection('audits').get()).size).toBe(1);
  await expect(updateMemberIdentityFor({ ...req, data: { ...req.data, name: '另一名字' } })).rejects.toMatchObject({ code: 'already-exists' });
  await db().doc('staff/admin').update({ active: false });
  await expect(updateMemberIdentityFor(req)).rejects.toMatchObject({ code: 'permission-denied' });
});

test('MEMBERNAME 管理員舊版本與舊名字都不可覆蓋新值，非法更名不寫稽核', async () => {
  const { teamRef, member, req } = await nameFixture();
  for (const name of ['', '名'.repeat(41), '名\n字', null]) await expect(updateMemberIdentityFor({ ...req, data: { ...req.data, name } })).rejects.toMatchObject({ code: 'invalid-argument' });
  for (const data of [{ ...req.data, birthDate: '' }, { ...req.data, operationId: '../bad' }]) await expect(updateMemberIdentityFor({ ...req, data })).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(updateMemberIdentityFor({ ...req, auth: { uid: 'scorer' } })).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(updateMemberIdentityFor({ ...req, auth: null })).rejects.toMatchObject({ code: 'unauthenticated' });
  await teamRef.collection('members').doc(member.memberId).update({ name: '教練的新名字' });
  await expect(updateMemberIdentityFor(req)).rejects.toMatchObject({ code: 'aborted' });
  req.data.expectedName = '教練的新名字';
  await updateMemberIdentityFor(req);
  await expect(updateMemberIdentityFor({ ...req, data: { ...req.data, operationId: 'new-operation' } })).rejects.toMatchObject({ code: 'aborted' });
  expect((await root().collection('audits').get()).size).toBe(1);
});

test('整份匯入直接核准，公開名冊白名單、私密資料與稽核正確，trigger 重跑後仍一致', async () => {
  const result = await importTeamsFor(request([row(), row({ teamName: '另一隊' })]));
  expect(result).toMatchObject({ teamCount: 2, playerCount: 2 });
  const ref = root().collection('teams').doc(result.teamIds[0]);
  expect((await ref.get()).data()).toMatchObject({ status: 'approved', rosterLocked: true, captainUid: null, playerCount: 1 });
  const member = (await ref.collection('members').doc('p-11a0e9e231b01869997d7297bd4231f7-1').get()).data();
  expect(member).toMatchObject({ idLast4: '0012', nameKind: 'nickname', status: 'approved' });
  const projection = (await ref.collection('roster').doc('p-11a0e9e231b01869997d7297bd4231f7-1').get()).data();
  expect(Object.keys(projection).sort()).toEqual([...ROSTER_FIELDS].sort());
  expect(projection.displayName).toBe('小飛');
  expect(projection).not.toHaveProperty('birthDate');
  expect((await root().collection('audits').doc(result.importId).get()).data()).toMatchObject({ action: 'team.import', actor: { uid: 'admin' }, after: { teamCount: 2 } });
  await onMemberWritten.run({ params: { eventId: E, teamId: result.teamIds[0], memberId: 'p-11a0e9e231b01869997d7297bd4231f7-1' }, data: { before: { data: () => undefined }, after: { data: () => member } } });
  expect((await ref.collection('members').doc('p-11a0e9e231b01869997d7297bd4231f7-1').get()).data().status).toBe('approved');
  await syncRosterFor({ eventId: E, teamId: result.teamIds[0], memberId: 'p-11a0e9e231b01869997d7297bd4231f7-1' });
  await recountTeamMembers({ eventId: E, teamId: result.teamIds[0] });
  expect((await ref.collection('roster').doc('p-11a0e9e231b01869997d7297bd4231f7-1').get()).data()).toMatchObject(projection);
});

test('CSV 同隊超過 15 人完整匯入，trigger 重放與補件後都保留核准名冊及人數', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => row({
    playerName: `球員${i + 1}`, jerseyNo: '', idLast4: String(1000 + i), isCaptain: i === 0 ? '是' : ''
  }));
  const result = await importTeamsFor(request(rows));
  expect(result).toMatchObject({ teamCount: 1, playerCount: 30 });
  const ref = root().collection('teams').doc(result.teamIds[0]);
  const members = await ref.collection('members').get();
  expect(members.size).toBe(30);
  for (const member of [members.docs[0], members.docs[15], members.docs[29]]) {
    const event = { params: { eventId: E, teamId: ref.id, memberId: member.id },
      data: { before: { data: () => undefined }, after: { data: () => member.data() } } };
    await onMemberWritten.run(event);
    await onMemberWritten.run(event);
  }
  const memberId = members.docs[29].id;
  await updateMemberIdentityFor(editRequest(ref.id, { memberId, idLast4: '0099' }));
  const edited = (await ref.collection('members').doc(memberId).get()).data();
  await onMemberWritten.run({ params: { eventId: E, teamId: ref.id, memberId },
    data: { before: { data: () => members.docs[29].data() }, after: { data: () => edited } } });
  expect((await ref.get()).data()).toMatchObject({ source: 'csv', captainUid: null, rosterLocked: true, memberCount: 30, playerCount: 30 });
  expect((await ref.collection('members').get()).docs.every(d => d.data().status === 'approved')).toBe(true);
  const roster = await ref.collection('roster').get();
  expect(roster.size).toBe(30);
  expect(roster.docs.every(d => !('birthDate' in d.data()) && !('idLast4' in d.data()))).toBe(true);
  expect((await root().collection('audits').get()).docs.some(d => d.data().action === 'member.capRejected')).toBe(false);
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
test('既有跨隊同人可新增，仍禁止覆蓋同名球隊', async () => {
  await importTeamsFor(request());
  await expect(importTeamsFor(request([row({ teamName: '另一隊' })]))).resolves.toMatchObject({ teamCount: 1 });
  await expect(importTeamsFor(request([row({ idLast4: '9999' })]))).rejects.toMatchObject({ code: 'invalid-argument' });
  expect((await root().collection('teams').get()).size).toBe(2);
});
test('不存在的賽事與缺少日期一律擋下', async () => {
  await root().delete();
  await expect(importTeamsFor(request())).rejects.toMatchObject({ code: 'failed-precondition' });
  await root().set({ name: '缺日期' });
  await expect(importTeamsFor(request())).rejects.toMatchObject({ code: 'invalid-argument' });
});

const editRequest = (teamId, over = {}, uid = 'admin') => ({ auth: uid ? { uid } : null, data: { eventId: E, teamId, memberId: `p-${teamId.slice(4)}-1`, birthDate: '2017-01-02', idLast4: '0001', revision: 0, reason: '依證件補填', ...over } });

test('多隊多人空背號不覆蓋，球員 ID 全部唯一；補填、更換、清空只更新原球員', async () => {
  const { teamIds } = await importTeamsFor(request([
    row({ playerName: '甲', jerseyNo: '' }), row({ playerName: '乙', jerseyNo: '', isCaptain: '' }),
    row({ teamName: '另隊', playerName: '丙', jerseyNo: '' }), row({ teamName: '另隊', playerName: '丁', jerseyNo: '', isCaptain: '' })
  ]));
  const lists = await Promise.all(teamIds.map(id => root().collection('teams').doc(id).collection('members').get()));
  expect(lists.map(s => s.size)).toEqual([2, 2]);
  expect(new Set(lists.flatMap(s => s.docs.map(d => d.id))).size).toBe(4);
  const ref = root().collection('teams').doc(teamIds[0]), memberId = lists[0].docs.find(d => d.data().name === '甲').id;
  for (const [revision, jerseyNo] of [0, 9, null].entries()) {
    const result = await updateMemberIdentityFor(editRequest(ref.id, { memberId, jerseyNo, revision }));
    expect(result).toMatchObject({ memberId, jerseyNo, identityRevision: revision + 1 });
    expect((await ref.collection('members').doc(memberId).get()).data()).toMatchObject({ name: '甲', jerseyNo });
    expect((await ref.collection('roster').doc(memberId).get()).data()).toMatchObject({ memberId, jerseyNo });
  }
  expect((await ref.collection('members').get()).size).toBe(2);
  expect((await ref.collection('roster').get()).size).toBe(2);
});

test('後端拒絕同隊重號及無效背號，允许維持本人的號碼與跨隊同號；舊客戶端不清空背號', async () => {
  const { teamIds: [id] } = await importTeamsFor(request([row(), row({ jerseyNo: '0', isCaptain: '' })]));
  const ref = root().collection('teams').doc(id), memberId = `p-${id.slice(4)}-1`;
  for (const jerseyNo of [0, '00']) await expect(updateMemberIdentityFor(editRequest(id, { jerseyNo }))).rejects.toMatchObject({ code: 'already-exists' });
  for (const jerseyNo of [100, -1, 1.1, true, {}, '1e1']) await expect(updateMemberIdentityFor(editRequest(id, { jerseyNo }))).rejects.toMatchObject({ code: 'invalid-argument' });
  expect((await root().collection('audits').get()).size).toBe(1);
  expect((await ref.collection('members').doc(memberId).get()).data().jerseyNo).toBe(7);
  await expect(updateMemberIdentityFor(editRequest(id, { jerseyNo: 7 }))).resolves.toMatchObject({ jerseyNo: 7 });
  await expect(updateMemberIdentityFor(editRequest(id, { revision: 1, idLast4: '0033' }))).resolves.toMatchObject({ jerseyNo: 7 });
  const { teamIds: [other] } = await importTeamsFor(request([row({ teamName: '別隊', jerseyNo: '' })]));
  await expect(updateMemberIdentityFor(editRequest(other, { jerseyNo: 7 }))).resolves.toMatchObject({ jerseyNo: 7 });
});

test('兩位管理員同時給不同球員同一背號，交易只讓一位成功', async () => {
  const { teamIds: [id] } = await importTeamsFor(request([row({ jerseyNo: '' }), row({ jerseyNo: '', isCaptain: '' })]));
  const members = await root().collection('teams').doc(id).collection('members').get();
  const results = await Promise.allSettled(members.docs.map(d => updateMemberIdentityFor(editRequest(id, { memberId: d.id, jerseyNo: 0 }))));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(r => r.status === 'rejected').reason.code).toBe('already-exists');
  expect((await root().collection('teams').doc(id).collection('members').get()).docs.filter(d => d.data().jerseyNo === 0)).toHaveLength(1);
}, 30_000);

test('既有 p-7 球員改號保留 ID、歷史進球與已開賽陣容，未開賽陣容同步且重新檢錄', async () => {
  const { teamIds: [id] } = await importTeamsFor(request());
  const ref = root().collection('teams').doc(id);
  await ref.collection('members').doc('p-7').set({ source: 'csv', status: 'approved', name: '舊球員', birthDate: '2017-01-01', idLast4: '0012', jerseyNo: 8 });
  for (const [matchId, status] of [['future', 'ready'], ['past', 'finished']]) {
    await root().collection('matches').doc(matchId).set({ status, home: { teamId: id }, away: { teamId: 'other' }, checkin: { homeConfirmed: true, awayConfirmed: true }, score: { home: 1, away: 0 } });
    await root().collection('matchSheets').doc(`${matchId}__${id}`).set({ matchId, teamId: id, confirmed: true, players: [{ memberId: 'p-7', jerseyNo: 8, role: 'start', displayName: '舊球員' }] });
  }
  await root().collection('checkins').doc('future__p-7').set({ matchId: 'future', teamId: id, memberId: 'p-7', result: 'pass' });
  const goalRef = root().collection('matches').doc('past').collection('timeline').doc('goal');
  const goal = { type: 'goal', playerId: 'p-7', jerseyNo: 8, side: 'home' };
  await goalRef.set(goal);
  const result = await updateMemberIdentityFor(editRequest(id, { memberId: 'p-7', birthDate: '2017-01-01', idLast4: '0012', jerseyNo: 0 }));
  expect((await ref.collection('members').doc('p-7').get()).data().jerseyNo).toBe(0);
  expect((await root().collection('matchSheets').doc(`future__${id}`).get()).data().players).toEqual([{ memberId: 'p-7', jerseyNo: 0, role: 'start', displayName: '舊球員' }]);
  expect((await root().collection('matchSheets').doc(`past__${id}`).get()).data().players[0].jerseyNo).toBe(8);
  expect((await root().collection('matches').doc('future').get()).data()).toMatchObject({ status: 'checkin', checkin: { homeConfirmed: false, awayConfirmed: true }, score: { home: 1, away: 0 } });
  expect((await root().collection('checkins').doc('future__p-7').get()).data().result).toBeNull();
  expect((await goalRef.get()).data()).toEqual(goal);
  expect((await root().collection('audits').doc(result.auditId).get()).data()).toMatchObject({ before: { jerseyNo: 8 }, after: { jerseyNo: 0, updatedSheets: [`future__${id}`] } });
});

test('留白匯入、部分補件、補齊及再修改，私密欄位不外洩且稽核完整', async () => {
  const imported = await importTeamsFor(request([row({ birthDate: '', idLast4: '' }), row({ jerseyNo: '8', birthDate: '', idLast4: '', isCaptain: '' })]));
  const teamId = imported.teamIds[0], ref = root().collection('teams').doc(teamId);
  expect((await ref.get()).data().status).toBe('approved');
  expect((await ref.collection('members').doc('p-11a0e9e231b01869997d7297bd4231f7-1').get()).data().identityComplete).toBe(false);
  const part = await updateMemberIdentityFor(editRequest(teamId, { idLast4: '' }));
  expect(part.identityComplete).toBe(false);
  const full = await updateMemberIdentityFor(editRequest(teamId, { revision: 1 }));
  expect(full).toMatchObject({ identityComplete: true, idLast4: '0001', identityRevision: 2 });
  await updateMemberIdentityFor(editRequest(teamId, { revision: 2, idLast4: '0012' }));
  expect((await ref.collection('members').doc('p-11a0e9e231b01869997d7297bd4231f7-1').get()).data().idLast4).toBe('0012');
  const projection = (await ref.collection('roster').doc('p-11a0e9e231b01869997d7297bd4231f7-1').get()).data();
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
test('補件可與別隊同身分，同時修改後到者仍不能覆蓋新值', async () => {
  const { teamIds: [id, other] } = await importTeamsFor(request([row(), row({ teamName: '第二隊', birthDate: '', idLast4: '' })]));
  await expect(updateMemberIdentityFor(editRequest(other, { birthDate: '2017-01-01', idLast4: '0012' }))).resolves.toMatchObject({ identityComplete: true, idLast4: '0012' });
  const results = await Promise.allSettled([updateMemberIdentityFor(editRequest(id)), updateMemberIdentityFor(editRequest(id, { idLast4: '0002' }))]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(r => r.status === 'rejected').reason.code).toBe('aborted');
  await expect(updateMemberIdentityFor(editRequest(id, { memberId: 'missing' }))).rejects.toMatchObject({ code: 'not-found' });
}, 30_000);
test('更改身分讓舊檢錄失效，待開賽場次退回檢錄且不動對隊確認與比分', async () => {
  const { teamIds: [id] } = await importTeamsFor(request());
  await root().collection('checkins').doc('match__p-11a0e9e231b01869997d7297bd4231f7-1').set({ matchId: 'match', teamId: id, memberId: 'p-11a0e9e231b01869997d7297bd4231f7-1', result: 'pass' });
  await root().collection('matches').doc('match').set({ home: { teamId: id }, away: { teamId: 'other' }, status: 'ready', score: { home: 0, away: 0 }, checkin: { homeConfirmed: true, awayConfirmed: true, homePresent: 5 } });
  const saved = await updateMemberIdentityFor(editRequest(id));
  expect((await root().collection('checkins').doc('match__p-11a0e9e231b01869997d7297bd4231f7-1').get()).data()).toMatchObject({ result: null, failReason: 'IDENTITY_CHANGED' });
  expect((await root().collection('matches').doc('match').get()).data()).toMatchObject({ status: 'checkin', score: { home: 0, away: 0 }, checkin: { homeConfirmed: false, awayConfirmed: true, homePresent: null } });
  expect((await root().collection('audits').doc(saved.auditId).get()).data().before.checkins).toEqual([{ checkinId: 'match__p-11a0e9e231b01869997d7297bd4231f7-1', result: 'pass', scannedBy: null, scannedAt: null }]);
});
