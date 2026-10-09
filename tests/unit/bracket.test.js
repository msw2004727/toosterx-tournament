import fs from 'node:fs';
import { buildBracketModel, isBracketMatch, isWinningBracketNode } from '../../js/modules/public/bracket-model.js';
import { FORMATS } from '../../js/engine/formats.js';

const formats = JSON.parse(fs.readFileSync(new URL('../fixtures/bracket-formats.json', import.meta.url), 'utf8'));
const division = { divisionId: 'test', groupNames: { A: '甲組', B: '乙組' } };
const format = formats.F4_RR_SEMIFINAL;
test('卡片入口只依賽制淘汰槽位，不依名稱或固定 stageId', () => {
  const f = { stages: [{ type: 'knockout', stageId: 'custom', slots: [{ matchKey: 'X' }] },
    { type: 'roundRobin', stageId: 'group', slots: [{ matchKey: 'G' }] }] };
  expect(isBracketMatch(f, { stageId: 'custom', matchKey: 'X', label: '場次一' })).toBe(true);
  expect(isBracketMatch(f, { stageId: 'group', matchKey: 'G', label: '淘汰賽' })).toBe(false);
  expect(isBracketMatch(f, { stageId: 'custom', matchKey: 'missing' })).toBe(false);
  expect(isBracketMatch(f, { stageId: 'other', matchKey: 'X' })).toBe(false);
  expect(isBracketMatch(null, { stageId: 'custom', matchKey: 'X' })).toBe(false);
});
const matchesFor = f => f.stages.flatMap(s => (s.slots || []).map(slot => ({
  matchId: slot.matchKey, matchKey: slot.matchKey, divisionId: 'test', stageId: s.stageId,
  label: slot.label, status: 'scheduled', home: {}, away: {}, score: { home: 0, away: 0 }
})));
function decided() {
  const matches = matchesFor(format);
  const a = { teamId: 'a', name: '飛達' }, b = { teamId: 'b', name: '中城' };
  const c = { teamId: 'c', name: '太原' }, d = { teamId: 'd', name: '山海' };
  const set = (key, home, away) => Object.assign(matches.find(m => m.matchKey === key), { home, away, status: 'finished', result: { winner: 'home' }, score: { home: 2, away: 1 } });
  set('SF1', a, b); set('SF2', c, d); set('F1', a, c); set('F3', b, d);
  return matches;
}
const build = (f = format, m = matchesFor(f)) => buildBracketModel(f, m, division);

test('勝隊標記只依完賽 result，領先、待定與重開均不標記', () => {
  const winner = { teamId: 'a', side: 'home', match: { status: 'finished', home: { teamId: 'a' }, away: { teamId: 'b' }, result: { winner: 'home' }, score: { home: 0, away: 10 } } };
  expect(isWinningBracketNode(winner)).toBe(true);
  expect(isWinningBracketNode({ ...winner, side: null })).toBe(true);
  expect(isWinningBracketNode({ ...winner, side: 'away', teamId: 'b' })).toBe(false);
  expect(isWinningBracketNode({ ...winner, teamId: null })).toBe(false);
  for (const status of ['live', 'halftime', 'scheduled']) expect(isWinningBracketNode({ ...winner, match: { ...winner.match, status } })).toBe(false);
  expect(isWinningBracketNode({ ...winner, match: { ...winner.match, result: null } })).toBe(false);
});

