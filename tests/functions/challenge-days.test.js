import { db } from '../../functions/admin.js';
import { updateChallengeDayFor, dailyDrawExportFor } from '../../functions/challenge-days.js';
import { onAttemptSubmitted } from '../../functions/pipeline.js';

const eventId = 'daily-test', dates = ['2026-10-09', '2026-10-10', '2026-10-11'];
const base = () => db().doc(`events/${eventId}`);
const attempt = (id, challengeId, date, playerId = 'p1') => base().collection('attempts').doc(id).set({
  attemptId: id, challengeId, playerId, rawValue: 0, recordedAtMs: Date.parse(`${date}T12:00:00+08:00`), createdAt: Date.parse(`${dates[2]}T12:00:00+08:00`)
});
beforeEach(async () => {
  await db().recursiveDelete(base());
  await db().doc('config/challengeRewards').set({ rule: 'dailyChallengesCompleted', dates, timeZone: 'Asia/Taipei', version: 'daily-test' });
  await db().doc('staff/daily-admin').set({ active: true, roles: ['admin'] });
  await db().doc('staff/daily-booth').set({ active: true, roles: ['booth'], assignment: { eventId, challengeIds: ['a'] } });
  for (const id of ['a', 'b', 'c', 'd']) await base().collection('challenges').doc(id).set({
    challengeId: id, name: id, minValue: 0, maxValue: 5, dailyOpen: { [dates[0]]: true, [dates[1]]: id !== 'd', [dates[2]]: false }
  });
  for (const playerId of ['p1', 'p2']) await base().collection('players').doc(playerId).set({ playerId, nickname: playerId, luckyDrawEntries: 0, completedChallengeIds: [] });
});
const exportDay = date => dailyDrawExportFor({ eventId, date, actorUid: 'daily-admin' });
const toggle = (over = {}) => updateChallengeDayFor({ eventId, challengeId: 'a', date: dates[1], open: false, expectedOpen: true, actorUid: 'daily-booth', ...over });

test('完成今日三攤立即進名單，即使背景資格尚未更新；跨日、重複與作廢正確', async () => {
  await Promise.all(['a', 'b', 'c'].map(id => attempt(id, id, dates[1])));
  await attempt('duplicate', 'a', dates[1]);
  await attempt('p2-a', 'a', dates[1], 'p2'); await attempt('p2-b', 'b', dates[1], 'p2');
  await attempt('p2-c-old', 'c', dates[0], 'p2');
  expect(await exportDay(dates[1])).toMatchObject({ date: dates[1], requiredCount: 3, rows: [{ playerId: 'p1', date: dates[1], entries: 1, completedCount: 3 }] });
  expect((await exportDay(dates[0])).rows).toEqual([]);
  expect((await exportDay(dates[2])).rows).toEqual([]);
  await base().collection('attempts').doc('c').update({ voided: true });
  expect((await exportDay(dates[1])).rows).toEqual([]);
});
test('完成與統計交易重放冪等，0 分計入；離線跨日補送不改日期', async () => {
  await Promise.all(['a', 'b', 'c'].map(id => attempt(id, id, dates[1])));
  await onAttemptSubmitted({ eventId, challengeId: 'a', playerId: 'p1' });
  await onAttemptSubmitted({ eventId, challengeId: 'a', playerId: 'p1' });
  const p = (await base().collection('players').doc('p1').get()).data();
  expect(p.challengeDays[dates[1]]).toMatchObject({ entries: 1, completedChallengeIds: ['a', 'b', 'c'] });
  expect(p.luckyDrawEntries).toBe(1);
  const c = (await base().collection('challenges').doc('a').get()).data();
  expect(c.stats.dailyPlayers).toEqual({ [dates[0]]: 0, [dates[1]]: 1, [dates[2]]: 0 });
});
test('指派攤位能設定自己的每日開放，其他攤位、活動、日期及停用帳號遭拒', async () => {
  await expect(toggle({ challengeId: 'b' })).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(toggle({ eventId: 'other' })).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(toggle({ date: '2026-10-12' })).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(await toggle()).toMatchObject({ changed: true, open: false });
  await expect(toggle()).rejects.toMatchObject({ code: 'aborted' });
  expect((await base().collection('audits').get()).size).toBe(1);
  await db().doc('staff/daily-booth').update({ active: false });
  await expect(toggle()).rejects.toMatchObject({ code: 'permission-denied' });
});
test('調整開放攤位即時改變日期名單，不會等背景同步；未授權者不可匯出', async () => {
  await attempt('a', 'a', dates[1]); await attempt('b', 'b', dates[1]);
  expect((await exportDay(dates[1])).rows).toEqual([]);
  await toggle({ challengeId: 'c', actorUid: 'daily-admin' });
  expect((await exportDay(dates[1])).rows).toMatchObject([{ playerId: 'p1', entries: 1, requiredCount: 2 }]);
  await expect(dailyDrawExportFor({ eventId, date: dates[1], actorUid: 'daily-booth' })).rejects.toMatchObject({ code: 'permission-denied' });
});
