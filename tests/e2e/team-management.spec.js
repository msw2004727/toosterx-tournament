import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const E = 'feda-cup-2026', UID = 'captain', base = `events/${E}`;
async function stub(page, { roles = [], assigned = true, locked = false } = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());
  await page.addInitScript(({ E, UID, base, roles, assigned, locked }) => {
    window.__FAKE_USER = { uid: UID };
    window.__FAKE_SEED = {
      'config/env': { env: 'demo' }, 'config/registration': { open: false, hidden: true },
      [`users/${UID}`]: { uid: UID, displayName: '指定用戶' },
      [`users/other`]: { uid: 'other', displayName: '原隊長' },
      ...(roles.length ? { [`staff/${UID}`]: { uid: UID, active: true, roles } } : {}),
      [base]: { eventId: E, dates: ['2026-10-09'] },
      [`${base}/divisions/u10`]: { divisionId: 'u10', name: '學童中年級', order: 1, eligibility: { bornOnOrAfter: '2016-09-01' } },
      [`${base}/divisions/open`]: { divisionId: 'open', name: '公開組', order: 2 },
      [`${base}/teams/own`]: { teamId: 'own', divisionId: 'u10', name: '所屬球隊', captainUid: assigned ? UID : null, captainName: assigned ? '指定用戶' : null, status: 'approved', source: 'csv', rosterLocked: true, managementLocked: locked, memberCount: 1 },
      [`${base}/teams/other`]: { teamId: 'other', divisionId: 'open', name: '別人的球隊', captainUid: 'other', captainName: '原隊長', status: 'approved', source: 'csv', rosterLocked: true, memberCount: 1 },
      [`${base}/teams/own/members/m1`]: { memberId: 'm1', name: '小飛', kind: 'player', source: 'csv', status: 'approved', jerseyNo: 7, birthDate: '2017-01-01', idLast4: '0012', identityRevision: 0 },
      [`${base}/teams/other/members/m2`]: { memberId: 'm2', name: '另一位球員', source: 'csv', status: 'approved', jerseyNo: 8, birthDate: '2000-01-01', idLast4: '0099' }
    };
  }, { E, UID, base, roles, assigned, locked });
}
async function expandOwn(page) {
  await page.getByRole('button', { name: '學童中年級 1 隊' }).click();
  await page.getByRole('button', { name: /所屬球隊 隊長/ }).click();
  await expect(page.locator('.adm__memberName')).toContainText('小飛');
}

test('未指派者沒有管理球隊按鈕，指派與撤銷即時反映在我的頁面', async ({ page }) => {
  await stub(page, { assigned: false }); await page.goto('/#/my');
  await expect(page.locator('.acct__uidValue')).toHaveText(UID);
  await expect(page.getByRole('button', { name: /管理球隊/ })).toHaveCount(0);
  await page.evaluate(base => window.__fake.__seed({ [`${base}/teams/own`]: { teamId: 'own', divisionId: 'u10', name: '所屬球隊', captainUid: 'captain', status: 'approved' } }), base);
  const button = page.getByRole('button', { name: /管理球隊/ });
  await expect(button).toBeVisible();
  await expect(button).toHaveClass(/acct__tile--frequent/);
  expect(await button.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await page.evaluate(base => window.__fake.__seed({ [`${base}/teams/own`]: { teamId: 'own', divisionId: 'u10', name: '所屬球隊', captainUid: null, status: 'approved' } }), base);
  await expect(button).toHaveCount(0);
});

test('隊長只看到自己的組別與球隊，共用審核表單編輯原有欄位', async ({ page }) => {
  await stub(page); await page.goto('/#/my');
  await page.getByRole('button', { name: /管理球隊/ }).click();
  await expect(page).toHaveURL(/#\/my\/teams$/);
  await expect(page.locator('.adm')).not.toContainText('別人的球隊');
  await expect(page.getByRole('button', { name: /公開組/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /一鍵全/ })).toHaveCount(0);
  await expandOwn(page);
  await page.getByRole('button', { name: '補填或修改 小飛 的資料' }).click();
  await page.getByLabel('隊員姓名／暱稱').fill('小飛修正');
  await page.getByLabel('背號（可留空）').fill('999');
  await page.getByLabel('身分證後四碼', { exact: true }).fill('0001');
  await page.getByLabel('修改原因').fill('依證件更正');
  await page.getByRole('button', { name: '儲存資料' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await page.evaluate(() => window.__FAKE_CALLS))[0]).toMatchObject({ name: 'updateMemberIdentity', payload: { teamId: 'own', memberId: 'm1', name: '小飛修正', jerseyNo: 999, idLast4: '0001', birthDate: '2017-01-01' } });
  await expect(page.locator('.adm__no')).toHaveText('999');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('球隊上鎖後隊長只可查看，解鎖快照立即恢復原有編輯入口', async ({ page }) => {
  await stub(page, { locked: true }); await page.goto('/#/my/teams'); await expandOwn(page);
  await expect(page.getByRole('status')).toContainText('球隊已上鎖');
  await expect(page.locator('.adm__memberEdit')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /編輯 .* 的球隊名稱/ })).toHaveCount(0);
  await page.evaluate(base => window.__fake.__seed({ [`${base}/teams/own`]: { teamId: 'own', divisionId: 'u10', name: '所屬球隊', captainUid: 'captain', source: 'csv', status: 'approved', managementLocked: false } }), base);
  await expect(page.locator('.adm__memberEdit')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /編輯 .* 的球隊名稱/ })).toBeVisible();
});

