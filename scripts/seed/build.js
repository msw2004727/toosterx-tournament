/**
 * 種子資料產生器（純函式）
 * ------------------------------------------------------------------
 * 規格：docs/01b 欄位定義、docs/02 賽制引擎、docs/06 Challenge
 *
 * buildSeed() 回傳一個 { path, data } 陣列，不碰任何 I/O，
 * 因此可以直接 --dry-run 驗證筆數與賽程結構，不需要連 Firestore。
 *
 * 所有隨機都走固定種子的 LCG，同樣的輸入永遠產生同樣的輸出。
 */

import { berger, snakeSeed, groupLabel } from '../../js/engine/berger.js';
import { FORMATS, RANKING_RULES, DIVISIONS, STAGE_CODE } from '../../js/engine/formats.js';

const EVENT_ID = 'feda-cup-2026';

// ─── 固定種子亂數（可重現） ────────────────────────────────────────
function makeRng(seed = 20261009) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// ─── 名稱素材 ─────────────────────────────────────────────────────
const TEAM_NAMES = {
  u6:          ['臺中小獅', '臺中小虎', '豐原飛鷹', '太平閃電', '西屯火箭', '北屯藍鯨'],
  u8:          ['大里勇士', '烏日獵犬', '南屯星辰', '沙鹿浪潮', '清水海鷗', '后里疾風'],
  u10:         ['臺中晨星', '潭子雷鳥', '神岡飛馬', '龍井白鯊', '大甲金剛', '霧峰蒼狼'],
  women:       ['臺中花木蘭', '臺中海燕', '豐原玫瑰', '太平飛燕'],
  'adult-fun': ['臺中野狼', '臺中猛虎', '臺中獵鷹', '臺中藍鯨',
                '臺中閃電', '臺中星光', '臺中火箭', '臺中晨曦'],
  'adult-open':['臺中雷霆', '臺中黑豹', '臺中蒼鷹', '臺中怒濤',
                '臺中赤焰', '臺中北極星', '臺中鋼鐵', '臺中長風']
};

const TEAM_ABBR = {
  臺中小獅: 'LIO', 臺中小虎: 'TGC', 豐原飛鷹: 'FEG', 太平閃電: 'TPB', 西屯火箭: 'XRK', 北屯藍鯨: 'BWH',
  大里勇士: 'DLW', 烏日獵犬: 'WRH', 南屯星辰: 'NTS', 沙鹿浪潮: 'SLT', 清水海鷗: 'QSG', 后里疾風: 'HLW',
  臺中晨星: 'DWN', 潭子雷鳥: 'TZT', 神岡飛馬: 'SGP', 龍井白鯊: 'LJS', 大甲金剛: 'DJK', 霧峰蒼狼: 'WFW',
  臺中花木蘭: 'MUL', 臺中海燕: 'SWL', 豐原玫瑰: 'ROS', 太平飛燕: 'SWF',
  臺中野狼: 'WLF', 臺中猛虎: 'TGR', 臺中獵鷹: 'EGL', 臺中藍鯨: 'WHL',
  臺中閃電: 'BLT', 臺中星光: 'STR', 臺中火箭: 'RCK', 臺中晨曦: 'DAW',
  臺中雷霆: 'THD', 臺中黑豹: 'PAN', 臺中蒼鷹: 'HWK', 臺中怒濤: 'SRG',
  臺中赤焰: 'BLZ', 臺中北極星: 'POL', 臺中鋼鐵: 'IRN', 臺中長風: 'GAL'
};

const SURNAMES = ['陳','林','黃','張','李','王','吳','劉','蔡','楊','許','鄭','謝','郭','洪','曾','邱','廖','賴','周'];
const GIVEN    = ['志明','家豪','俊傑','建宏','冠廷','承翰','宇軒','柏翰','品睿','伯宇',
                  '柏儒','子齊','政宏','明哲','允誠','昱翔','立群','翊庭','宗翰','以恆'];
const GIVEN_F  = ['雅婷','怡君','欣怡','詩涵','宜蓁','語彤','家瑜','采蓁','思妤','品妍'];

