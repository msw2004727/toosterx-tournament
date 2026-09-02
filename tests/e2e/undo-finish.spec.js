/**
 * E2E｜完賽後三分鐘自撤回
 * ------------------------------------------------------------------
 * 對應 docs/10 §5.3、firestore.rules 分支 (D)
 *
 * 單元測試已經把 undoState() 的邊界測透了，這裡要證明的是**畫面上真的接得起來**：
 *   ・完賽送出之後，整頁會變成唯讀（lock.locked = true），
 *     撤回列必須仍然看得到、按得到——第一版就是漏在這裡
 *   ・離線送出時**不可以**出現倒數與撤回按鈕（假成功是不可協商的紅線）
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
    label: '第31場 A組第1輪', venueId: 'venue-a', venueName: 'A場', date: '2026-10-11',
    kickoffAt: '2026-10-11T09:30:00+08:00',
    home: { teamId: 't-101', name: '臺中野狼' },
    away: { teamId: 't-102', name: '臺中猛虎' },
    teamIds: ['t-101', 't-102'],
    score: { home: 0, away: 0 }, status: 'live', period: 'h2',
    clock: { running: false, periodStartedAt: null, elapsedSecAtPause: 1500, addedTimeSec: 0 },
    lock: { locked: false }
  },
  [`events/${EVENT}/teams/t-101/roster/m-1`]: { memberId: 'm-1', displayName: '王小明', jerseyNo: 7 },
  [`events/${EVENT}/teams/t-102/roster/m-9`]: { memberId: 'm-9', displayName: '陳阿虎', jerseyNo: 9 }
};

async function stubFirebase(page, { offline = false } = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', route =>
    route.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.addInitScript(({ seed, offline }) => {
    window.__FAKE_SEED = seed;
    window.__FAKE_USER = { uid: 'u-e2e', displayName: '陳賽務' };
    window.__FAKE_OFFLINE = offline;
    window.__seedData = seed;
  }, { seed: SEED, offline });
}

async function gotoApp(page, hash) {
  await page.goto(hash);
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 10_000 });
}

/** 加一分 → 完賽送出 → 確認 */
async function finish(page) {
  await page.getByRole('button', { name: '臺中野狼 加一分' }).click();
  await page.getByRole('button', { name: /完賽送出/ }).click();
  const dlg = page.getByRole('dialog', { name: '確認完賽' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: '確認完賽' }).click();
}

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('⭐ 完賽送出後撤回列仍然看得到（整頁已經是唯讀）@staff @undo', async ({ page }) => {
  await stubFirebase(page);
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  await finish(page);

  // 唯讀：三顆記錄按鈕消失
  await expect(page.locator('.bigbtn')).toHaveCount(0);
  // 但撤回列還在，而且有倒數
  await expect(page.locator('.undobar')).toBeVisible();
  await expect(page.locator('#undo-left')).toHaveText(/^[0-2]:\d\d$/);
  await expect(page.getByRole('button', { name: /撤回完賽/ })).toBeVisible();
  // 唯讀提示要跟撤回按鈕講同一件事，不能叫人去找管理員
  await expect(page.getByText('要修改請先用下方的「撤回完賽」')).toBeVisible();
});

test('⭐ 撤回之後場次退回進行中，比分與事件都留著 @staff @undo', async ({ page }) => {
  await stubFirebase(page);
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  await finish(page);

  await page.getByRole('button', { name: /撤回完賽/ }).click();
  const dlg = page.getByRole('dialog', { name: '撤回完賽' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: '撤回' }).click();

  // 回到可記錄的狀態
  await expect(page.locator('.bigbtn')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /完賽送出/ })).toBeVisible();
  await expect(page.locator('#score-home')).toHaveText('1');

  const m = await page.evaluate(({ ev, match }) =>
    window.__fake.__dump()[`events/${ev}/matches/${match}`], { ev: EVENT, match: MATCH });
  expect(m.status).toBe('live');
  expect(m.lock.locked).toBe(false);
  expect(m.score).toEqual({ home: 1, away: 0 });
  expect(m.scoreSubmittedAt).toBeNull();
  expect(m.result).toBeNull();
});

