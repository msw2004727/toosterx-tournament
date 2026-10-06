import { buildTimelineEdit, timelineEditMatchPatch, EDIT_EVENT_TYPES } from '../../js/engine/timeline-edit.js';
import { scoreFromTimeline } from '../../js/engine/timeline.js';
const m = { status: 'live', home: { teamId: 'h' }, away: { teamId: 'a' }, score: { home: 3, away: 2 } };
const d = { periods: 1 };
const rosters = { home: [{ memberId: 'p', displayName: '甲', jerseyNo: 167 }, { memberId: 'q', displayName: '乙', jerseyNo: null }], away: [{ memberId: 'r', displayName: '丙', jerseyNo: 9 }] };
const event = { timelineId: 'e', type: 'goal', side: 'home', teamId: 'h', periodId: 'h1', clockSec: 60, minute: 1,
  playerId: 'p', playerName: '甲', jerseyNo: 167, voided: false, note: '' };
const edit = patch => buildTimelineEdit({ event, patch, match: m, division: d, rosters });
const corrected = (after, match = m, events = [event]) => timelineEditMatchPatch({ match, events, before: event, after, division: d });
test('得分只調整修正差異，保留手動登錄比分；烏龍球轉給對手', () => {
  expect(corrected(edit({ type: 'own_goal' })).score).toEqual({ home: 2, away: 3 });
  expect(corrected(edit({ voided: true })).score).toEqual({ home: 2, away: 2 });
});
test('球員修正使用所選隊伍的名册快照，支持三位數與空背號', () => {
  expect(edit({ playerId: 'q' })).toMatchObject({ playerName: '乙', jerseyNo: null });
  expect(edit({})).toMatchObject({ jerseyNo: 167 });
  expect(() => edit({ side: 'away', playerId: 'p' })).toThrow('球員不在');
});
test('出牌、換人及轉換類型清掉無關欄位', () => {
  expect(edit({ type: 'card', cardType: 'red' })).toMatchObject({ cardType: 'red', goalType: null, assistPlayerId: null });
  expect(edit({ type: 'substitution', subInPlayerId: 'q' })).toMatchObject({ subInPlayerName: '乙' });
  expect(() => edit({ type: 'substitution', subInPlayerId: 'p' })).toThrow('必須不同');
  expect(edit({ type: 'note', note: '核對' })).toMatchObject({ side: 'neutral', playerId: null, teamId: null });
});
test.each(Object.keys(EDIT_EVENT_TYPES))('所有事件類型都能編輯：%s', type => {
  expect(edit({ type, cardType: 'yellow', subInPlayerId: 'q' }).type).toBe(type);
});
test('單節組別拒絕下半場；補時秒數可以修改而不改計時器', () => {
  expect(() => edit({ periodId: 'h2' })).toThrow('期別');
  expect(edit({ clockSec: 1801 })).toMatchObject({ clockSec: 1801, minute: 30 });
  for (const value of [-1, 1.2, '2', null, 86401]) expect(() => edit({ clockSec: value })).toThrow('時間');
});
test('未知欄位不可修改序號、建立者或跨場次；牌別與備註受到驗證', () => {
  for (const patch of [{ seq: 2 }, { createdBy: 'forged' }, { type: 'unknown' }, { note: 'x'.repeat(201) }, { type: 'card', cardType: 'blue' }]) expect(() => edit(patch)).toThrow();
});
test('完賽修改同步更新勝負，比分未完整或會變負數時拒絕', () => {
  expect(corrected(edit({ type: 'own_goal' }), { ...m, status: 'confirmed' }).result).toMatchObject({ winner: 'away' });
  expect(() => corrected(edit({ voided: true }), { ...m, score: { home: 0, away: 0 } })).toThrow('小於零');
  expect(() => corrected(edit({ voided: true }), { ...m, score: { home: null, away: null } })).toThrow('尚未完整');
});
test('判定勝保持規章比分；PK 不算正規比分，修正 PK 時只調 PK', () => {
  expect(corrected(edit({ voided: true }), { ...m, status: 'walkover', score: { home: 0, away: 2 } }).score).toEqual({ home: 0, away: 2 });
  const pk = { ...event, type: 'penalty_scored', periodId: 'pk' };
  expect(scoreFromTimeline([event, pk])).toEqual({ home: 1, away: 0 });
  const patch = timelineEditMatchPatch({ match: { ...m, penaltyScore: { home: 4, away: 3 } }, events: [pk], before: pk, after: { ...pk, side: 'away' }, division: d });
  expect(patch.score).toEqual(m.score); expect(patch.penaltyScore).toEqual({ home: 3, away: 4 });
});

test('保留已離隊助攻球員的原紀錄，但不得指定其他不在名冊的球員', () => {
  const old = { ...event, assistPlayerId: 'retired' };
  expect(buildTimelineEdit({ event: old, patch: { clockSec: 66 }, match: m, division: d, rosters }).assistPlayerId).toBe('retired');
  expect(() => buildTimelineEdit({ event: old, patch: { assistPlayerId: 'forged' }, match: m, division: d, rosters })).toThrow('球員不在');
});
