import { eventDateAt, selectedEventDate } from '../../js/engine/staff-date.js';
import { defaultPermsOf, impliedRoles, ROLE_INFO } from '../../js/config.js';
const dates = ['2026-10-09', '2026-10-10', '2026-10-11'];
const timezone = 'Asia/Taipei';
test.each([
  ['2026-10-01T00:00:00+08:00', dates[0]],
  ['2026-10-09T23:59:59+08:00', dates[0]],
  ['2026-10-09T16:00:00Z', dates[1]],
  ['2026-10-10T23:59:59+08:00', dates[1]],
  ['2026-10-10T16:00:00Z', dates[2]],
  ['2026-10-11T23:59:59+08:00', dates[2]],
  ['2027-01-01T00:00:00+08:00', dates[2]]
])('台北時間 %s 選擇 %s', (time, expected) => {
  expect(eventDateAt(Date.parse(time), dates, timezone)).toBe(expected);
});
test('manual choice stays pinned; invalid choice and returning to auto use today', () => {
  const opts = { nowMs: Date.parse('2026-10-10T12:00:00+08:00'), dates, timezone };
  expect(selectedEventDate({ ...opts, manualDate: dates[0] })).toBe(dates[0]);
  expect(selectedEventDate({ ...opts, manualDate: dates[2] })).toBe(dates[2]);
  expect(selectedEventDate({ ...opts, manualDate: '2026-10-08' })).toBe(dates[1]);
  expect(selectedEventDate(opts)).toBe(dates[1]);
});
test('new staff identity includes operational duties without administrative authority', () => {
  expect(ROLE_INFO.staff.label).toBe('賽務員');
  expect(impliedRoles(['staff'])).toEqual(['booth', 'checkin', 'referee', 'scorer', 'staff']);
  const mine = defaultPermsOf('staff');
  for (const code of ['staff.access', 'checkin.write', 'member.read', 'matchsheet.write', 'match.period', 'match.score.write', 'match.finish', 'match.undo']) expect(mine).toContain(code);
  for (const code of ['staff.assign', 'perms.manage', 'team.manage', 'checkin.force', 'match.confirm', 'match.reopen', 'match.score.override', 'schedule.manage']) expect(mine).not.toContain(code);
});
