import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const BASE = 'events/feda-cup-2026', DATE = '2026-10-09';
const match = (patch = {}) => ({ matchId: 'm', divisionId: 'women', date: DATE, status: 'live',
  kickoffAt: '2026-10-09T12:00:00+08:00', venueName: 'A場', period: 'h2',
  home: { teamId: 'h', name: '主隊' }, away: { teamId: 'a', name: '客隊' },
  score: { home: 2, away: 1 }, ...patch });
async function stub(page, board = false) {
  await page.clock.setFixedTime(new Date('2026-10-09T12:05:00+08:00'));
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ headers: { date: 'Fri, 09 Oct 2026 04:05:00 GMT' }, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());
  const seed = { 'config/env': { env: 'demo' }, [BASE + '/divisions/women']: {
    divisionId: 'women', name: '女子組', schedulePublished: true },
    [BASE + '/matches/m']: match(), [BASE + '/matches/tomorrow']: match({ matchId: 'tomorrow',
      date: '2026-10-10', status: 'scheduled', home: { name: '明日主隊' } }) };
  if (board) seed[BASE + '/boards/live'] = { liveMatches: [match({ score: { home: 0, away: 0 } })], nextMatches: [], justFinished: [] };
  await page.addInitScript(seed => { window.__FAKE_SEED = seed; }, seed);
}
const update = (page, patch) => page.evaluate(({ path, row }) => window.__fake.__seed({ [path]: row }),
  { path: BASE + '/matches/m', row: match(patch) });
const score = page => page.locator('.prow[data-match-id="m"] .prow__nums');
const count = page => page.evaluate(async () => (await import('/js/core/store.js')).count());

