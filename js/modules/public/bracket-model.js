/** 對戰關係只讀賽制；勝負只讀引擎已產生的 result，不以比分猜晉級。 */
import { groupNameOf } from '../../engine/group-name.js';
import { isDoneMatch } from './selectors.js';

/** 卡片入口只認設定中的淘汰槽位，不依中文名稱或 stageId 慣例猜測。 */
export function isBracketMatch(format, match) {
  return !!match?.matchKey && Array.isArray(format?.stages) && format.stages.some(stage =>
    stage?.type === 'knockout' && stage.stageId === match.stageId && Array.isArray(stage.slots)
    && stage.slots.some(slot => slot?.matchKey === match.matchKey));
}

export function buildBracketModel(format, matches, division) {
  if (!Array.isArray(format?.stages)) return { state: 'missing', trees: [], extra: [] };
  const slots = new Map();
  let invalid = false;
  if (format.stages.some(s => !s || (s.slots != null && !Array.isArray(s.slots)))) return { state: 'invalid', trees: [], extra: [] };
  for (const stage of format.stages) for (const slot of stage.slots || []) {
    if (!slot) { invalid = true; continue; }
    if (!slot.matchKey || slots.has(slot.matchKey)) invalid = true;
    slots.set(slot.matchKey, { ...slot, stageId: stage.stageId });
  }
  if (!slots.size) return { state: 'none', trees: [], extra: [] };
  if (slots.size > 64) invalid = true;
  const entries = new Map();
  for (const [key, slot] of slots) {
    const found = matches.filter(m => m.divisionId === division.divisionId && m.stageId === slot.stageId && m.matchKey === key);
    if (found.length > 1) invalid = true; // 排程世代重疊不可任選一場。
    entries.set(key, { slot, match: found.length === 1 ? found[0] : null });
  }
  const visiting = new Set(), checked = new Set();
  function check(key) {
    if (visiting.size > 8 || visiting.has(key) || !slots.has(key)) { invalid = true; return; }
    if (checked.has(key)) return;
    visiting.add(key);
    for (const source of [slots.get(key).home, slots.get(key).away]) {
      if (['matchWinner', 'matchLoser'].includes(source?.type)) check(source.matchKey);
      else if (!['standing', 'fixed'].includes(source?.type)) invalid = true;
    }
    visiting.delete(key); checked.add(key);
  }
  for (const key of slots.keys()) check(key);
  if (invalid) return { state: 'invalid', trees: [], extra: [] };
  const labels = Object.fromEntries([...slots].map(([key, slot]) => [key, slot.label || key]));
  function sourceLabel(source) {
    if (source.type === 'standing') return `${groupNameOf(source.groupId, { ...format, ...division })}第${source.rank}名`;
    if (source.type === 'fixed') return '指定隊伍';
    return `${labels[source.matchKey]}${source.type === 'matchWinner' ? '勝隊' : '敗隊'}`;
  }
  // 下游仍帶舊隊名時，以來源已完賽結果交叉確認；重開後不保留錯的晉級者。
  function sourceTeam(source, consumer, side) {
    if (source.type === 'standing' || source.type === 'fixed') {
      const team = consumer?.[side];
      return team?.teamId && (source.type !== 'fixed' || team.teamId === source.teamId) ? team : null;
    }
    const upstream = entries.get(source.matchKey);
    if (!isDoneMatch(upstream?.match)) return null;
    const winner = upstream.match.result?.winner;
    if (winner !== 'home' && winner !== 'away') return null;
    // 投影後端存好的勝／敗方，不比較比分，也不重新計算 result。
    const sideKey = source.type === 'matchWinner' ? winner : winner === 'home' ? 'away' : 'home';
    const id = upstream.match[sideKey]?.teamId;
    if (!id) return null;
    if (upstream.match.home?.teamId === upstream.match.away?.teamId) return null;
    // 不讓上游未定或被改判時，下游殘留結果繼續產生冠軍。
    for (const s of ['home', 'away']) {
      const expected = sourceTeam(upstream.slot[s], upstream.match, s);
      if (!expected || expected.teamId !== upstream.match[s]?.teamId) return null;
    }
    return [upstream.match.home, upstream.match.away].find(t => t?.teamId === id) || null;
  }
  function publicMatch(entry) {
    if (!entry.match) return null;
    const view = { ...entry.match };
    for (const s of ['home', 'away']) {
      view[s] = sourceTeam(entry.slot[s], entry.match, s) || { displayName: sourceLabel(entry.slot[s]) };
    }
    if (['home', 'away'].some(s => view[s].teamId !== entry.match[s]?.teamId)) {
      // 舊比分屬於舊對戰，不能放在改判後的新隊名旁邊。
      view.status = 'scheduled'; view.score = null; view.penaltyScore = null; view.result = null;
    }
    return view;
  }
  const used = new Set();
  let sequence = 0;
  function node(source, consumer, side, depth, title) {
    const team = sourceTeam(source, consumer?.match, side);
    const result = { id: `n${sequence++}`, source, label: title || sourceLabel(source),
      name: team?.displayName || team?.name || (team?.teamId ? '隊名整理中' : title ? `${title}待定` : sourceLabel(source)),
      teamId: team?.teamId || null, depth, match: consumer ? publicMatch(consumer) : null, side, children: [] };
    if (source.type === 'matchWinner') {
      const entry = entries.get(source.matchKey);
      used.add(source.matchKey);
      result.children = ['home', 'away'].map(s => node(entry.slot[s], entry, s, depth + 1));
      if (!consumer) result.match = publicMatch(entry);
    }
    return result;
  }
  const roots = (Array.isArray(format.finalRankingMap) ? format.finalRankingMap : []).filter(r => r?.from?.type === 'matchWinner' && slots.has(r.from.matchKey));
  const champion = roots.find(r => r.rank === 1);
  const trees = [];
  function addTree(source, title) {
    const root = node(source, null, null, 0, title);
    let leafCount = 0;
    const nodes = [];
    function place(n) {
      n.start = leafCount;
      if (n.children.length) n.children.forEach(place); else leafCount++;
      n.span = leafCount - n.start; nodes.push(n);
    }
    place(root);
    trees.push({ title, root, nodes, leafCount, levels: Math.max(...nodes.map(n => n.depth)) + 1 });
  }
  if (champion) addTree(champion.from, '冠軍');
  // 五八名交叉支線同樣畫成向上的樹；直接對決與敗隊名次賽保留場次卡。
  for (const item of roots.sort((a, b) => a.rank - b.rank)) {
    if (used.has(item.from.matchKey)) continue;
    const slot = slots.get(item.from.matchKey);
    if (['home', 'away'].some(s => slot[s]?.type === 'matchWinner')) addTree(item.from, `第${item.rank}名`);
  }
  const extra = [...entries].filter(([key]) => !used.has(key)).map(([, e]) => ({ ...e, match: publicMatch(e) }));
  if (trees.some(t => t.leafCount > 32)) return { state: 'invalid', trees: [], extra: [] };
  return { state: 'ready', trees, extra };
}
