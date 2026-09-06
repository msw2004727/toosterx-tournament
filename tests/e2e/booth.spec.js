/**
 * E2E｜挑戰攤位 `#/booth`
 * ------------------------------------------------------------------
 * 規格：docs/06 §4；驗收 C02（掃碼到送出 10 秒內、3 次點擊以內）、C06、C07
 *
 * 守五件事：
 *   ・**沒有權限的人看得到原因**，不是空白頁
 *   ・**依指派鎖定關卡**，只有一關時不用選
 *   ・**四種輸入介面依設定切換**
 *   ・**離線也送得出去**，而且顯示待同步（驗收 C06）
 *   ・**離線時不畫作廢鈕**（伺服器時間還不存在，畫了就是假成功）
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'u-booth';

const CROSSBAR = {
  challengeId: 'g03-crossbar', order: 3, icon: 'crossbar',
  name: 'Ronaldinho 橫樑挑戰', shortName: '橫樑', boothLocation: '攤位 3',
  rulesText: '固定 5 球，紀錄擊中橫樑次數。',
  scoreType: 'count', unit: '次', rankingRule: 'higher', decimals: 0,
  minValue: 0, maxValue: 5, inputMode: 'stepper', stepperMax: 5,
  attemptPolicy: { maxAttemptsPerPlayer: 3, allowRepeat: true, rankBy: 'best' },
  status: 'open'
};
const NINE = {
  challengeId: 'g01-nine-grid', order: 1, icon: 'target',
  name: '九宮格射門挑戰', shortName: '九宮格', boothLocation: '攤位 1',
  scoreType: 'points', unit: '分', rankingRule: 'higher', decimals: 0,
  minValue: 0, maxValue: 15, inputMode: 'shots', shotCount: 5, shotOptions: [0, 1, 2, 3],
  attemptPolicy: { maxAttemptsPerPlayer: 3, rankBy: 'best' }, status: 'open'
};

const seed = ({ roles = ['booth'], challengeIds = ['g03-crossbar'], challenges = [CROSSBAR, NINE], players = true } = {}) => {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo' },
    [`users/${UID}`]: { uid: UID, displayName: '王攤位' },
    [`staff/${UID}`]: {
      uid: UID, name: '王攤位', roles, active: true,
      assignment: { eventId: EVENT, venueIds: [], divisionIds: [], challengeIds }
    }
  };
  for (const c of challenges) s[`events/${EVENT}/challenges/${c.challengeId}`] = c;
  if (players) {
    s[`events/${EVENT}/players/FEDA-0182`] = {
      playerId: 'FEDA-0182', eventId: EVENT, nickname: '阿哲', ageBand: 'adult',
      completedChallengeIds: [], luckyDrawEntries: 0, createdVia: 'self-qr'
    };
  }
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
    window.__FAKE_USER = { uid: u, displayName: '王攤位' };
  }, { s: seed(opts), u: UID });
}

async function go(page, hash = '#/booth') {
  await page.goto(`/${hash}`);
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

const dump = page => page.evaluate(() => window.__fake.__dump());
const attemptsOf = async page => Object.entries(await dump(page))
  .filter(([k]) => k.includes('/attempts/'))
  .map(([, v]) => v);

/** 斷言「不存在」之前先等頁面真的畫出來（變異 #E7 的教訓） */
const ready = page => expect(page.locator('.booth')).toBeVisible({ timeout: 15_000 });

/** 掃碼／輸入 ID → 查詢 */
async function lookup(page, id = 'FEDA-0182') {
  await page.locator('#booth-id').fill(id);
  await page.getByRole('button', { name: /查詢/ }).click();
  await expect(page.locator('.booth__nick')).toBeVisible({ timeout: 15_000 });
}

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('⭐ 沒有攤位身分的人看得到原因，不是空白頁 @booth', async ({ page }) => {
  await stub(page, { roles: ['user'] });
  await go(page);
  await expect(page.locator('.booth__box--warn')).toContainText('挑戰攤位');
  await expect(page.locator('#booth-id')).toHaveCount(0);
});

