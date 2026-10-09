/** Actual traffic is stored separately from the explicitly disclosed campaign offsets. */
export const HOME_METRICS = Object.freeze({
  offset: 33, shareBase: 33, shareStep: 6, shareIntervalMs: 10 * 60 * 1000,
  shareEndsAtMs: Date.parse('2026-10-12T00:00:00+08:00'),
  heartbeatMs: 30 * 1000, presenceLifetimeMs: 90 * 1000
});

export function campaignShares(startedAtMs, nowMs) {
  if (!Number.isSafeInteger(startedAtMs) || !Number.isFinite(nowMs)) return null;
  const elapsed = Math.max(0, Math.min(nowMs, HOME_METRICS.shareEndsAtMs) - startedAtMs);
  return HOME_METRICS.shareBase + Math.floor(elapsed / HOME_METRICS.shareIntervalMs) * HOME_METRICS.shareStep;
}

export function displayedTraffic(realCount) {
  return Number.isSafeInteger(realCount) && realCount >= 0 ? realCount + HOME_METRICS.offset : null;
}
