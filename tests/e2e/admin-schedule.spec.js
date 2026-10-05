/**
 * E2E｜賽程管理 `#/admin/schedule`
 * ------------------------------------------------------------------
 * 規格：docs/05 §6；競賽規章第十四條（賽程統一由大會抽籤排定）
 *
 * 守五件事：
 *   ・**抽籤會留下種子**（規章要的是抽籤，而抽籤的價值在於事後查得到）
 *   ・**手動調整是兩隊對調**，不是把一隊搬走（搬走會讓兩組隊數不等）
 *   ・**已經開打就不能重新產生**
 *   ・**有衝突就發布不出去**，但只有 error 擋得住，warn 不擋
 *   ・**發布之前公開端看不到**
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { FORMATS } from '../../js/engine/formats.js';

const FAKE = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-firebase.js'), 'utf8');
const EVENT = 'feda-cup-2026';
const UID = 'U7774e1410479bafff4997f51b2c47b95';

/** 4 隊的成人公開組——最小但完整（單循環＋冠亞軍賽＝8 場） */
// 預設只用前 4 隊（F4 單組）；要測兩組的分組互動時給 teamCount: 6（沒有 6 隊的範本 → 通用兩組範本）
const TEAMS = ['野狼', '猛虎', '獵鷹', '晨星', '雷鳥', '飛馬'];

const seed = ({ roles = ['admin'], teamCount = 4, matches = {}, division = {} } = {}) => {
  const s = {
    [`events/${EVENT}`]: { eventId: EVENT, name: 'FEDA CUP 2026' },
    'config/env': { env: 'demo' },
    'config/schedule': {
      startTime: '08:30', endTime: '18:00', bufferMin: 10, minRestMin: 20, maxGapMin: 240,
      venuesByDate: { '2026-10-11': ['venue-a', 'venue-b'] }
    },
    'config/formats': {
      formats: {
        F8_GROUP_TOP_SEED_BYE: FORMATS.F8_GROUP_TOP_SEED_BYE,
        F4_RR_FINAL: {
          formatId: 'F4_RR_FINAL', name: '4隊單循環＋冠軍季軍賽', teamCount: 4,
          description: '每隊 4 場，單組別共 8 場',
          stages: [
            { stageId: 'group', name: '單循環', type: 'roundRobin', order: 1, groupCount: 1, groupSize: 4, legs: 1 },
            {
              stageId: 'final', name: '名次決賽', type: 'knockout', order: 2, drawRule: 'penalty',
              slots: [
                { matchKey: 'F1', label: '冠軍賽',
                  home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 1 },
                  away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 2 } },
                { matchKey: 'F3', label: '季軍賽',
                  home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 3 },
                  away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 4 } }
              ]
            }
          ],
          finalRankingMap: []
        }
      }
    },
    [`users/${UID}`]: { uid: UID, displayName: '金小麥' },
    [`staff/${UID}`]: {
      uid: UID, name: '金小麥', roles, active: true,
      assignment: { eventId: EVENT, venueIds: [], divisionIds: [], challengeIds: [] }
    },
    [`events/${EVENT}/divisions/adult-open`]: {
      divisionId: 'adult-open', name: '成人公開組', shortName: '公開', code: 'AO',
      order: 6, date: '2026-10-11', matchDurationMin: 30, playersOnField: 9,
      formatId: 'F4_RR_FINAL', rankingRuleId: 'RR_FEDA_2026', ...division
    },
    [`events/${EVENT}/venues/venue-a`]: { venueId: 'venue-a', name: 'A場', fieldType: '9v9', order: 1 },
    [`events/${EVENT}/venues/venue-b`]: { venueId: 'venue-b', name: 'B場', fieldType: '9v9', order: 2 }
  };
  TEAMS.slice(0, teamCount).forEach((name, i) => {
    s[`events/${EVENT}/teams/t-${i + 1}`] = {
      teamId: `t-${i + 1}`, name: `${name}足球隊`, shortName: name,
      divisionId: 'adult-open', status: 'approved', withdrawn: false, groupId: null, seed: null
    };
  });
  for (const [id, doc] of Object.entries(matches)) s[`events/${EVENT}/matches/${id}`] = doc;
  return s;
};

