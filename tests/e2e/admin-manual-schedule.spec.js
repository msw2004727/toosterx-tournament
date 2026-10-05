/** Manual drafts must be private, usable with touch and keyboard, and publish as one verified command. */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { planGeneration, matchDocOf } from '../../js/engine/schedule-doc.js';
import { FORMATS } from '../../js/engine/formats.js';

const FAKE = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const EVENT = 'feda-cup-2026', UID = 'manual-admin', BASE = `events/${EVENT}`;
const division = { divisionId: 'adult-open', name: '成人公開組', shortName: '公開', code: 'AO',
  order: 1, date: '2026-10-11', matchDurationMin: 30, playersOnField: 9,
  formatId: 'F4_RR_FINAL', rankingRuleId: 'RR_FEDA_2026', scheduleRevision: 0, schedulePublished: true };
const format = { formatId: 'F4_RR_FINAL', name: '4隊單循環＋名次賽', teamCount: 4, stages: [
  { stageId: 'group', name: '循環賽', type: 'roundRobin', order: 1, groupCount: 1, groupSize: 4, legs: 1 },
  { stageId: 'final', name: '名次賽', type: 'knockout', order: 2, drawRule: 'penalty', slots: [
    { matchKey: 'F1', label: '冠軍賽', home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 1 }, away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 2 } },
    { matchKey: 'F3', label: '季軍賽', home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 3 }, away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 4 } }
  ] }
], finalRankingMap: [] };
const teams = ['野狼', '猛虎', '獵鷹', '晨星'].map((name, index) => ({ teamId: `t-${index + 1}`, name: `${name}足球隊`, shortName: name,
  divisionId: division.divisionId, status: 'approved', withdrawn: false, seed: index + 1, groupId: 'A' }));
const plan = planGeneration({ division, orderedTeams: teams, format });
const rr = plan.matches.filter(m => m.stageId === 'group');
const dateMs = Date.parse('2026-10-11T08:30:00+08:00');
const timeOf = index => dateMs + index * 60 * 60_000;

function seed({ create = false, started = false, roles = ['admin'], revision = 0, unusualTime = false, longName = false } = {}) {
  const rows = {
    [BASE]: { eventId: EVENT, name: 'FEDA CUP' }, 'config/env': { env: 'demo' },
    'config/schedule': { startTime: '08:30', endTime: '18:00', bufferMin: 10, minRestMin: 20, maxGapMin: 240,
      venuesByDate: { '2026-10-11': ['venue-a', 'venue-b'] } },
    'config/formats': { formats: { [format.formatId]: format } },
    [`${BASE}/divisions/${division.divisionId}`]: { ...division, scheduleRevision: revision, schedulePublished: !create },
    [`${BASE}/venues/venue-a`]: { venueId: 'venue-a', name: '甲場', fieldType: '9v9', order: 1 },
    [`${BASE}/venues/venue-b`]: { venueId: 'venue-b', name: '乙場', fieldType: '9v9', order: 2 },
    [`users/${UID}`]: { uid: UID, displayName: '賽程管理員' },
    [`staff/${UID}`]: { uid: UID, name: '賽程管理員', roles, active: true, assignment: { eventId: EVENT } }
  };
  for (const team of teams) rows[`${BASE}/teams/${team.teamId}`] = { ...team,
    ...(longName && team.teamId === 't-1' ? { name: '<img src=x onerror=alert(1)>超長隊名'.repeat(3), shortName: '<b>測試超長隊名</b>'.repeat(3) } : {}) };
  if (!create) plan.matches.forEach((match, index) => {
    rows[`${BASE}/matches/${match.matchId}`] = { ...matchDocOf({ m: match, division, eventId: EVENT }),
      kickoffAt: timeOf(index) + (unusualTime && index === 0 ? 2 * 60_000 : 0), venueId: 'venue-a', venueName: '甲場', matchNo: index + 1,
      ...(started && index === 0 ? { status: 'finished', period: 'second', score: { home: 2, away: 1 }, result: { winner: 'home' } } : {}) };
  });
  return rows;
}

