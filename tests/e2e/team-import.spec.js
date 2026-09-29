import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { IMPORT_COLUMNS } from '../../js/engine/team-import.js';
import { toCsv } from '../../js/engine/csv.js';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const E = 'feda-cup-2026', UID = 'u-import-admin';
const row = over => ({ divisionId: 'u10', teamName: '新球隊', shortName: '新隊', playerName: '小飛', jerseyNo: '7', birthDate: '2017-01-01', idLast4: '0012', isGoalkeeper: '否', isCaptain: '是', ...over });
const csv = rows => toCsv(IMPORT_COLUMNS.map(([key, label]) => ({ key, label })), rows);
async function stub(page, { roles = ['admin'], hidden = true } = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());
  await page.addInitScript(({ E, UID, roles, hidden }) => {
    window.__FAKE_USER = { uid: UID };
    window.__FAKE_SEED = {
      'config/registration': { open: true, hidden },
      'config/env': { env: 'demo' },
      [`staff/${UID}`]: { uid: UID, active: true, roles },
      [`events/${E}`]: { dates: ['2026-10-09'] },
      [`events/${E}/divisions/u10`]: { divisionId: 'u10', order: 1, name: '學童中年級', eligibility: { bornOnOrAfter: '2016-09-01' } },
      [`events/${E}/teams/existing`]: { teamId: 'existing', divisionId: 'u10', name: '既有隊', captainUid: UID, status: 'approved' }
    };
  }, { E, UID, roles, hidden });
}
async function upload(page, rows) {
  await page.getByLabel('上傳 CSV 球隊名冊').setInputFiles({ name: '名冊.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(rows)) });
}

test('Excel Big5 CSV 能辨識中文並預覽，不會誤報 UTF-8 @csvencoding', async ({ page }) => {
  await stub(page); await page.goto('/#/admin/team-import');
  const buffer = Buffer.concat([
    Buffer.from('divisionId,teamName,playerName,jerseyNo,birthDate,idLast4\r\nu10,'),
    Buffer.from('adb8b9462ca470adb8', 'hex'),
    Buffer.from(',7,2017-01-01,0012\r\n')
  ]);
  await page.getByLabel('上傳 CSV 球隊名冊').setInputFiles({ name: 'Excel名冊.csv', mimeType: 'text/csv', buffer });
  await expect(page.getByText('匯入預覽：1 支球隊、1 位球員')).toBeVisible();
  await expect(page.locator('.adm__importTeam summary')).toContainText('飛達');
  await expect(page.getByText(/讀取編碼：Big5/)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('CSV 文字編碼').selectOption('utf-8');
  await expect(page.getByRole('alert')).toContainText('無法使用所選編碼');
  await expect(page.getByText('匯入預覽：1 支球隊、1 位球員')).toHaveCount(0);
  await page.getByLabel('CSV 文字編碼').selectOption('big5');
  await expect(page.getByText('匯入預覽：1 支球隊、1 位球員')).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '匯入並核准球隊' }).click();
  await page.getByRole('button', { name: '確認匯入', exact: true }).click();
  await expect(page.getByText('匯入完成：1 支球隊、1 位球員，已通過。')).toBeVisible();
  expect((await page.evaluate(() => window.__FAKE_CALLS))[0].payload.csv).toContain('飛達,小飛');
});

for (const encoding of ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be']) {
  test(`Excel ${encoding} CSV 保留中文與開頭 0 @csvencoding`, async ({ page }) => {
    await stub(page); await page.goto('/#/admin/team-import');
    const content = csv([row()]);
    const buffer = encoding.startsWith('utf-16') ? Buffer.from(content, 'utf16le')
      : Buffer.from(encoding === 'utf-8' ? content.replace(/^\uFEFF/, '') : content);
    if (encoding === 'utf-16be') buffer.swap16();
    await page.getByLabel('上傳 CSV 球隊名冊').setInputFiles({ name: 'Excel名冊.csv', mimeType: 'text/csv', buffer });
    await expect(page.getByText('匯入預覽：1 支球隊、1 位球員')).toBeVisible();
    await page.locator('.adm__importTeam summary').click();
    await expect(page.getByText(/#7 小飛.*末四碼 0012/)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
test('瀏覽器 arrayBuffer 拋 TypeError 仍可讀取 UTF-8；真正讀檔失敗不叫人另存 @csvencoding', async ({ page }) => {
  await stub(page); await page.goto('/#/admin/team-import');
  await page.evaluate(() => { Blob.prototype.arrayBuffer = async () => { throw new TypeError('File API unavailable'); }; });
  await upload(page, [row()]);
  await expect(page.getByText('匯入預覽：1 支球隊、1 位球員')).toBeVisible();
  await page.evaluate(() => { FileReader.prototype.readAsArrayBuffer = () => { throw new DOMException('read failed', 'NotReadableError'); }; });
  await upload(page, [row()]);
  await expect(page.getByRole('alert')).toContainText('讀不到這個檔案');
  await expect(page.getByRole('alert')).not.toContainText('UTF-8');
  await expect(page.getByText('匯入預覽：1 支球隊、1 位球員')).toHaveCount(0);
});
test('驗證 TypeError 與壞掉的 UTF-8 分開提示 @csvencoding', async ({ page }) => {
  await stub(page); await page.goto('/#/admin/team-import');
  await page.getByLabel('上傳 CSV 球隊名冊').setInputFiles({ name: '壞檔.csv', mimeType: 'text/csv', buffer: Buffer.from([0xef, 0xbb, 0xbf, 0xff]) });
  await expect(page.getByRole('alert')).toContainText('無法完整解碼');
  await page.evaluate(() => { String.prototype.normalize = () => { throw new TypeError('欄位驗證失敗'); }; });
  await upload(page, [row()]);
  await expect(page.getByRole('alert')).toContainText('CSV 內容檢查失敗：欄位驗證失敗');
  await expect(page.getByRole('alert')).not.toContainText('UTF-8');
});
test('多隊預覽、確認後才呼叫後端，成功可前往賽程 @admin', async ({ page }) => {
  await stub(page);
  await page.goto('/#/admin/team-import');
  await expect(page.getByRole('table')).toContainText('2017-01-01');
  await expect(page.getByRole('table')).toContainText('0012');
  await expect(page.getByRole('table')).toContainText('未滿 18 歲填暱稱');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載 CSV 範本' }).click();
  expect((await download).suggestedFilename()).toBe('球隊名冊匯入範本.csv');
  await upload(page, [row(), row({ teamName: '第二隊', idLast4: '9999' })]);
  await expect(page.getByText('匯入預覽：2 支球隊、2 位球員')).toBeVisible();
  await page.locator('.adm__importTeam summary').first().click();
  await expect(page.getByText(/末四碼 0012/)).toBeVisible();
  await expect(page.getByRole('button', { name: '匯入並核准球隊' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '匯入並核准球隊' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => window.__FAKE_CALLS ?? [])).toEqual([]);
  await page.getByRole('button', { name: '確認匯入', exact: true }).click();
  await expect(page.getByText('匯入完成：2 支球隊、2 位球員，已通過。')).toBeVisible();
  const calls = await page.evaluate(() => window.__FAKE_CALLS);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ name: 'importTeamsCsv', payload: { eventId: E, confirmed: true } });
  await expect(page.getByRole('link', { name: '前往賽程管理' })).toHaveAttribute('href', '#/admin/schedule');
});
test('壞資料和既有隊不會送出，可修正重傳，文字安全顯示 @admin', async ({ page }) => {
  await stub(page); await page.goto('/#/admin/team-import');
  await upload(page, [row({ teamName: '既有隊', birthDate: '2010-01-01' })]);
  await expect(page.getByRole('alert')).toContainText('不能重複匯入');
  await expect(page.getByRole('button', { name: '匯入並核准球隊' })).toBeDisabled();
  await upload(page, [row({ teamName: '<img src=x onerror=alert(1)>' })]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.adm__importTeam summary')).toContainText('<img');
  await expect(page.locator('.adm__importTeam img')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
test('失敗顯示錯誤而不假成功，離線不能送出 @admin', async ({ page }) => {
  await stub(page); await page.goto('/#/admin/team-import');
  await upload(page, [row()]); await page.getByRole('checkbox').check();
  await page.evaluate(() => { window.__FAKE_CALL_ERROR = '伺服器拒絕：名冊重複'; });
  await page.getByRole('button', { name: '匯入並核准球隊' }).click();
  await page.getByRole('button', { name: '確認匯入', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('名冊重複');
  await expect(page.getByText(/匯入完成/)).toHaveCount(0);
  await page.context().setOffline(true);
  await expect(page.getByRole('button', { name: '匯入並核准球隊' })).toBeDisabled();
});
test('一般使用者無權匯入 @admin', async ({ page }) => {
  await stub(page, { roles: ['scorer'] }); await page.goto('/#/admin/team-import');
  await expect(page.locator('.adm')).toContainText('管理員');
  await expect(page.getByLabel('上傳 CSV 球隊名冊')).toHaveCount(0);
});
for (const route of ['/register', '/register/new', '/join/ABC123', '/team/existing/manage']) {
  test(`已隱藏的舊連結會顯示關閉：${route}`, async ({ page }) => {
    await stub(page); await page.goto('/#' + route);
    await expect(page.getByRole('heading', { name: '線上報名已關閉' })).toBeVisible();
    await expect(page.locator('input')).toHaveCount(0);
  });
}
test('我的頁面隱藏報名入口，已有球隊連到公開頁', async ({ page }) => {
  await stub(page, { roles: [] }); await page.goto('/#/my');
  await expect(page.getByRole('button', { name: /既有隊/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /我要報名|前往報名/ })).toHaveCount(0);
  await page.getByRole('button', { name: /既有隊/ }).click();
  await expect(page).toHaveURL(/#\/team\/existing$/);
  await expect(page.getByRole('button', { name: '管理名單／審核申請' })).toHaveCount(0);
});
test('已開啟的報名頁收到隱藏設定後立即離開表單', async ({ page }) => {
  await stub(page, { hidden: false }); await page.goto('/#/register');
  await expect(page.locator('.reg')).toBeVisible();
  await page.evaluate(() => window.__fake.__seed({ 'config/registration': { open: false, hidden: true } }));
  await expect(page.getByRole('heading', { name: '線上報名已關閉' })).toBeVisible();
});
