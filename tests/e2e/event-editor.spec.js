import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const E = 'feda-cup-2026', M = 'edit-match', BASE = `events/${E}`, PATH = `${BASE}/matches/${M}`;
const types = ['goal', 'own_goal', 'penalty_scored', 'penalty_missed', 'card', 'substitution', 'injury', 'period_start', 'period_end', 'note'];
function seed(final = false) {
  const s = {
    [`${BASE}`]: { dates: ['2026-10-09'] }, 'config/env': { env: 'demo' },
    'users/editor': { displayName: '賽務人員' }, 'staff/editor': { active: true, roles: [final ? 'admin' : 'scorer'], assignment: { venueIds: ['v'] } },
    [`${BASE}/divisions/d`]: { name: '成人組', periods: 1, matchDurationMin: 30 },
    [PATH]: { matchId: M, divisionId: 'd', venueId: 'v', venueName: 'A場', status: final ? 'confirmed' : 'live', period: final ? 'ft' : 'h1',
      home: { teamId: 'h', name: '主隊' }, away: { teamId: 'a', name: '客隊' }, score: { home: 3, away: 0 },
      lock: { locked: final }, managementRevision: 0, clock: { running: true, periodStartedAt: Date.now() - 60000, elapsedSecAtPause: 0 } },
    [`${BASE}/teams/h/roster/p`]: { displayName: '甲球員', jerseyNo: 167 },
    [`${BASE}/teams/h/roster/q`]: { displayName: '乙球員', jerseyNo: null },
    [`${BASE}/teams/a/roster/r`]: { displayName: '客隊球員', jerseyNo: 9 }
  };
  types.forEach((type, i) => {
    const neutral = ['period_start', 'period_end', 'note'].includes(type);
    s[`${PATH}/timeline/e${i}`] = { timelineId: `e${i}`, matchId: M, seq: i + 1, type, periodId: 'h1', clockSec: 60 + i,
      side: neutral ? 'neutral' : 'home', teamId: neutral ? null : 'h', playerId: neutral ? null : 'p', playerName: neutral ? null : '甲球員', jerseyNo: 167,
      cardType: type === 'card' ? 'yellow' : null, goalType: type === 'own_goal' ? 'own' : 'open',
      subInPlayerId: type === 'substitution' ? 'q' : null, subInPlayerName: '乙球員', subInJerseyNo: null, voided: false, note: '原始備註' };
  });
  return s;
}
async function open(page, final = false) {
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.addInitScript(s => { window.__FAKE_SEED = s; window.__seedData = s; window.__FAKE_USER = { uid: 'editor' }; }, seed(final));
  await page.goto(`/#/${final ? 'admin' : 'staff'}/match/${M}`);
  await expect(page.getByRole('button', { name: final ? '修改這筆事件' : '修正這筆事件' }).first()).toBeVisible();
}
const dump = page => page.evaluate(() => window.__fake.__dump());
const eventOf = async (page, id) => (await dump(page))[`${PATH}/timeline/${id}`];
const dlg = page => page.getByRole('dialog', { name: '修改事件' });
async function submit(page) {
  await dlg(page).locator('[name=reason]').fill('核對紀錄修正');
  await dlg(page).getByRole('button', { name: '儲存修改' }).click();
}
test('LIVE 所有十種事件可修改，包含球員、牌別、換人、時間、備註 @eventedit', async ({ page }) => {
  await open(page);
  for (const [i, type] of types.entries()) {
    const row = page.locator(`.tl__item[data-timeline-id=e${i}]`);
    await row.getByRole('button', { name: '修正這筆事件' }).click();
    await expect(dlg(page).locator('[name=type]')).toHaveValue(type);
    await expect(dlg(page).locator('[name=note]')).toHaveValue('原始備註');
    await dlg(page).locator('[name=minutes]').fill('31');
    await dlg(page).locator('[name=seconds]').fill('5');
    await dlg(page).locator('[name=note]').fill('修改備註');
    if (type === 'card') await dlg(page).locator('[name=cardType]').selectOption('red');
    if (type === 'goal') await dlg(page).locator('[name=playerId]').selectOption('q');
    await submit(page); await expect(dlg(page)).toHaveCount(0);
    expect(await eventOf(page, `e${i}`)).toMatchObject({ clockSec: 1865, note: '修改備註', editRevision: 1 });
  }
});
test('得分改類型調整比分，作廢後仍可恢復 @eventedit', async ({ page }) => {
  await open(page);
  const row = () => page.locator('.tl__item').filter({ has: page.locator('.tl__text', { hasText: '罰球進' }) });
  await row().getByRole('button', { name: '修正這筆事件' }).click();
  await dlg(page).locator('[name=type]').selectOption('penalty_missed'); await submit(page);
  await expect(dlg(page)).toHaveCount(0);
  expect((await dump(page))[PATH].score).toEqual({ home: 2, away: 0 });
  const missed = page.locator('.tl__item[data-timeline-id=e2]');
  await missed.first().getByRole('button', { name: '修正這筆事件' }).click();
  await dlg(page).locator('[name=voided]').check(); await submit(page); await expect(dlg(page)).toHaveCount(0);
  await page.locator('.tl__item.is-voided').getByRole('button', { name: '修正這筆事件' }).click();
  await dlg(page).locator('[name=voided]').uncheck(); await submit(page); await expect(dlg(page)).toHaveCount(0);
  expect(await eventOf(page, 'e2')).toMatchObject({ voided: false });
});
test('完賽改判頁提供事件修改並保持鎖定，賽務台唯讀 @eventedit', async ({ page }) => {
  await open(page, true);
  await page.locator('.event-corrections li').last().getByRole('button', { name: '修改這筆事件' }).click();
  await dlg(page).locator('[name=playerId]').selectOption('q'); await submit(page);
  await expect(dlg(page)).toHaveCount(0);
  expect(await eventOf(page, 'e0')).toMatchObject({ playerId: 'q', jerseyNo: null });
  expect((await dump(page))[PATH]).toMatchObject({ status: 'confirmed', lock: { locked: true } });
  await page.screenshot({ path: 'tmp/event-edit-admin-' + test.info().project.name + '.png' });
  await page.goto(`/#/staff/match/${M}`);
  await expect(page.locator('.tl__item')).toHaveCount(10);
  await expect(page.getByRole('button', { name: '修正這筆事件' })).toHaveCount(0);
});
test('錯誤保留草稿，取消不更動資料，不完整收據不能報成功 @eventedit', async ({ page }) => {
  await open(page);
  const before = await eventOf(page, 'e9');
  await page.getByRole('button', { name: '修正這筆事件' }).first().click();
  await dlg(page).locator('[name=note]').fill('草稿');
  await page.evaluate(() => { window.__FAKE_TIMELINE_RESULT = {}; });
  await submit(page); await expect(dlg(page).getByRole('alert')).toContainText('尚未確認');
  await expect(dlg(page).locator('[name=note]')).toHaveValue('草稿');
  await page.screenshot({ path: 'tmp/event-edit-form-' + test.info().project.name + '.png' });
  await dlg(page).getByRole('button', { name: '取消', exact: true }).click();
  expect(await eventOf(page, 'e9')).toEqual(before);
});
test('離線修改立即提示且不寫資料 @eventedit', async ({ page, context }) => {
  await open(page); await page.getByRole('button', { name: '修正這筆事件' }).first().click();
  await expect(dlg(page).locator('[name=type]')).toBeVisible();
  const before = await eventOf(page, 'e9');
  await context.setOffline(true);
  try { await submit(page); await expect(dlg(page).getByRole('alert')).toContainText('需要連線'); expect(await eventOf(page, 'e9')).toEqual(before); }
  finally { await context.setOffline(false); }
});

