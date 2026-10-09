import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const fake = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const start = Date.parse('2026-10-09T12:00:00+08:00');
async function setup(page, { theme = 'light', error = false, time = start } = {}) {
  await page.clock.install({ time: new Date(time) });
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: fake }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ headers: { date: new Date(time).toUTCString() }, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());
  await page.addInitScript(({ theme, error, time, start }) => {
    localStorage.setItem('feda_theme', theme); localStorage.setItem('feda:venue-map-autoHidden', 'true');
    window.__FAKE_USER = null; window.__FAKE_SEED = { 'config/env': { env: 'demo' } };
    window.__FAKE_METRICS_ERROR = error;
    window.__FAKE_METRICS_RESULT = { realOnline: 12, realViews: 345, serverNowMs: time, shareStartedAtMs: start };
  }, { theme, error, time, start });
  await page.goto('/');
}
const metrics = page => page.locator('.p-homeMetrics');
test('centered actual online and cumulative views +33, with details available in tooltips', async ({ page }) => {
  await setup(page);
  await expect(metrics(page).locator('dt')).toHaveText(['即時在線','累計瀏覽','分享數']);
  await expect(metrics(page).locator('dd')).toHaveText(['45','378','33']);
  await expect(metrics(page)).not.toContainText('含活動加成');
  await expect(metrics(page).locator('[data-metric="shares"]')).toHaveAttribute('title', /非實際社群分享次數/);
  const calls = await page.evaluate(() => window.__FAKE_METRICS_CALLS);
  expect(calls[0]).toMatchObject({ eventId: 'feda-cup-2026', visible: true, sequence: 1 });
  expect(calls[0]).not.toHaveProperty('realViews');
});
test('repainting home filters does not create new visits; heartbeat uses the same visit identifier', async ({ page }) => {
  await setup(page);
  await page.getByRole('tab', { name: '接下來', exact: true }).click();
  await page.getByRole('tab', { name: '剛結束', exact: true }).click();
  expect(await page.evaluate(() => window.__FAKE_METRICS_CALLS.length)).toBe(1);
  await page.clock.runFor(30001);
  await expect.poll(() => page.evaluate(() => window.__FAKE_METRICS_CALLS.length)).toBe(2);
  const calls = await page.evaluate(() => window.__FAKE_METRICS_CALLS);
  expect(calls[0].visitId).toBe(calls[1].visitId); expect(calls[1].sequence).toBe(2);
});
test('refresh keeps the browser identity and scheduled start, but creates a new genuine page visit', async ({ page }) => {
  await setup(page);
  await expect(metrics(page).locator('[data-metric="shares"]')).toHaveText('33');
  const first = await page.evaluate(() => window.__FAKE_METRICS_CALLS[0]);
  await page.reload(); await expect(metrics(page).locator('[data-metric="shares"]')).toHaveText('33');
  const second = await page.evaluate(() => window.__FAKE_METRICS_CALLS[0]);
  expect(second.visitorId).toBe(first.visitorId); expect(second.visitId).not.toBe(first.visitId);
});
test('shares tick at ten minutes and freeze at Taipei midnight, including later visits', async ({ page }) => {
  await setup(page, { time: Date.parse('2026-10-11T23:59:59+08:00') });
  await expect(metrics(page).locator('[data-metric="shares"]')).toHaveText('2,187');
  await page.clock.runFor(1100); await expect(metrics(page).locator('[data-metric="shares"]')).toHaveText('2,193');
  await page.clock.runFor(600001); await expect(metrics(page).locator('[data-metric="shares"]')).toHaveText('2,193');
});
test('failure never invents real traffic; reconnect recovers, offline online count becomes unknown', async ({ page }) => {
  await setup(page, { error: true }); await expect(metrics(page).locator('dd')).toHaveText(['—','—','—']);
  await page.evaluate(() => { window.__FAKE_METRICS_ERROR = false; window.dispatchEvent(new Event('online')); });
  await expect(metrics(page).locator('dd')).toHaveText(['45','378','33']);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(metrics(page).locator('[data-metric="online"]')).toHaveText('—');
  await expect(metrics(page)).toHaveAttribute('data-state','stale');
});
test('route cleanup stops heartbeats and reports departure, leaving other routes unchanged', async ({ page }) => {
  await setup(page); await expect(metrics(page)).toHaveAttribute('data-state','ready');
  await page.evaluate(() => { location.hash = '#/stats'; });
  await expect(metrics(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__FAKE_METRICS_CALLS.at(-1).visible)).toBe(false);
  const count = await page.evaluate(() => window.__FAKE_METRICS_CALLS.length);
  await page.clock.runFor(60001); expect(await page.evaluate(() => window.__FAKE_METRICS_CALLS.length)).toBe(count);
});
for (const theme of ['light', 'dark']) for (const width of [320, 480, 739, 1280]) {
  test(`hero counters centered below venue with light background at ${width}px ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 }); await setup(page, { theme });
    await expect(metrics(page)).toHaveAttribute('data-state', 'ready');
    const boxes = await page.evaluate(() => {
      const hero = document.querySelector('.p-homeHero').getBoundingClientRect();
      const metric = document.querySelector('.p-homeMetrics').getBoundingClientRect();
      const venue = document.querySelector('.p-homeHero__meta').getBoundingClientRect();
      const style = getComputedStyle(document.querySelector('.p-homeMetrics'));
      const textBoxes = [...document.querySelectorAll('.p-homeHero__copy p,.p-homeHero__copy h1')].map(node => {
        const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect();
      });
      return { contained: metric.left >= hero.left && metric.right <= hero.right && metric.bottom <= hero.bottom,
        centered: Math.abs((metric.left + metric.right - hero.left - hero.right) / 2) < 1,
        belowVenue: metric.top >= venue.bottom + 9,
        background: style.backgroundColor, color: style.color,
        overlap: textBoxes.some(copy => metric.left < copy.right && metric.right > copy.left && metric.top < copy.bottom && metric.bottom > copy.top),
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(boxes).toEqual({ contained: true, centered: true, belowVenue: true,
      background: 'rgb(234, 244, 238)', color: 'rgb(16, 91, 59)', overlap: false, overflow: false });
    await page.locator('.p-homeHero').screenshot({ path: info.outputPath(`metrics-${width}-${theme}.png`) });
  });
}