async function stub(page, options = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE }));
  await page.route('https://firestore.googleapis.com/**', route => route.fulfill({ status: 200, headers: { date: new Date().toUTCString() }, body: '{}' }));
  await page.addInitScript(({ docs, uid }) => { window.__FAKE_SEED = docs; window.__FAKE_USER = { uid, displayName: '賽程管理員' }; }, { docs: options.docs || seed(options), uid: UID });
}
async function go(page) {
  await page.goto('/#/admin/schedule');
  await page.getByRole('button', { name: '手動安排', exact: true }).click();
  await expect(page.locator('.manual__workspace')).toBeVisible();
}
const card = (page, teamId) => page.locator(`.manual__team[data-team-id="${teamId}"] .manual__teamPick`);
const slot = (page, matchId, side) => page.locator(`.manual__slot[data-match-id="${matchId}"][data-side="${side}"] .manual__slotPick`);
const time = (page, id) => page.getByRole('combobox', { name: `${id} 手動開賽時間`, exact: true });
const venue = (page, id) => page.getByRole('combobox', { name: `${id} 手動場地`, exact: true });
const dump = page => page.evaluate(() => window.__fake.__dump());
const calls = page => page.evaluate(() => (window.__FAKE_CALLS || []).filter(call => call.name === 'publishManualSchedule'));
const saved = page => page.evaluate(() => {
  const key = localStorage.getItem(`feda:manual-schedule:index:manual-admin:feda-cup-2026:adult-open`);
  return key ? JSON.parse(localStorage.getItem(key)) : null;
});
async function preview(page, reason = '主辦確認對戰與時段') {
  await page.getByRole('button', { name: '預覽整批發布', exact: true }).click();
  await page.getByRole('textbox', { name: '手動賽程發布原因' }).fill(reason);
}

test('手動草稿改時間不寫雲端，24h 下拉保留非5分既有時間，重載恢復 @admin', async ({ page }) => {
  await stub(page, { unusualTime: true }); await go(page);
  const before = await dump(page);
  await expect(time(page, rr[0].matchId)).toHaveValue(String(dateMs + 2 * 60_000));
  await expect(time(page, rr[0].matchId).locator('option:checked')).toHaveText('08:32');
  await time(page, rr[0].matchId).selectOption(String(dateMs + 5 * 60_000));
  expect(await dump(page)).toEqual(before); expect(await calls(page)).toHaveLength(0);
  expect((await saved(page)).draft.matches.find(m => m.matchId === rr[0].matchId).kickoffAt).toBe(dateMs + 5 * 60_000);
  await page.reload(); await page.getByRole('button', { name: '手動安排', exact: true }).click();
  await expect(page.locator('.manual__restored')).toContainText('已恢復');
  await expect(time(page, rr[0].matchId)).toHaveValue(String(dateMs + 5 * 60_000));
  expect(await dump(page)).toEqual(before);
});

test('點選／鍵盤安排、同隊自賽阻擋、替換需確認且可撤銷 @admin', async ({ page }) => {
  await stub(page); await go(page);
  const first = rr[0], thirdId = teams.find(t => ![first.home.teamId, first.away.teamId].includes(t.teamId)).teamId;
  await card(page, first.home.teamId).focus(); await page.keyboard.press('Enter');
  await slot(page, first.matchId, 'away').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.manual__announce')).toContainText('不能安排同一支球隊');
  await expect(slot(page, first.matchId, 'away')).toContainText(first.away.displayName);
  await card(page, thirdId).click(); await slot(page, first.matchId, 'home').click();
  await expect(page.locator('.manual__replacement')).toContainText('替換');
  await expect(slot(page, first.matchId, 'home')).toContainText(first.home.displayName);
  await page.getByRole('button', { name: '確認替換', exact: true }).click();
  await expect(slot(page, first.matchId, 'home')).toContainText(teams.find(t => t.teamId === thirdId).shortName);
  await expect(card(page, thirdId)).toBeVisible();
  await expect(page.locator('.manual__checks')).toContainText('對戰不完整或重複');
  await page.getByRole('button', { name: '撤銷', exact: true }).click();
  await expect(slot(page, first.matchId, 'home')).toContainText(first.home.displayName);
  await card(page, thirdId).click(); await page.keyboard.press('Escape');
  await expect(card(page, thirdId)).toHaveAttribute('aria-pressed', 'false');
  expect(await calls(page)).toHaveLength(0);
});

