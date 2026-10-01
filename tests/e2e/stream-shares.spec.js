import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const fake = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const EVENT = 'feda-cup-2026', MATCH = 'stream-match', UID = 'line-viewer';
const base = `events/${EVENT}/matches/${MATCH}`;
async function setup(page, { loggedIn = true, count = 0, role = null, provider = 'custom', own = false, theme = 'light' } = {}) {
  const seed = {
    'config/env': { env: 'demo' }, [`users/${UID}`]: { uid: UID, displayName: 'LINE 球迷' },
    [`events/${EVENT}`]: { name: 'FEDA CUP' },
    [`events/${EVENT}/divisions/adult-open`]: { name: '公開組', matchDurationMin: 30 },
    [base]: { matchId: MATCH, label: '第 1 場', divisionId: 'adult-open', venueId: 'A', date: '2026-10-09',
      kickoffAt: '2026-10-09T09:00:00+08:00', status: 'scheduled', home: { name: '藍隊' }, away: { name: '紅隊' } }
  };
  if (role) seed[`staff/${UID}`] = { uid: UID, active: true, roles: [role], assignment: { eventId: EVENT } };
  for (let i = 0; i < count; i++) {
    seed[`${base}/streamShares/share-${i}`] = { shareId: `share-${i}`, displayName: i ? `球迷 ${i + 1}` : '小麥', videoId: 'dQw4w9WgXcQ', createdAt: i + 1 };
    seed[`${base}/streamShareOwners/share-${i}`] = { ownerUid: own && i === 0 ? UID : `other-${i}` };
  }
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ contentType: 'text/javascript', body: fake }));
  await page.route('https://firestore.googleapis.com/**', route => route.fulfill({ headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.route('https://www.youtube-nocookie.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html>測試播放器</html>' }));
  await page.addInitScript(({ seed, uid, loggedIn, provider, theme }) => {
    window.__FAKE_SEED = seed;
    window.__FAKE_USER = loggedIn ? { uid, displayName: 'LINE 球迷', provider, isAnonymous: provider === 'anonymous' } : null;
    localStorage.setItem('feda_theme', theme);
  }, { seed, uid: UID, loggedIn, provider, theme });
  await page.goto(`/#/match/${MATCH}`);
  await expect(page.locator('.pshares')).toBeVisible();
  await expect(page.locator('.pshares__head button')).toBeEnabled();
}
const calls = page => page.evaluate(() => (window.__FAKE_CALLS || []).filter(call => call.name === 'shareMatchStream'));
const shares = page => page.evaluate(base => Object.entries(window.__fake.__dump()).filter(([path]) => path.startsWith(base + '/streamShares/')), base);

