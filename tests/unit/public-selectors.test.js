/**
 * T32 公開端純邏輯
 * ------------------------------------------------------------------
 * 規格：docs/03-功能規格-公開端.md
 *
 * 這裡測的是「怎麼挑、怎麼排、怎麼分群」——畫面長什麼樣交給 E2E。
 * 重點放在幾個會靜靜出錯的地方：
 *   ・沒有時間的場次跑到最前面（家長會以為那是下一場）
 *   ・晉級區用陣列位置判斷（rows 沒排好或有並列時會標錯隊）
 *   ・排不出名次時自己填一個數字進去（這是不可協商的紅線）
 */

import {
  sortByKickoff, groupBySlot, splitHomeSections,
  filterMatches, filterToQuery, queryToFilter,
  viewStanding, sortStandings, sortRoster,
  publicMember, leakedFields, PUBLIC_MEMBER_FIELDS,
  embedUrl, isPlaceholder, sideLabel, isLiveMatch, isDoneMatch,
  hiddenScorerDivisions
} from '../../js/modules/public/selectors.js';

const T = (h, m = 0) => Date.parse(`2026-10-11T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`);
const match = (over = {}) => ({
  matchId: 'm1', date: '2026-10-11', divisionId: 'adult-open', venueId: 'venue-a',
  kickoffAt: T(9, 30), status: 'scheduled',
  home: { teamId: 't1', name: '野狼' }, away: { teamId: 't2', name: '猛虎' },
  score: { home: 0, away: 0 }, ...over
});

describe('T32-1 排序與分群', () => {
  test('依開賽時間升冪，同時間依場地', () => {
    const rows = sortByKickoff([
      match({ matchId: 'b', kickoffAt: T(9, 30), venueId: 'venue-b' }),
      match({ matchId: 'c', kickoffAt: T(10, 10) }),
      match({ matchId: 'a', kickoffAt: T(9, 30), venueId: 'venue-a' })
    ]);
    expect(rows.map(r => r.matchId)).toEqual(['a', 'b', 'c']);
  });

  test('⭐ 沒有開賽時間的場次排最後，不是最前面', () => {
    // 排最前面的話，「接下來」第一列就是一場時間未定的比賽——
    // 家長會以為那是下一場，然後錯過真正的下一場。
    const rows = sortByKickoff([
      match({ matchId: 'unknown', kickoffAt: null }),
      match({ matchId: 'real', kickoffAt: T(9, 30) })
    ]);
    expect(rows[0].matchId).toBe('real');
    expect(rows[1].matchId).toBe('unknown');
  });

  test('每 30 分鐘一個時段群組', () => {
    const g = groupBySlot([
      match({ matchId: 'a', kickoffAt: T(9, 30) }),
      match({ matchId: 'b', kickoffAt: T(9, 45) }),
      match({ matchId: 'c', kickoffAt: T(10, 10) })
    ], () => 'X');
    expect(g).toHaveLength(2);
    expect(g[0].matches.map(m => m.matchId)).toEqual(['a', 'b']);
    expect(g[1].matches.map(m => m.matchId)).toEqual(['c']);
  });

  test('⭐ 時間未定的場次不可以掛在某個時段標題底下', () => {
    // 真正的風險不是「分群分錯」，是**標題騙人**：
    // 一場時間還沒定的比賽出現在「09:30」底下，家長就會 9:25 到場。
    const g = groupBySlot([
      match({ matchId: 'a', kickoffAt: T(9, 30) }),
      match({ matchId: 'x', kickoffAt: null }),
      match({ matchId: 'y', kickoffAt: null })
    ], ms => `時段${ms}`);

    const unknown = g.find(x => x.matches.some(m => m.matchId === 'x'));
    expect(unknown.label).toBe('時間未定');
    expect(unknown.label).not.toMatch(/^時段/);
    // 兩筆無時間的要在同一群，不是各自一群
    expect(unknown.matches.map(m => m.matchId)).toEqual(['x', 'y']);
    // 有時間的那一群不可以被汙染
    expect(g.find(x => x.label.startsWith('時段')).matches.map(m => m.matchId)).toEqual(['a']);
  });
});

