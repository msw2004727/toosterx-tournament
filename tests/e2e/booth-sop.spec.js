import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { CHALLENGES, buildSeed } from '../../scripts/seed/build.js';
const EVENT = 'feda-cup-2026', UID = 'sop-worker', PID = 'FEDA-0182';
const fake = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const rewards = buildSeed().docs.find(d => d.path === 'config/challengeRewards').data;
const ids = rewards.requiredChallengeIds;
async function setup(page, { role = 'booth', assignment = ids, active = true, eventId = EVENT, loggedIn = true } = {}) {
  const seed = {
    'config/env': { env: 'demo' }, 'config/challengeRewards': rewards,
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP' },
    [`staff/${UID}`]: { uid: UID, roles: [role], active, assignment: { eventId, venueIds: [], challengeIds: assignment } },
    [`users/${UID}`]: { uid: UID, displayName: '攤位人員' }, 'users/new-worker': { uid: 'new-worker', displayName: '待授權人員' },
    [`events/${EVENT}/players/${PID}`]: { playerId: PID, nickname: '體驗玩家', completedChallengeIds: ids,
      luckyDrawEntries: 1, luckyDrawRuleVersion: rewards.version }
  };
  for (const c of CHALLENGES) seed[`events/${EVENT}/challenges/${c.challengeId}`] = c;
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: fake }));
  await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.route('https://static.line-scdn.net/**', r => r.abort());
  await page.addInitScript(({ seed, uid, loggedIn }) => {
    window.__FAKE_SEED = seed; window.__seedData = seed;
    window.__FAKE_USER = loggedIn ? { uid, displayName: '攤位人員' } : null;
    localStorage.setItem('feda:regGuide:seen', '1');
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { void blob.text().then(text => { window.__CSV = text; }); return create(blob); };
  }, { seed, uid: UID, loggedIn });
}
const dump = page => page.evaluate(() => window.__fake.__dump());
test('七個玩法均顯示簡介且改名中醫運動恢復站 @boothSop', async ({ page }) => {
  await setup(page); await page.goto('/#/challenge');
  await expect(page.locator('.chal__itemRule')).toHaveCount(7);
  await expect(page.locator('.chal__list')).toContainText('中醫運動恢復站');
  await expect(page.locator('.chal')).not.toContainText('中醫看診');
  await expect(page.locator('.chal')).not.toContainText('中醫問診');
  for (let i = 0; i < 7; i++) await expect(page.locator('.chal__itemRule').nth(i)).toHaveText(CHALLENGES[i].summary);
});
test('總管必須選攤位，存檔與重新編輯保留指派 @boothSop', async ({ page }) => {
  await setup(page, { role: 'super_admin' }); await page.goto('/#/admin/staff');
  await page.locator('.adm__item', { hasText: '待授權人員' }).locator('.adm__itemHead').click();
  await page.getByRole('radio', { name: '挑戰攤位 不含其他身分', exact: true }).click();
  await page.getByRole('button', { name: '指派身分', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('至少選擇');
  expect((await dump(page))['staff/new-worker']).toBeUndefined();
  await page.locator('#staff-challenges').getByRole('button', { name: '中醫運動恢復站', exact: true }).click();
  await page.locator('#staff-challenges').getByRole('button', { name: '一球三桶', exact: true }).click();
  await page.getByRole('button', { name: '指派身分', exact: true }).click();
  await expect.poll(async () => (await dump(page))['staff/new-worker']?.assignment.challengeIds).toEqual(ids.slice(5));
  const row = page.locator('.adm__item', { hasText: '待授權人員' });
  await row.locator('.adm__itemHead').click();
  await expect(page.locator('#staff-challenges [aria-pressed="true"]')).toHaveCount(2);
  await page.getByRole('button', { name: '更新身分', exact: true }).click();
  expect((await dump(page))['staff/new-worker'].assignment.challengeIds).toEqual(ids.slice(5));
  const audits = Object.entries(await dump(page)).filter(([p]) => p.includes('/audits/')).map(([, a]) => a);
  expect(audits.at(-1).after.challengeIds).toEqual(ids.slice(5));
});
test('從挑戰區找到入口，複數攤位先選關卡再看到相機與手動卡號 @boothSop', async ({ page }, info) => {
  await setup(page); await page.goto('/#/challenge');
  await page.getByRole('button', { name: '攤位登錄', exact: true }).click();
  await expect(page.locator('.booth')).toContainText('下一步就能開啟相機');
  await page.getByRole('button', { name: /中醫運動恢復站.*攤位 6/ }).click();
  await expect(page.getByRole('button', { name: '開啟相機掃描挑戰卡', exact: true })).toBeVisible();
  await expect(page.getByLabel('手動輸入玩家挑戰卡號')).toBeVisible();
  await page.locator('#booth-id').fill('0182'); await page.getByRole('button', { name: '查詢', exact: true }).click();
  await page.getByRole('button', { name: '已踩點', exact: true }).click();
  await expect.poll(async () => Object.keys(await dump(page)).filter(p => p.includes('/attempts/')).length).toBe(1);
  const attempts = Object.entries(await dump(page)).filter(([p]) => p.includes('/attempts/')).map(([, a]) => a);
  expect(attempts).toHaveLength(1); expect(attempts[0]).toMatchObject({ playerId: PID, challengeId: ids[5], rawValue: 1, staffUid: UID });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('booth-sop.png'), fullPage: true });
});
test('被授權後可按更新權限取得負責攤位 @boothSop', async ({ page }) => {
  await setup(page, { assignment: [] }); await page.goto('/#/booth');
  await expect(page.locator('.booth')).toContainText('還沒有被指派');
  await page.evaluate(({ uid, id, eventId }) => window.__fake.__seed({ [`staff/${uid}`]: {
    uid, roles: ['booth'], active: true, assignment: { eventId, challengeIds: [id] }
  } }), { uid: UID, id: ids[5], eventId: EVENT });
  await page.getByRole('button', { name: '更新權限', exact: true }).click();
  await expect(page.locator('#booth-id')).toBeVisible();
  await expect(page.locator('.booth__head')).toContainText('中醫運動恢復站');
});
test('掃碼登入保留攤位與玩家卡號 @boothSop', async ({ page }) => {
  await setup(page, { loggedIn: false }); await page.goto(`/#/booth/${ids[5]}?id=${PID}`);
  await expect(page).toHaveURL(/#\/login\?next=/);
  const next = new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('next');
  expect(next).toBe(`/booth/${ids[5]}?id=${PID}`);
  await page.evaluate(uid => window.__fake.__setUser({ uid }), UID);
  await expect(page.locator('.booth__nick')).toHaveText('體驗玩家');
  await expect(page.locator('.booth__head')).toContainText('中醫運動恢復站');
});
test('單攤位人員無法用網址切到未指派關卡 @boothSop', async ({ page }) => {
  await setup(page, { assignment: [ids[5]] }); await page.goto(`/#/booth/${ids[6]}?id=${PID}`);
  await expect(page.locator('.booth')).toContainText('未授權');
  await expect(page.locator('#booth-id')).toHaveCount(0);
  await expect(page.locator('.booth__choice')).toHaveCount(1);
});
test('其他活動的指派不會取得本活動攤位 @boothSop', async ({ page }) => {
  await setup(page, { eventId: 'other-event' }); await page.goto('/#/booth');
  await expect(page.locator('.booth')).toContainText('還沒有被指派');
  await expect(page.locator('#booth-id')).toHaveCount(0);
});
test('停用人員看得到重新授權提示且不能登錄 @boothSop', async ({ page }) => {
  await setup(page, { active: false }); await page.goto('/#/booth');
  await expect(page.locator('.booth__box--warn')).toContainText('沒有登錄挑戰成績的權限');
  await expect(page.locator('#booth-id')).toHaveCount(0);
});
test('沒有內建辨識時相機以實際 QR 影像解碼並停止串流 @boothSop', async ({ page }) => {
  await setup(page, { assignment: [ids[5]] });
  await page.addInitScript(() => {
    delete window.BarcodeDetector;
    const real = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => {
      const { qrMatrix } = await import('/js/lib/qr-render.js');
      const { size, modules } = qrMatrix('FEDA-0182');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = (size + 8) * 8;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000'; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
        if (modules[y][x]) ctx.fillRect((x + 4) * 8, (y + 4) * 8, 8, 8);
      const stream = canvas.captureStream(10); window.__cameraTracks = stream.getTracks();
      setTimeout(() => ctx.fillRect(0, 0, 1, 1), 50);
      return stream;
    };
  });
  await page.goto('/#/booth');
  await expect(page.getByRole('button', { name: '開啟相機掃描挑戰卡', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '開啟相機掃描挑戰卡', exact: true }).click();
  await expect(page.locator('.booth__nick')).toHaveText('體驗玩家');
  await expect(page.locator('.scan')).toHaveCount(0);
  expect(await page.evaluate(() => window.__cameraTracks.every(t => t.readyState === 'ended'))).toBe(true);
});
test('相機權限拒絕後手動卡號仍可使用 @boothSop', async ({ page }) => {
  await setup(page, { assignment: [ids[5]] });
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }; });
  await page.goto('/#/booth'); await page.getByRole('button', { name: '開啟相機掃描挑戰卡', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('相機權限被拒絕');
  await expect(page.locator('.scan')).toHaveCount(0);
  await page.locator('#booth-id').fill(PID); await page.getByRole('button', { name: '查詢', exact: true }).click();
  await expect(page.locator('.booth__nick')).toBeVisible();
});
test('CSV 下載重新讀取資格，排除剛作廢的玩家而納入最新完成者 @boothSop', async ({ page }) => {
  await setup(page, { role: 'admin' }); await page.goto('/#/admin/export');
  await expect(page.locator('.adm')).toContainText('有資格的玩家 1 人');
  await page.evaluate(({ eventId, oldId, ids, version }) => window.__fake.__seed({
    [`events/${eventId}/players/${oldId}`]: { playerId: oldId, completedChallengeIds: ids.slice(0, 6), luckyDrawEntries: 0, luckyDrawRuleVersion: version },
    [`events/${eventId}/players/FEDA-0199`]: { playerId: 'FEDA-0199', nickname: '=危險暱稱', completedChallengeIds: ids, luckyDrawEntries: 1, luckyDrawRuleVersion: version }
  }), { eventId: EVENT, oldId: PID, ids, version: rewards.version });
  await page.getByRole('button', { name: '下載 CSV', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__CSV)).toContain('FEDA-0199');
  const csv = await page.evaluate(() => window.__CSV);
  expect(csv).not.toContain(PID); expect(csv).toContain("'=危險暱稱");
  await expect(page.locator('.adm')).toContainText('有資格的玩家 1 人');
});
test('離線不能匯出快取資格名單 @boothSop', async ({ page }) => {
  await setup(page, { role: 'admin' }); await page.goto('/#/admin/export');
  await expect(page.getByRole('button', { name: '下載 CSV', exact: true })).toBeEnabled();
  await page.evaluate(() => window.__fake.__goOffline());
  await page.getByRole('button', { name: '下載 CSV', exact: true }).click();
  await expect(page.locator('.adm__box--warn')).toContainText('讀不到資料');
  expect(await page.evaluate(() => window.__CSV)).toBeUndefined();
});
test('抽獎設定遺失時停止匯出且說明原因 @boothSop', async ({ page }) => {
  await setup(page, { role: 'admin' }); await page.goto('/#/admin/export');
  await expect(page.getByRole('button', { name: '下載 CSV', exact: true })).toBeEnabled();
  await page.evaluate(() => window.__fake.__seed({ 'config/challengeRewards': null }));
  await page.getByRole('button', { name: '下載 CSV', exact: true }).click();
  await expect(page.locator('.adm__box--warn')).toContainText('抽獎規則尚未設定');
  expect(await page.evaluate(() => window.__CSV)).toBeUndefined();
});
