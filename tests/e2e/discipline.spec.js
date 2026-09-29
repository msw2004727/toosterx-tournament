import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { DIVISIONS } from '../../js/engine/formats.js';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const root = 'events/feda-cup-2026';
async function stub(page, { empty = false, fail = false, many = false } = {}) {
  const seed = { 'config/env': { env: 'demo' }, 'config/featureFlags': {} };
  for (const d of DIVISIONS) seed[`${root}/divisions/${d.divisionId}`] = d;
  const rows = empty ? [] : Array.from({ length: many ? 24 : 2 }, (_, i) => ({
    teamId: `t${i}`, name: i === 0 ? '需要完整呈現的臺中市西屯區女子足球代表隊' : `球隊 ${i + 1}`,
    divisionId: i % 2 ? 'adult-open' : 'women', played: 3, yellow: 2, red: 1, secondYellow: 1, fairPlayPoints: -3, rank: 1
  }));
  for (const r of rows) seed[`${root}/teams/${r.teamId}`] = { name: r.name, divisionId: r.divisionId, status: 'approved' };
  seed[`${root}/boards/fairplay`] = { scoringRules: { yellow: -1, secondYellow: -3, directRed: -4, yellowThenRed: -5 }, rows: [...rows, { teamId: 'deleted', name: '殘留不存在球隊', divisionId: 'women', played: 1, fairPlayPoints: -1 }] };
  seed[`${root}/boards/scorers`] = { rows: [{ teamId: 'deleted', playerId: 'p1', name: '殘留射手', divisionId: 'women', goals: 5 }] };
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());
  await page.addInitScript(({ seed, fail }) => {
    window.__FAKE_SEED = seed;
    if (fail) window.__FAKE_SNAPSHOT_FAIL = { path: '/teams', code: 'unavailable' };
  }, { seed, fail });
}
for (const theme of ['light', 'dark']) {
  test(`紅黃牌統計名稱、說明、固定組別色及窄機完整內容 ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme }); await stub(page); await page.goto('/#/stats?tab=fairplay');
    await expect(page.getByRole('tab', { name: '紅黃牌統計', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.pdiscipline__row')).toHaveCount(2);
    await expect(page.locator('.pub')).not.toContainText('殘留不存在球隊');
    await expect(page.locator('.pdiscipline .ptop__rank')).toHaveCount(0);
    const first = page.locator('.pdiscipline__row').first();
    await expect(first).toContainText('已完賽 3 場');
    await expect(first).toContainText('紀律扣分');
    await expect(first).toContainText('-3 分');
    await expect(first).toContainText('紅牌包含 1 次兩黃換紅');
    await expect(page.locator('.pdiscipline .pcard[data-division="women"]')).toHaveAttribute('data-division-tone', 'div-women');
    await page.getByText('扣分怎麼計算？', { exact: true }).click();
    await expect(page.locator('.pdiscipline__rules')).toContainText('兩黃換紅：-3 分');
    await expect(page.locator('.pdiscipline__rules')).toContainText('黃牌後直接紅牌：-5 分');
    await page.getByText('扣分怎麼計算？', { exact: true }).click();
    for (const width of [320, 360, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await first.locator('.pdiscipline__team').evaluate(n => n.scrollWidth <= n.clientWidth + 1 && getComputedStyle(n).whiteSpace !== 'nowrap')).toBe(true);
      for (const value of await first.locator('dd').all()) expect(await value.evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 980 });
    await page.screenshot({ path: `tools/discipline-${theme}-${test.info().project.name}.png`, fullPage: true });
    await page.getByLabel('組別', { exact: true }).selectOption('women');
    await expect(page.locator('.pdiscipline__row')).toHaveCount(1);
    await page.getByRole('button', { name: '需要完整呈現的臺中市西屯區女子足球代表隊', exact: true }).click();
    await expect(page).toHaveURL(/#\/team\/t0$/);
  });
}
test('全部組別不把總數截成 20 筆', async ({ page }) => {
  await stub(page, { many: true }); await page.goto('/#/stats?tab=fairplay');
  await expect(page.locator('.pdiscipline__row')).toHaveCount(24);
});
test('過期看板中的已刪除球隊，同時從紅黃牌與射手榜移除', async ({ page }) => {
  await stub(page, { empty: true }); await page.goto('/#/stats?tab=fairplay');
  await expect(page.getByText('目前沒有可公布的紅黃牌統計', { exact: true })).toBeVisible();
  await expect(page.locator('.pdiscipline__row')).toHaveCount(0);
  await page.getByRole('tab', { name: '射手榜', exact: true }).click();
  await expect(page.locator('.ptop__row')).toHaveCount(0);
  await expect(page.locator('.pub')).not.toContainText('殘留射手');
});
test('讀取失敗明示錯誤，不當作零張牌或尚未開賽', async ({ page }) => {
  await stub(page, { fail: true }); await page.goto('/#/stats?tab=fairplay');
  await expect(page.getByText('統計資料暫時讀取失敗', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新載入', exact: true })).toBeVisible();
  await expect(page.locator('.pdiscipline__row')).toHaveCount(0);
});