test('HOMESTREAM 官方直播在資訊列顯示SVG與文字，無直播不新增元素，來源變更即時更新', async ({ page }) => {
  await stub(page); await page.goto('/#/');
  const card = page.locator('.prow[data-match-id="m"]');
  await expect(score(page)).toHaveText('2-1');
  await expect(card.locator('.prow__stream')).toHaveCount(0);
  await expect(card.locator('.prow__metaText')).toHaveCount(0);
  await update(page, { sharedStreamCount: 1 });
  await expect(card.locator('.prow__stream')).toHaveText('直播');
  await update(page, { sharedStreamCount: 0 });
  await expect(card.locator('.prow__stream')).toHaveCount(0);
  for (const stream of [{ videoId: 'dQw4w9WgXcQ', status: 'live' }, { provider: 'twitch', channelId: 'twitchdev', status: 'live' }]) {
    await update(page, { label: '季軍賽', stream });
    await expect(card.locator('.prow__stream')).toHaveText('直播');
    await expect(card.locator('.prow__stream svg')).toHaveCount(1);
    const boxes = await card.evaluate(n => ['.prow__metaText', '.prow__stream', '.pbadge'].map(s => n.querySelector(s).getBoundingClientRect().toJSON()));
    expect(boxes[0].right).toBeLessThanOrEqual(boxes[1].left);
    expect(boxes[1].right).toBeLessThanOrEqual(boxes[2].left);
    expect(boxes[1].bottom).toBeLessThanOrEqual(boxes[2].bottom + 4);
  }
  await update(page, { stream: { videoId: 'dQw4w9WgXcQ', status: 'off' } });
  await expect(card.locator('.prow__stream')).toHaveCount(0);
  await update(page, { stream: { provider: 'twitch', channelId: 'twitchdev', enabled: false } });
  await expect(card.locator('.prow__stream')).toHaveCount(0);
  await update(page, { venueId: 'A' });
  await page.evaluate(base => window.__fake.__seed({ [base + '/venues/A']: { name: 'A場', order: 1, stream: { provider: 'twitch', channelId: 'twitchdev', status: 'live' } } }), BASE);
  const seeded = await page.evaluate(() => window.__fake.__dump());
  await page.addInitScript(seed => { window.__FAKE_SEED = seed; }, seeded);
  await page.reload(); await expect(card.locator('.prow__stream')).toHaveText('直播');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('HOMEMATCHLIVE 同日舊看板不能蓋過最新場次，停留首頁收到完賽賽果', async ({ page }) => {
  await stub(page, true); await page.goto('/#/');
  await expect(score(page)).toHaveText('2-1');
  await update(page, { status: 'finished', period: 'ft', score: { home: 4, away: 1 }, scoreSubmittedAt: '2026-10-09T12:04:00+08:00' });
  await expect(score(page)).toHaveText('4-1');
  await expect(page.getByRole('heading', { name: '剛結束', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '現在進行中', exact: true })).toHaveCount(0);
});

test('HOMEMATCHPATCH 完賽與更正只刷新比賽欄位，其他節點、分頁及焦點保留', async ({ page }) => {
  await stub(page); await page.goto('/#/');
  await expect(score(page)).toHaveText('2-1');
  const scorerTab = page.getByRole('tablist', { name: '射手榜組別', exact: true }).getByRole('tab', { name: '女子組', exact: true });
  await scorerTab.click();
  await page.evaluate(() => {
    window.__homeNodes = ['.p-homeHero', '.p-homeScorers', '[aria-label="日期"]'].map(s => document.querySelector(s));
    window.__homeRoot = document.querySelector('.p-home');
  });
  await scorerTab.focus();
  await update(page, { status: 'finished', period: 'ft', score: { home: 4, away: 1 }, scoreSubmittedAt: '2026-10-09T12:04:00+08:00' });
  await expect(score(page)).toHaveText('4-1');
  const intact = await page.evaluate(() => window.__homeNodes.every((node, i) => node === document.querySelector(['.p-homeHero', '.p-homeScorers', '[aria-label="日期"]'][i])));
  expect(intact).toBe(true);
  await expect(scorerTab).toHaveAttribute('aria-selected', 'true');
  await expect(scorerTab).toBeFocused();
  await update(page, { status: 'confirmed', period: 'ft', score: { home: 5, away: 2 }, scoreSubmittedAt: '2026-10-09T12:04:00+08:00' });
  await expect(score(page)).toHaveText('5-2');
  expect(await page.evaluate(() => document.querySelector('.p-home') === window.__homeRoot)).toBe(true);
});

test('HOMEMATCHWATCH 篩選、切日期及離開首頁維持單一場次監聽並回收', async ({ page }) => {
  await stub(page); await page.goto('/#/');
  await expect(score(page)).toHaveText('2-1');
  const matchTabs = page.getByRole('tablist', { name: '賽事狀態', exact: true });
  await matchTabs.getByRole('tab', { name: '進行中', exact: true }).click();
  await update(page, { status: 'finished', scoreSubmittedAt: '2026-10-09T12:04:00+08:00' });
  await expect(page.getByText('目前沒有正在進行的場次', { exact: true })).toBeVisible();
  await expect(matchTabs.getByRole('tab', { name: '進行中', exact: true })).toHaveAttribute('aria-selected', 'true');
  await matchTabs.getByRole('tab', { name: '剛結束', exact: true }).click();
  await expect(score(page)).toHaveText('2-1');
  await matchTabs.getByRole('tab', { name: '全部', exact: true }).click();
  await page.getByRole('tablist', { name: '日期', exact: true }).getByRole('tab', { name: /10\/10/ }).click();
  await expect(page.locator('.prow')).toContainText('明日主隊');
  await update(page, { status: 'confirmed', score: { home: 9, away: 9 } });
  await expect(page.locator('.prow')).toContainText('明日主隊');
  await expect(page.locator('.prow[data-match-id="m"]')).toHaveCount(0);
  expect(await count(page)).toBe(1);
  await page.evaluate(() => { location.hash = '#/not-a-page'; });
  await expect.poll(() => count(page)).toBe(0);
});

test('HOMEMATCHRESUME 背景或斷線期間完賽，回前景自動同步最新比分', async ({ page }) => {
  await stub(page); await page.goto('/#/');
  await expect(score(page)).toHaveText('2-1');
  await page.evaluate(() => {
    window.__homeHero = document.querySelector('.p-homeHero');
    window.__fake.__goOffline();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => count(page)).toBe(0);
  await update(page, { status: 'confirmed', score: { home: 5, away: 2 }, scoreSubmittedAt: '2026-10-09T12:04:00+08:00' });
  await expect(score(page)).toHaveText('2-1');
  await page.evaluate(() => {
    window.__fake.__goOnline();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(score(page)).toHaveText('5-2');
  await expect.poll(() => count(page)).toBe(1);
  expect(await page.evaluate(() => window.__homeHero === document.querySelector('.p-homeHero'))).toBe(true);
});
