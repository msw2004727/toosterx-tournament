/**
 * E2E｜公開端
 * ------------------------------------------------------------------
 * 規格：docs/03-功能規格-公開端.md
 *
 * 每一頁至少要過四關（M5 驗收重點）：
 *   ① 空資料不崩、而且有話說
 *   ② hasUnresolvedTie 顯示「待主辦裁定」，不自己編一個名次
 *   ③ 320px 不出現橫向捲軸
 *   ④ 深淺兩個主題都看得清楚
 *
 * 用 tests/e2e/fake-firebase.js 取代 gstatic 的 SDK。
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const MATCH = 'AO-G-A-01';
// ⚠️ 用活動第一天。今天不在活動期間時，前端會落在 EVENT.dates[0]（賽前預覽的正確行為），
//    種子資料放在別天的話，畫面是對的但測試會以為壞了。
const DATE = '2026-10-09';

const base = () => ({
  [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
  'config/env': { env: 'demo' },
  // ⚠️ 欄位路徑照**真實資料庫**（已對 feda-cup-demo 核對過）：
  //    mercyRule / scorerBoard 都在 display 底下，沒有 youth 也沒有頂層 qualifyCount。
  //    第一版的替身資料自己發明了 division.youth 與 division.mercyRule，
  //    於是「兒童組不列個人射手榜」與「仁慈規則封頂」在測試裡看起來都正常，
  //    上線卻永遠不會生效——替身資料寫錯 schema 比沒有測試更危險。
  [`events/${EVENT}/divisions/adult-open`]: {
    divisionId: 'adult-open', name: '成人公開組', order: 6,
    matchDurationMin: 30, playersOnField: 9,
    display: { mercyRule: { enabled: false, cap: 7 }, scorerBoard: true, qualifyCount: 2 }
  },
  [`events/${EVENT}/divisions/u10`]: {
    divisionId: 'u10', name: 'U10 兒童組', order: 3, matchDurationMin: 20,
    playersOnField: 5,
    display: { mercyRule: { enabled: true, cap: 7 }, scorerBoard: false }
  },
  [`events/${EVENT}/venues/venue-a`]: {
    venueId: 'venue-a', name: 'A場', order: 1,
    stream: { enabled: true, provider: 'youtube', channelId: 'UCdemo', status: 'live' }
  },
  // B 場也要有直播，否則「同時只播一個」根本測不到（第一版就是這樣，
  // 測試以為壞了，其實是沒有第二個播放器可以點）
  [`events/${EVENT}/venues/venue-b`]: {
    venueId: 'venue-b', name: 'B場', order: 2,
    stream: { enabled: true, provider: 'youtube', channelId: 'UCdemo2', status: 'live' }
  }
});

const liveMatch = (over = {}) => ({
  matchId: MATCH, eventId: EVENT, divisionId: 'adult-open', stageId: 'group', groupId: 'A',
  label: '第31場 A組第1輪', venueId: 'venue-a', venueName: 'A場', date: DATE,
  kickoffAt: '2026-10-09T09:30:00+08:00',
  home: { teamId: 't-101', name: '臺中市西屯區野狼' },
  away: { teamId: 't-102', name: '臺中市南屯區猛虎' },
  teamIds: ['t-101', 't-102'],
  score: { home: 2, away: 1 }, status: 'live', period: 'h2',
  clock: { running: false, periodStartedAt: null, elapsedSecAtPause: 600, addedTimeSec: 0 },
  lock: { locked: false }, ...over
});

const full = () => ({
  ...base(),
  [`events/${EVENT}/matches/${MATCH}`]: liveMatch(),
  [`events/${EVENT}/matches/AO-G-A-02`]: {
    matchId: 'AO-G-A-02', divisionId: 'adult-open', label: '第32場', venueId: 'venue-b',
    venueName: 'B場', date: DATE, kickoffAt: '2026-10-09T10:10:00+08:00',
    home: { teamId: 't-103', name: '臺中飛燕' }, away: { teamId: 't-104', name: '臺中銀狐' },
    teamIds: ['t-103', 't-104'], score: { home: 0, away: 0 }, status: 'scheduled',
    clock: {}, lock: { locked: false }
  },
  // 排名階段：隊伍還沒解算出來，要以 placeholder 呈現
  [`events/${EVENT}/matches/AO-K-F-01`]: {
    matchId: 'AO-K-F-01', divisionId: 'adult-open', label: '冠軍賽', venueId: 'venue-a',
    venueName: 'A場', date: DATE, kickoffAt: '2026-10-09T16:00:00+08:00',
    home: { slotLabel: 'A組第1名' }, away: { slotLabel: 'B組第1名' },
    teamIds: [], score: { home: 0, away: 0 }, status: 'scheduled', clock: {}, lock: { locked: false }
  },
  [`events/${EVENT}/standings/adult-open__group__A`]: {
    standingId: 'adult-open__group__A', divisionId: 'adult-open', stageId: 'group', groupId: 'A',
    hasUnresolvedTie: false,
    rows: [
      { rank: 1, teamId: 't-101', name: '臺中市西屯區野狼', played: 3, win: 2, draw: 1, loss: 0, goalsFor: 7, goalsAgainst: 2, goalDiff: 5, points: 7 },
      { rank: 2, teamId: 't-102', name: '臺中市南屯區猛虎', played: 3, win: 2, draw: 0, loss: 1, goalsFor: 5, goalsAgainst: 3, goalDiff: 2, points: 6 },
      { rank: 3, teamId: 't-103', name: '臺中飛燕', played: 3, win: 1, draw: 0, loss: 2, goalsFor: 3, goalsAgainst: 5, goalDiff: -2, points: 3 }
    ]
  },
  [`events/${EVENT}/teams/t-101`]: { teamId: 't-101', name: '臺中市西屯區野狼', divisionId: 'adult-open', groupId: 'A' },
  [`events/${EVENT}/teams/t-101/roster/m-1`]: {
    memberId: 'm-1', teamId: 't-101', displayName: '王小明', jerseyNo: 7, position: 'MF',
    role: 'player', isCaptain: true, stats: { apps: 3, goals: 4, assists: 2, yellow: 1, red: 0 }
  },
  [`events/${EVENT}/teams/t-101/roster/m-2`]: {
    memberId: 'm-2', teamId: 't-101', displayName: '李教練', role: 'coach',
    stats: { apps: 0, goals: 0, assists: 0, yellow: 0, red: 0 }
  },
  [`events/${EVENT}/teams/t-102`]: { teamId: 't-102', name: '臺中市南屯區猛虎', divisionId: 'adult-open', groupId: 'A' },
  [`events/${EVENT}/matches/${MATCH}/timeline/0001-goal`]: {
    timelineId: '0001-goal', matchId: MATCH, type: 'goal', side: 'home', seq: 1,
    clockSec: 320, periodId: 'h1', playerName: '王小明', jerseyNo: 7, voided: false
  },
  [`events/${EVENT}/matches/${MATCH}/timeline/0002-card`]: {
    timelineId: '0002-card', matchId: MATCH, type: 'card', cardType: 'yellow', side: 'away',
    seq: 2, clockSec: 800, periodId: 'h1', playerName: '陳阿虎', jerseyNo: 9, voided: false
  }
});

async function stub(page, seed) {
  await page.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r =>
    r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  // 公開端會嵌 YouTube；測試環境不要真的打出去
  await page.route('https://www.youtube-nocookie.com/**', r =>
    r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>fake player</body></html>' }));
  await page.addInitScript(s => {
    window.__FAKE_SEED = s;
    window.__FAKE_USER = null;          // 公開端完全免登入
    window.__seedData = s;
  }, seed);
}

async function go(page, hash) {
  await page.goto(hash);
  // 測試站是 python -m http.server，單一個行程要餵三個 worker × 兩百多條測試。
  // 10 秒在健康時綽綽有餘，但套件長大之後偶爾會有一次請求排隊排到逾時——
  // 偶發紅燈比慢一點危險得多（久了大家會開始無視 CI），所以給寬一點。
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
  await page.waitForSelector('.pub', { timeout: 10_000 });
}

/** 整頁不得出現橫向捲軸，失敗時要說出是誰溢出 */
async function noHScroll(page) {
  const over = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    who: [...document.querySelectorAll('body *')]
      .filter(el => {
        // 表格刻意允許自己橫向捲（積分榜十欄），只看它有沒有把頁面撐開
        if (el.closest('.ptable-wrap') && el !== document.querySelector('.ptable-wrap')) return false;
        return el.getBoundingClientRect().right > document.documentElement.clientWidth + 1;
      })
      .slice(0, 5).map(el => `${el.tagName.toLowerCase()}.${el.className || '(none)'}`)
  }));
  expect(over.who).toEqual([]);
  expect(over.doc).toBeLessThanOrEqual(0);
}

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

