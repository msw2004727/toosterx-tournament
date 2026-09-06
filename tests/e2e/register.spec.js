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
  // ⚠️ 這裡的欄位必須跟 js/engine/formats.js 的真實 schema 一致。
  //    替身資料寫錯 schema 比沒有測試更危險——它會主動證明錯的東西是對的
  //    （M5 整合時就是這樣，四個欄位路徑全錯但 E2E 全綠）。
  //    eligibility.bornOnOrAfter 決定這一組走不走「教練直接管理名單」。
  [`events/${EVENT}/divisions/u10`]: {
    divisionId: 'u10', name: 'U10兒童組', shortName: 'U10', officialName: '學童中年級', order: 3,
    playersOnField: 5, matchDurationMin: 25, periods: 1, ballSize: 4,
    eligibility: { bornOnOrAfter: '2016-09-01', note: '就讀各公、私立小學' },
    display: { mercyRule: { enabled: false, cap: 7 }, scorerBoard: false }
  },
  [`events/${EVENT}/divisions/adult-open`]: {
    divisionId: 'adult-open', name: '成人公開組', shortName: '公開', officialName: '男子公開組', order: 6,
    playersOnField: 9, matchDurationMin: 30, periods: 1, ballSize: 5,
    eligibility: { bornOnOrAfter: null, note: '在學學生之社會人士、機關及公司員工均可自由組隊參加' },
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

/**
 * @param {{freshGuide?:boolean}} o  freshGuide：這台裝置「沒看過」圖文教學。
 *   預設當成看過——報名首頁第一次進來會自動跳教學，會蓋住其他測試要按的按鈕。
 */
async function stub(page, seed, user = null, { freshGuide = false } = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r =>
    r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript',
      body: 'window.liff={init:()=>Promise.resolve(),isInClient:()=>false,isLoggedIn:()=>false,login:()=>{},getIDToken:()=>null,logout:()=>{}};' }));
  await page.addInitScript(({ s, u, seen }) => {
    window.__FAKE_SEED = s; window.__seedData = s; window.__FAKE_USER = u;
    if (seen) { try { localStorage.setItem('feda:regGuideSeen', '1'); } catch {} }
  }, { s: seed, u: user, seen: !freshGuide });
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

test('⭐ 午夜截止顯示成前一天（不然家長以為當天還能報）@register', async ({ page }) => {
  // 規章原文是「9 月 13 日晚上 12 點截止」，系統存的是 9/14 00:00。
  // 直接印「9/14（週一）」，家長會在 9/14 早上才發現送不出去。
  const s = base();
  s['config/registration'] = {
    open: true, opensAt: Date.now() - DAY,
    closesAt: Date.parse('2026-09-14T00:00:00+08:00'), maxTeamsPerAccount: 3
  };
  await stub(page, s, { uid: CAP, displayName: '隊長' });
  await go(page, '/#/register');

  await expect(page.locator('.reg')).toContainText('9/13');
  await expect(page.locator('.reg')).toContainText('當天結束');
  await expect(page.locator('.reg')).not.toContainText('9/14');
});

test('⭐ 流程說明分成學童組與成人組兩條路 @register @youth', async ({ page }) => {
  // 講成一條的話，有一半的人會照著做卻做不到——學童組根本沒有邀請碼。
  await stub(page, base(), { uid: CAP, displayName: '隊長' });
  await go(page, '/#/register');

  const card = page.locator('.reg__card', { hasText: '報名怎麼進行' });
  await expect(card.locator('.reg__flow')).toHaveCount(2);
  await expect(card).toContainText('自己新增小球員');
  await expect(card).toContainText('出生年月日（民國年）');
  await expect(card).toContainText('把邀請碼給隊友');
  // 檢錄要講在報名頁上，不是等到比賽當天才知道要帶證件
  await expect(card).toContainText('帶證件');
});