test('訪客看到名稱及最大 YT 按鈕，點擊才載入，比分更新不打斷播放器 @streamShares', async ({ page }) => {
  await setup(page, { loggedIn: false, count: 1 });
  await expect(page.locator('.pshares__grid')).toHaveAttribute('data-density', 'solo');
  await expect(page.locator('.pshares__name')).toHaveText('小麥');
  expect(await page.locator('.pshares__yt').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(64);
  await expect(page.locator('.pshares iframe')).toHaveCount(0);
  await expect(page.locator('.pshares__remove')).toHaveCount(0);
  await page.getByRole('button', { name: '觀看 小麥 分享的直播', exact: true }).click();
  const frame = page.locator('.pshares iframe');
  await expect(frame).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  await frame.evaluate(el => { el.dataset.marker = 'original'; });
  await page.evaluate(async base => {
    const { sdk, db } = await import('/js/core/firebase.js');
    await sdk().updateDoc(sdk().doc(db(), base), { status: 'live', score: { home: 1, away: 0 } });
  }, base);
  await expect(page.locator('#psb-home')).toHaveText('1');
  await expect(frame).toHaveAttribute('data-marker', 'original');
  await expect(page.getByRole('link', { name: '在 YouTube 開啟' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.getByRole('button', { name: '關閉直播播放器' }).click();
  await expect(frame).toHaveCount(0);
});

test('LINE 一般用戶貼上有效連結後新增分享，無效網址不送出 @streamShares', async ({ page }) => {
  await setup(page, { count: 4 });
  await page.getByRole('button', { name: '分享直播', exact: true }).click();
  await page.getByLabel('YouTube 直播連結', { exact: true }).fill('https://youtube.com.evil.test/live/dQw4w9WgXcQ');
  await page.getByRole('button', { name: '分享這場直播', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '請貼上有效' })).toBeVisible();
  expect(await calls(page)).toHaveLength(0);
  await page.getByLabel('YouTube 直播連結', { exact: true }).fill('https://youtube.com/live/M7lc1UVf-VE');
  await page.getByRole('button', { name: '分享這場直播', exact: true }).click();
  await expect(page.locator('.pshares__message')).toHaveText('直播分享已儲存。');
  expect(await shares(page)).toHaveLength(5);
  const sent = (await calls(page))[0].payload;
  expect(sent).toMatchObject({ eventId: EVENT, matchId: MATCH, action: 'share', url: 'https://youtube.com/live/M7lc1UVf-VE' });
  expect(sent).not.toHaveProperty('ownerUid'); expect(sent).not.toHaveProperty('displayName');
  await expect(page.locator('.pshares__grid')).toHaveAttribute('data-density', 'compact');
  await expect(page.locator('.pshares__remove')).toHaveCount(1);
});

test('本人可移除自己的分享，其他分享沒有移除入口 @streamShares', async ({ page }) => {
  await setup(page, { count: 2, own: true });
  await expect(page.locator('.pshares__remove')).toHaveCount(1);
  await page.getByRole('button', { name: '移除 小麥 的直播分享', exact: true }).click();
  await page.getByRole('button', { name: '移除分享', exact: true }).click();
  await expect(page.locator('.pshares__message')).toHaveText('直播分享已移除。');
  expect(await shares(page)).toHaveLength(1);
  expect((await calls(page))[0].payload).toMatchObject({ action: 'remove', shareId: 'share-0' });
  await expect(page.locator('.pshares__grid')).toHaveAttribute('data-density', 'solo');
});

for (const role of ['admin', 'super_admin']) test(`管理員以上可移除他人分享：${role} @streamShares`, async ({ page }) => {
  await setup(page, { count: 2, role, provider: 'anonymous' });
  await expect(page.locator('.pshares__remove')).toHaveCount(2);
  await page.getByRole('button', { name: '移除 球迷 2 的直播分享', exact: true }).click();
  await page.getByRole('button', { name: '移除分享', exact: true }).click();
  await expect(page.locator('.pshares__message')).toHaveText('直播分享已移除。');
});

test('低階角色與非 LINE 登入不能冒用分享或管理入口 @streamShares', async ({ page }) => {
  await setup(page, { count: 2, role: 'booth', provider: 'anonymous' });
  await page.route('https://static.line-scdn.net/**', route => route.fulfill({ contentType: 'text/javascript', body:
    'window.liff={init:async()=>{},isInClient:()=>false,isLoggedIn:()=>false,login:()=>{window.__liffLoginCalled=true;}};' }));
  await expect(page.getByRole('button', { name: 'LINE 登入分享', exact: true })).toBeVisible();
  await expect(page.locator('.pshares__remove')).toHaveCount(0);
  await page.getByRole('button', { name: 'LINE 登入分享', exact: true }).click();
  await expect(page).toHaveURL(/login\?next=%2Fmatch%2Fstream-match/);
  await expect(page.getByRole('button', { name: '使用 LINE 登入', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '使用 LINE 登入', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__liffLoginCalled === true)).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem('feda:loginNext'))).toBe('/match/stream-match');
});

test('分享越多按鈕越密集，仍可點擊，支援深色、分頁與不可信名稱 @streamShares', async ({ page }, info) => {
  await setup(page, { count: 27, loggedIn: false, theme: 'dark' });
  await expect(page.locator('.pshares__item')).toHaveCount(24);
  await expect(page.locator('.pshares__grid')).toHaveAttribute('data-density', 'compact');
  const height = await page.locator('.pshares__yt').first().evaluate(el => el.getBoundingClientRect().height);
  expect(height).toBeGreaterThanOrEqual(44); expect(height).toBeLessThan(64);
  await page.getByRole('button', { name: '顯示更多直播', exact: true }).click();
  await expect(page.locator('.pshares__item')).toHaveCount(27);
  await page.evaluate(base => window.__fake.__seed({ [`${base}/streamShares/share-0`]: {
    shareId: 'share-0', displayName: '<img src=x onerror=alert(1)>', videoId: 'dQw4w9WgXcQ', createdAt: 1
  } }), base);
  await expect(page.locator('.pshares__name').first()).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.pshares img')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.pshares').screenshot({ path: info.outputPath('many-shares-dark.png') });
});

test('失敗不宣告成功、重試沿用操作代碼，離線禁止送出 @streamShares', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '分享直播', exact: true }).click();
  await page.getByLabel('YouTube 直播連結', { exact: true }).fill('https://youtu.be/M7lc1UVf-VE');
  await page.evaluate(() => { window.__FAKE_CALL_ERROR = '網路送出失敗'; });
  await page.getByRole('button', { name: '分享這場直播', exact: true }).click();
  await expect(page.locator('.pshares__message')).toHaveText('網路送出失敗');
  expect(await shares(page)).toHaveLength(0);
  await page.evaluate(() => { delete window.__FAKE_CALL_ERROR; });
  await page.getByRole('button', { name: '分享這場直播', exact: true }).click();
  await expect(page.locator('.pshares__message')).toHaveText('直播分享已儲存。');
  const sent = await calls(page); expect(sent[0].payload.operationId).toBe(sent[1].payload.operationId);
  await page.getByRole('button', { name: '分享直播', exact: true }).click();
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); window.dispatchEvent(new Event('offline')); });
  await expect(page.getByRole('button', { name: '分享這場直播', exact: true })).toBeDisabled();
  await expect(page.locator('.pshares__remove')).toBeDisabled();
});