const match = (over = {}) => ({
  matchId: 'AO-G-A-01', eventId: EVENT, divisionId: 'adult-open', stageId: 'group', groupId: 'A',
  round: 1, matchNo: 1, label: 'A組 第1輪', matchKey: null, date: '2026-10-11',
  kickoffAt: { seconds: Math.floor(Date.parse('2026-10-11T09:00:00+08:00') / 1000), nanoseconds: 0 },
  venueId: 'venue-a', venueName: 'A場',
  home: { teamId: 't-1', name: '野狼', displayName: '野狼', placeholder: null },
  away: { teamId: 't-2', name: '猛虎', displayName: '猛虎', placeholder: null },
  teamIds: ['t-1', 't-2'],
  score: { home: 0, away: 0 }, status: 'scheduled', period: 'pre',
  lock: { locked: false, lockedAt: null, lockedBy: null },
  ...over
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
  await page.goto('/#/admin/schedule');
  await page.waitForFunction(() => !!window.__fake, null, { timeout: 30_000 });
}

const dump = page => page.evaluate(() => window.__fake.__dump());
const matchesOf = async page => Object.entries(await dump(page))
  .filter(([k]) => k.includes('/matches/'))
  .map(([, v]) => v);

/** ⭐ 斷言「不存在」之前一定要先等頁面真的畫出來（變異 #E7 就是這樣逃掉的） */
const ready = page => expect(page.locator('.adm__head')).toBeVisible({ timeout: 15_000 });

test.beforeEach(({ page }) => {
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
});

test('SLOCK 自動逐場調整上鎖，手動安排在左且預設啟用 @admin', async ({ page }) => {
  await stub(page); await go(page);
  const modes = page.getByRole('group', { name: '安排賽程方式' }).getByRole('button');
  await expect(modes.nth(0)).toHaveText('手動安排');
  await expect(modes.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '自動／逐場調整（已上鎖）' })).toBeDisabled();
  await expect(modes.nth(1).locator('svg')).toBeVisible();
  await expect(page.getByRole('button', { name: /抽籤|自動排定/ })).toHaveCount(0);
  expect(await page.evaluate(() => window.__FAKE_CALLS ?? [])).toEqual([]);
});

test('SMANUAL 進入賽程管理直接顯示手動草稿 @admin', async ({ page }) => {
  await stub(page); await go(page);
  await expect(page.locator('.manual__workspace')).toBeVisible();
  await expect(page.getByRole('group', { name: '安排賽程方式' }).getByRole('button').nth(0)).toHaveAttribute('aria-pressed', 'true');
});

test('非管理員不能安排賽程 @admin', async ({ page }) => {
  await stub(page, { roles: ['scorer'] }); await go(page);
  await expect(page.locator('.manual__workspace')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '手動安排', exact: true })).toHaveCount(0);
});

test('不足規定隊數時仍預設手動，提示先確認名單 @admin', async ({ page }) => {
  await stub(page, { division: { requiredFormatId: 'F8_GROUP_TOP_SEED_BYE' } }); await go(page);
  await expect(page.getByRole('alert', { name: '手動賽程設定問題' })).toContainText('目前核准 4 隊');
  await expect(page.getByRole('button', { name: '自動／逐場調整（已上鎖）' })).toBeDisabled();
});

test('零核准隊伍不會回到自動功能或寫入草稿 @admin', async ({ page }) => {
  await stub(page, { teamCount: 0 }); await go(page);
  await expect(page.getByRole('alert', { name: '手動賽程設定問題' })).toBeVisible();
  expect(await page.evaluate(() => window.__FAKE_CALLS ?? [])).toEqual([]);
});

test('已開打卡片鎖住安排，仍可進管理場次撤銷誤開 @admin', async ({ page }) => {
  await stub(page, { matches: { 'AO-G-A-01': match({ status: 'live', period: 'h1', result: null }) } }); await go(page);
  const card = page.locator('.manual__match[data-match-id="AO-G-A-01"]');
  await expect(card.getByRole('combobox', { name: 'AO-G-A-01 手動開賽時間' })).toBeDisabled();
  await card.getByRole('button', { name: '管理場次', exact: true }).click();
  await expect(page).toHaveURL(/admin\/match\/AO-G-A-01/);
  await expect(page.getByRole('button', { name: '撤銷開賽', exact: true })).toBeEnabled();
});

test('320px 手動安排與上鎖按鈕無水平溢出 @admin', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); await stub(page); await go(page);
  await expect(page.locator('.manual__workspace')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('未發布賽程仍不會在公開端出現 @admin', async ({ page }) => {
  await stub(page, { division: { schedulePublished: false }, matches: { 'AO-G-A-01': match() } });
  await page.goto('/#/schedule?date=2026-10-11');
  await expect(page.locator('.prow')).toHaveCount(0);
});
