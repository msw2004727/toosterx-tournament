import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const EVENT = 'feda-cup-2026', PID = 'FEDA-0182', UID = 'daily-user';
const dates = ['2026-10-09', '2026-10-10', '2026-10-11'];
const fake = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const ms = date => Date.parse(`${date}T10:00:00+08:00`);
async function setup(page, { date = '2026-10-10', complete = true, role = null } = {}) {
  const seed = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP', dates },
    'config/env': { env: 'demo', allowChallengeTestTime: true },
    'config/challengeRewards': { rule: 'dailyChallengesCompleted', version: 'daily-v1', dates, timeZone: 'Asia/Taipei' },
    [`events/${EVENT}/players/${PID}`]: { playerId: PID, nickname: '單日玩家', luckyDrawEntries: 0, completedChallengeIds: [] },
    [`users/${UID}`]: { uid: UID, displayName: '每日工作人員', gamePassId: PID },
    [`staff/${UID}`]: { uid: UID, active: true, roles: role ? [role] : [], assignment: { eventId: EVENT, challengeIds: ['a', 'b', 'c', 'd'] } }
  };
  for (const [i, id] of ['a', 'b', 'c', 'd'].entries()) {
    seed[`events/${EVENT}/challenges/${id}`] = { challengeId: id, name: `攤位${id}`, shortName: id, order: i,
      minValue: 0, maxValue: 5, inputMode: 'stepper', dailyOpen: { [dates[0]]: true, [dates[1]]: id !== 'd', [dates[2]]: false },
      stats: { dailyPlayers: { [dates[0]]: 2, [dates[1]]: 3, [dates[2]]: 0 } } };
    if (id !== 'd') seed[`events/${EVENT}/attempts/${id}`] = { attemptId: id, challengeId: id, playerId: PID, rawValue: 0,
      recordedAtMs: ms(!complete && id === 'c' ? dates[0] : dates[1]), createdAt: ms(dates[2]) };
  }
  await page.clock.install({ time: new Date(ms(date)) });
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: fake }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ headers: { date: new Date(ms(date)).toUTCString() }, body: '{}' }));
  await page.addInitScript(({ seed, pid, uid, role }) => {
    window.__FAKE_SEED = seed; window.__seedData = seed;
    window.__FAKE_USER = role ? { uid, displayName: '每日工作人員' } : null;
    localStorage.setItem('feda:gamePass', JSON.stringify({ playerId: pid }));
  }, { seed, pid: PID, uid: UID, role });
}
test('當日三攤完成即顯示已取得資格，背景玩家欄位仍為 0 也不會誤報未完成 @daily', async ({ page }) => {
  await setup(page); await page.goto('/#/challenge/me');
  await expect(page.getByRole('tab', { name: '10/10' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.chal__stamps .chal__stamp')).toHaveCount(3);
  await expect(page.locator('.chal__stamps [data-done="true"]')).toHaveCount(3);
  await expect(page.locator('.chal__card--draw')).toContainText('已取得 1 次抽獎機會');
  await expect(page.locator('.chal__card--draw')).not.toContainText('尚未取得');
  await page.getByRole('tab', { name: '10/09' }).click();
  await expect(page.locator('.chal__stamps .chal__stamp')).toHaveCount(4);
  await expect(page.locator('.chal__card--draw')).toContainText('已完成 0 / 4');
  await page.getByRole('tab', { name: '10/10' }).click();
  await expect(page.locator('.chal__card--draw')).toContainText('已取得 1 次抽獎機會');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Demo 模擬日期同步抽獎頁籤與攤位登錄日期，還原後回真實日期 @demobooth', async ({ page }) => {
  await setup(page, { date: '2026-10-05', role: 'booth' }); await page.goto('/#/challenge/me');
  await expect(page.getByRole('tab', { name: '10/09' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '測試時間', exact: true }).click();
  await page.getByLabel('測試活動日期').selectOption(dates[1]);
  await page.getByLabel('測試時間', { exact: true }).fill('09:30');
  await page.getByRole('button', { name: '啟用測試時間' }).click();
  await page.clock.runFor(1100);
  await expect(page.getByRole('tab', { name: '10/10' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.chal__card--draw')).toContainText('已取得 1 次抽獎機會');
  await page.evaluate(() => { location.hash = '/booth/a'; });
  await page.locator('#booth-id').fill(PID); await page.getByRole('button', { name: '查詢', exact: true }).click();
  await page.getByRole('button', { name: '送出成績', exact: true }).click();
  await expect.poll(async () => Object.values(await page.evaluate(() => window.__fake.__dump()))
    .filter(d => d.staffUid === UID && d.demoTestTime === true).length).toBe(1);
  const record=await page.evaluate(() => Object.values(window.__fake.__dump()).find(d=>d.demoTestTime===true));
  expect(record.activityDate).toBe(dates[1]);
  expect(new Date(record.recordedAtMs).toISOString()).toMatch(/^2026-10-10T01:30/);
});
test('前一天的第三攤不能湊今日資格，當日第三攤登錄後即時取得資格 @daily', async ({ page }) => {
  await setup(page, { complete: false }); await page.goto('/#/challenge');
  await expect(page.locator('.chal__card--draw')).toContainText('已完成 2 / 3');
  await page.evaluate(({ event, pid, time }) => window.__fake.__seed({ [`events/${event}/attempts/new-c`]: {
    challengeId: 'c', playerId: pid, rawValue: 0, recordedAtMs: time, createdAt: time
  } }), { event: EVENT, pid: PID, time: ms(dates[1]) });
  await expect(page.locator('.chal__card--draw')).toContainText('已取得 1 次抽獎機會');
});
for (const [date, selected] of [['2026-10-05', '10/09'], ['2026-10-09', '10/09'], ['2026-10-11', '10/11'], ['2026-10-15', '10/11']]) {
  test(`日期 ${date} 自動選擇 ${selected} @daily`, async ({ page }) => {
    await setup(page, { date }); await page.goto('/#/challenge/me');
    await expect(page.getByRole('tab', { name: selected })).toHaveAttribute('aria-selected', 'true');
    if (selected === '10/11') await expect(page.locator('.chal__card--draw')).toContainText('本日沒有開放活動');
  });
}
test('攤位選卡顯示三日完成統計，開關儲存後玩家所需關卡即時改變 @daily', async ({ page }) => {
  await setup(page, { role: 'booth' }); await page.goto('/#/booth');
  const card = page.locator('[data-challenge="d"]');
  await expect(card).toContainText('10/09・已完成 2 人');
  await expect(card).toContainText('10/10・已完成 3 人');
  const toggle = card.getByRole('switch', { name: '攤位d 10/10 開放' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => { location.hash = '/challenge/me'; });
  await expect(page.locator('.chal__stamps .chal__stamp')).toHaveCount(4);
  await expect(page.locator('.chal__card--draw')).toContainText('已完成 3 / 4');
});
test('未開放攤位禁止登錄，今日次數只計今日 @daily', async ({ page }) => {
  await setup(page, { role: 'booth' }); await page.goto('/#/booth/d');
  await expect(page.locator('.booth')).toContainText('本攤位未開放');
  await page.locator('#booth-id').fill(PID); await page.getByRole('button', { name: '查詢', exact: true }).click();
  await expect(page.getByRole('button', { name: '送出成績', exact: true })).toHaveCount(0);
});
test('離線登錄完成先顯示待同步，恢復連線自動取得資格 @daily', async ({ page }) => {
  await setup(page, { complete: false, role: 'booth' }); await page.goto('/#/challenge/me');
  await expect(page.locator('.chal__card--draw')).toContainText('已完成 2 / 3');
  await page.evaluate(async ({ event, pid, time }) => {
    const { sdk, db } = await import('/js/core/firebase.js');
    const { setDoc, doc, serverTimestamp } = sdk();
    window.__fake.__goOffline();
    void setDoc(doc(db(), 'events', event, 'attempts', 'offline-c'), {
      challengeId: 'c', playerId: pid, rawValue: 0, recordedAtMs: time, createdAt: serverTimestamp()
    });
  }, { event: EVENT, pid: PID, time: ms(dates[1]) });
  await expect(page.locator('.chal__card--draw')).toContainText('今日集章完成，待同步確認');
  await expect(page.locator('.chal__card--draw')).not.toContainText('尚未取得');
  await page.evaluate(() => window.__fake.__goOnline());
  await expect(page.locator('.chal__card--draw')).toContainText('已取得 1 次抽獎機會');
});
test('CSV 只列所選日期，下載內容與檔名包含活動日，其他日不混入 @daily', async ({ page }) => {
  await setup(page, { role: 'admin' }); await page.goto('/#/admin/export');
  await expect(page.locator('.adm')).toContainText('有資格的玩家 1 人');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下載 CSV' }).click()]);
  expect(download.suggestedFilename()).toBe('抽獎名單-2026-10-10.csv');
  const path = await download.path(), csv = fs.readFileSync(path, 'utf8');
  expect(csv).toContain('活動日期,當日開放關卡數'); expect(csv).toContain(`2026-10-10,3,${PID}`);
  await page.getByRole('tab', { name: '10/09' }).click();
  await expect(page.locator('.adm')).toContainText('有資格的玩家 0 人');
  await expect(page.getByRole('button', { name: '下載 CSV' })).toBeDisabled();
});
test('頁面持續開啟跨午夜後自動切當日，手動查看前一天也會回到新一天 @daily', async ({ page }) => {
  await setup(page); await page.goto('/#/challenge/me');
  await expect(page.getByRole('tab', { name: '10/10' })).toHaveAttribute('aria-selected', 'true');
  await page.clock.runFor(1100);
  await page.getByRole('tab', { name: '10/09' }).click();
  await expect(page.getByRole('tab', { name: '10/09' })).toHaveAttribute('aria-selected', 'true');
  await page.clock.setSystemTime(new Date('2026-10-10T23:59:59+08:00'));
  await page.clock.fastForward(2000);
  await expect(page.getByRole('tab', { name: '10/11' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.chal__card--draw')).toContainText('本日沒有開放活動');
});

for (const route of ['/challenge', '/challenge/me']) {
  test(`本機快取不完整時不誤判未完成，伺服器確認後才顯示資格：${route} @dailycache`, async ({ page }) => {
    await setup(page, { complete: false });
    await page.addInitScript(() => { window.__FAKE_OFFLINE = true; });
    await page.goto(`/#${route}`);
    await expect(page.locator('.chal__card--draw')).toContainText('正在載入當日集章紀錄');
    await expect(page.locator('.chal__card--draw')).not.toContainText('尚未取得');
    await expect(page.locator('.chal__card--draw')).not.toContainText('還差');
    await page.evaluate(() => window.__fake.__goOnline());
    await expect(page.locator('.chal__card--draw')).toContainText('尚未取得當日抽獎資格');
    await page.evaluate(({ event, pid, time }) => window.__fake.__seed({
      [`events/${event}/attempts/c`]: { challengeId: 'c', playerId: pid, rawValue: 0, recordedAtMs: time, createdAt: time }
    }), { event: EVENT, pid: PID, time: ms(dates[1]) });
    await expect(page.locator('.chal__card--draw')).toContainText('已取得 1 次抽獎機會');
  });
  test(`本機完整有效紀錄離線仍保留已完成資格：${route} @dailycache`, async ({ page }) => {
    await setup(page);
    await page.addInitScript(() => { window.__FAKE_OFFLINE = true; });
    await page.goto(`/#${route}`);
    await expect(page.locator('.chal__card--draw')).toContainText('已取得 1 次抽獎機會');
    await expect(page.locator('.chal__card--draw')).not.toContainText('尚未取得');
  });
}