test('⭐ 組別同時顯示 U 制與規章名稱 @register', async ({ page }) => {
  // 報名表印的是「學童中年級」，畫面只寫「U10兒童組」的話，
  // 家長會問「我到底要報哪一組」——那是報名期間最常見的詢問。
  await stub(page, base(), { uid: CAP, displayName: '隊長' });
  await go(page, '/#/register');

  const row = page.locator('.reg__div', { hasText: 'U10兒童組' });
  await expect(row).toContainText('U10兒童組');
  await expect(row).toContainText('學童中年級');
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
  // 邀請碼＋逐筆同意是**成人組**的流程。學童三組改由教練直接建名單，
  // 這一頁不會有「待你同意」（見下方「學童組」那一節）。
  await stub(page, base({ teamOver: { divisionId: 'adult-open' }, members: member('m-1') }),
    { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  await expect(page.locator('.reg')).toContainText('待你同意（1）');
  await page.getByRole('button', { name: /^同意$/ }).click();

  await expect.poll(async () => {
    const d = await dump(page);
    return d[`events/${EVENT}/teams/${TEAM}/members/m-1`]?.status;
  }, { timeout: 10_000 }).toBe('approved');
});

test('⭐ 名單凍結後不能再決定申請（驗收 A04）@register', async ({ page }) => {
  await stub(page, base({ teamOver: { divisionId: 'adult-open', status: 'submitted' }, members: member('m-1') }),
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
  await stub(page, base({ teamOver: { divisionId: 'adult-open' } }), { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);
  await expect(page.locator('.reg__codeValue')).toHaveText(CODE);
  await expect(page.getByRole('button', { name: /複製邀請連結/ })).toBeVisible();
});

/* ══════════════════════════════════════════════════════════════
   學童組：教練直接管理名單（主辦 2026-09-03 指定）
   ══════════════════════════════════════════════════════════════ */

/** 名單裡第一筆 member 文件（沒有就 null） */
async function firstMember(page) {
  const d = await dump(page);
  const hit = Object.entries(d).find(([k]) => k.includes('/members/'));
  return hit ? hit[1] : null;
}

/** 填一位小球員並送出 */
async function fillPlayer(page, { name = '小豆子', y = '106', m = '3', d = '5', id4 = '1234', no = '9' } = {}) {
  await page.getByRole('button', { name: /新增一位球員/ }).click();
  await page.locator('#m-name').fill(name);
  await page.locator('#m-birth').fill(y);
  await page.locator('#m-birth-m').fill(m);
  await page.locator('#m-birth-d').fill(d);
  if (id4) await page.locator('#m-id4').fill(id4);
  if (no) await page.locator('#m-no').fill(no);
  await page.getByRole('button', { name: /加入名單/ }).click();
}

test('⭐ 學童組不發邀請碼，改由教練直接新增 @register @youth', async ({ page }) => {
  // 小球員沒有 LINE 帳號，家長也不見得會操作。留一組沒有人用得到的
  // 邀請碼，只會讓教練一直等隊友來申請。
  await stub(page, base(), { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  await expect(page.getByRole('button', { name: /新增一位球員/ })).toBeVisible();
  await expect(page.locator('.reg')).not.toContainText('邀請隊友');
  await expect(page.locator('.reg')).not.toContainText('待你同意');
});

test('⭐ 成人組維持邀請碼流程 @register @youth', async ({ page }) => {
  await stub(page, base({ teamOver: { divisionId: 'adult-open' } }), { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  await expect(page.locator('.reg')).toContainText('邀請隊友');
  await expect(page.getByRole('button', { name: /新增一位球員/ })).toHaveCount(0);
});

test('⭐ 新增的小球員直接進名單，而且民國年被轉成西元 @register @youth', async ({ page }) => {
  await stub(page, base(), { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  await fillPlayer(page, { y: '106', m: '3', d: '5' });

  await expect.poll(async () => (await firstMember(page))?.birthDate ?? null,
    { timeout: 10_000 }).toBe('2017-03-05');   // 民國 106 = 西元 2017，差 1911 年

  const row = await firstMember(page);
  expect(row.name).toBe('小豆子');
  expect(row.idLast4).toBe('1234');
  expect(row.nameKind).toBe('nickname');
  // 隊長本來就是那個閘門，不必再自己同意一次
  expect(row.status).toBe('approved');
  expect(row.source).toBe('coach');
  // 帶了 guardianUid 的話那位家長就能改這一筆（rules R68）
  expect(row.guardianUid).toBeNull();
});

test('⭐ 超齡的孩子當場被擋，而且說得出門檻是哪一天 @register @youth', async ({ page }) => {
  // 規章第十八條第 3 款：冒名頂替停止**整隊**資格。
  // 超齡多半不是故意的，在報名當下擋掉比在比賽當天被檢錄員抓到好得多。
  await stub(page, base(), { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  // 學童中年級限 2016-09-01（民國 105/9/1）以後出生
  await fillPlayer(page, { y: '105', m: '8', d: '31' });

  await expect(page.locator('.reg__hint--err')).toContainText('民國 105 年 9 月 1 日');
  expect(await firstMember(page)).toBeNull();
});

test('門檻當天出生可以報（規章的「以後」含當日）@register @youth', async ({ page }) => {
  await stub(page, base(), { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  await fillPlayer(page, { y: '105', m: '9', d: '1' });

  await expect.poll(async () => (await firstMember(page))?.birthDate ?? null,
    { timeout: 10_000 }).toBe('2016-09-01');
});

test('⭐ 身分證後四碼沒填就不能送（檢錄唯一能核對的東西）@register @youth', async ({ page }) => {
  await stub(page, base(), { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  await fillPlayer(page, { id4: '', no: '' });

  await expect(page.locator('.reg__hint--err')).toContainText('後四碼');
  expect(await firstMember(page)).toBeNull();
});

test('名單上用民國年與後四碼顯示（檢錄拿證件對的就是這兩個）@register @youth', async ({ page }) => {
  await stub(page, base({
    members: member('m-1', {
      status: 'approved', source: 'coach', name: '小豆子', nameKind: 'nickname',
      birthDate: '2017-03-05', idLast4: '1234', guardianUid: null
    })
  }), { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  const row = page.locator('.reg__member').first();
  await expect(row).toContainText('106/03/05');
  await expect(row).toContainText('末四碼 1234');
});

test('⭐ 教練改得動自己填的，改不動家長送來的 @register @youth', async ({ page }) => {
  await stub(page, base({
    members: {
      ...member('m-coach', {
        status: 'approved', source: 'coach', name: '小豆子', nameKind: 'nickname', guardianUid: null
      }),
      ...member('m-parent', { status: 'approved', source: 'guardian', name: '王小明' })
    }
  }), { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  // 兩筆都在名單上，但只有教練自己填的那筆有「修改」
  await expect(page.locator('.reg__member')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^修改$/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^移除$/ })).toHaveCount(2);
});

test('⭐ 名單凍結後不能再增減 @register @youth', async ({ page }) => {
  await stub(page, base({ teamOver: { status: 'submitted' } }), { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  await expect(page.locator('.reg')).toContainText('名單已經送審凍結');
  await expect(page.getByRole('button', { name: /新增一位球員/ })).toHaveCount(0);
});

test('名單上看得到規章的人數上限 @register @youth', async ({ page }) => {
  await stub(page, base(), { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);
  await expect(page.locator('.reg')).toContainText('球員 0 / 15');
  await expect(page.locator('.reg')).toContainText('隊職員 0 / 3');
});

test('隊職員不必填生日與後四碼（他們不上場）@register @youth', async ({ page }) => {
  await stub(page, base(), { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);

  await page.getByRole('button', { name: /新增一位球員/ }).click();
  await page.locator('#m-kind').selectOption('coach');
  await page.locator('#m-name').fill('林教練');
  await expect(page.locator('#m-birth')).toHaveCount(0);
  await expect(page.locator('#m-id4')).toHaveCount(0);
  await page.getByRole('button', { name: /加入名單/ }).click();

  await expect.poll(async () => (await firstMember(page))?.kind ?? null,
    { timeout: 10_000 }).toBe('coach');
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

// ── 配戴眼鏡上場（規章附件二）────────────────────────────
test('⭐ 配戴眼鏡要先同意切結書才送得出去，而且存下同意的證據 @register @glasses', async ({ page }) => {
  await stub(page, base(), { uid: PARENT, displayName: '家長' });
  await go(page, `/#/join/${CODE}`);
  await page.getByLabel(/球員姓名/).fill('王小明');
  await page.locator('#m-glasses').check();
  await expect(page.locator('#m-glasses-box')).toContainText('切結書');
  await expect(page.getByRole('button', { name: /送出加入申請/ })).toBeDisabled();
  await page.locator('#m-glasses-consent').check();
  await page.getByRole('button', { name: /送出加入申請/ }).click();
  await expect(page.locator('.reg')).toContainText('申請已送出');
  const m = Object.entries(await dump(page)).find(([p]) => p.includes(`/teams/${TEAM}/members/`))?.[1];
  expect(m.glasses).toBe(true);
  expect(m.glassesWaiver).toMatchObject({ signed: true, byUid: PARENT, by: 'guardian' });
});

test('沒戴眼鏡就不必同意切結書，文件上是 false／null @register @glasses', async ({ page }) => {
  await stub(page, base(), { uid: PARENT, displayName: '家長' });
  await go(page, `/#/join/${CODE}`);
  await page.getByLabel(/球員姓名/).fill('王小明');
  await expect(page.locator('#m-glasses-box')).toHaveCount(0);
  await page.getByRole('button', { name: /送出加入申請/ }).click();
  await expect(page.locator('.reg')).toContainText('申請已送出');
  const m = Object.entries(await dump(page)).find(([p]) => p.includes(`/teams/${TEAM}/members/`))?.[1];
  expect(m.glasses).toBe(false);
  expect(m.glassesWaiver).toBeNull();
});

test('切結書全文頁免登入、可列印 @register @glasses', async ({ page }) => {
  await stub(page, base());
  await go(page, '/#/register/waiver');
  await expect(page.locator('.reg__waiver')).toContainText('球員配戴眼鏡上場安全切結書');
  await expect(page.locator('.reg__waiver')).toContainText('運動專用安全防護眼鏡');
  await expect(page.locator('#waiver-print')).toBeVisible();
});

// ── 取消報名（規章第二十七條）────────────────────────────
test('⭐ 已核准的球隊：隊長可以申請取消，狀態留給主辦改 @register @refund', async ({ page }) => {
  await stub(page, base({ teamOver: { status: 'approved', rosterLocked: true }, members: member('m-1', { status: 'approved' }) }),
    { uid: CAP, displayName: '隊長' });
  await go(page, `/#/team/${TEAM}/manage`);
  await expect(page.locator('.reg')).toContainText('要取消報名');
  page.once('dialog', d => d.accept('球員受傷太多'));
  await page.locator('#team-cancel').click();
  await expect.poll(async () => (await dump(page))[`events/${EVENT}/teams/${TEAM}`]?.cancelRequest?.status, { timeout: 10_000 })
    .toBe('requested');
  const t = (await dump(page))[`events/${EVENT}/teams/${TEAM}`];
  expect(t.status).toBe('approved');
  expect(t.cancelRequest.reason).toBe('球員受傷太多');
  await expect(page.locator('#team-cancel-pending')).toContainText('等主辦處理');
});

/* ══════════════════════════════════════════════════════════════
   報名圖文教學（入口頁的彈窗，2026-09-06）
   ══════════════════════════════════════════════════════════════ */

test('⭐ 第一次進報名頁會自動跳出圖文教學；關掉之後不再自動跳 @register @guide', async ({ page }) => {
  await stub(page, base(), null, { freshGuide: true });
  await go(page, '/#/register');
  await expect(page.locator('.tut')).toBeVisible();
  await expect(page.locator('.tut__count')).toHaveText('1 / 9');
  await page.locator('.tut__close').click();
  await expect(page.locator('.tut')).toHaveCount(0);

  await page.goto('/#/');
  await expect(page.locator('.pub')).toBeVisible();
  await page.goto('/#/register');
  await expect(page.locator('.reg__hero')).toBeVisible();
  await expect(page.locator('#reg-guide')).toBeVisible();
  await expect(page.locator('.tut')).toHaveCount(0);
});

test('報名關閉時不自動跳教學（現在報不了，教了也沒用）@register @guide', async ({ page }) => {
  await stub(page, base({ open: false }), null, { freshGuide: true });
  await go(page, '/#/register');
  await expect(page.locator('.reg__box--warn')).toBeVisible();
  await expect(page.locator('.tut')).toHaveCount(0);
});

test('⭐ 圖文教學：兩條流程、逐步切換、每一張圖都載得出來、每一步都有標記 @register @guide', async ({ page }) => {
  await stub(page, base());
  await go(page, '/#/register');
  await expect(page.locator('.reg__hero')).toBeVisible();
  await expect(page.locator('.tut')).toHaveCount(0);            // 看過了就不自動跳
  await page.locator('#reg-guide').click();
  await expect(page.locator('.tut')).toBeVisible();

  for (const flow of ['adult', 'youth']) {
    await page.locator(`.tut__tab[data-flow="${flow}"]`).click();
    await expect(page.locator('.tut__tab.is-on')).toHaveAttribute('data-flow', flow);
    for (let i = 1; i <= 9; i++) {
      await expect(page.locator('.tut__count')).toHaveText(`${i} / 9`);
      // 圖真的載得出來（少一張圖不會有錯誤訊息，只是一個空框）
      await expect.poll(() => page.locator('.tut__img').evaluate(img => img.complete ? img.naturalWidth : 0),
        { timeout: 15_000 }).toBe(780);
      await expect(page.locator('.tut__mark').first()).toBeAttached();
      await expect(page.locator('.tut__stepTitle')).not.toBeEmpty();
      if (i < 9) await page.locator('[data-act="next"]').click();
    }
    await expect(page.locator('[data-act="start"]')).toBeVisible();
  }

  await page.keyboard.press('Escape');
  await expect(page.locator('.tut')).toHaveCount(0);
});

test('教學最後一步的「我要建立球隊」：沒登入會先帶去登入 @register @guide', async ({ page }) => {
  await stub(page, base());
  await go(page, '/#/register?guide=1');
  await expect(page.locator('.tut')).toBeVisible();
  for (let i = 0; i < 8; i++) await page.locator('[data-act="next"]').click();
  await page.locator('[data-act="start"]').click();
  await expect(page).toHaveURL(/login/);
  await expect(page.locator('.tut')).toHaveCount(0);
});

test('?guide=youth 直接打開學童組（給主辦貼在 LINE 群組的連結用），看過也照樣跳 @register @guide @youth', async ({ page }) => {
  await stub(page, base());
  await go(page, '/#/register?guide=youth');
  await expect(page.locator('.tut')).toBeVisible();
  await expect(page.locator('.tut__tab.is-on')).toContainText('學童組');
  await expect(page.locator('.tut__stepTitle')).toContainText('我要建立球隊');
  await page.locator('[data-act="next"]').click();
  await expect(page.locator('.tut__stepTitle')).toContainText('學童組');
});

test('步驟卡底下的兩顆按鈕各開各的流程 @register @guide', async ({ page }) => {
  await stub(page, base());
  await go(page, '/#/register');
  await page.locator('[data-guide="youth"]').click();
  await expect(page.locator('.tut__tab.is-on')).toContainText('學童組');
  await page.locator('.tut__close').click();
  await page.locator('[data-guide="adult"]').click();
  await expect(page.locator('.tut__tab.is-on')).toContainText('成人組');
});

test('⭐ 320px 的教學彈窗不出現橫向捲軸，下一步在畫面裡按得到 @register @guide @narrow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await stub(page, base());
  await go(page, '/#/register?guide=1');
  await expect(page.locator('.tut')).toBeVisible();
  const over = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth <= d.clientWidth ? null : d.scrollWidth;
  });
  expect(over).toBeNull();
  await expect(page.locator('[data-act="next"]')).toBeInViewport();
  await page.locator('[data-act="next"]').click();
  await expect(page.locator('.tut__count')).toHaveText('2 / 9');
});

test('換頁時教學彈窗跟著收掉（不會留在別的頁面上）@register @guide', async ({ page }) => {
  await stub(page, base());
  await go(page, '/#/register?guide=1');
  await expect(page.locator('.tut')).toBeVisible();
  await page.goto('/#/');
  await expect(page.locator('.pub')).toBeVisible();
  await expect(page.locator('.tut')).toHaveCount(0);
});