const POSITIONS_5 = ['GK', 'DF', 'DF', 'MF', 'MF', 'FW', 'MF', 'FW'];
const POSITIONS_9 = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW', 'DF', 'MF', 'FW'];

const STAFF_ROLES_5 = [['coach', '總教練'], ['manager', '領隊']];
const STAFF_ROLES_9 = [['coach', '總教練'], ['manager', '領隊'], ['medic', '隊醫']];

// 兒童組驗齡基準（2026/1/1）
const BIRTH_YEAR = { u6: 2020, u8: 2018, u10: 2016, women: 1998, 'adult-fun': 1995, 'adult-open': 1996 };

// ─── 場地 ─────────────────────────────────────────────────────────
const VENUES = [
  { venueId: 'venue-a', name: 'A場', fullName: '太原足球場 A場', order: 1, fieldType: '9v9' },
  { venueId: 'venue-b', name: 'B場', fullName: '太原足球場 B場', order: 2, fieldType: '9v9' },
  { venueId: 'venue-c', name: 'C場', fullName: '太原足球場 C場', order: 3, fieldType: '5v5' }
];

/** 各日可用場地：10/9 三片（5 人制）、10/10 與 10/11 兩片（9 人制） */
const VENUES_BY_DATE = {
  '2026-10-09': ['venue-a', 'venue-b', 'venue-c'],
  '2026-10-10': ['venue-a', 'venue-b'],
  '2026-10-11': ['venue-a', 'venue-b']
};

const DAY_START_HOUR = 8;
const DAY_START_MIN = 30;
const BUFFER_MIN = 10;

// ─── Challenge 五關 ───────────────────────────────────────────────
const CHALLENGES = [
  { challengeId: 'g01-nine-grid', order: 1, icon: '🎯',
    name: '九宮格射門挑戰', shortName: '九宮格', boothLocation: '攤位 1',
    description: '球門設置九宮格目標，於指定距離射門，不同位置不同分數。',
    rulesText: '每人 5 球。一般區 1 分、中難度 2 分、高難度角落 3 分，加總為總分。',
    scoreType: 'points', unit: '分', rankingRule: 'higher', decimals: 0,
    minValue: 0, maxValue: 15, inputMode: 'shots', shotCount: 5, shotOptions: [0, 1, 2, 3] },

  { challengeId: 'g02-header-king', order: 2, icon: '🦘',
    name: 'C羅高空頭球挑戰', shortName: 'C羅頭球', boothLocation: '攤位 2',
    description: '取材自 C 羅具代表性的高空頭球，挑戰能完成多高位置的頭球。',
    rulesText: '依序挑戰各高度，完成後可挑戰下一級，紀錄成功完成的最高高度。',
    scoreType: 'height', unit: 'cm', rankingRule: 'higher', decimals: 0,
    minValue: 150, maxValue: 260, inputMode: 'ladder',
    ladderSteps: [180, 190, 200, 205, 210, 215, 220] },

  { challengeId: 'g03-crossbar', order: 3, icon: '🎪',
    name: 'Ronaldinho 橫樑挑戰', shortName: '橫樑', boothLocation: '攤位 3',
    description: '取材自 Ronaldinho 經典的橫樑足球技巧，從指定距離射門擊中橫樑。',
    rulesText: '固定 5 球，紀錄擊中橫樑次數。',
    scoreType: 'count', unit: '次', rankingRule: 'higher', decimals: 0,
    minValue: 0, maxValue: 5, inputMode: 'stepper', stepperMax: 5 },

  { challengeId: 'g04-speed-king', order: 4, icon: '⚡',
    name: '足球球速王', shortName: '球速王', boothLocation: '攤位 4',
    description: '使用球速雷達測量射門球速。',
    rulesText: '每人 3 球，取最高一次球速。',
    scoreType: 'speed', unit: 'km/h', rankingRule: 'higher', decimals: 0,
    minValue: 20, maxValue: 150, inputMode: 'numpad' },

  { challengeId: 'g05-first-touch', order: 5, icon: '🎯',
    name: '停球王挑戰', shortName: '停球王', boothLocation: '攤位 5',
    description: '利用發球設備將球送向玩家，玩家必須完成第一腳停球控制。',
    rulesText: '5 次停球。完美區 3 分、控制區 2 分、外圍 1 分、失敗 0 分。',
    scoreType: 'points', unit: '分', rankingRule: 'higher', decimals: 0,
    minValue: 0, maxValue: 15, inputMode: 'shots', shotCount: 5, shotOptions: [0, 1, 2, 3] }
];

