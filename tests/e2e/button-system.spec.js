import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const root = 'events/feda-cup-2026';
const widths = [320, 360, 390, 430, 1280];

async function stub(page, theme) {
  await page.clock.setFixedTime(new Date('2026-09-07T10:00:00+08:00'));
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());
  await page.addInitScript(({ root, theme }) => {
    window.__FAKE_USER = { uid: 'design-admin' };
    localStorage.setItem('feda_theme', theme);
    window.__FAKE_SEED = {
      'config/env': { env: 'demo' }, 'config/registration': { open: false, hidden: true },
      'staff/design-admin': { active: true, roles: ['admin'] },
      'users/design-admin': { displayName: '管理員' },
      [root]: { name: 'FEDA CUP 2026', dates: ['2026-10-09'] },
      [`${root}/divisions/u10`]: { divisionId: 'u10', name: 'U10兒童組', order: 3, playersOnField: 5, date: '2026-10-09', eligibility: { bornOnOrAfter: '2016-09-01' } },
      [`${root}/teams/design-team`]: { name: '飛達設計驗收隊', teamId: 'design-team', divisionId: 'u10', status: 'approved', source: 'csv', memberCount: 1 },
      [`${root}/teams/design-team/members/design-player`]: { name: '測試球員', memberId: 'design-player', jerseyNo: 7, kind: 'player', source: 'csv', status: 'approved', birthDate: '2017-01-12', idLast4: '0012', identityComplete: true }
    };
  }, { root, theme });
}

async function contrast(locator) {
  await locator.evaluate(async node => {
    await Promise.allSettled(node.getAnimations().map(animation => animation.finished));
  });
  return locator.evaluate(node => {
    const rgb = s => s.match(/[\d.]+/g).map(Number);
    const luminance = c => c.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
    const foreground = rgb(getComputedStyle(node).color);
    let ancestor = node, background;
    while (ancestor) {
      background = rgb(getComputedStyle(ancestor).backgroundColor);
      if (background.length === 3 || background[3] === 1) break;
      ancestor = ancestor.parentElement;
    }
    const a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
}

async function controlsFit(page, selector) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  for (const node of await page.locator(selector).all()) {
    if (!await node.isVisible()) continue;
    const size = await node.boundingBox();
    expect(size.height).toBeGreaterThanOrEqual(44);
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(await node.evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
  }
}

for (const theme of ['light', 'dark']) {
  test(`球隊操作列完整、鍵盤可用、取消仍需確認：${theme} @buttons`, async ({ page }) => {
    await stub(page, theme); await page.goto('/#/admin/teams');
    const primary = page.getByRole('link', { name: '匯入 CSV 球隊名冊', exact: true });
    await expect(primary).toBeVisible();
    expect(await contrast(primary)).toBeGreaterThanOrEqual(4.5);
    await primary.hover(); expect(await contrast(primary)).toBeGreaterThanOrEqual(4.5);
    await page.getByRole('tab', { name: /已通過/ }).click();
    await page.locator('.adm__itemHead').filter({ hasText: '飛達設計驗收隊' }).click();
    await expect(page.locator('.action-row')).toHaveCount(3);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await controlsFit(page, '.action-row, .adm__memberEdit');
      for (const row of await page.locator('.action-row').all()) {
        await expect(row.locator('.action-row__icon svg')).toHaveCount(1);
        expect(await contrast(row.locator('.action-row__title'))).toBeGreaterThanOrEqual(4.5);
        expect(await contrast(row.locator('.action-row__note'))).toBeGreaterThanOrEqual(4.5);
      }
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('.adm__actions').screenshot({ path: `tools/button-actions-${theme}-${test.info().project.name}.png` });
    const reject = page.getByRole('button', { name: '退回這支球隊', exact: true });
    await reject.focus();
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    await expect(reject).toBeFocused();
    expect(await reject.evaluate(n => getComputedStyle(n).outlineStyle)).toBe('solid');
    await reject.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    const danger = page.getByRole('button', { name: '確定退回', exact: true });
    expect(await contrast(danger)).toBeGreaterThanOrEqual(4.5);
    await danger.hover(); expect(await contrast(danger)).toBeGreaterThanOrEqual(4.5);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    for (const name of ['取消報名／退費', '不可抗力：全額退費']) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('button', { name: '取消報名並記退費', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '取消', exact: true }).click();
      expect((await page.evaluate(() => window.__fake.__dump()))[`${root}/teams/design-team`].status).toBe('approved');
    }
  });

  test(`全站共用按鈕與功能入口：${theme} @buttons`, async ({ page }) => {
    await stub(page, theme); await page.goto('/#/my');
    await expect(page.locator('.acct__tile').first()).toBeVisible();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await controlsFit(page, '.acct__tile, .btn');
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('.acct__grid').screenshot({ path: `tools/button-menu-${theme}-${test.info().project.name}.png` });
    await page.getByRole('button', { name: /匯入球隊名冊/ }).click();
    await expect(page.getByRole('button', { name: '下載 CSV 範本', exact: true })).toBeVisible();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await controlsFit(page, '.btn');
      for (const button of await page.locator('.btn:not(:disabled)').all()) expect(await contrast(button)).toBeGreaterThanOrEqual(4.5);
    }
  });
}