test('⭐ 沒有被指派任何關卡時說得出要找誰 @booth', async ({ page }) => {
  await stub(page, { challengeIds: [] });
  await go(page);
  await ready(page);
  await expect(page.locator('.booth')).toContainText('還沒有被指派到任何攤位');
  await expect(page.locator('.booth')).toContainText('身分授權');
});

test('⭐ 只被指派一關時直接鎖定，不用選（§4.1：整天 0 次額外點選）@booth', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await expect(page.locator('.booth__headText')).toContainText('Ronaldinho 橫樑挑戰');
  await expect(page.locator('.booth__headText')).toContainText('攤位 3');
  await expect(page.locator('.booth__choices')).toHaveCount(0);
});

test('被指派兩關時才要選一次 @booth', async ({ page }) => {
  await stub(page, { challengeIds: ['g03-crossbar', 'g01-nine-grid'] });
  await go(page);
  await ready(page);
  await expect(page.locator('.booth__choice')).toHaveCount(2);
  await page.getByRole('button', { name: /九宮格/ }).click();
  await expect(page.locator('.booth__headText')).toContainText('九宮格');
});

test('⭐ C02 掃碼到送出：3 次點擊 @booth', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await lookup(page);                                     // 輸入 ID ＋ 查詢

  // stepper：按兩下加到 2，再按送出 → 共 3 次點擊
  await page.getByRole('button', { name: '加一' }).click();
  await page.getByRole('button', { name: '加一' }).click();
  await expect(page.locator('.booth__stepValue')).toHaveText('2');
  await page.getByRole('button', { name: /送出成績/ }).click();

  await expect.poll(async () => (await attemptsOf(page)).length, { timeout: 15_000 }).toBe(1);
  const a = (await attemptsOf(page))[0];
  expect(a).toMatchObject({
    challengeId: 'g03-crossbar', playerId: 'FEDA-0182',
    rawValue: 2, displayValue: '2次', isBest: false, source: 'free', staffUid: UID
  });
});

test('⭐ 送出後立刻顯示個人最佳，不等伺服器 @booth', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await lookup(page);
  await page.getByRole('button', { name: '加一' }).click();
  await page.getByRole('button', { name: /送出成績/ }).click();

  await expect(page.locator('.booth__box--ok')).toContainText('成績已記錄');
  await expect(page.locator('.booth__box--ok')).toContainText('阿哲 1次');
  await expect(page.locator('.booth__box--ok')).toContainText('個人最佳');
});

test('⭐ 送出後按鈕會鎖住（防手殘連按）@booth', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await lookup(page);
  await page.getByRole('button', { name: '加一' }).click();
  await page.getByRole('button', { name: /送出成績/ }).click();
  await expect(page.getByRole('button', { name: /請稍候/ })).toBeDisabled();
});

test('⭐ shots 介面：五排按鈕，總分即時加總 @booth', async ({ page }) => {
  await stub(page, { challengeIds: ['g01-nine-grid'] });
  await go(page);
  await ready(page);
  await lookup(page);

  await expect(page.locator('.booth__shotRow')).toHaveCount(5);
  // 每排選 3 分
  for (let i = 0; i < 5; i++) {
    await page.locator('.booth__shotRow').nth(i).getByRole('button', { name: '3' }).click();
  }
  await expect(page.locator('.booth__shotTotal')).toContainText('15');

  await page.getByRole('button', { name: /送出成績/ }).click();
  await expect.poll(async () => (await attemptsOf(page)).length, { timeout: 15_000 }).toBe(1);
  const a = (await attemptsOf(page))[0];
  expect(a.rawValue).toBe(15);
  expect(a.detail).toEqual([3, 3, 3, 3, 3]);       // 每球細項要留下來
});

test('⭐ stepper 一開始就送得出 0 分（一次都沒中是很常見的成績）@booth', async ({ page }) => {
  // 畫面顯示 0 但內部是 null 的話，要先按 ＋ 再按 − 才送得出去
  await stub(page);
  await go(page);
  await ready(page);
  await lookup(page);
  await expect(page.locator('.booth__stepValue')).toHaveText('0');
  await page.getByRole('button', { name: /送出成績/ }).click();
  await expect.poll(async () => (await attemptsOf(page)).length, { timeout: 15_000 }).toBe(1);
  expect((await attemptsOf(page))[0].rawValue).toBe(0);
});

