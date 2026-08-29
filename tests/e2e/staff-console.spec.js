/**
 * E2E｜賽務台
 * ------------------------------------------------------------------
 * 對應 docs/04 §10 的驗收清單：
 *   S01 登入後直接看到自己的場地與場次（0 次額外點選）
 *   S02 從賽務首頁到記錄一顆進球 ≤ 4 次點擊
 *   S03 飛航模式下完成操作，恢復連線後 100% 同步
 *
 * 用 tests/e2e/fake-firebase.js 取代 gstatic 的 SDK：
 * 這樣測的是「我們的程式」，不是「Google 的網路」，而且離線行為可以精準控制。
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
    divisionId: 'adult-open', name: '成人公開組', matchDurationMin: 30, playersOnField: 9, drawRule: 'penalty'
  },
  [`events/${EVENT}/matches/${MATCH}`]: {
    matchId: MATCH, eventId: EVENT, divisionId: 'adult-open', stageId: 'group', groupId: 'A',
    label: '第31場 A組第1輪', venueId: 'venue-a', venueName: 'A場', date: '2026-10-11',
    kickoffAt: '2026-10-11T09:30:00+08:00',
    home: { teamId: 't-101', name: '臺中野狼' },
    away: { teamId: 't-102', name: '臺中猛虎' },
    teamIds: ['t-101', 't-102'],
    score: { home: 0, away: 0 }, status: 'scheduled', period: 'pre',
    clock: { running: false, periodStartedAt: null, elapsedSecAtPause: 0, addedTimeSec: 0 },
    lock: { locked: false }
  },
  [`events/${EVENT}/matches/AO-G-A-02`]: {
    matchId: 'AO-G-A-02', divisionId: 'adult-open', label: '第32場', venueId: 'venue-a',
    date: '2026-10-11', kickoffAt: '2026-10-11T10:10:00+08:00',
    home: { teamId: 't-103', name: '臺中飛燕' }, away: { teamId: 't-104', name: '臺中銀狐' },
    score: { home: 0, away: 0 }, status: 'scheduled', clock: {}, lock: { locked: false }
  },
  [`events/${EVENT}/teams/t-101/roster/m-1`]: { memberId: 'm-1', displayName: '王小明', jerseyNo: 7 },
  [`events/${EVENT}/teams/t-101/roster/m-2`]: { memberId: 'm-2', displayName: '林大明', jerseyNo: 4 },
  [`events/${EVENT}/teams/t-102/roster/m-9`]: { memberId: 'm-9', displayName: '陳阿虎', jerseyNo: 9 }
};

/** 把四個 gstatic 模組都換成同一份替身，並在載入前塞好種子資料與身分 */
async function stubFirebase(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));

  // 伺服器校時的探測請求：沙箱連不出去會噴 tunnel 錯誤，直接回一個假的
  await page.route('https://firestore.googleapis.com/**', route =>
    route.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));

  // ⚠️ 必須在模組求值「之前」設好，路由守衛在初始化當下就會讀 user()
  await page.addInitScript(({ seed }) => {
    window.__FAKE_SEED = seed;
    window.__FAKE_USER = { uid: 'u-e2e', displayName: '陳賽務' };
    window.__seedData = seed;
  }, { seed: SEED });
}

/** 開頁並等到替身 SDK 真的載好（動態 import 在 goto 之後才完成） */
async function gotoApp(page, hash) {
  await page.goto(hash);
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 10_000 });
}

/** 點選底部選單的某個選項（避開比分列同名的 aria-label 按鈕） */
const opt = (page, text) => page.locator('.sheet__opt', { hasText: text });
/** 事件列（避開同文字的 toast） */
const tl = (page, text) => page.locator('.tl__text', { hasText: text });

