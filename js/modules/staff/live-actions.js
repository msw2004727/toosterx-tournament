/**
 * LIVE 賽務台的純邏輯
 * ------------------------------------------------------------------
 * 規格：docs/04-功能規格-賽務裁判端.md §5、docs/01b §1.8
 *
 * 這裡完全不碰 DOM、不碰 Firestore，只做「輸入 → 輸出」的計算，
 * 因為現場最不能錯的就是這些：比分怎麼變、卡片算第幾張、事件加總對不對得上。
 * 所有函式都有單元測試（tests/unit/live-actions.test.js）。
 */

import { FAIR_PLAY } from '../../engine/ranking.js';

/** 會改變比分的事件型別（docs/01b §1.8 事件型別表） */
export const SCORING_TYPES = ['goal', 'own_goal', 'penalty_scored'];

/** 有效事件：未作廢 */
export const isLive = e => !!e && e.voided !== true;

/** 下一個序號。同分鐘的事件靠 seq 排序，所以不能重複。 */
export function nextSeq(events) {
  const max = (events || []).reduce((m, e) => Math.max(m, Number(e?.seq) || 0), 0);
  return max + 1;
}

/**
 * 由 timeline 推算比分。
 *
 * ⚠️ 烏龍球記給**對方**。這是最容易寫錯的一條：
 *    事件的 side 記的是「踢進球門的球員屬於哪一隊」，但分數要算給對手。
 *
 * @param {Array<object>} events
 * @returns {{home:number, away:number}}
 */
export function scoreFromTimeline(events) {
  const out = { home: 0, away: 0 };
  for (const e of events || []) {
    if (!isLive(e) || !SCORING_TYPES.includes(e.type)) continue;
    if (e.side !== 'home' && e.side !== 'away') continue;
    const credit = e.type === 'own_goal'
      ? (e.side === 'home' ? 'away' : 'home')
      : e.side;
    out[credit] += 1;
  }
  return out;
}

/**
 * 一致性檢查（docs/04 §5.6）。
 * 不一致時**警示但允許送出**——現場以裁判判定為準，
 * 差異記在 match.scoreMismatch 供 Admin 事後檢視。
 */
export function consistencyCheck(score, events) {
  const derived = scoreFromTimeline(events);
  const h = Number(score?.home) || 0;
  const a = Number(score?.away) || 0;
  const match = derived.home === h && derived.away === a;
  return {
    ok: match,
    derived,
    entered: { home: h, away: a },
    message: match
      ? `事件加總（${derived.home}:${derived.away}）與比分一致`
      : `事件加總為 ${derived.home}:${derived.away}，與比分 ${h}:${a} 不同，仍要送出嗎？`
  };
}

// ── 事件建構 ─────────────────────────────────────────────────

/** 共同欄位。刻意不填 createdAt——由呼叫端補 serverTimestamp。 */
function baseEvent({ matchId, events, side, period, clockSec, minute, uid, teamId }) {
  return {
    matchId,
    seq: nextSeq(events),
    periodId: period,
    clockSec: Math.max(0, Math.round(Number(clockSec) || 0)),
    minute: Number(minute) || 0,
    side,
    teamId: teamId ?? null,
    createdBy: uid,
    voided: false, voidedBy: null, voidedAt: null, voidReason: null,
    note: ''
  };
}

/**
 * 進球。
 * @param {object} o
 * @param {'goal'|'own_goal'|'penalty_scored'|'penalty_missed'} [o.type]
 * @param {object|null} [o.player] 可為 null——兒童組常常來不及確認進球者，
 *                                 規格明訂「不指定球員」也要能直接記分（§5.3 快速模式）
 */
export function buildGoalEvent(o) {
  const type = o.type || 'goal';
  return {
    ...baseEvent(o),
    type,
    playerId: o.player?.memberId ?? null,
    playerName: o.player?.displayName ?? o.player?.name ?? null,
    jerseyNo: o.player?.jerseyNo ?? null,
    assistPlayerId: o.assistPlayerId ?? null,
    goalType: o.goalType || (type === 'penalty_scored' ? 'penalty' : type === 'own_goal' ? 'own' : 'open')
  };
}

export function buildCardEvent(o) {
  return {
    ...baseEvent(o),
    type: 'card',
    cardType: o.cardType,                       // yellow | second_yellow | red
    playerId: o.player?.memberId ?? null,
    playerName: o.player?.displayName ?? o.player?.name ?? null,
    jerseyNo: o.player?.jerseyNo ?? null
  };
}

