/**
 * E2E｜報名流程（M4-b②）
 * ------------------------------------------------------------------
 * 規格：docs/10 §3、§4、§10 的驗收條件 A01–A04、A10
 *
 * 這一組守的是流程上「錯了會讓人白填一輪」的地方：
 *   ・報名關著的時候不要留一顆按下去會失敗的按鈕
 *   ・申請人不可以自己核准自己（閘門是隊長同意）
 *   ・名單凍結後不可以再改，而且畫面要先說，不要讓人填完才被擋
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const CAP = 'U-captain-0000000000000000000000';
const PARENT = 'U-parent-00000000000000000000000';
const TEAM = 't-abc123';
const CODE = 'ABC123';

const DAY = 86_400_000;

const base = ({ open = true, teamOver = {}, members = {} } = {}) => ({
  [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
  'config/env': { env: 'demo' },
  'config/registration': {
    open, opensAt: Date.now() - DAY, closesAt: Date.now() + DAY, maxTeamsPerAccount: 3
  },
  [`events/${EVENT}/divisions/u10`]: {
    divisionId: 'u10', name: 'U10 兒童組', order: 3, playersOnField: 5, matchDurationMin: 20,
    display: { mercyRule: { enabled: true, cap: 7 }, scorerBoard: false }
  },
  [`events/${EVENT}/divisions/adult-open`]: {
    divisionId: 'adult-open', name: '成人公開組', order: 6, playersOnField: 9, matchDurationMin: 30,
    display: { mercyRule: { enabled: false, cap: 7 }, scorerBoard: true }
  },
  [`events/${EVENT}/teams/${TEAM}`]: {
    teamId: TEAM, name: '大甲金剛足球隊', shortName: '大甲', divisionId: 'u10',
    captainUid: CAP, status: 'draft', rosterLocked: false, memberCount: 0,
    inviteCode: CODE, announcement: { text: null },
    ...teamOver
  },
  ...members
});

const member = (id, over = {}) => ({
  [`events/${EVENT}/teams/${TEAM}/members/${id}`]: {
    memberId: id, guardianUid: PARENT, name: '王小明', birthDate: '2016-03-14',
    jerseyNo: 7, kind: 'player', status: 'pending', appliedAt: 1, ...over
  }
});

async function stub(page, seed, user = null) {
  await page.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r =>
    r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript',
      body: 'window.liff={init:()=>Promise.resolve(),isInClient:()=>false,isLoggedIn:()=>false,login:()=>{},getIDToken:()=>null,logout:()=>{}};' }));
  await page.addInitScript(({ s, u }) => {
    window.__FAKE_SEED = s; window.__seedData = s; window.__FAKE_USER = u;
  }, { s: seed, u: user });
}

async function go(page, hash) {
  await page.goto(hash);
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

const dump = page => page.evaluate(() => window.__fake.__dump());

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

/* ══════════════════════════════════════════════════════════════
   報名首頁
   ══════════════════════════════════════════════════════════════ */

test('⭐ 報名關閉時不留一顆按下去會失敗的建隊鈕 @register', async ({ page }) => {
  await stub(page, base({ open: false }), { uid: CAP, displayName: '隊長' });
  await go(page, '/#/register');

  await expect(page.locator('.reg__box--warn')).toContainText('報名尚未開放');
  await expect(page.getByRole('button', { name: /我要建立球隊/ })).toHaveCount(0);
});

test('⭐ 已過截止日也一樣（開關與時間是 AND）@register', async ({ page }) => {
  const seed = base();
  seed['config/registration'].closesAt = Date.now() - 1000;
  await stub(page, seed, { uid: CAP, displayName: '隊長' });
  await go(page, '/#/register');

  await expect(page.locator('.reg__box--warn')).toContainText('報名已經截止');
  await expect(page.getByRole('button', { name: /我要建立球隊/ })).toHaveCount(0);
});

test('開放中有建隊入口，也有邀請碼入口 @register', async ({ page }) => {
  await stub(page, base(), { uid: CAP, displayName: '隊長' });
  await go(page, '/#/register');

  await expect(page.locator('.reg')).toContainText('報名開放中');
  await expect(page.getByRole('button', { name: /我要建立球隊/ })).toBeVisible();
  await expect(page.getByLabel('邀請碼')).toBeVisible();
});

