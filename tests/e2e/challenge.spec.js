/**
 * E2E｜挑戰區玩家端 `#/challenge/join`、`#/challenge/me`
 * ------------------------------------------------------------------
 * 規格：docs/06 §5.1、§5.2、§7.2；驗收 C01、C05
 *
 * 這一端**完全免登入**，所以每一條都在沒有 `__FAKE_USER` 的情況下跑——
 * 少了那個前提，測到的就不是玩家會遇到的路徑。
 *
 * 守六件事：
 *   ・頁面畫得出來（順序陷阱在這裡現形，已經踩過七次）
 *   ・建立 Game Pass 真的寫進去，而且抽獎張數是 0（rules 也擋著）
 *   ・**撞號要自己重試**，不要把 permission-denied 丟給玩家
 *   ・QR 旁邊一定有大字代號（QR 掃不到時整個系統的備援）
 *   ・找回：打數字也接得住；查無此人要說清楚下一步
 *   ・localStorage 壞掉不會讓整頁白掉
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';

const CHALLENGES = {
  'g01-nine-grid': {
    challengeId: 'g01-nine-grid', order: 1, icon: 'target',
    name: '九宮格射門挑戰', shortName: '九宮格', boothLocation: '攤位 1',
    scoreType: 'points', unit: '分', rankingRule: 'higher', decimals: 0
  },
  'g03-crossbar': {
    challengeId: 'g03-crossbar', order: 3, icon: 'crossbar',
    name: 'Ronaldinho 橫樑挑戰', shortName: '橫樑', boothLocation: '攤位 3',
    scoreType: 'count', unit: '次', rankingRule: 'higher', decimals: 0
  }
};

const player = (over = {}) => ({
  playerId: 'FEDA-0182', eventId: EVENT, nickname: '阿哲', avatarSeed: '0182',
  ageBand: null, qrCode: null, linkedTeamId: null,
  contact: { phone: null, lineUserId: null },
  completedChallengeIds: ['g01-nine-grid'], luckyDrawEntries: 1,
  createdVia: 'self', ...over
});

function seed({ players = {}, withRewards = true } = {}) {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo' }
  };
  for (const [id, c] of Object.entries(CHALLENGES)) s[`events/${EVENT}/challenges/${id}`] = c;
  for (const [id, p] of Object.entries(players)) s[`events/${EVENT}/players/${id}`] = p;
  if (withRewards) {
    s['config/challengeRewards'] = {
      rule: 'perChallengeCompleted', entriesPerCompletion: 1,
      bonusAllComplete: 2, maxEntriesPerPlayer: 10
    };
  }
  return s;
}

async function stub(page, opts = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r =>
    r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.addInitScript(s => {
    window.__FAKE_SEED = s;
    window.__seedData = s;
    // ⚠️ 刻意**不設** __FAKE_USER：挑戰區是免登入的
  }, seed(opts));
}

const boot = page => page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });

/** 先把 Game Pass 放進 localStorage，模擬「已經有卡的人」 */
const withPass = (page, playerId, nickname = '阿哲') =>
  page.addInitScript(([id, n]) => {
    try { localStorage.setItem('feda:gamePass', JSON.stringify({ playerId: id, nickname: n })); } catch { /* ignore */ }
  }, [playerId, nickname]);

const dump = page => page.evaluate(() => window.__fake.__dump());
const playersOf = async page => Object.entries(await dump(page))
  .filter(([k]) => k.includes('/players/'))
  .map(([k, v]) => ({ key: k, ...v }));

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

// ══════════════════════════════════════════════════════════════
test('⭐ #/challenge/join 畫得出來，而且不需要登入 @challenge', async ({ page }) => {
  await stub(page);
  await page.goto('/#/challenge/join');
  await boot(page);
  await expect(page.locator('.chal__heroTitle')).toContainText('挑戰區');
  await expect(page.locator('#chal-nick')).toBeVisible();
  // 免登入：不該出現任何「請先登入」
  await expect(page.locator('body')).not.toContainText('請先登入');
});

