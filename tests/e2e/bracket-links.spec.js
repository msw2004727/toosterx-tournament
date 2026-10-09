import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const formats = JSON.parse(fs.readFileSync('tests/fixtures/bracket-formats.json', 'utf8'));
const E = 'events/feda-cup-2026';
function seed() {
  const s = { 'config/env': { env: 'demo' }, 'config/formats': { formats },
    [`${E}/divisions/women`]: { divisionId: 'women', name: '女子組', formatId: 'F4_RR_SEMIFINAL', order: 1,
      schedulePublished: true, playersOnField: 5, matchDurationMin: 25 },
    [`${E}/teams/t0`]: { teamId: 't0', divisionId: 'women', name: '圖斯特 粉', status: 'approved' } };
  for (const stage of formats.F4_RR_SEMIFINAL.stages) for (const slot of stage.slots || []) {
    s[`${E}/matches/${slot.matchKey}`] = { matchKey: slot.matchKey, divisionId: 'women', stageId: stage.stageId,
      label: slot.label, status: { SF1: 'scheduled', SF2: 'live', F1: 'finished', F3: 'checkin' }[slot.matchKey],
      date: '2026-10-09', kickoffAt: '2026-10-09T10:00:00+08:00', venueName: 'A場',
      home: { teamId: 't0', name: '圖斯特 粉' }, away: { teamId: 't1', name: '圖斯特 黃' },
      score: { home: 1, away: 0 }, teamIds: ['t0', 't1'] };
  }
  s[`${E}/matches/G1`] = { ...s[`${E}/matches/SF1`], stageId: 'group', matchKey: 'G1', label: '分組賽' };
  return s;
}
async function open(page, s, route) {
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ body: '{}' }));
  await page.addInitScript(data => { window.__FAKE_SEED = data; window.__FAKE_USER = null; }, s);
  await page.goto(route);
  await expect(page.locator('.prow[data-match-id="SF1"]')).toBeVisible();
  const close = page.getByRole('button', { name: '關閉場地配置' });
  if (await close.isVisible()) await close.click();
}
for (const route of ['/#/?date=2026-10-09', '/#/schedule?date=2026-10-09', '/#/division/women?tab=schedule', '/#/team/t0?tab=schedule']) {
  test(`淘汰卡片中央入口與原比賽導頁 ${route} @bracketlink`, async ({ page }, testInfo) => {
    await open(page, seed(), route);
    await expect(page.locator('.prow__bracketLink')).toHaveCount(4);
    await expect(page.locator('.prow[data-match-id="G1"] .prow__bracketLink')).toHaveCount(0);
    await expect(page.locator('button button')).toHaveCount(0);
    const row = page.locator('.prow[data-match-id="SF1"]');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
      const layout = await row.evaluate(n => {
        const row = n.getBoundingClientRect(), link = n.querySelector('.prow__bracketLink').getBoundingClientRect();
        const badge = n.querySelector('.division-badge').getBoundingClientRect();
        return { centered: Math.abs((link.left + link.right - row.left - row.right) / 2) < 2,
          separate: badge.right <= link.left, tap: link.height, fits: document.documentElement.scrollWidth <= innerWidth };
      });
      expect(layout.centered).toBe(true); expect(layout.separate).toBe(true);
      expect(layout.tap).toBeGreaterThanOrEqual(44); expect(layout.fits).toBe(true);
    }
    if (route.startsWith('/#/?')) await page.screenshot({ path: testInfo.outputPath('home-bracket-link.png'), fullPage: true });
    await row.locator('.prow__btn').click();
    await expect(page).toHaveURL(/#\/match\/SF1$/);
    await page.goto(route);
    const close = page.getByRole('button', { name: '關閉場地配置' });
    if (await close.isVisible()) await close.click();
    await page.locator('.prow[data-match-id="SF1"] .prow__bracketLink').click();
    await expect(page).toHaveURL(/#\/division\/women\?tab=bracket$/);
    await expect(page.locator('.pbracket__node')).toHaveCount(7);
  });
}
test('缺少賽制時保留卡片與場次導頁，不猜測入口 @bracketlinkmissing', async ({ page }) => {
  const s = seed(); delete s['config/formats'];
  await open(page, s, '/#/division/women?tab=schedule');
  await expect(page.locator('.prow__bracketLink')).toHaveCount(0);
  await page.locator('.prow[data-match-id="SF1"] .prow__btn').click();
  await expect(page).toHaveURL(/#\/match\/SF1$/);
});