test('桌機真 pointer 拖卡加入對戰，來源卡保留並可 Escape 取消 @admin', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium-desktop');
  await stub(page, { create: true }); await go(page);
  const handle = page.locator('.manual__team[data-team-id="t-1"] .manual__handle');
  await handle.scrollIntoViewIfNeeded(); const from = await handle.boundingBox();
  const target = slot(page, rr[0].matchId, 'home'); await target.scrollIntoViewIfNeeded();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await expect(page.locator('.manual__dragGhost')).toBeVisible();
  await page.mouse.up(); await expect(target).toContainText('野狼');
  await expect(card(page, 't-1')).toContainText('已安排 1／3 場');
  expect((await saved(page)).draft.matches[0].homeTeamId).toBe('t-1');
  const nextHandle = page.locator('.manual__team[data-team-id="t-2"] .manual__handle');
  const box = await nextHandle.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 60, box.y + 30);
  await expect(page.locator('.manual__dragGhost')).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page.locator('.manual__dragGhost')).toHaveCount(0); await page.mouse.up();
  expect((await saved(page)).draft.matches[0].awayTeamId).toBeNull();
  await card(page, 't-2').click(); await expect(card(page, 't-2')).toHaveAttribute('aria-pressed', 'true');
});

test('手機真觸控手把拖曳能邊緣捲頁落入位置，普通卡片滑動仍可捲頁 @admin', async ({ page }, info) => {
  test.skip(info.project.name === 'chromium-desktop');
  await stub(page, { create: true }); await go(page);
  const cdp = await page.context().newCDPSession(page);
  const handle = page.locator('.manual__team[data-team-id="t-1"] .manual__handle');
  await handle.evaluate(element => element.scrollIntoView({ block: 'center' })); const box = await handle.boundingBox();
  const size = page.viewportSize();
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await touch('touchStart', box.x + box.width / 2, box.y + box.height / 2);
  await touch('touchMove', box.x + box.width / 2, size.height - 18);
  await expect(page.locator('.manual__dragGhost')).toBeVisible();
  const target = slot(page, rr[0].matchId, 'home');
  await expect.poll(async () => { const rect = await target.boundingBox(); return rect.y > 80 && rect.y + rect.height < size.height - 70; }, { timeout: 12_000 }).toBe(true);
  const destination = await target.boundingBox();
  await touch('touchMove', destination.x + destination.width / 2, destination.y + destination.height / 2);
  await touch('touchEnd'); await expect(target).toContainText('野狼');
  await expect(card(page, 't-1')).toHaveCount(1);
  await card(page, 't-2').evaluate(element => element.scrollIntoView({ block: 'center' })); const normal = await card(page, 't-2').boundingBox();
  const beforeScroll = await page.evaluate(() => scrollY);
  await touch('touchStart', normal.x + normal.width / 2, normal.y + normal.height / 2);
  await touch('touchMove', normal.x + normal.width / 2, Math.max(20, normal.y - 130)); await touch('touchEnd');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(beforeScroll);
  await expect(page.locator('.manual__dragGhost')).toHaveCount(0);
  await cdp.detach();
});