export function buildSubEvent(o) {
  return {
    ...baseEvent(o),
    type: 'substitution',
    playerId: o.outPlayer?.memberId ?? null,        // 下場
    playerName: o.outPlayer?.displayName ?? o.outPlayer?.name ?? null,
    jerseyNo: o.outPlayer?.jerseyNo ?? null,
    subInPlayerId: o.inPlayer?.memberId ?? null,    // 上場
    subInPlayerName: o.inPlayer?.displayName ?? o.inPlayer?.name ?? null,
    subInJerseyNo: o.inPlayer?.jerseyNo ?? null
  };
}

export function buildPeriodEvent(o) {
  return { ...baseEvent(o), type: o.ending ? 'period_end' : 'period_start', side: 'neutral' };
}

export function buildNoteEvent(o) {
  return { ...baseEvent(o), type: 'note', side: 'neutral', note: String(o.note ?? '').slice(0, 200) };
}

// ── 卡片判定 ─────────────────────────────────────────────────

/** 某球員本場已吃的有效卡片，依時序排列 */
export function cardsOf(events, playerId) {
  return (events || [])
    .filter(e => isLive(e) && e.type === 'card' && e.playerId && e.playerId === playerId)
    .sort((a, b) => (a.clockSec ?? a.seq ?? 0) - (b.clockSec ?? b.seq ?? 0));
}

/**
 * 出牌前的智慧提示（§5.4）：同一球員第二張黃牌 → 提示改記為兩黃換紅。
 * @returns {{suggest:'second_yellow'|null, reason:string, existing:number}}
 */
export function suggestCardType(events, playerId, intended) {
  const prior = cardsOf(events, playerId);
  const yellows = prior.filter(c => c.cardType === 'yellow').length;
  if (intended === 'yellow' && yellows >= 1) {
    return {
      suggest: 'second_yellow',
      reason: '這名球員本場已有一張黃牌，是否記為「兩黃換紅」？',
      existing: yellows
    };
  }
  return { suggest: null, reason: '', existing: yellows };
}

/** 已被罰離場的球員（紅牌或兩黃換紅），不可再上場也不能再記事件 */
export function sentOffPlayerIds(events) {
  const out = new Set();
  for (const e of events || []) {
    if (!isLive(e) || e.type !== 'card' || !e.playerId) continue;
    if (e.cardType === 'red' || e.cardType === 'second_yellow') out.add(e.playerId);
  }
  return out;
}

/** 該隊目前場上人數（先發 − 罰離場），供「人數不足」提示 */
export function onFieldCount(startingIds, events) {
  const off = sentOffPlayerIds(events);
  return (startingIds || []).filter(id => !off.has(id)).length;
}

/** 這一場、這一隊的行為分（沿用引擎的判定，不另寫一份） */
export function matchFairPlay(events, teamId) {
  const byPlayer = new Map();
  for (const e of events || []) {
    if (!isLive(e) || e.type !== 'card') continue;
    if (teamId && e.teamId !== teamId) continue;
    const key = e.playerId || 'unknown';
    if (!byPlayer.has(key)) byPlayer.set(key, []);
    byPlayer.get(key).push(e);
  }
  let total = 0;
  for (const cards of byPlayer.values()) total += fairPlayOf(cards);
  return total;
}

function fairPlayOf(cards) {
  const sorted = [...cards].sort((a, b) => (a.clockSec ?? a.seq ?? 0) - (b.clockSec ?? b.seq ?? 0));
  const redAt = sorted.findIndex(c => c.cardType === 'red');
  if (redAt >= 0) {
    const prior = sorted.slice(0, redAt).some(c => c.cardType === 'yellow' || c.cardType === 'second_yellow');
    return prior ? FAIR_PLAY.yellowThenRed : FAIR_PLAY.directRed;
  }
  if (sorted.some(c => c.cardType === 'second_yellow')) return FAIR_PLAY.secondYellow;
  return sorted.filter(c => c.cardType === 'yellow').length * FAIR_PLAY.yellow;
}

// ── 換人 ─────────────────────────────────────────────────────

/** 該隊已用換人次數 */
export function subCount(events, side) {
  return (events || []).filter(e => isLive(e) && e.type === 'substitution' && e.side === side).length;
}

/**
 * 換人次數檢查。**超過上限只警示、不阻擋**——
 * 現場規則可能臨時放寬（§5.5），系統不該比裁判更有主見。
 */
