/**
 * E2E｜報名開關 `#/admin/registration`
 * ------------------------------------------------------------------
 * 規格：docs/10 §2.3、R-REG-002
 *
 * 守四件事：
 *   ・**最上面顯示「現在到底開不開放」**，不是只顯示那個開關
 *     （開放條件是 AND，只看開關會誤判）
 *   ・**關掉之前先講後果**
 *   ・**日期用民國年**，而且把西元也印出來對帳
 *   ・**人數上限與費用不能在這裡改**（照規章第十二條）
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'U7774e1410479bafff4997f51b2c47b95';
const T = iso => ({ seconds: Math.floor(Date.parse(iso) / 1000), nanoseconds: 0 });

const REG = {
  open: true,
  opensAt: T('2026-09-01T00:00:00+08:00'),
  closesAt: T('2026-09-14T00:00:00+08:00'),
  maxTeamsPerAccount: 3, maxMembers: 15, maxStaff: 3,
  fee: { youth: 5000, adult: 6000 }
};

const seed = ({ roles = ['super_admin'], reg = REG } = {}) => {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo' },
    [`users/${UID}`]: { uid: UID, displayName: '金小麥' },
    [`staff/${UID}`]: {
      uid: UID, name: '金小麥', roles, active: true,
      assignment: { eventId: EVENT, venueIds: [], divisionIds: [], challengeIds: [] }
    },
    [`events/${EVENT}/divisions/u10`]: { divisionId: 'u10', name: 'U10兒童組', order: 3, date: '2026-10-09' }
  };
  if (reg) s['config/registration'] = reg;
  return s;
};

async function stub(page, opts = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r =>
    r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.addInitScript(({ s, u }) => {
    window.__FAKE_SEED = s;
    window.__seedData = s;
    window.__FAKE_USER = { uid: u, displayName: '金小麥' };
  }, { s: seed(opts), u: UID });
}

async function go(page) {
  await page.goto('/#/admin/registration');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

const dump = page => page.evaluate(() => window.__fake.__dump());
const cfgOf = async page => (await dump(page))['config/registration'];
/** 斷言「不存在」之前先等頁面真的畫出來 */
const ready = page => expect(page.locator('.adm__switch')).toBeVisible({ timeout: 15_000 });

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('⭐ 管理員進不來，而且看得到原因 @admin', async ({ page }) => {
  await stub(page, { roles: ['admin'] });
  await go(page);
  await expect(page.locator('.adm__box--warn')).toContainText('報名開關');
  await expect(page.locator('.adm__box--warn')).toContainText('總管');
  await expect(page.locator('.adm__switch')).toHaveCount(0);
});

test('⭐ 最上面顯示現在到底開不開放 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await expect(page.locator('.adm__box--ok')).toContainText('報名開放中');
  await expect(page.locator('.adm__box--ok')).toContainText('家長現在送得出報名');
});

test('⭐ 開關是開的，但過了截止日就顯示關閉中 @admin', async ({ page }) => {
  // 開放條件是 AND。只看那個開關會讓主辦以為還開著。
  await stub(page, { reg: { ...REG, closesAt: T('2020-01-01T00:00:00+08:00') } });
  await go(page);
  await expect(page.locator('.adm__box--warn')).toContainText('報名關閉中');
  await expect(page.locator('.adm__box--warn')).toContainText('已經截止');
  // 開關本身仍然是開的——畫面要能同時表達這兩件事
  await expect(page.locator('.adm__switch')).toHaveAttribute('aria-checked', 'true');
});

test('⭐ 還沒到開始時間也是關閉中 @admin', async ({ page }) => {
  await stub(page, { reg: { ...REG, opensAt: T('2099-01-01T00:00:00+08:00') } });
  await go(page);
  await expect(page.locator('.adm__box--warn')).toContainText('還沒開始');
});

test('⭐ 設定文件不存在時是關閉中（fail-closed）@admin', async ({ page }) => {
  await stub(page, { reg: null });
  await go(page);
  await expect(page.locator('.adm__box--warn')).toContainText('報名關閉中');
  await expect(page.locator('.adm__box--warn')).toContainText('還沒建立');
});

test('⭐ 日期用民國年，而且把西元也印出來對帳 @admin', async ({ page }) => {
  // R-REG-002：民國年只存在畫面上，資料庫一律西元
  await stub(page);
  await go(page);
  await expect(page.locator('#reg-closes')).toHaveValue('115');          // 民國 115 年
  await expect(page.locator('.adm__field', { hasText: '截止日期' })).toContainText('西元 2026-09-14');
});

