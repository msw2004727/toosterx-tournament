/**
 * 積分榜計算
 * ------------------------------------------------------------------
 * 規格：docs/02-賽制引擎與排名規則.md §5
 * 狀態：TODO(M2)
 *
 * 必須具備冪等性：同一批 match 重放 N 次，結果一致（測試 T13）。
 * 亂序寫入時以 standing.version 樂觀鎖，舊版本不覆寫新版本（測試 T16）。
 */

export const DEFAULT_POINTS = { win: 3, draw: 1, loss: 0 };
export const DEFAULT_WALKOVER = { scoreFor: 3, scoreAgainst: 0, countInGoalStats: true };

/**
 * 由場次列表計算某小組的積分列。
 * @param {string[]} teamIds
 * @param {Array<object>} matches 已完賽（finished / confirmed / walkover）
 * @param {object} rule RankingRule
 * @returns {Array<object>} rows（尚未排序）
 */
export function computeRows(teamIds, matches, rule) {
  throw new Error('TODO(M2): 尚未實作，見 docs/02 §5');
}
