/**
 * 晉級解算
 * ------------------------------------------------------------------
 * 規格：docs/02-賽制引擎與排名規則.md §7 與 §8
 * 狀態：TODO(M2)
 *
 * TeamSource：
 *   { type:'standing',    stageId, groupId, rank }
 *   { type:'matchWinner', matchKey }
 *   { type:'matchLoser',  matchKey }
 *   { type:'fixed',       teamId }
 */

/**
 * 求值單一 TeamSource。
 * @returns {string|null} teamId，尚未能決定時回傳 null
 */
export function resolveTeamSource(source, ctx) {
  throw new Error('TODO(M2): 尚未實作，見 docs/02 §7.2');
}

/** 依 Format.finalRankingMap 解算最終排名 */
export function computeFinalRanking(format, ctx) {
  throw new Error('TODO(M2): 尚未實作，見 docs/02 §8.1');
}
