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
  }
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
  // 測試站是 python -m http.server，單一個行程要餵三個 worker × 兩百多條測試。
  // 10 秒在健康時綽綽有餘，但套件長大之後偶爾會有一次請求排隊排到逾時——
  // 偶發紅燈比慢一點危險得多（久了大家會開始無視 CI），所以給寬一點。
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
