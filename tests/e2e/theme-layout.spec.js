/**
 * E2E｜主題與窄版
 * ------------------------------------------------------------------
 * 對應 docs/10 §7、docs/08 §8.3
 *
 * 這一份測的是「換了主題／換了螢幕寬度之後，畫面還是能用」——
 * 那是單元測試看不到的東西。特別是 320px：
 * 版面破掉時 CSS 不會報錯，只會有一條橫向捲軸，然後現場的人罵人。
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const MATCH = 'AO-G-A-01';

const SEED = {
  [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
  'config/env': { env: 'demo', allowSelfServeStaff: true },
  'staff/u-e2e': {
    uid: 'u-e2e', name: '陳賽務', roles: ['scorer'], active: true, selfServe: true,
    assignment: { eventId: EVENT, date: '2026-10-11', venueIds: ['venue-a'], divisionIds: [], challengeIds: [] }
  },
  [`events/${EVENT}/divisions/adult-open`]: {
    divisionId: 'adult-open', name: '成人公開組', matchDurationMin: 30, playersOnField: 9
  },
  [`events/${EVENT}/matches/${MATCH}`]: {
    matchId: MATCH, eventId: EVENT, divisionId: 'adult-open', stageId: 'group', groupId: 'A',
    // 刻意用很長的隊名：窄版最容易在這裡爆開
    label: '第31場 A組第1輪', venueId: 'venue-a', venueName: 'A場', date: '2026-10-11',
    kickoffAt: '2026-10-11T09:30:00+08:00',
    home: { teamId: 't-101', name: '臺中市西屯區野狼足球俱樂部' },
    away: { teamId: 't-102', name: '臺中市南屯區猛虎足球俱樂部' },
    teamIds: ['t-101', 't-102'],
    score: { home: 10, away: 8 },        // 兩位數比分，記分板最寬的情況
    status: 'live', period: 'h2',
    clock: { running: false, periodStartedAt: null, elapsedSecAtPause: 900, addedTimeSec: 0 },
    lock: { locked: false }
  },
  [`events/${EVENT}/teams/t-101/roster/m-1`]: { memberId: 'm-1', displayName: '王小明', jerseyNo: 7 },
  [`events/${EVENT}/teams/t-102/roster/m-9`]: { memberId: 'm-9', displayName: '陳阿虎', jerseyNo: 9 }
};

async function stubFirebase(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', route =>
    route.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.addInitScript(({ seed }) => {
    window.__FAKE_SEED = seed;
    window.__FAKE_USER = { uid: 'u-e2e', displayName: '陳賽務' };
    window.__seedData = seed;
  }, { seed: SEED });
}

async function gotoApp(page, hash) {
  await page.goto(hash);
  // 測試站是 python -m http.server，單一個行程要餵三個 worker × 兩百多條測試。
  // 10 秒在健康時綽綽有餘，但套件長大之後偶爾會有一次請求排隊排到逾時——
  // 偶發紅燈比慢一點危險得多（久了大家會開始無視 CI），所以給寬一點。
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await stubFirebase(page);
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

// ══════════════════════════════════════════════════════════════
//  主題
// ══════════════════════════════════════════════════════════════

test('⭐ 首屏就有 data-theme，不會先閃一次淺色 @theme', async ({ page }) => {
  // 不等 app.js，直接在 DOMContentLoaded 當下就要有值——
  // 那正是 index.html 的 inline script 存在的理由。
  await page.goto('/', { waitUntil: 'commit' });
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(['light', 'dark']).toContain(theme);
});

test('⭐ 沒設定過時跟隨系統的日夜模式 @theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await gotoApp(page, '/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('⭐ 手動選了淺色之後，系統轉深色也不會被蓋掉，而且重整還記得 @theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await gotoApp(page, '/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.locator('.theme-switch__opt[data-pref="light"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // 系統仍然是深色，但使用者的選擇要贏
  await page.reload();
  await page.waitForFunction(() => !!window.__fake);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // 選回「跟隨系統」就該恢復成深色
  await page.locator('.theme-switch__opt[data-pref="system"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('⭐ 深色下文字與背景不可以是同一個顏色（token 沒定義就會這樣）@theme', async ({ page }) => {
  await gotoApp(page, '/#/staff');
  // ⚠️ 一定要等賽務頁真的畫出來。主題切換現在在**全站頁首**裡，
  //    頁首比頁面內容早出現——點得到它不再代表頁面載好了
  //    （改動前那顆在 .staff__head 裡，所以有隱含的等待）。
  await expect(page.locator('.card').first()).toBeVisible();
  await page.locator('.theme-switch__opt[data-pref="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const probe = await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    const card = document.querySelector('.card');
    const s = getComputedStyle(card);
    return { bg, cardBg: s.backgroundColor, cardFg: s.color };
  });
  expect(probe.cardBg).not.toBe(probe.cardFg);
  // 深色主題下 body 不該還是白的
  expect(probe.bg).not.toBe('rgb(255, 255, 255)');
});

test('圖示是 SVG，不是 emoji 字元 @theme', async ({ page }) => {
  await gotoApp(page, '/#/staff');
  // 三顆大按鈕各有一個 <svg class="icon">
  await expect(page.locator('.bigbtn .icon')).toHaveCount(0);   // 首頁沒有 bigbtn
  await expect(page.locator('.toolbar .btn .icon')).toHaveCount(2);
  // sprite 只注入一次
  await expect(page.locator('#icon-sprite')).toHaveCount(1);
});

// ══════════════════════════════════════════════════════════════
//  窄版
// ══════════════════════════════════════════════════════════════

/** 整頁不得出現橫向捲軸 */
async function noHorizontalScroll(page) {
  const over = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    // 找出到底是誰溢出，失敗訊息才有用
    who: [...document.querySelectorAll('body *')]
      .filter(el => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 5)
      .map(el => `${el.tagName.toLowerCase()}.${el.className || '(no class)'}`)
  }));
  expect(over.who).toEqual([]);
  expect(over.doc).toBeLessThanOrEqual(0);
}

test('⭐ 賽務首頁在目前視窗寬度不破版 @narrow', async ({ page }) => {
  await gotoApp(page, '/#/staff');
  await expect(page.getByRole('heading', { name: /目前場次/ })).toBeVisible();
  await noHorizontalScroll(page);
});

test('⭐ LIVE 賽務台（兩位數比分＋超長隊名）不破版 @narrow', async ({ page }) => {
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  await expect(page.locator('#score-home')).toHaveText('10');
  await noHorizontalScroll(page);
});

test('⭐ 記分板的加減鈕在最窄的螢幕上仍然點得到（高度 ≥ 44）@narrow', async ({ page }) => {
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  const steps = page.locator('.sb__step');
  await expect(steps).toHaveCount(4);
  for (const b of await steps.all()) {
    const box = await b.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(38);
  }
});

test('⭐ 深色 + 窄版一起來也不破版（兩者的 CSS 是分開寫的）@narrow @theme', async ({ page }) => {
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await noHorizontalScroll(page);
});
