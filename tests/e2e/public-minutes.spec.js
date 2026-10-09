import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const fake = fs.readFileSync('tests/e2e/fake-firebase.js', 'utf8');
const event = 'feda-cup-2026', matchId = 'clock-live', date = '2026-10-09';
const matchPath = `events/${event}/matches/${matchId}`;
const routes = division => [
  ['首頁', '/#/', '.prow .pbadge__text'],
  ['賽程', '/#/schedule', '.prow .pbadge__text'],
  ['組別', `/#/division/${division}?tab=schedule`, '.prow .pbadge__text'],
  ['球隊', '/#/team/home?tab=schedule', '.prow .pbadge__text'],
  ['直播牆', '/#/live', '.pwall .pbadge__text'],
  ['單場', `/#/match/${matchId}`, '#pmatch-status']
];

for (const [division, duration, minute] of [['women', 25, 23], ['adult-open', 30, 29]]) {
  for (const [name, route, selector] of routes(division)) {
    test(`${duration} 分鐘進行中賽事：${name}重新載入與持續更新皆顯示整場分鐘 @public`, async ({ page }) => {
      const time = new Date('2026-10-09T12:00:00+08:00');
      await page.clock.install({ time });
      const m = {
        matchId, eventId: event, divisionId: division, date, venueId: 'venue-a', venueName: 'A場',
        stageId: 'group', groupId: 'A', label: '分組賽', kickoffAt: '2026-10-09T11:30:00+08:00',
        home: { teamId: 'home', name: '主隊' }, away: { teamId: 'away', name: '客隊' },
        teamIds: ['home', 'away'], status: 'live', period: 'h1', score: { home: 2, away: 1 },
        clock: { running: true, periodStartedAt: new Date(time.getTime() - minute * 60000).toISOString(), elapsedSecAtPause: 0, addedTimeSec: 0 }
      };
      const seed = {
        'config/env': { env: 'demo' }, [`events/${event}`]: { eventId: event },
        [`events/${event}/divisions/${division}`]: { divisionId: division, name: '驗收組別', matchDurationMin: duration, periods: 1, playersOnField: 5, display: {} },
        [`events/${event}/venues/venue-a`]: { venueId: 'venue-a', name: 'A場', order: 1 },
        [`events/${event}/teams/home`]: { teamId: 'home', name: '主隊', divisionId: division, status: 'approved' },
        [`events/${event}/teams/away`]: { teamId: 'away', name: '客隊', divisionId: division, status: 'approved' },
        [matchPath]: m
      };
      await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fake }));
      await page.route('https://firestore.googleapis.com/**', r => r.fulfill({ status: 200, headers: { date: time.toUTCString() }, body: '{}' }));
      await page.route('https://static.line-scdn.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.liff={init:async()=>{},isInClient:()=>false,isLoggedIn:()=>false};' }));
      await page.addInitScript(s => { window.__FAKE_SEED = s; window.__seedData = s; window.__FAKE_USER = null; }, seed);
      await page.goto(route);
      const badge = page.locator(selector).first();
      await expect(badge).toHaveText(`${minute}'`, { timeout: 15000 });
      await page.clock.runFor(1200);
      await expect(badge).toHaveText(`${minute}'`);
      await page.reload();
      await expect(badge).toHaveText(`${minute}'`, { timeout: 15000 });
      expect(await page.evaluate(p => window.__fake.__dump()[p], matchPath)).toEqual(m);
    });
  }
}