test('⭐ 建立 Game Pass：寫進去、抽獎張數是 0、然後導到我的挑戰卡 @challenge', async ({ page }) => {
  await stub(page);
  await page.goto('/#/challenge/join');
  await boot(page);

  await page.locator('#chal-nick').fill('阿哲');
  await page.getByRole('button', { name: /開始挑戰/ }).click();

  await expect.poll(async () => (await playersOf(page)).length, { timeout: 15_000 }).toBe(1);
  const p = (await playersOf(page))[0];
  expect(p.nickname).toBe('阿哲');
  // ⚠️ 這兩格只有 Function 改得動，rules 也擋著。玩家自己灌張數就是這裡防的
  expect(p.luckyDrawEntries).toBe(0);
  expect(p.completedChallengeIds).toEqual([]);
  expect(p.createdVia).toBe('self');
  expect(p.playerId).toMatch(/^FEDA-\d{4}$/);

  await expect(page).toHaveURL(/#\/challenge\/me/);
  await expect(page.locator('.chal__pid')).toHaveText(p.playerId);
});

test('⭐ 年齡層是選填，不填也送得出去 @challenge', async ({ page }) => {
  await stub(page);
  await page.goto('/#/challenge/join');
  await boot(page);
  await page.locator('#chal-nick').fill('小明');
  await page.getByRole('button', { name: /開始挑戰/ }).click();
  await expect.poll(async () => (await playersOf(page)).length, { timeout: 15_000 }).toBe(1);
  expect((await playersOf(page))[0].ageBand).toBeNull();
});

test('年齡層選了就存得進去 @challenge', async ({ page }) => {
  await stub(page);
  await page.goto('/#/challenge/join');
  await boot(page);
  await page.locator('#chal-nick').fill('小明');
  await page.getByRole('button', { name: '兒童' }).click();
  await page.getByRole('button', { name: /開始挑戰/ }).click();
  await expect.poll(async () => (await playersOf(page)).length, { timeout: 15_000 }).toBe(1);
  expect((await playersOf(page))[0].ageBand).toBe('kid');
});

test('⭐ 沒填暱稱不送出 @challenge', async ({ page }) => {
  await stub(page);
  await page.goto('/#/challenge/join');
  await boot(page);
  await page.getByRole('button', { name: /開始挑戰/ }).click();
  await expect(page.locator('.toast')).toContainText('暱稱');
  expect(await playersOf(page)).toHaveLength(0);
});

test('⭐ 找回：只打數字也接得住 @challenge', async ({ page }) => {
  await stub(page, { players: { 'FEDA-0182': player() } });
  await page.goto('/#/challenge/join');
  await boot(page);

  await page.getByRole('button', { name: '我已經有代號' }).click();
  await page.locator('#chal-id').fill('182');
  await page.getByRole('button', { name: /找回我的挑戰卡/ }).click();

  await expect(page).toHaveURL(/#\/challenge\/me/, { timeout: 15_000 });
  await expect(page.locator('.chal__pid')).toHaveText('FEDA-0182');
});

test('⭐ 找回：查無此人要說清楚下一步，而且留在畫面上 @challenge', async ({ page }) => {
  await stub(page);
  await page.goto('/#/challenge/join');
  await boot(page);

  await page.getByRole('button', { name: '我已經有代號' }).click();
  await page.locator('#chal-id').fill('9999');
  await page.getByRole('button', { name: /找回我的挑戰卡/ }).click();

  const box = page.locator('.chal__card--warn[role="alert"]');
  await expect(box).toContainText('FEDA-9999', { timeout: 15_000 });
  await expect(box).toContainText('建立');
});

test('⭐ 已經有卡的人，join 頁要有一條捷徑（但不自動跳走）@challenge', async ({ page }) => {
  await stub(page, { players: { 'FEDA-0182': player() } });
  await withPass(page, 'FEDA-0182');
  await page.goto('/#/challenge/join');
  await boot(page);

  await expect(page.locator('.chal__note')).toContainText('FEDA-0182');
  await expect(page).toHaveURL(/#\/challenge\/join/);      // 沒有被自動導走
  await page.getByRole('button', { name: '打開我的挑戰卡' }).click();
  await expect(page).toHaveURL(/#\/challenge\/me/);
});

// ══════════════════════════════════════════════════════════════
test('⭐ #/challenge/me 畫得出來：QR、大字代號、進度、抽獎張數 @challenge', async ({ page }) => {
  await stub(page, { players: { 'FEDA-0182': player() } });
  await withPass(page, 'FEDA-0182');
  await page.goto('/#/challenge/me');
  await boot(page);

  await expect(page.locator('.chal__qr svg')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.chal__pid')).toHaveText('FEDA-0182');
  await expect(page.locator('.chal__nick')).toHaveText('阿哲');
  await expect(page.locator('.chal__count').first()).toHaveText('1 / 2');
  await expect(page.locator('.chal__card--draw')).toContainText('1 張');
});

test('⭐ QR 旁邊一定要有大字代號（QR 掃不到時的備援）@challenge', async ({ page }) => {
  await stub(page, { players: { 'FEDA-0182': player() } });
  await withPass(page, 'FEDA-0182');
  await page.goto('/#/challenge/me');
  await boot(page);

  const pid = page.locator('.chal__pid');
  await expect(pid).toBeVisible({ timeout: 15_000 });
  // 「大字」不是形容詞——量出來要真的比內文大
  const size = await pid.evaluate(n => parseFloat(getComputedStyle(n).fontSize));
  expect(size).toBeGreaterThanOrEqual(20);
});

test('⭐ QR 是白底黑點，不跟著主題變（深色主題下反過來畫會掃不到）@challenge', async ({ page }) => {
  await stub(page, { players: { 'FEDA-0182': player() } });
  await withPass(page, 'FEDA-0182');
  await page.addInitScript(() => localStorage.setItem('feda:theme', 'dark'));
  await page.goto('/#/challenge/me');
  await boot(page);

  const svg = page.locator('.chal__qr svg');
  await expect(svg).toBeVisible({ timeout: 15_000 });
  const html = await svg.evaluate(n => n.outerHTML);
  expect(html).toContain('#fff');
  expect(html).toContain('#000');
  expect(html).not.toContain('currentColor');
});

test('⭐ 完成的關卡標起來，沒完成的顯示「未挑戰」@challenge', async ({ page }) => {
  await stub(page, { players: { 'FEDA-0182': player() } });
  await withPass(page, 'FEDA-0182');
  await page.goto('/#/challenge/me');
  await boot(page);

  const items = page.locator('.chal__item');
  await expect(items).toHaveCount(2, { timeout: 15_000 });
  await expect(items.nth(0)).toHaveAttribute('data-done', 'true');
  await expect(items.nth(1)).toHaveAttribute('data-done', 'false');
  await expect(items.nth(1)).toContainText('未挑戰');
  await expect(items.nth(0)).toContainText('攤位 1');
});

test('⭐ 沒有 Game Pass 就導去建立頁 @challenge', async ({ page }) => {
  await stub(page);
  await page.goto('/#/challenge/me');
  await boot(page);
  await expect(page).toHaveURL(/#\/challenge\/join/, { timeout: 15_000 });
});

test('⭐ 代號在伺服器上不存在時，說清楚並給一條路 @challenge', async ({ page }) => {
  await stub(page);                                   // 種子裡沒有這個玩家
  await withPass(page, 'FEDA-0182');
  await page.goto('/#/challenge/me');
  await boot(page);

  const box = page.locator('.chal__card--warn[role="alert"]');
  await expect(box).toContainText('FEDA-0182', { timeout: 15_000 });
  await page.getByRole('button', { name: /重新建立/ }).click();
  await expect(page).toHaveURL(/#\/challenge\/join/);
});

test('⭐ localStorage 壞掉時不可以整頁白掉 @challenge', async ({ page }) => {
  // 無痕視窗、把網站資料設成封鎖時，localStorage 這個屬性本身就會丟例外
  await stub(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError'); }
    });
  });
  await page.goto('/#/challenge/join');
  await boot(page);
  await expect(page.locator('#chal-nick')).toBeVisible({ timeout: 15_000 });
});

test('⭐ 抽獎明細跟權威張數不一致時說「計算中」，不自己改數字 @challenge', async ({ page }) => {
  // 完成 2 關但 Function 還沒把張數寫回來（現場真的會有這一兩秒）
  await stub(page, {
    players: {
      'FEDA-0182': player({
        completedChallengeIds: ['g01-nine-grid', 'g03-crossbar'], luckyDrawEntries: 1
      })
    }
  });
  await withPass(page, 'FEDA-0182');
  await page.goto('/#/challenge/me');
  await boot(page);

  const card = page.locator('.chal__card--draw');
  await expect(card).toContainText('1 張', { timeout: 15_000 });   // 顯示的是權威值
  await expect(card).toContainText('計算');
});

// ══════════════════════════════════════════════════════════════
//  配號：撞號由伺服器擋，前端換一組重試
// ══════════════════════════════════════════════════════════════

test('⭐ 撞號時自己換一組重試，不把 permission-denied 丟給玩家 @challenge', async ({ page }) => {
  // 替身在這裡模擬 rules 的「只放行 create」：已存在的 players 文件寫不進去
  await stub(page, { players: { 'FEDA-0001': player({ playerId: 'FEDA-0001', nickname: '先來的人' }) } });
  await page.addInitScript(EVENT_ID => {
    window.__FAKE_CREATE_ONLY = [`events/${EVENT_ID}/players`];
    // 第一次抽到 0001（撞號），之後抽 0002
    let n = 0;
    Math.random = () => (n++ === 0 ? 0.0001 : 0.0002);
  }, EVENT);

  await page.goto('/#/challenge/join');
  await boot(page);
  await page.locator('#chal-nick').fill('後來的人');
  await page.getByRole('button', { name: /開始挑戰/ }).click();

  await expect(page).toHaveURL(/#\/challenge\/me/, { timeout: 15_000 });
  await expect(page.locator('.chal__pid')).toHaveText('FEDA-0002');

  // 先來的那一位不可以被蓋掉——那才是撞號真正的危害
  const all = await playersOf(page);
  expect(all).toHaveLength(2);
  expect(all.find(p => p.playerId === 'FEDA-0001').nickname).toBe('先來的人');
});

test('⭐ 一直撞號時要說得出原因，不是靜靜失敗 @challenge', async ({ page }) => {
  await stub(page, { players: { 'FEDA-0001': player({ playerId: 'FEDA-0001' }) } });
  await page.addInitScript(EVENT_ID => {
    window.__FAKE_CREATE_ONLY = [`events/${EVENT_ID}/players`];
    Math.random = () => 0.0001;                    // 每一次都抽到同一組
  }, EVENT);

  await page.goto('/#/challenge/join');
  await boot(page);
  await page.locator('#chal-nick').fill('倒楣的人');
  await page.getByRole('button', { name: /開始挑戰/ }).click();

  const box = page.locator('.chal__card--warn[role="alert"]');
  await expect(box).toContainText('再按一次', { timeout: 15_000 });
  await expect(page).toHaveURL(/#\/challenge\/join/);        // 沒有假裝成功
});
