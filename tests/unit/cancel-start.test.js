import { matchDocOf } from '../../js/engine/schedule-doc.js';
import { canCancelStart, buildCancelStartPatch, consequencesOf } from '../../js/engine/admin-match.js';
const m = { status: 'live', period: 'h1', score: { home: 0, away: 0 }, result: null, lock: { locked: false }, resetRevision: 2 };
test('CANCELPATCH 保留檢錄；重新取得寫入世代；清除誤開時鐘', () => {
  expect(buildCancelStartPatch({ ...m, checkin: { homeConfirmed: true, awayConfirmed: true } }, 'a')).toEqual({ status: 'ready', period: 'pre',
    clock: { running: false, periodStartedAt: null, elapsedSecAtPause: 0, addedTimeSec: 0 }, scoreSubmittedAt: null, scoreSubmittedBy: null, resetRevision: 3, writeNonce: null, updatedBy: 'a' });
  expect(buildCancelStartPatch({ ...m, checkin: { homeConfirmed: true } }, 'a').status).toBe('checkin');
  expect(buildCancelStartPatch({ ...m, resetRevision: undefined }, 'a').status).toBe('scheduled');
  expect(buildCancelStartPatch({ ...m, resetRevision: undefined }, 'a').resetRevision).toBe(1);
  expect(consequencesOf(m, 'cancelStart').join('')).toContain('保留檢錄');
});
test.each([{ status: 'finished' }, { period: 'h2' }, { score: { home: 1, away: 0 } }, { score: { home: null, away: 0 } },
  { result: { winner: 'draw' } }, { penaltyScore: { home: 0, away: 0 } }, { htScore: { home: 1, away: 0 } }, { result: { winner: null, method: 'regulation' } }, { result: { homePoints: 1 } }, { walkoverSide: 'home' }, { lock: { locked: true } }, { revisionCount: 1 }])('CANCELGUARD 已打比賽不能撤銷 %j', patch => {
  expect(canCancelStart({ ...m, ...patch }).ok).toBe(false);
  expect(() => buildCancelStartPatch({ ...m, ...patch }, 'a')).toThrow();
});
test('CANCELEVENT 唯有第一節開賽事件可以撤銷，包括作廢進球也必須歸零', () => {
  expect(canCancelStart(m, [{ type: 'period_start', periodId: 'h1' }]).ok).toBe(true);
  for (const e of [{ type: 'goal', voided: true }, { type: 'period_start', periodId: 'h2' }, { type: 'period_end', periodId: 'h1' }]) expect(canCancelStart(m, [e]).ok).toBe(false);
  expect(canCancelStart(null).ok).toBe(false);
});

test('CANCELDEFAULT 實際新建場次的半場0:0及空白結果不能誤鎖撤銷', () => {
  const fixture = matchDocOf({ m: { matchId: 'm', home: { teamId: 'h' }, away: { teamId: 'a' } }, division: { divisionId: 'd' }, eventId: 'e' });
  expect(fixture.htScore).toEqual({ home: 0, away: 0 });
  expect(fixture.result).toEqual({ winner: null, method: null, homePoints: 0, awayPoints: 0 });
  const live = { ...fixture, status: 'live', period: 'h1' };
  expect(canCancelStart(live, [{ type: 'period_start', periodId: 'h1' }]).ok).toBe(true);
  expect(buildCancelStartPatch(live, 'a').status).toBe('scheduled');
  expect(canCancelStart(live, [{ type: 'period_end', periodId: 'h1' }]).ok).toBe(false);
});
