/**
 * E2E｜匯出資料 `#/admin/export`
 * ------------------------------------------------------------------
 * 規格：docs/06 §7.3；驗收 C10（匯出張數與系統顯示一致）
 *
 * 守五件事：
 *   ・頁面畫得出來，而且**下載之前就看得到裡面有什麼**
 *   ・張數與人數跟系統顯示的一致（C10）
 *   ・0 張的人不進名單
 *   ・**下載的檔案內容真的正確**（攔截 blob 讀回來驗，含公式中和與 BOM）
 *   ・沒有權限的人看得到原因
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'U7774e1410479bafff4997f51b2c47b95';

const CHALLENGES = ['g01', 'g02', 'g03', 'g04', 'g05'].map((id, i) => ({
  challengeId: id, order: i + 1, name: `關卡${i + 1}`, shortName: `關${i + 1}`,
  scoreType: 'count', unit: '次', rankingRule: 'higher', decimals: 0
}));

const player = (id, over = {}) => ({
  playerId: id, eventId: EVENT, nickname: `玩家${id.slice(-2)}`, avatarSeed: id.slice(-4),
  ageBand: 'adult', qrCode: null, linkedTeamId: null,
  contact: { phone: null, lineUserId: null },
  completedChallengeIds: ['g01'], luckyDrawEntries: 1, createdVia: 'self', ...over
});

function seed({ roles = ['admin'], players = null, perms = null } = {}) {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo' },
    [`users/${UID}`]: { uid: UID, displayName: '金小麥' },
    [`staff/${UID}`]: {
      uid: UID, name: '金小麥', roles, active: true,
      assignment: { eventId: EVENT, venueIds: [], divisionIds: [], challengeIds: [] }
    }
  };
  for (const c of CHALLENGES) s[`events/${EVENT}/challenges/${c.challengeId}`] = c;
  const list = players ?? [
    player('FEDA-0001', { luckyDrawEntries: 5, completedChallengeIds: ['g01', 'g02', 'g03', 'g04', 'g05'] }),
    player('FEDA-0002', { luckyDrawEntries: 2, completedChallengeIds: ['g01', 'g02'] }),
    // 0 張的不該進名單
    player('FEDA-0003', { luckyDrawEntries: 0, completedChallengeIds: [] })
  ];
  for (const p of list) s[`events/${EVENT}/players/${p.playerId}`] = p;
  if (perms) for (const [role, v] of Object.entries(perms)) s[`rolePermissions/${role}`] = { role, perms: v };
  return s;
}

async function stub(page, opts = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', r =>
    r.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.addInitScript(({ s, u }) => {
    window.__FAKE_SEED = s;
    window.__seedData = s;
    window.__FAKE_USER = { uid: u, displayName: '金小麥' };

    // ⚠️ 瀏覽器的下載在測試環境裡拿不到內容，所以攔截 createObjectURL
    //    把 Blob 的文字留下來——「檔案裡到底寫了什麼」才是這一頁的重點。
    window.__CSV = null;
    window.__CSV_BYTES = null;
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      // ⚠️ 一定要同時留下**位元組**。Blob.text() 依規範會把開頭的 BOM
      //    吃掉（UTF-8 decode 的行為），所以只看文字會誤判「沒有 BOM」——
      //    而 BOM 在不在正是 Excel 會不會顯示亂碼的關鍵。
      blob.text().then(t => { window.__CSV = t; });
      blob.arrayBuffer().then(b => { window.__CSV_BYTES = [...new Uint8Array(b).slice(0, 3)]; });
      return real(blob);
    };
  }, { s: seed(opts), u: UID });
}

const go = async page => {
  await page.goto('/#/admin/export');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
};
const ready = page => expect(page.locator('.adm__head')).toBeVisible({ timeout: 15_000 });
const csvOf = page => page.evaluate(() => window.__CSV);
const bytesOf = page => page.evaluate(() => window.__CSV_BYTES);

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('⭐ 下載之前就看得到裡面有什麼 @export', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);

  // 摘要：2 人有資格（0 張的那位不算）、合計 7 張、5 關全破 1 人
  await expect(page.locator('.adm')).toContainText('有資格的玩家 2 人');
  await expect(page.locator('.adm')).toContainText('抽獎券合計 7 張');
  await expect(page.locator('.adm')).toContainText('5 關全破 1 人');
  // 預覽列出前幾筆，主辦可以對照
  await expect(page.locator('.adm__tieRow')).toHaveCount(2);
  await expect(page.locator('.adm__tieRow').first()).toContainText('FEDA-0001');
});

test('⭐ 0 張的人不進名單 @export', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);
  await expect(page.locator('.adm')).not.toContainText('FEDA-0003');
});

test('⭐ 下載的 CSV 內容正確：BOM、表頭、張數、排序 @export', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);

  await page.getByRole('button', { name: /下載 CSV/ }).click();
  await expect.poll(() => csvOf(page), { timeout: 15_000 }).not.toBeNull();

  // ⭐ 驗**位元組**而不是字元：`Blob.text()` 依規範會把開頭的 BOM 吃掉
  //    （UTF-8 decode 的行為），只看文字永遠會得到「沒有 BOM」的錯誤結論。
  //    而 BOM 在不在，正是 Excel 會不會把中文顯示成亂碼的關鍵。
  expect(await bytesOf(page)).toEqual([0xEF, 0xBB, 0xBF]);
  const csv = await csvOf(page);
  const lines = csv.split('\r\n').filter(Boolean);
  expect(lines[0]).toBe('代號,暱稱,抽獎張數,完成關卡數,聯絡方式,年齡層,建立方式');
  expect(lines).toHaveLength(3);                          // 表頭 + 2 人
  expect(lines[1]).toContain('FEDA-0001');                // 張數多的在前
  expect(lines[1]).toContain(',5,');
  expect(lines[2]).toContain('FEDA-0002');
});

test('⭐ 暱稱裡的公式在下載的檔案裡真的被中和（主辦會用 Excel 打開）@export', async ({ page }) => {
  await stub(page, {
    players: [player('FEDA-0001', { nickname: '=HYPERLINK("http://evil.example","點我")' })]
  });
  await go(page);
  await ready(page);

  await page.getByRole('button', { name: /下載 CSV/ }).click();
  await expect.poll(() => csvOf(page), { timeout: 15_000 }).not.toBeNull();

  const csv = await csvOf(page);
  // 試算表讀到的第一個字元是單引號 → 當成純文字，不執行
  expect(csv).toContain('"\'=HYPERLINK');
  expect(csv).not.toMatch(/,=HYPERLINK/);
});

test('⭐ 暱稱裡的逗號不會把那一列切成兩欄 @export', async ({ page }) => {
  await stub(page, { players: [player('FEDA-0001', { nickname: '阿哲,小名' })] });
  await go(page);
  await ready(page);

  await page.getByRole('button', { name: /下載 CSV/ }).click();
  await expect.poll(() => csvOf(page), { timeout: 15_000 }).not.toBeNull();

  const line = (await csvOf(page)).split('\r\n')[1];
  expect(line).toContain('"阿哲,小名"');
  // 逸出正確的話，逗號分割出來的欄數仍然是 7（含被包起來的那一格裡的一個）
  expect(line.split(',')).toHaveLength(8);
});

test('⭐ 沒有人有資格時不給按，而且說得出來 @export', async ({ page }) => {
  await stub(page, { players: [player('FEDA-0003', { luckyDrawEntries: 0, completedChallengeIds: [] })] });
  await go(page);
  await ready(page);

  await expect(page.locator('.adm')).toContainText('還沒有人有抽獎資格');
  await expect(page.getByRole('button', { name: /下載 CSV/ })).toBeDisabled();
});

test('匯出會留一筆稽核（抽獎有爭議時要查得到誰把名單帶走）@export', async ({ page }) => {
  await stub(page);
  await go(page);
  await ready(page);

  await page.getByRole('button', { name: /下載 CSV/ }).click();
  await expect.poll(async () => {
    const d = await page.evaluate(() => window.__fake.__dump());
    return Object.entries(d).filter(([k]) => k.includes('/audits/')).length;
  }, { timeout: 15_000 }).toBeGreaterThan(0);

  const d = await page.evaluate(() => window.__fake.__dump());
  const a = Object.entries(d).filter(([k]) => k.includes('/audits/')).map(([, v]) => v)
    .find(x => x.action === 'export.luckyDraw');
  expect(a).toBeTruthy();
  expect(a.after.players).toBe(2);
  expect(a.after.entries).toBe(7);
});

test('⭐ 記錄員進不來，而且看得到原因 @export', async ({ page }) => {
  await stub(page, { roles: ['scorer'] });
  await go(page);
  await expect(page.locator('.adm__box--warn')).toContainText('匯出資料');
  await expect(page.getByRole('button', { name: /下載 CSV/ })).toHaveCount(0);
});

test('⭐ 總管關掉這一條之後，管理員就進不來 @export', async ({ page }) => {
  await stub(page, { perms: { admin: { export: false } } });
  await go(page);
  await expect(page.locator('.adm__box--warn')).toContainText('匯出資料');
  await expect(page.getByRole('button', { name: /下載 CSV/ })).toHaveCount(0);
});
