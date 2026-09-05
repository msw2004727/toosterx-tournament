/**
 * E2E｜LINE 登入與「我的」
 * ------------------------------------------------------------------
 * 規格：docs/10 §1.4、docs/04 §2
 *
 * 這一組守的重點不是「登入會成功」——真正的 LINE 授權沒辦法在測試裡跑。
 * 守的是**失敗時不會假裝可用**：
 *   ・LIFF SDK 載不到 → 說清楚哪裡壞了，而不是留一顆按不動的按鈕
 *   ・還沒登入看「我的」→ 明確請你去登入，而不是一片空白或假裝你沒有球隊
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'U7774e1410479bafff4997f51b2c47b95';

/** LIFF SDK 的替身。loggedIn=true 模擬「剛從 LINE 授權回來」。 */
const liffStub = (loggedIn = false) => `window.liff = {
  init: () => Promise.resolve(),
  isInClient: () => false,
  isLoggedIn: () => ${loggedIn},
  login: () => { window.__liffLoginCalled = true; },
  getIDToken: () => 'fake-id-token',
  logout: () => { window.__liffLogoutCalled = true; }
};`;

const seed = () => ({
  [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
  'config/env': { env: 'demo' },
  [`events/${EVENT}/teams/t-1`]: {
    teamId: 't-1', name: '大甲金剛足球隊', divisionId: 'u10',
    captainUid: UID, status: 'submitted', memberCount: 9
  },
  [`events/${EVENT}/teams/t-2`]: {
    teamId: 't-2', name: '別人的隊', divisionId: 'u10',
    captainUid: 'u-someone-else', status: 'approved', memberCount: 11
  },
  // LINE 名稱與頭像的權威在這裡，不在 Firebase 的使用者身上
  [`users/${UID}`]: { uid: UID, displayName: '金小麥', pictureUrl: null, roles: [] }
});

async function stub(page, { sdkOk = true, user = null, lineLoggedIn = false, loginFails = false } = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r =>
    r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  // LIFF SDK：成功時回一個替身，失敗時直接讓請求掛掉（模擬連不到 LINE）
  await page.route('https://static.line-scdn.net/**', r =>
    sdkOk
      ? r.fulfill({ status: 200, contentType: 'text/javascript', body: liffStub(lineLoggedIn) })
      : r.abort());

  await page.addInitScript(({ s, u, fail }) => {
    window.__FAKE_SEED = s;
    window.__FAKE_USER = u;
    window.__seedData = s;
    window.__FAKE_CALL_ERROR = fail ? 'lineLogin 沒有回傳 customToken' : null;
  }, { s: seed(), u: user, fail: loginFails });
}

async function go(page, hash) {
  await page.goto(hash);
  // 給寬一點：偶發紅燈比慢一點危險得多（久了大家會開始無視 CI）。
  // 靜態站由 scripts/dev-server.mjs 服務，併發數在 playwright.config.js 限制。
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

/* ══════════════════════════════════════════════════════════════
   登入頁
   ══════════════════════════════════════════════════════════════ */

test('⭐ 登入頁有一顆 LINE 登入鈕，並說明會取得什麼 @account', async ({ page }) => {
  await stub(page);
  await go(page, '/#/login');

  await expect(page.getByRole('button', { name: /使用 LINE 登入/ })).toBeVisible();
  // 授權範圍要講在按下去之前，不是之後
  await expect(page.locator('.acct')).toContainText('不會拿到你的聯絡方式');
});

test('⭐ LIFF SDK 載不到時說清楚哪裡壞了，不留一顆按不動的按鈕 @account', async ({ page }) => {
  await stub(page, { sdkOk: false });
  await go(page, '/#/login');

  await expect(page.locator('.acct__box--warn')).toContainText('現在沒辦法用 LINE 登入');
  await expect(page.getByRole('button', { name: /再試一次/ })).toBeVisible();
  // 最重要的一條：不可以同時還留著登入鈕
  await expect(page.getByRole('button', { name: /使用 LINE 登入/ })).toHaveCount(0);
});

test('尚未授權時按登入會走 liff.login（會離開這一頁）@account', async ({ page }) => {
  await stub(page);
  await go(page, '/#/login');
  await page.getByRole('button', { name: /使用 LINE 登入/ }).click();
  await expect.poll(() => page.evaluate(() => window.__liffLoginCalled === true)).toBe(true);
});

/* ══════════════════════════════════════════════════════════════
   我的
   ══════════════════════════════════════════════════════════════ */

test('⭐ 還沒登入看「我的」會請你去登入，不是一片空白 @account', async ({ page }) => {
  await stub(page);
  await go(page, '/#/my');

  await expect(page.locator('.acct__box--warn')).toContainText('請先用 LINE 登入');
  // 不可以顯示「你還沒有建立球隊」——那會讓人以為自己的球隊不見了
  await expect(page.locator('.acct')).not.toContainText('你還沒有建立球隊');
});

test('⭐ 登入後看得到自己的 uid（跨專案對帳唯一的鍵）@account', async ({ page }) => {
  await stub(page, { user: { uid: UID, displayName: '小麥', photoURL: null } });
  await go(page, '/#/my');

  await expect(page.locator('.acct__uidValue')).toHaveText(UID);
  await expect(page.locator('.acct')).toContainText('小麥');
});

test('⭐ 只列出自己帶的球隊，不會列到別人的 @account', async ({ page }) => {
  await stub(page, { user: { uid: UID, displayName: '小麥', photoURL: null } });
  await go(page, '/#/my');

  await expect(page.locator('.acct__row')).toHaveCount(1);
  await expect(page.locator('.acct__row')).toContainText('大甲金剛足球隊');
  await expect(page.locator('.acct')).not.toContainText('別人的隊');
  await expect(page.locator('.acct__badge')).toHaveText('待主辦審核');
});

test('沒有球隊時給一條往報名的路，而不是空白卡片 @account', async ({ page }) => {
  await stub(page, { user: { uid: 'u-nobody', displayName: '路人', photoURL: null } });
  await go(page, '/#/my');

  await expect(page.locator('.acct')).toContainText('你還沒有建立球隊');
  await expect(page.getByRole('button', { name: /我要報名球隊/ })).toBeVisible();
});

test('⭐ 320px 不出現橫向捲軸（uid 很長，最容易在這裡撐破）@account @narrow', async ({ page }) => {
  await stub(page, { user: { uid: UID, displayName: '小麥', photoURL: null } });
  await go(page, '/#/my');

  const over = await page.evaluate(() => {
    const d = document.documentElement;
    if (d.scrollWidth <= d.clientWidth) return null;
    const bad = [...document.querySelectorAll('*')]
      .filter(n => n.getBoundingClientRect().right > d.clientWidth + 1)
      .map(n => `${n.tagName}.${n.className}`);
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, bad: bad.slice(0, 5) };
  });
  expect(over).toBeNull();
});

test('⭐ 從 LINE 授權回來時要自動完成登入，不可以又叫人按一次 @account', async ({ page }) => {
  // liff.login() 會離開這一頁，授權後導回來是**全新的一次載入**：
  // LINE 那側已經登入、Firebase 這側還沒。第一版少了自動換發，
  // 使用者授權完只看到同一顆按鈕，實測時 lineLogin 一次都沒被呼叫到。
  await stub(page, { lineLoggedIn: true });
  await go(page, '/#/login');

  // 換發成功之後會走到「我的」
  await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toBe('#/my');
});

test('⭐ 換發失敗時錯誤要留在畫面上，不是跳一下就消失 @account', async ({ page }) => {
  // 「按了沒反應」是最難回報的故障。原因必須留在畫面上讓使用者唸得出來。
  await stub(page, { lineLoggedIn: true, loginFails: true });
  await go(page, '/#/login');

  await expect(page.locator('.acct__box--warn')).toContainText('登入沒有完成');
  await expect(page.locator('.acct')).toContainText('customToken');
  await expect(page.getByRole('button', { name: /再試一次/ })).toBeVisible();
});

test('⭐ 從 LINE 導回時落在首頁也要完成登入（hash 會在導轉中被丟掉）@account', async ({ page }) => {
  // 這是實機上真正發生的那個 bug：liff.login() 走 OAuth 導轉，
  // 網址 `#/login` 那一段回不來，使用者落在公開首頁。
  // 第一版的自動換發只寫在登入頁，所以完全沒跑到——
  // 授權完停在首頁，看起來像什麼都沒發生。
  await stub(page, { lineLoggedIn: true });
  await page.goto('/?code=fake-code&state=fake-state');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });

  await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toBe('#/my');
  // 一次性參數要從網址上抹掉，重新整理才不會又跑一次
  await expect.poll(() => page.evaluate(() => location.search)).toBe('');
});

