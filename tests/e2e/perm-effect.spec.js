/**
 * E2E｜權限開關要真的改變現場看到的東西
 * ------------------------------------------------------------------
 * 規格：R-PERM-001、docs/05
 *
 * 2026-09-04 在真站上實測抓到：總管把「送出完賽」關掉之後，賽務台的
 * 「完賽送出」按鈕**照樣在**——那一頁從來沒有問過 `can()`。
 * 同一次也發現裁判編不了出場名單（`sheet.js` 擋在 `match.score.write`，
 * 但那條權限的代碼是 `matchsheet.write`，minRole 是裁判）。
 *
 * 兩個缺陷都通過了當時全部 561 條測試——因為沒有任何一條問過
 * 「關掉之後那顆按鈕真的不見了嗎」。這一份就是在補那件事。
 *
 * `tests/unit/perms.test.js` 的 T42-8 從靜態面守（每條權限碼都要有人讀），
 * 這裡從行為面守（讀了之後畫面真的會變）。兩層缺一不可：
 * 只有靜態的話，`can()` 呼叫在那裡但結果被忽略也會過。
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const MATCH = 'AO-G-A-01';

/** 種子的形狀：每個角色列出自己預設拿得到的全部權限，全部 true */
const MATRIX = {
  booth: { role: 'booth', perms: { 'challenge.attempt.write': true } },
  checkin: { role: 'checkin', perms: { 'challenge.attempt.write': true, 'checkin.write': true, 'member.read': true } },
  referee: {
    role: 'referee',
    perms: { 'challenge.attempt.write': true, 'checkin.write': true, 'member.read': true, 'matchsheet.write': true }
  },
  scorer: {
    role: 'scorer',
    perms: {
      'challenge.attempt.write': true, 'checkin.write': true, 'member.read': true, 'matchsheet.write': true,
      'match.period': true, 'match.score.write': true, 'match.finish': true, 'match.undo': true
    }
  }
};

const base = ({ role = 'scorer', matrix = MATRIX } = {}) => {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo', allowSelfServeStaff: true },
    'staff/u-e2e': {
      uid: 'u-e2e', name: '陳賽務', roles: [role], active: true,
      assignment: { eventId: EVENT, date: null, venueIds: ['venue-a'], divisionIds: [], challengeIds: [] }
    },
    [`events/${EVENT}/divisions/u10`]: {
      divisionId: 'u10', name: 'U10兒童組', matchDurationMin: 25, periods: 1, playersOnField: 5,
      eligibility: { bornOnOrAfter: '2016-09-01', note: '' }
    },
    [`events/${EVENT}/matches/${MATCH}`]: {
      matchId: MATCH, eventId: EVENT, divisionId: 'u10', stageId: 'group', groupId: 'A',
      label: 'A組第1輪', venueId: 'venue-a', venueName: 'A場', date: '2026-10-09',
      kickoffAt: '2026-10-09T09:30:00+08:00',
      home: { teamId: 't-101', name: '臺中野狼' }, away: { teamId: 't-102', name: '臺中猛虎' },
      teamIds: ['t-101', 't-102'],
      checkin: { requiredMin: 5 },
      score: { home: 0, away: 0 }, status: 'scheduled', period: 'pre',
      clock: { running: false, periodStartedAt: null, elapsedSecAtPause: 0, addedTimeSec: 0 },
      lock: { locked: false }
    },
    [`events/${EVENT}/teams/t-101/roster/m-1`]: { memberId: 'm-1', displayName: '王小明', jerseyNo: 7 },
    [`events/${EVENT}/teams/t-102/roster/m-9`]: { memberId: 'm-9', displayName: '陳阿虎', jerseyNo: 9 },
    [`events/${EVENT}/teams/t-101/members/m-1`]: {
      memberId: 'm-1', name: '王小明', nameKind: 'nickname', kind: 'player', status: 'approved',
      jerseyNo: 7, birthDate: '2017-03-05', idLast4: '1234', source: 'coach'
    },
    [`events/${EVENT}/teams/t-102/members/m-9`]: {
      memberId: 'm-9', name: '陳阿虎', nameKind: 'nickname', kind: 'player', status: 'approved',
      jerseyNo: 9, birthDate: '2017-05-05', idLast4: '9999', source: 'coach'
    }
  };
  for (const [r, doc] of Object.entries(matrix ?? {})) s[`rolePermissions/${r}`] = doc;
  return s;
};

async function stub(page, opts = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r =>
    r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.addInitScript(({ seed }) => {
    window.__FAKE_SEED = seed;
    window.__FAKE_USER = { uid: 'u-e2e', displayName: '陳賽務' };
    window.__seedData = seed;
  }, { seed: base(opts) });
}

