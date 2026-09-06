/**
 * E2E｜賽程管理 `#/admin/schedule`
 * ------------------------------------------------------------------
 * 規格：docs/05 §6；競賽規章第十四條（賽程統一由大會抽籤排定）
 *
 * 守五件事：
 *   ・**抽籤會留下種子**（規章要的是抽籤，而抽籤的價值在於事後查得到）
 *   ・**手動調整是兩隊對調**，不是把一隊搬走（搬走會讓兩組隊數不等）
 *   ・**已經開打就不能重新產生**
 *   ・**有衝突就發布不出去**，但只有 error 擋得住，warn 不擋
 *   ・**發布之前公開端看不到**
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'U7774e1410479bafff4997f51b2c47b95';

/** 4 隊的成人公開組——最小但完整（單循環＋冠亞軍賽＝8 場） */
// 預設只用前 4 隊（F4 單組）；要測兩組的分組互動時給 teamCount: 6（沒有 6 隊的範本 → 通用兩組範本）
const TEAMS = ['野狼', '猛虎', '獵鷹', '晨星', '雷鳥', '飛馬'];

const seed = ({ roles = ['admin'], teamCount = 4, matches = {}, division = {} } = {}) => {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo' },
    'config/schedule': {
      startTime: '08:30', endTime: '18:00', bufferMin: 10, minRestMin: 20, maxGapMin: 240,
      venuesByDate: { '2026-10-11': ['venue-a', 'venue-b'] }
    },
    'config/formats': {
      formats: {
        F4_RR_FINAL: {
          formatId: 'F4_RR_FINAL', name: '4隊單循環＋冠軍季軍賽', teamCount: 4,
          description: '每隊 4 場，單組別共 8 場',
          stages: [
            { stageId: 'group', name: '單循環', type: 'roundRobin', order: 1, groupCount: 1, groupSize: 4, legs: 1 },
            {
              stageId: 'final', name: '名次決賽', type: 'knockout', order: 2, drawRule: 'penalty',
              slots: [
                { matchKey: 'F1', label: '冠軍賽',
                  home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 1 },
                  away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 2 } },
                { matchKey: 'F3', label: '季軍賽',
                  home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 3 },
                  away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 4 } }
              ]
            }
          ],
          finalRankingMap: []
        }
      }
    },
    [`users/${UID}`]: { uid: UID, displayName: '金小麥' },
    [`staff/${UID}`]: {
      uid: UID, name: '金小麥', roles, active: true,
      assignment: { eventId: EVENT, venueIds: [], divisionIds: [], challengeIds: [] }
    },
    [`events/${EVENT}/divisions/adult-open`]: {
      divisionId: 'adult-open', name: '成人公開組', shortName: '公開', code: 'AO',
      order: 6, date: '2026-10-11', matchDurationMin: 30, playersOnField: 9,
      formatId: 'F4_RR_FINAL', rankingRuleId: 'RR_FEDA_2026', ...division
    },
    [`events/${EVENT}/venues/venue-a`]: { venueId: 'venue-a', name: 'A場', fieldType: '9v9', order: 1 },
    [`events/${EVENT}/venues/venue-b`]: { venueId: 'venue-b', name: 'B場', fieldType: '9v9', order: 2 }
  };
  TEAMS.slice(0, teamCount).forEach((name, i) => {
    s[`events/${EVENT}/teams/t-${i + 1}`] = {
      teamId: `t-${i + 1}`, name: `${name}足球隊`, shortName: name,
      divisionId: 'adult-open', status: 'approved', withdrawn: false, groupId: null, seed: null
    };
  });
  for (const [id, doc] of Object.entries(matches)) s[`events/${EVENT}/matches/${id}`] = doc;
  return s;
};

const match = (over = {}) => ({
  matchId: 'AO-G-A-01', eventId: EVENT, divisionId: 'adult-open', stageId: 'group', groupId: 'A',
  round: 1, matchNo: 1, label: 'A組 第1輪', matchKey: null, date: '2026-10-11',
  kickoffAt: { seconds: Math.floor(Date.parse('2026-10-11T09:00:00+08:00') / 1000), nanoseconds: 0 },
  venueId: 'venue-a', venueName: 'A場',
  home: { teamId: 't-1', name: '野狼', displayName: '野狼', placeholder: null },
  away: { teamId: 't-2', name: '猛虎', displayName: '猛虎', placeholder: null },
  teamIds: ['t-1', 't-2'],
  score: { home: 0, away: 0 }, status: 'scheduled', period: 'pre',
  lock: { locked: false, lockedAt: null, lockedBy: null },
  ...over
});

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
  await page.goto('/#/admin/schedule');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

