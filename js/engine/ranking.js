/**
 * 同分排序｜RankingRule
 * ------------------------------------------------------------------
 * 規格：docs/02-賽制引擎與排名規則.md §6
 * 狀態：TODO(M2) — 尚未實作，僅定義契約與演算法骨架。
 *
 * ⚠️ 最容易寫錯的地方（§6.4）：
 *   1. 先依 points 分出「同分群」
 *   2. 群只有 2 隊 → 直接比兩隊之間那 1 場
 *   3. 群 >= 3 隊 → 只取群成員彼此之間的比賽建迷你積分表，
 *      依 h2h 排序；若拆出更小的子群，對每個子群「從步驟 1 重新開始」（遞迴）
 *   4. 拆出「1 隊領先、2 隊仍同分」時，剩下 2 隊要重新只比彼此那一場，
 *      不能沿用 3 隊迷你表的數字
 *   5. 全部條件用盡仍同分 → hasUnresolvedTie = true，絕不隨機排序
 */

/** @typedef {'points'|'headToHeadPoints'|'headToHeadGoalDiff'|'headToHeadGoalsFor'|
 *            'headToHeadWins'|'goalDiff'|'goalsFor'|'goalsAgainstAsc'|'wins'|
 *            'fairPlay'|'seed'|'drawLots'|'manual'} Criterion */

/** FIFA 標準行為分罰分 */
export const FAIR_PLAY = { yellow: -1, secondYellow: -3, directRed: -4, yellowThenRed: -5 };

/**
 * 計算單場某球員的行為分（§6.3）。
 * 裁判端只記 yellow / second_yellow / red 三種，
 * 「直接紅」與「黃牌後紅」由此函式從事件序推算。
 * @param {Array<{cardType:string, seq:number, voided?:boolean}>} cards 同一球員同一場的卡片事件
 * @returns {number} 罰分（負值）
 */
export function fairPlayPoints(cards) {
  throw new Error('TODO(M2): 尚未實作，見 docs/02 §6.3');
}

/**
 * 依 RankingRule 對同一小組的積分列排序。
 * @param {Array<object>} rows        standing rows（已含 points/goalDiff/... 統計）
 * @param {Array<object>} matches     該小組所有已完賽場次（供 head-to-head 使用）
 * @param {{criteria: Criterion[]}} rule
 * @returns {{rows: Array<object>, hasUnresolvedTie: boolean}}
 */
export function rankRows(rows, matches, rule) {
  throw new Error('TODO(M2): 尚未實作，見 docs/02 §6.4');
}