test('新建草稿漏排不發布，晉級來源不可任意改，安排全套後只送白名單一次 @admin', async ({ page }) => {
  test.setTimeout(90_000);
  await stub(page, { create: true }); await go(page);
  await expect(page.locator('.manual__source')).toHaveCount(4);
  await preview(page); await expect(page.getByRole('button', { name: '確認整批發布', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '返回調整', exact: true }).click();
  for (const match of rr) {
    await card(page, match.home.teamId).click(); await slot(page, match.matchId, 'home').click();
    await card(page, match.away.teamId).click(); await slot(page, match.matchId, 'away').click();
  }
  for (let index = 0; index < plan.matches.length; index++) {
    const id = plan.matches[index].matchId;
    await time(page, id).selectOption(String(timeOf(index))); await venue(page, id).selectOption('venue-a');
  }
  expect(Object.keys(await dump(page)).filter(key => key.startsWith(`${BASE}/matches/`))).toHaveLength(0);
  await preview(page); await expect(page.locator('.manual__preview')).toContainText('發布後');
  await page.getByRole('button', { name: '確認整批發布', exact: true }).click();
  await expect(page.locator('.toast--success')).toContainText('已整批發布 8 場');
  const sent = await calls(page); expect(sent).toHaveLength(1);
  expect(sent[0].payload.reason).toBe('主辦確認對戰與時段');
  for (const row of sent[0].payload.draft.matches) expect(Object.keys(row).sort()).toEqual(['awayTeamId', 'homeTeamId', 'kickoffAt', 'matchId', 'venueId']);
  expect((await dump(page))[`${BASE}/divisions/adult-open`].schedulePublished).toBe(true);
});

test('已開打組鎖定全部對手，已開打場次全鎖，未開打時段仍可改且結果保留 @admin', async ({ page }) => {
  await stub(page, { started: true }); await go(page);
  await expect(card(page, 't-1')).toBeDisabled();
  for (const match of rr) { await expect(slot(page, match.matchId, 'home')).toBeDisabled(); await expect(slot(page, match.matchId, 'away')).toBeDisabled(); }
  await expect(time(page, rr[0].matchId)).toBeDisabled(); await expect(venue(page, rr[0].matchId)).toBeDisabled();
  await expect(time(page, rr[1].matchId)).toBeEnabled();
  await time(page, rr[1].matchId).selectOption(String(timeOf(1) + 5 * 60_000));
  await preview(page); await page.getByRole('button', { name: '確認整批發布', exact: true }).click();
  await expect(page.locator('.toast--success')).toContainText('已整批發布');
  const first = (await dump(page))[`${BASE}/matches/${rr[0].matchId}`];
  expect(first.score).toEqual({ home: 2, away: 1 }); expect(first.result).toEqual({ winner: 'home' }); expect(first.status).toBe('finished');
});

test('既有六隊九場已開打但僅四核准：保留F6並明示名單問題、不轉成F4發布 @admin', async ({ page }) => {
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  const sixFormat = FORMATS.F6_TWO_GROUPS_MIRROR;
  const sixDivision = { ...division, formatId: sixFormat.formatId };
  const sixTeams = Array.from({ length: 6 }, (_, index) => ({ ...teams[index % 4], teamId: `t-${index + 1}`,
    name: `球隊${index + 1}`, shortName: `球隊${index + 1}`, seed: index + 1 }));
  const sixPlan = planGeneration({ division: sixDivision, orderedTeams: sixTeams, format: sixFormat });
  expect(sixPlan.matches).toHaveLength(9);
  const docs = seed();
  for (const key of Object.keys(docs)) if (key.startsWith(`${BASE}/teams/`) || key.startsWith(`${BASE}/matches/`)) delete docs[key];
  docs['config/formats'] = { formats: { [format.formatId]: format, [sixFormat.formatId]: sixFormat } };
  docs[`${BASE}/divisions/adult-open`] = sixDivision;
  for (const team of sixTeams) docs[`${BASE}/teams/${team.teamId}`] = { ...team,
    groupId: sixPlan.assignments.find(assignment => assignment.teamId === team.teamId).groupId,
    status: team.seed <= 4 ? 'approved' : 'pending' };
  sixPlan.matches.forEach((match, index) => {
    docs[`${BASE}/matches/${match.matchId}`] = { ...matchDocOf({ m: match, division: sixDivision, eventId: EVENT }),
      kickoffAt: timeOf(index), venueId: 'venue-a', venueName: '甲場',
      ...(index === 0 ? { status: 'finished', score: { home: 2, away: 1 }, result: { winner: 'home' } } : {}) };
  });
  await stub(page, { docs }); await page.goto('/#/admin/schedule');
  await expect(page.getByRole('button', { name: '手動安排', exact: true })).toBeEnabled();
  const before = await dump(page);
  await page.getByRole('button', { name: '手動安排', exact: true }).click();
  const issue = page.getByRole('alert', { name: '手動賽程設定問題' });
  await expect(issue).toContainText(`既有 9 場沿用賽制：${sixFormat.name}`);
  await expect(issue).toContainText('需要 6 隊，目前核准 4 隊');
  await expect(issue).toContainText('請先到報名審核確認參賽名單');
  await expect(page.locator('.manual__workspace')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '確認整批發布', exact: true })).toHaveCount(0);
  expect(await calls(page)).toHaveLength(0); expect(await dump(page)).toEqual(before); expect(await saved(page)).toBeNull();
  await page.getByRole('button', { name: '自動／逐場調整', exact: true }).click();
  await expect(page.locator('.adm')).toContainText(`改用隊數相同的「${format.name}」`);
  expect(pageErrors).toEqual([]);
});

