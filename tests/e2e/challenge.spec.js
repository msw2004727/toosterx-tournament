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

/**
 * 橫樑關的排行榜。`outsider: true` 時前三名的成績都比 1 好，
 * 而且 ladder 上有 6 筆——用來測「自己不在前 N 名」那一條。
 */
const board = ({ outsider = false } = {}) => ({
  challengeId: 'g03-crossbar', topN: 50, version: 3,
  rows: [
    { rank: 1, playerId: 'FEDA-0001', nickname: 'Kevin', value: 5, displayValue: '5 次', attempts: 2, attemptAt: 1760000000000 },
    { rank: 2, playerId: outsider ? 'FEDA-0002' : 'FEDA-0182', nickname: outsider ? 'Amy' : '阿哲', value: 4, displayValue: '4 次', attempts: 1, attemptAt: 1760000100000 },
    { rank: 3, playerId: 'FEDA-0003', nickname: '小明', value: 3, displayValue: '3 次', attempts: 3, attemptAt: 1760000200000 }
  ],
  totalPlayers: outsider ? 7 : 3,
  // ⚠️ ladder 涵蓋**全部**玩家（不是只有前 50），而且只有數字沒有 ID
  ladder: outsider
    ? { values: [5, 4, 3, 3, 2, 2, 1], times: [1760000000000, 1760000100000, 1760000200000, 1760000300000, 1760000400000, 1760000500000, Date.parse('2026-10-11T09:30:00+08:00')] }
    : { values: [5, 4, 3], times: [1760000000000, 1760000100000, 1760000200000] }
});

function seed({ players = {}, withRewards = true, boards = {}, attempts = {}, noChallenges = false } = {}) {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo' }
  };
  if (!noChallenges) for (const [id, c] of Object.entries(CHALLENGES)) s[`events/${EVENT}/challenges/${id}`] = c;
  for (const [id, p] of Object.entries(players)) s[`events/${EVENT}/players/${id}`] = p;
  for (const [id, b] of Object.entries(boards)) s[`events/${EVENT}/leaderboards/${id}`] = b;
  for (const [id, a] of Object.entries(attempts)) s[`events/${EVENT}/attempts/${id}`] = a;
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
  await page.addInitScript(({ s, u }) => {
    window.__FAKE_SEED = s;
    window.__seedData = s;
    window.__FAKE_USER = u;        // 挑戰卡綁 LINE：有 user 才配得到卡；看關卡與排行榜仍免登入
  }, { s: seed(opts), u: opts.user ?? null });
}
const LINE_USER = { uid: 'U-line-1', displayName: '阿哲' };

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
test('⭐ 沒登入開 #/challenge/join：畫 LINE 登入卡，不畫取暱稱的表單（挑戰卡綁 LINE）@challenge', async ({ page }) => {
  await stub(page);
  await page.goto('/#/challenge/join');
  await boot(page);
  await expect(page.locator('.chal__login')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /用 LINE 領挑戰卡/ })).toBeVisible();
  await expect(page.locator('#chal-nick')).toHaveCount(0);
  expect(await page.evaluate(() => (window.__FAKE_CALLS || []).filter(c => c.name === 'issuePlayerQr').length)).toBe(0);
});

