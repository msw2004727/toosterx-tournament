/**
 * T45 賽程管理的純邏輯
 * ------------------------------------------------------------------
 * 「要寫進 Firestore 的東西長什麼樣」——寫錯欄位不會報錯，
 * 只會讓賽務台在比賽當天讀到 undefined。
 */

import {
  approvedTeamsOf, scheduleConfigOf, venuesForDate, canRegenerate,
  planGeneration, planPlacement, matchDocOf, movePatch, drawSeedFrom, NOT_STARTED
} from '../../js/modules/admin/schedule-actions.js';
import { genericFormat, taipeiMs, SCHEDULE_DEFAULTS } from '../../js/engine/schedule.js';
import { FORMATS } from '../../js/engine/formats.js';

const DIV = {
  divisionId: 'adult-open', code: 'AO', name: '成人公開組', date: '2026-10-11',
  matchDurationMin: 30, playersOnField: 9
};
const U10 = {
  divisionId: 'u10', code: 'U10', name: 'U10兒童組', date: '2026-10-11',
  matchDurationMin: 25, playersOnField: 5
};
const VENUES = [
  { venueId: 'venue-a', name: 'A場', fieldType: '9v9', order: 1 },
  { venueId: 'venue-b', name: 'B場', fieldType: '9v9', order: 2 }
];
const CFG = scheduleConfigOf({
  startTime: '08:30', endTime: '18:00', bufferMin: 10, minRestMin: 20, maxGapMin: 240,
  venuesByDate: { '2026-10-11': ['venue-a', 'venue-b'] }
});

const team = (id, over = {}) => ({
  teamId: id, name: `${id}足球隊`, shortName: id,
  divisionId: 'adult-open', status: 'approved', withdrawn: false, ...over
});

describe('T45-A 哪些球隊會上場', () => {
  test('只有核准的、沒有撤銷的、這一組的', () => {
    const list = [
      team('a'),
      team('b', { status: 'submitted' }),
      team('c', { withdrawn: true }),
      team('d', { divisionId: 'women' }),
      team('e')
    ];
    expect(approvedTeamsOf(list, 'adult-open').map(t => t.teamId)).toEqual(['a', 'e']);
  });

  test('空的也不會炸', () => {
    expect(approvedTeamsOf(null, 'x')).toEqual([]);
  });
});

describe('T45-B 排程設定', () => {
  test('⭐ 讀不到設定時回預設值，而且說得出「那是預設值」', () => {
    const c = scheduleConfigOf(null);
    expect(c.startTime).toBe(SCHEDULE_DEFAULTS.startTime);
    // saved:false 就是畫面上那一句「還沒存進 config/schedule」的依據。
    // 悄悄套預設值的話，主辦會以為那幾個數字已經在資料庫裡了
    expect(c.saved).toBe(false);
    expect(scheduleConfigOf({}).saved).toBe(true);
  });

  test('沒設定當天場地就回全部（有場地總比排不出來好）', () => {
    expect(venuesForDate({ venuesByDate: {} }, '2026-10-11', VENUES)).toHaveLength(2);
    expect(venuesForDate(null, '2026-10-11', VENUES)).toHaveLength(2);
  });

  test('設定了就照設定，順序也照設定', () => {
    const v = venuesForDate({ venuesByDate: { '2026-10-11': ['venue-b'] } }, '2026-10-11', VENUES);
    expect(v.map(x => x.venueId)).toEqual(['venue-b']);
  });

  test('設定裡有不存在的場地就跳過，不留一個 undefined', () => {
    const v = venuesForDate({ venuesByDate: { d: ['venue-zz', 'venue-a'] } }, 'd', VENUES);
    expect(v.map(x => x.venueId)).toEqual(['venue-a']);
  });
});

describe('T45-C 能不能重新產生', () => {
  test('都還沒開打就可以', () => {
    expect(canRegenerate([{ matchId: 'A', status: 'scheduled' }, { matchId: 'B', status: 'ready' }]).ok).toBe(true);
    expect(canRegenerate([]).ok).toBe(true);
  });

  test('⭐ 只要有一場開打就整組擋下來', () => {
    // 重抽一次籤，打完的那幾場會變成不同小組之間的比賽，
    // 積分榜會靜靜算出一份沒有人看得懂的結果
    for (const s of ['live', 'halftime', 'finished', 'confirmed', 'walkover']) {
      const r = canRegenerate([{ matchId: 'A', status: 'scheduled' }, { matchId: 'B', status: s }]);
      expect(r.ok).toBe(false);
      expect(r.started).toEqual(['B']);
      expect(r.reason).toContain('不能重新產生');
    }
  });

  test('沒開打的狀態清單跟守衛一致', () => {
    expect(NOT_STARTED).toContain('scheduled');
    expect(NOT_STARTED).not.toContain('finished');
  });
});