/* ══════════════════════════════════════════════════════════════
   有資料時的正常路徑
   ══════════════════════════════════════════════════════════════ */

test('首頁：進行中、接下來、各組排名都在 @public', async ({ page }) => {
  await stub(page, full());
  await go(page, '/#/');
  await expect(page.getByRole('heading', { name: /現在進行中/ })).toBeVisible();
  await expect(page.getByText('臺中市西屯區野狼').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /接下來/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /各組即時排名/ })).toBeVisible();
  await noHScroll(page);
});

test('⭐ 首頁沒有進行中場次時，整區隱藏 @public', async ({ page }) => {
  const seed = full();
  seed[`events/${EVENT}/matches/${MATCH}`] = liveMatch({ status: 'scheduled' });
  await stub(page, seed);
  await go(page, '/#/');
  await expect(page.getByRole('heading', { name: /現在進行中/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /接下來/ })).toBeVisible();
});

test('賽程頁：時段分群、篩選寫進網址 @public', async ({ page }) => {
  await stub(page, full());
  await go(page, '/#/schedule');
  await expect(page.locator('.pslot').first()).toBeVisible();
  await expect(page.locator('.prow')).toHaveCount(3);

  await page.locator('.pfilter__sel').first().selectOption('adult-open');
  await expect(page).toHaveURL(/division=adult-open/);
  await noHScroll(page);
});

