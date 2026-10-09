import { dailyProgress, attemptDate } from './challenge-days.js';
import { attemptMs } from './challenge.js';

export const ROUND_VERSION = 'daily-rounds-v1';
export const roundsEnabled = rewards => rewards?.rule === 'dailyChallengesCompleted' && rewards?.roundsEnabled === true;
export const recordCode = (attempt, playerId) => attempt.roundCode ?? playerId;

/** Each code owns its records. A completed round keeps its required-set snapshot. */
export function roundProgress({ player, playerId, attempts = [], challenges = [], date, timeZone = 'Asia/Taipei', history = [], nowMs = 0 }) {
  const stored = player?.challengeRounds?.[date];
  const legacy = player?.challengeDays?.[date];
  const rows = stored?.length ? stored : [{ number: 1, code: playerId, startedAtMs: 0,
    ...(legacy?.entries === 1 && legacy.requiredChallengeIds?.length ? { lockedRequired: legacy.requiredChallengeIds } : {}) }];
  const ordered = [...challenges].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.challengeId.localeCompare(b.challengeId));
  const mine = attempts.filter(a => attemptDate(a, timeZone) === date);
  const rounds = rows.map(row => {
    const records = mine.filter(a => recordCode(a, playerId) === row.code);
    const calculate = (required, data = records) => dailyProgress({ attempts: data, date, timeZone,
      challenges: ordered.map(c => ({ ...c, dailyOpen: { [date]: required.includes(c.challengeId) } })) });
    let lockedRequired = row.lockedRequired;
    // The history is durable: a delayed trigger cannot lose a completion that preceded reopening.
    if (!lockedRequired?.length) {
      for (const period of history.filter(h => h.date === date).sort((a, b) => a.cutoffMs - b.cutoffMs)) {
        const before = records.filter(a => {
          const committed = attemptMs({ createdAt: a.createdAt });
          return committed != null && committed <= period.cutoffMs && !a.pending;
        });
        if (calculate(period.required, before).allComplete) { lockedRequired = period.required; break; }
      }
    }
    const required = lockedRequired?.length ? lockedRequired : ordered.filter(c => c.dailyOpen?.[date] === true).map(c => c.challengeId);
    const progress = calculate(required);
    if (progress.allComplete && !lockedRequired?.length) lockedRequired = [...required];
    return { ...row, ...(lockedRequired?.length ? { lockedRequired: [...lockedRequired] } : {}),
      required: [...required], done: progress.done, missing: progress.missing, total: progress.total,
      entries: progress.entries, qualifiedAtMs: row.qualifiedAtMs ?? (progress.allComplete ? nowMs : null), bests: progress.bests };
  });
  return { rounds, entries: rounds.reduce((n, r) => n + r.entries, 0), activeCode: rounds.at(-1).code,
    done: [...new Set(rounds.flatMap(r => r.done))] };
}

/** Persistence whitelist; no scores, staff identity, timestamps from the SDK or undefined fields. */
export function storedRounds(rounds) {
  return rounds.map(({ number, code, startedAtMs = 0, lockedRequired, required, done, entries, qualifiedAtMs }) => ({
    number, code, startedAtMs, ...(lockedRequired?.length ? { lockedRequired } : {}), required, done, entries, qualifiedAtMs
  }));
}

export function allRoundDays({ player, playerId, attempts, challenges, rewards, history = [], nowMs = 0 }) {
  const progress = Object.fromEntries(rewards.dates.map(date => [date,
    roundProgress({ player, playerId, attempts, challenges, date, timeZone: rewards.timeZone, history, nowMs })]));
  return {
    challengeRounds: Object.fromEntries(Object.entries(progress).map(([date, p]) => [date, storedRounds(p.rounds)])),
    challengeDays: Object.fromEntries(Object.entries(progress).map(([date, p]) => [date, {
      completedChallengeIds: p.done, requiredChallengeIds: p.rounds.at(-1).required, entries: p.entries
    }])),
    luckyDrawEntries: Object.values(progress).reduce((n, p) => n + p.entries, 0)
  };
}
