/**
 * 循環賽程產生｜Berger（circle method）
 * ------------------------------------------------------------------
 * 純函式、零依賴。前端與 Cloud Functions 共用同一份實作。
 * 規格：02-賽制引擎與排名規則.md §4
 */

/**
 * 產生單循環賽程。
 * @param {number} n 隊數（>= 2）
 * @returns {Array<Array<[number, number]>>} rounds[r] = [[homeIdx, awayIdx], ...]
 *
 * 保證：
 *   ・每隊每輪最多一場
 *   ・任兩隊恰好對戰一次
 *   ・主客場盡量平均（逐輪交錯）
 *   ・奇數隊自動輪空（bye），輪空該輪不排場
 */
function berger(n) {
  if (!Number.isInteger(n) || n < 2) {
    throw new RangeError('berger(n)：n 必須是 >= 2 的整數');
  }

  const teams = [...Array(n).keys()];
  if (n % 2 === 1) teams.push(-1); // -1 = 輪空

  const m = teams.length;
  const rounds = [];

  for (let r = 0; r < m - 1; r++) {
    const pairs = [];
    for (let i = 0; i < m / 2; i++) {
      const a = teams[i];
      const b = teams[m - 1 - i];
      if (a === -1 || b === -1) continue;
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    teams.splice(1, 0, teams.pop()); // 固定第 0 位，其餘輪轉
  }

  return rounds;
}

/**
 * 雙循環：第二輪主客對調。
 * @param {number} n
 * @param {1|2} legs
 */
function roundRobin(n, legs = 1) {
  const first = berger(n);
  if (legs === 1) return first;
  const second = first.map(round => round.map(([h, a]) => [a, h]));
  return [...first, ...second];
}

/**
 * 蛇形分組。
 * @param {Array<{teamId:string, seed?:number}>} teams 已依 seed 排序或含 seed
 * @param {number} groupCount
 * @returns {Array<Array<object>>} groups[g] = [team, ...]
 *
 * seed: 1 2 3 4 5 6 7 8  →  A B B A A B B A
 */
function snakeSeed(teams, groupCount) {
  if (groupCount < 1) throw new RangeError('groupCount 必須 >= 1');

  const sorted = [...teams].sort(
    (x, y) => (x.seed ?? Number.MAX_SAFE_INTEGER) - (y.seed ?? Number.MAX_SAFE_INTEGER)
  );

  const groups = Array.from({ length: groupCount }, () => []);
  sorted.forEach((team, i) => {
    const row = Math.floor(i / groupCount);
    const col = i % groupCount;
    const g = row % 2 === 0 ? col : groupCount - 1 - col;
    groups[g].push(team);
  });

  return groups;
}

/** 小組代號：0 → 'A'、1 → 'B'… */
function groupLabel(index) {
  return String.fromCharCode(65 + index);
}

export { berger, roundRobin, snakeSeed, groupLabel };

// CommonJS 相容（供 functions/ 以 require 使用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { berger, roundRobin, snakeSeed, groupLabel };
}