describe('T45-D 產生計畫', () => {
  const eight = Array.from({ length: 8 }, (_, i) => team(`t-${i + 1}`));

  test('分組、對戰、階段、球隊指派一次都給齊', () => {
    const p = planGeneration({ division: DIV, orderedTeams: eight, format: FORMATS.F8_GROUP_CROSS });
    expect(p.matches).toHaveLength(20);
    expect(p.groupDocs.map(g => g.groupId)).toEqual(['A', 'B']);
    expect(p.stages.map(s => s.stageId)).toEqual(['group', 'placement', 'final']);
    expect(p.assignments).toHaveLength(8);
  });

  test('⭐ 每一隊都拿到 seed 與 groupId（少一個，積分榜就少一列）', () => {
    const p = planGeneration({ division: DIV, orderedTeams: eight, format: FORMATS.F8_GROUP_CROSS });
    expect(p.assignments.every(a => Number.isInteger(a.seed) && a.groupId)).toBe(true);
    expect(p.assignments.map(a => a.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('seed 就是傳進來的順序（抽籤結果不會被別的東西重排）', () => {
    const shuffled = [eight[3], eight[0], eight[7], eight[1], eight[2], eight[4], eight[5], eight[6]];
    const p = planGeneration({ division: DIV, orderedTeams: shuffled, format: FORMATS.F8_GROUP_CROSS });
    expect(p.assignments[0]).toMatchObject({ teamId: 't-4', seed: 1 });
  });

  test('通用範本也走同一支', () => {
    const five = Array.from({ length: 5 }, (_, i) => team(`t-${i + 1}`));
    const p = planGeneration({ division: DIV, orderedTeams: five, format: genericFormat(5) });
    expect(p.matches).toHaveLength(10);
    expect(p.groupDocs).toHaveLength(1);
  });
});

describe('T45-E 場次文件', () => {
  const m = {
    matchId: 'AO-G-A-01', divisionId: 'adult-open', stageId: 'group', groupId: 'A',
    round: 1, label: 'A組 第1輪', matchKey: null,
    home: { teamId: 'a', displayName: '甲' }, away: { teamId: 'b', displayName: '乙' },
    teamIds: ['a', 'b']
  };

  test('⭐ 賽務台會讀到的欄位一個都不能少', () => {
    const d = matchDocOf({ m, division: DIV, eventId: 'e1' });
    for (const k of [
      'matchId', 'eventId', 'divisionId', 'stageId', 'groupId', 'round', 'matchNo', 'label',
      'matchKey', 'date', 'kickoffAt', 'venueId', 'venueName', 'home', 'away', 'teamIds',
      'score', 'htScore', 'penaltyScore', 'status', 'period', 'clock', 'result',
      'walkoverSide', 'walkoverReason', 'officials', 'stream', 'checkin', 'lock',
      'scoreMismatch', 'revisionCount'
    ]) {
      expect(Object.prototype.hasOwnProperty.call(d, k)).toBe(true);
    }
  });

  test('新場次一定是 scheduled、沒鎖、0:0', () => {
    const d = matchDocOf({ m, division: DIV, eventId: 'e1' });
    expect(d.status).toBe('scheduled');
    expect(d.lock.locked).toBe(false);
    expect(d.score).toEqual({ home: 0, away: 0 });
    expect(d.result.winner).toBeNull();
  });

  test('還沒排時間就是 null，不要填一個假的時間', () => {
    const d = matchDocOf({ m, division: DIV, eventId: 'e1' });
    expect(d.kickoffAt).toBeNull();
    expect(d.venueId).toBeNull();
    expect(d.matchNo).toBeNull();
  });

  test('排好時間就轉成 Date（Firestore 會存成 Timestamp）', () => {
    const ms = taipeiMs('2026-10-11', '09:00');
    const d = matchDocOf({ m: { ...m, kickoffMs: ms, venueId: 'venue-a' }, division: DIV, eventId: 'e1', venueName: 'A場' });
    expect(d.kickoffAt instanceof Date).toBe(true);
    expect(d.kickoffAt.getTime()).toBe(ms);
    expect(d.venueName).toBe('A場');
  });

  test('date 取自組別（公開端的賽程頁靠這個欄位查詢）', () => {
    expect(matchDocOf({ m, division: DIV, eventId: 'e1' }).date).toBe('2026-10-11');
  });
});

describe('T45-F 自動排定', () => {
  const gen = (division, n) => planGeneration({
    division,
    orderedTeams: Array.from({ length: n }, (_, i) => team(`${division.code}-${i + 1}`, { divisionId: division.divisionId })),
    format: genericFormat(n)
  }).matches;

  test('排得出來，時間都落在設定的區間內', () => {
    const { placed, unplaced } = planPlacement({
      division: DIV, matches: gen(DIV, 6), otherMatches: [], venues: VENUES,
      cfg: CFG, divisions: [DIV]
    });
    expect(unplaced).toHaveLength(0);
    expect(placed.every(m => m.kickoffMs >= taipeiMs('2026-10-11', '08:30'))).toBe(true);
    expect(placed.every(m => m.kickoffMs <= taipeiMs('2026-10-11', '18:00'))).toBe(true);
  });

  test('⭐ 會避開別的組別已經排好的場次', () => {
    const other = [{
      matchId: 'X', divisionId: 'u10', date: '2026-10-11',
      venueId: 'venue-a', kickoffAt: taipeiMs('2026-10-11', '08:30'), teamIds: ['x1', 'x2']
    }, {
      matchId: 'Y', divisionId: 'u10', date: '2026-10-11',
      venueId: 'venue-b', kickoffAt: taipeiMs('2026-10-11', '08:30'), teamIds: ['y1', 'y2']
    }];
    const { placed } = planPlacement({
      division: DIV, matches: gen(DIV, 4), otherMatches: other, venues: VENUES,
      cfg: CFG, divisions: [DIV, U10]
    });
    expect(placed.every(m => m.kickoffMs > taipeiMs('2026-10-11', '08:30'))).toBe(true);
  });

  test('⭐ 自己這一組已經排好的不算佔用（不然每重排一次就整批往後擠）', () => {
    // 只給**一片**場地，這樣「有沒有濾掉自己」才看得出差別：
    // 兩片場地的話，被自己擋住的那一場會挪到另一片，時間仍然是 08:30，
    // 測試照樣綠——變異 #S16 第一版就是這樣逃掉的
    const mine = [{
      matchId: 'AO-G-A-01', divisionId: 'adult-open', date: '2026-10-11',
      venueId: 'venue-a', kickoffAt: taipeiMs('2026-10-11', '08:30'), teamIds: ['a', 'b']
    }];
    const { placed } = planPlacement({
      division: DIV, matches: gen(DIV, 4), otherMatches: mine, venues: [VENUES[0]],
      cfg: CFG, divisions: [DIV]
    });
    expect(placed[0].kickoffMs).toBe(taipeiMs('2026-10-11', '08:30'));
    expect(placed[0].venueId).toBe('venue-a');
  });

  test('⭐ 組別沒有比賽日期就全部回報排不下，不用今天的日期硬排', () => {
    const { placed, unplaced } = planPlacement({
      division: { ...DIV, date: null }, matches: gen(DIV, 4), venues: VENUES,
      cfg: CFG, divisions: [DIV]
    });
    expect(placed).toHaveLength(0);
    expect(unplaced[0].reason).toContain('沒有比賽日期');
  });

  test('別的日期的場次不算佔用（時間區間本來就不會重疊）', () => {
    const other = [{
      matchId: 'X', divisionId: 'u10', date: '2026-10-09',
      venueId: 'venue-a', kickoffAt: taipeiMs('2026-10-09', '08:30'), teamIds: ['x1']
    }];
    const { placed } = planPlacement({
      division: DIV, matches: gen(DIV, 4), otherMatches: other, venues: VENUES,
      cfg: CFG, divisions: [DIV, U10]
    });
    expect(placed[0].kickoffMs).toBe(taipeiMs('2026-10-11', '08:30'));
  });

  test('⭐ date 欄位跟 kickoffAt 對不起來時，以時間為準（不可以漏掉真的衝突）', () => {
    // 資料不一致的時候用 date 去濾，會把一個真的撞場濾掉——
    // 然後安靜地排出兩場同時同地
    const other = [
      { matchId: 'X', divisionId: 'u10', date: '2026-10-09', venueId: 'venue-a',
        kickoffAt: taipeiMs('2026-10-11', '08:30'), teamIds: ['x1', 'x2'] },
      { matchId: 'Y', divisionId: 'u10', date: '2026-10-09', venueId: 'venue-b',
        kickoffAt: taipeiMs('2026-10-11', '08:30'), teamIds: ['y1', 'y2'] }
    ];
    const { placed } = planPlacement({
      division: DIV, matches: gen(DIV, 4), otherMatches: other, venues: VENUES,
      cfg: CFG, divisions: [DIV, U10]
    });
    expect(placed[0].kickoffMs).toBeGreaterThan(taipeiMs('2026-10-11', '08:30'));
  });
});

describe('T45-G 小工具', () => {
  test('movePatch 只動時間與場地', () => {
    const p = movePatch({ kickoffMs: 1000, venueId: 'venue-a', venueName: 'A場' });
    expect(Object.keys(p).sort()).toEqual(['kickoffAt', 'venueId', 'venueName']);
    expect(p.kickoffAt.getTime()).toBe(1000);
  });

  test('清空時間與場地是 null，不是留著舊值', () => {
    const p = movePatch({ kickoffMs: null, venueId: null, venueName: null });
    expect(p).toEqual({ kickoffAt: null, venueId: null, venueName: null });
  });

  test('⭐ 抽籤種子由呼叫端給時間（引擎不碰 Date.now，R-ENG-004）', () => {
    expect(drawSeedFrom(1757000000000)).toBe(Math.floor(1757000000000 % 2147483647));
    expect(Number.isInteger(drawSeedFrom(Date.now()))).toBe(true);
    expect(() => drawSeedFrom(undefined)).toThrow(TypeError);
    expect(() => drawSeedFrom(NaN)).toThrow(TypeError);
  });
});