test('⭐ 已登入開 join：呼叫 issuePlayerQr 配卡、存進手機、導到我的挑戰卡 @challenge', async ({ page }) => {
  await stub(page, { user: LINE_USER });
  await page.goto('/#/challenge/join');
  await boot(page);

  await expect(page).toHaveURL(/#\/challenge\/me/, { timeout: 15_000 });
  await expect(page.locator('.chal__pid')).toHaveText('FEDA-0182', { timeout: 15_000 });
  const calls = await page.evaluate(() => (window.__FAKE_CALLS || []).filter(c => c.name === 'issuePlayerQr'));
  expect(calls.length).toBeGreaterThanOrEqual(1);
  const p = (await playersOf(page))[0];
  expect(p.nickname).toBe('阿哲');            // 暱稱先用 LINE 名稱
  expect(p.createdVia).toBe('line');
  // ⚠️ 這兩格只有 Function 改得動，rules 也擋著。玩家自己灌張數就是這裡防的
  expect(p.luckyDrawEntries).toBe(0);
  expect(p.completedChallengeIds).toEqual([]);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('feda:gamePass') || 'null'));
  expect(saved?.playerId).toBe('FEDA-0182');
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

test('⭐ 沒有卡也沒登入開 #/challenge/me：畫 LINE 登入卡 @challenge', async ({ page }) => {
  await stub(page);
  await page.goto('/#/challenge/me');
  await boot(page);
  await expect(page.locator('.chal__login')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.chal__qr')).toHaveCount(0);
});

test('⭐ 已登入但這支手機沒有卡：自動配一張，直接看到 QR @challenge', async ({ page }) => {
  await stub(page, { user: LINE_USER });
  await page.goto('/#/challenge/me');
  await boot(page);
  await expect(page.locator('.chal__pid')).toHaveText('FEDA-0182', { timeout: 15_000 });
  await expect(page.locator('.chal__qr svg')).toBeVisible();
});

test('⭐ 手機上的快取指到別張卡時，以伺服器配的那一張為準 @challenge', async ({ page }) => {
  await stub(page, { user: LINE_USER, players: { 'FEDA-0182': player() } });
  await withPass(page, 'FEDA-0999');                 // 舊快取
  await page.goto('/#/challenge/me');
  await boot(page);
  await expect(page.locator('.chal__pid')).toHaveText('FEDA-0182', { timeout: 15_000 });
});

test('⭐ 快取的代號在伺服器上不存在、又沒登入：說清楚並給 LINE 登入的路 @challenge', async ({ page }) => {
  await stub(page);                                   // 種子裡沒有這個玩家
  await withPass(page, 'FEDA-0182');
  await page.goto('/#/challenge/me');
  await boot(page);

  const box = page.locator('.chal__card--warn[role="alert"]');
  await expect(box).toContainText('FEDA-0182', { timeout: 15_000 });
  await expect(box.getByRole('button', { name: /LINE/ })).toBeVisible();
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
  await expect(page.locator('.chal__login')).toBeVisible({ timeout: 15_000 });
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

// ══════════════════════════════════════════════════════════════
//  #/challenge 首頁（docs/06 §8）
// ══════════════════════════════════════════════════════════════

test('⭐ 挑戰區首頁畫得出來，五關照 order 排 @challenge', async ({ page }) => {
  await stub(page);
  await page.goto('/#/challenge');
  await boot(page);

  await expect(page.locator('.chal__heroTitle')).toContainText('挑戰區', { timeout: 15_000 });
  const items = page.locator('.chal__item');
  await expect(items).toHaveCount(2);
  // 立牌上的攤位編號就是這個順序，現場的人照號碼找路
  await expect(items.nth(0)).toContainText('九宮格');
  await expect(items.nth(1)).toContainText('橫樑');
});

test('⭐ 還沒有挑戰卡的人也看得到五關（免註冊）@challenge', async ({ page }) => {
  await stub(page);
  await page.goto('/#/challenge');
  await boot(page);
  await expect(page.locator('.chal__item')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: /用 LINE 領挑戰卡/ })).toBeVisible();
});

test('⭐ 有挑戰卡時顯示進度與抽獎張數 @challenge', async ({ page }) => {
  await stub(page, { players: { 'FEDA-0182': player() } });
  await withPass(page, 'FEDA-0182');
  await page.goto('/#/challenge');
  await boot(page);

  await expect(page.locator('.chal__count').first()).toHaveText('1 / 2', { timeout: 15_000 });
  await expect(page.locator('.chal')).toContainText('1 張抽獎資格');
  await page.getByRole('button', { name: /我的 QR/ }).click();
  await expect(page).toHaveURL(/#\/challenge\/me/);
});

test('⭐ 點關卡進排行榜 @challenge', async ({ page }) => {
  await stub(page);
  await page.goto('/#/challenge');
  await boot(page);
  await page.locator('.chal__item').first().click();
  await expect(page).toHaveURL(/#\/challenge\/board\/g01-nine-grid/, { timeout: 15_000 });
});

test('⭐ 沒有關卡設定時說清楚，不是一片空白 @challenge', async ({ page }) => {
  await stub(page, { noChallenges: true });
  await page.goto('/#/challenge');
  await boot(page);
  await expect(page.locator('.chal')).toContainText('關卡還沒公布', { timeout: 15_000 });
});

// ══════════════════════════════════════════════════════════════
//  #/challenge/board/:challengeId（docs/06 §5.3）
// ══════════════════════════════════════════════════════════════

test('⭐ 排行榜畫得出來，前幾名照名次排 @challenge', async ({ page }) => {
  await stub(page, { boards: { 'g03-crossbar': board() } });
  await page.goto('/#/challenge/board/g03-crossbar');
  await boot(page);

  await expect(page.locator('.chal__heroTitle')).toContainText('橫樑', { timeout: 15_000 });
  const rows = page.locator('.chal__board .chal__boardRow');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Kevin');
  await expect(rows.nth(0)).toContainText('5次');
  await expect(rows.nth(2)).toContainText('小明');
});

test('⭐ 自己在前 50 名裡時，那一列被標起來、底下不再重複印一次 @challenge', async ({ page }) => {
  await stub(page, {
    players: { 'FEDA-0182': player() },
    boards: { 'g03-crossbar': board() }
  });
  await withPass(page, 'FEDA-0182');
  await page.goto('/#/challenge/board/g03-crossbar');
  await boot(page);

  const me = page.locator('.chal__boardRow[data-me="true"]');
  await expect(me).toHaveCount(1, { timeout: 15_000 });
  await expect(me).toContainText('阿哲');
  await expect(page.locator('.chal__myLine')).toHaveCount(0);
});

test('⭐ 自己不在前 50 名時，底部固定顯示自己那一列，名次由 ladder 算出來 @challenge', async ({ page }) => {
  // 這是 §5.3 的重點：排行榜文件只存前 50 列，第 51 名之後的人
  // 在客戶端沒有別的東西可以算名次——而那一列正是他點進來的理由
  await stub(page, {
    players: { 'FEDA-0900': player({ playerId: 'FEDA-0900', nickname: '排很後面' }) },
    boards: { 'g03-crossbar': board({ outsider: true }) },
    attempts: {
      'att-outsider': {
        attemptId: 'att-outsider', playerId: 'FEDA-0900', challengeId: 'g03-crossbar',
        rawValue: 1, isBest: true, voided: false,
        createdAt: '2026-10-11T09:30:00+08:00'
      }
    }
  });
  await withPass(page, 'FEDA-0900', '排很後面');
  await page.goto('/#/challenge/board/g03-crossbar');
  await boot(page);

  const mine = page.locator('.chal__myLine');
  await expect(mine).toBeVisible({ timeout: 15_000 });
  await expect(mine).toContainText('排很後面');
  await expect(mine).toContainText('1次');
  // ladder 上有 6 筆成績都比 1 好 → 第 7 名
  await expect(mine.locator('.chal__rank')).toHaveText('7');
});

test('⭐ 沒挑戰過這一關時說「你還沒挑戰過」，不要印一個猜的名次 @challenge', async ({ page }) => {
  // outsider 的那一份榜上沒有 FEDA-0182，而且沒有種任何 attempt →
  // 「我的最佳」是 null，所以既不該印名次也不該印成績
  await stub(page, {
    players: { 'FEDA-0182': player({ completedChallengeIds: [] }) },
    boards: { 'g03-crossbar': board({ outsider: true }) }
  });
  await withPass(page, 'FEDA-0182');
  await page.goto('/#/challenge/board/g03-crossbar');
  await boot(page);
  await expect(page.locator('.chal')).toContainText('你還沒挑戰過', { timeout: 15_000 });
});

test('⭐ 還沒有人挑戰時說得出來 @challenge', async ({ page }) => {
  await stub(page);                        // 沒有 leaderboard 文件
  await page.goto('/#/challenge/board/g03-crossbar');
  await boot(page);
  await expect(page.locator('.chal')).toContainText('還沒有人挑戰', { timeout: 15_000 });
});

test('⭐ 找不到這一關時給一條路回去 @challenge', async ({ page }) => {
  await stub(page);
  await page.goto('/#/challenge/board/g99-not-exist');
  await boot(page);
  await expect(page.locator('.chal__card--warn')).toContainText('找不到這一關', { timeout: 15_000 });
  await page.getByRole('button', { name: /回挑戰區/ }).click();
  await expect(page).toHaveURL(/#\/challenge$/);
});

// ══════════════════════════════════════════════════════════════
//  公開首頁的入口（docs/06 §9）
// ══════════════════════════════════════════════════════════════

test('⭐ 公開首頁最上面有挑戰區入口 @challenge', async ({ page }) => {
  await stub(page);
  await page.goto('/#/');
  await boot(page);

  const entry = page.locator('.pub__challengeEntry');
  await expect(entry).toBeVisible({ timeout: 15_000 });
  await expect(entry).toContainText('挑戰區');
  // ⚠️ 現場立牌的 QR 掃進來就是首頁，掃立牌的人多半是來玩遊戲的。
  //    藏在最底下的話攤位就沒有人——所以它要在第一屏。
  const y = await entry.evaluate(n => n.getBoundingClientRect().top);
  expect(y).toBeLessThan(600);

  await entry.click();
  await expect(page).toHaveURL(/#\/challenge$/);
});

// ── 中獎聯絡方式（docs/06 §7.2）────────────────────────────
const contactCalls = page => page.evaluate(() => (window.__FAKE_CALLS || []).filter(c => c.name === 'setPlayerContact'));

test('⭐ 中獎聯絡方式：登入的卡主走 Function，只帶代號與號碼（不再有憑證）@challenge @contact', async ({ page }) => {
  await stub(page, { user: LINE_USER, players: { 'FEDA-0182': player({ playerId: 'FEDA-0182' }) } });
  await page.goto('/#/challenge/me');
  await boot(page);
  await page.locator('#contact-phone').fill('0912-345-678');
  await page.locator('#contact-save').click();
  await expect.poll(async () => (await contactCalls(page))[0]?.payload, { timeout: 10_000 })
    .toMatchObject({ playerId: 'FEDA-0182', phone: '0912345678' });
  expect((await contactCalls(page))[0].payload.key).toBeUndefined();
  await expect(page.locator('.chal__card--contact')).toContainText('0912***678');
});

test('⭐ 沒登入（只有手機上的快取）：說要用 LINE 登入，不畫一個會失敗的表單 @challenge @contact', async ({ page }) => {
  await stub(page, { players: { 'FEDA-0182': player({ playerId: 'FEDA-0182' }) } });
  await withPass(page, 'FEDA-0182');
  await page.goto('/#/challenge/me');
  await boot(page);
  await expect(page.locator('.chal__card--contact')).toContainText('登入', { timeout: 15_000 });
  await expect(page.locator('#contact-phone')).toHaveCount(0);
});

test('手機格式不對留在畫面上，不送出 @challenge @contact', async ({ page }) => {
  await stub(page, { user: LINE_USER, players: { 'FEDA-0182': player({ playerId: 'FEDA-0182' }) } });
  await page.goto('/#/challenge/me');
  await boot(page);
  await page.locator('#contact-phone').fill('02-2345-6789');
  await page.locator('#contact-save').click();
  await expect(page.locator('.chal__contactErr')).toContainText('09 開頭');
  expect(await contactCalls(page)).toHaveLength(0);
});
