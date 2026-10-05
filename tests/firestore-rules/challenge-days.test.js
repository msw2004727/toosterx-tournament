import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { makeEnv, seedBaseline, authed, EVENT, CHALLENGE } from './helpers.js';
import { activityDate } from '../../js/engine/challenge-days.js';

let env;
const now = Date.now(), today = activityDate(now), yesterday = activityDate(now - 86400000), older = activityDate(now - 864000000);
const windowOf = date => ({ startMs: Date.parse(`${date}T00:00:00+08:00`), endMs: Date.parse(`${date}T00:00:00+08:00`) + 86400000 });
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore(); await seedBaseline(env);
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'config', 'challengeRewards'), { rule: 'dailyChallengesCompleted', dates: [older, yesterday, today],
      dayWindows: { [older]: windowOf(older), [yesterday]: windowOf(yesterday), [today]: windowOf(today) } });
    await updateDoc(doc(ctx.firestore(), 'events', EVENT, 'challenges', CHALLENGE), { dailyOpen: { [today]: true, [yesterday]: true, [older]: true } });
  });
});
const attempt = (over = {}) => ({ eventId: EVENT, challengeId: CHALLENGE, playerId: 'FEDA-0182', rawValue: 0,
  staffUid: 'u-booth', createdAt: serverTimestamp(), recordedAtMs: now, activityDate: today, ...over });
const submit = (id, over) => setDoc(doc(authed(env, 'u-booth'), 'events', EVENT, 'attempts', id), attempt(over));
test('已開放日可登錄；離線跨日補送保留原日且有效', async () => {
  await assertSucceeds(submit('today'));
  await assertSucceeds(submit('offline-yesterday', { recordedAtMs: now - 86400000, activityDate: yesterday }));
  await assertSucceeds(submit('late-offline', { recordedAtMs: now - 864000000, activityDate: older }));
});
test('日期偽造、未到日期、漏日期與整數時間以外皆拒絕', async () => {
  await assertFails(submit('wrong-day', { activityDate: yesterday }));
  await assertFails(submit('future', { recordedAtMs: now + 3600000 }));
  await assertFails(submit('no-date', { activityDate: '' }));
  await assertFails(submit('no-time', { recordedAtMs: null }));
});
test('未開放日不可寫入；攤位不能直接改每日開放或玩家日期資格', async () => {
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'events', EVENT, 'challenges', CHALLENGE), { dailyOpen: { [today]: false } }));
  await assertFails(submit('closed'));
  await assertFails(updateDoc(doc(authed(env, 'u-booth'), 'events', EVENT, 'challenges', CHALLENGE), { dailyOpen: { [today]: true } }));
  await assertFails(setDoc(doc(authed(env, 'u-booth'), 'events', EVENT, 'players', 'forged'), { playerId: 'forged', challengeDays: { [today]: { entries: 1 } } }));
});
