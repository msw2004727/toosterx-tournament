import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test.use({ serviceWorkers: 'allow' });

const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const E = 'feda-cup-2026';
async function setup(page, { active = true, delay = 0 } = {}) {
  await page.context().route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ body: '{}' }));
  await page.addInitScript(({ active, delay, E }) => {
    window.__FAKE_AUTH_DELAY = delay;
    window.__FAKE_USER = { uid: 'audit-admin', displayName: '管理員' };
    window.__FAKE_SEED = {
      [`events/${E}`]: { eventId: E, dates: ['2026-10-09'] },
      'staff/audit-admin': { active, roles: ['admin'], assignment: { venueIds: [], challengeIds: [] } }
    };
  }, { active, delay, E });
}

test('恢復登入延遲時，後台書籤仍停在原本頁面 @prelaunch', async ({ page }) => {
  await setup(page, { delay: 1400 });
  await page.goto('/#/admin/teams');
  await expect(page.getByText('報名審核', { exact: true }).first()).toBeVisible();
  await expect(page).toHaveURL(/#\/admin\/teams$/);
});

test('停用帳號不再顯示可用的管理權限 @prelaunch', async ({ page }) => {
  await setup(page, { active: false });
  await page.goto('/#/admin/teams');
  await expect(page.getByText(/沒有.*權限/).first()).toBeVisible();
  expect(await page.evaluate(async () => (await import('/js/core/firebase.js')).can('team.manage'))).toBe(false);
});

test('切換帳號時較慢的舊角色回應不能替新帳號恢復管理權限 @prelaunch', async ({ page }) => {
  await setup(page);
  await page.goto('/#/admin/teams');
  await expect(page.getByText('報名審核', { exact: true }).first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const firebase = await import('/js/core/firebase.js');
    window.__FAKE_READ_DELAYS = { 'staff/audit-admin': 250 };
    const old = firebase.reloadIdentity();
    window.__fake.__setUser({ uid: 'visitor', displayName: '訪客' });
    await old;
    return { uid: firebase.user()?.uid, allowed: firebase.can('team.manage') };
  });
  expect(result).toEqual({ uid: 'visitor', allowed: false });
});

test('Service Worker 安裝完成後，斷網重新整理仍載得出網站 @prelaunch @offline', async ({ page, context }) => {
  await setup(page);
  await page.goto('/#/admin/teams');
  await expect(page.getByText('報名審核', { exact: true }).first()).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // Demo 模組只在 demo 開啟過才快取；正式版不預載 demo。
  await page.reload();
  await expect(page.getByText('報名審核', { exact: true }).first()).toBeVisible();
  await context.unroute('https://www.gstatic.com/firebasejs/**');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('報名審核', { exact: true }).first()).toBeVisible();
  await expect(page.locator('#app-view')).not.toContainText('載入失敗');
});
