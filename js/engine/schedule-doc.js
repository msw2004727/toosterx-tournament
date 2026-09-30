/** 賽程計畫與 Firestore 文件形狀，前端預覽與伺服器共用。 */
import { buildGroups, buildMatches } from './schedule.js';

export function planGeneration({ division, orderedTeams, format }) {
  const rr = (format?.stages ?? []).find(s => s.type === 'roundRobin');
  const groups = buildGroups(orderedTeams, rr?.groupCount ?? 1);
  const { stages, groups: groupDocs, matches, groupAssign } =
    buildMatches({ division, format, groups });

  return {
    stages,
    groupDocs,
    matches,
    groups,
    assignments: orderedTeams.map((t, i) => ({
      teamId: t.teamId, seed: i + 1, groupId: groupAssign[t.teamId] ?? null
    }))
  };
}

/**
 * 完整的場次文件（新產生的場次）。
 *
 * 欄位照 docs/01b §1.7，跟 `scripts/seed/build.js` 寫的同一套——
 * 少一個欄位不會報錯，只會讓賽務台在比賽當天讀到 undefined。
 */
export function matchDocOf({ m, division, eventId, matchNo = null, venueName = null }) {
  return {
    matchId: m.matchId, eventId,
    divisionId: m.divisionId, stageId: m.stageId, groupId: m.groupId,
    round: m.round, matchNo, label: m.label,
    matchKey: m.matchKey ?? null,
    date: division.date ?? null,
    kickoffAt: m.kickoffMs != null ? new Date(m.kickoffMs) : null,
    venueId: m.venueId ?? null, venueName,
    home: m.home, away: m.away, teamIds: m.teamIds ?? [],
    score: { home: 0, away: 0 }, htScore: { home: 0, away: 0 },
    penaltyScore: { home: null, away: null },
    status: 'scheduled', period: 'pre',
    clock: { running: false, periodStartedAt: null, elapsedSecAtPause: 0, addedTimeSec: 0 },
    result: { winner: null, method: null, homePoints: 0, awayPoints: 0 },
    walkoverSide: null, walkoverReason: null,
    officials: { referee: null, assistants: [], scorer: null },
    stream: { enabled: false, provider: 'youtube', videoId: null, startOffsetSec: 0, status: 'off' },
    checkin: { homeConfirmed: false, awayConfirmed: false, confirmedAt: null },
    lock: { locked: false, lockedAt: null, lockedBy: null },
    scoreMismatch: false, revisionCount: 0
  };
}
