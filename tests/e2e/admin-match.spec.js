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

const seed = ({ roles = ['admin'], m = match(), perms = null, extra = null } = {}) => {
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
  if (extra) Object.assign(s, extra);
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

// ── 申訴（規章第二十條）────────────────────────────────────
const T = ms => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 });
const finishedAgo = min => match({ scoreSubmittedAt: T(Date.now() - min * 60_000) });
const appealOf = async page => (await dump(page))[`events/${EVENT}/appeals/${MATCH}-t-1`];
const filedAppeal = () => ({
  appealId: `${MATCH}-t-1`, matchId: MATCH, matchNo: 5, divisionId: 'adult-open',
  teamId: 't-1', opponentTeamId: 't-2',
  filedBy: { role: 'leader', name: '王領隊', phone: null },
  minutesAfter: 10, withinWindow: true, late: false, deposit: 2000, depositPaid: true,
  reason: '第 60 分鐘的進球越位在先', status: 'filed', decision: null, createdBy: UID
});

async function fillAppeal(page) {
  await page.locator('#ap-new').click();
  await page.locator('#ap-name').fill('王領隊');
  await page.locator('#ap-phone').fill('0912-345-678');
  await page.locator('#ap-reason').fill('第 60 分鐘的進球越位在先');
}

test('⭐ 完賽 10 分鐘內登記申訴：寫 appeals、場次掛徽章、留痕 @adminmatch @appeal', async ({ page }) => {
  await stub(page, { m: finishedAgo(10) });
  await go(page);
  await ready(page);
  await fillAppeal(page);
  await expect(page.locator('.adm__appeals')).toContainText('還在 30 分鐘內');
  await page.locator('#ap-deposit').check();
  await page.locator('#ap-file').click();

  await expect.poll(async () => (await appealOf(page))?.status, { timeout: 15_000 }).toBe('filed');
  expect(await appealOf(page)).toMatchObject({
    teamId: 't-1', opponentTeamId: 't-2', deposit: 2000, depositPaid: true,
    withinWindow: true, late: false, filedBy: { role: 'leader', name: '王領隊', phone: '0912-345-678' }
  });
  expect((await matchOf(page)).appeal).toEqual({ status: 'filed', teamId: 't-1' });
  expect((await auditsOf(page)).some(a => a.action === 'appeal.filed')).toBe(true);
  await expect(page.locator('.adm__appeal')).toContainText('申訴審理中');
});

test('⭐ 保證金沒收到不受理（規章第二十條）@adminmatch @appeal', async ({ page }) => {
  await stub(page, { m: finishedAgo(10) });
  await go(page);
  await ready(page);
  await fillAppeal(page);
  await page.locator('#ap-file').click();
  await expect(page.locator('.toast').last()).toContainText('保證金');
  expect(await appealOf(page)).toBeUndefined();
});

test('⭐ 逾時的申訴要先講後果、明確確認，文件上記 late @adminmatch @appeal', async ({ page }) => {
  await stub(page, { m: finishedAgo(45) });
  await go(page);
  await ready(page);
  await fillAppeal(page);
  await expect(page.locator('.adm__appeals')).toContainText('已超過 30 分鐘');
  await page.locator('#ap-deposit').check();
  await page.locator('#ap-file').click();
  await expect(page.locator('.modal')).toContainText('賽後三十分鐘內');
  await page.locator('.modal').getByRole('button', { name: /破例受理/ }).click();
  await expect.poll(async () => (await appealOf(page))?.late, { timeout: 15_000 }).toBe(true);
  expect(await appealOf(page)).toMatchObject({ withinWindow: false, minutesAfter: 45 });
});

test('還沒完賽登記不了申訴 @adminmatch @appeal', async ({ page }) => {
  await stub(page, { m: match({ status: 'live', scoreSubmittedAt: null, lock: { locked: false, lockedAt: null, lockedBy: null } }) });
  await go(page);
  await ready(page);
  await expect(page.locator('#ap-new')).toBeDisabled();
  await expect(page.locator('.adm__appeals')).toContainText('還沒送出完賽');
});

