/**
 * E2E｜檢錄台
 * ------------------------------------------------------------------
 * 規格：競賽規章第十八條第 3 款、docs/04 §4
 *
 * 學童組的檢錄不掃碼：球隊負責人帶證件來，檢錄員逐筆核對
 * 「出生年月日」與「身分證後四碼」再勾選。所以這一組守的是：
 *   ・那兩格真的印在畫面上（沒有它們，檢錄員手上沒有可核對的東西）
 *   ・只有檢錄員以上進得來
 *   ・勾選不 await 網路（離線也要能一路勾完）
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const MATCH = 'U10-G-A-01';

const staffDoc = (roles) => ({
  uid: 'u-e2e', name: '志工', roles, active: true, selfServe: true,
  assignment: { eventId: EVENT, date: '2026-10-09', venueIds: ['venue-a'], divisionIds: [], challengeIds: [] }
});

/**
 * 替身種子。
 *
 * ⚠️ 場次的 `checkin` 要照**真實文件**的形狀寫（seed 只有 homeConfirmed／awayConfirmed／confirmedAt）。
 *    第一版塞了一個真實資料庫沒有的 `requiredMin: 5`，於是「人數不足說清楚」在測試裡一直是綠的、
 *    在 demo 上一個人也能完成檢錄（第三輪驗收 C-5）——替身資料寫錯 schema 比沒有測試更危險，第六次。
 *    門檻現在從組別的 playersOnField 來。
 *
 * @param {number} [extraPlayers]  兩隊各多加幾位球員（要湊到 5 人門檻用）
 * @param {object} [divisionOver]  覆蓋組別設定；值給 undefined 就是把那個欄位拿掉
 */
const seed = ({ roles = ['checkin'], memberOver = {}, extraPlayers = 0, divisionOver = {} } = {}) => {
  const division = {
    divisionId: 'u10', name: '學童中年級', matchDurationMin: 25, periods: 1, playersOnField: 5,
    eligibility: { bornOnOrAfter: '2016-09-01' }, ...divisionOver
  };
  for (const k of Object.keys(division)) if (division[k] === undefined) delete division[k];
  const extra = {};
  for (let i = 0; i < extraPlayers; i++) {
    for (const [team, tag] of [['t-101', 'x'], ['t-102', 'y']]) {
      const id = `m-${tag}${i + 1}`;
      extra[`events/${EVENT}/teams/${team}/members/${id}`] = {
        memberId: id, name: `補位${tag}${i + 1}`, nameKind: 'nickname', jerseyNo: 20 + i,
        kind: 'player', status: 'approved', birthDate: '2017-02-02', idLast4: String(4000 + i), source: 'coach'
      };
    }
  }
  return {
  [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
  'config/env': { env: 'demo', allowSelfServeStaff: true },
  'staff/u-e2e': staffDoc(roles),
  [`events/${EVENT}/divisions/u10`]: division,
  [`events/${EVENT}/matches/${MATCH}`]: {
    matchId: MATCH, eventId: EVENT, divisionId: 'u10', stageId: 'group', groupId: 'A',
    label: '第1場 A組第1輪', venueId: 'venue-a', venueName: 'A場', date: '2026-10-09',
    kickoffAt: '2026-10-09T08:30:00+08:00',
    home: { teamId: 't-101', name: '大甲金剛' }, away: { teamId: 't-102', name: '沙鹿飛龍' },
    teamIds: ['t-101', 't-102'],
    score: { home: 0, away: 0 }, status: 'scheduled', period: 'pre',
    clock: { running: false }, lock: { locked: false },
    checkin: { homeConfirmed: false, awayConfirmed: false, confirmedAt: null }
  },
  // ⚠️ 檢錄讀的是 members（私密），不是公開的 roster——
  //    生日與身分證後四碼只存在這一份文件上。
  [`events/${EVENT}/teams/t-101/members/m-1`]: {
    memberId: 'm-1', name: '小豆子', nameKind: 'nickname', jerseyNo: 7,
    kind: 'player', status: 'approved', birthDate: '2017-03-05', idLast4: '1234', source: 'coach', ...memberOver
  },
  [`events/${EVENT}/teams/t-101/members/m-2`]: {
    memberId: 'm-2', name: '阿光', nameKind: 'nickname', jerseyNo: 9,
    kind: 'player', status: 'approved', birthDate: '2016-11-20', idLast4: '5678', source: 'coach'
  },
  [`events/${EVENT}/teams/t-101/members/s-1`]: {
    memberId: 's-1', name: '林教練', jerseyNo: null,
    kind: 'coach', status: 'approved', birthDate: null, idLast4: null, source: 'coach'
  },
  [`events/${EVENT}/teams/t-101/members/m-x`]: {
    memberId: 'm-x', name: '已移除', jerseyNo: 3,
    kind: 'player', status: 'removed', birthDate: '2017-01-01', idLast4: '9999', source: 'coach'
  },
  [`events/${EVENT}/teams/t-102/members/m-9`]: {
    memberId: 'm-9', name: '小龍', nameKind: 'nickname', jerseyNo: 11,
    kind: 'player', status: 'approved', birthDate: '2017-06-01', idLast4: '2468', source: 'coach'
  },
  ...extra
  };
};

async function stub(page, opts = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r =>
    r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());

  await page.addInitScript(({ s }) => {
    window.__FAKE_SEED = s;
    window.__seedData = s;
    window.__FAKE_USER = { uid: 'u-e2e', displayName: '志工' };
  }, { s: seed(opts) });
}

