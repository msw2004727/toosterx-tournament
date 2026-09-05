/**
 * E2E｜場次改判 `#/admin/match/:matchId`
 * ------------------------------------------------------------------
 * 規格：docs/04 §6；競賽規章第十八條第 6 款
 *
 * 這一頁是比賽當天記錯分時**唯一**的補救工具（賽務台送出完賽超過三分鐘
 * 就鎖住了）。守五件事：
 *   ・**每一個動作都必填原因**，而且真的寫進稽核
 *   ・**按下去之前先講後果**（積分榜會收回分數、名次會變）
 *   ・**改比分一定要跟著改 result**，不然積分榜用舊的勝負
 *   ・**棄賽比分不給填**，由規章判 0:2
 *   ・**權限逐項判斷**：總管關掉其中一條，那顆按鈕就不見
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'U7774e1410479bafff4997f51b2c47b95';
const MATCH = 'AO-G-A-01';

const match = (over = {}) => ({
  matchId: MATCH, eventId: EVENT, divisionId: 'adult-open', stageId: 'group', groupId: 'A',
  round: 1, matchNo: 5, label: 'A組 第1輪', date: '2026-10-11',
  kickoffAt: { seconds: Math.floor(Date.parse('2026-10-11T01:00:00Z') / 1000), nanoseconds: 0 },
  venueId: 'venue-a', venueName: 'A場',
  home: { teamId: 't-1', name: '臺中雷霆', displayName: '臺中雷霆' },
  away: { teamId: 't-2', name: '臺中黑豹', displayName: '臺中黑豹' },
  teamIds: ['t-1', 't-2'],
  score: { home: 2, away: 1 }, penaltyScore: { home: null, away: null },
  status: 'finished', period: 'ft', revisionCount: 0,
  result: { winner: 'home', method: 'regulation', homePoints: 3, awayPoints: 0 },
  lock: { locked: true, lockedAt: null, lockedBy: 'u-scorer' },
  ...over
});

const seed = ({ roles = ['admin'], m = match(), perms = null } = {}) => {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo' },
    [`users/${UID}`]: { uid: UID, displayName: '金小麥' },
    [`staff/${UID}`]: {
      uid: UID, name: '金小麥', roles, active: true,
      assignment: { eventId: EVENT, venueIds: [], divisionIds: [], challengeIds: [] }
    },
    [`events/${EVENT}/matches/${MATCH}`]: m
  };
  if (perms) for (const [role, p] of Object.entries(perms)) s[`rolePermissions/${role}`] = { role, perms: p };
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
  await page.goto(`/#/admin/match/${MATCH}`);
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

const dump = page => page.evaluate(() => window.__fake.__dump());
const matchOf = async page => (await dump(page))[`events/${EVENT}/matches/${MATCH}`];
const auditsOf = async page => Object.entries(await dump(page))
  .filter(([k]) => k.includes('/audits/')).map(([, v]) => v);

const ready = page => expect(page.locator('.adm__head')).toBeVisible({ timeout: 15_000 });

/** 這一頁的原因用 window.prompt 收（一天用不到幾次，少一個自製元件要驗） */
const answerPrompt = (page, text) =>
  page.once('dialog', d => (text == null ? d.dismiss() : d.accept(text)));

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('⭐ 記錄員進不來，而且看得到原因 @adminmatch', async ({ page }) => {
  await stub(page, { roles: ['scorer'] });
  await go(page);
  await expect(page.locator('.adm__box--warn')).toContainText('場次改判');
  await expect(page.getByRole('button', { name: /改判比分/ })).toHaveCount(0);
});

test('⭐ 頁首顯示現在的狀態與已改判次數 @adminmatch', async ({ page }) => {
  await stub(page, { m: match({ revisionCount: 2 }) });
  await go(page);
  await ready(page);
  await expect(page.locator('.adm__box').first()).toContainText('臺中雷霆 vs 臺中黑豹');
  await expect(page.locator('.adm__box').first()).toContainText('已鎖定');
  await expect(page.locator('.adm__box').first()).toContainText('已改判 2 次');
});

test('⭐ 改判比分：result 跟著重算，而且留痕 @adminmatch', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);

  await page.locator('#sc-home').fill('0');
  await page.locator('#sc-away').fill('3');
  // 按下去之前先看到「改判後的判定」
  await expect(page.locator('.adm')).toContainText('臺中黑豹 勝');

  answerPrompt(page, '賽務記錯隊伍');
  await page.getByRole('button', { name: /^改判比分$/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^改判比分$/ }).click();

  await expect.poll(async () => (await matchOf(page))?.score?.away, { timeout: 15_000 }).toBe(3);
  const m = await matchOf(page);
  expect(m.score).toEqual({ home: 0, away: 3 });
  expect(m.result).toMatchObject({ winner: 'away', homePoints: 0, awayPoints: 3 });
  expect(m.revisionCount).toBe(1);

  const a = (await auditsOf(page)).find(x => x.action === 'match.override');
  expect(a).toBeTruthy();
  expect(a.reason).toBe('賽務記錯隊伍');
  expect(a.before.score).toEqual({ home: 2, away: 1 });
  expect(a.after.score).toEqual({ home: 0, away: 3 });
});

