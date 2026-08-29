/**
 * 積分榜計算
 * ------------------------------------------------------------------
 * 規格：docs/02-賽制引擎與排名規則.md §5、docs/01b §1.9
 *
 * 冪等性（T13）：computeRows / buildStanding 都是純函式，
 * 同一批 match 重放 N 次結果完全一致——因為排序有明確的 tie-break，
 * 且完全不依賴 Date.now() 或任何隨機來源。
 *
 * 亂序寫入（T16）：version 由呼叫端遞增，寫入前用 isStaleWrite() 擋掉
 * 「後到的舊版本」，避免慢半拍的 Function 覆寫較新的結果。
 */

import {
  tallyMatches, isCompleted, effectiveScore,
  DEFAULT_POINTS, DEFAULT_WALKOVER, WITHDRAWAL_POLICY
} from './tally.js';
import { rankRows, fairPlayByTeam, applyManualRanking, manualPinsOf } from './ranking.js';

export { applyManualRanking, manualPinsOf };

export { DEFAULT_POINTS, DEFAULT_WALKOVER, WITHDRAWAL_POLICY, isCompleted, effectiveScore };

/** 近期戰績最多顯示幾場 */
const FORM_LIMIT = 5;

/**
 * 由場次列表計算某小組的積分列（尚未排序）。
 *
 * @param {string[]} teamIds
 * @param {Array<object>} matches 該小組的場次；未完賽的會自動略過
 * @param {object} rule RankingRule（用其中的 points）
 * @param {object} [opts]
 * @param {Array<object>} [opts.cardEvents] timeline 中 type==='card' 的事件（跨場合併）
 * @param {Object<string,object>} [opts.teamMeta] teamId → { name, abbr, logoUrl, seed }
 * @param {object} [opts.walkover] / [opts.mercyRule] / [opts.withdrawnTeamIds] / [opts.withdrawalPolicy]
 * @returns {Array<object>} rows
 */
export function computeRows(teamIds, matches, rule, opts = {}) {
  const tallyOpts = { ...opts, points: { ...DEFAULT_POINTS, ...(rule?.points || {}) } };
  const { stats, countedMatchIds } = tallyMatches(teamIds, matches, tallyOpts);

  // 行為分只計入「真的被納入統計」的場次。
  // countedMatchIds 由 tallyMatches 產出，所以作廢的、資料不全的、
  // 退賽而整場作廢的場次上的牌都不會影響排名。
  // 沒有 matchId 的卡片事件一律不計——來源不明就不該左右名次。
  const cards = (opts.cardEvents || []).filter(c => c.matchId && countedMatchIds.has(c.matchId));
  const fp = fairPlayByTeam(cards);

  const meta = opts.teamMeta || {};
  const rows = [];
  for (const [teamId, st] of stats) {
    const f = fp.get(teamId) || { fairPlayPoints: 0, yellow: 0, red: 0 };
    const m = meta[teamId] || {};
    rows.push({
      teamId,
      name: m.name ?? null,
      abbr: m.abbr ?? null,
      logoUrl: m.logoUrl ?? null,
      seed: m.seed ?? null,
      played: st.played, win: st.win, draw: st.draw, loss: st.loss,
      goalsFor: st.goalsFor, goalsAgainst: st.goalsAgainst, goalDiff: st.goalDiff,
      points: st.points,
      yellow: f.yellow, red: f.red, fairPlayPoints: f.fairPlayPoints,
      form: st.form.slice(-FORM_LIMIT),
      tieBreakTrace: [],
      locked: false,
      note: ''
    });
  }
  return rows;
}

/**
 * 組出一份完整的 standing 文件（docs/01b §1.9 的形狀）。
 *
 * 刻意不呼叫 Date.now()：computedAt 由呼叫端（Function）填 serverTimestamp，
 * 這樣本函式維持純函式，測試才能直接比對兩次執行的結果是否相同。
 *
 * @param {object} args
 * @param {string} args.eventId / args.divisionId / args.stageId / args.groupId
 * @param {string[]} args.teamIds
 * @param {Array<object>} args.matches
 * @param {object} args.rule RankingRule
 * @param {object} [args.opts] 傳給 computeRows
 * @param {object} [args.prev] 既有的 standing 文件（用來遞增 version、沿用人工裁定）
 * @param {Array<{teamId:string, rank:number}>} [args.manualPins]
 *        本次要套用的人工名次；省略時若 prev.manualOverride.enabled 為真，
 *        會自動沿用 prev 裡 locked 的那幾列
 * @returns {object} standing 文件（不含 computedAt）
 */
export function buildStanding({ eventId, divisionId, stageId, groupId, teamIds, matches, rule, opts = {}, prev = null, manualPins = null }) {
  const raw = computeRows(teamIds, matches, rule, opts);
  let { rows, hasUnresolvedTie } = rankRows(raw, matches, rule, opts);

  // ⚠️ 重算不可以把主辦的裁定沖掉。
  //    §10 說 Admin 手動排序後要留著，否則每次重算就跳回「待裁定」，
  //    晉級解算會被 hasUnresolvedTie 永久卡住。
  const manualOverride = prev?.manualOverride ?? { enabled: false, by: null, at: null, reason: null };
  const pins = manualPins ?? (manualOverride.enabled ? manualPinsOf(prev) : null);
  if (pins?.length) {
    rows = applyManualRanking(rows, pins);
    hasUnresolvedTie = rows.some(r => r.hasUnresolvedTie === true);
  }

  return {
    standingId: standingIdOf(divisionId, stageId, groupId),
    eventId, divisionId, stageId, groupId,
    rows,
    computedBy: 'fn:recalcStanding',
    version: (prev?.version ?? 0) + 1,
    hasUnresolvedTie,
    manualOverride
  };
}

/** id 格式：`${divisionId}__${stageId}__${groupId}`，例如 adult-open__group__A */
export function standingIdOf(divisionId, stageId, groupId) {
  return `${divisionId}__${stageId}__${groupId}`;
}

/**
 * 亂序寫入防護（T16）。
 * Function 併發重算時，較舊的那一次可能後到；此時必須放棄寫入。
 *
 * @param {object|null} current  資料庫中現有的 standing
 * @param {object} incoming      準備寫入的 standing
 * @returns {boolean} true 代表 incoming 已過時，不可寫入
 */
export function isStaleWrite(current, incoming) {
  if (!current) return false;
  return (incoming?.version ?? 0) <= (current.version ?? 0);
}

/**
 * 比分修正後，判斷是否需要對「已解算晉級的下游場次」示警（T12）。
 *
 * 隊伍「消失」或「新出現」也算變動——整隊退賽會讓某隊從積分榜移除，
 * 那同樣會讓下游的 A1／B2 指到別人身上。
 *
 * @param {object} before 修正前的 standing
 * @param {object} after  修正後的 standing
 * @returns {{changed:boolean, movedTeamIds:string[], removedTeamIds:string[], addedTeamIds:string[]}}
 */
export function diffRanking(before, after) {
  const b = new Map((before?.rows || []).map(r => [r.teamId, r.rank]));
  const a = new Map((after?.rows || []).map(r => [r.teamId, r.rank]));

  const moved = [...a.keys()].filter(id => b.has(id) && b.get(id) !== a.get(id));
  const removed = [...b.keys()].filter(id => !a.has(id));
  const added = [...a.keys()].filter(id => !b.has(id));

  return {
    changed: moved.length + removed.length + added.length > 0,
    movedTeamIds: moved.sort(),
    removedTeamIds: removed.sort(),
    addedTeamIds: added.sort()
  };
}
