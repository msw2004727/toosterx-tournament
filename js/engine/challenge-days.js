import { attemptMs, completesChallenge, pickBest, validAttemptValue } from './challenge.js';

export const DAILY_RULE = 'dailyChallengesCompleted';

export function dailyRewardSettings(dates, timeZone = 'Asia/Taipei') {
  if (timeZone !== 'Asia/Taipei' || !Array.isArray(dates) || !dates.length || new Set(dates).size !== dates.length
    || dates.some(date => typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) throw new Error('活動日期或時區設定無效');
  return { rule: DAILY_RULE, version: 'daily-challenges-v1', dates: [...dates].sort(), timeZone,
    entriesOnAllComplete: 1, maxEntriesPerPlayerPerDay: 1,
    dayWindows: Object.fromEntries(dates.map(date => {
      const startMs = Date.parse(`${date}T00:00:00+08:00`);
      return [date, { startMs, endMs: startMs + 86400000 }];
    })) };
}

/** All dates use the event timezone, independent of the phone timezone. */
export function activityDate(ms, timeZone = 'Asia/Taipei') {
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms);
  const part = type => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function selectedActivityDate(ms, dates, timeZone = 'Asia/Taipei') {
  const ordered = [...new Set(dates ?? [])].sort();
  if (!ordered.length) return null;
  const today = activityDate(ms, timeZone);
  return ordered.find(d => d >= today) ?? ordered[ordered.length - 1];
}

export function isChallengeOpen(challenge, date) {
  return challenge?.dailyOpen?.[date] === true;
}

/** New offline records keep the time of participation; legacy records use server time. */
export function attemptDate(attempt, timeZone = 'Asia/Taipei') {
  return activityDate(Number.isFinite(attempt?.recordedAtMs) ? attempt.recordedAtMs : attemptMs(attempt), timeZone);
}

export function validCompletion(attempt, challenge) {
  return completesChallenge(attempt, challenge) && validAttemptValue(attempt, challenge);
}

export function dailyProgress({ attempts = [], challenges = [], date, timeZone = 'Asia/Taipei' } = {}) {
  const open = challenges.filter(c => isChallengeOpen(c, date));
  const required = open.map(c => c.challengeId);
  const byDay = attempts.filter(a => attemptDate(a, timeZone) === date);
  const done = open.filter(c => byDay.some(a => a.challengeId === c.challengeId && validCompletion(a, c))).map(c => c.challengeId);
  const allComplete = required.length > 0 && done.length === required.length;
  const bests = Object.fromEntries(open.map(c => [c.challengeId, pickBest(byDay.filter(a => a.challengeId === c.challengeId && validAttemptValue(a, c)), c).attempt]));
  return { date, required, done, missing: required.filter(id => !done.includes(id)), total: required.length, allComplete, entries: allComplete ? 1 : 0, bests };
}

export function dailyQualification(attempts, challenges, rewards) {
  return Object.fromEntries((rewards?.dates ?? []).map(date => [date, dailyProgress({ attempts, challenges, date, timeZone: rewards.timeZone })]));
}

export function dailyStats(attempts, challenge, dates, timeZone) {
  return Object.fromEntries(dates.map(date => [date, new Set(attempts.filter(a => attemptDate(a, timeZone) === date && validCompletion(a, challenge)).map(a => a.playerId).filter(Boolean)).size]));
}
