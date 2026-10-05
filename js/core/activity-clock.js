import { now } from './clock.js';

// Event participation time can be supplied by a test host. Security windows,
// sync timestamps and football clocks always keep using the real server clock.
let source = null;
export function setActivityTimeSource(getTime) { source = typeof getTime === 'function' ? getTime : null; }
export function activityTime() {
  const simulated = source?.();
  return Number.isFinite(simulated) ? simulated : now();
}
export function isActivityTimeSimulated() { return Number.isFinite(source?.()); }
