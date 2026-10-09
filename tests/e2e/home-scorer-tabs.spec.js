import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const root = 'events/feda-cup-2026';
const rows = [
  ['women', '女子甲', 5], ['women', '女子乙', 3], ['women', '女子丙', 2],
  ['adult-fun', '興趣甲', 7], ['adult-open', '公開甲', 9], ['adult-open', '公開乙', 4],
  ['u6', 'U6球員', 30], ['u8', 'U8球員', 40], ['u10', 'U10球員', 50]
].map(([divisionId, name, goals], i) => ({ divisionId, name, goals, playerId: `p-${i}`, teamId: `team-${i}`, teamName: `${name}隊` }));

async function setup(page, { theme = 'light', emptyFun = false } = {}) {
  const time = new Date('2026-10-09T12:00:00+08:00');
  await page.clock.install({ time });
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ headers: { date: time.toUTCString() }, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());
  const seed = { 'config/env': { env: 'demo' }, 'config/featureFlags': { youthScorerBoard: true },
    [`${root}/boards/scorers`]: { boardId: 'scorers', rows: rows.filter(r => !emptyFun || r.divisionId !== 'adult-fun') } };
  for (const r of rows) {
    seed[`${root}/divisions/${r.divisionId}`] = { divisionId: r.divisionId, name: r.divisionId, display: { scorerBoard: true } };
    seed[`${root}/teams/${r.teamId}`] = { teamId: r.teamId, divisionId: r.divisionId, name: r.teamName };
  }
  await page.addInitScript(({ seed, theme }) => { window.__FAKE_SEED = seed; window.__FAKE_USER = null; localStorage.setItem('feda_theme', theme); }, { seed, theme });
  await page.goto('/');
  await expect(page.locator('#home-scorers .ptop__name').first()).toBeVisible();
}
const tabs = page => page.getByRole('tablist', { name: '射手榜組別' });
const names = page => page.locator('#home-scorers .ptop__name');

test('首頁射手榜四頁籤各自前三名，兒童高進球也排除，日期切換保留選擇', async ({ page }) => {
  await setup(page);
  await expect(tabs(page).getByRole('tab')).toHaveText(['全部', '女子組', '興趣組', '公開組']);
  await expect(names(page)).toHaveText(['公開甲', '興趣甲', '女子甲']);
  for (const [label, expected] of [['女子組', ['女子甲', '女子乙', '女子丙']], ['興趣組', ['興趣甲']], ['公開組', ['公開甲', '公開乙']]]) {
    await tabs(page).getByRole('tab', { name: label, exact: true }).click();
    await expect(names(page)).toHaveText(expected);
    await expect(tabs(page).getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true');
  }
  await page.getByRole('tablist', { name: '賽事狀態' }).getByRole('tab', { name: '接下來' }).click();
  await expect(names(page)).toHaveText(['公開甲', '公開乙']);
  await page.getByRole('tablist', { name: '日期', exact: true }).getByRole('tab').nth(1).click();
  await expect(tabs(page).getByRole('tab', { name: '公開組' })).toHaveAttribute('aria-selected', 'true');
  await tabs(page).getByRole('tab', { name: '公開組' }).focus();
  await page.keyboard.press('Home');
  await expect(tabs(page).getByRole('tab', { name: '全部' })).toBeFocused();
  await expect(names(page)).toHaveText(['公開甲', '興趣甲', '女子甲']);
  expect(await page.evaluate(root => window.__fake.__dump()[`${root}/boards/scorers`].rows, root)).toEqual(rows);
});

test('空組別提示與完整統計沿用所選組別', async ({ page }) => {
  await setup(page, { emptyFun: true });
  await tabs(page).getByRole('tab', { name: '興趣組' }).click();
  await expect(page.locator('#home-scorers')).toContainText('此組目前尚無射手榜資料');
  await expect(names(page)).toHaveCount(0);
  await page.locator('.p-homeScorers').getByRole('button', { name: '完整統計' }).click();
  await expect(page).toHaveURL(/#\/stats\?division=adult-fun$/);
});

for (const theme of ['light', 'dark']) test(`320px頁籤及贊助下方ToosterX置中 ${theme}`, async ({ page }) => {
  await setup(page, { theme });
  await page.setViewportSize({ width: 320, height: 720 });
  const bounds = await tabs(page).getByRole('tab').evaluateAll(nodes => nodes.map(n => ({ y: n.getBoundingClientRect().y, height: n.getBoundingClientRect().height, overflow: n.scrollWidth > n.clientWidth + 1 })));
  expect(new Set(bounds.map(b => b.y)).size).toBe(1);
  expect(bounds.every(b => b.height >= 44 && !b.overflow)).toBe(true);
  const logo = page.getByRole('img', { name: 'ToosterX', exact: true });
  await logo.scrollIntoViewIfNeeded();
  expect(await logo.evaluate(async image => { await image.decode(); return [image.naturalWidth, image.naturalHeight]; })).toEqual([466, 96]);
  const placement = await logo.evaluate(image => {
    const own = image.getBoundingClientRect(), sponsor = image.closest('.psponsor').getBoundingClientRect();
    const partnerBottom = Math.max(...[...document.querySelectorAll('.psponsor__partner')].map(n => n.getBoundingClientRect().bottom));
    return { center: own.x + own.width / 2, parentCenter: sponsor.x + sponsor.width / 2, top: own.top, partnerBottom, filter: getComputedStyle(image).filter };
  });
  expect(Math.abs(placement.center - placement.parentCenter)).toBeLessThan(1);
  expect(placement.top).toBeGreaterThan(placement.partnerBottom);
  expect(placement.filter).toContain('brightness(0)');
  if (theme === 'dark') expect(placement.filter).toContain('invert(1)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.p-homeScorers').screenshot({ path: `tools/home-scorers-${theme}-${test.info().project.name}.png` });
  await page.locator('.psponsor').screenshot({ path: `tools/home-toosterx-${theme}-${test.info().project.name}.png` });
});
