/**
 * E2E｜全站頁首與「安裝到裝置」
 * ------------------------------------------------------------------
 * 規格：docs/08 §1.2、§1.3
 *
 * 起因是一個看起來像資料遺失、其實是導覽缺口的回報（2026-09-03）：
 * 「建立球隊成功後退出瀏覽器再回來就無法找到自己的球隊」。
 * 球隊一直都在 `#/my`，但畫面上沒有任何一條路通往那裡。
 *
 * 所以這一組守兩件事：
 *   1. 每一頁都回得去「我的」與首頁（含關掉瀏覽器再開）
 *   2. 安裝鈕只在真的裝得起來時出現，裝不了的環境給的是說明不是空按鈕
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'U7774e1410479bafff4997f51b2c47b95';

const seed = () => ({
  [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
  'config/env': { env: 'demo' },
  'config/registration': { open: true, opensAt: null, closesAt: null },
  [`events/${EVENT}/teams/t-1`]: {
    teamId: 't-1', name: '大甲金剛足球隊', divisionId: 'u10',
    captainUid: UID, status: 'draft', memberCount: 3, inviteCode: 'K7M2QP'
  },
  [`users/${UID}`]: { uid: UID, displayName: '金小麥', pictureUrl: null, roles: [] }
});

/**
 * @param {object} opts
 * @param {'prompt'|'ios'|'inapp'|'none'|'installed'} opts.install 模擬哪一種安裝環境
 */
async function stub(page, { user = null, install = 'none' } = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r =>
    r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());

  await page.addInitScript(({ s, u, mode }) => {
    window.__FAKE_SEED = s;
    window.__FAKE_USER = u;
    window.__seedData = s;

    // ── 安裝環境的替身 ──
    // 真的 beforeinstallprompt 沒辦法在 Playwright 裡觸發（要瀏覽器判定
    // 這個站符合安裝條件），所以直接派發一個同名的事件——index.html 的
    // inline script 收的就是它，這樣連「攔截寫對了沒」都一起驗到。
    if (mode === 'ios') {
      Object.defineProperty(navigator, 'userAgent', {
        get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile Safari/604.1'
      });
      Object.defineProperty(navigator, 'platform', { get: () => 'iPhone' });
    }
    if (mode === 'inapp') {
      Object.defineProperty(navigator, 'userAgent', {
        get: () => 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36 Line/14.5.0'
      });
    }
    if (mode === 'installed') {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = q => (q.includes('display-mode: standalone')
        ? { matches: true, addEventListener() {}, removeEventListener() {} }
        : mm(q));
    }
    if (mode === 'prompt') {
      window.__promptCalls = 0;
      window.addEventListener('load', () => {
        const e = new Event('beforeinstallprompt');
        e.prompt = () => { window.__promptCalls++; return Promise.resolve(); };
        e.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(e);
      });
    }
  }, { s: seed(), u: user, mode: install });
}

