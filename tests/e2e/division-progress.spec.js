import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const formats = JSON.parse(fs.readFileSync('tests/fixtures/bracket-formats.json', 'utf8'));
const E = 'events/feda-cup-2026';
function seed() {
  const data = { 'config/env': { env: 'demo' }, 'config/formats': { formats },
    [`${E}/divisions/u8`]: { divisionId: 'u8', name: 'U8兒童組', playersOnField: 5, matchDurationMin: 25, schedulePublished: true, formatId: 'F6_GROUP_TOP_SEED_BYE', groupNames: { A: '甲組', B: '乙組' } } };
  for (const groupId of ['A', 'B']) data[`${E}/standings/u8__group__${groupId}`] = { divisionId: 'u8', stageId: 'group', groupId, rows: [1, 2, 3].map(rank => ({ teamId: `${groupId}${rank}`, name: rank === 1 ? `非常長的完整球隊名稱${groupId}` : `隊伍${groupId}${rank}`, rank, played: 2, win: 1, draw: 0, loss: 1, goalsFor: 3, goalsAgainst: 1, goalDiff: 2, points: 3 })) };
  return data;
}
async function open(page, data) {
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ body: '{}' }));
  await page.addInitScript(s => { window.__FAKE_SEED = s; window.__FAKE_USER = null; }, data);
  await page.goto('/#/division/u8');
  await expect(page.locator('.ptable')).toHaveCount(2);
}
test('階段標籤是可操作按鈕，兩種標籤進入同組晉級圖，監聽回收 @division-progress', async ({ page }) => {
  await open(page, seed());
  await expect(page.locator('.pstand__advance--bye')).toHaveCount(2);
  await expect(page.locator('.pstand__advance:not(.pstand__advance--bye)')).toHaveCount(4);
  const count = () => page.evaluate(() => window.__FAKE_STATE.watchers.size);
  const baseline = await count();
  for (const selector of ['.pstand__advance--bye', '.pstand__advance:not(.pstand__advance--bye)']) {
    await page.locator(selector).first().click();
    await expect(page).toHaveURL(/#\/division\/u8\?tab=bracket$/);
    await expect(page.getByRole('tab', { name: '晉級／名次圖' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: '積分榜', exact: true }).click();
    await expect(page.locator('.pstand__advance')).toHaveCount(6);
    expect(await count()).toBe(baseline);
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.pstand__advance').evaluateAll(nodes => nodes.every(n => n.getBoundingClientRect().height >= 44))).toBe(true);
    expect(await page.locator('.pstand__advance').evaluateAll(nodes => nodes.every(n => n.scrollWidth <= n.clientWidth + 1))).toBe(true);
    const badgeChecks = await page.locator('.pstand__advance').evaluateAll(nodes => nodes.map(n => {
      const pill = n.querySelector('.pstand__advance-pill');
      const s = getComputedStyle(pill), rect = n.getBoundingClientRect();
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
      const luminance = color => {
        ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
        const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return rgb.reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      };
      const a = luminance(s.color), b = luminance(s.backgroundColor);
      const row = n.closest('tr');
      const name = row.querySelector('.ptable__teamName').getBoundingClientRect();
      const gap = pill.getBoundingClientRect().top - name.bottom;
      const numeric = [...row.querySelectorAll('td.num')].map(td => {
        const range = document.createRange(); range.selectNodeContents(td); return range.getBoundingClientRect().bottom;
      });
      return { gap, nowrap: s.whiteSpace, compact: pill.getBoundingClientRect().height <= 26, filled: s.backgroundColor !== 'rgba(0, 0, 0, 0)', contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), within: rect.right <= innerWidth, clear: numeric.every(bottom => bottom <= rect.top) };
    }));
    expect(badgeChecks.every(b => b.gap >= 0 && b.gap <= 6 && b.nowrap === 'nowrap' && b.compact && b.filled && b.contrast >= 4.5 && b.within && b.clear), JSON.stringify({ theme, badgeChecks })).toBe(true);
    const numeric = await page.locator('.ptable td.num').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().right));
    expect(numeric.every(right => right <= (test.info().project.name === 'chromium-desktop' ? 1280 : test.info().project.name === 'chromium-320' ? 320 : 393))).toBe(true);
  }
});
test('官方名次發布後呈現 SVG 頒獎臺，撤回立即隱藏，暫時排名不提前晉級 @division-progress', async ({ page }, info) => {
  const data = seed(); await open(page, data);
  await expect(page.locator('.pstand-final__pending')).toBeVisible();
  const d = { ...data[`${E}/divisions/u8`], finalRankingPublished: true, finalRanking: ['A1','B1','A2','B2','A3','B3'].map((teamId, i) => ({ teamId, rank: i + 1, name: i === 0 ? '<img src=x onerror=alert(1)>' : `正式名次隊${i + 1}` })) };
  await page.evaluate(({ E, d }) => window.__fake.__seed({ [`${E}/divisions/u8`]: d }), { E, d });
  await expect(page.locator('.pstand-final__place')).toHaveCount(3);
  await expect(page.locator('.pstand-final__base svg')).toHaveCount(3);
  await expect(page.locator('.pstand-final__row')).toHaveCount(3);
  await expect(page.locator('.pstand > .pcard').first()).toContainText('最終名次');
  await expect(page.locator('.pstand-final__place--1')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.pstand img')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('division-stage-final.png'), fullPage: true });
  d.finalRankingPublished = false;
  await page.evaluate(({ E, d }) => window.__fake.__seed({ [`${E}/divisions/u8`]: d }), { E, d });
  await expect(page.locator('.pstand-final__pending')).toBeVisible();
  await expect(page.locator('.pstand > .pcard').first()).toContainText('分組賽');
  await expect(page.locator('.pstand-final__place')).toHaveCount(0);
  const standing = data[`${E}/standings/u8__group__B`]; standing.rows[0].played = 1;
  await page.evaluate(({ E, standing }) => window.__fake.__seed({ [`${E}/standings/u8__group__B`]: standing }), { E, standing });
  await expect(page.locator('.pstand__advance')).toHaveCount(0);
});
