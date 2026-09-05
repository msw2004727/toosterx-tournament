/**
 * E2E｜人工裁定同分 `#/admin/standings`
 * ------------------------------------------------------------------
 * 規格：docs/02 §10、docs/05 §7.2；競賽規章第十九條
 *
 * ⚠️ **替身沒辦法真的執行 `setManualRanking`**（那是一支 Cloud Function），
 *    所以「裁定之後積分榜長什麼樣、晉級有沒有解開」由 `test:fn` 的
 *    F15–F15j 守。這裡守的是畫面層的六件事：
 *      ・待裁定的組別真的會出現，不待裁定的不會
 *      ・**送出去的參數是對的**（尤其是名次用原本那一群佔的名次）
 *      ・抽籤會留下種子，而且顯示出來
 *      ・不填原因就不送出
 *      ・callable 失敗時原因留在畫面上（不是只跳一個會消失的提示）
 *      ・沒有權限的人看得到原因，而不是一個空白頁
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'U7774e1410479bafff4997f51b2c47b95';
const SID = 'u6__group__A';

/** 第 1、2 名完全同分（規章四項條件都相同）；第 3 名分得出來 */
const tiedStanding = (over = {}) => ({
  standingId: SID, eventId: EVENT, divisionId: 'u6', stageId: 'group', groupId: 'A',
  version: 4, hasUnresolvedTie: true,
  manualOverride: { enabled: false, by: null, at: null, reason: null },
  rows: [
    { teamId: 't-1', rank: 1, points: 3, goalsFor: 1, goalsAgainst: 1, goalDiff: 0, hasUnresolvedTie: true, tiedWith: ['t-2'], locked: false },
    { teamId: 't-2', rank: 2, points: 3, goalsFor: 1, goalsAgainst: 1, goalDiff: 0, hasUnresolvedTie: true, tiedWith: ['t-1'], locked: false },
    { teamId: 't-3', rank: 3, points: 0, goalsFor: 0, goalsAgainst: 2, goalDiff: -2, hasUnresolvedTie: false, tiedWith: [], locked: false }
  ],
  ...over
});

/** 第 3、4 名同分——名次不是 1、2，這一組守的是 pinsFrom 有沒有送對 */
const tied34 = () => ({
  standingId: 'women__group__A', eventId: EVENT, divisionId: 'women',
  stageId: 'group', groupId: 'A', version: 2, hasUnresolvedTie: true,
  manualOverride: { enabled: false, by: null, at: null, reason: null },
  rows: [
    { teamId: 't-1', rank: 1, points: 9, hasUnresolvedTie: false, tiedWith: [], locked: false },
    { teamId: 't-2', rank: 2, points: 6, hasUnresolvedTie: false, tiedWith: [], locked: false },
    { teamId: 't-3', rank: 3, points: 1, hasUnresolvedTie: true, tiedWith: ['t-4'], locked: false },
    { teamId: 't-4', rank: 4, points: 1, hasUnresolvedTie: true, tiedWith: ['t-3'], locked: false }
  ]
});

const seed = ({ roles = ['admin'], standings = [tiedStanding()], perms = null } = {}) => {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo' },
    [`users/${UID}`]: { uid: UID, displayName: '金小麥' },
    [`staff/${UID}`]: {
      uid: UID, name: '金小麥', roles, active: true,
      assignment: { eventId: EVENT, venueIds: [], divisionIds: [], challengeIds: [] }
    },
    [`events/${EVENT}/divisions/u6`]: { divisionId: 'u6', name: 'U6兒童組', order: 1 },
    [`events/${EVENT}/divisions/women`]: { divisionId: 'women', name: '女子組', order: 4 },
    [`events/${EVENT}/teams/t-1`]: { teamId: 't-1', name: '臺中雷霆', divisionId: 'u6' },
    [`events/${EVENT}/teams/t-2`]: { teamId: 't-2', name: '臺中黑豹', divisionId: 'u6' },
    [`events/${EVENT}/teams/t-3`]: { teamId: 't-3', name: '彰化飛鷹', divisionId: 'u6' },
    [`events/${EVENT}/teams/t-4`]: { teamId: 't-4', name: '南投獵人', divisionId: 'u6' }
  };
  for (const st of standings) s[`events/${EVENT}/standings/${st.standingId}`] = st;
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
  await page.goto('/#/admin/standings');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