test('既有賽制範本缺失時明示設定問題，可進入手動模式且不改用其他四隊範本 @admin', async ({ page }) => {
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  const docs = seed({ started: true });
  const alternative = { ...format, formatId: 'F4_ALTERNATIVE', name: '其他四隊範本' };
  docs['config/formats'] = { formats: { [alternative.formatId]: alternative } };
  await stub(page, { docs }); await page.goto('/#/admin/schedule');
  await expect(page.getByRole('button', { name: '手動安排', exact: true })).toBeEnabled();
  const before = await dump(page);
  await page.getByRole('button', { name: '手動安排', exact: true }).click();
  const issue = page.getByRole('alert', { name: '手動賽程設定問題' });
  await expect(issue).toContainText(`既有 8 場沿用賽制：${division.formatId}`);
  await expect(issue).toContainText('找不到既有場次使用的完整賽制範本');
  await expect(issue).toContainText('請主辦先確認組別的賽制設定');
  await expect(page.locator('.manual__workspace')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '確認整批發布', exact: true })).toHaveCount(0);
  expect(await calls(page)).toHaveLength(0); expect(await dump(page)).toEqual(before); expect(pageErrors).toEqual([]);
});

test('核准隊數相同但既有對戰球隊不在名單，先提示報名審核並阻擋手動發布 @admin', async ({ page }) => {
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  const docs = seed({ started: true });
  docs[`${BASE}/teams/t-4`].status = 'pending';
  docs[`${BASE}/teams/t-5`] = { ...teams[3], teamId: 't-5', name: '新球隊', shortName: '新球隊' };
  await stub(page, { docs }); await page.goto('/#/admin/schedule');
  await expect(page.getByRole('button', { name: '手動安排', exact: true })).toBeEnabled();
  const before = await dump(page);
  await page.getByRole('button', { name: '手動安排', exact: true }).click();
  const issue = page.getByRole('alert', { name: '手動賽程設定問題' });
  await expect(issue).toContainText(`既有 8 場沿用賽制：${format.name}`);
  await expect(issue).toContainText('既有對戰中的 晨星 不在目前核准的參賽名單');
  await expect(page.getByRole('button', { name: '去報名審核', exact: true })).toBeVisible();
  await expect(page.locator('.manual__workspace')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '確認整批發布', exact: true })).toHaveCount(0);
  expect(await calls(page)).toHaveLength(0); expect(await dump(page)).toEqual(before); expect(pageErrors).toEqual([]);
});