const DEFAULT_ATTEMPT_POLICY = { maxAttemptsPerPlayer: 3, allowRepeat: true, rankBy: 'best' };

// ─── 角色權限 ─────────────────────────────────────────────────────
const ROLE_PERMISSIONS = {
  guest:       { perms: {} },
  booth:       { perms: { 'challenge.attempt.write': true } },
  scorer:      { perms: { 'match.score.write': true, 'checkin.write': true, 'matchsheet.write': true } },
  referee:     { perms: { 'match.score.write': true, 'checkin.write': true, 'matchsheet.write': true,
                          'match.confirm': true } },
  venue_lead:  { perms: { 'match.score.write': true, 'checkin.write': true, 'matchsheet.write': true,
                          'match.confirm': true, 'audit.read': true } },
  admin:       { perms: { 'match.score.write': true, 'match.score.override': true, 'match.reopen': true,
                          'checkin.write': true, 'matchsheet.write': true, 'match.confirm': true,
                          'team.manage': true, 'schedule.manage': true, 'standing.manual': true,
                          'export': true, 'audit.read': true } },
  super_admin: { perms: { '*': true } }
};

/** Demo 環境用的工作人員（safety：seed 只在 demo 專案執行） */
const DEMO_STAFF = [
  { uid: 'demo-admin',   name: '示範管理員', roles: ['admin'],      venueIds: [],                     challengeIds: [] },
  { uid: 'demo-lead-a',  name: '示範場地主任', roles: ['venue_lead'], venueIds: ['venue-a'],            challengeIds: [] },
  { uid: 'demo-scorer-a',name: '示範賽務A',   roles: ['scorer'],     venueIds: ['venue-a'],            challengeIds: [] },
  { uid: 'demo-scorer-b',name: '示範賽務B',   roles: ['scorer'],     venueIds: ['venue-b'],            challengeIds: [] },
  { uid: 'demo-referee', name: '示範裁判',    roles: ['referee'],    venueIds: ['venue-a', 'venue-b'], challengeIds: [] },
  ...CHALLENGES.map((c, i) => ({
    uid: `demo-booth-${i + 1}`, name: `示範攤位${i + 1}`, roles: ['booth'],
    venueIds: [], challengeIds: [c.challengeId]
  }))
];

// ══════════════════════════════════════════════════════════════════
//  產生器
// ══════════════════════════════════════════════════════════════════

