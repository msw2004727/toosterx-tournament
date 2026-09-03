/**
 * E2E｜專屬首頁 `#/my`
 * ------------------------------------------------------------------
 * 主辦 2026-09-03 指定的資訊架構：
 *   登入後落在 `#/my`，內容依身分展開（層級越高功能越多），
 *   底下一定有登出，球隊區叫「我的球隊」。
 *
 * 這一組守的是「看得到什麼」——多一格或少一格都不會報錯，
 * 只會在現場變成「我怎麼沒有這個功能」或「我怎麼點得到這個」。
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'U7774e1410479bafff4997f51b2c47b95';

const seed = ({ roles = null, perms = null } = {}) => {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo' },
    [`users/${UID}`]: { uid: UID, displayName: '金小麥', pictureUrl: null },
    [`events/${EVENT}/teams/t-1`]: {
      teamId: 't-1', name: '大甲金剛足球隊', divisionId: 'u10',
      captainUid: UID, status: 'draft', memberCount: 3
    }
  };
  if (roles) {
    s[`staff/${UID}`] = {
      uid: UID, name: '金小麥', roles, active: true,
      assignment: { eventId: EVENT, venueIds: ['venue-a'], divisionIds: [], challengeIds: [] }
    };
  }
  if (perms) for (const [role, p] of Object.entries(perms)) s[`rolePermissions/${role}`] = { role, perms: p };
  return s;
};

async function stub(page, opts = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r =>
    r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());

  await page.addInitScript(({ s, signedIn }) => {
    window.__FAKE_SEED = s;
    window.__seedData = s;
    window.__FAKE_USER = signedIn ? { uid: 'U7774e1410479bafff4997f51b2c47b95', displayName: '金小麥' } : null;
  }, { s: seed(opts), signedIn: opts.signedIn !== false });
}

async function go(page) {
  await page.goto('/#/my');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

const tiles = page => page.locator('.acct__tile');
const soon = page => page.locator('.acct__soonList li');

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('⭐ 一般使用者只看到球隊與登出，沒有功能區 @my', async ({ page }) => {
  // 「層級越高功能越多」的另一端：沒有身分的人不該看到任何賽務入口。
  await stub(page);
  await go(page);

  await expect(page.locator('.acct')).toContainText('我的球隊');
  await expect(page.locator('.acct')).toContainText('大甲金剛足球隊');
  await expect(page.getByRole('button', { name: '登出' })).toBeVisible();
  await expect(page.locator('.acct__card', { hasText: '我的功能' })).toHaveCount(0);
});

test('⭐ 「我帶的球隊」已改名為「我的球隊」@my', async ({ page }) => {
  await stub(page);
  await go(page);
  await expect(page.locator('.acct')).toContainText('我的球隊');
  await expect(page.locator('.acct')).not.toContainText('我帶的球隊');
});

test('⭐ 檢錄員看得到檢錄，但看不到賽務台 @my', async ({ page }) => {
  await stub(page, { roles: ['checkin'] });
  await go(page);

  const hub = page.locator('.acct__card', { hasText: '我的功能' });
  await expect(hub).toContainText('檢錄');
  await expect(hub).not.toContainText('賽務台');
  await expect(hub).not.toContainText('出場名單');
});

test('⭐ 記錄員的功能比檢錄員多（向上包含）@my', async ({ page, context }) => {
  await stub(page, { roles: ['checkin'] });
  await go(page);
  // 等功能區真的畫出來再數——evaluate/count 不會等
  await expect(page.locator('.acct__card', { hasText: '我的功能' })).toBeVisible();
  const few = await tiles(page).count() + await soon(page).count();

  const p2 = await context.newPage();
  await stub(p2, { roles: ['scorer'] });
  await go(p2);
  await expect(p2.locator('.acct__card', { hasText: '我的功能' })).toBeVisible();
  const many = await tiles(p2).count() + await soon(p2).count();

  expect(many).toBeGreaterThan(few);
  // 記錄員仍然看得到檢錄（繼承來的）
  await expect(p2.locator('.acct__card', { hasText: '我的功能' })).toContainText('檢錄');
  await p2.close();
});

test('⭐ 總管看得到最多，包含身分授權與權限開關 @my', async ({ page }) => {
  await stub(page, { roles: ['super_admin'] });
  await go(page);

  const hub = page.locator('.acct__card', { hasText: '我的功能' });
  await expect(hub).toContainText('身分授權');
  await expect(hub).toContainText('權限開關');
  await expect(hub).toContainText('報名開關');
});

test('⭐ 身分列只顯示最高身分，不列出繼承來的一長串 @my', async ({ page }) => {
  // 記錄員看到「挑戰攤位、檢錄員、裁判、記錄員」會以為自己被指派了一堆職務
  await stub(page, { roles: ['scorer'] });
  await go(page);
  const roles = page.locator('.acct__roles');
  await expect(roles).toHaveText('記錄員');
});

test('⭐ 還沒做的功能畫成說明列，不是按不動的按鈕 @my', async ({ page }) => {
  // 按了沒反應是最難回報的故障；完全不顯示又會讓人以為身分沒生效。
  await stub(page, { roles: ['admin'] });
  await go(page);

  await expect(soon(page).first()).toContainText('規劃中');
  // 「規劃中」的那幾列不可以是按鈕
  const buttons = await page.locator('.acct__soonList button').count();
  expect(buttons).toBe(0);
});

test('⭐ 總管把某一項關掉，那顆功能就不見了 @my', async ({ page }) => {
  // 「每一個獨立功能都要有權限開關」。這裡驗矩陣真的接上畫面。
  await stub(page, { roles: ['scorer'], perms: { scorer: { 'match.score.write': false } } });
  await go(page);

  const hub = page.locator('.acct__card', { hasText: '我的功能' });
  await expect(hub).toContainText('檢錄');
  await expect(hub).not.toContainText('賽務台');
});

test('⭐ 讀不到權限矩陣時走預設，不是全部消失 @my', async ({ page }) => {
  // 設定讀取失敗的當下把賽務按鈕全部收掉，現場會以為系統壞了
  await stub(page, { roles: ['scorer'] });          // 完全沒有 rolePermissions 文件
  await go(page);
  await expect(page.locator('.acct__card', { hasText: '我的功能' })).toContainText('賽務台');
});

test('未登入時導向登入而不是空白頁 @my', async ({ page }) => {
  await stub(page, { signedIn: false });
  await go(page);
  await expect(page.locator('#app-view')).toContainText(/登入/);
});
