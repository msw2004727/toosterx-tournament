/**
 * E2E｜身分授權 `#/admin/staff`
 * ------------------------------------------------------------------
 * 規格：docs/10 §5.1、R-RULES-003、R-ROLE-002
 *
 * 這一組守的是四件事：
 *   ・**總管指派不出總管**（介面上連選項都不該有）
 *   ・**向上包含要寫在按鈕上**（不然總管會四個角色各指派一次）
 *   ・**停用不是刪除**
 *   ・**只有總管進得來**，管理員看到的是原因不是空白頁
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'U7774e1410479bafff4997f51b2c47b95';

const seed = ({ roles = ['super_admin'], extra = null } = {}) => {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo' },
    [`users/${UID}`]: { uid: UID, displayName: '金小麥' },
    'users/u-a': { uid: 'u-a', displayName: '陳阿明' },
    'users/u-b': { uid: 'u-b', displayName: '林小華' },
    [`staff/${UID}`]: {
      uid: UID, name: '金小麥', roles, active: true,
      assignment: { eventId: EVENT, venueIds: [], divisionIds: [], challengeIds: [] }
    },
    'staff/u-b': {
      uid: 'u-b', name: '林小華', roles: ['checkin'], active: true,
      assignment: { eventId: EVENT, venueIds: ['venue-a'], divisionIds: [], challengeIds: [] }
    },
    [`events/${EVENT}/venues/venue-a`]: { venueId: 'venue-a', name: 'A場', order: 1 },
    [`events/${EVENT}/venues/venue-b`]: { venueId: 'venue-b', name: 'B場', order: 2 }
  };
  if (extra) Object.assign(s, extra);
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
  await page.goto('/#/admin/staff');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

const dump = page => page.evaluate(() => window.__fake.__dump());
const staffOf = async (page, uid) => (await dump(page))[`staff/${uid}`];
const person = (page, name) => page.locator('.adm__item', { hasText: name });

/**
 * 身分按鈕。
 *
 * ⚠️ 不可以用 hasText：每一顆都寫著「含 挑戰攤位、檢錄員、裁判」，
 *    所以「管理員」那一顆的文字裡也有「記錄員」三個字。
 *    要對的是名字那一格。
 */
const roleBtn = (page, label) => page.locator('.adm__choice', {
  has: page.locator('.adm__choiceName', { hasText: new RegExp(`^${label}$`) })
});

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('⭐ 管理員進不來，而且看得到原因 @admin', async ({ page }) => {
  // 指派身分是總管專屬。管理員看到空白頁的話會以為系統壞了
  await stub(page, { roles: ['admin'] });
  await go(page);
  await expect(page.locator('.adm__box--warn')).toContainText('身分授權');
  await expect(page.locator('.adm__box--warn')).toContainText('總管');
  await expect(page.locator('.adm__list')).toHaveCount(0);
});

test('⭐ 列出登入過的人，有身分的排前面 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await expect(page.locator('.adm__item')).toHaveCount(3);      // 金小麥、林小華、陳阿明
  // 金小麥(super_admin 5) > 林小華(checkin 2.2) > 陳阿明(未指派)
  await expect(page.locator('.adm__item').first()).toContainText('金小麥');
  await expect(page.locator('.adm__item').last()).toContainText('陳阿明');
});

test('⭐ 講清楚「只列得出登入過的人」 @admin', async ({ page }) => {
  // uid 沒辦法憑空產生。少了這句話，總管會一直找那個人的名字
  await stub(page);
  await go(page);
  await expect(page.locator('.adm__box').first()).toContainText('登入過');
});

test('現在的身分寫在名字底下（含指派場地）@admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await expect(person(page, '林小華')).toContainText('檢錄員');
  await expect(person(page, '林小華')).toContainText('A場');
  await expect(person(page, '陳阿明')).toContainText('未指派');
});

test('⭐ 身分選單裡沒有總管，而且說得出為什麼 @admin', async ({ page }) => {
  // R-RULES-003。介面上指派得出總管＝點兩下就能造出第二個大總管
  await stub(page);
  await go(page);
  await person(page, '陳阿明').locator('.adm__itemHead').click();

  const choices = page.locator('.adm__choice');
  await expect(choices).toHaveCount(5);                          // booth/checkin/referee/scorer/admin
  await expect(page.locator('.adm__choices').first()).not.toContainText('總管');
  await expect(page.locator('.adm__detail')).toContainText('總管不在清單裡');
});

test('⭐ 總管那一列不給改身分，而且說得出為什麼 @admin', async ({ page }) => {
  // 這一條守的是總管好奇點開自己那一列：把自己降成管理員在 rules 上
  // 完全合法（admin 在白名單裡），但降下去之後升不回來——
  // 最後一位總管降級等於再也沒有人指派得了身分。
  await stub(page);
  await go(page);
  await person(page, '金小麥').locator('.adm__itemHead').click();

  await expect(page.locator('.adm__detail')).toContainText('總管的身分不能在這裡調整');
  await expect(page.locator('.adm__choice')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /指派身分|更新身分/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /停用/ })).toHaveCount(0);
});

test('⭐ 每一顆按鈕都寫得出「這個身分含哪些」 @admin', async ({ page }) => {
  // 向上包含（R-ROLE-002）看不見的話，總管會四個角色各指派一次
  await stub(page);
  await go(page);
  await person(page, '陳阿明').locator('.adm__itemHead').click();

  const scorer = roleBtn(page, '記錄員');
  await expect(scorer).toContainText('含 挑戰攤位、檢錄員、裁判');
  await expect(roleBtn(page, '挑戰攤位')).toContainText('不含其他身分');
});