test('事件表單保持在手機畫面內並可捲到儲存 @eventedit @eventscroll', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await open(page); await page.locator('.tl__item[data-timeline-id=e0]').getByRole('button', { name: '修正這筆事件' }).click();
  await expect(dlg(page).locator('[name=type]')).toBeVisible();
  const bounds = await page.locator('.event-edit__panel').evaluate(e => ({ bottom: e.getBoundingClientRect().bottom }));
  const viewport = page.viewportSize();
  expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
  if (browserName === 'webkit') await dlg(page).getByRole('button', { name: '儲存修改' }).scrollIntoViewIfNeeded();
  else { await page.locator('.event-edit__panel').hover(); await page.mouse.wheel(0, 1600); }
  await expect(dlg(page).getByRole('button', { name: '儲存修改' })).toBeInViewport();
  await page.screenshot({ path: 'tmp/event-edit-scroll-' + test.info().project.name + '.png' });
});

for(const final of [false,true]) test(`${final?'賽後':'賽中'}可修改比賽時間，超過正規時間列入補時 @clockedit`,async({page})=>{
  await open(page,final);
  await page.getByRole('button',{name:'修改比賽時間',exact:true}).click();
  const d=page.getByRole('dialog',{name:'修改比賽時間'});
  await d.locator('[name=minutes]').fill('32');await d.locator('[name=seconds]').fill('30');
  await expect(d).toContainText('正規時間 30:00 · 補時 02:30');
  await d.locator('[name=reason]').fill('核對裁判時間');await d.getByRole('button',{name:'儲存時間'}).click();
  await expect(d).toHaveCount(0);
  expect((await dump(page))[PATH].clock.addedTimeSec).toBe(150);
  expect((await dump(page))[PATH].clock.running).toBe(!final);
  expect((await dump(page))[PATH].status).toBe(final?'confirmed':'live');
  if(!final){
    await expect.poll(async()=>Number((await page.locator('#match-clock').innerText()).split(':')[1])).not.toBe(30);
    await page.getByRole('button',{name:'完賽送出',exact:true}).click();
    await page.getByRole('dialog',{name:'確認完賽'}).getByRole('button',{name:'確認完賽',exact:true}).click();
    await expect.poll(async()=>(await dump(page))[PATH].status).toBe('finished');
    expect((await dump(page))[PATH].clock.elapsedSecAtPause).toBeGreaterThanOrEqual(1950);
    expect((await dump(page))[PATH].clock.running).toBe(false);
  }
});
test('時間修改未確認收據時保留草稿與錯誤 @clockreceipt',async({page})=>{
  await open(page,true);
  await page.evaluate(()=>window.__FAKE_CLOCK_RESULT={matchId:'edit-match',seconds:1950,managementRevision:1});
  await page.getByRole('button',{name:'修改比賽時間',exact:true}).click();
  const d=page.getByRole('dialog',{name:'修改比賽時間'});
  await d.locator('[name=minutes]').fill('32');await d.locator('[name=seconds]').fill('30');await d.locator('[name=reason]').fill('核對裁判時間');
  await d.getByRole('button',{name:'儲存時間'}).click();
  await expect(d.getByRole('alert')).toContainText('尚未確認');
  await expect(d.locator('[name=minutes]')).toHaveValue('32');
});