const dump = page => page.evaluate(() => window.__fake.__dump());
const matchesOf = async page => Object.entries(await dump(page))
  .filter(([k]) => k.includes('/matches/'))
  .map(([, v]) => v);

/** ⭐ 斷言「不存在」之前一定要先等頁面真的畫出來（變異 #E7 就是這樣逃掉的） */
const ready = page => expect(page.locator('.adm__head')).toBeVisible({ timeout: 15_000 });

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('⭐ 記錄員進不來，而且看得到原因 @admin', async ({ page }) => {
  await stub(page, { roles: ['scorer'] });
  await go(page);
  await expect(page.locator('.adm__box--warn')).toContainText('賽程管理');
  await expect(page.locator('.adm__box--warn')).toContainText('管理員');
  await expect(page.getByRole('button', { name: /產生/ })).toHaveCount(0);
});

test('⭐ 沒有核准的球隊就說清楚，並指出要先去哪裡 @admin', async ({ page }) => {
  await stub(page, { teamCount: 0 });
  await go(page);
  await ready(page);
  await expect(page.locator('.adm__box--warn')).toContainText('還沒有核准的球隊');
  await expect(page.getByRole('button', { name: /去報名審核/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^產生/ })).toHaveCount(0);
});

test('⭐ 抽籤會留下種子（規章第十四條要的是抽籤，證據在種子）@admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await expect(page.locator('.adm')).toContainText('統一由大會代為抽籤排定');

  await page.getByRole('button', { name: /^抽籤$/ }).click();
  await expect(page.locator('.adm')).toContainText('抽籤種子');
  await expect(page.getByRole('button', { name: /重新抽籤/ })).toBeVisible();
});

test('⭐ 產生賽程：場次、積分榜、球隊分組一次到齊，而且預設不發布 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await page.getByRole('button', { name: /^產生 8 場$/ }).click();

  await expect.poll(async () => (await matchesOf(page)).length, { timeout: 15_000 }).toBe(8);

  const d = await dump(page);
  // 積分榜要一起建立：resolveAdvancement 找不到積分榜是 fail-closed，
  // 晉級會永遠解不開
  expect(Object.keys(d).filter(k => k.includes('/standings/'))).toHaveLength(1);
  // 球隊的小組與種子序回填
  expect(d[`events/${EVENT}/teams/t-1`].groupId).toBe('A');
  expect(Number.isInteger(d[`events/${EVENT}/teams/t-1`].seed)).toBe(true);
  // ⭐ 產生之後預設**不發布**——主辦還沒排時間，家長不該看到
  expect(d[`events/${EVENT}/divisions/adult-open`].schedulePublished).toBe(false);
  // 階段文件
  expect(Object.keys(d).some(k => k.includes('/divisions/adult-open/stages/group'))).toBe(true);
});

test('⭐ 產生賽程會留痕，而且記下抽籤種子 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await page.getByRole('button', { name: /^抽籤$/ }).click();
  await page.getByRole('button', { name: /^產生 8 場$/ }).click();

  await expect.poll(async () => {
    const d = await dump(page);
    return Object.keys(d).filter(k => k.includes('/audits/')).length;
  }, { timeout: 15_000 }).toBeGreaterThan(0);

  const d = await dump(page);
  const a = Object.entries(d).find(([k]) => k.includes('/audits/'))[1];
  expect(a.action).toBe('schedule.generate');
  expect(a.entityId).toBe('adult-open');
  expect(Number.isInteger(a.after.drawSeed)).toBe(true);
  expect(a.reason).toContain('抽籤');
});

test('⭐ 自動排定會填上時間與場地，而且不撞場 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await page.getByRole('button', { name: /^產生 8 場$/ }).click();
  await expect.poll(async () => (await matchesOf(page)).length, { timeout: 15_000 }).toBe(8);

  await page.getByRole('button', { name: /自動排定/ }).click();
  await expect.poll(async () => {
    const ms = await matchesOf(page);
    return ms.filter(m => m.kickoffAt && m.venueId).length;
  }, { timeout: 15_000 }).toBe(8);

  const ms = await matchesOf(page);
  const slots = ms.map(m => `${m.venueId}|${m.kickoffAt}`);
  expect(new Set(slots).size).toBe(slots.length);        // 沒有兩場同時同地
  expect(ms.every(m => Number.isInteger(m.matchNo))).toBe(true);
});