describe('T32-2 首頁三區', () => {
  const now = T(12, 0);
  const set = [
    match({ matchId: 'live1', status: 'live', kickoffAt: T(11, 40) }),
    match({ matchId: 'next1', status: 'scheduled', kickoffAt: T(12, 30) }),
    match({ matchId: 'next2', status: 'ready', kickoffAt: T(13, 0), home: { teamId: 'tX', name: 'X' } }),
    match({ matchId: 'done1', status: 'finished', kickoffAt: T(10, 0) })
  ];

  test('分成進行中／接下來／剛結束', () => {
    const s = splitHomeSections({ matches: set, nowMs: now });
    expect(s.live.map(m => m.matchId)).toEqual(['live1']);
    expect(s.next.map(m => m.matchId)).toEqual(['next1', 'next2']);
    expect(s.done.map(m => m.matchId)).toEqual(['done1']);
  });

  test('⭐ 還沒到時間的完賽場次不算「剛結束」', () => {
    // 種子資料常常整天的場次都先建好，狀態被誤設成 finished 的話
    // 首頁會出現「剛結束」一場其實還沒打的比賽
    const future = match({ matchId: 'later', status: 'finished', kickoffAt: T(18, 0) });
    const s = splitHomeSections({ matches: [...set, future], nowMs: now });
    expect(s.done.map(m => m.matchId)).not.toContain('later');
  });

  test('完賽的排序以完賽時間優先，沒有才用開賽時間', () => {
    const a = match({ matchId: 'early', status: 'finished', kickoffAt: T(9, 0), scoreSubmittedAt: T(11, 55) });
    const b = match({ matchId: 'late', status: 'finished', kickoffAt: T(10, 0), scoreSubmittedAt: T(10, 40) });
    const s = splitHomeSections({ matches: [b, a], nowMs: now });
    expect(s.done.map(m => m.matchId)).toEqual(['early', 'late']);
  });
});

describe('T32-3 篩選與網址', () => {
  const set = [
    match({ matchId: 'a', divisionId: 'u10', venueId: 'venue-a' }),
    match({ matchId: 'b', divisionId: 'adult-open', venueId: 'venue-b', home: { teamId: 'tF', name: 'F' } })
  ];

  test('⭐ 已經沒有「我的關注」這個篩選（2026-09-03 移除關注功能）', () => {
    // 按鈕拿掉之後就沒有任何入口可以加入關注，留一個永遠是空的篩選器
    // 只會讓人以為系統壞了。網址上的舊參數也不該再被解析。
    expect(filterToQuery({ onlyFollowed: true })).toBe('');
    expect(queryToFilter('follow=1')).not.toHaveProperty('onlyFollowed');
    expect(filterMatches(set, { onlyFollowed: true })).toHaveLength(2);
  });

  test('空值代表不限', () => {
    expect(filterMatches(set, {})).toHaveLength(2);
    expect(filterMatches(set, { divisionId: 'u10' }).map(m => m.matchId)).toEqual(['a']);
    expect(filterMatches(set, { venueId: 'venue-b' }).map(m => m.matchId)).toEqual(['b']);
  });

  test('⭐ 篩選條件 ⇄ 網址可以來回（家長會把連結貼進 LINE 群組）', () => {
    const f = { date: '2026-10-11', divisionId: 'u10', venueId: 'venue-a' };
    expect(queryToFilter(filterToQuery(f))).toEqual(f);
  });

  test('沒有條件時網址是乾淨的', () => {
    expect(filterToQuery({})).toBe('');
    expect(queryToFilter('')).toEqual({ date: null, divisionId: null, venueId: null });
  });
});

