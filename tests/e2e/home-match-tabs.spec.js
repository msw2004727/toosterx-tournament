import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const root = 'events/feda-cup-2026';
const time = new Date('2026-10-09T12:00:00+08:00');
const fixture = (id, status, date = '2026-10-09') => ({
  matchId: id, divisionId: 'women', date, status, period: status === 'finished' ? 'ft' : 'h1',
  kickoffAt: `${date}T11:30:00+08:00`, scoreSubmittedAt: status === 'finished' ? `${date}T11:50:00+08:00` : null,
  venueId: 'a', venueName: 'A場', label: '分組賽', teamIds: ['home', 'away'],
  home: { teamId: 'home', name: '主隊' }, away: { teamId: 'away', name: '客隊' },
  score: { home: 2, away: 1 }, clock: { running: false, elapsedSecAtPause: 23 * 60 }
});

async function setup(page, theme = 'light') {
  await page.clock.install({ time });
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ headers: { date: time.toUTCString() }, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());
  await page.addInitScript(({ seed, theme }) => {
    window.__FAKE_SEED = seed; window.__FAKE_USER = null; localStorage.setItem('feda_theme', theme);
  }, { theme, seed: {
    'config/env': { env: 'demo' }, [`${root}/divisions/women`]: { divisionId: 'women', name: '女子組', periods: 1, matchDurationMin: 25, schedulePublished: true },
    [`${root}/matches/live`]: fixture('live', 'live'), [`${root}/matches/next`]: fixture('next', 'scheduled'),
    [`${root}/matches/done`]: fixture('done', 'finished'), [`${root}/matches/day2`]: fixture('day2', 'scheduled', '2026-10-10')
  } });
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '賽事狀態' })).toBeVisible();
  const close = page.getByRole('button', { name: '關閉', exact: true });
  if (await close.count()) await close.click();
}
const tabs = page => page.getByRole('tablist', { name: '賽事狀態' });
const panel = page => page.locator('#home-matches');

test('首頁四頁籤依狀態切換，日期與即時比分更新保留所選頁籤', async ({ page }) => {
  await setup(page);
  await expect(tabs(page).getByRole('tab')).toHaveCount(4);
  await expect(tabs(page).getByRole('tab', { name: '全部', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).locator('.prow')).toHaveCount(3);
  for (const [name, id] of [['進行中', 'live'], ['接下來', 'next'], ['剛結束', 'done']]) {
    await tabs(page).getByRole('tab', { name, exact: true }).click();
    await expect(panel(page).locator('.prow')).toHaveCount(1);
    await expect(panel(page).locator('.prow')).toHaveAttribute('data-match-id', id);
  }
  await tabs(page).getByRole('tab', { name: '進行中', exact: true }).click();
  await page.evaluate(({ root, match }) => window.__fake.__seed({ [`${root}/matches/live`]: { ...match, score: { home: 3, away: 1 } } }), { root, match: fixture('live', 'live') });
  await expect(tabs(page).getByRole('tab', { name: '進行中', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).locator('.prow__num').first()).toHaveText('3');
  await page.clock.runFor(1200);
  await expect(panel(page).locator('.pbadge__text')).toHaveText("23'");
  await tabs(page).getByRole('tab', { name: '接下來', exact: true }).click();
  await page.getByRole('tablist', { name: '日期', exact: true }).getByRole('tab').nth(1).click();
  await expect(panel(page).locator('.prow')).toHaveAttribute('data-match-id', 'day2');
  await expect(tabs(page).getByRole('tab', { name: '接下來', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('選擇空分類有清楚提示，支援鍵盤切換並可返回全部', async ({ page }) => {
  await setup(page);
  await page.evaluate(root => window.__fake.__seed({ [`${root}/matches/live`]: { ...window.__fake.__dump()[`${root}/matches/live`], status: 'finished', period: 'ft' } }), root);
  await tabs(page).getByRole('tab', { name: '進行中', exact: true }).click();
  await expect(panel(page)).toContainText('目前沒有正在進行的場次');
  await expect(panel(page).locator('.prow')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(tabs(page).getByRole('tab', { name: '接下來', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(tabs(page).getByRole('tab', { name: '剛結束', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tabs(page).getByRole('tab', { name: '全部', exact: true })).toBeFocused();
  await expect(panel(page).locator('.prow')).toHaveCount(3);
});

for (const theme of ['light', 'dark']) test(`首頁卡片緊湊、完整長隊名與320px四個頁籤 ${theme}`, async ({ page }) => {
  await setup(page, theme);
  await page.setViewportSize({ width: 320, height: 720 });
  const tabBounds = await tabs(page).getByRole('tab').evaluateAll(nodes => nodes.map(n => ({ y: n.getBoundingClientRect().y, height: n.getBoundingClientRect().height, width: n.clientWidth, scroll: n.scrollWidth })));
  expect(new Set(tabBounds.map(b => b.y)).size).toBe(1);
  expect(tabBounds.every(b => b.height >= 44 && b.scroll <= b.width + 1)).toBe(true);
  expect((await panel(page).locator('.prow').first().boundingBox()).height).toBeLessThanOrEqual(100);
  const longName = '名稱很長也需要完整呈現的足球隊';
  await page.evaluate(({ root, match, longName }) => window.__fake.__seed({ [`${root}/matches/live`]: { ...match, home: { teamId: 'home', name: longName } } }), { root, match: fixture('live', 'live'), longName });
  const team = panel(page).locator('.prow[data-match-id="live"] .prow__team').first();
  await expect(team).toHaveText(longName);
  expect(await team.evaluate(n => n.scrollWidth <= n.clientWidth + 1 && n.scrollHeight <= n.clientHeight + 1)).toBe(true);
  expect((await panel(page).locator('.prow').first().boundingBox()).height).toBeLessThanOrEqual(140);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await tabs(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `tools/home-match-tabs-${theme}-${test.info().project.name}.png` });
});
