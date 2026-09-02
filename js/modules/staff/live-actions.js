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
import { GOAL_EVENT_TYPES, isLive, scoreFromTimeline, reconcileScore } from '../../engine/timeline.js';

// 比分推算搬去 js/engine/timeline.js 了：Cloud Function 對帳要用同一份邏輯，
// 而 R-ENG-001 不允許有第二份實作。這裡只保留 re-export，
// 讓既有的 import 路徑（與它們的測試）不必跟著動。
export { isLive, scoreFromTimeline };

/** 會改變比分的事件型別（docs/01b §1.8 事件型別表）。⚠️ 含 own_goal。 */
export const SCORING_TYPES = GOAL_EVENT_TYPES;

/** 下一個序號。同分鐘的事件靠 seq 排序，所以不能重複。 */
export function nextSeq(events) {
  const max = (events || []).reduce((m, e) => Math.max(m, Number(e?.seq) || 0), 0);
  return max + 1;
}

/**
 * 一致性檢查（docs/04 §5.6）——畫面用的那一層。
 * 判定本身在 engine 的 reconcileScore()，這裡只負責組人看得懂的句子。
 *
 * 不一致時**警示但允許送出**：現場以裁判判定為準，
 * 差異記在 match.scoreMismatch 供 Admin 事後檢視。
 */
export function consistencyCheck(score, events) {
  const r = reconcileScore(score, events);
  const { derived, entered } = r;
  const shown = `${entered.home ?? '—'}:${entered.away ?? '—'}`;
  return {
    ok: r.ok,
    derived,
    entered,
    message: r.ok
      ? `事件加總（${derived.home}:${derived.away}）與比分一致`
      : !r.complete
        ? `比分還沒登錄完（目前 ${shown}），事件加總為 ${derived.home}:${derived.away}，仍要送出嗎？`
        : `事件加總為 ${derived.home}:${derived.away}，與比分 ${shown} 不同，仍要送出嗎？`
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

// ── 完賽後三分鐘自撤回（docs/10 §5.3）─────────────────────────

/** 撤回視窗。⚠️ firestore.rules 分支 (D) 的 duration.value(3,'m') 必須一致。 */
export const UNDO_WINDOW_SEC = 180;

/** 各種時間格式（Firestore Timestamp / Date / 毫秒 / ISO 字串）→ 毫秒。
 *  ⚠️ 不要用 Number(v)（R-ENG-002）：Number(null) 是 0，會被當成 1970 年，
 *     於是「還沒同步」看起來就像「早就超過三分鐘」。 */
function toMs(v) {
  if (v == null) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  return null;
}

/** 送出完賽之後、實際打過的最後一個期別（撤回要退回這裡，不能一律當成下半場） */
export function lastPlayedPeriod(events) {
  let best = null;
  for (const e of events || []) {
    if (!isLive(e) || e.type !== 'period_start') continue;
    if (best === null || (e.seq ?? 0) >= (best.seq ?? 0)) best = e;
  }
  return best?.periodId ?? 'h2';
}

/**
 * 完賽之後可不可以自己撤回。純函式，時間由呼叫端給（R-ENG-004）。
 *
 * 離線時一律不給撤回，而且**不顯示倒數**：
 * 倒數要有意義，得先知道伺服器認可的送出時間；離線時那個時間還不存在
 * （serverTimestamp 在本機快照裡是 null）。硬畫一個倒數，賽務會照著按，
 * 然後在恢復連線的瞬間被 rules 擋掉——那就是「假成功」，是不可協商的紅線。
 *
 * @returns {{can:boolean, leftSec:number|null, reason:string}}
 */
export function undoState({ match, nowMs, online, uid, pendingWrite = false }) {
  const no = reason => ({ can: false, leftSec: null, reason });

  if (!match) return no('沒有場次資料');
  if (match.status === 'confirmed') return no('主辦已覆核這場成績，要更正請找管理員。');
  if (match.status !== 'finished')  return no('這場還沒送出完賽。');
  if (!uid || match.scoreSubmittedBy !== uid) {
    return no('只有送出完賽的那個人可以自行撤回，其他人請找管理員。');
  }
  if (online !== true || pendingWrite === true) {
    return no('完賽還在待同步，連上線之後才會開始計算可撤回時間。');
  }

  const at = toMs(match.scoreSubmittedAt);
  if (at == null) return no('完賽還在待同步，連上線之後才會開始計算可撤回時間。');

  const leftSec = Math.ceil((at + UNDO_WINDOW_SEC * 1000 - nowMs) / 1000);
  if (leftSec <= 0) return no(`已超過 ${UNDO_WINDOW_SEC / 60} 分鐘，要更正請找管理員。`);

  return { can: true, leftSec, reason: '' };
}

/** 撤回完賽的 patch。比分與事件全部保留，只是把場次退回進行中。 */
export function buildUndoPatch({ uid, events }) {
  return {
    status: 'live',
    period: lastPlayedPeriod(events),
    result: null,
    // lockedAt 一定要一起寫。updateDoc 對巢狀 map 是**整包取代**，
    // 少列一個欄位就等於把它從文件上刪掉（docs/01b §262 有定義這個欄位）。
    lock: { locked: false, lockedAt: null, lockedBy: null },
    scoreSubmittedAt: null,
    scoreSubmittedBy: null,
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

/** 事件類型 → js/core/icons.js 的圖示名稱（不是 emoji，理由見該檔開頭） */
export const EVENT_ICON = {
  goal: 'goal', own_goal: 'goal', penalty_scored: 'goal', penalty_missed: 'close',
  card: 'card', substitution: 'sub', injury: 'injury',
  period_start: 'play', period_end: 'stop', note: 'note'
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
    case 'substitution':   return `換人　${who} 下場 ／ ${e.subInJerseyNo != null ? '#' + e.subInJerseyNo + ' ' : ''}${e.subInPlayerName ?? ''} 上場`;
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
