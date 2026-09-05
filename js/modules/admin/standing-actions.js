/**
 * 人工裁定同分的純邏輯
 * ------------------------------------------------------------------
 * 規格：docs/02 §10、docs/05 §7.2；競賽規章第十九條
 *
 * 規章第十九條的同分判定有五個順位，前四項（對戰關係／正負球數／
 * 進球數／被進球數）引擎算得出來，**第五項是抽籤**——而引擎依 R-ENG-004
 * 不擲骰子，只標 `hasUnresolvedTie` 等人回填。
 *
 * ⭐ 在這一頁出現之前，那個標記是**死路**：
 *      `hasUnresolvedTie: true`
 *        → `explainTeamSource` 回 miss
 *        → 晉級永遠解不開（冠軍賽的隊伍停在「A組第1名」）
 *        → 最終排名算不出來 → 那一組打不完，而且不會有任何錯誤訊息。
 *    U6 只有 3 隊、女子組 5 隊，全部同分的機率不是零。
 *
 * 這裡只放「按下去之前算得出來的東西」：誰跟誰同分、換完之後的順序、
 * 抽籤抽出什麼。**寫入一律走 `setManualRanking` 這支 callable**——
 * 名次要由 `buildStanding` 重算，前端自己拼一份 opts 會跟管線分岔。
 */

import { drawOrder } from '../../engine/schedule.js';

/** rows 上「還沒判定」的那幾列 */
export function tiedRowsOf(standing) {
  return (standing?.rows || []).filter(r => r.hasUnresolvedTie === true);
}

/**
 * 把 rows 切成幾個「同分群」。
 *
 * ⚠️ **權威是 `hasUnresolvedTie`，不是 `tiedWith`。** 兩者今天總是一起出現
 *    （`ranking.js` 只在標記待裁定時才填 `tiedWith`），所以拿掉那一半的判斷
 *    目前不會有任何症狀——但方向反了：`hasUnresolvedTie` 是結論，
 *    `tiedWith` 只是「跟誰同分」的附註。日後若有人為了畫 `tieBreakTrace`
 *    而在**分得出勝負**的列上也填 `tiedWith`（積分相同但對戰關係分得開，
 *    那是很自然的顯示需求），這一頁就會把它們列成待裁定，
 *    而主辦會以為系統算不動。變異 #SR3 守這件事。
 *
 * @returns {Array<{key:string, teamIds:string[], ranks:number[]}>}
 */
export function tieGroupsOf(standing) {
  const rows = standing?.rows || [];
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (r.hasUnresolvedTie !== true || seen.has(r.teamId)) continue;
    const ids = [r.teamId, ...(r.tiedWith || [])]
      .filter((id, i, a) => a.indexOf(id) === i);
    // tiedWith 是雙向的，但只信自己這一列會漏掉「B 記著 A、A 沒記 B」的情形
    for (const id of ids) seen.add(id);
    const members = ids
      .map(id => rows.find(x => x.teamId === id))
      .filter(Boolean)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    if (members.length < 2) continue;    // 一隊自己跟自己同分沒有意義
    out.push({
      key: members.map(m => m.teamId).join('|'),
      teamIds: members.map(m => m.teamId),
      ranks: members.map(m => m.rank)
    });
  }
  return out;
}

/** 這一份積分榜需不需要人裁定 */
export const needsRuling = standing =>
  standing?.hasUnresolvedTie === true && tieGroupsOf(standing).length > 0;

/** 已經被裁定過（rows 上有 locked，或旗標開著） */
export const isRuled = standing =>
  standing?.manualOverride?.enabled === true ||
  (standing?.rows || []).some(r => r.locked === true);

/**
 * 把「主辦排好的順序」轉成 callable 要的 pins。
 *
 * ⚠️ 名次用的是**這一群原本佔的那幾個名次**，不是 1、2、3。
 *    A 組第 3、4 名同分時，裁定的結果是「誰第 3 誰第 4」——
 *    寫成 1、2 的話兩隊會被釘到榜首，而 `applyManualRanking` 不會抱怨，
 *    它只是照著釘，然後整張積分榜就錯了。
 *
 * @param {string[]} orderedTeamIds 主辦排好的順序（第一個最高名次）
 * @param {number[]} ranks 這一群原本佔的名次
 */
export function pinsFrom(orderedTeamIds, ranks) {
  const slots = [...(ranks || [])].sort((a, b) => a - b);
  if (orderedTeamIds.length !== slots.length) {
    throw new Error('排序的隊數跟名次數對不上');
  }
  return orderedTeamIds.map((teamId, i) => ({ teamId, rank: slots[i] }));
}

/**
 * 上移／下移一隊。
 *
 * ⚠️ 用上下移而不是拖曳：320px 的觸控拖曳既難做對也難測，而且
 *    同分群通常只有 2–3 隊，按一下就排完了（跟賽程管理同一個決定）。
 *
 * @param {string[]} order
 * @param {number} idx
 * @param {-1|1} dir
 * @returns {string[]} 新的順序（不動原陣列）
 */
export function moveInOrder(order, idx, dir) {
  const next = [...order];
  const to = idx + dir;
  if (idx < 0 || idx >= next.length || to < 0 || to >= next.length) return next;
  [next[idx], next[to]] = [next[to], next[idx]];
  return next;
}

/**
 * 抽籤（規章第十九條第 5 順位）。
 *
 * ⚠️ **種子由呼叫端給**，而且要記下來（R-ENG-004、R-SCHED-001）。
 *    抽籤的價值在於事後重放得出來——申訴時主辦要拿得出「那一次抽了什麼」。
 *    這裡直接用 `js/engine/schedule.js` 的 `drawOrder`，不要再寫第二份
 *    洗牌：兩份實作意味著兩種「同一個種子抽出不同結果」的可能。
 *
 * @returns {string[]} 抽出來的順序
 */
export const drawTieOrder = (teamIds, seed) => drawOrder(teamIds, seed);

/**
 * 產生一個抽籤種子。
 *
 * ⚠️ 這一支**不在引擎裡**，就是因為它呼叫 `Date.now()` 與 `Math.random()`。
 *    引擎保持純函式，隨機來源留在畫面層（R-ENG-004）。
 */
export const newSeed = () =>
  (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0 & 0x7fffffff;

/**
 * 裁定之後會發生什麼——**按下去之前就要講**。
 *
 * 這幾句話不是客套：主辦按下去的下一秒，冠軍賽的隊伍就會被填進去，
 * 而那是公開端立刻看得到的。
 */
export function consequencesOf({ hasDownstream = true } = {}) {
  const out = [
    '這一組的名次會立刻定案，公開端馬上看得到。',
    '之後每一次重算都會沿用這個裁定，不會被系統的排序蓋掉。'
  ];
  if (hasDownstream) out.push('晉級會在裁定完成後立刻解算，下一階段的隊伍會被填進去。');
  out.push('誰、在什麼時候、依什麼裁定的，都會留在稽核紀錄裡。');
  return out;
}

/** 顯示用：`A 隊、B 隊` */
export const namesOf = (teamIds, teamsById) =>
  teamIds.map(id => teamsById?.[id]?.name ?? id).join('、');