async function go(page, hash) {
  await page.goto(hash);
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

/* ══════════════════════════════════════════════════════════════
   常駐導覽
   ══════════════════════════════════════════════════════════════ */

test('⭐ 每一頁都回得去首頁，右邊那一格永遠在 @appbar', async ({ page }) => {
  // 主辦 2026-09-03：不管什麼身分、在哪一頁，頂部都是
  // 「首頁 … 安裝 登入／我的 三個主題圖示」。
  await stub(page, { user: { uid: UID } });
  for (const hash of ['/#/', '/#/schedule', '/#/stats', '/#/register', '/#/staff']) {
    await go(page, hash);
    const bar = page.locator('.apphead');
    await expect(bar).toBeVisible();
    await expect(bar.locator('a[href="#/"]')).toHaveCount(1);
    await expect(bar.locator('a[href="#/my"]')).toHaveCount(1);
    // 主題切換每一頁都只有一組（賽務端自己那顆已經拿掉）
    await expect(page.locator('.theme-switch')).toHaveCount(1);
  }
});

test('⭐ 未登入時右邊顯示「登入」，登入後變成「我的」@appbar', async ({ page, context }) => {
  await stub(page);
  await go(page, '/#/');
  await expect(page.locator('.apphead a[href="#/login"]')).toContainText('登入');
  await expect(page.locator('.apphead a[href="#/my"]')).toHaveCount(0);

  const signedIn = await context.newPage();
  await stub(signedIn, { user: { uid: UID } });
  await go(signedIn, '/#/');
  await expect(signedIn.locator('.apphead a[href="#/my"]')).toContainText('我的');
  await expect(signedIn.locator('.apphead a[href="#/login"]')).toHaveCount(0);
  await signedIn.close();
});

test('⭐ 主題切換只有圖示，沒有文字（窄機不會斷行）@appbar @narrow', async ({ page }) => {
  await stub(page);
  await go(page, '/#/');
  // 標籤仍在 DOM 裡給螢幕閱讀器用，但視覺上寬度為 0
  const w = await page.locator('.theme-switch__label').first().evaluate(el => el.getBoundingClientRect().width);
  expect(w).toBeLessThan(2);
  // 頁首不可以被撐成兩列
  const rows = await page.locator('.apphead').evaluate(el => el.getBoundingClientRect().height);
  expect(rows).toBeLessThan(80);
});

test('⭐ 建完隊、關掉瀏覽器再開，還是找得到自己的球隊 @appbar', async ({ page, context }) => {
  // 這一條就是 2026-09-03 的回報。重點在「新開的分頁沒有任何前一次的狀態」，
  // 使用者手上只有網址列跟畫面上看得到的東西。
  await stub(page, { user: { uid: UID } });
  await go(page, '/#/schedule');

  await page.locator('.apphead a[href="#/my"]').click();
  await expect(page).toHaveURL(/#\/my$/);
  await expect(page.locator('#app-view')).toContainText('大甲金剛足球隊');

  // 換一個乾淨的分頁（等同關掉瀏覽器再開），從首頁出發也要走得到
  const fresh = await context.newPage();
  await stub(fresh, { user: { uid: UID } });
  await go(fresh, '/#/');
  await fresh.locator('.apphead a[href="#/my"]').click();
  await expect(fresh.locator('#app-view')).toContainText('大甲金剛足球隊');
  await fresh.close();
});

test('目前所在的頁面會標示出來 @appbar', async ({ page }) => {
  await stub(page, { user: { uid: UID } });
  await go(page, '/#/');
  await expect(page.locator('.apphead a[href="#/"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.apphead a[href="#/my"]')).not.toHaveAttribute('aria-current', 'page');

  await page.locator('.apphead a[href="#/my"]').click();
  await expect(page.locator('.apphead a[href="#/my"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.apphead a[href="#/"]')).not.toHaveAttribute('aria-current', 'page');
});

test('⭐ 賽務端也要有這一列，而且只有一組主題切換 @appbar', async ({ page }) => {
  // 改動前 #/staff 底下整列是收起來的（主辦 2026-09-03 要求常駐）。
  // 既然常駐，賽務首頁自己那顆主題切換就必須拿掉。
  await stub(page, { user: { uid: 'u-staff' } });
  await go(page, '/#/staff');
  await expect(page.locator('.apphead')).toBeVisible();
  await expect(page.locator('.theme-switch')).toHaveCount(1);
});

test('⭐ 換頁不會累積出第二列頁首 @appbar', async ({ page }) => {
  await stub(page, { user: { uid: UID } });
  await go(page, '/#/');
  for (const h of ['/#/schedule', '/#/staff', '/#/', '/#/stats', '/#/']) {
    await page.goto(h);
    await page.waitForTimeout(120);
  }
  await expect(page.locator('.apphead')).toHaveCount(1);
  await expect(page.locator('.apphead .theme-switch')).toHaveCount(1);
});

/* ══════════════════════════════════════════════════════════════
   安裝到裝置
   ══════════════════════════════════════════════════════════════ */

test('⭐ PWA 安裝入口已關閉：就算接到 beforeinstallprompt 也不畫安裝鈕（主辦 2026-09-06 決定）@appbar', async ({ page }) => {
  await stub(page, { install: 'prompt' });
  await go(page, '/#/');
  await expect(page.locator('.apphead__link').first()).toBeVisible();
  await expect(page.locator('.apphead__install')).toHaveCount(0);
});

test('PWA 安裝入口已關閉：沒有事件時也不畫 @appbar', async ({ page }) => {
  await stub(page, { install: 'none' });
  await go(page, '/#/');
  await expect(page.locator('.apphead__link').first()).toBeVisible();
  await expect(page.locator('.apphead__install')).toHaveCount(0);
});

test('⭐ 已經安裝（standalone）不畫安裝鈕 @appbar', async ({ page }) => {
  await stub(page, { install: 'installed' });
  await go(page, '/#/');
  await expect(page.locator('.apphead__install')).toBeHidden();
});

test('PWA 安裝入口已關閉：iOS 也不畫 @appbar', async ({ page }) => {
  await stub(page, { install: 'ios' });
  await go(page, '/#/');
  await expect(page.locator('.apphead__link').first()).toBeVisible();
  await expect(page.locator('.apphead__install')).toHaveCount(0);
});

test('PWA 安裝入口已關閉：LINE 內建瀏覽器也不畫 @appbar', async ({ page }) => {
  await stub(page, { install: 'inapp' });
  await go(page, '/#/');
  await expect(page.locator('.apphead__link').first()).toBeVisible();
  await expect(page.locator('.apphead__install')).toHaveCount(0);
});

test('manifest 與圖示真的抓得到（不是 404）@appbar', async ({ page }) => {
  // manifest 指到不存在的圖示時，Chrome 不給安裝選項而且**不印任何錯誤**。
  await stub(page);
  await go(page, '/#/');

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.href;
    const r = await fetch(href);
    return r.ok ? r.json() : null;
  });
  expect(manifest).not.toBeNull();

  for (const ic of manifest.icons) {
    const st = await page.evaluate(u => fetch(u).then(r => r.status), ic.src);
    expect(st, `${ic.src} 應該抓得到`).toBe(200);
  }
});