test('⭐ 有衝突就發布不出去 @admin', async ({ page }) => {
  // 兩場排在同一片場地的同一個時間——error，發布鈕要按不下去
  await stub(page, {
    matches: {
      'AO-G-A-01': match(),
      'AO-G-A-02': match({ matchId: 'AO-G-A-02', teamIds: ['t-3', 't-4'] })
    },
    division: { schedulePublished: false }
  });
  await go(page);
  await ready(page);
  await expect(page.locator('.adm__check--error')).toContainText('同時排了兩場');
  await expect(page.getByRole('button', { name: /發布賽程/ })).toBeDisabled();
});

test('休息不足只是提醒，照樣發布得出去 @admin', async ({ page }) => {
  // 規章沒有休息時間這一條——把它升成錯誤等於系統替主辦訂了一條規章沒有的規則
  await stub(page, {
    matches: {
      'AO-G-A-01': match(),
      'AO-G-A-02': match({
        matchId: 'AO-G-A-02', venueId: 'venue-b', venueName: 'B場',
        kickoffAt: { seconds: Math.floor(Date.parse('2026-10-11T09:40:00+08:00') / 1000), nanoseconds: 0 }
      })
    },
    division: { schedulePublished: false }
  });
  await go(page);
  await ready(page);
  await expect(page.locator('.adm__check--warn')).toContainText('休息');
  await expect(page.locator('.adm__check--error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /發布賽程/ })).toBeEnabled();
});

test('⭐ 發布之後公開端才看得到 @admin', async ({ page }) => {
  await stub(page, { matches: { 'AO-G-A-01': match() }, division: { schedulePublished: false } });
  await go(page);
  await ready(page);
  await expect(page.locator('.adm__box').first()).toContainText('未發布，只有管理員看得到');

  await page.getByRole('button', { name: /發布賽程/ }).click();
  await expect.poll(async () => {
    const d = await dump(page);
    return d[`events/${EVENT}/divisions/adult-open`].schedulePublished;
  }, { timeout: 15_000 }).toBe(true);

  // 公開端的賽程頁看得到了
  await page.goto('/#/schedule?date=2026-10-11');
  await expect(page.locator('.plist')).toContainText('野狼', { timeout: 15_000 });
});

test('⭐ 未發布的組別不出現在公開端的賽程 @admin', async ({ page }) => {
  await stub(page, { matches: { 'AO-G-A-01': match() }, division: { schedulePublished: false } });
  await page.goto('/#/schedule?date=2026-10-11');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
  // 先等頁面真的畫出來再斷言「不存在」
  await expect(page.locator('.pub')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.plist')).toHaveCount(0);
});

test('⭐ 已經開打就不能重新產生 @admin', async ({ page }) => {
  await stub(page, {
    matches: { 'AO-G-A-01': match({ status: 'live' }) },
    division: { schedulePublished: true }
  });
  await go(page);
  await ready(page);
  await expect(page.locator('.adm__box--warn')).toContainText('不能重新產生');
  await expect(page.locator('.adm__box--warn')).toContainText('積分榜會算出一份沒有人看得懂的結果');
  await expect(page.getByRole('button', { name: /重新產生/ })).toHaveCount(0);
});

test('⭐ 已經開打的場次不給改時間 @admin', async ({ page }) => {
  await stub(page, {
    matches: { 'AO-G-A-01': match({ status: 'finished' }) },
    division: { schedulePublished: true }
  });
  await go(page);
  await ready(page);
  await expect(page.locator('.adm__item')).toContainText('已經開打，時間與場地不能在這裡改');
  await expect(page.locator('input[type=time]')).toHaveCount(0);
});

test('改一場的時間會寫進去並留痕 @admin', async ({ page }) => {
  await stub(page, { matches: { 'AO-G-A-01': match() }, division: { schedulePublished: false } });
  await go(page);
  await ready(page);
  // 開賽時間是文字格（24 小時制），不再是 type=time（2026-09-06 驗收 M-3）
  await page.locator('.adm__time').first().fill('10:15');
  await page.locator('.adm__time').first().blur();

  await expect.poll(async () => {
    const d = await dump(page);
    return Object.values(d).some(v => v?.action === 'schedule.move');
  }, { timeout: 15_000 }).toBe(true);
});

test('⭐ 320px 不出現橫向捲軸 @admin @narrow', async ({ page }) => {
  await stub(page, { matches: { 'AO-G-A-01': match() } });
  await go(page);
  await ready(page);
  const over = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth <= d.clientWidth ? null : { scroll: d.scrollWidth, client: d.clientWidth };
  });
  expect(over).toBeNull();
});

// ── 驗收整合修正（2026-09-06）────────────────────────────────

test('⭐ D-09 已經開打就不給重新抽籤（抽籤會覆蓋已打完的分組）@admin', async ({ page }) => {
  await stub(page, {
    matches: { 'AO-G-A-01': match({ status: 'finished', score: { home: 2, away: 1 }, result: { winner: 'home', method: 'regulation', homePoints: 3, awayPoints: 0 } }) },
    division: { schedulePublished: true }
  });
  await go(page);
  await ready(page);
  await expect(page.locator('#draw-locked')).toContainText('不能重新產生');
  await expect(page.getByRole('button', { name: /抽籤/ })).toBeDisabled();
});

test('⭐ D-10 取消但已經有結果的場次也擋重產（延期／取消不清比分，重產會把 result 一起刪掉）@admin', async ({ page }) => {
  await stub(page, {
    matches: { 'AO-G-A-01': match({ status: 'cancelled', score: { home: 2, away: 1 }, result: { winner: 'home', method: 'regulation', homePoints: 3, awayPoints: 0 } }) },
    division: { schedulePublished: true }
  });
  await go(page);
  await ready(page);
  await expect(page.locator('.adm__box--warn')).toContainText('不能重新產生');
  await expect(page.getByRole('button', { name: /重新產生/ })).toHaveCount(0);
  await expect(page.locator('#draw-locked')).toBeVisible();
});

test('真的沒打過的取消場次不擋重產 @admin', async ({ page }) => {
  await stub(page, {
    matches: { 'AO-G-A-01': match({ status: 'cancelled' }) },
    division: { schedulePublished: false }
  });
  await go(page);
  await ready(page);
  await expect(page.locator('#draw-locked')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /抽籤/ })).toBeEnabled();
});

