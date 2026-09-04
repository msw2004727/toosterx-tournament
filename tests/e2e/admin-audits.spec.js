/**
 * E2E｜稽核紀錄 `#/admin/audits`
 * ------------------------------------------------------------------
 * 規格：docs/05、R-SEC-002
 *
 * 守四件事：
 *   ・**整頁唯讀**（稽核只能新增，連清除鈕都不該有）
 *   ・**兩種欄位形狀都讀得懂**（歷史上有三個寫入者、兩種形狀）
 *   ・**每一筆是一句人話**，而且不認得的動作不吞掉
 *   ・**還沒同步的時間顯示「同步中」**，不填本機時間
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'U7774e1410479bafff4997f51b2c47b95';
const T = iso => ({ seconds: Math.floor(Date.parse(iso) / 1000), nanoseconds: 0 });

/** 管理後台早期的形狀（demo 上真的有 14 筆這種） */
const A_OLD = {
  auditId: 'a-old', action: 'team.approve', targetType: 'team', targetId: 't-113',
  before: { status: 'submitted' }, after: { status: 'approved' }, reason: null,
  actor: { uid: UID }, createdAt: T('2026-09-04T07:05:00+08:00')
};
/** 賽務端與結果管線的形狀 */
const A_NEW = {
  auditId: 'a-new', action: 'match.finish.undo', entity: 'match', entityId: 'AO-G-A-01',
  before: null, after: null, reason: null,
  actor: { uid: 'u-scorer', name: null }, createdAt: T('2026-09-04T06:00:00+08:00')
};

const seed = ({ roles = ['admin'], extra = null } = {}) => {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo' },
    [`users/${UID}`]: { uid: UID, displayName: '金小麥' },
    'users/u-scorer': { uid: 'u-scorer', displayName: '陳賽務' },
    [`staff/${UID}`]: {
      uid: UID, name: '金小麥', roles, active: true,
      assignment: { eventId: EVENT, venueIds: [], divisionIds: [], challengeIds: [] }
    },
    [`events/${EVENT}/teams/t-113`]: { teamId: 't-113', name: '臺中晨星足球隊', status: 'approved' },
    [`events/${EVENT}/audits/a-old`]: A_OLD,
    [`events/${EVENT}/audits/a-new`]: A_NEW,
    [`events/${EVENT}/audits/a-perm`]: {
      auditId: 'a-perm', action: 'perms.toggle', entity: 'rolePermissions', entityId: 'scorer',
      before: { 'match.finish': true }, after: { 'match.finish': false }, reason: null,
      actor: { uid: UID }, createdAt: T('2026-09-04T07:00:00+08:00')
    },
    [`events/${EVENT}/audits/a-staff`]: {
      auditId: 'a-staff', action: 'staff.assign', entity: 'staff', entityId: 'u-scorer',
      before: null, after: { roles: ['scorer'] }, reason: null,
      actor: { uid: UID }, createdAt: T('2026-09-04T06:30:00+08:00')
    }
  };
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
  await page.goto('/#/admin/audits');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

/** 斷言「不存在」之前先等頁面真的畫出來（見 perm-effect.spec.js 的說明） */
const ready = page => expect(page.locator('.adm__tabs')).toBeVisible({ timeout: 15_000 });
const item = (page, text) => page.locator('.adm__audit', { hasText: text });

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('⭐ 記錄員進不來，而且看得到原因 @admin', async ({ page }) => {
  await stub(page, { roles: ['scorer'] });
  await go(page);
  await expect(page.locator('.adm__box--warn')).toContainText('稽核紀錄');
  await expect(page.locator('.adm__audit')).toHaveCount(0);
});

test('⭐ 四筆都列出來，最新的在最前面 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await expect(page.locator('.adm__audit')).toHaveCount(4);
  await expect(page.locator('.adm__audit').first()).toContainText('核准了');       // 07:05
  await expect(page.locator('.adm__audit').last()).toContainText('撤回了');        // 06:00
});

test('⭐ 舊形狀（targetType）與新形狀（entity）都讀得懂 @admin', async ({ page }) => {
  // 歷史上有三個寫入者、兩種欄位形狀，而稽核紀錄不可以改寫（R-SEC-002）
  await stub(page);
  await go(page);
  await expect(item(page, '核准了')).toContainText('臺中晨星足球隊');   // targetType 形狀
  await expect(item(page, '撤回了')).toContainText('AO-G-A-01');        // entity 形狀
});

test('⭐ 每一筆是一句人話，不是一坨 JSON @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await expect(item(page, '關閉了')).toContainText('關閉了「記錄員」的「送出完賽」');
  await expect(item(page, '指派給')).toContainText('把「記錄員」指派給 陳賽務');
  await expect(page.locator('.adm__audits')).not.toContainText('match.finish');   // 代碼不外露
});

