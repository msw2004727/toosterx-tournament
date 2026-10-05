import { activityDate, selectedActivityDate, dailyProgress, dailyQualification, dailyStats, attemptDate, dailyRewardSettings } from '../../js/engine/challenge-days.js';
import { buildSeed } from '../../scripts/seed/build.js';
import { buildAttempt } from '../../js/modules/booth/actions.js';

const dates = ['2026-10-09', '2026-10-10', '2026-10-11'];
const ms = (date, time = '10:00') => Date.parse(`${date}T${time}:00+08:00`);
const challenges = ['a', 'b', 'c', 'd'].map(challengeId => ({ challengeId, minValue: 0, maxValue: 5,
  dailyOpen: { [dates[0]]: true, [dates[1]]: challengeId !== 'd', [dates[2]]: false } }));
const attempts = (date, ids = ['a', 'b', 'c']) => ids.map(challengeId => ({ challengeId, playerId: 'p', rawValue: 0, recordedAtMs: ms(date) }));
const progress = (a, date = dates[1], cs = challenges) => dailyProgress({ attempts: a, challenges: cs, date });

test('日界窗口與日期一致，Demo 重建仍保留每日功能，無效日期不發布', () => {
  const settings = dailyRewardSettings(dates);
  expect(settings.dayWindows[dates[1]].startMs).toBe(ms(dates[1], '00:00'));
  expect(settings.dayWindows[dates[1]].endMs).toBe(ms(dates[2], '00:00'));
  expect(() => dailyRewardSettings(['2026-02-30'])).toThrow();
  const seed = buildSeed({ dailyChallenges: true }).docs;
  expect(seed.find(d => d.path === 'config/challengeRewards').data).toEqual(settings);
  expect(seed.filter(d => d.path.includes('/challenges/')).every(d => dates.every(date => d.data.dailyOpen[date]))).toBe(true);
});

test('台北換日的前一毫秒與當下分屬不同日，與手機時區無關', () => {
  expect(activityDate(ms(dates[1], '00:00') - 1)).toBe(dates[0]);
  expect(activityDate(ms(dates[1], '00:00'))).toBe(dates[1]);
  expect(activityDate(null)).toBeNull();
});
test.each([['2026-10-01', dates[0]], [dates[0], dates[0]], [dates[1], dates[1]], [dates[2], dates[2]], ['2026-10-15', dates[2]]])('自動頁籤 %s → %s', (date, expected) => {
  expect(selectedActivityDate(ms(date), dates)).toBe(expected);
});
test('10/10 三個開放攤位完成就取得單日一張，關閉的第四攤不用完成', () => {
  expect(progress(attempts(dates[1]))).toMatchObject({ total: 3, done: ['a', 'b', 'c'], allComplete: true, entries: 1 });
});
test('不能用前一天的關卡湊今天，無法以不相干的代號湊數', () => {
  const p = progress([...attempts(dates[0], ['c']), ...attempts(dates[1], ['a', 'b', 'unknown'])]);
  expect(p).toMatchObject({ done: ['a', 'b'], missing: ['c'], entries: 0 });
});
test('重複登錄不加券，作廢最後一筆就撤銷資格；另一筆有效則保留', () => {
  const a = [...attempts(dates[1]), ...attempts(dates[1], ['c'])];
  expect(progress(a).entries).toBe(1);
  a[2].voided = true;
  expect(progress(a).entries).toBe(1);
  a[3].voided = true;
  expect(progress(a).entries).toBe(0);
});
test('三天獨立結算，全部關閉不發券；離線跨日補送保留原始參與日', () => {
  const a = attempts(dates[1]).map(a => ({ ...a, createdAt: ms(dates[2]) }));
  expect(attemptDate(a[0])).toBe(dates[1]);
  const daily = dailyQualification(a, challenges, { dates });
  expect(daily[dates[0]].entries).toBe(0);
  expect(daily[dates[1]].entries).toBe(1);
  expect(daily[dates[2]]).toMatchObject({ entries: 0, total: 0, allComplete: false });
});
test('每日統計為完成的唯一玩家數，0 分有效、無值與未達簽到門檻無效', () => {
  const c = challenges[0];
  const a = [...attempts(dates[1], ['a', 'a']), ...attempts(dates[0], ['a']),
    { ...attempts(dates[1], ['a'])[0], playerId: 'p2', rawValue: null },
    { ...attempts(dates[1], ['a'])[0], playerId: 'p3', voided: true }];
  expect(dailyStats(a, c, dates)).toEqual({ [dates[0]]: 1, [dates[1]]: 1, [dates[2]]: 0 });
  expect(progress(attempts(dates[1], ['a']), dates[1], [{ ...c, completionMinValue: 1 }]).entries).toBe(0);
});
test('舊紀錄沒有 recordedAtMs 時採伺服器時間，未知日期不猜今天', () => {
  expect(attemptDate({ createdAt: ms(dates[0]) })).toBe(dates[0]);
  expect(attemptDate({})).toBeNull();
});
test('伺服器校時有半毫秒差時仍送出整數時間與正確的台北活動日期', () => {
  const payload = buildAttempt({ challenge: challenges[0], playerId: 'p', staffUid: 'u', rawValue: 0, atMs: ms(dates[1]) + .5 });
  expect(payload.doc.recordedAtMs).toBe(ms(dates[1]));
  expect(payload.doc.activityDate).toBe(dates[1]);
});