test('非隊長直開管理頁面不會載入任何其他隊的私密名冊', async ({ page }) => {
  await stub(page, { assigned: false, roles: ['scorer'] }); await page.goto('/#/my/teams');
  await expect(page.locator('.adm__empty')).toContainText('沒有可管理');
  await expect(page.locator('.adm')).not.toContainText('別人的球隊');
  await expect(page.locator('.adm__member')).toHaveCount(0);
});

for (const role of ['admin', 'super_admin']) {
  test(`${role} 看所有組別收折清單，單隊上鎖仍可編輯並一鍵全鎖全解`, async ({ page }) => {
    await stub(page, { roles: [role] }); await page.goto('/#/my/teams');
    await expect(page.locator('.adm__divisionHead')).toHaveCount(2);
    await expect(page.locator('.adm__groupTeams')).toHaveCount(0);
    await expandOwn(page);
    await page.getByRole('button', { name: '上鎖球隊', exact: true }).click();
    await page.getByRole('button', { name: '上鎖', exact: true }).click();
    await expect(page.getByRole('button', { name: '解鎖球隊', exact: true })).toBeVisible();
    await expect(page.locator('.adm__memberEdit')).toHaveCount(1);
    await page.getByRole('button', { name: '一鍵全鎖' }).click();
    await page.getByRole('button', { name: '全部上鎖', exact: true }).click();
    await expect(page.locator('.adm__headSub')).toContainText('2 支已上鎖');
    await page.getByRole('button', { name: '一鍵全解' }).click();
    await page.getByRole('button', { name: '全部解鎖', exact: true }).click();
    await expect(page.locator('.adm__headSub')).toContainText('0 支已上鎖');
    const calls = await page.evaluate(() => window.__FAKE_CALLS);
    expect(calls.map(c => c.payload)).toEqual([{ eventId: E, teamId: 'own', locked: true }, { eventId: E, all: true, locked: true }, { eventId: E, all: true, locked: false }]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test('身分授權以組別到球隊兩層下拉選單指派隊長，且不新增全站角色', async ({ page }) => {
  await stub(page, { roles: ['super_admin'], assigned: false }); await page.goto('/#/admin/staff');
  await page.getByRole('button', { name: /指定用戶.*已授權/ }).click();
  await expect(page.getByLabel('隊長球隊')).toBeDisabled();
  await page.getByLabel('隊長組別').selectOption('u10');
  await expect(page.getByLabel('隊長球隊').locator('option')).toHaveCount(2);
  await page.getByLabel('隊長球隊').selectOption('own');
  await page.getByRole('button', { name: '指派為球隊隊長', exact: true }).click();
  await expect(page.locator('.adm__captainAssignments')).toContainText('所屬球隊（隊長）');
  expect((await page.evaluate(() => window.__FAKE_CALLS))[0]).toEqual({ name: 'assignTeamCaptain', payload: { eventId: E, teamId: 'own', divisionId: 'u10', captainUid: UID, previousCaptainUid: null } });
  await page.getByLabel('隊長組別').selectOption('open');
  await expect(page.getByLabel('隊長球隊')).toHaveValue('');
  await expect(page.getByLabel('隊長球隊').locator('option')).toHaveCount(2);
});

test('鎖定失敗保留原狀並顯示原因，沒有假成功', async ({ page }) => {
  await stub(page, { roles: ['admin'] }); await page.goto('/#/my/teams');
  await page.evaluate(() => { window.__FAKE_CALL_ERROR = '伺服器拒絕操作'; });
  await page.getByRole('button', { name: '一鍵全鎖' }).click();
  await page.getByRole('button', { name: '全部上鎖', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('伺服器拒絕操作');
  await expect(page.locator('.adm__headSub')).toContainText('0 支已上鎖');
});
