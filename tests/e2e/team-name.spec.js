import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const E = 'feda-cup-2026', UID = 'rename-admin', TEAM = `events/${E}/teams/t`;
async function open(page, { status = 'approved', roles = ['admin'], name = '原始球隊', theme = 'light' } = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());
  await page.addInitScript(({ E, UID, TEAM, status, roles, name, theme }) => {
    window.__FAKE_USER = { uid: UID, displayName: '主辦' };
    window.__FAKE_SEED = {
      [`events/${E}`]: { eventId: E, name: 'FEDA CUP' }, 'config/env': { env: 'demo' },
      [`users/${UID}`]: { uid: UID, displayName: '主辦' },
      [`staff/${UID}`]: { roles, active: true, name: '主辦' },
      [`events/${E}/divisions/u10`]: { divisionId: 'u10', name: 'U10', order: 3 },
      [TEAM]: { teamId: 't', name, shortName: '原隊', nameRevision: 2, status, divisionId: 'u10', rosterLocked: true, playerCount: 30 }
    };
    localStorage.setItem('feda_theme', theme);
  }, { E, UID, TEAM, status, roles, name, theme });
  await page.goto('/#/admin/teams');
  await page.waitForFunction(() => !!window.__fake);
  if (!roles.some(r => ['admin', 'super_admin'].includes(r))) return;
  const labels = { approved: '已通過', submitted: '待審核', draft: '草稿', rejected: '已退回', withdrawn: '已取消' };
  await page.getByRole('tab', { name: new RegExp(labels[status]) }).click();
  await page.getByRole('button', { name: `編輯 ${name} 的球隊名稱`, exact: true }).click();
}
const save = page => page.getByRole('button', { name: '儲存隊名', exact: true });
const calls = page => page.evaluate(() => window.__FAKE_CALLS ?? []);
const dump = page => page.evaluate(() => window.__fake.__dump());
async function fill(page) {
  await page.getByLabel('球隊名稱', { exact: true }).fill('新的球隊名稱');
  await page.getByLabel('球隊簡稱', { exact: true }).fill('新隊');
  await page.getByLabel('修改原因', { exact: true }).fill('依教練確認修正');
}