test('⭐ 沒改就不能按儲存 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await expect(page.getByRole('button', { name: /^儲存$/ })).toBeDisabled();
});

test('⭐ 關掉之前先講後果，取消就什麼都不寫 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await page.locator('.adm__switch').click();
  // 狀態框顯示的是**已儲存**的狀態（仍是開放中），另外加一句「儲存之後會…」
  await expect(page.locator('.adm__box--ok')).toContainText('報名開放中');
  await expect(page.locator('.adm__box--ok')).toContainText('儲存之後會變成「關閉中」');

  await page.getByRole('button', { name: /^儲存$/ }).click();
  await expect(page.locator('.modal')).toContainText('家長會立刻送不出報名');
  await page.locator('.modal').getByRole('button', { name: /取消/ }).click();

  expect((await cfgOf(page)).open).toBe(true);
});

test('⭐ 關掉會寫進去，而且不動人數與費用 @admin', async ({ page }) => {
  // 整份覆蓋會把規章那幾個欄位一起抹掉，而抹掉之後畫面看起來完全正常
  await stub(page);
  await go(page);
  await page.locator('.adm__switch').click();
  await page.getByRole('button', { name: /^儲存$/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^關閉報名$/ }).click();

  await expect.poll(async () => (await cfgOf(page))?.open, { timeout: 10_000 }).toBe(false);
  const c = await cfgOf(page);
  expect(c.maxMembers).toBe(15);           // 規章那幾個原封不動
  expect(c.maxStaff).toBe(3);
  expect(c.fee.youth).toBe(5000);
  expect(c.maxTeamsPerAccount).toBe(3);
});

test('打開不需要確認 @admin', async ({ page }) => {
  await stub(page, { reg: { ...REG, open: false } });
  await go(page);
  await page.locator('.adm__switch').click();
  await page.getByRole('button', { name: /^儲存$/ }).click();

  await expect.poll(async () => (await cfgOf(page))?.open, { timeout: 10_000 }).toBe(true);
  await expect(page.locator('.modal')).toHaveCount(0);
});

test('⭐ 每一次調整都留痕 @admin', async ({ page }) => {
  await stub(page, { reg: { ...REG, open: false } });
  await go(page);
  await page.locator('.adm__switch').click();
  await page.getByRole('button', { name: /^儲存$/ }).click();

  await expect.poll(async () => {
    const d = await dump(page);
    return Object.keys(d).filter(k => k.includes('/audits/')).length;
  }, { timeout: 10_000 }).toBe(1);

  const d = await dump(page);
  const a = Object.entries(d).find(([k]) => k.includes('/audits/'))[1];
  expect(a.action).toBe('registration.update');
  expect(a.entityId).toBe('registration');
  expect(a.before.open).toBe(false);
  expect(a.after.open).toBe(true);
  expect(a.actor.uid).toBe(UID);
});

test('⭐ 起訖顛倒會提醒，但仍然存得下去 @admin', async ({ page }) => {
  // 規章沒寫的事情不要升成錯誤——系統不該替主辦訂一條規章沒有的規則
  await stub(page);
  await go(page);
  await page.locator('#reg-opens').fill('120');           // 民國 120 年開始
  await expect(page.locator('.adm__check--warn')).toContainText('報名永遠不會開放');
  await expect(page.getByRole('button', { name: /^儲存$/ })).toBeEnabled();
});

test('截止晚於第一個比賽日會提醒 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await page.locator('#reg-closes').fill('116');          // 民國 116 年＝2027
  await expect(page.locator('.adm__check--warn')).toContainText('晚於第一個比賽日');
});

test('⭐ 人數上限與費用不能在這裡改 @admin', async ({ page }) => {
  // R-REG-001：那些照規章第十二條，權威在 js/engine/formats.js
  await stub(page);
  await go(page);
  await ready(page);
  await expect(page.locator('.adm')).toContainText('照競賽規章，不能在這裡改');
  await expect(page.locator('.adm')).toContainText('球員最多 15 人');
  await expect(page.locator('input[type=number]')).toHaveCount(0);
});

test('放棄變更會回到儲存的值 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await page.locator('.adm__switch').click();
  await expect(page.locator('.adm__switch')).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: /放棄變更/ }).click();
  await expect(page.locator('.adm__switch')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: /^儲存$/ })).toBeDisabled();
});

test('⭐ 320px 不出現橫向捲軸 @admin @narrow', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  const over = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth <= d.clientWidth ? null : { scroll: d.scrollWidth, client: d.clientWidth };
  });
  expect(over).toBeNull();
});