test('⭐ 未定隊伍的場次以 placeholder 呈現，不會假裝已經抽好 @public', async ({ page }) => {
  await stub(page, full());
  await go(page, '/#/schedule');
  const ph = page.locator('.prow.is-placeholder');
  await expect(ph).toHaveCount(1);
  await expect(ph).toContainText('A組第1名');
});

test('LIVE 比賽頁：比分、事件、陣容、統計 @public', async ({ page }) => {
  await stub(page, full());
  await go(page, `/#/match/${MATCH}`);
  await expect(page.locator('#psb-home')).toHaveText('2');
  await expect(page.locator('#psb-away')).toHaveText('1');
  await expect(page.locator('.ptl__item')).toHaveCount(2);

  await page.getByRole('tab', { name: /陣容/ }).click();
  await expect(page.getByText('王小明')).toBeVisible();

  await page.getByRole('tab', { name: /統計/ }).click();
  await expect(page.locator('.pstats')).toBeVisible();
  await noHScroll(page);
});

test('⭐ 比分變動時記分板要更新（onSnapshot 有接上）@public', async ({ page }) => {
  await stub(page, full());
  await go(page, `/#/match/${MATCH}`);
  await expect(page.locator('#psb-home')).toHaveText('2');

  await page.evaluate(({ ev, id }) => {
    const p = `events/${ev}/matches/${id}`;
    const cur = window.__fake.__dump()[p];
    window.__fake.__seed({ [p]: { ...cur, score: { home: 3, away: 1 } } });
  }, { ev: EVENT, id: MATCH });

  await expect(page.locator('#psb-home')).toHaveText('3');
});

test('⭐ 直播是「點了才載入」，不會一進頁就開 iframe @public', async ({ page }) => {
  await stub(page, full());
  await go(page, `/#/match/${MATCH}`);
  await page.getByRole('tab', { name: /直播/ }).click();
  await expect(page.locator('.video__poster')).toBeVisible();
  await expect(page.locator('.video iframe')).toHaveCount(0);
  await page.locator('.video__poster').click();
  await expect(page.locator('.video iframe')).toHaveCount(1);
});

test('組別頁：積分榜直接讀 rows，晉級區標在前兩名 @public', async ({ page }) => {
  await stub(page, full());
  await go(page, '/#/division/adult-open');
  await expect(page.locator('.ptable tbody tr')).toHaveCount(3);
  await expect(page.locator('.ptable tbody tr.is-qualified')).toHaveCount(2);
  await noHScroll(page);
});

