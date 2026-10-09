import { disciplineMatches, disciplineDetails } from '../../js/modules/public/selectors.js';
import { computeFairPlayBoard } from '../../js/engine/awards.js';

const teams = { a: { divisionId: 'adult' }, b: { divisionId: 'adult' }, c: { divisionId: 'youth' } };
const match = (matchId, extra = {}) => ({ matchId, divisionId: 'adult', status: 'finished',
  home: { teamId: 'a', name: 'A 隊' }, away: { teamId: 'b', name: 'B 隊' },
  score: { home: 1, away: 0 }, kickoffAt: '2026-10-09T09:00:00+08:00', ...extra });
const card = (extra = {}) => ({ matchId: 'm1', teamId: 'a', playerId: 'p1', type: 'card',
  cardType: 'yellow', periodId: 'h1', clockSec: 90, seq: 1, ...extra });
const select = (matches, extra = {}) => disciplineMatches({ matches, teams, divisionId: 'adult', teamId: 'a', ...extra });

test('明細場次和官方牌數共用有效完賽範圍，包含淘汰賽與有效判定勝', () => {
  const matches = [match('m1'), match('ko', { stageId: 'knockout', status: 'confirmed' }),
    match('wo', { status: 'walkover', walkoverSide: 'away', score: null }),
    match('live', { status: 'live' }), match('cancel', { status: 'cancelled' }),
    match('no-score', { score: { home: null, away: 0 } }), match('bad-wo', { status: 'walkover' }),
    match('moved', { away: { teamId: 'c' } }), match('self', { away: { teamId: 'a' } }),
    match('other', { divisionId: 'youth' }), match('not-a', { home: { teamId: 'b' }, away: { teamId: 'b' } })];
  expect(select(matches).map(m => m.matchId)).toEqual(['m1', 'ko', 'wo']);
  const events = matches.map(m => card({ matchId: m.matchId }));
  const valid = matches.filter(m => !['moved', 'self', 'other', 'not-a'].includes(m.matchId));
  const board = computeFairPlayBoard({ matches: valid, teams, cardEvents: events }).find(r => r.teamId === 'a');
  expect(disciplineDetails({ matches: select(matches), events, teamId: 'a' })).toHaveLength(board.yellow);
});

test('退賽作廢與保留判定勝都沿用組別規則', () => {
  const withdrawn = { ...teams, b: { ...teams.b, withdrawn: true } };
  expect(select([match('m1')], { teams: withdrawn })).toEqual([]);
  expect(select([match('m1')], { teams: withdrawn, withdrawalPolicy: 'keepAsWalkover' })).toHaveLength(1);
});

test('只顯示本隊有效牌，第二黃保留，期別及分秒先於補登序號排序', () => {
  const rows = disciplineDetails({ matches: select([match('m1')]), teamId: 'a', events: [
    card({ cardType: 'red', periodId: 'h2', clockSec: 1, seq: 0 }),
    card({ cardType: 'second_yellow', clockSec: 120, seq: 2 }), card({ clockSec: 90, seq: 99 }),
    card({ voided: true }), card({ teamId: 'b' }), card({ type: 'goal' }),
    card({ cardType: 'invalid' }), card({ matchId: 'other' })
  ] });
  expect(rows.map(r => r.cardType)).toEqual(['yellow', 'second_yellow', 'red']);
  expect(rows.map(r => r.clockSec)).toEqual([90, 120, 1]);
});

test('姓名只取公開投影，缺名不退回事件真名，背號 0 及三位數保留', () => {
  const rows = disciplineDetails({ matches: select([match('m1')]), teamId: 'a',
    events: [card({ playerName: 'PRIVATE EVENT' }), card({ playerId: 'p2', playerName: 'OTHER PRIVATE' }),
      card({ playerId: 'missing', playerName: 'MISSING PRIVATE', clockSec: undefined })],
    roster: [{ memberId: 'p1', displayName: '陳Ｏ明', name: 'PRIVATE ROSTER', jerseyNo: 0, birthDate: '2018-01-01' },
      { memberId: 'p2', name: 'PRIVATE ONLY', jerseyNo: 999 }] });
  expect(rows.map(r => [r.playerName, r.jerseyNo])).toEqual([['陳Ｏ明', 0], ['未提供姓名', 999], ['未提供姓名', null]]);
  expect(rows[2].clockSec).toBeNull();
  expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|birthDate|2018/);
});

test('依賽程排序且未定時間排最後，不修改輸入事件', () => {
  const matches = [match('late', { kickoffAt: null }), match('later', { kickoffAt: '2026-10-09T10:00:00+08:00' }), match('m1')];
  const events = [card({ clockSec: 150 }), card({ clockSec: 30 })];
  const original = JSON.stringify(events);
  expect(select(matches).map(m => m.matchId)).toEqual(['m1', 'later', 'late']);
  expect(disciplineDetails({ matches: select(matches), events, teamId: 'a' }).map(r => r.clockSec)).toEqual([30, 150]);
  expect(JSON.stringify(events)).toBe(original);
});