test('⭐ 裁決不成立：保證金不予發還、徽章跟著變、留痕 @adminmatch @appeal', async ({ page }) => {
  await stub(page, {
    m: match({ appeal: { status: 'filed', teamId: 't-1' } }),
    extra: { [`events/${EVENT}/appeals/${MATCH}-t-1`]: filedAppeal() }
  });
  await go(page);
  await ready(page);
  await expect(page.locator('.adm__appeal')).toContainText('申訴審理中');
  await page.locator('#ap-note').fill('錄影顯示進球前無越位，維持原判');
  await page.getByRole('button', { name: /申訴不成立/ }).click();
  await expect(page.locator('.modal')).toContainText('不予發還');
  await page.locator('.modal').getByRole('button', { name: /申訴不成立/ }).click();
  await expect.poll(async () => (await appealOf(page))?.status, { timeout: 15_000 }).toBe('dismissed');
  expect((await appealOf(page)).decision).toMatchObject({ upheld: false, depositReturned: false });
  expect((await matchOf(page)).appeal).toEqual({ status: 'dismissed', teamId: 't-1' });
  expect((await auditsOf(page)).some(a => a.action === 'appeal.decided' && a.after?.depositReturned === false)).toBe(true);
});

test('⭐ 裁決成立：退還保證金 @adminmatch @appeal', async ({ page }) => {
  await stub(page, {
    m: match({ appeal: { status: 'filed', teamId: 't-1' } }),
    extra: { [`events/${EVENT}/appeals/${MATCH}-t-1`]: filedAppeal() }
  });
  await go(page);
  await ready(page);
  await page.locator('#ap-note').fill('進球前確有越位');
  await page.getByRole('button', { name: /申訴成立/ }).click();
  await page.locator('.modal').getByRole('button', { name: /申訴成立/ }).click();
  await expect.poll(async () => (await appealOf(page))?.status, { timeout: 15_000 }).toBe('upheld');
  expect((await appealOf(page)).decision.depositReturned).toBe(true);
});

test('裁決意見沒填就不給送 @adminmatch @appeal', async ({ page }) => {
  await stub(page, {
    m: match({ appeal: { status: 'filed', teamId: 't-1' } }),
    extra: { [`events/${EVENT}/appeals/${MATCH}-t-1`]: filedAppeal() }
  });
  await go(page);
  await ready(page);
  await page.getByRole('button', { name: /申訴成立/ }).click();
  await expect(page.locator('.toast').last()).toContainText('裁決意見');
  expect((await appealOf(page)).status).toBe('filed');
});

// ── 單場直播覆蓋（docs/03 §5）──────────────────────────────
test('⭐ 貼網址存成影片 ID；認不出來的不存 @adminmatch @stream', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await page.locator('#st-video').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5s');
  await page.locator('#st-save').click();
  await expect.poll(async () => (await matchOf(page))?.stream?.videoId, { timeout: 15_000 }).toBe('dQw4w9WgXcQ');
  expect((await matchOf(page)).stream.status).toBe('live');

  await page.locator('#st-video').fill('https://vimeo.com/1234');
  await page.locator('#st-save').click();
  await expect(page.locator('.adm__permNote--err')).toContainText('看不出這是 YouTube');
  expect((await matchOf(page)).stream.videoId).toBe('dQw4w9WgXcQ');
});

// ── 驗收整合修正（2026-09-06）────────────────────────────────

const timelineOf = events => Object.fromEntries(events.map((e, i) => [
  `events/${EVENT}/matches/${MATCH}/timeline/ev-${i + 1}`,
  { matchId: MATCH, seq: i + 1, clockSec: 0, voided: false, ...e }
]));

test('⭐ D-06 重開退回最後打過的那一期（timeline 打到下半場 → h2）@adminmatch', async ({ page }) => {
  await stub(page, { extra: timelineOf([
    { type: 'period_start', periodId: 'h1' },
    { type: 'goal', side: 'home', periodId: 'h1', clockSec: 300 },
    { type: 'period_start', periodId: 'h2', clockSec: 900 }
  ]) });
  await go(page);
  await ready(page);
  answerPrompt(page, '賽務按錯');
  await page.getByRole('button', { name: /^重開場次$/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^重開場次$/ }).click();
  await expect.poll(async () => (await matchOf(page))?.status, { timeout: 15_000 }).toBe('live');
  expect((await matchOf(page)).period).toBe('h2');
});