describe('T32-4 積分榜（只讀不算）', () => {
  const doc = (over = {}) => ({
    standingId: 'adult-open__group__A', divisionId: 'adult-open', stageId: 'group', groupId: 'A',
    hasUnresolvedTie: false,
    rows: [
      { rank: 1, teamId: 't1', name: '野狼', played: 3, win: 2, draw: 1, loss: 0, goalsFor: 7, goalsAgainst: 2, goalDiff: 5, points: 7 },
      { rank: 2, teamId: 't2', name: '猛虎', played: 3, win: 2, draw: 0, loss: 1, goalsFor: 5, goalsAgainst: 3, goalDiff: 2, points: 6 }
    ],
    ...over
  });

  test('rows 是空的是正常狀態，不是錯誤', () => {
    const v = viewStanding(doc({ rows: [] }));
    expect(v.isEmpty).toBe(true);
    expect(v.rows).toEqual([]);
  });

  test('連 rows 欄位都沒有也不能爆', () => {
    expect(viewStanding({}).isEmpty).toBe(true);
    expect(viewStanding(null).isEmpty).toBe(true);
    expect(viewStanding(undefined).rows).toEqual([]);
  });

  test('⭐ hasUnresolvedTie 要傳到畫面，不可以吞掉', () => {
    expect(viewStanding(doc({ hasUnresolvedTie: true })).hasUnresolvedTie).toBe(true);
  });

  test('⭐ 排不出名次的那一列標成 unresolved，不可以自己給它一個名次', () => {
    const v = viewStanding(doc({
      rows: [{ teamId: 't1', name: '野狼', rank: null }, { teamId: 't2', name: '猛虎', rank: 2 }]
    }));
    expect(v.rows[0].unresolved).toBe(true);
    expect(v.rows[0].rank).toBeNull();
    expect(v.rows[1].unresolved).toBe(false);
  });

  test('⭐ 晉級區用 rank 判斷，不是用陣列位置', () => {
    // rows 有可能沒排好（Function 寫入順序不保證），也有可能兩隊並列第 1。
    // 用位置判斷的話，會把陣列第一筆標成晉級，即使它的 rank 是 3。
    const v = viewStanding(doc({
      rows: [
        { teamId: 't3', name: 'C', rank: 3 },
        { teamId: 't1', name: 'A', rank: 1 },
        { teamId: 't2', name: 'B', rank: 2 }
      ]
    }), { qualifyCount: 2 });
    expect(v.rows.map(r => [r.name, r.qualified])).toEqual([['C', false], ['A', true], ['B', true]]);
  });

  test('⭐ 缺欄位時顯示 0 而不是 undefined，但不可以用 Number() 硬轉', () => {
    const v = viewStanding(doc({ rows: [{ rank: 1, teamId: 't1', name: 'A' }] }));
    expect(v.rows[0].played).toBe(0);
    expect(v.rows[0].points).toBe(0);
    // 字串比分是壞資料，不能被當成數字混進畫面
    const bad = viewStanding(doc({ rows: [{ rank: 1, teamId: 't1', name: 'A', points: '7' }] }));
    expect(bad.rows[0].points).toBe(0);
  });

  test('form 只留最近 5 場', () => {
    const v = viewStanding(doc({ rows: [{ rank: 1, form: ['W', 'D', 'L', 'W', 'W', 'D', 'W'] }] }));
    expect(v.rows[0].form).toHaveLength(5);
    expect(v.rows[0].form.at(-1)).toBe('W');
  });

  test('多份積分榜依階段→小組排序', () => {
    const s = sortStandings([
      { stageId: 'knockout', groupId: null },
      { stageId: 'group', groupId: 'B' },
      { stageId: 'group', groupId: 'A' }
    ]);
    expect(s.map(x => `${x.stageId}${x.groupId ?? ''}`)).toEqual(['groupA', 'groupB', 'knockout']);
  });
});

describe('T32-5 未定隊伍與隊名', () => {
  test('排名階段還沒解算時算 placeholder', () => {
    expect(isPlaceholder(match({ home: { slotLabel: 'A組第1名' } }))).toBe(true);
    expect(isPlaceholder(match())).toBe(false);
  });

  test('隊名優先序：name → displayName → slotLabel → 待定', () => {
    expect(sideLabel(match(), 'home')).toBe('野狼');
    expect(sideLabel(match({ home: { slotLabel: 'A組第1名' } }), 'home')).toBe('A組第1名');
    expect(sideLabel(match({ home: {} }), 'home')).toBe('待定');
  });

  test('狀態判定', () => {
    expect(isLiveMatch({ status: 'live' })).toBe(true);
    expect(isLiveMatch({ status: 'halftime' })).toBe(true);
    expect(isDoneMatch({ status: 'walkover' })).toBe(true);
    expect(isDoneMatch({ status: 'scheduled' })).toBe(false);
  });
});

describe('T32-6 名單與隱私投影', () => {
  const raw = {
    memberId: 'm-1', teamId: 't1', displayName: '王○明', jerseyNo: 7, position: 'MF',
    role: 'player', isCaptain: true, photoUrl: null, stats: { apps: 3, goals: 2 },
    // 以下都是**不該出現在公開投影裡**的欄位
    name: '王小明', birthDate: '2016-03-14', idLast4: '1234', guardianName: '王大明',
    qrCode: 'FEDA1.xxx'
  };

  test('⭐ 白名單以外的欄位一律丟掉', () => {
    const p = publicMember(raw);
    for (const k of ['name', 'birthDate', 'idLast4', 'guardianName', 'qrCode']) {
      expect(p[k]).toBeUndefined();
    }
    expect(p.displayName).toBe('王○明');
    expect(Object.keys(p).every(k => PUBLIC_MEMBER_FIELDS.includes(k))).toBe(true);
  });

  test('⭐ 偵測得到上游投影漏了私密欄位', () => {
    expect(leakedFields(raw).sort()).toEqual(
      ['birthDate', 'guardianName', 'idLast4', 'name', 'qrCode'].sort());
    expect(leakedFields(publicMember(raw))).toEqual([]);
  });

  test('stats 缺項補 0，字串不當成數字', () => {
    const p = publicMember({ memberId: 'x', stats: { goals: '5' } });
    expect(p.stats).toEqual({ apps: 0, goals: 0, assists: 0, yellow: 0, red: 0 });
  });

  test('球員排在職員前面，球員依背號', () => {
    const s = sortRoster([
      { role: 'coach', displayName: '李教練' },
      { role: 'player', jerseyNo: 7, displayName: '王' },
      { role: 'player', jerseyNo: 1, displayName: '陳' }
    ]);
    expect(s.map(m => m.displayName)).toEqual(['陳', '王', '李教練']);
  });

  test('沒有背號的球員排在有背號的後面，不是被當成 0 號', () => {
    const s = sortRoster([
      { role: 'player', displayName: '無號' },
      { role: 'player', jerseyNo: 9, displayName: '九號' }
    ]);
    expect(s.map(m => m.displayName)).toEqual(['九號', '無號']);
  });
});

