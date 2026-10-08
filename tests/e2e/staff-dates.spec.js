import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const E = 'feda-cup-2026', UID = 'operator';
function seed({ roles = ['staff'], active = true, venues = ['a'] } = {}) {
  const docs = { 'config/env': { env: 'demo' }, [`events/${E}`]: { eventId: E },
    [`staff/${UID}`]: { uid: UID, name: '值班賽務員', roles, active, assignment: { eventId: E, date: '2026-10-11', venueIds: venues, divisionIds: [] } },
    [`events/${E}/venues/a`]: { venueId: 'a', name: 'A場', order: 1 },
    [`events/${E}/divisions/d`]: { divisionId: 'd', name: '測試組', playersOnField: 5, matchDurationMin: 30, periods: 2 } };
  for (const day of ['09', '10', '11']) for (const venueId of ['a', 'b']) {
    const id = `${day}-${venueId}`;
    docs[`events/${E}/matches/${id}`] = { matchId: id, label: `${day}日${venueId}場`, date: `2026-10-${day}`, divisionId: 'd', venueId,
      kickoffAt: `2026-10-${day}T10:00:00+08:00`, home: { teamId: 'h', name: '主隊' }, away: { teamId: 'v', name: '客隊' },
      status: 'scheduled', period: 'pre', score: { home: 0, away: 0 }, lock: { locked: false }, clock: { running: false } };
  }
  return docs;
}
async function boot(page, time = '2026-10-09T12:00:00+08:00', options = {}, hash = '/#/staff') {
  await page.clock.install({ time: new Date(time) });
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ status: 200, headers: { date: new Date(time).toUTCString() }, body: '{}' }));
  await page.addInitScript(({ docs, uid }) => { window.__FAKE_SEED = docs; window.__FAKE_USER = { uid, displayName: '值班賽務員' }; }, { docs: seed(options), uid: UID });
  await page.goto(hash);
}
const tab = (page, day) => page.getByRole('tab', { name: `10/${day}`, exact: true });
const rows = page => page.locator('.mlist__btn');
for (const [time, day] of [['2026-10-08T12:00:00+08:00', 9], ['2026-10-10T12:00:00+08:00', 10], ['2026-10-12T12:00:00+08:00', 11]]) {
  test(`STAFF-DATE ${time} defaults to 10/${day} despite legacy assignment date @staff`, async ({ page }) => {
    await boot(page, time);
    await expect(tab(page, day)).toHaveAttribute('aria-selected', 'true');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText(`${String(day).padStart(2, '0')}日a場`);
    await expect(rows(page)).not.toContainText('b場');
  });
}
test('STAFF-MIDNIGHT automatic view switches without refresh and cleans old subscriptions @staff', async ({ page }) => {
  await boot(page, '2026-10-09T23:59:59+08:00');
  await expect(tab(page, 9)).toHaveAttribute('aria-selected', 'true');
  await page.clock.fastForward(2500);
  await expect(tab(page, 10)).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page)).toContainText('10日a場');
  const listeners = await page.evaluate(async () => (await import('/js/core/store.js')).describe().flatMap(s => s.labels).filter(label => label.startsWith('myMatches:')));
  expect(listeners).toEqual(['myMatches:2026-10-10']);
  await page.evaluate(() => { location.hash = '#/'; });
  await expect.poll(() => page.evaluate(async () => (await import('/js/core/store.js')).describe().flatMap(s => s.labels).filter(label => label.startsWith('myMatches:')))).toEqual([]);
});
test('STAFF-MANUAL manual date stays pinned across midnight and LIVE; follow-today resumes auto @staff', async ({ page }) => {
  await boot(page, '2026-10-09T23:59:59+08:00');
  await tab(page, 11).click();
  await expect(rows(page)).toContainText('11日a場');
  await page.clock.fastForward(2500);
  await expect(tab(page, 11)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: '跟隨今日（10/10）', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '進入賽務台' }).click();
  await expect(page.getByRole('button', { name: '開賽', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(tab(page, 11)).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: /跟隨今日/ }).click();
  await expect(tab(page, 10)).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page)).toContainText('10日a場');
  await page.reload();
  await expect(tab(page, 10)).toHaveAttribute('aria-selected', 'true');
});
test('STAFF-AUTH assigned staff has operations without admin functions; suspended identity has no controls @staff', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { location.hash = '#/my'; });
  await expect(page.getByRole('button', { name: /^賽務台/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^身分授權|^管理球隊|^賽程管理/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^賽務台/ }).click();
  await page.evaluate(() => { const d = window.__fake.__dump()['staff/operator']; window.__fake.__seed({ 'staff/operator': { ...d, active: false } }); });
  await page.getByRole('button', { name: '更新權限', exact: true }).click();
  await expect(page.getByText('沒有賽務台權限', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '進入賽務台' })).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/staff/match/09-a'; });
  await expect(page.getByText('沒有賽務台權限', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '開賽', exact: true })).toHaveCount(0);
});
test('STAFF-ADMIN admin sees all venues even with an old assignment; date tabs fit narrow screens @staff', async ({ page }) => {
  await boot(page, undefined, { roles: ['admin'] });
  await expect(rows(page)).toHaveCount(2);
  await tab(page, 10).click();
  await expect(rows(page)).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('STAFF-REFRESH user assigned after login gains the console from My without signing out @staff', async ({ page }) => {
  await boot(page, undefined, { roles: ['user'] }, '/#/my');
  await expect(page.getByRole('button', { name: '更新權限', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^賽務台/ })).toHaveCount(0);
  await page.evaluate(() => { const d = window.__fake.__dump()['staff/operator']; window.__fake.__seed({ 'staff/operator': { ...d, roles: ['staff'] } }); });
  await page.getByRole('button', { name: '更新權限', exact: true }).click();
  await expect(page.getByRole('button', { name: /^賽務台/ })).toBeVisible();
  await page.getByRole('button', { name: /^賽務台/ }).click();
  await expect(rows(page)).toHaveCount(1);
});