test('⭐ D-06 單節的比賽重開後是第一期，不是「下半場」@adminmatch', async ({ page }) => {
  await stub(page, { extra: timelineOf([
    { type: 'period_start', periodId: 'h1' },
    { type: 'goal', side: 'home', periodId: 'h1', clockSec: 300 }
  ]) });
  await go(page);
  await ready(page);
  answerPrompt(page, '賽務按錯');
  await page.getByRole('button', { name: /^重開場次$/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^重開場次$/ }).click();
  await expect.poll(async () => (await matchOf(page))?.status, { timeout: 15_000 }).toBe('live');
  expect((await matchOf(page)).period).toBe('h1');
});

test('⭐ D-12 棄賽鈕反灰時說得出為什麼（已取消的場次）@adminmatch', async ({ page }) => {
  await stub(page, { m: match({ status: 'cancelled', result: null, lock: { locked: false, lockedAt: null, lockedBy: null } }) });
  await go(page);
  await ready(page);
  await expect(page.locator('#walkover-reason')).toContainText('已取消');
  await expect(page.getByRole('button', { name: /臺中雷霆 棄賽/ })).toBeDisabled();
});

test('D-12 可以判棄賽時不畫原因 @adminmatch', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await expect(page.getByRole('button', { name: /臺中雷霆 棄賽/ })).toBeEnabled();
  await expect(page.locator('#walkover-reason')).toHaveCount(0);
});

test('⭐ D-11 改判之後 walkoverSide 清掉（不再同時說「棄賽」與「平手」）@adminmatch', async ({ page }) => {
  await stub(page, { m: match({ walkoverSide: 'away' }) });
  await go(page);
  await ready(page);
  await page.locator('#sc-home').fill('1');
  await page.locator('#sc-away').fill('1');
  answerPrompt(page, '記錯了');
  await page.getByRole('button', { name: /^改判比分$/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^改判比分$/ }).click();
  await expect.poll(async () => (await matchOf(page))?.score?.away, { timeout: 15_000 }).toBe(1);
  expect((await matchOf(page)).walkoverSide).toBeNull();
});

// ── 2026-09-06 主辦驗收 M-4／M-5／M-6 ──
test('⭐ 頁首印出目前比分，含 PK（正規時間平手時勝負是 PK 決定的）@adminmatch', async ({ page }) => {
  await stub(page, { m: match({
    score: { home: 2, away: 2 }, penaltyScore: { home: 4, away: 3 },
    result: { winner: 'home', method: 'penalty', homePoints: 3, awayPoints: 0 }
  }) });
  await go(page);
  await expect(page.locator('#match-score-now')).toContainText('2:2');
  await expect(page.locator('#match-score-now')).toContainText('PK 4:3');
});

test('沒有 PK 時只印正規比分 @adminmatch', async ({ page }) => {
  await stub(page);
  await go(page);
  await expect(page.locator('#match-score-now')).toHaveText('目前比分 2:1');
});

test('⭐ 返回鍵回到上一頁（從賽程管理點進來就回賽程管理，不是「我的」）@adminmatch', async ({ page }) => {
  await stub(page);
  await page.goto('/#/admin/schedule');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
  await page.goto(`/#/admin/match/${MATCH}`);
  await expect(page.locator('.adm__head')).toBeVisible({ timeout: 15_000 });
  await page.locator('.adm__back').click();
  await expect(page).toHaveURL(/admin\/schedule/);
});

test('申訴成立之後有一條捷徑到「改判比分」（裁決與改判是兩個動作）@adminmatch @appeal', async ({ page }) => {
  await stub(page, {
    m: match({ appeal: { status: 'upheld', teamId: 't-1' } }),
    extra: {
      [`events/${EVENT}/appeals/${MATCH}-t-1`]: {
        appealId: `${MATCH}-t-1`, matchId: MATCH, teamId: 't-1', status: 'upheld',
        filedBy: { role: 'leader', name: '王領隊', phone: '0912-345-678' },
        minutesAfter: 5, late: false, deposit: 2000, depositPaid: true, reason: '越位誤判',
        decision: { upheld: true, note: '錄影顯示無越位', depositReturned: true }
      }
    }
  });
  await go(page);
  await expect(page.locator('[data-act="go-override"]')).toBeVisible();
  await page.locator('[data-act="go-override"]').click();
  await expect(page.locator('#override-section')).toBeInViewport();
});
