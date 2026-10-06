import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { rosterProjection } from '../../js/engine/privacy.js';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const E = 'feda-cup-2026', B = `events/${E}`, T = 'youth-private', D = 'youth';
const players = [
  { memberId: 'p1', name: '王小明', nameKind: 'real', birthDate: '2016-03-14', jerseyNo: 144 },
  { memberId: 'p2', name: '周奕', nameKind: 'real', birthDate: '2019-03-25', jerseyNo: null }
];
async function open(page, route, admin = false) {
  const seed = { [B]: { dates: ['2026-10-09'] }, 'config/env': { env: 'demo' },
    'config/registration': { hidden: true, open: false },
    [`${B}/divisions/${D}`]: { name: '兒童組', order: 1, eligibility: { bornOnOrAfter: '2016-01-01' } },
    [`${B}/teams/${T}`]: { teamId: T, name: '隱私驗證隊', divisionId: D, source: 'csv', status: 'approved', publicRoster: true,
      memberCount: 2, playerCount: 2, captainUid: null, rosterLocked: true },
    'users/privacy-admin': { displayName: '管理員' }, 'staff/privacy-admin': { active: true, roles: ['admin'] } };
  for (const p of players) {
    seed[`${B}/teams/${T}/members/${p.memberId}`] = { ...p, kind: 'player', status: 'approved', source: 'csv', idLast4: '' };
    seed[`${B}/teams/${T}/roster/${p.memberId}`] = rosterProjection(p, { teamId: T, divisionId: D, asOf: '2026-10-09' });
  }
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());
  await page.addInitScript(({ seed, admin }) => { window.__FAKE_SEED = seed; window.__seedData = seed;
    window.__FAKE_USER = admin ? { uid: 'privacy-admin' } : null; }, { seed, admin });
  await page.goto(route);
}
test('公開隊伍與球員頁只顯示 O 遮蔽名，保留三位數與空白背號 @youthprivacy', async ({ page }) => {
  await open(page, `/#/team/${T}`);
  await expect(page.locator('.proster__name')).toHaveText(['王O明', '周O']);
  await expect(page.locator('.proster')).toContainText('144');
  for (const p of players) { await expect(page.locator('main')).not.toContainText(p.name); await expect(page.locator('main')).not.toContainText(p.birthDate); }
  await page.goto(`/#/player/${T}/p1`);
  await expect(page.locator('main')).toContainText('王O明');
  await expect(page.locator('main')).not.toContainText('王小明');
});
test('管理名冊仍顯示完整姓名與生日，公開投影維持遮蔽 @youthprivacy', async ({ page }) => {
  await open(page, '/#/admin/teams', true);
  await page.getByRole('tab', { name: /已通過/ }).click();
  await page.locator('.adm__itemHead').filter({ hasText: '隱私驗證隊' }).click();
  await expect(page.locator('.adm__memberName')).toHaveText(['王小明', '周奕']);
  const data = await page.evaluate(() => window.__fake.__dump());
  expect(data[`${B}/teams/${T}/members/p1`].name).toBe('王小明');
  expect(data[`${B}/teams/${T}/roster/p1`].displayName).toBe('王O明');
  expect(data[`${B}/teams/${T}/roster/p1`].birthDate).toBeUndefined();
});