function buildTeams(rng) {
  const teams = [];
  const members = [];
  let teamSeq = 100;

  for (const div of DIVISIONS) {
    const names = TEAM_NAMES[div.divisionId];
    if (names.length !== div.teamCount) {
      throw new Error(`${div.divisionId} 隊名數量 ${names.length} 與 teamCount ${div.teamCount} 不符`);
    }

    names.forEach((name, idx) => {
      teamSeq += 1;
      const teamId = `t-${teamSeq}`;
      const isYouth = ['u6', 'u8', 'u10'].includes(div.divisionId);
      const is5v5 = div.playersOnField === 5;
      const playerCount = is5v5 ? 8 : 14;
      const positions = is5v5 ? POSITIONS_5 : POSITIONS_9;
      const staffRoles = is5v5 ? STAFF_ROLES_5 : STAFF_ROLES_9;

      teams.push({
        teamId, eventId: EVENT_ID, divisionId: div.divisionId,
        name: `${name}足球隊`, shortName: name, abbr: TEAM_ABBR[name] || name.slice(-2),
        logoUrl: null,
        colors: { primary: '#1B4E82', secondary: '#F5A623' },
        intro: `${name}足球隊，${div.name}參賽隊伍。本資料為 Demo 種子資料。`,
        founded: 2015 + (idx % 8),
        homeRegion: '臺中市',
        rosterLocked: true,
        memberCount: { player: playerCount, staff: staffRoles.length },
        seed: idx + 1,
        groupId: null,             // generateSchedule 時填入
        withdrawn: false,
        finalRank: null,
        seedData: true
      });

      // 球員
      for (let p = 0; p < playerCount; p++) {
        const isFemale = div.divisionId === 'women';
        const given = isFemale ? pick(rng, GIVEN_F) : pick(rng, GIVEN);
        const memberId = `m-${teamSeq}-${String(p + 1).padStart(2, '0')}`;
        const jerseyNo = p + 1;
        const pos = positions[p % positions.length];
        const birthYear = BIRTH_YEAR[div.divisionId] - (isYouth ? 0 : (p % 12));
        members.push({
          _teamId: teamId,
          memberId, teamId, eventId: EVENT_ID, divisionId: div.divisionId,
          role: 'player',
          name: `${pick(rng, SURNAMES)}${given}`,
          jerseyNo, position: pos,
          isCaptain: p === 6 % playerCount,
          isGoalkeeper: pos === 'GK',
          photoUrl: null,
          birthYear,
          birthDate: `${birthYear}-0${1 + (p % 9)}-1${p % 9}`,
          idLast4: String(1000 + ((teamSeq * 17 + p * 13) % 9000)),
          guardianConsent: isYouth,
          guardianName: isYouth ? `${pick(rng, SURNAMES)}${pick(rng, GIVEN)}` : null,
          stats: { apps: 0, goals: 0, assists: 0, yellow: 0, red: 0, minutes: 0 },
          eligibility: { status: 'ok', checkedBy: 'seed', checkedAt: null, note: '' },
          seedData: true
        });
      }

      // 職員
      staffRoles.forEach(([role, label], s) => {
        const memberId = `m-${teamSeq}-s${s + 1}`;
        members.push({
          _teamId: teamId,
          memberId, teamId, eventId: EVENT_ID, divisionId: div.divisionId,
          role,
          name: `${pick(rng, SURNAMES)}${label}`,
          jerseyNo: null, position: null,
          isCaptain: false, isGoalkeeper: false,
          photoUrl: null,
          birthYear: 1980 + s, birthDate: null,
          idLast4: null, guardianConsent: false, guardianName: null,
          stats: null,
          eligibility: { status: 'ok', checkedBy: 'seed', checkedAt: null, note: '' },
          seedData: true
        });
      });
    });
  }

  return { teams, members };
}

