/**
 * E2E｜Demo 切換身分
 * ------------------------------------------------------------------
 * 2026-09-03 回報：「Demo 切換身份沒有依據身份改變 demo 內容」。
 *
 * 根因是**時序**：`signInAnonymously()` 在寫入 staff 文件**之前**就觸發了
 * onAuthStateChanged，那一刻文件還不存在，`currentStaff` 停在 null——
 * 切了身分卻一個權限都沒有。畫面看起來只是「這個角色沒有功能」，
 * 不像壞掉，所以很難從症狀反推。
 *
 * 這一組守的就是「切完之後權限真的變了」，而且每一階看到的東西不一樣。
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';

const seed = () => ({
  [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
  // 自助身分只在這份文件為真的專案生效
  'config/env': { env: 'demo', allowSelfServeStaff: true },
  [`events/${EVENT}/divisions/u10`]: {
    divisionId: 'u10', name: 'U10兒童組', shortName: 'U10', officialName: '學童中年級',
    order: 3, playersOnField: 5, matchDurationMin: 25, periods: 1
  }
});

async function stub(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r =>
    r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());

  await page.addInitScript(({ s }) => {
    window.__FAKE_SEED = s;
    window.__seedData = s;
    window.__FAKE_USER = null;          // 一開始沒有登入
  }, { s: seed() });
}

async function go(page) {
  await page.goto('/#/');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

/**
 * 按「切換身分」→ 在 sheet 上選一個角色。
 *
 * ⚠️ 一定要比對**標籤本身**（.sheet__opt-main），不能用整顆選項的
 *    hasText：每一階的說明文字裡都寫著下一階的名字
 *    （管理員的說明是「記錄員 ＋ 覆核完賽…」），用 hasText 會選到錯的那一顆。
 */
async function switchTo(page, label) {
  await page.getByRole('button', { name: '切換身分' }).click();
  await page.locator('.sheet__opt').filter({
    has: page.locator('.sheet__opt-main', { hasText: new RegExp(`^${label}$`) })
  }).click();
  // 切完會導到專屬首頁
  await expect(page).toHaveURL(/#\/my$/, { timeout: 15_000 });
}

const hub = page => page.locator('.acct__card', { hasText: '我的功能' });

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('⭐ 切換身分之後權限真的生效（不是停在沒有身分）@demo', async ({ page }) => {
  // 這就是 2026-09-03 的回報。改動前 currentStaff 停在 null，
  // 專屬首頁完全不畫功能區——看起來像「這個角色沒有功能」。
  await stub(page);
  await go(page);
  await switchTo(page, '記錄員');

  await expect(page.locator('.acct__roles')).toHaveText('記錄員');
  await expect(hub(page)).toBeVisible();
  await expect(hub(page)).toContainText('賽務台');
});

test('⭐ 每一階看到的功能不一樣，而且高階含低階 @demo', async ({ page, context }) => {
  const count = async p => (await p.locator('.acct__tile').count()) + (await p.locator('.acct__soonList li').count());

  await stub(page);
  await go(page);
  await switchTo(page, '檢錄員');
  await expect(hub(page)).toBeVisible();
  const few = await count(page);
  await expect(hub(page)).toContainText('檢錄');
  await expect(hub(page)).not.toContainText('賽務台');

  const p2 = await context.newPage();
  await stub(p2);
  await go(p2);
  await switchTo(p2, '管理員');
  await expect(hub(p2)).toBeVisible();
  const many = await count(p2);

  expect(many).toBeGreaterThan(few);
  // 管理員繼承了檢錄員的職能，不必另外指派
  await expect(hub(p2)).toContainText('檢錄');
  await expect(hub(p2)).toContainText('報名審核');
  await p2.close();
});

test('⭐ 挑戰攤位只看得到挑戰區，看不到檢錄 @demo', async ({ page }) => {
  await stub(page);
  await go(page);
  await switchTo(page, '挑戰攤位');

  await expect(page.locator('.acct__roles')).toHaveText('挑戰攤位');
  await expect(hub(page)).toContainText('挑戰攤位');
  await expect(hub(page)).not.toContainText('檢錄');
});

test('切換身分的選單標出階層與 level @demo', async ({ page }) => {
  await stub(page);
  await go(page);
  await page.getByRole('button', { name: '切換身分' }).click();

  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('level 2.1');    // 挑戰攤位
  await expect(sheet).toContainText('level 4');      // 管理員
  // 大總管永遠不在自助清單上（R-RULES-003）
  await expect(sheet).not.toContainText('總管');
});

test('切換之後寫出的 staff 文件只有那一個角色（繼承是算出來的，不是存下來的）@demo', async ({ page }) => {
  // 存展開後的四個角色會讓「之後想調整階層」變成要重寫所有人的資料
  await stub(page);
  await go(page);
  await switchTo(page, '記錄員');

  const roles = await page.evaluate(() => {
    const d = window.__fake.__dump();
    const hit = Object.entries(d).find(([k]) => k.startsWith('staff/'));
    return hit ? hit[1].roles : null;
  });
  expect(roles).toEqual(['scorer']);
});
