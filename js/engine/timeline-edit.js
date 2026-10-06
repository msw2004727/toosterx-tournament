/** Event correction rules shared by the editor and the atomic callable. */
import { scoreFromTimeline, reconcileScore } from './timeline.js';
import { matchResult, scoreOf } from './result.js';

export const EDIT_EVENT_TYPES = {
  goal: '進球', own_goal: '烏龍球', penalty_scored: '罰球進', penalty_missed: '罰球失',
  card: '出牌', substitution: '換人', injury: '傷停', period_start: '期別開始', period_end: '期別結束', note: '備註'
};
export const EDIT_EVENT_FIELDS = ['type', 'side', 'periodId', 'clockSec', 'playerId', 'assistPlayerId',
  'subInPlayerId', 'cardType', 'goalType', 'note', 'voided'];
export function timelineEditBasis(e) {
  return Object.fromEntries(['seq', 'teamId', 'minute', 'playerName', 'jerseyNo', 'subInPlayerName', 'subInJerseyNo',
    'editRevision', 'resetRevision', ...EDIT_EVENT_FIELDS].map(k => [k, e?.[k] ?? null]));
}
const fail = message => { throw Object.assign(new Error(message), { code: 'invalid-argument' }); };
const neutralType = type => ['note', 'period_start', 'period_end'].includes(type);
const goalType = type => ['goal', 'own_goal', 'penalty_scored', 'penalty_missed'].includes(type);

export function buildTimelineEdit({ event, patch, match, division, rosters }) {
  if (!patch || Object.keys(patch).some(k => !EDIT_EVENT_FIELDS.includes(k))) fail('事件欄位不正確');
  const next = { ...event, ...patch };
  if (!Object.hasOwn(EDIT_EVENT_TYPES, next.type)) fail('事件類型不正確');
  const periods = division?.periods;
  if (![1, 2].includes(periods)) fail('缺少比賽期別設定，請重新載入');
  if (!['pre', 'h1', ...(periods === 2 ? ['ht', 'h2'] : []), 'et1', 'et2', 'pk', 'ft'].includes(next.periodId)) fail('比賽期別不正確');
  if (!Number.isInteger(next.clockSec) || next.clockSec < 0 || next.clockSec > 86400) fail('時間必須是 0 至 1440 分鐘的整數秒');
  if (typeof next.voided !== 'boolean') fail('事件狀態不正確');
  if (typeof next.note !== 'string' || next.note.length > 200) fail('備註最多 200 字');
  if (!['home', 'away', 'neutral'].includes(next.side) || (!neutralType(next.type) && next.side === 'neutral')) fail('請選擇主隊或客隊');
  if (neutralType(next.type)) next.side = 'neutral';
  next.teamId = next.side === 'neutral' ? null : match[next.side]?.teamId;
  if (next.side !== 'neutral' && !next.teamId) fail('這一隊尚未確認');
  next.minute = Math.floor(next.clockSec / 60);
  function player(id, prefix = '') {
    if (id == null || id === '') return null;
    if (typeof id !== 'string') fail('球員代碼不正確');
    const p = rosters?.[next.side]?.find(p => p.memberId === id && ['player', 'start', 'bench'].includes(p.role ?? p.kind ?? 'player'));
    if (p) return { id, name: p.displayName ?? p.name ?? null, jersey: p.jerseyNo ?? null };
    // Historical players may no longer be on today's roster. Retain only an unchanged snapshot on the same team.
    const oldId = prefix === 'assist' ? event.assistPlayerId : prefix ? event.subInPlayerId : event.playerId;
    if (id === oldId && event.teamId === next.teamId) return { id, name: prefix ? event.subInPlayerName ?? null : event.playerName ?? null,
      jersey: prefix ? event.subInJerseyNo ?? null : event.jerseyNo ?? null };
    fail('球員不在所選隊伍名單，請重新選擇');
  }
  const who = neutralType(next.type) ? null : player(next.playerId);
  if (['card', 'substitution'].includes(next.type) && !who) fail('請選擇球員');
  next.playerId = who?.id ?? null; next.playerName = who?.name ?? null; next.jerseyNo = who?.jersey ?? null;
  const incoming = next.type === 'substitution' ? player(next.subInPlayerId, 'subIn') : null;
  if (next.type === 'substitution' && (!incoming || incoming.id === who.id)) fail('換上與換下球員必須不同');
  next.subInPlayerId = incoming?.id ?? null; next.subInPlayerName = incoming?.name ?? null; next.subInJerseyNo = incoming?.jersey ?? null;
  next.assistPlayerId = goalType(next.type) ? player(next.assistPlayerId, 'assist')?.id ?? null : null;
  if (next.type === 'card' && !['yellow', 'second_yellow', 'red'].includes(next.cardType)) fail('請選擇牌別');
  next.cardType = next.type === 'card' ? next.cardType : null;
  if (goalType(next.type)) {
    next.goalType = next.type === 'own_goal' ? 'own' : next.type.startsWith('penalty_') ? 'penalty' : next.goalType || 'open';
    if (!['open', 'penalty', 'freekick', 'header', 'own'].includes(next.goalType)) fail('進球方式不正確');
  } else next.goalType = null;
  next.editRevision = (event.editRevision ?? 0) + 1;
  return next;
}

/** Apply only the event's scoring delta: manual scores and adjudications remain the baseline. */
export function timelineEditMatchPatch({ match, events, before, after, division }) {
  const regular = e => e.periodId !== 'pk';
  const replaced = events.map(e => e.timelineId === before.timelineId ? after : e);
  function adjusted(base, oldRows, newRows) {
    const oldScore = scoreFromTimeline(oldRows, { includeShootout: true }), newScore = scoreFromTimeline(newRows, { includeShootout: true });
    const delta = { home: newScore.home - oldScore.home, away: newScore.away - oldScore.away };
    if (!delta.home && !delta.away) return base;
    if (scoreOf(base?.home) == null || scoreOf(base?.away) == null) fail('比分尚未完整，請先確認比分再修改得分事件');
    const result = { home: base.home + delta.home, away: base.away + delta.away };
    if (result.home < 0 || result.away < 0) fail('修正後比分小於零，請先核對比分與事件');
    return result;
  }
  const score = match.status === 'walkover' ? match.score : adjusted(match.score, events.filter(regular), replaced.filter(regular));
  const penaltyScore = match.status === 'walkover' ? match.penaltyScore : adjusted(match.penaltyScore, events.filter(e => !regular(e)), replaced.filter(e => !regular(e)));
  const out = { score: score ?? null, scoreMismatch: !reconcileScore(score, replaced.filter(regular)).ok };
  if (penaltyScore !== match.penaltyScore) out.penaltyScore = penaltyScore;
  if (division.periods === 2 && match.htScore) out.htScore = adjusted(match.htScore,
    events.filter(e => e.periodId === 'h1'), replaced.filter(e => e.periodId === 'h1'));
  if (['finished', 'confirmed'].includes(match.status)) out.result = matchResult(score, penaltyScore);
  // Walkover results are regulatory decisions, independent of the historical event score.
  if (match.status === 'walkover') { out.score = match.score; delete out.penaltyScore; out.scoreMismatch = !reconcileScore(match.score, replaced.filter(regular)).ok; }
  return out;
}
