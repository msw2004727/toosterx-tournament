/**
 * E2E｜專屬首頁 `#/my`
 * ------------------------------------------------------------------
 * 主辦 2026-09-03 指定的資訊架構：
 *   登入後落在 `#/my`，內容依身分展開（層級越高功能越多），
 *   底下一定有登出，球隊區叫「我的球隊」。
 *
 * 這一組守的是「看得到什麼」——多一格或少一格都不會報錯，
 * 只會在現場變成「我怎麼沒有這個功能」或「我怎麼點得到這個」。
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'U7774e1410479bafff4997f51b2c47b95';

const seed = ({ roles = null, perms = null, members = [], teams = {} } = {}) => {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo' },
    [`users/${UID}`]: { uid: UID, displayName: '金小麥', pictureUrl: null },
    [`events/${EVENT}/teams/t-1`]: {
      teamId: 't-1', name: '大甲金剛足球隊', divisionId: 'u10',
      captainUid: UID, status: 'draft', memberCount: 3
    }
  };
  for (const [id, t] of Object.entries(teams)) s[`events/${EVENT}/teams/${id}`] = t;
  // 我報名的球員：members 在各自的球隊底下（collectionGroup 查）
  for (const m of members) s[`events/${EVENT}/teams/${m.team}/members/${m.memberId}`] = { ...m, team: undefined };
  if (roles) {
    s[`staff/${UID}`] = {
      uid: UID, name: '金小麥', roles, active: true,
      assignment: { eventId: EVENT, venueIds: ['venue-a'], divisionIds: [], challengeIds: [] }
    };
  }
  if (perms) for (const [role, p] of Object.entries(perms)) s[`rolePermissions/${role}`] = { role, perms: p };
  return s;
};

async function stub(page, opts = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r =>
    r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());

  await page.addInitScript(({ s, signedIn }) => {
    window.__FAKE_SEED = s;
    window.__seedData = s;
    window.__FAKE_USER = signedIn ? { uid: 'U7774e1410479bafff4997f51b2c47b95', displayName: '金小麥' } : null;
  }, { s: seed(opts), signedIn: opts.signedIn !== false });
}

async function go(page) {
  await page.goto('/#/my');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

const tiles = page => page.locator('.acct__tile');
const soon = page => page.locator('.acct__soonList li');

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('⭐ 一般使用者只看到球隊與登出，沒有功能區 @my', async ({ page }) => {
  // 「層級越高功能越多」的另一端：沒有身分的人不該看到任何賽務入口。
  await stub(page);
  await go(page);

  await expect(page.locator('.acct')).toContainText('我的球隊');
  await expect(page.locator('.acct')).toContainText('大甲金剛足球隊');
  await expect(page.getByRole('button', { name: '登出' })).toBeVisible();
  await expect(page.locator('.acct__card', { hasText: '我的功能' })).toHaveCount(0);
});

test('⭐ 「我報名的球員」跨球隊列出自己報的，別人報的不列 @my', async ({ page }) => {
  // docs/10 §1.3：一個 LINE 帳號對應多個球員，分在不同隊。
  // 第三筆是別人家的：查詢少了 where('guardianUid' == 自己) 它就會漏出來
  //（真的 Firestore 會把整個查詢擋掉，替身沒有 rules，所以這裡直接盯結果）。
  await stub(page, {
    teams: { 't-2': { teamId: 't-2', name: '龍井白鯊', divisionId: 'u8', captainUid: 'U-other', status: 'approved', memberCount: 5 } },
    members: [
      { team: 't-1', memberId: 'm-a', name: '王小明', guardianUid: UID, status: 'approved', kind: 'player', jerseyNo: 7 },
      { team: 't-2', memberId: 'm-b', name: '王小華', guardianUid: UID, status: 'pending', kind: 'player', jerseyNo: 4 },
      { team: 't-2', memberId: 'm-r', name: '被婉拒的', guardianUid: UID, status: 'rejected', kind: 'player', jerseyNo: 5 },
      { team: 't-2', memberId: 'm-x', name: '別人家的', guardianUid: 'U-other', status: 'approved', kind: 'player', jerseyNo: 9 }
    ]
  });
  await go(page);
  const card = page.locator('.acct__card', { hasText: '我報名的球員' });
  await expect(card).toContainText('我報名的球員（2）');       // 被婉拒的不算
  await expect(card).toContainText('王小明');
  await expect(card).toContainText('大甲金剛足球隊 · #7');
  await expect(card).toContainText('已在名單上');
  await expect(card).toContainText('王小華');
  await expect(card).toContainText('龍井白鯊 · #4');
  await expect(card).toContainText('等隊長同意');
  await expect(card).toContainText('被婉拒的');
  await expect(card).not.toContainText('別人家的');
  // 還在名單上的排前面，被婉拒的排最後
  const names = await card.locator('.acct__rowMain').allTextContents();
  expect(names).toEqual(['王小華', '王小明', '被婉拒的']);
});

test('沒有報名任何球員時說清楚，不放一張空表 @my', async ({ page }) => {
  await stub(page);
  await go(page);
  const card = page.locator('.acct__card', { hasText: '我報名的球員' });
  await expect(card).toContainText('你還沒有替自己或小孩送出報名');
  await expect(card.locator('.acct__row')).toHaveCount(0);
});

test('⭐ 「我帶的球隊」已改名為「我的球隊」@my', async ({ page }) => {
  await stub(page);
  await go(page);
  await expect(page.locator('.acct')).toContainText('我的球隊');
  await expect(page.locator('.acct')).not.toContainText('我帶的球隊');
});

test('⭐ 檢錄員看得到檢錄，但看不到賽務台 @my', async ({ page }) => {
  await stub(page, { roles: ['checkin'] });
  await go(page);

  const hub = page.locator('.acct__card', { hasText: '我的功能' });
  await expect(hub).toContainText('檢錄');
  await expect(hub).not.toContainText('賽務台');
  await expect(hub).not.toContainText('出場名單');
});

test('⭐ 記錄員的功能比檢錄員多（向上包含）@my', async ({ page, context }) => {
  await stub(page, { roles: ['checkin'] });
  await go(page);
  // 等功能區真的畫出來再數——evaluate/count 不會等
  await expect(page.locator('.acct__card', { hasText: '我的功能' })).toBeVisible();
  const few = await tiles(page).count() + await soon(page).count();

  const p2 = await context.newPage();
  await stub(p2, { roles: ['scorer'] });
  await go(p2);
  await expect(p2.locator('.acct__card', { hasText: '我的功能' })).toBeVisible();
  const many = await tiles(p2).count() + await soon(p2).count();

  expect(many).toBeGreaterThan(few);
  // 記錄員仍然看得到檢錄（繼承來的）
  await expect(p2.locator('.acct__card', { hasText: '我的功能' })).toContainText('檢錄');
  await p2.close();
});

test('⭐ 總管看得到最多，包含身分授權與權限開關 @my', async ({ page }) => {
  await stub(page, { roles: ['super_admin'] });
  await go(page);

  const hub = page.locator('.acct__card', { hasText: '我的功能' });
  await expect(hub).toContainText('身分授權');
  await expect(hub).toContainText('權限開關');
  await expect(hub).toContainText('報名開關');
});

test('⭐ 身分列只顯示最高身分，不列出繼承來的一長串 @my', async ({ page }) => {
  // 記錄員看到「挑戰攤位、檢錄員、裁判、記錄員」會以為自己被指派了一堆職務
  await stub(page, { roles: ['scorer'] });
  await go(page);
  const roles = page.locator('.acct__roles');
  await expect(roles).toHaveText('記錄員');
});

test('⭐ 還沒做的功能畫成說明列，不是按不動的按鈕 @my', async ({ page }) => {
  // 按了沒反應是最難回報的故障；完全不顯示又會讓人以為身分沒生效。
  //
  // ⚠️ **不要寫死「一定有規劃中的項目」**：功能一個一個做完之後，
  //    沒有路由的 FEATURES 會歸零（2026-09-05 攤位端上線時就發生了）。
  //    這條測試守的是兩個方向——有的時候不能是按鈕、沒有的時候不能
  //    留一個空的區塊標題。
  await stub(page, { roles: ['admin'] });
  await go(page);
  await expect(page.locator('.acct__card').first()).toBeVisible({ timeout: 15_000 });

  const routeless = await page.evaluate(async () => {
    const m = await import('/js/config.js');
    return m.FEATURES.filter(f => !f.route).map(f => f.code);
  });

  if (routeless.length) {
    await expect(soon(page).first()).toContainText('規劃中');
    expect(await page.locator('.acct__soonList button').count()).toBe(0);
  } else {
    // 全部都有頁面了：不可以留一個空的「規劃中」區塊
    await expect(page.locator('.acct__soonList')).toHaveCount(0);
    await expect(page.getByText('規劃中')).toHaveCount(0);
  }
});

test('⭐ 總管把某一項關掉，那顆功能就不見了 @my', async ({ page }) => {
  // 「每一個獨立功能都要有權限開關」。這裡驗矩陣真的接上畫面。
  await stub(page, { roles: ['scorer'], perms: { scorer: { 'match.score.write': false } } });
  await go(page);

  const hub = page.locator('.acct__card', { hasText: '我的功能' });
  await expect(hub).toContainText('檢錄');
  await expect(hub).not.toContainText('賽務台');
});

test('⭐ 讀不到權限矩陣時走預設，不是全部消失 @my', async ({ page }) => {
  // 設定讀取失敗的當下把賽務按鈕全部收掉，現場會以為系統壞了
  await stub(page, { roles: ['scorer'] });          // 完全沒有 rolePermissions 文件
  await go(page);
  await expect(page.locator('.acct__card', { hasText: '我的功能' })).toContainText('賽務台');
});

test('未登入時導向登入而不是空白頁 @my', async ({ page }) => {
  await stub(page, { signedIn: false });
  await go(page);
  await expect(page.locator('#app-view')).toContainText(/登入/);
});

// ── 2026-09-06 主辦驗收：隊長從「我的」找不到審核鈕、被退件只看到「已婉拒」 ──
test('⭐ 「我的球隊」點進去是管理頁（審核、送出、取消都在那裡）@my', async ({ page }) => {
  await stub(page);
  await go(page);
  await page.locator('.acct__row', { hasText: '大甲金剛足球隊' }).click();
  await expect(page).toHaveURL(/team\/t-1\/manage/);
});

test('⭐ 被系統退件的球員在「我報名的球員」看得到原因 @my', async ({ page }) => {
  await stub(page, {
    members: [
      { team: 't-1', memberId: 'm-r', name: '張張', guardianUid: UID, status: 'rejected', kind: 'player',
        decidedBy: 'fn:rejectDuplicateApplication', rejectReason: '這個帳號對這支球隊已經有一筆待審的申請，請等隊長處理完再送下一筆。' },
      { team: 't-1', memberId: 'm-a', name: '張嘴', guardianUid: UID, status: 'approved', kind: 'player', jerseyNo: 6 }
    ]
  });
  await go(page);
  const card = page.locator('.acct__card', { hasText: '我報名的球員' });
  await expect(card.locator('.acct__rowReason')).toHaveCount(1);
  await expect(card.locator('.acct__rowReason')).toContainText('已經有一筆待審的申請');
});