test('⭐ 操作者的名字讀取時再查（紀錄上的 actor.name 不能信）@admin', async ({ page }) => {
  // custom token 登入的人 displayName 永遠是 null，權威在 users/{uid}
  await stub(page);
  await go(page);
  await expect(item(page, '核准了')).toContainText('金小麥');
  await expect(item(page, '撤回了')).toContainText('陳賽務');
  await expect(page.locator('.adm__audits')).not.toContainText(UID);
});

test('查不到名字時退回 uid，不顯示空白 @admin', async ({ page }) => {
  await stub(page, {
    extra: {
      [`events/${EVENT}/audits/a-ghost`]: {
        auditId: 'a-ghost', action: 'team.approve', entity: 'team', entityId: 't-999',
        actor: { uid: 'u-nobody' }, createdAt: T('2026-09-04T08:00:00+08:00')
      }
    }
  });
  await go(page);
  await expect(page.locator('.adm__audit').first()).toContainText('u-nobody');
  await expect(page.locator('.adm__audit').first()).toContainText('t-999');
});

test('⭐ 不認得的動作照原樣印出來，不吞掉 @admin', async ({ page }) => {
  await stub(page, {
    extra: {
      [`events/${EVENT}/audits/a-future`]: {
        auditId: 'a-future', action: 'future.thing', entity: 'team', entityId: 't-113',
        actor: { uid: UID }, createdAt: T('2026-09-04T09:00:00+08:00')
      }
    }
  });
  await go(page);
  await expect(page.locator('.adm__audit').first()).toContainText('future.thing');
});

test('⭐ 還沒同步的時間顯示「同步中」，不填本機時間 @admin', async ({ page }) => {
  // serverTimestamp 在本機快照上是 null。填本機時間會讓稽核的時間軸失真。
  await stub(page, {
    extra: {
      [`events/${EVENT}/audits/a-pending`]: {
        auditId: 'a-pending', action: 'team.approve', entity: 'team', entityId: 't-113',
        actor: { uid: UID }, createdAt: null
      }
    }
  });
  await go(page);
  await expect(item(page, '同步中')).toHaveCount(1);

  // ⭐ 而且要排在**最後**，不是最前面。
  //    Firestore 的 null 排序是最小的，所以 desc 會把它排到尾端——
  //    排到最前面等於讓一筆還沒同步的紀錄假裝自己是最新的。
  //    （這一條同時守著替身的排序語意，見變異 #E10。）
  await expect(page.locator('.adm__audit').last()).toContainText('同步中');
  await expect(page.locator('.adm__audit').first()).not.toContainText('同步中');
});

test('⭐ 退回的原因看得到 @admin', async ({ page }) => {
  await stub(page, {
    extra: {
      [`events/${EVENT}/audits/a-rej`]: {
        auditId: 'a-rej', action: 'team.reject', entity: 'team', entityId: 't-113',
        before: { status: 'submitted' }, after: { status: 'rejected' },
        reason: '兩位球員都是 1 號', actor: { uid: UID }, createdAt: T('2026-09-04T10:00:00+08:00')
      }
    }
  });
  await go(page);
  await expect(page.locator('.adm__audit').first()).toContainText('兩位球員都是 1 號');
});

test('分頁與搜尋可以縮小範圍 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await page.getByRole('tab', { name: /身分授權/ }).click();
  await expect(page.locator('.adm__audit')).toHaveCount(1);

  await page.getByRole('tab', { name: /全部/ }).click();
  await page.locator('.adm__search').fill('臺中晨星');
  await expect(page.locator('.adm__audit')).toHaveCount(1);

  await page.locator('.adm__search').fill('不存在的東西');
  await expect(page.locator('.adm__empty')).toContainText('沒有符合');
});

test('⭐ 整頁唯讀：沒有任何會改東西的按鈕 @admin', async ({ page }) => {
  // R-SEC-002。連一顆「清除」都不該有。
  await stub(page);
  await go(page);
  await ready(page);
  await expect(page.getByRole('button', { name: /刪除|清除|清空|修改|編輯/ })).toHaveCount(0);
  await expect(page.locator('.adm')).toContainText('只能新增');
});

test('沒有紀錄時說得出這一頁會長什麼 @admin', async ({ page }) => {
  await stub(page, { extra: null });
  await page.addInitScript(() => {
    for (const k of Object.keys(window.__FAKE_SEED)) if (k.includes('/audits/')) delete window.__FAKE_SEED[k];
    window.__seedData = window.__FAKE_SEED;
  });
  await go(page);
  await expect(page.locator('.adm__empty')).toContainText('核准報名、指派身分、調整權限');
});

test('⭐ 320px 不出現橫向捲軸 @admin @narrow', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  const over = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth <= d.clientWidth ? null : { scroll: d.scrollWidth, client: d.clientWidth };
  });
  expect(over).toBeNull();
});