// ── 2026-09-06 主辦驗收 M-3：「好像不能手動對調隊伍」——有場次開打之後本來就不能，但按鈕沒有關、也沒有說 ──
test('⭐ 有場次開打之後，分組的按鈕關掉並說明原因 @admin', async ({ page }) => {
  // ⚠️ 要用兩組的賽制（6 隊 → 通用範本兩組）：單一組別的按鈕本來就是灰的，
  //    拿掉守衛也照樣灰，測不出來（變異 #E44 第一次就是這樣逃掉的）
  await stub(page, {
    teamCount: 6,
    matches: { 'AO-G-A-01': match({ status: 'finished', score: { home: 1, away: 0 }, lock: { locked: true, lockedAt: null, lockedBy: 'u' } }) }
  });
  await go(page);
  await ready(page);
  await expect(page.locator('#draw-swap-note')).toContainText('分組已經定案');
  const chips = page.locator('.adm__chip');
  await expect(chips).toHaveCount(6);
  for (let i = 0; i < 6; i++) await expect(chips.nth(i)).toBeDisabled();
  await expect(page.getByRole('button', { name: /抽籤/ })).toBeDisabled();
});

test('單一組別寫明「沒有分組可以調整」，不是一排灰按鈕不說話 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await expect(page.locator('#draw-swap-note')).toContainText('只有一個小組');
});

test('⭐ 開賽時間是文字格、24 小時制：打 930 存成 09:30 @admin', async ({ page }) => {
  await stub(page, { matches: { 'AO-G-A-01': match() } });
  await go(page);
  await ready(page);
  const input = page.locator('input[aria-label="AO-G-A-01 開賽時間（24 小時制）"]');
  await expect(input).toHaveAttribute('type', 'text');
  await expect(input).toHaveValue('09:00');
  await input.fill('930');
  await input.press('Tab');
  await expect.poll(async () => {
    const m = (await matchesOf(page)).find(x => x.matchId === 'AO-G-A-01');
    const k = m?.kickoffAt;
    const ms = typeof k === 'number' ? k : (k?.seconds != null ? k.seconds * 1000 : (k instanceof Date ? k.getTime() : Date.parse(k)));
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }, { timeout: 10_000 }).toBe('2026-10-11T01:30:00.000Z');
});