/**
 * ⚠️ 斷言「某個東西不存在」之前一定要先等頁面**真的畫出來**。
 *    toHaveCount(0) 在還沒渲染的空白頁上會立刻成立（變異 #E7 就是這樣逃掉的）。
 */
const ready = page => expect(page.locator('.adm__head')).toBeVisible({ timeout: 15_000 });

const callsOf = page => page.evaluate(() => window.__FAKE_CALLS || []);
const answerPrompt = (page, text) =>
  page.once('dialog', d => (text == null ? d.dismiss() : d.accept(text)));

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('⭐ 待裁定的組別會出現，隊名與統計都印得出來 @adminstandings', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);

  await expect(page.locator('.adm__head')).toContainText('1 組待裁定');
  const card = page.locator('[data-tie]').first();
  await expect(card).toContainText('U6兒童組');
  await expect(card).toContainText('臺中雷霆');
  await expect(card).toContainText('臺中黑豹');
  // 分得出勝負的第 3 名不該出現在裁定清單裡
  await expect(card).not.toContainText('彰化飛鷹');
});

test('⭐ 沒有待裁定時說清楚為什麼，不是一片空白 @adminstandings', async ({ page }) => {
  await stub(page, { standings: [tiedStanding({ hasUnresolvedTie: false })] });
  await go(page);
  await ready(page);
  await expect(page.locator('.adm')).toContainText('目前沒有需要裁定的同分');
  await expect(page.locator('[data-tie]')).toHaveCount(0);
});

test('⭐ 送出裁定：名次與原因都送對了 @adminstandings', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);

  // 把第二名往上換——裁定「臺中黑豹第 1」
  await page.getByRole('button', { name: '臺中黑豹 往上' }).click();
  answerPrompt(page, '主辦當場抽籤');
  await page.getByRole('button', { name: /^送出裁定$/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^送出裁定$/ }).click();

  await expect.poll(async () => (await callsOf(page)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const c = (await callsOf(page)).find(x => x.name === 'setManualRanking');
  expect(c).toBeTruthy();
  expect(c.payload.pins).toEqual([{ teamId: 't-2', rank: 1 }, { teamId: 't-1', rank: 2 }]);
  expect(c.payload.reason).toBe('主辦當場抽籤');
  expect(c.payload.divisionId).toBe('u6');
  expect(c.payload.groupId).toBe('A');
});

test('⭐ 第 3、4 名同分時釘的是 3 與 4，不是 1 與 2 @adminstandings', async ({ page }) => {
  // 寫成 1、2 的話 applyManualRanking 照樣照著釘，而那會把兩隊搬到榜首——
  // 整張積分榜錯掉，而且不會有任何錯誤訊息
  await stub(page, { standings: [tied34()] });
  await go(page);
  await ready(page);

  answerPrompt(page, '抽籤');
  await page.getByRole('button', { name: /^送出裁定$/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^送出裁定$/ }).click();

  await expect.poll(async () => (await callsOf(page)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const c = (await callsOf(page)).find(x => x.name === 'setManualRanking');
  expect(c.payload.pins).toEqual([{ teamId: 't-3', rank: 3 }, { teamId: 't-4', rank: 4 }]);
});

test('⭐ 抽籤要留下種子，而且送得出去（事後重放得出來）@adminstandings', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);

  await page.getByRole('button', { name: /抽籤決定/ }).click();
  await expect(page.locator('[data-tie]').first()).toContainText('抽籤種子');

  answerPrompt(page, '抽籤');
  await page.getByRole('button', { name: /^送出裁定$/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^送出裁定$/ }).click();

  await expect.poll(async () => (await callsOf(page)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const c = (await callsOf(page)).find(x => x.name === 'setManualRanking');
  expect(Number.isInteger(c.payload.drawSeed)).toBe(true);
  // 抽出來的順序就是送出去的順序
  expect(c.payload.pins.map(p => p.teamId).sort()).toEqual(['t-1', 't-2']);
});

test('⭐ 不填原因就不送出 @adminstandings', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);

  answerPrompt(page, null);                     // 按取消
  await page.getByRole('button', { name: /^送出裁定$/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^送出裁定$/ }).click();
  await page.waitForTimeout(800);

  expect((await callsOf(page)).filter(x => x.name === 'setManualRanking')).toHaveLength(0);
});