describe('T32-7 直播來源', () => {
  test('每場獨立影片優先於場地機位', () => {
    const u = embedUrl({ match: { stream: { videoId: 'AAA' } }, venue: { stream: { channelId: 'UC1' } } });
    expect(u).toContain('/embed/AAA');
  });

  test('場地機位用 live_stream + channel', () => {
    const u = embedUrl({ venue: { stream: { channelId: 'UC1', status: 'live' } } });
    expect(u).toContain('/embed/live_stream?channel=UC1');
  });

  test('回放帶時間點', () => {
    const u = embedUrl({ match: { stream: { videoId: 'AAA', startOffsetSec: 90 } } });
    expect(u).toContain('start=90');
  });

  test('⭐ 一律 youtube-nocookie（隱私模式）', () => {
    const u = embedUrl({ match: { stream: { videoId: 'AAA' } } });
    expect(u.startsWith('https://www.youtube-nocookie.com/')).toBe(true);
    expect(u).not.toContain('//www.youtube.com/');
  });

  test('⭐ status 為 off 時回 null（Admin 一鍵關掉直播，畫面要換佔位圖而不是破圖）', () => {
    expect(embedUrl({ match: { stream: { videoId: 'AAA', status: 'off' } } })).toBeNull();
    expect(embedUrl({ venue: { stream: { channelId: 'UC1', status: 'off' } } })).toBeNull();
    expect(embedUrl({ venue: { stream: { channelId: 'UC1', enabled: false } } })).toBeNull();
  });

  test('什麼都沒有就回 null', () => {
    expect(embedUrl({})).toBeNull();
    expect(embedUrl()).toBeNull();
  });

  test('videoId 會被逸出，惡意值不能拼出別的網址', () => {
    const u = embedUrl({ match: { stream: { videoId: 'a/../../evil?x=1' } } });
    expect(u).not.toContain('evil?x=1');
    expect(u).toContain('a%2F..%2F..%2Fevil%3Fx%3D1');
  });
});

describe('T32-X 兒童組不公開個人射手榜（docs/03 §9.1）', () => {
  // ⚠️ 這一組的價值不在「函式會不會算」，在於它盯著**欄位路徑**。
  //    第一版讀的是 division.youth 與 division.featureFlags.youthScorerBoard，
  //    兩個欄位在真實資料庫裡都不存在（已對 feda-cup-demo 核對），
  //    於是守衛永遠不會生效——而畫面看起來完全正常。
  const divisions = [
    { divisionId: 'u10', display: { scorerBoard: false } },
    { divisionId: 'u6', display: { scorerBoard: false } },
    { divisionId: 'adult-open', display: { scorerBoard: true } },
    { divisionId: 'women', display: { scorerBoard: true } }
  ];

  test('⭐ 依 display.scorerBoard 判斷，不是把 divisionId 寫死', () => {
    const hidden = hiddenScorerDivisions(divisions, {});
    expect([...hidden].sort()).toEqual(['u10', 'u6']);
    expect(hidden.has('adult-open')).toBe(false);
  });

  test('⭐ featureFlags.youthScorerBoard 打開就全部解除', () => {
    expect(hiddenScorerDivisions(divisions, { youthScorerBoard: true }).size).toBe(0);
  });

  test('⭐ 旗標讀不到時走保守的那一邊（照樣隱藏）', () => {
    for (const flags of [null, undefined, {}, { youthScorerBoard: 'true' }, { youthScorerBoard: 1 }]) {
      expect(hiddenScorerDivisions(divisions, flags).has('u10')).toBe(true);
    }
  });

  test('組別讀不到時回空集合，不要整頁擋掉', () => {
    expect(hiddenScorerDivisions(null, {}).size).toBe(0);
    expect(hiddenScorerDivisions([], {}).size).toBe(0);
  });
});
