import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const E = 'feda-cup-2026', UID = 'layout-admin', TEAM = 'layout-team', MATCH = 'layout-match';
const LONG_NAME = '飛達跨盃測試球員暱稱'.repeat(3);
const LONG_TEAM = '飛達跨盃足球社團代表隊'.repeat(3);
const widths = [320, 360, 390, 430];

async function stub(page, { roles = ['admin'], theme = 'light', names = [LONG_NAME, '球員2', '球員3'] } = {}) {
  const root = `events/${E}`;
  const seed = {
    'config/env': { env: 'demo' }, 'config/registration': { open: false, hidden: true },
    [`staff/${UID}`]: { active: true, roles, assignment: { venueIds: ['venue-a'] } },
    [`users/${UID}`]: { displayName: LONG_NAME }, [root]: { dates: ['2026-10-09'] },
    [`${root}/divisions/u10`]: { divisionId: 'u10', name: 'U10兒童組', playersOnField: 5, matchDurationMin: 25, eligibility: { bornOnOrAfter: '2016-09-01' }, date: '2026-10-09' },
    [`${root}/teams/${TEAM}`]: { teamId: TEAM, name: LONG_TEAM, divisionId: 'u10', source: 'csv', status: 'approved', publicRoster: true, memberCount: 3, captainUid: UID },
    [`${root}/teams/away`]: { teamId: 'away', name: '客隊', divisionId: 'u10', status: 'approved' },
    [`${root}/matches/${MATCH}`]: { matchId: MATCH, eventId: E, divisionId: 'u10', venueId: 'venue-a', date: '2026-10-09', kickoffAt: '2026-10-09T08:30:00+08:00', label: '窄螢幕驗收場次', home: { teamId: TEAM, name: LONG_TEAM }, away: { teamId: 'away', name: '客隊' }, teamIds: [TEAM, 'away'], status: 'scheduled', score: { home: 0, away: 0 }, clock: {}, lock: { locked: false }, checkin: {} }
  };
  for (let i = 1; i <= names.length; i++) {
    seed[`${root}/teams/${TEAM}/members/m${i}`] = { memberId: `m${i}`, name: names[i - 1], nameKind: 'nickname', kind: 'player', status: 'approved', source: 'csv', jerseyNo: 88 + i, birthDate: i === 2 ? '' : '2017-01-12', idLast4: i === 3 ? '' : '0012', identityComplete: i !== 2 && i !== 3 };
    seed[`${root}/teams/${TEAM}/roster/m${i}`] = { memberId: `m${i}`, teamId: TEAM, divisionId: 'u10', displayName: i === 1 ? LONG_NAME : `球員${i}`, jerseyNo: 88 + i, role: 'player', position: 'MF', isCaptain: i === 1, stats: { goals: 12 } };
  }
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());
  await page.addInitScript(({ seed, uid, theme }) => {
    window.__FAKE_USER = { uid }; window.__FAKE_SEED = seed;
    localStorage.setItem('feda_theme', theme);
  }, { seed, uid: UID, theme });
}