test('⭐ 邀請碼排在建立球隊之前 @register', async ({ page }) => {
  // 一支球隊只有一個隊長，卻會有十幾個隊友掃碼進來。
  // 多數人來這一頁是要「加入」，不是「建隊」——把建隊放最上面，
  // 隊友要一路捲到底才找得到自己該用的那一格（2026-09-03 實地回報）。
  await stub(page, base(), { uid: CAP, displayName: '隊長' });
  await go(page, '/#/register');

  // 先等畫好——evaluate 不會等，少了這一行會在渲染完成前就去數順序
  await expect(page.getByLabel('邀請碼')).toBeVisible();
  const order = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.reg > *')];
    const at = pred => nodes.findIndex(pred);
    return {
      join: at(n => n.querySelector('.reg__codeInput')),
      create: at(n => [...n.querySelectorAll('button')].some(b => /我要建立球隊/.test(b.textContent)))
    };
  });
  expect(order.join).toBeGreaterThan(-1);
  expect(order.create).toBeGreaterThan(-1);
  expect(order.join).toBeLessThan(order.create);
});

test('⭐ 沒登入時建隊會先帶去登入，而不是讓人填完才擋 @register', async ({ page }) => {
  await stub(page, base(), null);
  await go(page, '/#/register');
  await page.getByRole('button', { name: /我要建立球隊/ }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('#/login');
});

/* ══════════════════════════════════════════════════════════════
   建立球隊
   ══════════════════════════════════════════════════════════════ */

test('⭐ 建立球隊寫入正確的初始狀態（draft、自己是隊長、有邀請碼）@register', async ({ page }) => {
  await stub(page, base(), { uid: CAP, displayName: '隊長' });
  await go(page, '/#/register/new');

  await page.getByLabel(/隊名/).fill('太平閃電足球隊');
  await page.getByRole('button', { name: /建立球隊/ }).click();

  await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/#\/team\/.+\/manage/);

  const docs = await dump(page);
  const created = Object.entries(docs).find(([p, d]) => p.includes('/teams/') && d.name === '太平閃電足球隊');
  expect(created).toBeTruthy();
  const t = created[1];
  expect(t.status).toBe('draft');            // 不可以自帶 approved
  expect(t.captainUid).toBe(CAP);            // 不可以冒名
  expect(t.rosterLocked).toBe(false);
  expect(t.memberCount).toBe(0);
  expect(t.inviteCode).toMatch(/^[A-Z2-9]{6}$/);
});

test('隊名太短時建立鈕是關著的 @register', async ({ page }) => {
  await stub(page, base(), { uid: CAP, displayName: '隊長' });
  await go(page, '/#/register/new');
  await expect(page.getByRole('button', { name: /建立球隊/ })).toBeDisabled();
  await page.getByLabel(/隊名/).fill('一');
  await expect(page.getByRole('button', { name: /建立球隊/ })).toBeDisabled();
  await page.getByLabel(/隊名/).fill('一隊');
  await expect(page.getByRole('button', { name: /建立球隊/ })).toBeEnabled();
});

/* ══════════════════════════════════════════════════════════════
   用邀請碼加入
   ══════════════════════════════════════════════════════════════ */

test('邀請碼打錯時說清楚，而不是空白頁 @register', async ({ page }) => {
  await stub(page, base(), { uid: PARENT, displayName: '家長' });
  await go(page, '/#/join/ZZZZZZ');
  await expect(page.locator('.reg__box--warn')).toContainText('找不到這組邀請碼');
});

test('⭐ 送出的申請一定是 pending，而且掛在自己名下 @register', async ({ page }) => {
  // 知道邀請碼只能「申請」，隊長同意才是閘門（docs/10 §3.3）
  await stub(page, base(), { uid: PARENT, displayName: '家長' });
  await go(page, `/#/join/${CODE}`);

  await page.getByLabel(/球員姓名/).fill('王小明');
  await page.getByRole('button', { name: /送出加入申請/ }).click();
  await expect(page.locator('.reg')).toContainText('申請已送出');

  const docs = await dump(page);
  const m = Object.entries(docs).find(([p]) => p.includes(`/teams/${TEAM}/members/`))?.[1];
  expect(m.status).toBe('pending');
  expect(m.guardianUid).toBe(PARENT);
  expect(m.name).toBe('王小明');
});

test('⭐ 兒童組要說明填的是小孩的資料，並預告姓名會被遮 @register @privacy', async ({ page }) => {
  await stub(page, base(), { uid: PARENT, displayName: '家長' });
  await go(page, `/#/join/${CODE}`);
  await expect(page.locator('.reg')).toContainText('請填「小孩」的資料');
  await expect(page.locator('.reg')).toContainText('王小＊');
});

test('⭐ 球隊已送出報名時，先說名單凍結，不要讓人填完才被擋 @register', async ({ page }) => {
  await stub(page, base({ teamOver: { status: 'submitted' } }), { uid: PARENT, displayName: '家長' });
  await go(page, `/#/join/${CODE}`);

  await expect(page.locator('.reg__box--warn')).toContainText('名單暫時凍結');
  await expect(page.getByRole('button', { name: /送出加入申請/ })).toHaveCount(0);
});

/* ══════════════════════════════════════════════════════════════
   隊長端
   ══════════════════════════════════════════════════════════════ */

test('⭐ 不是隊長就不能管理名單 @register', async ({ page }) => {
  await stub(page, base(), { uid: PARENT, displayName: '家長' });
  await go(page, `/#/team/${TEAM}/manage`);
  await expect(page.locator('.reg__box--warn')).toContainText('你不是這支球隊的隊長');
});

test('⭐ 隊長同意申請之後才進名單（驗收 A02）@register', async ({ page }) => {
  await stub(page, base({ members: member('m-1') }), { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  await expect(page.locator('.reg')).toContainText('待你同意（1）');
  await page.getByRole('button', { name: /^同意$/ }).click();

  await expect.poll(async () => {
    const d = await dump(page);
    return d[`events/${EVENT}/teams/${TEAM}/members/m-1`]?.status;
  }, { timeout: 10_000 }).toBe('approved');
});

test('⭐ 名單凍結後不能再決定申請（驗收 A04）@register', async ({ page }) => {
  await stub(page, base({ teamOver: { status: 'submitted' }, members: member('m-1') }),
    { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  await expect(page.locator('.reg')).toContainText('名單已凍結');
  await expect(page.getByRole('button', { name: /^同意$/ })).toHaveCount(0);
});

test('⭐ 沒有已核准成員時不能送出報名 @register', async ({ page }) => {
  await stub(page, base(), { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  await expect(page.getByRole('button', { name: /送出報名/ })).toBeDisabled();
  await expect(page.locator('.reg')).toContainText('至少要有一位已核准的成員');
});

test('⭐ 送出報名之後狀態變成待審核，而且可以撤回 @register', async ({ page }) => {
  await stub(page, base({ members: member('m-1', { status: 'approved' }) }),
    { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  await page.getByRole('button', { name: /送出報名/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /送出報名/ }).click();

  await expect.poll(async () => {
    const d = await dump(page);
    return d[`events/${EVENT}/teams/${TEAM}`]?.status;
  }, { timeout: 10_000 }).toBe('submitted');

  await expect(page.getByRole('button', { name: /撤回報名/ })).toBeVisible();
});

test('隊長看得到邀請碼與可複製的連結 @register', async ({ page }) => {
  await stub(page, base(), { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);
  await expect(page.locator('.reg__codeValue')).toHaveText(CODE);
  await expect(page.getByRole('button', { name: /複製邀請連結/ })).toBeVisible();
});

test('⭐ 320px 不出現橫向捲軸（邀請碼與名單列最容易撐破）@register @narrow', async ({ page }) => {
  await stub(page, base({ members: member('m-1', { status: 'approved', name: '歐陽小明超長名字' }) }),
    { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  const over = await page.evaluate(() => {
    const d = document.documentElement;
    if (d.scrollWidth <= d.clientWidth) return null;
    return [...document.querySelectorAll('*')]
      .filter(n => n.getBoundingClientRect().right > d.clientWidth + 1)
      .map(n => `${n.tagName}.${n.className}`).slice(0, 5);
  });
  expect(over).toBeNull();
});