test('⭐ 沒選身分就按不動（不會寫出空的 roles）@admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await person(page, '陳阿明').locator('.adm__itemHead').click();
  await expect(page.getByRole('button', { name: /指派身分/ })).toBeDisabled();
});

test('⭐ 指派：roles 只存被選的那一個，不存展開後的四個 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await person(page, '陳阿明').locator('.adm__itemHead').click();
  await roleBtn(page, '記錄員').click();
  await page.getByRole('button', { name: /指派身分/ }).click();

  await expect.poll(async () => (await staffOf(page, 'u-a'))?.roles, { timeout: 10_000 })
    .toEqual(['scorer']);
  const s = await staffOf(page, 'u-a');
  expect(s.active).toBe(true);
  expect(s.lineUserId).toBe('u-a');
  expect(s.assignment.eventId).toBe(EVENT);
});

test('⭐ 指派會留痕 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await person(page, '陳阿明').locator('.adm__itemHead').click();
  await roleBtn(page, '檢錄員').click();
  await page.getByRole('button', { name: /指派身分/ }).click();

  await expect.poll(async () => {
    const d = await dump(page);
    return Object.keys(d).filter(k => k.includes('/audits/')).length;
  }, { timeout: 10_000 }).toBe(1);

  const d = await dump(page);
  const audit = Object.entries(d).find(([k]) => k.includes('/audits/'))[1];
  expect(audit.action).toBe('staff.assign');
  expect(audit.targetId).toBe('u-a');
  expect(audit.before).toBeNull();
  expect(audit.after.roles).toEqual(['checkin']);
  expect(audit.actor.uid).toBe(UID);
});

test('⭐ 賽務角色選得了場地，管理員選不了 @admin', async ({ page }) => {
  // rules 的 assignedVenue() 對 admin 直接放行，讓人選場地會製造
  // 「我明明限制了他只能在 A 場」的錯覺
  await stub(page);
  await go(page);
  await person(page, '陳阿明').locator('.adm__itemHead').click();

  await roleBtn(page, '記錄員').click();
  await expect(page.locator('.adm__chip')).toHaveCount(2);

  await roleBtn(page, '管理員').click();
  await expect(page.locator('.adm__chip')).toHaveCount(0);
});

test('⭐ 換成管理員時舊的場地要被清掉，不是留在文件裡 @admin', async ({ page }) => {
  // 留著的話畫面上看不到、資料庫裡卻有一組其實不生效的限制
  await stub(page);
  await go(page);
  await person(page, '林小華').locator('.adm__itemHead').click();
  await roleBtn(page, '管理員').click();
  await page.getByRole('button', { name: /更新身分/ }).click();

  await expect.poll(async () => (await staffOf(page, 'u-b'))?.roles, { timeout: 10_000 })
    .toEqual(['admin']);
  expect((await staffOf(page, 'u-b')).assignment.venueIds).toEqual([]);
});

test('指派場地會寫進 assignment @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await person(page, '陳阿明').locator('.adm__itemHead').click();
  await roleBtn(page, '裁判').click();
  await page.locator('.adm__chip', { hasText: 'B場' }).click();
  await page.getByRole('button', { name: /指派身分/ }).click();

  await expect.poll(async () => (await staffOf(page, 'u-a'))?.assignment?.venueIds, { timeout: 10_000 })
    .toEqual(['venue-b']);
});

test('⭐ 停用是改 active，文件不會被刪掉 @admin', async ({ page }) => {
  // 刪掉的話「這筆比分是誰記的」就查不到人了
  await stub(page);
  await go(page);
  await person(page, '林小華').locator('.adm__itemHead').click();
  await page.getByRole('button', { name: /停用/ }).click();
  await page.locator('.modal').getByRole('button', { name: /^停用$/ }).click();

  await expect.poll(async () => (await staffOf(page, 'u-b'))?.active, { timeout: 10_000 }).toBe(false);
  const s = await staffOf(page, 'u-b');
  expect(s.roles).toEqual(['checkin']);          // 角色留著
});

test('停用之後列表要看得出來，而且可以再啟用 @admin', async ({ page }) => {
  await stub(page, {
    extra: {
      'staff/u-b': {
        uid: 'u-b', name: '林小華', roles: ['checkin'], active: false,
        assignment: { eventId: EVENT, venueIds: [], divisionIds: [], challengeIds: [] }
      }
    }
  });
  await go(page);
  await expect(person(page, '林小華')).toContainText('已停用');
  await person(page, '林小華').locator('.adm__itemHead').click();
  await expect(page.getByRole('button', { name: /重新啟用/ })).toBeVisible();
});

test('搜尋找得到人（名字與 uid 都可以）@admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await page.locator('.adm__search').fill('阿明');
  await expect(page.locator('.adm__item')).toHaveCount(1);

  await page.locator('.adm__search').fill('u-b');
  await expect(page.locator('.adm__item')).toHaveCount(1);
  await expect(page.locator('.adm__item')).toContainText('林小華');

  await page.locator('.adm__search').fill('不存在的人');
  await expect(page.locator('.adm__empty')).toContainText('沒有符合');
});

test('⭐ 320px 不出現橫向捲軸 @admin @narrow', async ({ page }) => {
  await stub(page);
  await go(page);
  await person(page, '陳阿明').locator('.adm__itemHead').click();
  await roleBtn(page, '記錄員').click();
  await expect(page.locator('.adm__chip').first()).toBeVisible();

  const over = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth <= d.clientWidth ? null : { scroll: d.scrollWidth, client: d.clientWidth };
  });
  expect(over).toBeNull();
});