test('整批預覽明示前後差異與場地，原因必填，撞場擋發布 @admin', async ({ page }) => {
  await stub(page); await go(page);
  await time(page, rr[0].matchId).selectOption(String(timeOf(1)));
  await preview(page, '');
  await expect(page.locator('.manual__preview')).toContainText('原本：'); await expect(page.locator('.manual__preview')).toContainText('甲場');
  await expect(page.locator('.manual__checks')).toContainText('同時排了兩場');
  await expect(page.getByRole('button', { name: '確認整批發布', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: '手動賽程發布原因' }).fill('調整');
  await expect(page.getByRole('button', { name: '確認整批發布', exact: true })).toBeDisabled(); expect(await calls(page)).toHaveLength(0);
  await page.getByRole('button', { name: '返回調整', exact: true }).click();
  await time(page, rr[0].matchId).selectOption(String(dateMs + 5 * 60_000)); await preview(page, '');
  await expect(page.getByRole('button', { name: '確認整批發布', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: '手動賽程發布原因' }).fill('調整'); await expect(page.getByRole('button', { name: '確認整批發布', exact: true })).toBeEnabled();
});

test('發布回應遺失後保留 exact payload 與 operationId，重送只產生一筆稽核 @admin', async ({ page }) => {
  await stub(page); await go(page);
  await time(page, rr[0].matchId).selectOption(String(dateMs + 5 * 60_000)); await preview(page);
  await page.evaluate(() => { window.__FAKE_MANUAL_LOST_RESPONSE = true; });
  await page.getByRole('button', { name: '確認整批發布', exact: true }).click();
  await expect(page.locator('.manual__failure')).toContainText('尚未確認');
  await expect(time(page, rr[0].matchId)).toBeDisabled();
  const first = (await calls(page))[0]; expect((await saved(page)).pending.operationId).toBe(first.payload.operationId);
  await page.getByRole('button', { name: '重送原發布請求', exact: true }).click();
  await expect(page.locator('.toast--success')).toContainText('已整批發布');
  const sent = await calls(page); expect(sent).toHaveLength(2); expect(sent[1].payload).toEqual(sent[0].payload);
  const audits = Object.entries(await dump(page)).filter(([path, row]) => path.startsWith(`${BASE}/audits/`) && row.action === 'schedule.manual.publish');
  expect(audits).toHaveLength(1); expect(await saved(page)).toBeNull();
});

test('不完整回應不假成功，處理中防重複，換頁清除拖曳與延遲完成通知 @admin', async ({ page }) => {
  await stub(page); await go(page); await preview(page);
  await page.evaluate(() => { window.__FAKE_MANUAL_RESULT = {}; });
  await page.getByRole('button', { name: '確認整批發布', exact: true }).click();
  await expect(page.locator('.manual__failure')).toContainText('尚未確認'); await expect(page.locator('.toast--success')).toHaveCount(0);
  await page.evaluate(() => {
    delete window.__FAKE_MANUAL_RESULT;
    window.__FAKE_MANUAL_PENDING = new Promise(resolve => { window.__releaseManual = resolve; });
  });
  await page.getByRole('button', { name: '重送原發布請求', exact: true }).click();
  await expect(page.locator('.manual__status')).toContainText('發布中');
  await expect(page.getByRole('button', { name: '手動安排', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '確認整批發布', exact: true })).toBeDisabled();
  await page.goto('/#/'); await page.evaluate(() => window.__releaseManual());
  await expect(page.locator('.manual')).toHaveCount(0); await expect(page.locator('.manual__dragGhost')).toHaveCount(0);
  await expect(page.locator('.toast--success')).toHaveCount(0);
  expect(await calls(page)).toHaveLength(2);
});

test('過期草稿保留舊版並阻擋新發布，權限改變不可繼續操作 @admin', async ({ page }) => {
  await stub(page); await go(page);
  await time(page, rr[0].matchId).selectOption(String(dateMs + 5 * 60_000)); await preview(page);
  await page.evaluate(({ base, div }) => { window.__fake.__seed({ [`${base}/divisions/adult-open`]: { ...div, scheduleRevision: 1 } }); }, { base: BASE, div: division });
  await page.getByRole('button', { name: '確認整批發布', exact: true }).click();
  await expect(page.locator('.manual')).toContainText('草稿不能直接發布'); await expect(time(page, rr[0].matchId)).toBeDisabled();
  const old = await saved(page); expect(old.draft.expectedRevision).toBe(0);
  await page.getByRole('button', { name: '重新載入賽程', exact: true }).click();
  await expect(page.locator('.manual')).toContainText('草稿不能直接發布');
  await page.getByRole('button', { name: '以目前賽程建立新草稿', exact: true }).click();
  await expect(time(page, rr[0].matchId)).toHaveValue(String(dateMs));
  expect((await saved(page)).draft.expectedRevision).toBe(1);
  expect(await page.evaluate(() => !!localStorage.getItem('feda:manual-schedule:v1:manual-admin:feda-cup-2026:adult-open:0'))).toBe(true);
  await page.evaluate(({ uid, event }) => {
    window.__fake.__seed({ [`staff/${uid}`]: { uid, roles: ['scorer'], active: true, assignment: { eventId: event } } });
    window.__fake.__setUser({ uid, displayName: '權限已變更' });
  }, { uid: UID, event: EVENT });
  await expect(page.locator('.adm')).toContainText('管理員');
  await expect(page.getByRole('button', { name: '確認整批發布', exact: true })).toHaveCount(0);
});

test('長隊名安全文字，320px 深淺色無橫向溢出且卡片手把至少44px @admin @narrow', async ({ page }) => {
  await stub(page, { longName: true }); await go(page);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await page.locator('.manual img,.manual b').count()).toBe(0);
    await expect(card(page, 't-1')).toContainText('<b>測試超長隊名</b>');
    const box = await page.locator('.manual__handle').first().boundingBox(); expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test('離線仍能保留草稿，發布不送出，裝置儲存失敗明示 @admin', async ({ page, context }) => {
  await stub(page); await go(page);
  await context.setOffline(true);
  await time(page, rr[0].matchId).selectOption(String(dateMs + 5 * 60_000));
  expect((await saved(page)).draft.matches[0].kickoffAt).toBe(dateMs + 5 * 60_000);
  await preview(page); await page.getByRole('button', { name: '確認整批發布', exact: true }).click();
  await expect(page.locator('.manual__failure')).toContainText('發布需要連線'); expect(await calls(page)).toHaveLength(0);
  await context.setOffline(false);
  await page.getByRole('button', { name: '返回調整', exact: true }).click();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await time(page, rr[0].matchId).selectOption(String(dateMs + 10 * 60_000));
  await expect(page.locator('.manual')).toContainText('裝置無法儲存草稿');
  await expect(time(page, rr[0].matchId)).toHaveValue(String(dateMs + 10 * 60_000));
});

test('標準手動工作台深淺色與寬窄版視覺驗收 @admin', async ({ page }, info) => {
  await stub(page); await go(page);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === getComputedStyle(document.documentElement).backgroundColor);
    await page.locator('.manual__workspace').evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `tools/manual-schedule-${info.project.name}-${theme}.png`, fullPage: false });
    if (info.project.name !== 'chromium-desktop') {
      await page.locator('.manual__match').first().evaluate(element => { element.scrollIntoView({ block: 'start' }); window.scrollBy(0, -72); });
      await page.screenshot({ path: `tools/manual-schedule-${info.project.name}-${theme}-fixture.png`, fullPage: false });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.getByRole('button', { name: '自動／逐場調整', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: '手動安排', exact: true })).toHaveAttribute('aria-pressed', 'true');
    if (info.project.name === 'chromium-desktop') {
      const size = await page.locator('.adm--manual').boundingBox(); expect(size.width).toBeGreaterThan(1000);
    }
  }
});

