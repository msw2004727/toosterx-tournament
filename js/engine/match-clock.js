/** Match time correction; no team, score or event changes. */
const fail = message => { throw Object.assign(new Error(message), { code: 'invalid-argument' }); };
const millis = v => v?.toMillis?.() ?? (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : v?.seconds != null ? v.seconds * 1000 + Math.floor((v.nanoseconds ?? 0) / 1e6) : null);
export function clockEditBasis(match) {
  const c = match.clock ?? {};
  return { period: match.period ?? 'pre', status: match.status, locked: match.lock?.locked === true,
    resetRevision: match.resetRevision ?? 0, managementRevision: match.managementRevision ?? 0,
    running: c.running === true, periodStartedAt: millis(c.periodStartedAt), elapsedSecAtPause: c.elapsedSecAtPause ?? 0,
    clockPeriod: c.periodId ?? null, addedTimeSec: c.addedTimeSec ?? 0 };
}
export function clockPeriodFor(match, division) {
  if (['h1','h2','et1','et2'].includes(match.period)) return match.period;
  if (['h1','h2','et1','et2'].includes(match.clock?.periodId)) return match.clock.periodId;
  return division.periods === 1 ? 'h1' : match.period === 'ht' ? 'h1' : 'h2';
}
export function clockLimitSec(match, division) {
  if (![1,2].includes(division?.periods) || !Number.isFinite(division.matchDurationMin) || division.matchDurationMin <= 0) fail('讀不到組別比賽時長');
  const p = clockPeriodFor(match, division);
  return (p.startsWith('et') ? 5 : division.matchDurationMin / division.periods) * 60;
}
export function buildClockCorrection({ match, division, seconds, nowMs }) {
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) fail('請輸入有效的比賽時間（0 至 1440 分鐘）');
  if (!['live','halftime','finished','confirmed'].includes(match.status)) fail('此場次尚未開賽或無法修改時間');
  const limit = clockLimitSec(match, division);
  const running = match.status === 'live' && match.clock?.running === true;
  return { ...match.clock, running, periodStartedAt: running ? new Date(nowMs) : null,
    elapsedSecAtPause: seconds, addedTimeSec: Math.max(0, seconds - limit), periodId: clockPeriodFor(match, division) };
}
