import { db } from '../../functions/admin.js';
import { updateTeamNameFor } from '../../functions/team-name.js';
import { onTeamWritten } from '../../functions/index.js';

const E = 'team-name-test', base = () => db().doc(`events/${E}`), team = () => base().collection('teams').doc('t');
const old = { name: '原始球隊', shortName: '原隊', revision: 0 };
const request = (over = {}, uid = 'admin') => ({ auth: uid ? { uid } : null, data: { eventId: E, teamId: 't', operationId: 'rename-1', expected: old, name: '新的球隊名稱', shortName: '新隊', reason: '依教練確認修正', ...over } });
const audit = () => base().collection('audits').get();
const originalTeam = { teamId: 't', name: old.name, shortName: old.shortName, divisionId: 'd', status: 'approved', rosterLocked: true, source: 'csv', captainUid: null, playerCount: 30, memberCount: 30, seed: 2, groupId: 'A', reviewedBy: 'other' };
const match = { matchId: 'm', divisionId: 'd', home: { teamId: 't', name: old.name, displayName: old.shortName, abbr: 'OLD' }, away: { teamId: 'other', name: '對手隊', displayName: '對手' }, teamIds: ['t', 'other'], status: 'confirmed', score: { home: 2, away: 1 }, result: { winner: 'home', winnerTeamId: 't' }, kickoffAt: '2026-10-09T10:00:00+08:00', lock: { locked: true }, revisionCount: 4 };

beforeEach(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Emulator required');
  const project = process.env.GCLOUD_PROJECT || 'demo-fn-test';
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  if (!response.ok) throw Error('Emulator reset failed');
  const batch = db().batch();
  batch.set(base(), { dates: ['2026-10-09'] });
  for (const [uid, roles, active] of [['admin', ['admin'], true], ['super', ['super_admin'], true], ['scorer', ['scorer'], true], ['booth', ['booth'], true], ['inactive', ['admin'], false]]) batch.set(db().doc(`staff/${uid}`), { roles, active, name: uid });
  batch.set(team(), originalTeam);
  batch.set(base().collection('teams').doc('other'), { name: '對手隊', divisionId: 'd', status: 'approved' });
  batch.set(base().collection('divisions').doc('d'), { finalRankingPublished: true, finalRankingStale: false, schedulePublished: true, scheduleRevision: 3, finalRanking: [{ rank: 1, teamId: 't', name: old.shortName }, { rank: 2, teamId: 'other', name: '對手' }] });
  batch.set(base().collection('matches').doc('m'), match);
  batch.set(base().collection('matches').doc('away'), { ...match, matchId: 'away', home: match.away, away: match.home, status: 'scheduled' });
  batch.set(base().collection('standings').doc('s'), { divisionId: 'd', version: 4, rows: [{ teamId: 't', name: old.shortName, points: 9, rank: 1, locked: true }, { teamId: 'other', name: '對手', points: 3, rank: 2 }] });
  batch.set(base().collection('boards').doc('scorers'), { rows: [{ teamId: 't', name: '小飛', teamName: old.shortName, playerId: 'p', goals: 3, divisionId: 'd' }] });
  batch.set(base().collection('boards').doc('fairplay'), { rows: [{ teamId: 't', name: old.name, deduction: -3, divisionId: 'd' }] });
  batch.set(base().collection('boards').doc('live'), { liveMatches: [match], nextMatches: [match], justFinished: [match] });
  batch.set(team().collection('members').doc('p'), { name: '小飛', idLast4: '0123', status: 'approved' });
  batch.set(team().collection('roster').doc('p'), { displayName: '小飛', jerseyNo: 7 });
  await batch.commit();
});