/** 依 Format 產生某組別的所有 stage / group / match（尚未排時間） */
function buildDivisionSchedule(div, divTeams) {
  const format = FORMATS[div.formatId];
  if (!format) throw new Error(`找不到 formatId=${div.formatId}`);
  if (format.teamCount !== divTeams.length) {
    throw new Error(`${div.divisionId}：Format 需要 ${format.teamCount} 隊，實際 ${divTeams.length} 隊`);
  }

  const stages = [];
  const groups = [];
  const matches = [];
  const groupAssign = {};   // teamId -> groupId

  for (const st of format.stages) {
    stages.push({
      stageId: st.stageId, name: st.name, type: st.type, order: st.order,
      groupCount: st.groupCount ?? null, legs: st.legs ?? null,
      drawRule: st.drawRule ?? 'none',
      status: 'pending', advancementResolved: false
    });

    if (st.type === 'roundRobin') {
      const grouped = snakeSeed(divTeams, st.groupCount);
      grouped.forEach((teamsInGroup, gi) => {
        const gid = groupLabel(gi);
        groups.push({
          stageId: st.stageId, groupId: gid, name: `${gid}組`,
          teamIds: teamsInGroup.map(t => t.teamId), order: gi + 1
        });
        teamsInGroup.forEach(t => { groupAssign[t.teamId] = gid; });

        const rounds = berger(teamsInGroup.length);
        let seq = 0;
        rounds.forEach((round, ri) => {
          round.forEach(([h, a]) => {
            seq += 1;
            const home = teamsInGroup[h];
            const away = teamsInGroup[a];
            matches.push({
              matchId: `${div.code}-${STAGE_CODE[st.stageId]}-${gid}-${String(seq).padStart(2, '0')}`,
              divisionId: div.divisionId, stageId: st.stageId, groupId: gid,
              round: ri + 1, label: `${gid}組 第${ri + 1}輪`,
              home: teamRef(home), away: teamRef(away),
              teamIds: [home.teamId, away.teamId],
              _sortKey: [st.order, ri + 1, gi, seq]
            });
          });
        });
      });
    } else {
      (st.slots || []).forEach((slot, si) => {
        matches.push({
          matchId: `${div.code}-${STAGE_CODE[st.stageId]}-${slot.matchKey}`,
          divisionId: div.divisionId, stageId: st.stageId, groupId: null,
          round: slot.round ?? 1, label: slot.label,
          matchKey: slot.matchKey,
          home: placeholderRef(slot.home),
          away: placeholderRef(slot.away),
          teamIds: [],
          _sortKey: [st.order, slot.round ?? 1, 0, si + 1]
        });
      });
    }
  }

  return { stages, groups, matches, groupAssign };
}

function teamRef(t) {
  return {
    teamId: t.teamId, name: t.shortName, abbr: t.abbr,
    logoUrl: t.logoUrl, colorPrimary: t.colors?.primary ?? null,
    placeholder: null, displayName: t.shortName
  };
}

function placeholderRef(src) {
  const label =
    src.type === 'standing'    ? `${src.groupId}組第${src.rank}名`
  : src.type === 'matchWinner' ? `${src.matchKey} 勝隊`
  : src.type === 'matchLoser'  ? `${src.matchKey} 敗隊`
  : '待定';
  return {
    teamId: null, name: null, abbr: null, logoUrl: null, colorPrimary: null,
    placeholder: src, displayName: label
  };
}

/**
 * 把某一天的所有場次排進時段與場地。
 * 貪婪法：依 _sortKey 逐場放進「雙方都有空、且有場地空」的最早時段。
 */
function scheduleDay(date, dayMatches, slotMinutesByDivision) {
  const venues = VENUES_BY_DATE[date];
  const busyTeam = new Map();     // teamId -> Set(slotIndex)
  const busyVenue = new Map();    // `${venueId}:${slot}` -> true
  const placed = [];

  const sorted = [...dayMatches].sort((x, y) => {
    for (let i = 0; i < 4; i++) {
      const d = (x._sortKey[i] ?? 0) - (y._sortKey[i] ?? 0);
      if (d !== 0) return d;
    }
    return x.matchId.localeCompare(y.matchId);
  });

  // 同一天可能有多個組別，時段長度取當日最長的一種，避免場地時間互相錯開
  const slotMin = Math.max(...new Set(dayMatches.map(m => slotMinutesByDivision[m.divisionId])));

  // 台北固定 UTC+8，直接算出 UTC 瞬間，不受執行環境時區影響
  const pad = n => String(n).padStart(2, '0');
  const dayStartMs = Date.parse(`${date}T${pad(DAY_START_HOUR)}:${pad(DAY_START_MIN)}:00+08:00`);

  for (const m of sorted) {
    let slot = 0;
    for (;; slot++) {
      const teamFree = m.teamIds.every(t => !(busyTeam.get(t)?.has(slot)));
      const venue = venues.find(v => !busyVenue.get(`${v}:${slot}`));
      if (teamFree && venue) {
        busyVenue.set(`${venue}:${slot}`, true);
        m.teamIds.forEach(t => {
          if (!busyTeam.has(t)) busyTeam.set(t, new Set());
          busyTeam.get(t).add(slot);
        });
        placed.push({
          ...m, venueId: venue, slot,
          kickoffAt: new Date(dayStartMs + slot * slotMin * 60000)
        });
        break;
      }
      if (slot > 200) throw new Error(`排程失敗：${m.matchId}`);
    }
  }
  return placed;
}