test('球隊頁與球員頁 @public', async ({ page }) => {
  await stub(page, full());
  await go(page, '/#/team/t-101');
  await expect(page.getByText('王小明')).toBeVisible();
  await expect(page.getByText('隊長')).toBeVisible();
  await expect(page.getByText('李教練')).toBeVisible();

  await page.getByRole('button', { name: /王小明/ }).click();
  await expect(page).toHaveURL(/#\/player\/t-101\/m-1/);
  await expect(page.locator('.prec__cell').filter({ hasText: '進球' })).toContainText('4');
  await noHScroll(page);
});

test('直播牆：每個場地一格，同時只播一個 @public', async ({ page }) => {
  await stub(page, full());
  await go(page, '/#/live');
  await expect(page.locator('.pwall__cell')).toHaveCount(2);
  const posters = page.locator('.video__poster');
  await posters.first().click();
  await expect(page.locator('.video iframe')).toHaveCount(1);
  // 點第二個，第一個要自己收起來
  await page.locator('.pwall__cell').nth(1).locator('.video__poster').click();
  await expect(page.locator('.video iframe')).toHaveCount(1);
});

/* ══════════════════════════════════════════════════════════════
   空資料與待裁定
   ══════════════════════════════════════════════════════════════ */

test('⭐ 完全沒有資料時每一頁都有話說，不留白畫面 @public @empty', async ({ page }) => {
  await stub(page, base());
  for (const [hash, expected] of [
    ['/#/', /沒有待進行的場次|賽程準備中/],
    ['/#/schedule', /沒有場次/],
    ['/#/division/adult-open', /積分榜整理中/],
    ['/#/stats', /整理中/]
  ]) {
    await go(page, hash);
    await expect(page.locator('.empty__title').first()).toContainText(expected);
    await expect(page.locator('.pub')).toBeVisible();
  }
});

test('⭐ 積分榜 rows 是空陣列時顯示「整理中」，不是壞掉 @public @empty', async ({ page }) => {
  const seed = full();
  seed[`events/${EVENT}/standings/adult-open__group__A`] = {
    standingId: 'adult-open__group__A', divisionId: 'adult-open', stageId: 'group', groupId: 'A',
    rows: [], hasUnresolvedTie: false
  };
  await stub(page, seed);
  await go(page, '/#/division/adult-open');
  await expect(page.getByText('這一組還沒有成績')).toBeVisible();
  await expect(page.locator('.ptable')).toHaveCount(0);
});

test('⭐ hasUnresolvedTie 要顯示「待主辦裁定」@public @tie', async ({ page }) => {
  const seed = full();
  const s = seed[`events/${EVENT}/standings/adult-open__group__A`];
  seed[`events/${EVENT}/standings/adult-open__group__A`] = { ...s, hasUnresolvedTie: true };
  await stub(page, seed);
  await go(page, '/#/division/adult-open');
  await expect(page.getByText(/名次待主辦裁定/)).toBeVisible();
});

test('⭐ 某一列排不出名次時，那一列不可以出現一個數字 @public @tie', async ({ page }) => {
  const seed = full();
  seed[`events/${EVENT}/standings/adult-open__group__A`] = {
    standingId: 'adult-open__group__A', divisionId: 'adult-open', stageId: 'group', groupId: 'A',
    hasUnresolvedTie: true,
    rows: [
      { rank: null, teamId: 't-101', name: '野狼', played: 3, win: 1, draw: 2, loss: 0, goalsFor: 4, goalsAgainst: 4, goalDiff: 0, points: 5 },
      { rank: null, teamId: 't-102', name: '猛虎', played: 3, win: 1, draw: 2, loss: 0, goalsFor: 4, goalsAgainst: 4, goalDiff: 0, points: 5 }
    ]
  };
  await stub(page, seed);
  await go(page, '/#/division/adult-open');
  const first = page.locator('.ptable tbody tr').first();
  await expect(first).toHaveClass(/is-unresolved/);
  await expect(first.locator('td').first()).toHaveText('—');
  // 也不可以有人被標成晉級——名次都還沒定
  await expect(page.locator('.ptable tbody tr.is-qualified')).toHaveCount(0);
});

test('查無此比賽時導引回賽程，不是白畫面 @public @empty', async ({ page }) => {
  await stub(page, full());
  await go(page, '/#/match/NOPE-999');
  await expect(page.getByText('查無此比賽')).toBeVisible();
  await page.getByRole('button', { name: '回賽程' }).click();
  await expect(page).toHaveURL(/#\/schedule/);
});

test('⭐ 沒有任何一頁把物件或 null 印成文字 @public', async ({ page }) => {
  // R-UI-001 那一類的問題：el() 的子節點若不是 Node 就會被 String()。
  // iconText() 回傳陣列，忘記展開就會印出 "[object SVGSVGElement]"；
  // 條件式渲染忘記 filter 就會印出 "null"。兩者都不會報錯，只會很醜。
  // 這一條是看截圖才發現的，補成自動檢查免得下次又靠運氣。
  await stub(page, full());
  for (const hash of ['/#/', '/#/schedule', `/#/match/${MATCH}`,
                      '/#/division/adult-open', '/#/team/t-101', '/#/live', '/#/stats']) {
    await go(page, hash);
    const text = await page.locator('body').innerText();
    expect(text, `${hash} 印出了物件`).not.toContain('[object ');
    expect(text, `${hash} 印出了 null`).not.toMatch(/(^|\s)null(\s|$)/);
    expect(text, `${hash} 印出了 undefined`).not.toContain('undefined');
  }
});

/* ══════════════════════════════════════════════════════════════
   隱私
   ══════════════════════════════════════════════════════════════ */

test('⭐ 名單就算夾帶私密欄位，也不會出現在畫面上 @public @privacy', async ({ page }) => {
  const seed = full();
  seed[`events/${EVENT}/teams/t-101/roster/m-1`] = {
    memberId: 'm-1', teamId: 't-101', displayName: '王○明', jerseyNo: 7, role: 'player',
    stats: { apps: 1, goals: 0 },
    // 投影 Function 壞掉時可能混進來的東西
    name: '王小明真名', birthDate: '2016-03-14', idLast4: '9876', guardianName: '王大明'
  };
  // ⚠️ 這一筆是重點：displayName 缺席、只有未遮蔽的 name。
  //    「沒有 displayName 就退回 name」是很自然會寫出來的一行，
  //    而它正好會把未滿 13 歲球員的真名公開出去。少了這筆種子，
  //    那個變異不會被抓到（第一版就是這樣，E2E 全綠但沒有鑑別力）。
  seed[`events/${EVENT}/teams/t-101/roster/m-3`] = {
    memberId: 'm-3', teamId: 't-101', jerseyNo: 11, role: 'player',
    name: '陳未遮蔽真名', birthDate: '2017-01-01',
    stats: { apps: 1, goals: 0 }
  };
  await stub(page, seed);
  await go(page, '/#/team/t-101');
  await expect(page.getByText('王○明')).toBeVisible();
  const html = await page.content();
  for (const leak of ['王小明真名', '2016-03-14', '9876', '王大明', '陳未遮蔽真名', '2017-01-01']) {
    expect(html).not.toContain(leak);
  }
});

/* ══════════════════════════════════════════════════════════════
   主題
   ══════════════════════════════════════════════════════════════ */

for (const theme of ['light', 'dark']) {
  test(`⭐ ${theme} 主題下文字與背景不同色，且不破版 @public @theme`, async ({ page }) => {
    await stub(page, full());
    await page.addInitScript(t => { try { localStorage.setItem('feda_theme', t); } catch {} }, theme);
    await go(page, `/#/match/${MATCH}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const probe = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.psb'));
      return { bg: s.backgroundColor, fg: s.color, body: getComputedStyle(document.body).backgroundColor };
    });
    expect(probe.bg).not.toBe(probe.fg);
    if (theme === 'dark') expect(probe.body).not.toBe('rgb(255, 255, 255)');
    await noHScroll(page);
  });
}

test('⭐ 深色主題下積分榜的晉級底色不會蓋掉文字 @public @theme', async ({ page }) => {
  await stub(page, full());
  await page.addInitScript(() => { try { localStorage.setItem('feda_theme', 'dark'); } catch {} });
  await go(page, '/#/division/adult-open');
  const probe = await page.evaluate(() => {
    const tr = document.querySelector('.ptable tbody tr.is-qualified');
    const s = getComputedStyle(tr);
    return { bg: s.backgroundColor, fg: getComputedStyle(tr.querySelector('td')).color };
  });
  expect(probe.bg).not.toBe(probe.fg);
});

/* ══════════════════════════════════════════════════════════════
   監聽回收
   ══════════════════════════════════════════════════════════════ */

test('⭐ 監聽有註冊、換頁後有回收 @public', async ({ page }) => {
  // 兩件事都要驗。只驗「離開後是 0」是沒有鑑別力的：
  // 沒有經過 store.hold 的監聽本來就不會被計數，拿掉 hold() 照樣是 0，
  // 但那正是最糟的情況——它永遠不會被回收（第一版就是這樣寫的）。
  await stub(page, full());
  const count = () => page.evaluate(async () => (await import('/js/core/store.js')).count());

  await go(page, `/#/match/${MATCH}`);
  // LIVE 頁監聽 match ＋ timeline，兩個都該登記在案
  await expect.poll(count).toBeGreaterThanOrEqual(2);

  await go(page, '/#/division/adult-open');
  await expect.poll(count).toBeGreaterThanOrEqual(1);   // standings

  await go(page, '/#/team/t-101');
  // 球隊頁完全不用即時監聽；前兩頁的都該被 router 回收掉
  await expect.poll(count).toBe(0);
});

/* ══════════════════════════════════════════════════════════════
   看板與欄位路徑（這一組守的是「讀對欄位」，不是「畫得漂亮」）
   ══════════════════════════════════════════════════════════════ */

const withBoards = () => ({
  ...full(),
  [`events/${EVENT}/boards/scorers`]: {
    boardId: 'scorers',
    rows: [
      { rank: 1, playerId: 'm-90', name: '陳小＊', teamId: 't-901', teamName: 'U10 紅隊',
        jerseyNo: 9, divisionId: 'u10', goals: 8, penalties: 0, openPlay: 8 },
      { rank: 2, playerId: 'm-1', name: '王小明', teamId: 't-101', teamName: '臺中市西屯區野狼',
        jerseyNo: 7, divisionId: 'adult-open', goals: 4, penalties: 1, openPlay: 3 }
    ]
  },
  [`events/${EVENT}/boards/fairplay`]: {
    boardId: 'fairplay',
    rows: [
      { rank: 1, teamId: 't-101', name: '臺中市西屯區野狼', divisionId: 'adult-open',
        fairPlayPoints: -1, yellow: 1, red: 0, played: 3 }
    ]
  },
  'config/featureFlags': { youthScorerBoard: false, scorerBoard: true }
});

test('⭐ 兒童組球員不會出現在公開射手榜（全部組別的檢視也一樣）@public @privacy', async ({ page }) => {
  // docs/03 §9.1：兒童組以參與為主，個人排名不對外顯示。
  // 守衛第一版讀的是 division.youth——真實資料庫沒有這個欄位，等於沒有守。
  await stub(page, withBoards());
  await go(page, '/#/stats');

  await expect(page.locator('.ptop__row')).toHaveCount(1);
  await expect(page.locator('.pub')).toContainText('王小明');
  await expect(page.locator('.pub')).not.toContainText('陳小＊');
});

test('⭐ 首頁的射手榜 TOP 3 也要篩掉兒童組 @public @privacy', async ({ page }) => {
  await stub(page, withBoards());
  await go(page, '/#/');
  await expect(page.locator('.ptop__name').first()).toHaveText('王小明');
  await expect(page.locator('.pub')).not.toContainText('陳小＊');
});

test('⭐ 行為分讀自己那份文件，不會退回射手榜的列 @public', async ({ page }) => {
  // 兩張榜的 rows 形狀不同（球員 vs 球隊）。互相當備援會畫出一張
  // 看起來很正常、但每個人都 0 分的錯表。
  await stub(page, withBoards());
  await go(page, '/#/stats?tab=fairplay');
  await expect(page.locator('.ptop__row')).toHaveCount(1);
  await expect(page.locator('.pub')).toContainText('臺中市西屯區野狼');
  await expect(page.locator('.pub')).toContainText('-1 分');
});

test('⭐ 仁慈規則封頂真的生效（欄位在 display.mercyRule 底下）@public', async ({ page }) => {
  // 寫成 division.mercyRule 不會噴任何錯，只會讓兒童組的 12:0 照實印出來。
  const seed = full();
  seed[`events/${EVENT}/matches/U10-BLOW`] = {
    matchId: 'U10-BLOW', divisionId: 'u10', stageId: 'group', groupId: 'A',
    label: 'U10 第1場', venueId: 'venue-a', venueName: 'A場', date: DATE,
    kickoffAt: '2026-10-09T08:00:00+08:00',
    home: { teamId: 't-901', name: 'U10 紅隊' }, away: { teamId: 't-902', name: 'U10 藍隊' },
    teamIds: ['t-901', 't-902'],
    score: { home: 12, away: 0 }, status: 'finished', period: 'ft',
    clock: {}, lock: { locked: true }
  };
  await stub(page, seed);
  await go(page, '/#/match/U10-BLOW');
  await expect(page.locator('.pub')).toContainText('7+');
  await expect(page.locator('.pub')).not.toContainText('12');
});