test('四強為四個來源、兩個晉級者、一個冠軍，女子來源順序保持 2/3 與 1/4', () => {
  const v = build(), tree = v.trees[0];
  expect(v.state).toBe('ready');
  expect(tree.leafCount).toBe(4); expect(tree.levels).toBe(3); expect(tree.nodes).toHaveLength(7);
  expect(tree.nodes.filter(n => !n.children.length).map(n => n.source.rank)).toEqual([2, 3, 1, 4]);
  expect(tree.root.teamId).toBeNull(); expect(tree.root.name).toBe('冠軍待定');
  expect(v.extra.map(e => e.slot.matchKey)).toEqual(['F3']);
});
test.each(['F6_GROUP_TOP_SEED_BYE', 'F8_GROUP_TOP_SEED_BYE'])('%s 正式輪空拓撲有六個來源與四層，不補假比賽', id => {
  const v = build(formats[id]), t = v.trees[0];
  expect(t.leafCount).toBe(6); expect(t.levels).toBe(4); expect(t.nodes).toHaveLength(11);
  expect(t.nodes.filter(n => n.depth === 2 && !n.children.length)).toHaveLength(2);
  expect(v.extra.map(e => e.slot.matchKey)).toEqual(id.startsWith('F8') ? ['F3', 'F7', 'F5'] : ['F3']);
});
test('直接冠季軍賽不製造準決賽；純循環不製造對戰圖', () => {
  expect(build(FORMATS.F4_RR_FINAL).trees[0].nodes).toHaveLength(3);
  expect(build({ stages: [{ type: 'roundRobin' }] }).state).toBe('none');
  expect(buildBracketModel(null, [], division).state).toBe('missing');
});
test('完賽結果決定冠軍，領先比分不能代替 result', () => {
  const matches = decided(); expect(build(format, matches).trees[0].root.teamId).toBe('a');
  const final = matches.find(m => m.matchKey === 'F1'); final.status = 'live';
  expect(build(format, matches).trees[0].root.teamId).toBeNull();
  final.status = 'finished'; final.result.winner = null; final.penaltyScore = { home: 5, away: 3 };
  expect(build(format, matches).trees[0].root.teamId).toBeNull();
  final.result.winner = 'away'; final.score = { home: 1, away: 1 };
  expect(build(format, matches).trees[0].root.teamId).toBe('c');
});
test('重開或改判上游時，舊下游隊名與冠軍不沿用', () => {
  const matches = decided(), sf1 = matches.find(m => m.matchKey === 'SF1');
  sf1.status = 'live';
  let v = build(format, matches); expect(v.trees[0].root.teamId).toBeNull();
  expect(v.trees[0].root.children[0].teamId).toBeNull();
  expect(v.extra[0].match.home.teamId).toBeUndefined();
  sf1.status = 'finished'; sf1.result.winner = 'away';
  v = build(format, matches); expect(v.trees[0].root.teamId).toBeNull();
  expect(v.trees[0].root.children[0].teamId).toBe('b');
  expect(v.trees[0].root.match.score).toBeNull();
  expect(v.trees[0].root.match.status).toBe('scheduled');
});
test('尚未填入的排名來源不從未定積分榜推測隊伍', () => {
  const v = build();
  expect(v.trees[0].nodes.every(n => !n.teamId)).toBe(true);
  expect(v.trees[0].nodes.find(n => n.source.rank === 2).name).toBe('甲組第2名');
});
test('判定勝可晉級；取消場次與平局不能產生冠軍', () => {
  const matches = decided(), f = matches.find(m => m.matchKey === 'F1');
  f.status = 'walkover'; expect(build(format, matches).trees[0].root.teamId).toBe('a');
  f.status = 'cancelled'; expect(build(format, matches).trees[0].root.teamId).toBeNull();
  f.status = 'finished'; f.result.winner = 'draw'; expect(build(format, matches).trees[0].root.teamId).toBeNull();
});
test('重複場次不能任選，其他組同 key 不干擾，缺場保留結構', () => {
  const m = matchesFor(format);
  expect(build(format, [...m, { ...m[0] }]).state).toBe('invalid');
  expect(build(format, [...m, { ...m[0], divisionId: 'other' }]).state).toBe('ready');
  expect(build(format, []).trees[0].nodes).toHaveLength(7);
  expect(build(format, []).trees[0].nodes.every(n => !n.match)).toBe(true);
});
test('缺失來源與循環設定停止畫圖，不能遞迴卡死', () => {
  const broken = structuredClone(format); broken.stages.find(s => s.stageId === 'placement').slots[0].home = { type: 'matchWinner', matchKey: 'F1' };
  expect(build(broken).state).toBe('invalid');
  broken.stages.find(s => s.stageId === 'placement').slots[0].home.matchKey = 'missing';
  expect(build(broken).state).toBe('invalid');
});

test('不完整賽制物件不使公開頁崩潰', () => {
  expect(buildBracketModel({ stages: {} }, [], division).state).toBe('missing');
  expect(buildBracketModel({ stages: [{ slots: {} }] }, [], division).state).toBe('invalid');
  expect(buildBracketModel({ stages: [null] }, [], division).state).toBe('invalid');
});