test('⭐ 不填原因就不寫入 @adminmatch', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await page.locator('#sc-home').fill('5');

  answerPrompt(page, null);                 // 按取消
  await page.getByRole('button', { name: /^改判比分$/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^改判比分$/ }).click();
  await page.waitForTimeout(800);

  expect((await matchOf(page)).score).toEqual({ home: 2, away: 1 });
  expect(await auditsOf(page)).toHaveLength(0);
});

test('⭐ 按下去之前先講後果 @adminmatch', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await page.getByRole('button', { name: /^重開場次$/ }).click();
  const modal = page.locator('.modal');
  await expect(modal).toContainText('收回');
  await expect(modal).toContainText('晉級');
  await expect(modal).toContainText('保留');
  await modal.getByRole('button', { name: /取消/ }).click();
  expect((await matchOf(page)).status).toBe('finished');
});

test('⭐ 重開：退回進行中、解鎖，比分留著 @adminmatch', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);

  answerPrompt(page, '賽務按錯');
  await page.getByRole('button', { name: /^重開場次$/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^重開場次$/ }).click();

  await expect.poll(async () => (await matchOf(page))?.status, { timeout: 15_000 }).toBe('live');
  const m = await matchOf(page);
  expect(m.lock).toEqual({ locked: false, lockedAt: null, lockedBy: null });
  expect(m.result).toBeNull();
  expect(m.score).toEqual({ home: 2, away: 1 });     // 比分留著
});

test('覆核完賽不用填原因（不是破壞性的）@adminmatch', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await page.getByRole('button', { name: /^覆核完賽$/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^覆核完賽$/ }).click();
  await expect.poll(async () => (await matchOf(page))?.status, { timeout: 15_000 }).toBe('confirmed');
});

test('⭐ 已覆核的場次不能再覆核，而且說得出原因 @adminmatch', async ({ page }) => {
  await stub(page, { m: match({ status: 'confirmed' }) });
  await go(page);
  await ready(page);
  await expect(page.getByRole('button', { name: /^覆核完賽$/ })).toBeDisabled();
  await expect(page.locator('.adm__permMeta').first()).toContainText('已經覆核');
});

test('⭐ 判棄賽：比分由規章算成 0:2，不給填 @adminmatch', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await expect(page.locator('.adm')).toContainText('逾時 5 分鐘不出場以棄權論 0:2');

  answerPrompt(page, '逾時未到場');
  await page.getByRole('button', { name: /臺中雷霆 棄賽/ }).click();
  await page.locator('.modal').getByRole('button', { name: /棄賽/ }).click();

  await expect.poll(async () => (await matchOf(page))?.status, { timeout: 15_000 }).toBe('walkover');
  const m = await matchOf(page);
  expect(m.walkoverSide).toBe('home');
  expect(m.score).toEqual({ home: 0, away: 2 });      // 主隊棄賽 → 客隊 2:0
  expect(m.result).toMatchObject({ winner: 'away', method: 'walkover' });
});

test('⭐ 還沒開打的場次不給改判，要用賽務台 @adminmatch', async ({ page }) => {
  await stub(page, { m: match({ status: 'scheduled', lock: { locked: false, lockedAt: null, lockedBy: null } }) });
  await go(page);
  await ready(page);
  await expect(page.locator('.adm')).toContainText('賽務台記分');
  await expect(page.locator('#sc-home')).toHaveCount(0);
});

test('⭐ 總管關掉「改判比分」之後那一區就不見 @adminmatch', async ({ page }) => {
  await stub(page, { perms: { admin: { 'match.score.override': false } } });
  await go(page);
  await ready(page);
  await expect(page.locator('#sc-home')).toHaveCount(0);
  // 覆核與重開是不同的權限碼，不受影響
  await expect(page.getByRole('button', { name: /^覆核完賽$/ })).toBeVisible();
});

test('找不到場次時說得清楚 @adminmatch', async ({ page }) => {
  await stub(page, { m: null });
  await page.goto('/#/admin/match/NOT-EXIST');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
  await expect(page.locator('.adm__box--warn')).toContainText('找不到這一場');
});

test('⭐ 320px 不出現橫向捲軸 @adminmatch @narrow', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  const over = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth <= d.clientWidth ? null : { scroll: d.scrollWidth, client: d.clientWidth };
  });
  expect(over).toBeNull();
});