async function go(page) {
  await page.goto(`/#/staff/checkin/${MATCH}`);
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

const dump = page => page.evaluate(() => window.__fake.__dump());

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('⭐ 名單上印得出核對用的生日與後四碼 @staff @checkin', async ({ page }) => {
  // 學童組不掃碼，檢錄員手上唯一能跟證件對起來的就是這兩格。
  // 少了它們，這一頁等於只是一張點名表。
  await stub(page);
  await go(page);

  const row = page.locator('.chk__row').first();
  await expect(row).toContainText('小豆子');
  await expect(row).toContainText('106/03/05');   // 民國年，證件上就是這樣印
  await expect(row).toContainText('1234');
});

test('⭐ 進度分母只算球員，不算隊職員 @staff @checkin', async ({ page }) => {
  // 把領隊教練算進去，「2 / 3」會讓檢錄員一直找那個不存在的第三個小孩
  await stub(page);
  await go(page);
  await expect(page.locator('.chk__footer')).toContainText('/ 2 人已確認出賽');
});

test('已移除的成員不出現在檢錄名單上 @staff @checkin', async ({ page }) => {
  await stub(page);
  await go(page);
  await expect(page.locator('.chk__list')).not.toContainText('已移除');
});

test('⭐ 勾選會寫出一筆檢錄，id 是 matchId__memberId @staff @checkin', async ({ page }) => {
  await stub(page);
  await go(page);

  await page.locator('.chk__box').first().check();

  await expect.poll(async () => {
    const d = await dump(page);
    return d[`events/${EVENT}/checkins/${MATCH}__m-1`]?.result ?? null;
  }, { timeout: 10_000 }).toBe('pass');

  const rec = (await dump(page))[`events/${EVENT}/checkins/${MATCH}__m-1`];
  expect(rec.scannedBy).toBe('u-e2e');
  expect(rec.method).toBe('manual');       // 用眼睛核對證件，不是掃碼
  expect(rec.memberName).toBe('小豆子');
});

test('⭐ 取消勾選是把 result 設成 null，不是刪掉紀錄 @staff @checkin', async ({ page }) => {
  // 「誰在幾點確認了誰出賽，後來又取消」整段都要留痕（rules 也不放行 delete）
  await stub(page);
  await go(page);

  const box = page.locator('.chk__box').first();
  await box.check();
  await expect.poll(async () => (await dump(page))[`events/${EVENT}/checkins/${MATCH}__m-1`]?.result ?? null,
    { timeout: 10_000 }).toBe('pass');

  await box.uncheck();
  await expect.poll(async () => {
    const rec = (await dump(page))[`events/${EVENT}/checkins/${MATCH}__m-1`];
    return rec ? rec.result : 'DELETED';
  }, { timeout: 10_000 }).toBeNull();
});

test('可以標記「有問題」，而且看得出來 @staff @checkin', async ({ page }) => {
  await stub(page);
  await go(page);

  await page.getByRole('button', { name: /^有問題$/ }).first().click();
  await expect.poll(async () => (await dump(page))[`events/${EVENT}/checkins/${MATCH}__m-1`]?.result ?? null,
    { timeout: 10_000 }).toBe('fail');
  await expect(page.locator('.chk__row.is-failed')).toHaveCount(1);
});

test('兩隊分頁切得過去，各自算各自的進度 @staff @checkin', async ({ page }) => {
  await stub(page);
  await go(page);

  await expect(page.locator('.chk__tab')).toHaveCount(2);
  await page.getByRole('tab', { name: /沙鹿飛龍/ }).click();
  await expect(page.locator('.chk__list')).toContainText('小龍');
  await expect(page.locator('.chk__list')).not.toContainText('小豆子');
});

test('⭐ 人數不足開賽時說清楚，而且不叫人自己放行 @staff @checkin', async ({ page }) => {
  // 規章第十八條第 6 款：不出場以棄權論 0:2。人數不足是主辦要裁定的事。
  await stub(page);
  await go(page);
  await expect(page.locator('.chk__footer')).toContainText('不足開賽人數');
  await expect(page.locator('.chk__footer')).toContainText('請找主辦');
});

test('⭐ 沒有檢錄權限的人看得到原因，不是一片空白 @staff @checkin', async ({ page }) => {
  await stub(page, { roles: ['booth'] });
  await go(page);
  await expect(page.locator('.chk__deny')).toContainText('沒有檢錄權限');
  await expect(page.locator('.chk__list')).toHaveCount(0);
});

test('賽務與裁判本來就做得了檢錄 @staff @checkin', async ({ page }) => {
  await stub(page, { roles: ['scorer'] });
  await go(page);
  await expect(page.locator('.chk__deny')).toHaveCount(0);
  await expect(page.locator('.chk__list')).toBeVisible();
});

test('⭐ 離線也能一路勾完（不 await Firestore 的 Promise）@staff @checkin @offline', async ({ page }) => {
  // R-UI-002：離線時 setDoc() 回傳的 Promise 永遠 pending。
  // await 它再更新畫面的話，檢錄員勾第一個人就會卡住。
  await stub(page);
  await go(page);

  await page.evaluate(() => window.__fake.__goOffline());

  const boxes = page.locator('.chk__box');
  await boxes.nth(0).check();
  await boxes.nth(1).check();

  // 畫面必須立刻反應，不能等網路
  await expect(page.locator('.chk__row.is-present')).toHaveCount(2);
  await expect(page.locator('.chk__footer')).toContainText('2 / 2');
});

// ── 配戴眼鏡上場（規章附件二）────────────────────────────
test('⭐ 配戴眼鏡的球員標出切結書收了沒，檢錄員好提醒裁判檢查裝備 @staff @checkin @glasses', async ({ page }) => {
  await stub(page, { memberOver: { glasses: true, glassesWaiver: null } });
  await go(page);
  await expect(page.locator('.chk__tag').first()).toContainText('切結書未收');
});

test('切結書收到了就標已收 @staff @checkin @glasses', async ({ page }) => {
  await stub(page, { memberOver: { glasses: true, glassesWaiver: { signed: true, byUid: 'u-cap', by: 'teamLead' } } });
  await go(page);
  await expect(page.locator('.chk__tag--ok').first()).toContainText('切結書已收');
});

// ── 驗收整合修正（2026-09-06）────────────────────────────────

test('⭐ D-01b 名單讀不到（缺索引）時說「讀不到」，不說「還沒有名單」 @staff @checkin', async ({ page }) => {
  await stub(page);
  // 真的 SDK 缺複合索引會 reject；模擬器與替身都不查索引，所以要主動模擬
  await page.addInitScript(() => { window.__FAKE_SNAPSHOT_FAIL = { path: 'members', code: 'failed-precondition' }; });
  await go(page);
  await expect(page.locator('#chk-roster-error')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#chk-roster-error')).toContainText('索引');
  await expect(page.locator('.chk__empty', { hasText: '還沒有名單' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /完成這一隊的檢錄/ })).toBeVisible();
});

// ── 第三輪驗收（2026-09-07，檢錄員）────────────────────────────────
// C-3：標了「有問題」的人不能直接勾出賽。C-5：一個人也能「完成檢錄」，而且什麼都沒寫。

const matchDoc = async page => (await dump(page))[`events/${EVENT}/matches/${MATCH}`];
const tickAll = async (page, n) => { for (let i = 0; i < n; i++) await page.locator('.chk__box').nth(i).check(); };

test('⭐ C-3 標了「有問題」的球員不能直接勾出賽，要先取消註記 @staff @checkin', async ({ page }) => {
  // 出賽與有問題是同一個欄位（result），直接勾等於悄悄把註記洗掉——而註記正是要擋住這個勾的東西
  await stub(page);
  await go(page);
  const row = page.locator('.chk__row').first();
  await row.getByRole('button', { name: /^有問題$/ }).click();
  await expect(row).toHaveClass(/is-failed/);
  await expect(row.locator('.chk__box')).toBeDisabled();
  await expect(row).toContainText('先取消註記');
  await row.getByRole('button', { name: /取消註記/ }).click();
  await expect(row.locator('.chk__box')).toBeEnabled();
  await expect(row).not.toContainText('先取消註記');
});

test('⭐ C-5 只勾 1 人：完成檢錄按不下去，說清楚差幾人，而且不叫檢錄員自己放行 @staff @checkin', async ({ page }) => {
  await stub(page, { extraPlayers: 3 });
  await go(page);
  await expect(page.locator('.chk__box')).toHaveCount(6);   // 5 位球員 ＋ 教練那一列（球員排前面）
  await page.locator('.chk__box').first().check();
  await expect(page.locator('.chk__footer')).toContainText('1 / 5');
  await expect(page.locator('#chk-finish')).toBeDisabled();
  await expect(page.locator('#chk-gate')).toContainText('至少 5 人');
  await expect(page.locator('#chk-gate')).toContainText('還差 4 人');
  await expect(page.locator('#chk-gate')).toContainText('不能自行放行');
});

test('⭐ C-5 人數夠了才按得下去；完成之後旗標寫回場次、狀態進入檢錄中 @staff @checkin', async ({ page }) => {
  await stub(page, { extraPlayers: 3 });
  await go(page);
  await expect(page.locator('.chk__box')).toHaveCount(6);   // 5 位球員 ＋ 教練那一列
  await expect(page.locator('#chk-finish')).toBeDisabled();
  await tickAll(page, 5);
  await expect(page.locator('.chk__footer')).toContainText('5 / 5');
  await expect(page.locator('#chk-gate')).toHaveCount(0);
  await expect(page.locator('#chk-finish')).toBeEnabled();
  await page.locator('#chk-finish').click();
  await page.locator('.modal').getByRole('button', { name: '完成檢錄' }).click();

  await expect.poll(async () => (await matchDoc(page))?.checkin?.homeConfirmed ?? null, { timeout: 10_000 }).toBe(true);
  const m = await matchDoc(page);
  expect(m.status).toBe('checkin');
  expect(m.checkin.awayConfirmed).toBe(false);        // 另一隊的旗標原封不動（updateDoc 對巢狀 map 是整包取代）
  expect(m.checkin.confirmedAt).toBeNull();
  expect(m.checkin.homeConfirmedBy).toBe('u-e2e');
  expect(m.checkin.homePresent).toBe(5);
  expect(m.updatedBy).toBe('u-e2e');

  // 主隊檢完、客隊還沒：畫面切到客隊。客隊 4 人（小龍 ＋ 補位 3 人）全勾仍差 1 人 → 按不下去
  await expect(page.getByRole('tab', { name: /沙鹿飛龍/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.chk__box')).toHaveCount(4);
  await tickAll(page, 4);
  await expect(page.locator('#chk-finish')).toBeDisabled();
  await expect(page.locator('#chk-gate')).toContainText('還差 1 人');

  // 回主隊分頁要看得到「已完成檢錄」
  await page.getByRole('tab', { name: /大甲金剛/ }).click();
  await expect(page.locator('#chk-done')).toBeVisible();
});

test('⭐ C-5 兩隊都完成 → 場次進入待開賽（ready），confirmedAt 這時才填 @staff @checkin', async ({ page }) => {
  await stub(page, { extraPlayers: 4 });
  await go(page);
  await expect(page.locator('.chk__box')).toHaveCount(7);   // 6 位球員 ＋ 教練那一列
  await tickAll(page, 5);
  await page.locator('#chk-finish').click();
  await page.locator('.modal').getByRole('button', { name: '完成檢錄' }).click();
  await expect.poll(async () => (await matchDoc(page))?.status ?? null, { timeout: 10_000 }).toBe('checkin');

  await expect(page.getByRole('tab', { name: /沙鹿飛龍/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.chk__box')).toHaveCount(5);
  await tickAll(page, 5);
  await expect(page.locator('#chk-finish')).toBeEnabled();
  await page.locator('#chk-finish').click();
  await page.locator('.modal').getByRole('button', { name: '完成檢錄' }).click();
  await expect.poll(async () => (await matchDoc(page))?.status ?? null, { timeout: 10_000 }).toBe('ready');
  const m = await matchDoc(page);
  expect(m.checkin.homeConfirmed).toBe(true);
  expect(m.checkin.awayConfirmed).toBe(true);
  expect(m.checkin.confirmedAt).not.toBeNull();
});

test('⭐ C-5 管理員可以在人數不足時放行，但一定要填原因，而且留稽核 @staff @checkin', async ({ page }) => {
  await stub(page, { roles: ['admin'], extraPlayers: 3 });
  await go(page);
  await expect(page.locator('.chk__box')).toHaveCount(6);   // 5 位球員 ＋ 教練那一列
  await page.locator('.chk__box').first().check();
  await expect(page.locator('#chk-gate')).toContainText('管理員');
  const btn = page.locator('#chk-finish');
  await expect(btn).toBeEnabled();
  await expect(btn).toContainText('人數不足仍完成檢錄');

  // 沒填原因就不放行：連確認框都不出現，什麼都不寫
  page.once('dialog', d => d.dismiss());
  await btn.click();
  await expect(page.locator('.modal')).toHaveCount(0);
  expect((await matchDoc(page)).checkin.homeConfirmed).toBe(false);

  page.once('dialog', d => d.accept('對手同意以 4 人開賽'));
  await btn.click();
  await expect(page.locator('.modal')).toContainText('對手同意以 4 人開賽');
  await page.locator('.modal').getByRole('button', { name: '完成檢錄' }).click();
  await expect.poll(async () => (await matchDoc(page))?.checkin?.homeConfirmed ?? null, { timeout: 10_000 }).toBe(true);
  const d = await dump(page);
  expect(d[`events/${EVENT}/matches/${MATCH}`].checkin.homeForcedReason).toBe('對手同意以 4 人開賽');
  const audits = Object.entries(d).filter(([k]) => k.startsWith(`events/${EVENT}/audits/`)).map(([, v]) => v);
  expect(audits.some(a => a.action === 'checkin.forceComplete' && a.reason === '對手同意以 4 人開賽')).toBe(true);
});

test('⭐ C-5 組別讀不到上場人數：門檻不明就不放行（fail-closed），連管理員都不行 @staff @checkin', async ({ page }) => {
  // 「沒設定就當作通過」會在人數不足時默默放行；設定壞了要先修設定，不是硬按過去
  await stub(page, { roles: ['admin'], extraPlayers: 3, divisionOver: { playersOnField: undefined } });
  await go(page);
  await expect(page.locator('.chk__box')).toHaveCount(6);   // 5 位球員 ＋ 教練那一列
  await tickAll(page, 5);
  await expect(page.locator('.chk__footer')).toContainText('5 / 5');
  await expect(page.locator('#chk-finish')).toBeDisabled();
  await expect(page.locator('#chk-gate')).toContainText('門檻');
});
