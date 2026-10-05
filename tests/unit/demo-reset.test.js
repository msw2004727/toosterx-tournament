import { buildResetPatch, canReset, consequencesOf } from '../../js/engine/admin-match.js';
import { matchRecordMetadata, matchWriteMetadata } from '../../js/lib/match-write.js';
import { testTimeAt } from '../../js/modules/demo/time.js';
import { setActivityTimeSource, activityTime, isActivityTimeSimulated } from '../../js/core/activity-clock.js';
import { now } from '../../js/core/clock.js';
import { describeAudit } from '../../js/engine/audit.js';

test('歸零清掉比賽結果、時鐘、檢錄並啟用新世代，不包含賽程欄位', () => {
  const patch = buildResetPatch({ resetRevision: 2 }, 'admin');
  expect(patch).toMatchObject({ status: 'scheduled', period: 'pre', score: { home: 0, away: 0 },
    htScore: { home: null, away: null }, penaltyScore: { home: null, away: null }, result: null, revisionCount: 0,
    clock: { running: false, elapsedSecAtPause: 0 }, checkin: { homeConfirmed: false, awayConfirmed: false },
    lock: { locked: false }, resetRevision: 3, writeNonce: null, updatedBy: 'admin' });
  for (const key of ['matchId', 'home', 'away', 'venueId', 'kickoffAt', 'matchNo']) expect(patch).not.toHaveProperty(key);
  expect(buildResetPatch({}, 'admin').resetRevision).toBe(1);
  expect(canReset(null).ok).toBe(false); expect(canReset({ status: 'live' }).ok).toBe(true);
  expect(consequencesOf({ status: 'live' }, 'reset').join('')).toContain('現在進行中');
  expect(describeAudit({ action: 'match.reset', entityId: 'match-1' }).title).toContain('歸零並退回未開賽');
});
test('新紀錄包含歸零世代，父文件寫入另帶唯一識別；舊世代保留在既有 payload', () => {
  expect(matchWriteMetadata({})).toEqual({});
  const match = { resetRevision: 1 };
  const queued = matchWriteMetadata(match, 'nonce1');
  expect(queued).toEqual({ resetRevision: 1, writeNonce: 'nonce1' });
  expect(matchRecordMetadata(match)).toEqual({ resetRevision: 1 });
  match.resetRevision = 2;
  expect(queued).toEqual({ resetRevision: 1, writeNonce: 'nonce1' });
  expect(matchWriteMetadata(match, 'nonce2')).toEqual({ resetRevision: 2, writeNonce: 'nonce2' });
});
test('Demo 時間以真實經過秒數推進，兩小時或時間倒退後恢復真實時間', () => {
  const a = { time: Date.parse('2026-10-09T23:59:59+08:00'), startedAt: 1000 };
  expect(testTimeAt(a, 3000)).toBe(Date.parse('2026-10-10T00:00:01+08:00'));
  expect(testTimeAt(a, 1000 + 7200000)).toBeNull();
  expect(testTimeAt(a, 0)).toBeNull(); expect(testTimeAt(null, 1000)).toBeNull();
  setActivityTimeSource(() => a.time);
  expect(activityTime()).toBe(a.time); expect(isActivityTimeSimulated()).toBe(true);
  expect(Math.abs(now() - Date.now())).toBeLessThan(1000);
  setActivityTimeSource(null);
  expect(isActivityTimeSimulated()).toBe(false); expect(Math.abs(activityTime() - now())).toBeLessThan(1000);
});
