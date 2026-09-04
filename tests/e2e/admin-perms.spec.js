/**
 * E2E｜權限開關 `#/admin/perms`
 * ------------------------------------------------------------------
 * 規格：docs/05、R-PERM-001、R-PERM-002
 *
 * 這一組守的是「開關按下去到底有沒有用」：
 *   ・調不動的那幾條連開關都不畫（按了沒反應是最難回報的故障）
 *   ・關掉之後誰不受影響，要寫在畫面上
 *   ・寫入是 merge，不會把同一個角色其他權限的設定抹掉
 *   ・讀不到設定走預設，不是全部關閉
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'U7774e1410479bafff4997f51b2c47b95';

/** 種子的形狀：每個角色列出自己預設拿得到的全部權限，全部 true */
const MATRIX = {
  booth: { role: 'booth', perms: { 'challenge.attempt.write': true } },
  checkin: {
    role: 'checkin',
    perms: { 'challenge.attempt.write': true, 'checkin.write': true, 'member.read': true }
  },
  referee: {
    role: 'referee',
    perms: {
      'challenge.attempt.write': true, 'checkin.write': true, 'member.read': true,
      'matchsheet.write': true
    }
  },
  scorer: {
    role: 'scorer',
    perms: {
      'challenge.attempt.write': true, 'checkin.write': true, 'member.read': true,
      'matchsheet.write': true, 'match.period': true, 'match.score.write': true,
      'match.finish': true, 'match.undo': true
    }
  },
  admin: {
    role: 'admin',
    perms: {
      'challenge.attempt.write': true, 'checkin.write': true, 'member.read': true,
      'matchsheet.write': true, 'match.period': true, 'match.score.write': true,
      'match.finish': true, 'match.undo': true,
      'match.confirm': true, 'match.reopen': true, 'match.score.override': true,
      'schedule.manage': true, 'standing.manual': true, 'team.manage': true,
      'audit.read': true, 'export': true
    }
  }
};

const seed = ({ roles = ['super_admin'], matrix = MATRIX } = {}) => {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo' },
    [`users/${UID}`]: { uid: UID, displayName: '金小麥' },
    [`staff/${UID}`]: {
      uid: UID, name: '金小麥', roles, active: true,
      assignment: { eventId: EVENT, venueIds: [], divisionIds: [], challengeIds: [] }
    }
  };
  for (const [role, doc] of Object.entries(matrix ?? {})) s[`rolePermissions/${role}`] = doc;
  return s;
};

async function stub(page, opts = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r =>
    r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());

  await page.addInitScript(({ s, u }) => {
    window.__FAKE_SEED = s;
    window.__seedData = s;
    window.__FAKE_USER = { uid: u, displayName: '金小麥' };
  }, { s: seed(opts), u: UID });
}

async function go(page) {
  await page.goto('/#/admin/perms');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

const dump = page => page.evaluate(() => window.__fake.__dump());
const permsOf = async (page, role) => (await dump(page))[`rolePermissions/${role}`]?.perms;
const row = (page, label) => page.locator('.adm__perm', { hasText: label });

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('⭐ 管理員進不來，而且看得到原因 @admin', async ({ page }) => {
  await stub(page, { roles: ['admin'] });
  await go(page);
  await expect(page.locator('.adm__box--warn')).toContainText('權限開關');
  await expect(page.locator('.adm__box--warn')).toContainText('總管');
  await expect(page.locator('.adm__perm')).toHaveCount(0);
});

test('⭐ 每一條權限都列出來，預設全開 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await expect(page.locator('.adm__perm')).toHaveCount(19);
  await expect(page.locator('.adm__perm.is-off')).toHaveCount(0);
  await expect(page.locator('.adm__head')).toContainText('全部維持預設');
});

test('⭐ 每一列寫得出這是誰的權限 @admin', async ({ page }) => {
  // 「賽務」組裡同時有裁判的與記錄員的，只看組標題會以為都是記錄員
  await stub(page);
  await go(page);
  await expect(row(page, '編輯出場名單')).toContainText('裁判（含以上）');
  await expect(row(page, '送出完賽')).toContainText('記錄員（含以上）');
  await expect(row(page, '審核報名與球隊')).toContainText('管理員（含以上）');
});

test('⭐ 總管那三條不畫開關，只寫原因 @admin', async ({ page }) => {
  // effectivePerms() 對總管直接回全部權限，開關按下去不會有任何效果。
  // 畫一顆按了沒反應的開關比沒有更糟。
  await stub(page);
  await go(page);
  for (const label of ['指派身分', '調整權限開關', '開關報名與截止日']) {
    await expect(row(page, label).locator('.adm__switch')).toHaveCount(0);
    await expect(row(page, label).locator('.adm__lock')).toHaveCount(1);
    await expect(row(page, label)).toContainText('總管不受權限開關影響');
  }
});