test('管理員更名一次同步兩邊賽程、積分、最終排名、首頁與球員看板，稽核完整', async () => {
  const result = await updateTeamNameFor(request());
  expect(result).toMatchObject({ teamId: 't', name: '新的球隊名稱', shortName: '新隊', nameRevision: 1, operationId: 'rename-1' });
  expect((await team().get()).data()).toEqual({ ...originalTeam, name: '新的球隊名稱', shortName: '新隊', nameRevision: 1, updatedBy: 'admin', updatedAt: expect.anything() });
  for (const [id, side] of [['m', 'home'], ['away', 'away']]) {
    const m = (await base().collection('matches').doc(id).get()).data();
    expect(m[side]).toEqual({ ...match.home, name: '新的球隊名稱', displayName: '新隊' });
    expect(m.score).toEqual(match.score); expect(m.teamIds).toEqual(match.teamIds); expect(m.result).toEqual(match.result); expect(m.lock).toEqual(match.lock);
  }
  const standing = (await base().collection('standings').doc('s').get()).data();
  expect(standing).toMatchObject({ version: 4, rows: [{ teamId: 't', name: '新隊', points: 9, rank: 1, locked: true }, { teamId: 'other', name: '對手', points: 3, rank: 2 }] });
  const division = (await base().collection('divisions').doc('d').get()).data();
  expect(division).toMatchObject({ finalRankingPublished: true, finalRankingStale: false, schedulePublished: true, scheduleRevision: 3, finalRanking: [{ rank: 1, teamId: 't', name: '新隊' }, { rank: 2, teamId: 'other', name: '對手' }] });
  expect((await base().collection('boards').doc('scorers').get()).data().rows[0]).toMatchObject({ name: '小飛', teamName: '新隊', goals: 3 });
  expect((await base().collection('boards').doc('fairplay').get()).data().rows[0]).toMatchObject({ name: '新的球隊名稱', deduction: -3 });
  for (const key of ['liveMatches', 'nextMatches', 'justFinished']) expect((await base().collection('boards').doc('live').get()).data()[key][0].home.displayName).toBe('新隊');
  expect((await team().collection('members').doc('p').get()).data().idLast4).toBe('0123');
  expect((await team().collection('roster').doc('p').get()).data().displayName).toBe('小飛');
  const a = (await audit()).docs[0].data();
  expect(a).toMatchObject({ action: 'team.rename', entity: 'team', entityId: 't', before: old, after: { name: '新的球隊名稱', shortName: '新隊', revision: 1 }, reason: '依教練確認修正', actor: { uid: 'admin' } });
  expect(JSON.stringify(a)).not.toContain('0123'); expect(a.auditId).toBe(result.auditId);
});
test.each(['submitted', 'draft', 'rejected', 'withdrawn'])('各審核狀態都可更名，狀態不動：%s', async status => {
  await team().update({ status }); await updateTeamNameFor(request({}, 'super'));
  expect((await team().get()).data().status).toBe(status);
});
test.each([null, 'scorer', 'booth', 'inactive', 'missing'])('未登入、非管理員與停用者禁止更名：%s', async uid => {
  await expect(updateTeamNameFor(request({}, uid))).rejects.toMatchObject({ code: uid ? 'permission-denied' : 'unauthenticated' });
  expect((await team().get()).data().name).toBe(old.name); expect((await audit()).size).toBe(0);
});
test.each([{ name: '' }, { name: 'x'.repeat(61) }, { name: '換\n名' }, { shortName: 'x'.repeat(21) }, { reason: '' }, { expected: { ...old, revision: -1 } }, { teamId: '../t' }])('不正確的指令不寫入：%j', async over => {
  await expect(updateTeamNameFor(request(over))).rejects.toMatchObject({ code: 'invalid-argument' });
  expect((await team().get()).data().name).toBe(old.name); expect((await audit()).size).toBe(0);
});
test('同組別正規化同名拒絕，異組同名可用，簡稱留空自動帶入', async () => {
  await expect(updateTeamNameFor(request({ name: '　對手隊　' }))).rejects.toMatchObject({ code: 'already-exists' });
  await base().collection('teams').doc('different').set({ name: '新的球隊名稱', divisionId: 'other-division' });
  await updateTeamNameFor(request({ shortName: '' })); expect((await team().get()).data().shortName).toBe('新的球隊名稱');
});
test('舊資料無版本欄位可更名；已被他人更名時拒絕覆寫', async () => {
  await team().update({ name: '先改好的隊名' });
  await expect(updateTeamNameFor(request())).rejects.toMatchObject({ code: 'aborted' });
  expect((await team().get()).data().name).toBe('先改好的隊名'); expect((await audit()).size).toBe(0);
});
test('相同請求重送只留一筆紀錄，換人或換內容不能冒用收據', async () => {
  const first = await updateTeamNameFor(request());
  expect(await updateTeamNameFor(request())).toEqual(first);
  expect((await audit()).size).toBe(1); expect((await team().get()).data().nameRevision).toBe(1);
  await expect(updateTeamNameFor(request({ name: '又改一次' }))).rejects.toMatchObject({ code: 'already-exists' });
  await expect(updateTeamNameFor(request({}, 'super'))).rejects.toMatchObject({ code: 'already-exists' });
});
test('同時從相同舊隊名修改只能成功一次', async () => {
  const commands = [request(), request({ operationId: 'rename-2', name: '另一新隊名' })];
  const results = await Promise.allSettled(commands.map(updateTeamNameFor));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const loser = results.findIndex(result => result.status === 'rejected');
  let error = results[loser].reason;
  // Some Emulator versions close the losing transaction before returning the domain stale-version error.
  // Replay that same request once; the application must still reject its original expected revision.
  if (error.code === 3) {
    console.warn('Emulator concurrent rename: retry original stale command once:', error.message);
    const [retry] = await Promise.allSettled([updateTeamNameFor(commands[loser])]);
    expect(retry.status).toBe('rejected'); error = retry.reason;
  }
  expect(error.code).toBe('aborted'); expect((await audit()).size).toBe(1);
}, 20000);
test('不同隊同時改為同名只有一隊成功', async () => {
  const commands = [request(), request({ operationId: 'rename-2', teamId: 'other', expected: { name: '對手隊', shortName: null, revision: 0 } })];
  const results = await Promise.allSettled(commands.map(command => updateTeamNameFor(command)));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const rejectedIndex = results.findIndex(result => result.status === 'rejected');
  const error = results[rejectedIndex].reason;
  // Emulator lock contention may invalidate the losing transaction with gRPC 3.
  // Re-send the exact original command once, as the management UI does after an
  // unconfirmed result, and still require the domain duplicate-name rejection.
  if (error.code === 3) {
    console.warn('Emulator concurrent rename: retry original rejected command once:', error.message);
    await expect(updateTeamNameFor(commands[rejectedIndex])).rejects.toMatchObject({ code: 'already-exists' });
  } else {
    expect(error.code).toBe('already-exists');
  }
  const teams = await base().collection('teams').get();
  expect(teams.docs.filter(doc => doc.data().name === '新的球隊名稱')).toHaveLength(1);
  expect((await audit()).size).toBe(1);
  expect((await base().collection('managementOperations').get()).size).toBe(1);
}, 20000);
test('更名觸發器重放不改排名、審核或球員人數', async () => {
  await updateTeamNameFor(request());
  const after = (await team().get()).data();
  const event = { params: { eventId: E, teamId: 't' }, data: { before: { data: () => originalTeam }, after: { data: () => after } } };
  await onTeamWritten.run(event); await onTeamWritten.run(event);
  expect((await team().get()).data()).toMatchObject({ name: '新的球隊名稱', status: 'approved', playerCount: 30, rosterLocked: true, nameRevision: 1 });
  expect((await base().collection('divisions').doc('d').get()).data().finalRankingPublished).toBe(true); expect((await audit()).size).toBe(1);
});

test('更名後停用的管理員不能利用舊收據通過權限檢查', async () => {
  await updateTeamNameFor(request()); await db().doc('staff/admin').update({ active: false });
  await expect(updateTeamNameFor(request())).rejects.toMatchObject({ code: 'permission-denied' });
  expect((await audit()).size).toBe(1);
});
test('未變更、不存在的球隊及超過容量都不留下部分修改', async () => {
  await expect(updateTeamNameFor(request({ name: old.name, shortName: old.shortName }))).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(updateTeamNameFor(request({ teamId: 'missing' }))).rejects.toMatchObject({ code: 'not-found' });
  const batch = db().batch();
  for (let i = 0; i < 201; i++) batch.set(base().collection('matches').doc(`large-${i}`), { home: match.home });
  await batch.commit();
  await expect(updateTeamNameFor(request())).rejects.toMatchObject({ code: 'resource-exhausted' });
  expect((await team().get()).data()).toEqual(originalTeam);
  expect((await base().collection('matches').doc('m').get()).data()).toEqual(match);
  expect((await audit()).size).toBe(0); expect((await base().collection('managementOperations').get()).size).toBe(0);
}, 20000);