async function readable(page, selector) {
  const problems = await page.locator(selector).evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).flatMap(n => {
    const box = n.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(n);
    const text = range.getBoundingClientRect();
    return n.scrollWidth > n.clientWidth + 1 || text.left < box.left - 1 || text.right > box.right + 1 || text.bottom > box.bottom + 1
      ? [n.textContent] : [];
  }));
  expect(problems, `文字不得被截斷或溢出：${selector}`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function rosterGeometry(page) {
  return page.locator('.adm__member').evaluateAll(rows => rows.map(row => {
    const rect = node => { const b = node.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
    const style = getComputedStyle(row), number = rect(row.querySelector('.adm__no')),
      name = rect(row.querySelector('.adm__memberName')), edit = rect(row.querySelector('button')),
      meta = rect(row.querySelector('.adm__memberMeta')), box = rect(row);
    const contentWidth = box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
    const expectedNameWidth = contentWidth - number.width - edit.width - 2 * parseFloat(style.columnGap);
    const upperBottom = Math.max(number.bottom, name.bottom, edit.bottom);
    const problems = [];
    if (name.width < expectedNameWidth - 1) problems.push('name-width: 姓名應取得扣除背號、44px 按鈕及間距後的上排可用寬度');
    if (meta.top < upperBottom + parseFloat(style.rowGap) - 1) problems.push('verification-below-upper-row: 核對資料應在完整上排下方');
    if (name.right > edit.left + 1 || number.right > name.left + 1) problems.push('upper-row-overlap');
    return { text: row.textContent, box, number, name, edit, meta, contentWidth, expectedNameWidth, upperBottom,
      font: getComputedStyle(row.querySelector('.adm__memberName')).font,
      display: style.display, gap: style.gap, problems };
  }));
}

for (const theme of ['light', 'dark']) test(`名冊完整姓名、完整核對欄位及 SVG 編輯鈕：${theme} @mobileaudit`, async ({ page }) => {
  const names = [LONG_NAME, '王', '踢球的小麥', '陳志偉', '超長Nickname足球名冊'.repeat(6)];
  await stub(page, { theme, names });
  await page.goto('/#/admin/teams');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.getByRole('tab', { name: /已通過/ }).click();
  await page.locator('.adm__itemHead').filter({ hasText: LONG_TEAM }).click();
  await expect(page.locator('.adm__member')).toHaveCount(names.length);
  await expect(page.locator('.adm__member').nth(1)).toContainText('生日待補');
  await expect(page.locator('.adm__member').nth(2)).toContainText('末四碼待補');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => document.fonts.ready);
    const info = test.info();
    const geometry = await rosterGeometry(page);
    const fonts = await page.evaluate(() => ({ ready: document.fonts.status,
      faces: [...document.fonts].map(f => ({ family: f.family, status: f.status })), userAgent: navigator.userAgent }));
    await info.attach(`roster-${theme}-${width}-geometry`, { body: JSON.stringify({ geometry, fonts,
      browserVersion: page.context().browser().version(), playwright: JSON.parse(fs.readFileSync('node_modules/@playwright/test/package.json', 'utf8')).version }), contentType: 'application/json' });
    await info.attach(`roster-${theme}-${width}`, { body: await page.locator('.adm__roster').screenshot(), contentType: 'image/png' });
    await expect.poll(async () => (await rosterGeometry(page)).flatMap(r => r.problems.map(p => `${r.text}: ${p}`)), {
      message: '[M:E55] 名稱寬度與核對資料下一排的幾何驗收'
    }).toEqual([]);
    for (const [i, name] of names.entries()) await expect(page.locator('.adm__memberName').nth(i)).toHaveText(name);
    await readable(page, '.adm__memberName, .adm__teamName, .adm__memberField');
    const buttons = page.locator('.adm__memberEdit');
    for (const button of await buttons.all()) {
      await expect(button.locator('svg'), '[M:E56] 編輯按鈕必須保留 SVG 圖示').toHaveCount(1);
      await expect(button, '[M:E56] 圖示按鈕不得退回文字').toHaveText('');
      const box = await button.boundingBox(); expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const overlaps = await page.locator('.adm__member').evaluateAll(rows => rows.some(r => r.querySelector('.adm__memberName').getBoundingClientRect().right > r.querySelector('button').getBoundingClientRect().left));
    expect(overlaps, '[M:E55] 姓名不得與按鈕重疊').toBe(false);
  }
  await page.locator('.adm__memberEdit').nth(1).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('出生民國年', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.adm__memberEdit').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('出生民國年', { exact: true })).toHaveValue('106');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('.adm__roster').screenshot({ path: `tools/mobile-roster-${theme}-${test.info().project.name}.png` });
});

test('檢錄姓名、生日與末四碼完整，操作按鈕不擠壓資料 @mobileaudit', async ({ page }) => {
  await stub(page); await page.goto(`/#/staff/checkin/${MATCH}`);
  await expect(page.locator('.chk__row')).toHaveCount(3);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await readable(page, '.chk__name, .chk__tabName, .chk__verifyField');
    const splitFields = await page.locator('.chk__verifyField').evaluateAll(nodes => nodes.some(n => n.getBoundingClientRect().height > 30));
    expect(splitFields).toBe(false);
    await expect(page.locator('.chk__row').first().getByRole('button', { name: '有問題', exact: true })).toBeVisible();
  }
});

for (const readOnly of [false, true]) test(`出場名單長姓名與先發替補狀態皆可讀：${readOnly ? '唯讀' : '可編輯'} @mobileaudit`, async ({ page }) => {
  await stub(page, { roles: readOnly ? ['checkin'] : ['admin'] }); await page.goto(`/#/staff/sheet/${MATCH}`);
  await expect(page.locator('.roster__row')).toHaveCount(3);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await readable(page, '.roster__name, .tabs__btn');
    if (readOnly) await expect(page.locator('.roster__role').first()).toBeVisible();
    else await expect(page.locator('.roster__btns').first()).toBeVisible();
  }
});

test('公開名冊長暱稱、隊長標示及進球數在 320px 仍可讀 @mobileaudit', async ({ page }) => {
  await stub(page); await page.goto(`/#/team/${TEAM}`);
  await expect(page.locator('.proster__row')).toHaveCount(3);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await readable(page, '.proster__name');
    await expect(page.locator('.proster__tag').first()).toBeVisible();
    await expect(page.locator('.proster__goals').first()).toBeVisible();
  }
});

test('我的頁面完整顯示長名稱與球隊名称 @mobileaudit', async ({ page }) => {
  await stub(page); await page.goto('/#/my');
  await expect(page.locator('.acct__meText strong')).toContainText(LONG_NAME);
  await expect(page.locator('.acct__rowMain').filter({ hasText: LONG_TEAM })).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await readable(page, '.acct__meText strong, .acct__rowMain');
  }
});