test.beforeEach(async ({ page }) => {
  await stubFirebase(page);
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('S01 進入賽務首頁就看到自己的場地與場次，不需要任何篩選 @staff', async ({ page }) => {
  await gotoApp(page, '/#/staff');

  await expect(page.getByText('陳賽務')).toBeVisible();
  await expect(page.getByText('venue-a')).toBeVisible();
  await expect(page.getByRole('heading', { name: /目前場次/ })).toBeVisible();
  await expect(page.getByText('第31場 A組第1輪').first()).toBeVisible();
  await expect(page.getByText('臺中野狼').first()).toBeVisible();
  // 今日場次清單同時列出兩場
  await expect(page.getByRole('heading', { name: /今日我的場次（2）/ })).toBeVisible();
  // 連線狀態燈常駐
  await expect(page.locator('.sync')).toBeVisible();
});

test('S02 從首頁記錄一顆進球，總共 4 次點擊 @staff', async ({ page }) => {
  await gotoApp(page, '/#/staff');

  await page.getByRole('button', { name: '進入賽務台 →' }).click();          // 1
  await expect(page.locator('.sb__num').first()).toHaveText('0');

  await page.locator('.bigbtn', { hasText: '進球' }).click();                   // 2
  await opt(page, '臺中野狼').click();               // 3
  await opt(page, '王小明').click();                 // 4

  await expect(page.locator('#score-home')).toHaveText('1');
  await expect(tl(page, '進球　#7 王小明')).toBeVisible();
  await expect(page.locator('.toast')).toContainText('已記錄');
});

test('比分直接加減也會寫入 @staff', async ({ page }) => {
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  await page.getByRole('button', { name: '臺中猛虎 加一分' }).click();
  await expect(page.locator('#score-away')).toHaveText('1');
  await page.getByRole('button', { name: '臺中猛虎 減一分' }).click();
  await expect(page.locator('#score-away')).toHaveText('0');
});

test('計時器：開賽後開始跑，暫停後停住 @staff', async ({ page }) => {
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  await expect(page.locator('.clockbox__period')).toHaveText('未開賽');

  await page.getByRole('button', { name: /開賽/ }).click();
  await expect(page.locator('.clockbox__period')).toHaveText('上半場');
  await page.waitForTimeout(2200);
  const t1 = await page.locator('#match-clock').textContent();
  expect(t1).not.toBe('00:00');

  await page.getByRole('button', { name: /暫停/ }).click();
  const t2 = await page.locator('#match-clock').textContent();
  await page.waitForTimeout(1500);
  await expect(page.locator('#match-clock')).toHaveText(t2);
});

test('⭐ 同一球員第二張黃牌會主動提示改記兩黃換紅 @staff', async ({ page }) => {
  await gotoApp(page, `/#/staff/match/${MATCH}`);

  const giveYellow = async () => {
    await page.locator('.bigbtn', { hasText: '出牌' }).click();
    await opt(page, '臺中野狼').click();
    await opt(page, '王小明').click();
    await opt(page, '🟨 黃牌').click();
  };

  await giveYellow();
  await expect(tl(page, '黃牌　#7 王小明').first()).toBeVisible();

  await giveYellow();
  await expect(page.getByRole('dialog', { name: '第二張黃牌' })).toBeVisible();
  await page.getByRole('button', { name: '記為兩黃換紅' }).click();
  await expect(tl(page, '兩黃換紅　#7 王小明')).toBeVisible();
  await expect(page.locator('.toast--warn')).toContainText('已離場');
});

test('⭐ 被罰離場的球員不會再出現在可選名單 @staff', async ({ page }) => {
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  await page.locator('.bigbtn', { hasText: '出牌' }).click();
  await opt(page, '臺中野狼').click();
  await opt(page, '王小明').click();
  await opt(page, '直接紅牌').click();

  await page.locator('.bigbtn', { hasText: '進球' }).click();
  await opt(page, '臺中野狼').click();
  const disabled = opt(page, '王小明');
  await expect(disabled).toBeDisabled();
  await expect(disabled).toContainText('已離場');
});

test('S03 ⭐ 離線時仍可記分，狀態顯示待同步；恢復連線後全部送出 @staff @offline', async ({ page }) => {
  await gotoApp(page, `/#/staff/match/${MATCH}`);

  await page.evaluate(() => window.__fake.__goOffline());

  // 離線狀態下連記三顆球
  for (let i = 0; i < 3; i++) {
    await page.locator('.bigbtn', { hasText: '進球' }).click();
    await opt(page, '臺中野狼').click();
    await opt(page, '不指定球員').click();
  }

  // 畫面上比分立刻生效（本機優先）
  await expect(page.locator('#score-home')).toHaveText('3');

  // ⚠️ 但狀態燈必須是「待同步」，絕不能顯示已儲存
  const sync = page.locator('.sync');
  await expect(sync).toHaveAttribute('data-level', 'queued');
  await expect(sync.locator('.sync__count')).toBeVisible();

  // 展開清單看得到每一筆
  await sync.click();
  await expect(page.locator('.sync-panel')).toContainText('恢復連線會自動送出');
  await expect(page.locator('.sync-panel')).not.toContainText('null');

  // 恢復連線 → 全部送出 → 綠燈
  await page.evaluate(() => window.__fake.__goOnline());
  await expect(sync).toHaveAttribute('data-level', 'saved', { timeout: 5000 });

  // 資料真的進了「資料庫」
  const dump = await page.evaluate(() => window.__fake.__dump());
  expect(dump[`events/${EVENT}/matches/${MATCH}`].score).toEqual({ home: 3, away: 0 });
  expect(Object.keys(dump).filter(k => k.includes('/timeline/')).length).toBe(3);
});

test('⭐ 寫入被拒時顯示紅燈與可讀的原因，不會假成功 @staff', async ({ page }) => {
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  await page.evaluate(() => window.__fake.__failNext('permission-denied'));

  await page.getByRole('button', { name: '臺中野狼 加一分' }).click();

  const sync = page.locator('.sync');
  await expect(sync).toHaveAttribute('data-level', 'failed');
  await sync.click();
  await expect(page.locator('.sync-panel')).toContainText('權限不足');
  await expect(page.getByRole('button', { name: '重試', exact: true })).toBeVisible();
});

test('完賽送出：事件加總與比分不符時警示，但允許送出 @staff', async ({ page }) => {
  await gotoApp(page, `/#/staff/match/${MATCH}`);

  // 只用「加一分」不記事件 → 必然不一致
  await page.getByRole('button', { name: '臺中野狼 加一分' }).click();
  await page.getByRole('button', { name: /完賽送出/ }).click();

  const dlg = page.getByRole('dialog', { name: '確認完賽' });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('事件加總為 0:0，與比分 1:0 不同');
  await dlg.getByRole('button', { name: '確認完賽' }).click();

  const dump = await page.evaluate(() => window.__fake.__dump());
  const m = dump[`events/${EVENT}/matches/${MATCH}`];
  expect(m.status).toBe('finished');
  expect(m.scoreMismatch).toBe(true);
  expect(m.lock.locked).toBe(true);
});

test('完賽並鎖定後進入唯讀模式 @staff', async ({ page }) => {
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  await page.evaluate(({ ev, match }) => {
    window.__fake.__seed({
      [`events/${ev}/matches/${match}`]: {
        ...window.__seedData[`events/${ev}/matches/${match}`],
        status: 'finished', period: 'ft', lock: { locked: true }
      }
    });
  }, { ev: EVENT, match: MATCH });

  await expect(page.getByText('唯讀模式')).toBeVisible();
  await expect(page.getByText('需要管理員解鎖')).toBeVisible();
  await expect(page.getByRole('button', { name: /進球/ })).toHaveCount(0);
});

test('出場名單：勾選先發、人數不符時警示但可確認 @staff', async ({ page }) => {
  await gotoApp(page, `/#/staff/sheet/${MATCH}`);

  await expect(page.getByText('王小明')).toBeVisible();
  await page.locator('.roster__row', { hasText: '王小明' }).getByRole('button', { name: '先發' }).click();
  await expect(page.getByText('先發 1 / 9')).toBeVisible();

  await page.getByRole('button', { name: '確認出場名單' }).click();
  const dlg = page.getByRole('dialog', { name: '先發人數不符' });
  await expect(dlg).toContainText('目前先發 1 人，這個組別是 9 人制');
  await dlg.getByRole('button', { name: '仍要確認' }).click();

  const dump = await page.evaluate(() => window.__fake.__dump());
  expect(dump[`events/${EVENT}/matchSheets/${MATCH}__t-101`].players).toHaveLength(1);
  expect(dump[`events/${EVENT}/matches/${MATCH}`].status).toBe('checkin');
});

test('沒有未清除的即時監聽：離開賽務台後監聽數歸零 @staff', async ({ page }) => {
  await gotoApp(page, `/#/staff/match/${MATCH}`);
  await expect(page.locator('.sb')).toBeVisible();

  await gotoApp(page, '/#/staff');
  await expect(page.getByRole('heading', { name: /今日我的場次/ })).toBeVisible();

  // store 只保留目前頁面的監聽（首頁 1 個 + firebase 的連線偵測不歸 store 管）
  const n = await page.evaluate(async () => (await import('/js/core/store.js')).count());
  expect(n).toBeLessThanOrEqual(2);
});

test('隊名含 HTML 時不會被當成標記執行（R-CODE-002）@staff', async ({ page }) => {
  await gotoApp(page, '/#/staff');
  await page.evaluate(({ ev, match }) => {
    window.__fake.__seed({
      [`events/${ev}/matches/${match}`]: {
        ...window.__seedData[`events/${ev}/matches/${match}`],
        home: { teamId: 't-101', name: '<img src=x onerror="window.__pwned=1">野狼' }
      }
    });
  }, { ev: EVENT, match: MATCH });

  await expect(page.getByText('<img src=x onerror="window.__pwned=1">野狼').first()).toBeVisible();
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

// ── 上線後實地發現的問題（回歸測試）──────────────────────────

test('⭐ 部署當下模組載入失敗要能自動重試，不可停在「載入失敗」@staff', async ({ page }) => {
  // 實際發生過：推版當下點進賽務台，看到一片紅的「Failed to fetch dynamically imported module」。
  // 瀏覽器會記住失敗的模組網址，所以重試一定要換 query 才有用。
  let firstTry = true;
  await page.route('**/js/modules/staff/live.js', route => {
    const isRetry = route.request().url().includes('retry=');
    if (firstTry && !isRetry) { firstTry = false; return route.abort('failed'); }
    return route.continue();
  });

  await gotoApp(page, '/#/staff');
  await page.getByRole('button', { name: '進入賽務台 →' }).click();

  // 重試成功 → 看得到賽務台，而不是錯誤頁
  await expect(page.locator('.sb')).toBeVisible();
  await expect(page.getByText('載入失敗')).toHaveCount(0);
});

test('⭐ 連線正常時不可顯示「資料來自手機快取」的假警告 @staff', async ({ page }) => {
  // Firestore 第一筆快照來自本機快取；若監聽沒開 includeMetadataChanges，
  // 伺服器確認後不會再觸發，提示就永遠掛在畫面上——賽務會誤以為自己離線。
  await gotoApp(page, '/#/staff');
  await expect(page.getByRole('heading', { name: /今日我的場次/ })).toBeVisible();

  await expect(page.locator('.sync')).toHaveAttribute('data-level', 'saved');
  await expect(page.locator('.notice--info')).toHaveCount(0);
});

test('⭐ 開頁時只有快取 → 顯示提示；連上線之後提示必須自己消失 @staff @offline', async ({ page }) => {
  // ① 第一筆快照來自本機快取 → sync 判定離線 → 顯示「資料來自手機」
  // ② 伺服器確認 → sync 轉回線上 → 提示要自己消失
  //
  // 註：實機上看到的「提示不消失」根因其實是 CDN 快取（見 _headers），
  //     不是這段邏輯。這個案例守的是「兩個狀態要一致」，不是那個根因。
  await page.addInitScript(() => { window.__FAKE_OFFLINE = true; });
  await gotoApp(page, '/#/staff');

  await expect(page.locator('.notice--info')).toBeVisible();
  await expect(page.locator('.sync')).toHaveAttribute('data-level', 'queued');

  await page.evaluate(() => window.__fake.__goOnline());

  await expect(page.locator('.sync')).toHaveAttribute('data-level', 'saved');
  await expect(page.locator('.notice--info')).toHaveCount(0);
});
