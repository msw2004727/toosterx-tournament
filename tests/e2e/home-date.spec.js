import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const BASE = 'events/feda-cup-2026';
async function stub(page, instant) {
  await page.clock.setFixedTime(new Date(instant));
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ headers: { date: new Date(instant).toUTCString() }, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());
  const docs = { 'config/env': { env: 'demo' }, [BASE + '/divisions/d']: { divisionId: 'd', name: '測試組', schedulePublished: true } };
  for (const day of ['09', '10', '11']) docs[BASE + '/matches/m' + day] = { matchId: 'm' + day, divisionId: 'd', date: '2026-10-' + day,
    status: 'scheduled', kickoffAt: { seconds: Date.parse('2026-10-' + day + 'T12:00:00+08:00') / 1000 }, venueName: 'A場',
    home: { name: '第' + day + '日主隊' }, away: { name: '客隊' }, score: { home: 0, away: 0 } };
  await page.addInitScript(docs => { window.__FAKE_SEED = docs; }, docs);
}
const selected = page => page.getByRole('tablist', { name: '日期', exact: true }).getByRole('tab', { selected: true });
for (const [instant, day] of [['2026-10-05T12:00:00+08:00', '9'], ['2026-10-10T00:00:00+08:00', '10'],
  ['2026-10-11T00:00:00+08:00', '11'], ['2026-10-12T00:00:00+08:00', '11']]) {
  test('HOMEDATE 首頁依台北時間自選日期：' + instant, async ({ page }) => {
    await stub(page, instant); await page.goto('/#/');
    await expect(selected(page)).toContainText('10/' + day);
    await expect(page.locator('.prow')).toContainText('第' + day.padStart(2, '0') + '日主隊');
  });
}
test('HOMEROLLOVER 首頁跨日自動選日期及重讀單日場次，手動查看可維持到下一個活動日', async ({ page }) => {
  await stub(page, '2026-10-09T23:59:59+08:00'); await page.goto('/#/');
  await expect(selected(page)).toContainText('10/9');
  await page.evaluate(async () => { const { setActivityTimeSource } = await import('/js/core/activity-clock.js'); setActivityTimeSource(() => Date.parse('2026-10-10T00:00:00+08:00')); });
  await expect(selected(page)).toContainText('10/10');
  await expect(page.locator('.prow')).toContainText('第10日主隊');
  await expect(page.locator('.prow')).not.toContainText('第09日主隊');
  await page.getByRole('tablist', { name: '日期', exact: true }).getByRole('tab', { name: /10\/9/ }).click();
  await expect(selected(page)).toContainText('10/9');
  await expect(page.locator('.prow')).toContainText('第09日主隊');
  await page.evaluate(async () => { const { setActivityTimeSource } = await import('/js/core/activity-clock.js'); setActivityTimeSource(() => Date.parse('2026-10-11T00:00:00+08:00')); });
  await expect(selected(page)).toContainText('10/11');
  await expect(page.locator('.prow')).toContainText('第11日主隊');
});
test('首頁無效網址日期也落在當日，活動後保留最後一天', async ({ page }) => {
  await stub(page, '2026-10-12T00:00:00+08:00'); await page.goto('/#/?date=2026-09-30');
  await expect(selected(page)).toContainText('10/11');
});

for (const date of ['2026-10-10', null]) {
  test('HOMEBOARDDATE 看板其他日期或缺日期改讀當日場次：' + date, async ({ page }) => {
    await stub(page, '2026-10-11T00:00:00+08:00');
    await page.addInitScript(date => { window.__FAKE_SEED['events/feda-cup-2026/boards/live'] = { liveMatches: [{
      matchId: 'old-board', divisionId: 'd', ...(date ? { date } : {}), status: 'live', score: { home: 0, away: 0 },
      home: { name: '過期看板主隊' }, away: { name: '過期客隊' } }], nextMatches: [], justFinished: [] }; }, date);
    await page.goto('/#/');
    await expect(selected(page)).toContainText('10/11');
    await expect(page.locator('.prow')).toContainText('第11日主隊');
    await expect(page.getByText('過期看板主隊', { exact: true })).toHaveCount(0);
  });
}
