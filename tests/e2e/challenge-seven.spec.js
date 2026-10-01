import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { CHALLENGES, buildSeed } from '../../scripts/seed/build.js';

const EVENT = 'feda-cup-2026', PID = 'FEDA-0182', UID = 'u-seven-booth';
const fake = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const rewards = buildSeed().docs.find(d => d.path === 'config/challengeRewards').data;
const ids = rewards.requiredChallengeIds;

async function setup(page, { done = 0, entries = 0, version = rewards.version, booth = false, theme = 'light' } = {}) {
  const seed = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP' },
    'config/env': { env: 'demo' }, 'config/challengeRewards': rewards,
    [`events/${EVENT}/players/${PID}`]: { playerId: PID, eventId: EVENT, nickname: '測試玩家',
      completedChallengeIds: ids.slice(0, done), luckyDrawEntries: entries, luckyDrawRuleVersion: version, createdVia: 'staff' },
    [`staff/${UID}`]: { uid: UID, roles: ['booth'], active: true, assignment: { eventId: EVENT, challengeIds: ids } },
    [`users/${UID}`]: { uid: UID, displayName: '現場工作人員' }
  };
  for (const c of CHALLENGES) seed[`events/${EVENT}/challenges/${c.challengeId}`] = c;
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: fake }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.addInitScript(({ seed, pid, uid, booth, theme }) => {
    window.__FAKE_SEED = seed;
    window.__seedData = seed;
    window.__FAKE_USER = booth ? { uid, displayName: '現場工作人員' } : null;
    localStorage.setItem('feda:gamePass', JSON.stringify({ playerId: pid, nickname: '測試玩家' }));
    localStorage.setItem('feda_theme', theme);
  }, { seed, pid: PID, uid: UID, booth, theme });
}

const boot = page => page.waitForFunction(() => !!window.__fake);
async function lookup(page) {
  await page.locator('#booth-id').fill(PID);
  await page.getByRole('button', { name: /查詢/ }).click();
  await expect(page.locator('.booth__nick')).toBeVisible();
}
const attempts = page => page.evaluate(() => Object.entries(window.__fake.__dump())
  .filter(([p]) => p.includes('/attempts/')).map(([, a]) => a));

test('七項清單、規則、六項進度與手機集章 @challenge', async ({ page }, info) => {
  await setup(page, { done: 6 });
  await page.goto('/#/challenge'); await boot(page);
  await expect(page.locator('.chal__item')).toHaveCount(7);
  await expect(page.locator('.chal__itemScore').nth(5)).toHaveText('已簽到');
  await expect(page.locator('.chal__list')).not.toContainText('未挑戰');
  await expect(page.locator('.chal')).toContainText('中醫問診');
  await expect(page.locator('.chal')).toContainText('一球三桶');
  await expect(page.locator('.chal__heroSub')).toHaveText('七項集章，全數完成才有抽獎機會');
  await expect(page.locator('.chal__stamps [data-done="true"]')).toHaveCount(6);
  await expect(page.locator('.chal')).toContainText('再完成 1 項');
  await expect(page.locator('.chal')).toContainText('目前有 0 張抽獎資格');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('seven-stamps-light.png'), fullPage: true });
});

test('七項全完成顯示一次資格，深色手機不溢出 @challenge', async ({ page }, info) => {
  await setup(page, { done: 7, entries: 1, theme: 'dark' });
  await page.goto('/#/challenge/me'); await boot(page);
  await expect(page.locator('.chal__card--draw')).toContainText('已取得 1 次抽獎機會');
  await expect(page.locator('.chal__count').first()).toHaveText('7 / 7');
  await expect(page.locator('.chal__item')).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('seven-qualified-dark.png'), fullPage: true });
});

test('舊五關七張的版本未重算前，不能呈現有效抽獎資格 @challenge', async ({ page }) => {
  await setup(page, { done: 5, entries: 7, version: null });
  await page.goto('/#/challenge/me'); await boot(page);
  await expect(page.locator('.chal__card--draw')).toContainText('尚未取得抽獎資格');
  await expect(page.locator('.chal__card--draw')).toContainText('還差 2 項');
  await expect(page.locator('.chal__card--draw')).not.toContainText('7 張');
});

test('中醫確認現場簽到後可登錄，沒有分數鍵盤 @booth', async ({ page }) => {
  await setup(page, { booth: true });
  await page.goto(`/#/booth/${ids[5]}`); await boot(page); await lookup(page);
  const submit = page.getByRole('button', { name: '送出簽到', exact: true });
  await expect(submit).toBeDisabled();
  await expect(page.locator('.booth__numpad')).toHaveCount(0);
  await page.getByRole('button', { name: '確認玩家已到現場', exact: true }).click();
  await expect(submit).toBeEnabled(); await submit.click();
  await expect.poll(async () => (await attempts(page)).length).toBe(1);
  expect((await attempts(page))[0]).toMatchObject({ challengeId: ids[5], rawValue: 1, detail: null, staffUid: UID });
  await expect(page.locator('.booth')).toContainText('簽到已登錄');
});

test('一球三桶每球成功失敗選完才能送出，儲存三球細項 @booth', async ({ page }) => {
  await setup(page, { booth: true });
  await page.goto(`/#/booth/${ids[6]}`); await boot(page); await lookup(page);
  const submit = page.getByRole('button', { name: '送出成績', exact: true });
  await expect(submit).toBeDisabled();
  const shots = page.locator('.booth__shotRow'); await expect(shots).toHaveCount(3);
  await shots.nth(0).getByRole('button', { name: '三桶全倒', exact: true }).click();
  await shots.nth(1).getByRole('button', { name: '失敗', exact: true }).click();
  await expect(submit).toBeDisabled();
  await shots.nth(2).getByRole('button', { name: '三桶全倒', exact: true }).click();
  await expect(submit).toBeEnabled(); await submit.click();
  await expect.poll(async () => (await attempts(page)).length).toBe(1);
  expect((await attempts(page))[0]).toMatchObject({ challengeId: ids[6], rawValue: 2, detail: [1, 0, 1] });
});

test('中醫項目顯示簽到規則並且不顯示排行榜 @challenge', async ({ page }) => {
  await setup(page);
  await page.goto(`/#/challenge/board/${ids[5]}`); await boot(page);
  await expect(page.locator('.chal')).toContainText('此項不計分、不排名');
  await expect(page.locator('.chal__board')).toHaveCount(0);
});