export function checkSubLimit(events, side, limit) {
  const used = subCount(events, side);
  if (!Number.isFinite(limit) || limit <= 0) return { used, limit: null, over: false, message: '' };
  return {
    used, limit, over: used >= limit,
    message: used >= limit ? `這隊已用 ${used} 人次換人，達上限 ${limit}。仍要繼續嗎？` : ''
  };
}

// ── 完賽 ─────────────────────────────────────────────────────

/**
 * 組出完賽送出的 patch。
 * 一次寫完所有欄位，才不會出現「比分寫了但狀態沒寫」的中間態。
 */
export function buildFinishPatch({ score, htScore, penaltyScore, events, uid, matchDurationMin }) {
  const check = consistencyCheck(score, events);
  const h = Number(score?.home) || 0;
  const a = Number(score?.away) || 0;
  const pk = penaltyScore && (penaltyScore.home != null || penaltyScore.away != null) ? penaltyScore : null;

  const winner = h > a ? 'home' : h < a ? 'away'
    : pk ? (Number(pk.home) > Number(pk.away) ? 'home' : Number(pk.home) < Number(pk.away) ? 'away' : 'draw')
    : 'draw';

  return {
    score: { home: h, away: a },
    htScore: htScore ?? null,
    penaltyScore: pk,
    status: 'finished',
    period: 'ft',
    clock: { running: false, periodStartedAt: null, elapsedSecAtPause: 0, addedTimeSec: 0 },
    result: {
      winner,
      method: pk ? 'penalty' : 'regulation',
      homePoints: winner === 'home' ? 3 : winner === 'draw' ? 1 : 0,
      awayPoints: winner === 'away' ? 3 : winner === 'draw' ? 1 : 0
    },
    lock: { locked: true, lockedBy: uid },
    scoreMismatch: !check.ok,
    updatedBy: uid
  };
}

/** 完賽確認畫面要顯示的摘要 */
export function finishSummary({ match, events }) {
  const check = consistencyCheck(match?.score, events);
  return {
    home: match?.home?.name ?? '主隊',
    away: match?.away?.name ?? '客隊',
    score: `${Number(match?.score?.home) || 0} - ${Number(match?.score?.away) || 0}`,
    htScore: match?.htScore ? `${match.htScore.home}-${match.htScore.away}` : null,
    eventCount: (events || []).filter(isLive).length,
    goalCount: (events || []).filter(e => isLive(e) && SCORING_TYPES.includes(e.type)).length,
    consistency: check
  };
}

// ── 事件顯示 ─────────────────────────────────────────────────

export const EVENT_ICON = {
  goal: '⚽', own_goal: '⚽', penalty_scored: '⚽', penalty_missed: '✖',
  card: '🟨', substitution: '⇄', injury: '＋',
  period_start: '▶', period_end: '⏹', note: '✎'
};

/** 事件的一行文字（不含 HTML，呼叫端用 textContent） */
export function eventText(e) {
  if (!e) return '';
  const who = e.playerName ? `${e.jerseyNo != null ? '#' + e.jerseyNo + ' ' : ''}${e.playerName}` : '未指定球員';
  switch (e.type) {
    case 'goal':           return `進球　${who}`;
    case 'penalty_scored': return `罰球進　${who}`;
    case 'penalty_missed': return `罰球失　${who}`;
    case 'own_goal':       return `烏龍球　${who}（記給對隊）`;
    case 'card':           return `${CARD_LABEL[e.cardType] || '出牌'}　${who}`;
    case 'substitution':   return `換人　${who} ↓ ／ ${e.subInJerseyNo != null ? '#' + e.subInJerseyNo + ' ' : ''}${e.subInPlayerName ?? ''} ↑`;
    case 'period_start':   return `${PERIOD_TEXT[e.periodId] ?? e.periodId} 開始`;
    case 'period_end':     return `${PERIOD_TEXT[e.periodId] ?? e.periodId} 結束`;
    case 'note':           return e.note || '備註';
    default:               return e.type;
  }
}

export const CARD_LABEL = { yellow: '黃牌', second_yellow: '兩黃換紅', red: '紅牌' };
const PERIOD_TEXT = { h1: '上半場', h2: '下半場', et1: '延長上半', et2: '延長下半', pk: 'PK 大戰' };

/** 事件排序：時間軸由新到舊（現場最關心剛剛發生什麼） */
export function sortEventsDesc(events) {
  return [...(events || [])].sort((a, b) =>
    (b.clockSec ?? 0) - (a.clockSec ?? 0) || (b.seq ?? 0) - (a.seq ?? 0));
}
