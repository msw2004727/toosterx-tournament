import fs from 'node:fs';
import { advancementLabels, publishedFinalRanking, knockoutDefaultReady } from '../../js/modules/public/division-progress.js';
const formats = JSON.parse(fs.readFileSync(new URL('../fixtures/bracket-formats.json', import.meta.url)));
const division = { divisionId: 'u8', schedulePublished: true };
const standings = () => ['A', 'B'].map(groupId => ({ stageId: 'group', groupId, rows: [1, 2, 3].map(rank => ({ rank, teamId: `${groupId}${rank}`, played: 2 })) }));
const format = formats.F6_GROUP_TOP_SEED_BYE;

test('預設晉級圖要完整的小組完賽來源，雙循環、未發布或缺場次不可提早切換',()=>{
 const matches=['A','B'].flatMap(groupId=>[1,2,3].map(i=>({stageId:'group',groupId,status:'finished'})));
 expect(knockoutDefaultReady(format,division,matches)).toBe(true);
 expect(knockoutDefaultReady(format,division,matches.slice(1))).toBe(false);
 expect(knockoutDefaultReady(format,division,matches.map((m,i)=>i?m:{...m,status:'live'}))).toBe(false);
 expect(knockoutDefaultReady(format,{schedulePublished:false},matches)).toBe(false);
 const twice={...format,stages:format.stages.map(s=>s.type==='roundRobin'?{...s,legs:2}:s)};
 expect(knockoutDefaultReady(twice,division,matches)).toBe(false);
 expect(knockoutDefaultReady(twice,division,[...matches,...matches])).toBe(true);
});
test('六隊依冠軍路線顯示兩隊直晉四強與四隊晉級，不把積分榜第三名當淘汰', () => {
  const labels = advancementLabels(format, division, standings());
  expect(labels.size).toBe(6);
  expect(labels.get('group:A:A1')).toEqual({ label: '直晉四強', bye: true });
  expect(labels.get('group:B:B3')).toEqual({ label: '晉級淘汰賽', bye: false });
});
test('未打滿、跨組未完成、待裁定、缺小組或未發布不顯示確定晉級', () => {
  for (const change of [s => s[1].rows[0].played = 1, s => s[1].hasUnresolvedTie = true,
    s => s[0].rows[0].rank = null, s => s.pop(), s => s[0].rows[0].hasUnresolvedTie = true]) {
    const s = standings(); change(s); expect(advancementLabels(format, division, s).size).toBe(0);
  }
  expect(advancementLabels(format, { ...division, schedulePublished: false }, standings()).size).toBe(0);
  expect(advancementLabels(null, division, standings()).size).toBe(0);
});
test('雙循環必須全部打滿；八隊末位名次賽不冒充冠軍路線的晉級', () => {
  const double = structuredClone(format); double.stages[0].legs = 2;
  expect(advancementLabels(double, division, standings()).size).toBe(0);
  const s = standings(); s.forEach(doc => doc.rows.forEach(r => r.played = 4));
  expect(advancementLabels(double, division, s).size).toBe(6);
  const eight = standings(); eight.forEach(doc => { doc.rows.push({ rank: 4, teamId: `${doc.groupId}4`, played: 3 }); doc.rows.forEach(r => r.played = 3); });
  const labels = advancementLabels(formats.F8_GROUP_TOP_SEED_BYE, division, eight);
  expect(labels.size).toBe(6); expect(labels.has('group:A:A4')).toBe(false);
});
test('最終名次只顯示已發布有效資料，不沿用撤回、過期或重複隊伍／名次', () => {
  const d = { finalRankingPublished: true, finalRanking: [{ rank: 2, teamId: 'b' }, { rank: 1, teamId: 'a' }] };
  expect(publishedFinalRanking(d).map(r => r.rank)).toEqual([1, 2]);
  expect(d.finalRanking[0].rank).toBe(2);
  for (const override of [{ finalRankingPublished: false }, { finalRankingStale: true }, { finalRanking: [{ rank: 1, teamId: 'a' }, { rank: 2, teamId: 'a' }] }, { finalRanking: [{ rank: 1, teamId: 'a' }, { rank: 1, teamId: 'b' }] }]) {
    expect(publishedFinalRanking({ ...d, ...override })).toEqual([]);
  }
});