// ══════════════════════════════════════════════════════════════════
//  主入口
// ══════════════════════════════════════════════════════════════════

export function buildSeed({ seed = 20261009 } = {}) {
  const rng = makeRng(seed);
  const docs = [];
  const add = (path, data) => docs.push({ path, data });
  const E = `events/${EVENT_ID}`;

  // ── 全站設定 ──
  add('config/formats',          { formats: FORMATS });
  add('config/rankingRules',     { rules: RANKING_RULES });
  add('config/challengeRewards', {
    rule: 'perChallengeCompleted', entriesPerCompletion: 1,
    bonusAllComplete: 2, maxEntriesPerPlayer: 10
  });
  add('config/featureFlags', {
    liveTimeline: true, scorerBoard: true, photoWall: false, youthScorerBoard: false
  });
  // ⚠️ 只有 demo 專案才會有這份文件（seed 有安全鎖，R-SEED-001）。
  //    allowSelfServeStaff 讓人免 LINE 登入就能試用賽務台；
  //    firestore.rules 讀這個旗標決定要不要放行「自己建立自己的工作人員身分」。
  //    正式專案不得存在這份文件，或必須設為 false。
  add('config/env', {
    env: 'demo',
    allowSelfServeStaff: true,
    note: '這是 Demo 環境設定。正式環境不可開啟 allowSelfServeStaff。'
  });
  for (const [role, v] of Object.entries(ROLE_PERMISSIONS)) add(`rolePermissions/${role}`, v);
  for (const s of DEMO_STAFF) {
    add(`staff/${s.uid}`, {
      uid: s.uid, name: s.name, lineUserId: null, roles: s.roles,
      assignment: {
        eventId: EVENT_ID, date: null,
        venueIds: s.venueIds, divisionIds: [], challengeIds: s.challengeIds
      },
      deviceLabel: s.uid.toUpperCase(), active: true, demoOnly: true, seedData: true
    });
  }

  // ── 活動 ──
  add(E, {
    eventId: EVENT_ID,
    name: 'FEDA CUP 2026｜飛達盃',
    officialName: '2026臺中市足球教育發展協會理事長盃足球賽',
    subtitle: '臺中足球社群賽',
    seriesTag: 'Community Taichung Series',
    slogan: '從社群走向賽場',
    organizer: '臺中市足球教育發展協會',
    sponsors: [{ name: '台灣美津濃股份有限公司', tier: 'partner', logoUrl: null, linkUrl: null }],
    dates: ['2026-10-09', '2026-10-10', '2026-10-11'],
    venueName: '太原足球場',
    timezone: 'Asia/Taipei',
    status: 'published',
    flags: {
      publicScoreVisible: true, liveStreamEnabled: true, checkinEnabled: true,
      challengeEnabled: true, registrationOpen: false
    },
    challengeQrToken: 'FEDA26',
    seedData: true
  });

  for (const v of VENUES) {
    add(`${E}/venues/${v.venueId}`, {
      ...v, geo: { lat: 24.1698, lng: 120.7150 },
      stream: { enabled: false, provider: 'youtube', channelId: null, videoId: null, status: 'off' },
      activeMatchId: null, seedData: true
    });
  }

  // ── 球隊與名單 ──
  const { teams, members } = buildTeams(rng);

  // ── 賽程 ──
  const allMatches = [];
  const slotMinutes = {};
  for (const div of DIVISIONS) {
    const divTeams = teams.filter(t => t.divisionId === div.divisionId);
    const { stages, groups, matches, groupAssign } = buildDivisionSchedule(div, divTeams);

    add(`${E}/divisions/${div.divisionId}`, {
      divisionId: div.divisionId, name: div.name, shortName: div.shortName,
      date: div.date, teamCount: div.teamCount, playersOnField: div.playersOnField,
      matchDurationMin: div.matchDurationMin,
      formatId: div.formatId, rankingRuleId: div.rankingRuleId,
      colorToken: div.colorToken, order: div.order, code: div.code,
      display: div.display,
      status: 'scheduled', finalRankingPublished: false, finalRanking: null,
      seedData: true
    });

    for (const st of stages) add(`${E}/divisions/${div.divisionId}/stages/${st.stageId}`, st);
    for (const g of groups) {
      add(`${E}/divisions/${div.divisionId}/stages/${g.stageId}/groups/${g.groupId}`, {
        groupId: g.groupId, name: g.name, teamIds: g.teamIds, order: g.order
      });
      add(`${E}/standings/${div.divisionId}__${g.stageId}__${g.groupId}`, {
        standingId: `${div.divisionId}__${g.stageId}__${g.groupId}`,
        eventId: EVENT_ID, divisionId: div.divisionId, stageId: g.stageId, groupId: g.groupId,
        rows: g.teamIds.map((teamId, i) => {
          const t = teams.find(x => x.teamId === teamId);
          return {
            rank: i + 1, teamId, name: t.shortName, abbr: t.abbr, logoUrl: null,
            played: 0, win: 0, draw: 0, loss: 0,
            goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0,
            yellow: 0, red: 0, fairPlayPoints: 0, form: [], tieBreakTrace: [],
            locked: false, note: ''
          };
        }),
        version: 0, hasUnresolvedTie: false,
        manualOverride: { enabled: false, by: null, at: null, reason: null },
        seedData: true
      });
    }

    // 回填球隊的小組
    for (const t of teams) if (groupAssign[t.teamId]) t.groupId = groupAssign[t.teamId];

    slotMinutes[div.divisionId] = div.matchDurationMin + BUFFER_MIN;
    matches.forEach(m => allMatches.push({ ...m, _date: div.date }));
  }

  // 逐日排程
  const scheduled = [];
  for (const date of Object.keys(VENUES_BY_DATE)) {
    const dayMatches = allMatches.filter(m => m._date === date);
    scheduled.push(...scheduleDay(date, dayMatches, slotMinutes));
  }
  scheduled.sort((a, b) => a.kickoffAt - b.kickoffAt || a.venueId.localeCompare(b.venueId));

  scheduled.forEach((m, i) => {
    const venue = VENUES.find(v => v.venueId === m.venueId);
    add(`${E}/matches/${m.matchId}`, {
      matchId: m.matchId, eventId: EVENT_ID,
      divisionId: m.divisionId, stageId: m.stageId, groupId: m.groupId,
      round: m.round, matchNo: i + 1, label: m.label,
      matchKey: m.matchKey ?? null,
      date: m._date, kickoffAt: m.kickoffAt,
      venueId: m.venueId, venueName: venue.name,
      home: m.home, away: m.away, teamIds: m.teamIds,
      score: { home: 0, away: 0 }, htScore: { home: 0, away: 0 },
      penaltyScore: { home: null, away: null },
      status: 'scheduled', period: 'pre',
      clock: { running: false, periodStartedAt: null, elapsedSecAtPause: 0, addedTimeSec: 0 },
      result: { winner: null, method: null, homePoints: 0, awayPoints: 0 },
      walkoverSide: null, walkoverReason: null,
      officials: { referee: null, assistants: [], scorer: null },
      stream: { enabled: false, provider: 'youtube', videoId: null, startOffsetSec: 0, status: 'off' },
      checkin: { homeConfirmed: false, awayConfirmed: false, confirmedAt: null },
      lock: { locked: false, lockedAt: null, lockedBy: null },
      scoreMismatch: false, revisionCount: 0,
      seedData: true
    });
  });

  // ── 球隊與名單文件（在賽程之後寫，groupId 才是最終值）──
  for (const t of teams) {
    const { seedData, ...rest } = t;
    add(`${E}/teams/${t.teamId}`, { ...rest, seedData: true });
  }
  for (const m of members) {
    const { _teamId, ...rest } = m;
    add(`${E}/teams/${_teamId}/members/${m.memberId}`, rest);
    add(`${E}/teams/${_teamId}/roster/${m.memberId}`, {
      memberId: m.memberId, teamId: m.teamId, divisionId: m.divisionId,
      displayName: maskName(m.name, m.divisionId),
      jerseyNo: m.jerseyNo, position: m.position, role: m.role,
      isCaptain: m.isCaptain, isGoalkeeper: m.isGoalkeeper,
      photoUrl: null,
      stats: m.stats ?? { apps: 0, goals: 0, assists: 0, yellow: 0, red: 0 },
      order: m.jerseyNo ?? 900
    });
  }

  // ── Challenge ──
  for (const c of CHALLENGES) {
    add(`${E}/challenges/${c.challengeId}`, {
      ...c, eventId: EVENT_ID,
      attemptPolicy: { ...DEFAULT_ATTEMPT_POLICY },
      status: 'open', stats: { players: 0, attempts: 0 }, seedData: true
    });
    add(`${E}/leaderboards/${c.challengeId}`, {
      challengeId: c.challengeId, rows: [], topN: 50, totalPlayers: 0, version: 0, seedData: true
    });
  }

  // ── 公開看板 ──
  add(`${E}/boards/live`, { boardId: 'live', liveMatches: [], nextMatches: [], justFinished: [], seedData: true });
  add(`${E}/boards/scorers`, { boardId: 'scorers', rows: [], seedData: true });

  return { docs, stats: summarise(docs, scheduled) };
}

