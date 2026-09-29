import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const E = 'feda-cup-2026', root = `events/${E}`, teamPath = `${root}/teams/imported`;
async function setup(page, { fail = null, empty = false } = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());
  const seed = {
    'config/env': { env: 'demo' }, 'config/registration': { open: false, hidden: true },
    'staff/jersey-admin': { active: true, roles: ['admin'] }, [root]: { dates: ['2026-10-09'] },
    [`${root}/divisions/u10`]: { divisionId: 'u10', name: 'U10兒童組', eligibility: { bornOnOrAfter: '2016-09-01' }, schedulePublished: false },
    [teamPath]: { teamId: 'imported', name: '尚未排賽程隊', divisionId: 'u10', status: empty ? 'draft' : 'approved', source: 'csv', publicRoster: true },
    [`${root}/teams/pending`]: { name: '未核准隊', divisionId: 'u10', status: 'pending' },
    [`${root}/teams/withdrawn`]: { name: '退出隊', divisionId: 'u10', status: 'withdrawn' },
    [`${root}/teams/other`]: { name: '其他組球隊', divisionId: 'women', status: 'approved' }
  };
  for (const [i, jerseyNo] of [null, null, 0].entries()) {
    const m = { memberId: `p${i}`, name: `測試球員${i}`, displayName: `測試球員${i}`, teamId: 'imported', divisionId: 'u10', source: 'csv', status: 'approved', role: 'player', kind: 'player', jerseyNo, birthDate: '2017-01-01', idLast4: '0012', identityComplete: true };
    seed[`${teamPath}/members/p${i}`] = m;
    seed[`${teamPath}/roster/p${i}`] = { memberId: m.memberId, displayName: m.name, jerseyNo, role: 'player' };
  }
  await page.addInitScript(({ seed, fail }) => { window.__FAKE_USER = { uid: 'jersey-admin' }; window.__FAKE_SEED = seed; window.__FAKE_SNAPSHOT_FAIL = fail; }, { seed, fail });
}

test('CSV 多人留空與 0 號正常預覽，同隊 0/00 重複阻擋 @jersey', async ({ page }) => {
  await setup(page); await page.goto('/#/admin/team-import');
  await expect(page.getByRole('table')).toContainText('多位球員可同時沒有背號');
  const upload = text => page.getByLabel('上傳 CSV 球隊名冊').setInputFiles({ name: '背號測試.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
  await upload('組別代碼,球隊名稱,球員姓名或暱稱,背號\nu10,新隊,甲,\nu10,新隊,乙,\nu10,新隊,丙,0');
  await expect(page.getByText('匯入預覽：1 支球隊、3 位球員')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await upload('組別代碼,球隊名稱,球員姓名或暱稱,背號\nu10,新隊,甲,0\nu10,新隊,乙,00');
  await expect(page.getByRole('alert')).toContainText('號重複');
  await expect(page.getByRole('button', { name: '匯入並核准球隊' })).toBeDisabled();
});

test('空背號可補 0 再清空，錯誤不假成功，窄螢幕表單完整 @jersey', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await setup(page); await page.goto('/#/admin/teams');
  await page.getByRole('tab', { name: /已通過/ }).click();
  await page.locator('.adm__itemHead').filter({ hasText: '尚未排賽程隊' }).click();
  await page.getByRole('button', { name: '補填或修改 測試球員0 的資料' }).click();
  await expect(page.getByRole('dialog')).not.toContainText('#null');
  const panel = await page.locator('.adm__identityPanel').boundingBox();
  expect(panel.y).toBeGreaterThanOrEqual(0);
  expect(panel.y + panel.height).toBeLessThanOrEqual(page.viewportSize().height);
  await expect(page.getByLabel('背號（可留空）', { exact: true })).toHaveValue('');
  await page.getByLabel('背號（可留空）', { exact: true }).fill('-1');
  await page.getByLabel('修改原因', { exact: true }).fill('教練更新背號');
  await page.getByRole('button', { name: '儲存資料' }).click();
  await expect(page.getByRole('alert')).toContainText('0–99');
  await page.getByLabel('背號（可留空）', { exact: true }).fill('0');
  await page.evaluate(() => { window.__FAKE_CALL_ERROR = '同隊已有球員使用 0 號，請更換背號或留空。'; });
  await page.getByRole('button', { name: '儲存資料' }).click();
  await expect(page.getByRole('alert')).toContainText('同隊已有球員使用 0 號');
  await page.evaluate(() => { delete window.__FAKE_CALL_ERROR; });
  await page.getByRole('button', { name: '儲存資料' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '補填或修改 測試球員0 的資料' }).click();
  await expect(page.getByLabel('背號（可留空）', { exact: true })).toHaveValue('0');
  await page.getByLabel('背號（可留空）', { exact: true }).fill('');
  await page.getByLabel('修改原因', { exact: true }).fill('尚未決定');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator('.adm__identityPanel').evaluate(n => { n.scrollTop = 0; });
  await page.getByRole('dialog').screenshot({ path: `tools/jersey-editor-${test.info().project.name}.png` });
  await page.getByRole('button', { name: '儲存資料' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await page.evaluate(() => window.__FAKE_CALLS)).at(-1).payload).toMatchObject({ memberId: 'p0', jerseyNo: null, revision: 1 });
});

test('報名關閉且無賽程積分榜仍公布已核准隊，其他狀態排除並即時更新 @publicteams', async ({ page }) => {
  await setup(page); await page.goto('/#/division/u10?tab=teams');
  await expect(page.locator('.pteams__btn')).toHaveCount(1);
  await expect(page.locator('.pteams__btn')).toContainText('尚未排賽程隊');
  await expect(page.locator('.pub')).not.toContainText('報名截止後');
  await page.evaluate(({ root }) => window.__fake.__seed({ [`${root}/teams/pending`]: { name: '新核准隊', divisionId: 'u10', status: 'approved' } }), { root });
  await expect(page.locator('.pteams__btn')).toHaveCount(2);
  await page.getByRole('button', { name: '尚未排賽程隊' }).click();
  await expect(page.locator('.proster__row')).toHaveCount(3);
  await page.evaluate(({ teamPath }) => window.__fake.__seed({ [`${teamPath}/roster/p0`]: { memberId: 'p0', displayName: '測試球員0', jerseyNo: 9, role: 'player' } }), { teamPath });
  await page.goto('/#/division/u10?tab=teams');
  await page.getByRole('button', { name: '尚未排賽程隊' }).click();
  await expect(page.locator('.proster__row').filter({ hasText: '測試球員0' }).locator('.proster__no')).toHaveText('9');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('真正空名單不宣稱報名未截止 @publicteams', async ({ page }) => {
  await setup(page, { empty: true }); await page.goto('/#/division/u10?tab=teams');
  await expect(page.getByText('此組別尚無已核准球隊，主辦匯入或核准後會顯示於此。')).toBeVisible();
});

for (const [path, route, title] of [
  ['/teams', '/division/u10?tab=teams', '讀不到球隊名單'],
  ['/roster', '/team/imported', '讀不到球員名單']
]) test(`讀取失敗獨立提示：${title} @publicteams`, async ({ page }) => {
  await setup(page, { fail: { path } }); await page.goto('/#' + route);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(page.locator('.pub')).not.toContainText('報名審核通過後');
  await expect(page.getByRole('button', { name: '重新載入' })).toBeVisible();
});
