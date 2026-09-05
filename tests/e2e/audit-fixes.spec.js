/**
 * E2E｜驗收整合修正（2026-09-06）
 * ------------------------------------------------------------------
 * 兩份外部驗收報告（《驗收計畫書整合版》D-01…D-15、《Codex 獨立唯讀驗收》C-01）
 * 指出的畫面層缺陷，修掉之後在這裡各留一條會紅的測試。純邏輯的部分在
 * tests/unit/audit-fixes.test.js（T58）；改判與賽程頁的在 admin-match / admin-schedule。
 *
 * 這一支是 scripts/mutation-e2e.cjs 的目標 spec 之一（#E18 起），所以每一條
 * 斷言「不存在」之前都先等頁面真的畫出來（變異 #E7 的教訓）。
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const MATCH = 'U10-G-A-01';
const DATE = '2026-10-09';
const UID = 'u-e2e';

const staffDoc = (roles, over = {}) => ({
  uid: UID, name: '陳賽務', roles, active: true, selfServe: true,
  assignment: { eventId: EVENT, venueIds: ['venue-a'], divisionIds: [], challengeIds: ['g03-crossbar'] },
  ...over
});

const u10Match = (over = {}) => ({
  matchId: MATCH, eventId: EVENT, divisionId: 'u10', stageId: 'group', groupId: 'A',
  label: '第1場 A組第1輪', venueId: 'venue-a', venueName: 'A場', date: DATE,
  kickoffAt: '2026-10-09T09:30:00+08:00',
  home: { teamId: 't-101', name: '大甲金剛' }, away: { teamId: 't-102', name: '沙鹿飛龍' },
  teamIds: ['t-101', 't-102'],
  score: { home: 0, away: 0 }, status: 'scheduled', period: 'pre',
  clock: { running: false, periodStartedAt: null, elapsedSecAtPause: 0, addedTimeSec: 0 },
  lock: { locked: false, lockedAt: null, lockedBy: null },
  ...over
});

const CROSSBAR = {
  challengeId: 'g03-crossbar', order: 3, icon: 'crossbar',
  name: 'Ronaldinho 橫樑挑戰', shortName: '橫樑', boothLocation: '攤位 3',
  rulesText: '固定 5 球，紀錄擊中橫樑次數。',
  scoreType: 'count', unit: '次', rankingRule: 'higher', decimals: 0,
  minValue: 0, maxValue: 5, inputMode: 'stepper', stepperMax: 5,
  attemptPolicy: { maxAttemptsPerPlayer: 3, allowRepeat: true, rankBy: 'best' },
  status: 'open'
};

const base = ({ roles = ['scorer'], match = u10Match(), extra = {} } = {}) => ({
  [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
  'config/env': { env: 'demo', allowSelfServeStaff: true },
  [`users/${UID}`]: { uid: UID, displayName: '陳賽務' },
  [`staff/${UID}`]: staffDoc(roles),
  [`events/${EVENT}/divisions/u10`]: {
    // ⚠️ 六個組別都是單節（規章第十八條第 2 款），periods: 1 是真實資料庫的值
    divisionId: 'u10', name: 'U10兒童組', order: 3, matchDurationMin: 25, periods: 1, playersOnField: 5,
    eligibility: { bornOnOrAfter: '2016-09-01' },
    display: { mercyRule: { enabled: false, cap: 7 }, scorerBoard: false }
  },
  [`events/${EVENT}/venues/venue-a`]: { venueId: 'venue-a', name: 'A場', order: 1 },
  [`events/${EVENT}/matches/${MATCH}`]: match,
  [`events/${EVENT}/teams/t-101`]: { teamId: 't-101', name: '大甲金剛', divisionId: 'u10', groupId: 'A' },
  [`events/${EVENT}/teams/t-102`]: { teamId: 't-102', name: '沙鹿飛龍', divisionId: 'u10', groupId: 'A' },
  // 名冊：教練**有背號**（1 號）但不是球員——排序與按鈕都要看得出他不上場。
  // 「沒背號」的球員 jerseyNo 是 null：Firestore 的 orderBy 會把他排到最前面。
  [`events/${EVENT}/teams/t-101/roster/m-c`]: { memberId: 'm-c', displayName: '林教練', role: 'coach', jerseyNo: 1, order: 0 },
  [`events/${EVENT}/teams/t-101/roster/m-1`]: { memberId: 'm-1', displayName: '小豆子', role: 'player', jerseyNo: 7, order: 1 },
  [`events/${EVENT}/teams/t-101/roster/m-2`]: { memberId: 'm-2', displayName: '阿光', role: 'player', jerseyNo: 9, order: 2 },
  [`events/${EVENT}/teams/t-101/roster/m-n`]: { memberId: 'm-n', displayName: '沒背號', role: 'player', jerseyNo: null, order: 3 },
  [`events/${EVENT}/teams/t-102/roster/m-9`]: { memberId: 'm-9', displayName: '小龍', role: 'player', jerseyNo: 11, order: 1 },
  [`events/${EVENT}/challenges/g03-crossbar`]: CROSSBAR,
  ...extra
});

const LIFF_STUB = `window.liff = {
  init: () => Promise.resolve(), isInClient: () => false, isLoggedIn: () => false,
  login: () => { window.__liffLoginCalled = true; }, getIDToken: () => null, logout: () => {}
};`;

async function stub(page, seed, { user = { uid: UID, displayName: '陳賽務' }, init = null } = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r =>
    r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript', body: LIFF_STUB }));
  await page.route('https://www.youtube-nocookie.com/**', r =>
    r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>fake player</body></html>' }));
  await page.addInitScript(({ s, u, init }) => {
    window.__FAKE_SEED = s;
    window.__seedData = s;
    window.__FAKE_USER = u;
    if (init) Object.assign(window, init);
  }, { s: seed, u: user, init });
}

async function go(page, hash) {
  await page.goto(hash);
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

const dump = page => page.evaluate(() => window.__fake.__dump());

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

// ── D-02 登入頁 ────────────────────────────────────────────

test('⭐ D-02 已登入的人開登入頁會直接被帶去「我的」，不是整頁空白 @audit @account', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await stub(page, base());
  await go(page, '/#/login');
  await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toBe('#/my');
  await expect(page.locator('.acct')).toContainText(/陳賽務/, { timeout: 15_000 });
  expect(errors.filter(t => /before initialization/.test(t))).toEqual([]);
});

test('D-02 沒登入時登入頁正常顯示登入鈕 @audit @account', async ({ page }) => {
  await stub(page, base(), { user: null });
  await go(page, '/#/login');
  await expect(page.getByRole('button', { name: /LINE/ })).toBeVisible({ timeout: 15_000 });
});

// ── D-07 公開比賽頁 ────────────────────────────────────────

test('⭐ D-07 單節組別的比賽頁：沒有「半場」，事件寫「比賽 開始」不寫「上半場」 @audit @public', async ({ page }) => {
  await stub(page, base({
    match: u10Match({ status: 'finished', period: 'ft', score: { home: 2, away: 1 }, htScore: { home: 1, away: 0 } }),
    extra: {
      [`events/${EVENT}/matches/${MATCH}/timeline/0001-ps`]: {
        timelineId: '0001-ps', matchId: MATCH, type: 'period_start', periodId: 'h1', seq: 1, clockSec: 0, voided: false
      },
      [`events/${EVENT}/matches/${MATCH}/timeline/0002-goal`]: {
        timelineId: '0002-goal', matchId: MATCH, type: 'goal', side: 'home', seq: 2,
        clockSec: 320, periodId: 'h1', playerName: '小豆子', jerseyNo: 7, voided: false
      }
    }
  }), { user: null });
  await go(page, `/#/match/${MATCH}`);
  await expect(page.locator('#psb-home')).toHaveText('2', { timeout: 15_000 });
  await expect(page.locator('.ptl__text', { hasText: '比賽 開始' })).toBeVisible();
  await expect(page.locator('.psb__ht')).toHaveCount(0);
  await expect(page.locator('.ptl__text', { hasText: '上半場' })).toHaveCount(0);
});

// ── D-08 名冊順序與隊職員 ─────────────────────────────────

test('⭐ D-08 出場名單：球員依背號在前、隊職員最後，而且隊職員沒有先發／替補鈕 @audit @staff', async ({ page }) => {
  await stub(page, base());
  await go(page, `/#/staff/sheet/${MATCH}`);
  await expect(page.getByText('小豆子')).toBeVisible({ timeout: 15_000 });
  const names = await page.locator('.roster').first().locator('.roster__name').allTextContents();
  expect(names).toEqual(['小豆子', '阿光', '沒背號', '林教練']);
  const coach = page.locator('.roster__row', { hasText: '林教練' });
  await expect(coach).toContainText('教練');
  await expect(coach.getByRole('button', { name: '先發' })).toHaveCount(0);
  await expect(page.locator('.roster__row', { hasText: '小豆子' }).getByRole('button', { name: '先發' })).toBeVisible();
});

test('⭐ D-08 賽務台記進球時的球員選單只列球員，教練不在裡面 @audit @staff', async ({ page }) => {
  await stub(page, base());
  await go(page, `/#/staff/match/${MATCH}`);
  await expect(page.locator('.sb__num').first()).toHaveText('0', { timeout: 15_000 });
  await page.locator('.bigbtn', { hasText: '進球' }).click();
  await page.locator('.sheet__opt', { hasText: '大甲金剛' }).click();
  await expect(page.locator('.sheet__opt', { hasText: '小豆子' })).toBeVisible();
  await expect(page.locator('.sheet__opt', { hasText: '林教練' })).toHaveCount(0);
});

// ── D-13 賽務首頁的工具列 ─────────────────────────────────

test('⭐ D-13 攤位人員的賽務首頁沒有「檢錄」與「出場名單」鈕（按了只會看到沒有權限）@audit @staff @perm', async ({ page }) => {
  await stub(page, base({ roles: ['booth'] }));
  await go(page, '/#/staff');
  await expect(page.locator('.staff__head')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: '檢錄' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '出場名單' })).toHaveCount(0);
});

test('D-13 檢錄員看得到「檢錄」、看不到「出場名單」 @audit @staff @perm', async ({ page }) => {
  await stub(page, base({ roles: ['checkin'] }));
  await go(page, '/#/staff');
  await expect(page.locator('.staff__head')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: '檢錄' })).toBeVisible();
  await expect(page.getByRole('button', { name: '出場名單' })).toHaveCount(0);
});

test('D-13 記錄員兩個都有 @audit @staff @perm', async ({ page }) => {
  await stub(page, base({ roles: ['scorer'] }));
  await go(page, '/#/staff');
  await expect(page.locator('.staff__head')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: '檢錄' })).toBeVisible();
  await expect(page.getByRole('button', { name: '出場名單' })).toBeVisible();
});

// ── D-14 找不到頁面 ───────────────────────────────────────

test('⭐ D-14 找不到頁面時分頁標題也換掉，不掛著上一頁的名字 @audit @public', async ({ page }) => {
  await stub(page, base(), { user: null });
  await go(page, '/#/no-such-page');
  await expect(page.locator('.empty__title')).toHaveText('找不到這個頁面', { timeout: 15_000 });
  await expect(page).toHaveTitle(/找不到頁面/);
});

// ── D-15 觸控目標 ─────────────────────────────────────────

test('⭐ D-15 主題切換鈕與積分榜隊名的觸控目標高度 ≥ 44px @audit @public @narrow', async ({ page }) => {
  await stub(page, base({ extra: {
    [`events/${EVENT}/standings/u10__group__A`]: {
      standingId: 'u10__group__A', divisionId: 'u10', stageId: 'group', groupId: 'A', hasUnresolvedTie: false,
      rows: [
        { rank: 1, teamId: 't-101', name: '大甲金剛', played: 1, win: 1, draw: 0, loss: 0, goalsFor: 2, goalsAgainst: 0, goalDiff: 2, points: 3 },
        { rank: 2, teamId: 't-102', name: '沙鹿飛龍', played: 1, win: 0, draw: 0, loss: 1, goalsFor: 0, goalsAgainst: 2, goalDiff: -2, points: 0 }
      ]
    }
  } }), { user: null });
  await go(page, '/#/division/u10');
  const team = page.locator('button.ptable__team').first();
  await expect(team).toBeVisible({ timeout: 15_000 });
  expect((await team.boundingBox()).height).toBeGreaterThanOrEqual(44);

  const opts = page.locator('.theme-switch__opt');
  await expect(opts).toHaveCount(3);
  for (const o of await opts.all()) {
    const box = await o.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  // 頁首的「首頁」「登入／我的」：Codex 在 320px 量到 21×44
  const links = page.locator('.apphead__link');
  await expect(links).toHaveCount(2);
  for (const l of await links.all()) {
    const box = await l.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
});

// ── D-03／D-04 挑戰攤位 ───────────────────────────────────

const boothSeed = () => base({ roles: ['booth'], extra: {
  [`events/${EVENT}/players/FEDA-0182`]: {
    playerId: 'FEDA-0182', eventId: EVENT, nickname: '阿哲', ageBand: 'adult',
    completedChallengeIds: [], luckyDrawEntries: 0, createdVia: 'self-qr'
  }
} });

test('⭐ D-04 現場代建的卡可以直接送出 0 分（不必先按 ＋ 再按 −）@audit @booth', async ({ page }) => {
  await stub(page, boothSeed());
  await go(page, '/#/booth');
  await expect(page.locator('.booth')).toBeVisible({ timeout: 15_000 });
  await page.locator('#booth-id').fill('FEDA-9999');
  await page.getByRole('button', { name: /查詢/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^代建$/ }).click();
  await expect(page.locator('.booth__nick')).toContainText('FEDA-9999');
  await page.getByRole('button', { name: /送出成績/ }).click();
  await expect.poll(async () => Object.entries(await dump(page))
    .filter(([k]) => k.includes('/attempts/')).map(([, v]) => v)
    .find(a => a.playerId === 'FEDA-9999')?.rawValue, { timeout: 15_000 }).toBe(0);
});

test('⭐ D-03 「最近登錄」讀不到時要說出來，不是靜靜消失（缺索引在正式站才會發生）@audit @booth', async ({ page }) => {
  await stub(page, boothSeed(), { init: { __FAKE_SNAPSHOT_FAIL: { path: 'attempts', field: 'staffUid', code: 'failed-precondition' } } });
  await go(page, '/#/booth');
  await expect(page.locator('.booth')).toBeVisible({ timeout: 15_000 });
  await page.locator('#booth-id').fill('FEDA-0182');
  await page.getByRole('button', { name: /查詢/ }).click();
  await expect(page.locator('.booth__nick')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#booth-recent-error')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#booth-recent-error')).toContainText('沒辦法作廢');
});