test('⭐ 導回時換發失敗要被帶到登入頁並說明原因 @account', async ({ page }) => {
  await stub(page, { lineLoggedIn: true, loginFails: true });
  await page.goto('/?code=fake-code&state=fake-state');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });

  await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toBe('#/login');
  await expect(page.locator('.acct__box--warn')).toContainText('登入沒有完成');
  await expect(page.locator('.acct')).toContainText('customToken');
});

test('⭐ 一次導頁只掛載一次頁面，不會重複讀同一份資料 @account', async ({ page }) => {
  // initRouter() 在沒有 hash 時會 location.replace('#/')（排一個 hashchange），
  // 接著又直接呼叫一次 handle()——同一個位置被處理兩次。
  // 畫面上看不出來（兩次畫的東西一樣），只有從「同一份資料被讀了兩次」看得到。
  // 重複掛載的代價是雙倍的一次性讀取，以及註冊兩份監聽。
  await stub(page, { user: { uid: UID, displayName: '小麥', photoURL: null } });
  await page.goto('/');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
  await page.evaluate(() => window.__fake.__resetStats());

  await page.evaluate(() => { location.hash = '#/my'; });
  await expect(page.locator('.acct__uidValue')).toHaveText(UID);
  await page.waitForTimeout(500);

  // 「我的」查一次自己帶的球隊、一次自己報名的球員（跨球隊的 collectionGroup）。
  // 重複掛載會變成 4，不是 2。
  expect(await page.evaluate(() => window.__fake.__stats.getDocs)).toBe(2);
});

test('⭐ 名稱取自 users/{uid}，不是 Firebase 使用者（custom token 不帶名字）@account', async ({ page }) => {
  // custom token 登入的 Firebase user 沒有 displayName，永遠是 null。
  // 直接讀它的話畫面會一直顯示「（沒有名稱）」，而我們明明拿得到。
  await stub(page, { user: { uid: UID, displayName: null, photoURL: null } });
  await go(page, '/#/my');

  await expect(page.locator('.acct')).toContainText('金小麥');
  await expect(page.locator('.acct')).not.toContainText('沒有名稱');
});