test('已核准鎖定球隊直接更名，傳入原版本並更新列表 @teamname', async ({ page }) => {
  await open(page);
  await expect(page.locator('.adm__roster')).toHaveCount(0);
  await page.getByLabel('球隊名稱', { exact: true }).fill('新的球隊名稱');
  await expect(page.getByLabel('球隊簡稱', { exact: true })).toHaveValue('新的球隊名稱');
  await fill(page); await save(page).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.adm__itemHead')).toContainText('新的球隊名稱');
  expect((await calls(page))[0]).toMatchObject({ name: 'updateTeamName', payload: { eventId: E, teamId: 't', expected: { name: '原始球隊', shortName: '原隊', revision: 2 }, name: '新的球隊名稱', shortName: '新隊', reason: '依教練確認修正', operationId: expect.any(String) } });
  expect((await dump(page))[TEAM]).toMatchObject({ name: '新的球隊名稱', shortName: '新隊', nameRevision: 3, status: 'approved', rosterLocked: true, playerCount: 30 });
  await page.getByRole('button', { name: '編輯 新的球隊名稱 的球隊名稱' }).click();
  await expect(page.getByLabel('球隊簡稱', { exact: true })).toHaveValue('新隊');
});
for (const status of ['submitted', 'draft', 'rejected', 'withdrawn']) test(`審核各狀態可編輯名稱：${status} @teamname`, async ({ page }) => {
  await open(page, { status, roles: ['super_admin'] });
  await fill(page); await save(page).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await dump(page))[TEAM].status).toBe(status);
});
test('必填、未變更、離線與取消都不送出 @teamname', async ({ page }) => {
  await open(page); await page.getByLabel('修改原因', { exact: true }).fill('確認'); await save(page).click();
  await expect(page.getByRole('alert')).toContainText('沒有變更');
  await fill(page); await page.getByLabel('修改原因', { exact: true }).fill(''); await save(page).click();
  await expect(page.getByRole('alert')).toContainText('修改原因');
  await fill(page); await page.getByLabel('球隊名稱', { exact: true }).fill(' '); await save(page).click();
  await expect(page.getByRole('alert')).toContainText('球隊名稱');
  await fill(page); await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })); await save(page).click();
  await expect(page.getByRole('alert')).toContainText('離線');
  expect(await calls(page)).toEqual([]);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect((await dump(page))[TEAM].name).toBe('原始球隊');
});
test('權限不足沒有更名入口 @teamname', async ({ page }) => {
  await open(page, { roles: ['scorer'] });
  await expect(page.locator('.adm__box--warn')).toBeVisible();
  await expect(page.getByRole('button', { name: /編輯.*球隊名稱/ })).toHaveCount(0);
});
test('伺服器衝突保留輸入與原因，可再次嘗試 @teamname', async ({ page }) => {
  await open(page); await fill(page);
  await page.evaluate(() => { window.__FAKE_CALL_ERROR = { code: 'functions/aborted', message: '球隊名稱已被其他管理員修改' }; }); await save(page).click();
  await expect(page.getByRole('alert')).toContainText('其他管理員');
  await expect(page.getByLabel('球隊名稱', { exact: true })).toHaveValue('新的球隊名稱');
  await expect(page.getByLabel('修改原因', { exact: true })).toHaveValue('依教練確認修正');
  await expect(save(page)).toBeEnabled(); expect((await dump(page))[TEAM].name).toBe('原始球隊');
});
test('不完整回覆不可顯示儲存成功 @teamname', async ({ page }) => {
  await open(page); await fill(page); await page.evaluate(() => { window.__FAKE_TEAM_NAME_RESULT = {}; }); await save(page).click();
  await expect(page.getByRole('alert')).toContainText('尚未確認');
  await expect(page.getByRole('dialog')).toBeVisible(); await expect(save(page)).toBeEnabled();
  await expect(page.locator('.toast--success')).toHaveCount(0); expect((await dump(page))[TEAM].name).toBe('原始球隊');
});
test('回覆遺失重試使用同一操作代碼，只留一筆紀錄 @teamname', async ({ page }) => {
  await open(page); await fill(page); await page.evaluate(() => { window.__FAKE_TEAM_NAME_LOST_RESPONSE = true; }); await save(page).click();
  await expect(page.getByRole('alert')).toContainText('尚未確認'); await save(page).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const commands = await calls(page); expect(commands).toHaveLength(2); expect(commands[0].payload.operationId).toBe(commands[1].payload.operationId);
  expect(Object.keys(await dump(page)).filter(path => path.startsWith(`events/${E}/audits/`))).toHaveLength(1);
});
test('等待回覆禁止重複送出，離開頁面清除表單 @teamname', async ({ page }) => {
  await open(page); await fill(page);
  await page.evaluate(() => { window.__FAKE_TEAM_NAME_PENDING = new Promise(resolve => { window.__TEAM_NAME_RESOLVE = resolve; }); }); await save(page).click();
  await expect(save(page)).toBeDisabled(); await expect(page.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeVisible(); expect(await calls(page)).toHaveLength(1);
  await page.evaluate(() => { location.hash = '/admin'; }); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => window.__TEAM_NAME_RESOLVE()); await expect.poll(async () => (await dump(page))[TEAM].name).toBe('新的球隊名稱');
  await expect(page.locator('.toast--success')).toHaveCount(0);
});
for (const theme of ['light', 'dark']) test(`長隊名安全顯示，表單窄版可操作：${theme} @teamname`, async ({ page }) => {
  await open(page, { name: '<img src=x onerror=alert(1)>' + '長'.repeat(30), theme });
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.getByRole('dialog').locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const panel = await page.locator('.adm__identityPanel').boundingBox();
  expect(panel.y).toBeGreaterThanOrEqual(0); expect(panel.y + panel.height).toBeLessThanOrEqual(page.viewportSize().height);
  await expect(save(page)).toBeInViewport({ ratio: 1 });
  await fill(page); await save(page).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('公開賽程使用後台更名後的簡稱，可辨識長全名的兩隊 @teamname', async ({ page }) => {
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());
  await page.addInitScript(({ E }) => {
    window.__FAKE_SEED = {
      [`events/${E}`]: { eventId: E, name: '示範賽事', dates: ['2026-10-09'] },
      [`events/${E}/divisions/d`]: { divisionId: 'd', name: '測試組別', schedulePublished: true, matchDurationMin: 25, order: 1 },
      [`events/${E}/matches/m`]: { matchId: 'm', divisionId: 'd', status: 'scheduled', date: '2026-10-09', kickoffAt: 1791507600000,
        venueId: 'v', venueName: 'A場', label: '小組賽',
        home: { teamId: 'yellow', name: '圖斯特足球俱樂部 (黃)', displayName: '圖斯特 黃' },
        away: { teamId: 'pink', name: '圖斯特足球俱樂部 (粉)', displayName: '圖斯特 粉' } }
    };
  }, { E });
  await page.goto('/#/division/d?tab=schedule');
  await expect(page.locator('.prow__team--home')).toHaveText('圖斯特 黃');
  await expect(page.locator('.prow__team--away')).toHaveText('圖斯特 粉');
  await expect(page.getByRole('button', { name: '圖斯特 黃 對 圖斯特 粉，未開始', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
