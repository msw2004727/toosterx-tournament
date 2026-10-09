import { buildBracketModel } from './bracket-model.js';

/** 只投影賽制中的冠軍路線與後端積分榜；不重新排名，也不從比分推算勝負。 */
export function advancementLabels(format, division, standings) {
  const labels = new Map();
  if (division?.schedulePublished !== true || !Array.isArray(format?.stages)) return labels;
  const model = buildBracketModel(format, [], division);
  if (model.state !== 'ready') return labels;
  const champion = model.trees.find(t => t.title === '冠軍');
  if (!champion) return labels;
  for (const node of champion.nodes) {
    const source = node.source;
    if (source?.type !== 'standing' || node.children.length) continue;
    const stage = format.stages.find(s => s.stageId === source.stageId);
    if (stage?.type !== 'roundRobin') continue;
    const docs = standings.filter(s => s.stageId === source.stageId);
    const expectedGroups = stage.groupCount;
    if (!Number.isInteger(expectedGroups) || expectedGroups < 1 || docs.length !== expectedGroups
      || new Set(docs.map(s => s.groupId)).size !== expectedGroups) continue;
    // 雙循環要打滿兩輪；不能沿用畫面上單循環的進度估計。
    if (docs.some(s => s.hasUnresolvedTie || !Array.isArray(s.rows) || s.rows.length < 2
      || s.rows.some(r => r.rank == null || r.hasUnresolvedTie
        || !Number.isFinite(r.played) || r.played < (s.rows.length - 1) * (stage.legs ?? 1)))) continue;
    const standing = docs.find(s => s.groupId === source.groupId);
    const rows = standing?.rows.filter(r => r.rank === source.rank) || [];
    if (rows.length !== 1 || !rows[0].teamId) continue;
    const bye = node.depth === 2 && !node.children.length;
    const id = `${source.stageId}:${source.groupId}:${rows[0].teamId}`;
    labels.set(id, { label: bye ? '直晉四強' : '晉級淘汰賽', bye });
  }
  return labels;
}

/** 最終名次只使用主辦已發布且仍有效的官方排名。 */
export function publishedFinalRanking(division) {
  if (division?.finalRankingPublished !== true || division.finalRankingStale === true
    || !Array.isArray(division.finalRanking) || !division.finalRanking.length) return [];
  const rows = division.finalRanking;
  if (rows.some(r => !r?.teamId || !Number.isInteger(r.rank) || r.rank < 1)
    || new Set(rows.map(r => r.rank)).size !== rows.length
    || new Set(rows.map(r => r.teamId)).size !== rows.length) return [];
  return [...rows].sort((a, b) => a.rank - b.rank);
}

export const finalRankLabel = rank => ['冠軍', '亞軍', '季軍'][rank - 1] || `第 ${rank} 名`;
