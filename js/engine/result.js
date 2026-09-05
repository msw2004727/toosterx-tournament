/**
 * 一場比賽的勝負（由比分與 PK 決定）
 * ------------------------------------------------------------------
 * 賽務端「送出完賽」與管理端「改判比分」都要算 result；兩份實作遲早分岔
 * （驗收 C-01：正規 3:1 加 PK 2:4，一邊標 penalty、一邊標 regulation）。
 * 所以只留這一份（R-ENG-001），兩邊都從這裡拿。
 *
 * PK 只在正規時間平手時才決定勝負——先看正規比分，平手才看 PK。
 * 反過來寫的話，2:1 但 PK 輸的那一場會被判成敗，而那在足球裡不存在。
 *
 * 純函式；比分一律嚴格型別檢查（R-ENG-002）：`Number(null)` 是 0，
 * 會把「沒填比分」判成 0:0 平手。
 */

/** 0 以上的整數才算比分；其他（null、undefined、字串、小數）一律 null */
export function scoreOf(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * @param {{home:number, away:number}} score
 * @param {{home:number|null, away:number|null}} [penaltyScore]
 * @returns {{winner:'home'|'away'|'draw', method:'regulation'|'penalty', homePoints:number, awayPoints:number}|null}
 *   比分不合法回 null（呼叫端要 fail-closed，不寫入）
 */
export function matchResult(score, penaltyScore = null, { winPoints = 3, drawPoints = 1 } = {}) {
  const h = scoreOf(score?.home);
  const a = scoreOf(score?.away);
  if (h == null || a == null) return null;

  const pkH = scoreOf(penaltyScore?.home);
  const pkA = scoreOf(penaltyScore?.away);
  const hasPk = pkH != null && pkA != null;

  let winner = h > a ? 'home' : h < a ? 'away' : 'draw';
  let method = 'regulation';
  if (winner === 'draw' && hasPk && pkH !== pkA) {
    winner = pkH > pkA ? 'home' : 'away';
    method = 'penalty';
  }

  return {
    winner,
    method,
    homePoints: winner === 'home' ? winPoints : winner === 'draw' ? drawPoints : 0,
    awayPoints: winner === 'away' ? winPoints : winner === 'draw' ? drawPoints : 0
  };
}

// CommonJS 相容（供 functions/ 以 require 使用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scoreOf, matchResult };
}