test('⭐ 破壞性的那幾條標「規則也擋」 @admin', async ({ page }) => {
  // 關掉只是把按鈕收起來，資料仍由 firestore.rules 保護（R-PERM-002）
  await stub(page);
  await go(page);
  await expect(row(page, '送出完賽')).toContainText('規則也擋');
  await expect(row(page, '看球員個資')).not.toContainText('規則也擋');
});

test('⭐ 關掉之前先講後果，取消就什麼都不寫 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await row(page, '送出完賽').locator('.adm__switch').click();

  await expect(page.locator('.modal')).toContainText('記錄員會立刻少掉這個功能');
  await expect(page.locator('.modal')).toContainText('管理員、總管仍然可以');
  await page.locator('.modal').getByRole('button', { name: /取消/ }).click();

  expect((await permsOf(page, 'scorer'))['match.finish']).toBe(true);
});

test('⭐ 關掉會寫進來源那一階，而且不動其他權限 @admin', async ({ page }) => {
  // 整份覆蓋會把賽前調好的其他設定一起抹掉，而且抹掉之後畫面看起來完全正常
  await stub(page);
  await go(page);
  await row(page, '送出完賽').locator('.adm__switch').click();
  await page.locator('.modal').getByRole('button', { name: /^關掉$/ }).click();

  await expect.poll(async () => (await permsOf(page, 'scorer'))?.['match.finish'], { timeout: 10_000 })
    .toBe(false);
  const perms = await permsOf(page, 'scorer');
  expect(perms['match.score.write']).toBe(true);      // 其他的原封不動
  expect(perms['match.undo']).toBe(true);
  expect((await permsOf(page, 'admin'))['match.finish']).toBe(true);   // 管理員不受影響
});

test('⭐ 關掉之後那一列要看得出來，並寫出誰不受影響 @admin', async ({ page }) => {
  await stub(page, {
    matrix: {
      ...MATRIX,
      scorer: { ...MATRIX.scorer, perms: { ...MATRIX.scorer.perms, 'match.finish': false } }
    }
  });
  await go(page);
  await expect(row(page, '送出完賽')).toHaveClass(/is-off/);
  await expect(row(page, '送出完賽')).toContainText('管理員、總管仍然可以');
  await expect(page.locator('.adm__head')).toContainText('1 項已關閉');
  await expect(row(page, '送出完賽').locator('.adm__switch')).toHaveAttribute('aria-checked', 'false');
});

test('關掉的可以再打開（不用再確認一次）@admin', async ({ page }) => {
  await stub(page, {
    matrix: {
      ...MATRIX,
      scorer: { ...MATRIX.scorer, perms: { ...MATRIX.scorer.perms, 'match.finish': false } }
    }
  });
  await go(page);
  await row(page, '送出完賽').locator('.adm__switch').click();

  await expect.poll(async () => (await permsOf(page, 'scorer'))?.['match.finish'], { timeout: 10_000 })
    .toBe(true);
  await expect(page.locator('.modal')).toHaveCount(0);
});

test('⭐ 每一次調整都留痕 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await row(page, '檢錄勾選出賽').locator('.adm__switch').click();
  await page.locator('.modal').getByRole('button', { name: /^關掉$/ }).click();

  await expect.poll(async () => {
    const d = await dump(page);
    return Object.keys(d).filter(k => k.includes('/audits/')).length;
  }, { timeout: 10_000 }).toBe(1);

  const d = await dump(page);
  const audit = Object.entries(d).find(([k]) => k.includes('/audits/'))[1];
  expect(audit.action).toBe('perms.toggle');
  expect(audit.targetId).toBe('checkin');
  expect(audit.before['checkin.write']).toBe(true);
  expect(audit.after['checkin.write']).toBe(false);
  expect(audit.actor.uid).toBe(UID);
});

test('⭐ 讀不到設定走預設，不是全部關閉 @admin', async ({ page }) => {
  // 規矩 3：把賽務按鈕全部收掉，現場會以為系統壞了
  await stub(page, { matrix: null });
  await go(page);
  await expect(page.locator('.adm__perm')).toHaveCount(19);
  await expect(page.locator('.adm__perm.is-off')).toHaveCount(0);
});

test('⭐ 320px 不出現橫向捲軸 @admin @narrow', async ({ page }) => {
  await stub(page);
  await go(page);
  await expect(page.locator('.adm__perm').first()).toBeVisible();

  const over = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth <= d.clientWidth ? null : { scroll: d.scrollWidth, client: d.clientWidth };
  });
  expect(over).toBeNull();
});

test('⭐ 開關在最窄的螢幕上仍然點得到（高度 ≥ 44）@admin @narrow', async ({ page }) => {
  await stub(page);
  await go(page);
  const box = await row(page, '送出完賽').locator('.adm__switch').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
});
