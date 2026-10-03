import { teamNameBasis, validateTeamNames, renamedMatchPatch, renamedRankingRows, renamedBoardPatch } from '../../js/engine/team-name.js';

test('名稱與簡稱整理空白，簡稱留空以名稱前 20 字顯示，保留有效符號', () => {
  expect(validateTeamNames({ name: ' 飛達 <A> 足球隊 ', shortName: ' 飛達 ', reason: ' 修正隊名 ' })).toEqual({ errors: [], fields: { name: '飛達 <A> 足球隊', shortName: '飛達', reason: '修正隊名' } });
  expect(validateTeamNames({ name: '飛'.repeat(30), shortName: '', reason: '修正' }).fields.shortName).toBe('飛'.repeat(20));
});
test.each([
  { name: '' }, { name: ' '.repeat(3) }, { name: 'x'.repeat(61) }, { name: '隊\n名' }, { name: 123 },
  { shortName: 'x'.repeat(21) }, { shortName: '隊\u0000名' }, { reason: '' }, { reason: 'x'.repeat(201) }, { reason: '換\n名' }
])('空白、過長、非文字與控制字元拒絕：%j', over => {
  expect(validateTeamNames({ name: '新隊名', shortName: '新隊', reason: '修正', ...over }).errors.length).toBeGreaterThan(0);
});
test('更名版本只檢查隊名欄位，審核或名冊變動不會被改回去', () => {
  expect(teamNameBasis({ name: '原隊', status: 'approved', playerCount: 30 })).toEqual({ name: '原隊', shortName: null, revision: 0 });
  expect(teamNameBasis({ name: '新隊', shortName: '新', nameRevision: 3 })).toEqual({ name: '新隊', shortName: '新', revision: 3 });
});
const names = { name: '新的完整隊名', shortName: '新隊' };
test('賽程更名依球隊 ID，同場對手、佔位和比分不動', () => {
  const match = { home: { teamId: 't', name: '原隊', displayName: '原' }, away: { teamId: 'other', name: '原隊' }, score: { home: 3, away: 1 } };
  expect(renamedMatchPatch(match, 't', names)).toEqual({ 'home.name': '新的完整隊名', 'home.displayName': '新隊' });
  expect(renamedMatchPatch({ home: { teamId: null, placeholder: 'A組第一' } }, 't', names)).toEqual({});
  expect(match.score).toEqual({ home: 3, away: 1 });
});
test('排名改顯示名稱，手動名次與積分不動；看板不能把球員姓名變隊名', () => {
  const rows = [{ teamId: 't', name: '原隊', rank: 1, points: 9, locked: true }, { teamId: 'other', name: '另一隊', rank: 2 }];
  expect(renamedRankingRows(rows, 't', names)).toEqual([{ ...rows[0], name: '新隊' }, rows[1]]);
  expect(rows[0].name).toBe('原隊');
  const scorer = { teamId: 't', name: '小飛', playerId: 'p', teamName: '原隊', goals: 3 };
  expect(renamedBoardPatch({ rows: [scorer] }, 'scorers', 't', names)).toEqual({ rows: [{ ...scorer, teamName: '新隊' }] });
  expect(renamedBoardPatch({ rows }, 'fairplay', 't', names).rows[0]).toEqual({ ...rows[0], name: '新的完整隊名' });
});
test('首頁三區的賽程快照全部更名，直播、比分及對手資料保留', () => {
  const match = { matchId: 'm', home: { teamId: 't', name: '原隊', displayName: '原' }, away: { teamId: null, placeholder: '待定' }, score: { home: 1, away: 0 }, stream: { videoId: 'abcdefghijk' } };
  const board = { liveMatches: [match], nextMatches: [match], justFinished: [match], other: ['原隊'] };
  const patch = renamedBoardPatch(board, 'live', 't', names);
  for (const key of ['liveMatches', 'nextMatches', 'justFinished']) expect(patch[key][0]).toEqual({ ...match, home: { ...match.home, name: names.name, displayName: names.shortName } });
  expect(patch).not.toHaveProperty('other');
});