test('⭐ shots 還沒選滿五球就送不出去 @booth', async ({ page }) => {
  await stub(page, { challengeIds: ['g01-nine-grid'] });
  await go(page);
  await ready(page);
  await lookup(page);
  await expect(page.getByRole('button', { name: /送出成績/ })).toBeDisabled();
  await page.locator('.booth__shotRow').first().getByRole('button', { name: '2' }).click();
  await expect(page.getByRole('button', { name: /送出成績/ })).toBeDisabled();
});

test('⭐ 次數滿了會提示，但仍然送得出去（現場彈性）@booth', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await lookup(page);
  // ⚠️ 每次送不同的分數：連續送同一個分數會被 5 秒去重擋掉（那是刻意的），
  //    而這條測試要驗的是次數上限，不是去重
  for (let n = 0; n < 3; n++) {
    for (let k = 0; k <= n; k++) await page.getByRole('button', { name: '加一' }).click();
    await page.getByRole('button', { name: /送出成績/ }).click();
    await expect.poll(async () => (await attemptsOf(page)).length, { timeout: 15_000 }).toBe(n + 1);
    await page.waitForTimeout(3100);                 // 等按鈕解鎖
  }
  await expect(page.locator('.booth__warn')).toContainText('已達本關次數上限');
  await expect(page.getByRole('button', { name: /送出成績/ })).toBeEnabled();
});

test('⭐ C06 離線也送得出去，顯示待同步；恢復連線自動補送 @booth @offline', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await lookup(page);

  await page.evaluate(() => window.__fake.__goOffline());
  await page.getByRole('button', { name: '加一' }).click();
  await page.getByRole('button', { name: /送出成績/ }).click();

  // 畫面立刻認帳（不 await Firestore 的 Promise，R-UI-002）
  await expect(page.locator('.booth__box--ok')).toContainText('成績已記錄');
  await expect.poll(() => page.evaluate(() => window.__fake.__pendingCount()), { timeout: 10_000 })
    .toBeGreaterThan(0);

  await page.evaluate(() => window.__fake.__goOnline());
  await expect.poll(() => page.evaluate(() => window.__fake.__pendingCount()), { timeout: 15_000 }).toBe(0);
  expect(await attemptsOf(page)).toHaveLength(1);
});

test('⭐ 還在待同步時不畫作廢鈕（伺服器時間還不存在）@booth @offline', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await lookup(page);

  await page.evaluate(() => window.__fake.__goOffline());
  await page.getByRole('button', { name: '加一' }).click();
  await page.getByRole('button', { name: /送出成績/ }).click();

  await expect(page.locator('.booth__recentRow')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('.booth__voidBtn')).toHaveCount(0);
  await expect(page.locator('.booth__voidNote')).toContainText('伺服器');
});

test('⭐ C07 十分鐘內可以作廢自己送的那一筆 @booth', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await lookup(page);
  await page.getByRole('button', { name: '加一' }).click();
  await page.getByRole('button', { name: /送出成績/ }).click();
  await expect.poll(async () => (await attemptsOf(page)).length, { timeout: 15_000 }).toBe(1);

  await page.getByRole('button', { name: /作廢/ }).first().click();
  await page.locator('.modal').getByRole('button', { name: /^作廢$/ }).click();

  await expect.poll(async () => (await attemptsOf(page))[0]?.voided, { timeout: 15_000 }).toBe(true);
  // 紀錄仍然留著，只是標記作廢（永不刪除）
  expect(await attemptsOf(page)).toHaveLength(1);
});