async function go(page, hash) {
  await page.goto(hash);
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

/**
 * ⚠️ 斷言「某個東西不存在」之前，一定要先等到頁面**真的畫出來**。
 *
 * `toHaveCount(0)` 在一張還沒渲染的空白頁上會**立刻成立**——
 * 測試是綠的，但它證明不了任何事。2026-09-04 就是這樣：
 * 把 `matchsheet.write` 的判斷改成永遠放行，11 條全綠（變異 #E7 逃掉）。
 */
async function ready(page, anchor) {
  await expect(page.locator(anchor).first()).toBeVisible({ timeout: 15_000 });
}

/** 把某個角色的某一條權限關掉（總管在 #/admin/perms 做的就是這件事） */
const off = (role, code) => ({
  ...MATRIX,
  [role]: { ...MATRIX[role], perms: { ...MATRIX[role].perms, [code]: false } }
});

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

// ── 完賽送出 ────────────────────────────────────────────────

test('⭐ 預設看得到「完賽送出」 @staff @perm', async ({ page }) => {
  await stub(page);
  await go(page, `/#/staff/match/${MATCH}`);
  await expect(page.getByRole('button', { name: /完賽送出/ })).toBeVisible();
});

test('⭐ 主辦關掉「送出完賽」之後，那顆按鈕要消失 @staff @perm', async ({ page }) => {
  await stub(page, { matrix: off('scorer', 'match.finish') });
  await go(page, `/#/staff/match/${MATCH}`);
  await ready(page, '.actions');                       // 賽務台真的畫出來了
  await expect(page.getByRole('button', { name: /完賽送出/ })).toHaveCount(0);
});

test('⭐ 而且要說出來並給下一步（不能只是消失）@staff @perm', async ({ page }) => {
  // 功能默默不見的話，賽務會一直找那顆按鈕，然後在最忙的時候打電話
  await stub(page, { matrix: off('scorer', 'match.finish') });
  await go(page, `/#/staff/match/${MATCH}`);
  await expect(page.locator('.finishbar')).toContainText('主辦已關閉');
  await expect(page.locator('.finishbar')).toContainText('找管理員');
});

test('比分照樣記得了（關掉的只有完賽）@staff @perm', async ({ page }) => {
  await stub(page, { matrix: off('scorer', 'match.finish') });
  await go(page, `/#/staff/match/${MATCH}`);
  await expect(page.getByRole('button', { name: /進球/ })).toBeVisible();
});

// ── 比賽時鐘 ────────────────────────────────────────────────

test('⭐ 關掉「控制比賽時鐘」之後開賽鈕消失，並說明原因 @staff @perm', async ({ page }) => {
  await stub(page, { matrix: off('scorer', 'match.period') });
  await go(page, `/#/staff/match/${MATCH}`);
  await ready(page, '.clockbox');
  await expect(page.locator('.clockbox')).toContainText('主辦已關閉');
  await expect(page.getByRole('button', { name: /開賽/ })).toHaveCount(0);
});

test('沒關的時候開賽鈕在 @staff @perm', async ({ page }) => {
  await stub(page);
  await go(page, `/#/staff/match/${MATCH}`);
  await expect(page.getByRole('button', { name: /開賽/ })).toBeVisible();
});

// ── 出場名單（這一條原本用錯權限碼）────────────────────────

test('⭐ 裁判編得了出場名單（這是裁判在系統裡唯一的職能）@staff @perm', async ({ page }) => {
  // 原本擋在 canScore()（match.score.write，記錄員），裁判只看得到名單、
  // 一個人都勾不了。真站實測：裁判 4 顆按鈕、記錄員 25 顆。
  await stub(page, { role: 'referee' });
  await go(page, `/#/staff/sheet/${MATCH}`);
  await expect(page.getByRole('button', { name: /先發/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /確認出場名單/ })).toBeVisible();
});

test('⭐ 關掉「編輯出場名單」之後裁判就編不了 @staff @perm', async ({ page }) => {
  await stub(page, { role: 'referee', matrix: off('referee', 'matchsheet.write') });
  await go(page, `/#/staff/sheet/${MATCH}`);
  await expect(page.getByRole('button', { name: /確認出場名單/ })).toHaveCount(0);
});

test('檢錄員沒有出場名單的權限 @staff @perm', async ({ page }) => {
  await stub(page, { role: 'checkin' });
  await go(page, `/#/staff/sheet/${MATCH}`);
  await ready(page, '.tabs__btn');
  await expect(page.getByRole('button', { name: /確認出場名單/ })).toHaveCount(0);
});

// ── 看球員個資 ──────────────────────────────────────────────

test('⭐ 檢錄台預設看得到生日與後四碼（拿證件對的就是這兩格）@staff @perm', async ({ page }) => {
  await stub(page, { role: 'checkin' });
  await go(page, `/#/staff/checkin/${MATCH}`);
  await expect(page.locator('.chk__verify').first()).toContainText('末四碼');
  await expect(page.locator('.chk__verify').first()).toContainText('1234');
});

test('⭐ 關掉「看球員個資」之後那兩格收起來，但頁面仍然可用 @staff @perm', async ({ page }) => {
  // 直接顯示空白會被當成資料沒填；整頁擋掉又讓檢錄做不了事
  await stub(page, { role: 'checkin', matrix: off('checkin', 'member.read') });
  await go(page, `/#/staff/checkin/${MATCH}`);
  await expect(page.locator('.chk__verify').first()).toContainText('主辦已關閉個資顯示');
  await expect(page.locator('body')).not.toContainText('1234');
  await expect(page.locator('.chk__row').first()).toBeVisible();     // 名單還在，勾得了
});