/** 未滿 13 歲只顯示「姓＋名首字＋＊」（docs/03 §7.3） */
function maskName(name, divisionId) {
  if (!['u6', 'u8', 'u10'].includes(divisionId)) return name;
  return name.length <= 2 ? name : `${name.slice(0, 2)}＊`;
}

function summarise(docs, scheduled) {
  const count = p => docs.filter(d => d.path.includes(p)).length;
  const byDivision = {};
  for (const m of scheduled) {
    byDivision[m.divisionId] = (byDivision[m.divisionId] || 0) + 1;
  }
  const byDate = {};
  for (const m of scheduled) byDate[m._date] = (byDate[m._date] || 0) + 1;

  // ── 排程完整性自檢（每次產生都跑，出問題直接看得到）──
  const teamSlot = new Set();
  const venueSlot = new Set();
  let teamConflicts = 0;
  let venueConflicts = 0;
  const perTeam = {};
  for (const m of scheduled) {
    const ts = m.kickoffAt.toISOString();
    if (venueSlot.has(`${m.venueId}|${ts}`)) venueConflicts += 1;
    venueSlot.add(`${m.venueId}|${ts}`);
    for (const t of m.teamIds) {
      if (teamSlot.has(`${t}|${ts}`)) teamConflicts += 1;
      teamSlot.add(`${t}|${ts}`);
      perTeam[t] = (perTeam[t] || 0) + 1;
    }
  }
  const groupMatchDist = {};
  for (const n of Object.values(perTeam)) groupMatchDist[n] = (groupMatchDist[n] || 0) + 1;

  return {
    teamConflicts,
    venueConflicts,
    placeholderMatches: scheduled.filter(m => !m.home.teamId || !m.away.teamId).length,
    groupMatchDist,
    totalDocs: docs.length,
    teams: docs.filter(d => /\/teams\/[^/]+$/.test(d.path)).length,
    members: docs.filter(d => /\/members\//.test(d.path)).length,
    roster: docs.filter(d => /\/roster\//.test(d.path)).length,
    matches: scheduled.length,
    matchesByDivision: byDivision,
    matchesByDate: byDate,
    standings: count('/standings/'),
    challenges: count('/challenges/'),
    staff: docs.filter(d => d.path.startsWith('staff/')).length,
    firstKickoff: scheduled[0]?.kickoffAt ?? null,
    lastKickoff: scheduled[scheduled.length - 1]?.kickoffAt ?? null
  };
}

export { EVENT_ID, VENUES, CHALLENGES, DEMO_STAFF, ROLE_PERMISSIONS };