test('⭐ 手機相機掃到玩家的 QR 會開 #/booth?id=…，代號自動帶入並查好 @booth', async ({ page }) => {
  // QR 裡放的是攤位頁的網址；相機 App 掃到就開這個網址，攤位不用再打字
  await stub(page);
  await go(page, '#/booth?id=FEDA-0182');
  await expect(page.locator('.booth__nick')).toContainText('阿哲', { timeout: 15_000 });
  await expect(page.locator('.booth__pid')).toContainText('FEDA-0182');   // 查到之後輸入區收起來，顯示的是玩家卡
});

test('⭐ 找不到的 ID 會問要不要代建 @booth', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await page.locator('#booth-id').fill('FEDA-9999');
  await page.getByRole('button', { name: /查詢/ }).click();
  await expect(page.locator('.modal')).toContainText('代建');
  await page.locator('.modal').getByRole('button', { name: /^代建$/ }).click();
  await expect(page.locator('.booth__nick')).toContainText('FEDA-9999');

  const d = await dump(page);
  const p = d[`events/${EVENT}/players/FEDA-9999`];
  expect(p).toMatchObject({ createdVia: 'staff', luckyDrawEntries: 0 });
  expect(p.completedChallengeIds).toEqual([]);
});

test('ID 格式不對時不送出查詢 @booth', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await page.locator('#booth-id').fill('abc');
  await page.getByRole('button', { name: /查詢/ }).click();
  await expect(page.locator('.toast')).toContainText('FEDA-0182');
  await expect(page.locator('.booth__nick')).toHaveCount(0);
});

test('⭐ 320px 不出現橫向捲軸 @booth @narrow', async ({ page }) => {
  await stub(page, { challengeIds: ['g01-nine-grid'] });
  await go(page);
  await ready(page);
  await lookup(page);
  const over = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth <= d.clientWidth ? null : { scroll: d.scrollWidth, client: d.clientWidth };
  });
  expect(over).toBeNull();
});

// ── 攤位替玩家登記中獎聯絡手機（docs/06 §7.2）──────────────
test('⭐ 攤位替代建的卡登記手機：走 Function、不帶憑證、號碼正規化 @booth @contact', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await lookup(page);
  await page.locator('#booth-phone').fill('0987-654-321');
  await page.locator('#booth-phone-save').click();
  await expect.poll(() => page.evaluate(() => (window.__FAKE_CALLS || []).find(c => c.name === 'setPlayerContact')?.payload), { timeout: 10_000 })
    .toEqual({ eventId: EVENT, playerId: 'FEDA-0182', phone: '0987654321' });
  await expect(page.locator('#booth-phone-note')).toContainText('0987***321');
});

test('攤位登記手機：格式不對留在畫面上，不送出 @booth @contact', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await lookup(page);
  await page.locator('#booth-phone').fill('02-2345-6789');
  await page.locator('#booth-phone-save').click();
  await expect(page.locator('#booth-phone-note')).toContainText('09 開頭');
  expect(await page.evaluate(() => (window.__FAKE_CALLS || []).some(c => c.name === 'setPlayerContact'))).toBe(false);
});

// ── 2026-09-06 主辦驗收 M-9：家長的第二個小孩要在哪裡建卡、「已連線」白字看不見 ──
test('⭐ 代建新卡：系統配號、寫進 players、成績可以直接登錄 @booth', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await page.locator('#booth-new-card').click();
  await page.locator('.modal .btn--primary').click();
  await expect(page.locator('.booth__nick')).toContainText('FEDA-', { timeout: 15_000 });
  const created = Object.entries(await dump(page)).filter(([k]) => k.includes('/players/FEDA-')).map(([, v]) => v)
    .find(p => p.createdVia === 'staff');
  expect(created).toBeTruthy();
  expect(created.playerId).toMatch(/^FEDA-[0-9]{4}$/);
  // 代號要印在畫面上（攤位要抄給玩家），而且成績區直接可以送出
  await expect(page.locator('.booth__nick')).toContainText(created.playerId);
  await expect(page.getByRole('button', { name: /送出成績/ })).toBeVisible();
});

test('⭐ 三態燈在攤位頁的淺色底上看得到（不是白字）@booth', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  const color = await page.locator('.sync').first().evaluate(el => getComputedStyle(el).color);
  expect(color).not.toBe('rgb(255, 255, 255)');
});
