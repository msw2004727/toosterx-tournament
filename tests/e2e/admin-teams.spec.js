/**
 * E2E｜報名審核 `#/admin/teams`
 * ------------------------------------------------------------------
 * 規格：docs/05 §8.2、docs/10 §3
 *
 * 這一組守的是「主辦按下核准之前看到了什麼」：
 *   ・違反規章的球隊**不能**核准（超齡的罰則是取消整隊資格）
 *   ・退回一定要填原因（沒有原因的退回，隊長只會打電話問主辦）
 *   ・核准會鎖名單、退回會解凍——鎖錯方向的話隊長改不動卻看不出為什麼
 *   ・每一次都留痕
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'U7774e1410479bafff4997f51b2c47b95';

const member = (id, over = {}) => ({
  memberId: id, name: `小球員${id}`, kind: 'player', status: 'approved',
  birthDate: '2017-03-05', idLast4: '1234', jerseyNo: Number(id.replace(/\D/g, '')) || 1,
  ...over
});

const seed = ({ roles = ['admin'], teams = null, members = null } = {}) => {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo' },
    [`users/${UID}`]: { uid: UID, displayName: '金小麥' },
    [`staff/${UID}`]: {
      uid: UID, name: '金小麥', roles, active: true,
      assignment: { eventId: EVENT, venueIds: [], divisionIds: [], challengeIds: [] }
    },
    [`events/${EVENT}/divisions/u10`]: {
      divisionId: 'u10', name: 'U10兒童組', shortName: 'U10', officialName: '學童中年級',
      order: 3, playersOnField: 5, matchDurationMin: 25, periods: 1,
      eligibility: { bornOnOrAfter: '2016-09-01', note: '' }
    },
    [`events/${EVENT}/teams/t-ok`]: {
      teamId: 't-ok', name: '合格球隊', divisionId: 'u10',
      captainUid: 'u-cap', status: 'submitted', rosterLocked: false, memberCount: 3
    },
    [`events/${EVENT}/teams/t-bad`]: {
      teamId: 't-bad', name: '超齡球隊', divisionId: 'u10',
      captainUid: 'u-cap2', status: 'submitted', rosterLocked: false, memberCount: 2
    },
    [`events/${EVENT}/teams/t-draft`]: {
      teamId: 't-draft', name: '草稿球隊', divisionId: 'u10',
      captainUid: 'u-cap3', status: 'draft', rosterLocked: false, memberCount: 0
    },
    // 合格的三人
    [`events/${EVENT}/teams/t-ok/members/m1`]: member('m1'),
    [`events/${EVENT}/teams/t-ok/members/m2`]: member('m2', { idLast4: '2222' }),
    [`events/${EVENT}/teams/t-ok/members/m3`]: member('m3', { idLast4: '3333' }),
    // 一位超齡（2015 早於 2016-09-01 門檻）
    [`events/${EVENT}/teams/t-bad/members/m1`]: member('m1'),
    [`events/${EVENT}/teams/t-bad/members/m9`]: member('m9', { name: '大明', birthDate: '2015-01-01', idLast4: '9999' })
  };
  if (teams) Object.assign(s, teams);
  if (members) Object.assign(s, members);
  return s;
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
    window.__FAKE_USER = { uid: 'U7774e1410479bafff4997f51b2c47b95', displayName: '金小麥' };
  }, { s: seed(opts) });
}

async function go(page) {
  await page.goto('/#/admin/teams');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

const dump = page => page.evaluate(() => window.__fake.__dump());
const teamOf = async (page, id) => (await dump(page))[`events/${EVENT}/teams/${id}`];
const item = (page, name) => page.locator('.adm__item', { hasText: name });

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('⭐ 沒有 team.manage 權限的人看得到原因，不是空白頁 @admin', async ({ page }) => {
  await stub(page, { roles: ['scorer'] });
  await go(page);
  await expect(page.locator('.adm__box--warn')).toContainText('報名審核');
  await expect(page.locator('.adm__list')).toHaveCount(0);
});

test('⭐ 預設停在「待審核」，而且數得出各狀態幾隊 @admin', async ({ page }) => {
  // 主辦一天要做的事就是清掉待審那一疊，所以它排第一個分頁
  await stub(page);
  await go(page);

  const tabs = page.locator('.adm__tab');
  await expect(tabs.first()).toContainText('待審核');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.first()).toContainText('2');       // t-ok + t-bad
  await expect(page.locator('.adm__item')).toHaveCount(2);
});

test('⭐ 合格的球隊：檢核全過，可以核准 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await item(page, '合格球隊').locator('.adm__itemHead').click();

  await expect(page.locator('.adm__check--error')).toHaveCount(0);
  await expect(page.locator('.adm__checks')).toContainText('球員 3 人');
  await expect(page.getByRole('button', { name: /核准並鎖定名單/ })).toBeVisible();
});

test('⭐ 超齡的球隊不給核准，而且說得出是誰 @admin', async ({ page }) => {
  // 規章第十八條第 3 款：冒名頂替停止**整隊**資格。
  // 在這裡擋下來比在比賽當天被檢錄員抓到好得多。
  await stub(page);
  await go(page);
  await item(page, '超齡球隊').locator('.adm__itemHead').click();

  await expect(page.locator('.adm__check--error')).toContainText('大明');
  await expect(page.locator('.adm__check--error')).toContainText('出生門檻');
  // 核准鈕整顆不畫——畫一顆按了會被擋的按鈕比沒有更糟
  await expect(page.getByRole('button', { name: /核准並鎖定名單/ })).toHaveCount(0);
  await expect(page.locator('.adm__blocked')).toContainText('先請隊長改完再送');
  // 退回仍然可以
  await expect(page.getByRole('button', { name: /退回補件/ })).toBeVisible();
});

test('⭐ 核准會把狀態改成通過並鎖名單 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await item(page, '合格球隊').locator('.adm__itemHead').click();
  await page.getByRole('button', { name: /核准並鎖定名單/ }).click();
  await page.getByRole('button', { name: /^核准$/ }).click();

  await expect.poll(async () => (await teamOf(page, 't-ok'))?.status, { timeout: 10_000 }).toBe('approved');
  const t = await teamOf(page, 't-ok');
  expect(t.rosterLocked).toBe(true);
  expect(t.reviewedBy).toBe(UID);
});

test('⭐ 核准會留痕（誰、什麼時候、改了什麼）@admin', async ({ page }) => {
  // 「一切可修正、一切留痕」是不可協商的產品行為第 3 條
  await stub(page);
  await go(page);
  await item(page, '合格球隊').locator('.adm__itemHead').click();
  await page.getByRole('button', { name: /核准並鎖定名單/ }).click();
  await page.getByRole('button', { name: /^核准$/ }).click();

  await expect.poll(async () => {
    const d = await dump(page);
    return Object.keys(d).filter(k => k.includes('/audits/')).length;
  }, { timeout: 10_000 }).toBe(1);

  const d = await dump(page);
  const audit = Object.entries(d).find(([k]) => k.includes('/audits/'))[1];
  expect(audit.action).toBe('team.approve');
  expect(audit.targetId).toBe('t-ok');
  expect(audit.before.status).toBe('submitted');
  expect(audit.after.status).toBe('approved');
  expect(audit.actor.uid).toBe(UID);
});

test('⭐ 退回一定要填原因，空白按不動 @admin', async ({ page }) => {
  // 沒有原因的退回，隊長只會看到「被退回」然後打電話問主辦
  await stub(page);
  await go(page);
  await item(page, '超齡球隊').locator('.adm__itemHead').click();
  await page.getByRole('button', { name: /退回補件/ }).click();

  await page.getByRole('button', { name: /確定退回/ }).click();
  await expect(page.locator('.modal')).toBeVisible();          // 沒關掉
  await expect(page.locator('.modal .adm__blocked')).toBeVisible();
  expect((await teamOf(page, 't-bad')).status).toBe('submitted');
});

test('⭐ 退回會解凍名單（不可以順手鎖起來）@admin', async ({ page }) => {
  // rosterFrozen() 看的是 status in ['draft','rejected'] && !rosterLocked。
  // 退回時鎖起來的話，隊長改不動卻看不出為什麼。
  await stub(page);
  await go(page);
  await item(page, '超齡球隊').locator('.adm__itemHead').click();
  await page.getByRole('button', { name: /退回補件/ }).click();
  await page.locator('.adm__textarea').fill('大明超齡，請確認出生年月日');
  await page.getByRole('button', { name: /確定退回/ }).click();

  await expect.poll(async () => (await teamOf(page, 't-bad'))?.status, { timeout: 10_000 }).toBe('rejected');
  const t = await teamOf(page, 't-bad');
  expect(t.rosterLocked).toBe(false);
  expect(t.rejectReason).toBe('大明超齡，請確認出生年月日');
});

test('草稿球隊不用審核，也不畫核准鈕 @admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await page.getByRole('tab', { name: /草稿/ }).click();
  await item(page, '草稿球隊').locator('.adm__itemHead').click();

  await expect(page.locator('.adm__detail')).toContainText('還沒送出報名');
  await expect(page.getByRole('button', { name: /核准/ })).toHaveCount(0);
});

test('名單顯示民國年生日與後四碼（審核要核對的就是這兩格）@admin', async ({ page }) => {
  await stub(page);
  await go(page);
  await item(page, '合格球隊').locator('.adm__itemHead').click();

  const row = page.locator('.adm__member').first();
  await expect(row).toContainText('106/03/05');
  await expect(row).toContainText('末四碼');
});

test('⭐ 320px 不出現橫向捲軸 @admin @narrow', async ({ page }) => {
  await stub(page);
  await go(page);
  await item(page, '超齡球隊').locator('.adm__itemHead').click();
  await expect(page.locator('.adm__checks')).toBeVisible();

  const over = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth <= d.clientWidth ? null : { scroll: d.scrollWidth, client: d.clientWidth };
  });
  expect(over).toBeNull();
});