test('⭐ 按下去之前先講後果 @adminstandings', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);

  await page.getByRole('button', { name: /^送出裁定$/ }).click();
  const modal = page.locator('.modal');
  await expect(modal).toContainText('公開端');
  await expect(modal).toContainText('晉級');
  await expect(modal).toContainText('稽核');
});

test('⭐ callable 失敗時原因留在畫面上 @adminstandings', async ({ page }) => {
  await stub(page);
  await page.addInitScript(() => { window.__FAKE_CALL_ERROR = '伺服器拒絕了這次裁定'; });
  await go(page);
  await ready(page);

  answerPrompt(page, '抽籤');
  await page.getByRole('button', { name: /^送出裁定$/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^送出裁定$/ }).click();

  // 「按了沒反應」是最難回報的故障——原因不可以**只**在 toast 上。
  // 所以這裡刻意把 toast 關掉，再確認頁面上那一格還在。
  const box = page.locator('.adm__box--warn[role="alert"]');
  await expect(box).toContainText('伺服器拒絕了這次裁定', { timeout: 15_000 });
  await page.locator('.toast--error .toast__close').click();
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 });
  await expect(box).toContainText('伺服器拒絕了這次裁定');
});

test('⭐ 已裁定的組別顯示原因與種子，並且可以解除 @adminstandings', async ({ page }) => {
  await stub(page, {
    standings: [tiedStanding({
      hasUnresolvedTie: false,
      manualOverride: { enabled: true, by: UID, at: null, reason: '主辦抽籤', drawSeed: 12345 },
      rows: [
        { teamId: 't-2', rank: 1, hasUnresolvedTie: false, tiedWith: [], locked: true },
        { teamId: 't-1', rank: 2, hasUnresolvedTie: false, tiedWith: [], locked: true },
        { teamId: 't-3', rank: 3, hasUnresolvedTie: false, tiedWith: [], locked: false }
      ]
    })]
  });
  await go(page);
  await ready(page);

  await expect(page.locator('.adm__box--ok')).toContainText('已裁定');
  await expect(page.locator('.adm__box--ok')).toContainText('主辦抽籤');
  await expect(page.locator('.adm__box--ok')).toContainText('12345');

  answerPrompt(page, '抽籤結果作廢');
  await page.getByRole('button', { name: /^解除裁定$/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^解除裁定$/ }).click();

  await expect.poll(async () => (await callsOf(page)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const c = (await callsOf(page)).find(x => x.name === 'setManualRanking');
  expect(c.payload.clear).toBe(true);
  expect(c.payload.reason).toBe('抽籤結果作廢');
});

test('⭐ 記錄員進不來，而且看得到原因 @adminstandings', async ({ page }) => {
  await stub(page, { roles: ['scorer'] });
  await go(page);
  await expect(page.locator('.adm__box--warn')).toContainText('人工裁定同分');
  await expect(page.locator('[data-tie]')).toHaveCount(0);
});

test('⭐ 總管關掉這一條之後，管理員就進不來 @adminstandings', async ({ page }) => {
  await stub(page, { perms: { admin: { 'standing.manual': false } } });
  await go(page);
  await expect(page.locator('.adm__box--warn')).toContainText('人工裁定同分');
  await expect(page.locator('[data-tie]')).toHaveCount(0);
});