test('20場分組／階段篩選不丟草稿，隱藏場次仍檢查並完整送出 @admin', async ({ page }) => {
  const eightFormat = FORMATS.F8_GROUP_CROSS;
  const eightDivision = { ...division, formatId: eightFormat.formatId };
  const eightTeams = Array.from({ length: 8 }, (_, index) => ({ ...teams[index % 4], teamId: `t-${index + 1}`, name: `球隊${index + 1}`, shortName: `球隊${index + 1}`, seed: index + 1 }));
  const eightPlan = planGeneration({ division: eightDivision, orderedTeams: eightTeams, format: eightFormat });
  const docs = seed();
  for (const key of Object.keys(docs)) if (key.startsWith(`${BASE}/teams/`) || key.startsWith(`${BASE}/matches/`)) delete docs[key];
  docs['config/formats'] = { formats: { [eightFormat.formatId]: eightFormat } };
  docs[`${BASE}/divisions/adult-open`] = eightDivision;
  for (const team of eightTeams) docs[`${BASE}/teams/${team.teamId}`] = { ...team, groupId: eightPlan.assignments.find(a => a.teamId === team.teamId).groupId };
  const groups = eightPlan.matches.filter(m => m.stageId === 'group');
  const placement = eightPlan.matches.filter(m => m.stageId === 'placement');
  const final = eightPlan.matches.filter(m => m.stageId === 'final');
  for (const match of eightPlan.matches) {
    const position = match.stageId === 'group' ? groups.indexOf(match) : match.stageId === 'placement' ? placement.indexOf(match) : final.indexOf(match);
    const kickoffAt = match.stageId === 'group' ? timeOf(position % 6) :
      match.stageId === 'placement' ? dateMs + (6 * 60 + Math.floor(position / 2) * 40) * 60_000 :
        dateMs + (7 * 60 + 20 + Math.floor(position / 2) * 40) * 60_000;
    const venueId = match.stageId === 'group' ? (match.groupId === 'A' ? 'venue-a' : 'venue-b') : (position % 2 ? 'venue-b' : 'venue-a');
    docs[`${BASE}/matches/${match.matchId}`] = { ...matchDocOf({ m: match, division: eightDivision, eventId: EVENT }), kickoffAt, venueId, venueName: venueId === 'venue-a' ? '甲場' : '乙場' };
  }
  await stub(page, { docs }); await go(page);
  await expect(page.locator('.manual__match')).toHaveCount(20);
  const filter = page.getByRole('combobox', { name: '顯示手動賽程場次' });
  await filter.selectOption('group:group:A'); await expect(page.locator('.manual__match')).toHaveCount(6);
  const a = groups.find(m => m.groupId === 'A');
  await time(page, a.matchId).selectOption(String(dateMs + 5 * 60_000));
  await filter.selectOption('group:group:B'); await expect(page.locator('.manual__match')).toHaveCount(6);
  const b = groups.find(m => m.groupId === 'B');
  await time(page, b.matchId).selectOption(String(dateMs + 10 * 60_000));
  await filter.selectOption('stage:final'); await expect(page.locator('.manual__match')).toHaveCount(4);
  await venue(page, final[0].matchId).selectOption('');
  await filter.selectOption('group:group:A'); await preview(page);
  await expect(page.getByRole('button', { name: '確認整批發布', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '返回調整', exact: true }).click();
  await filter.selectOption('stage:final'); await venue(page, final[0].matchId).selectOption('venue-a');
  await filter.selectOption('group:group:A'); await expect(time(page, a.matchId)).toHaveValue(String(dateMs + 5 * 60_000));
  await preview(page); await page.getByRole('button', { name: '確認整批發布', exact: true }).click();
  await expect(page.locator('.toast--success')).toContainText('已整批發布 20 場');
  const sent = (await calls(page))[0].payload.draft.matches;
  expect(sent).toHaveLength(20); expect(sent.find(m => m.matchId === b.matchId).kickoffAt).toBe(dateMs + 10 * 60_000);
  expect(sent.some(m => m.matchId === final[0].matchId && m.venueId === 'venue-a')).toBe(true);
});
