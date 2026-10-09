import { HOME_METRICS, campaignShares, displayedTraffic } from '../../js/engine/home-metrics.js';
const start = Date.parse('2026-10-09T12:00:00+08:00');
test('actual traffic keeps the disclosed 33 separate and does not invent failed/loading counts', () => {
  expect(displayedTraffic(0)).toBe(33); expect(displayedTraffic(12)).toBe(45);
  for (const bad of [null, undefined, -1, 1.5, NaN, '12']) expect(displayedTraffic(bad)).toBeNull();
});
test('six shares every completed ten-minute interval, with no early or refresh-dependent increments', () => {
  expect(campaignShares(start, start - 1)).toBe(33);
  expect(campaignShares(start, start + 599999)).toBe(33);
  expect(campaignShares(start, start + 600000)).toBe(39);
  expect(campaignShares(start, start + 1200000)).toBe(45);
  expect(campaignShares(start, start + 1200000)).toBe(45);
});
test('Taipei Oct 12 midnight is a permanent cap, including clients in other timezones', () => {
  expect(HOME_METRICS.shareEndsAtMs).toBe(Date.parse('2026-10-11T16:00:00Z'));
  const final = campaignShares(start, HOME_METRICS.shareEndsAtMs);
  expect(final).toBe(2193);
  expect(campaignShares(start, HOME_METRICS.shareEndsAtMs + 600000)).toBe(final);
  expect(campaignShares(start, HOME_METRICS.shareEndsAtMs + 86400000)).toBe(final);
  expect(campaignShares(null, start)).toBeNull();
});
