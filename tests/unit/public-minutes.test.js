/** @jest-environment jsdom */
import { statusText, statusBadge, matchRow } from '../../js/modules/public/bits.js';

const match = seconds => ({
  matchId: 'live-fixture', status: 'live', period: 'h1',
  clock: { running: false, elapsedSecAtPause: seconds },
  home: { name: '主隊' }, away: { name: '客隊' }, score: { home: 2, away: 1 }
});

describe('公開比賽分鐘依組別整場時間顯示', () => {
  test.each([
    [25, 19 * 60, "19'"], [25, 23 * 60, "23'"], [25, 24 * 60, "24'"],
    [25, 25 * 60, "25'"], [25, 26 * 60, "25+1'"],
    [30, 16 * 60, "16'"], [30, 29 * 60, "29'"],
    [30, 30 * 60, "30'"], [30, 31 * 60, "30+1'"]
  ])('%i 分鐘單節賽在 %i 秒顯示 %s，原場次資料不變', (duration, seconds, expected) => {
    const m = match(seconds), before = JSON.stringify(m);
    expect(statusText(m, duration, 1)).toBe(expected);
    expect(statusBadge(m, duration, 1).querySelector('.pbadge__text').textContent).toBe(expected);
    const row = matchRow({ match: m, division: { matchDurationMin: duration, periods: 1 } });
    expect(row.querySelector('.pbadge__text').textContent).toBe(expected);
    expect(row.querySelector('button').getAttribute('aria-label')).toContain(expected);
    expect(JSON.stringify(m)).toBe(before);
  });

  test('兩個半場的設定仍支援真正的半場補時', () => {
    expect(statusText(match(17 * 60), 30, 2)).toBe("15+2'");
    expect(statusText({ ...match(17 * 60), period: 'h2' }, 30, 2)).toBe("30+2'");
  });
});
