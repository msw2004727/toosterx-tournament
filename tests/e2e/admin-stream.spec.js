/**
 * E2E｜直播設定 `#/admin/stream`（docs/03 §5）
 * ------------------------------------------------------------------
 * 守三件事：
 *   ・貼整串網址也會被抽成影片 ID（存整串網址進去 embed 會壞而且不報錯）
 *   ・認不出來的不存，錯誤留在畫面上
 *   ・整包 stream 寫回，而且留痕
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'U7774e1410479bafff4997f51b2c47b95';
const ID = 'dQw4w9WgXcQ';

const seed = ({ roles = ['admin'] } = {}) => ({
  [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
  'config/env': { env: 'demo' },
  [`users/${UID}`]: { uid: UID, displayName: '金小麥' },
  [`staff/${UID}`]: {
    uid: UID, name: '金小麥', roles, active: true,
    assignment: { eventId: EVENT, venueIds: [], divisionIds: [], challengeIds: [] }
  },
  [`events/${EVENT}/venues/venue-a`]: {
    venueId: 'venue-a', name: 'A場', order: 1,
    stream: { enabled: false, provider: 'youtube', channelId: null, videoId: null, status: 'off' }
  },
  [`events/${EVENT}/venues/venue-b`]: {
    venueId: 'venue-b', name: 'B場', order: 2,
    stream: { enabled: true, provider: 'youtube', channelId: null, videoId: 'abcdefghijk', status: 'live' }
  }
});

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
  await page.goto('/#/admin/stream');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}
const dump = page => page.evaluate(() => window.__fake.__dump());
const venueOf = async (page, id) => (await dump(page))[`events/${EVENT}/venues/${id}`];
const card = (page, id) => page.locator(`.adm__stream[data-venue="${id}"]`);

test('⭐ 沒有 stream.manage 權限的人看得到原因 @admin @stream', async ({ page }) => {
  await stub(page, { roles: ['scorer'] });
  await go(page);
  await expect(page.locator('.adm__box--warn')).toContainText('直播設定');
});

test('⭐ 每個場地一張卡，目前的狀態與影片 ID 印出來 @admin @stream', async ({ page }) => {
  await stub(page);
  await go(page);
  await expect(card(page, 'venue-a')).toContainText('關閉');
  await expect(card(page, 'venue-b')).toContainText('直播中');
  await expect(card(page, 'venue-b').locator('input').first()).toHaveValue('abcdefghijk');
});

test('⭐ 貼整串網址會被抽成影片 ID，存進去的是 ID 不是網址，而且留痕 @admin @stream', async ({ page }) => {
  await stub(page);
  await go(page);
  const c = card(page, 'venue-a');
  await c.locator(`#st-video-venue-a`).fill(`https://youtu.be/${ID}?si=xyz`);
  await c.locator(`#st-video-venue-a`).dispatchEvent('change');
  await expect(c).toContainText(`影片 ID ${ID}`);
  await c.getByRole('switch').click();                       // 開直播
  await c.getByRole('button', { name: /^儲存$/ }).click();
  await expect.poll(async () => (await venueOf(page, 'venue-a'))?.stream, { timeout: 15_000 })
    .toMatchObject({ enabled: true, provider: 'youtube', videoId: ID, channelId: null, status: 'live' });
  const audits = Object.entries(await dump(page)).filter(([k]) => k.includes('/audits/')).map(([, v]) => v);
  expect(audits.some(a => a.action === 'stream.update' && a.after?.videoId === ID)).toBe(true);
});

test('⭐ 認不出來的網址不存，錯誤留在畫面上 @admin @stream', async ({ page }) => {
  await stub(page);
  await go(page);
  const c = card(page, 'venue-a');
  await c.locator(`#st-video-venue-a`).fill('https://vimeo.com/123456');
  await c.locator(`#st-video-venue-a`).dispatchEvent('change');
  await expect(c.locator('.adm__permNote--err')).toContainText('看不出這是 YouTube');
  await expect(c.getByRole('button', { name: /^儲存$/ })).toBeDisabled();
  expect((await venueOf(page, 'venue-a')).stream.videoId).toBeNull();
});

test('⭐ 開了直播卻沒有 ID 不給存（公開端會一片空白）@admin @stream', async ({ page }) => {
  await stub(page);
  await go(page);
  const c = card(page, 'venue-a');
  await c.getByRole('switch').click();
  await c.getByRole('button', { name: /^儲存$/ }).click();
  await expect(page.locator('.toast, [role=status]').last()).toContainText('沒有影片 ID');
  expect((await venueOf(page, 'venue-a')).stream.status).toBe('off');
});

test('關掉直播不用清 ID（中斷時先關，恢復再開）@admin @stream', async ({ page }) => {
  await stub(page);
  await go(page);
  const c = card(page, 'venue-b');
  await c.getByRole('switch').click();
  await c.getByRole('button', { name: /^儲存$/ }).click();
  await expect.poll(async () => (await venueOf(page, 'venue-b'))?.stream, { timeout: 15_000 })
    .toMatchObject({ status: 'off', enabled: false, videoId: 'abcdefghijk' });
});