test('⭐ 離線送出完賽時，不可以出現倒數或撤回按鈕 @staff @undo @offline', async ({ page }) => {
  await stubFirebase(page, { offline: true });
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  await finish(page);

  // 送出本身要成功（離線可用），但撤回不行
  await expect(page.locator('.undobar')).toBeVisible();
  await expect(page.locator('#undo-left')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /撤回完賽/ })).toHaveCount(0);
  await expect(page.locator('.undobar__msg')).toContainText('待同步');

  // 三態燈要停在「待同步」，不可以假裝已儲存
  await expect(page.locator('.sync')).toHaveAttribute('data-level', 'queued');
});

test('⭐ 恢復連線之後倒數才開始，撤回按鈕才出現 @staff @undo @offline', async ({ page }) => {
  await stubFirebase(page, { offline: true });
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  await finish(page);
  await expect(page.getByRole('button', { name: /撤回完賽/ })).toHaveCount(0);

  await page.evaluate(() => window.__fake.__goOnline());

  await expect(page.locator('#undo-left')).toBeVisible();
  await expect(page.getByRole('button', { name: /撤回完賽/ })).toBeVisible();
  await expect(page.locator('.sync')).toHaveAttribute('data-level', 'saved');
});

test('⭐ 線上送出之後才斷線：倒數與撤回按鈕必須立刻收起來 @staff @undo @offline', async ({ page }) => {
  // 這一條是變異測試逼出來的。
  // 原本只測「離線送出」，但那個情境下 scoreSubmittedAt 本來就是 null，
  // 所以就算把 online 檢查整條拿掉，測試照樣全綠——沒有鑑別力（R-TEST-001）。
  //
  // 真正只有 online 檢查擋得住的是這個：完賽是在線上送出的，時間戳是真的，
  // 三分鐘也還沒到，然後手機走進場館的死角。這時若還畫著倒數，
  // 賽務會按下去，寫入排隊，等到有訊號時視窗早就過了 → rules 擋掉 → 假成功。
  await stubFirebase(page);
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  await finish(page);
  await expect(page.getByRole('button', { name: /撤回完賽/ })).toBeVisible();

  await page.evaluate(() => window.__fake.__goOffline());

  await expect(page.getByRole('button', { name: /撤回完賽/ })).toHaveCount(0);
  await expect(page.locator('#undo-left')).toHaveCount(0);
  await expect(page.locator('.undobar__msg')).toContainText('待同步');

  // 回到有訊號，而且還在三分鐘內 → 撤回權要自己回來
  await page.evaluate(() => window.__fake.__goOnline());
  await expect(page.getByRole('button', { name: /撤回完賽/ })).toBeVisible();
});

test('⭐ 超過三分鐘之後撤回按鈕自己消失，換成「找管理員」@staff @undo', async ({ page }) => {
  await stubFirebase(page);
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  await finish(page);
  await expect(page.getByRole('button', { name: /撤回完賽/ })).toBeVisible();

  // 把送出時間往前推四分鐘（等同時間過去了）
  await page.evaluate(({ ev, match }) => {
    const path = `events/${ev}/matches/${match}`;
    const cur = window.__fake.__dump()[path];
    window.__fake.__seed({
      [path]: { ...cur, scoreSubmittedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString() }
    });
  }, { ev: EVENT, match: MATCH });

  await expect(page.getByRole('button', { name: /撤回完賽/ })).toHaveCount(0);
  await expect(page.locator('.undobar__msg')).toContainText('管理員');
});

test('別人送出的完賽，我看不到撤回按鈕 @staff @undo', async ({ page }) => {
  await stubFirebase(page);
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  await page.evaluate(({ ev, match }) => {
    window.__fake.__seed({
      [`events/${ev}/matches/${match}`]: {
        ...window.__seedData[`events/${ev}/matches/${match}`],
        status: 'finished', period: 'ft', lock: { locked: true, lockedBy: 'u-other' },
        scoreSubmittedBy: 'u-other', scoreSubmittedAt: new Date().toISOString()
      }
    });
  }, { ev: EVENT, match: MATCH });

  await expect(page.locator('.undobar')).toBeVisible();
  await expect(page.getByRole('button', { name: /撤回完賽/ })).toHaveCount(0);
  await expect(page.locator('.undobar__msg')).toContainText('送出完賽');
});
