/**
 * 賽制範本與排名規則｜Formats & RankingRules
 * ------------------------------------------------------------------
 * 規格：docs/02-賽制引擎與排名規則.md §2、§3、§6
 *
 * 這份是「種子資料的來源」，執行時的權威來源是 Firestore 的
 * config/formats 與 config/rankingRules —— 主辦可在後台改，不需要改程式。
 * scripts/seed.js 會把這裡的內容寫進 Firestore。
 *
 * 純資料、零依賴，前端與 Cloud Functions 都可直接引用。
 */

// ══════════════════════════════════════════════════════════════════
//  Formats
// ══════════════════════════════════════════════════════════════════

/** 8 隊：兩組循環 ＋ 交叉排名（1–8 名全排）。每隊 5 場，共 20 場。 */
const F8_GROUP_CROSS = {
  formatId: 'F8_GROUP_CROSS',
  name: '8隊 兩組循環＋交叉排名（1–8名全排）',
  teamCount: 8,
  description: '每隊固定 5 場，單組別共 20 場',
  stages: [
    {
      stageId: 'group', name: '分組循環', type: 'roundRobin', order: 1,
      groupCount: 2, groupSize: 4, legs: 1, seedingMethod: 'snake'
    },
    {
      stageId: 'placement', name: '交叉賽', type: 'knockout', order: 2,
      drawRule: 'penalty',
      slots: [
        { matchKey: 'SF1', label: '準決賽①', round: 1,
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 1 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 2 } },
        { matchKey: 'SF2', label: '準決賽②', round: 1,
          home: { type: 'standing', stageId: 'group', groupId: 'B', rank: 1 },
          away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 2 } },
        { matchKey: 'PF1', label: '5-8名賽①', round: 1,
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 3 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 4 } },
        { matchKey: 'PF2', label: '5-8名賽②', round: 1,
          home: { type: 'standing', stageId: 'group', groupId: 'B', rank: 3 },
          away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 4 } }
      ]
    },
    {
      stageId: 'final', name: '名次決賽', type: 'knockout', order: 3,
      drawRule: 'penalty',
      slots: [
        { matchKey: 'F1', label: '冠軍賽',
          home: { type: 'matchWinner', matchKey: 'SF1' },
          away: { type: 'matchWinner', matchKey: 'SF2' } },
        { matchKey: 'F3', label: '季軍賽',
          home: { type: 'matchLoser', matchKey: 'SF1' },
          away: { type: 'matchLoser', matchKey: 'SF2' } },
        { matchKey: 'F5', label: '五六名賽',
          home: { type: 'matchWinner', matchKey: 'PF1' },
          away: { type: 'matchWinner', matchKey: 'PF2' } },
        { matchKey: 'F7', label: '七八名賽',
          home: { type: 'matchLoser', matchKey: 'PF1' },
          away: { type: 'matchLoser', matchKey: 'PF2' } }
      ]
    }
  ],
  finalRankingMap: [
    { rank: 1, from: { type: 'matchWinner', matchKey: 'F1' } },
    { rank: 2, from: { type: 'matchLoser',  matchKey: 'F1' } },
    { rank: 3, from: { type: 'matchWinner', matchKey: 'F3' } },
    { rank: 4, from: { type: 'matchLoser',  matchKey: 'F3' } },
    { rank: 5, from: { type: 'matchWinner', matchKey: 'F5' } },
    { rank: 6, from: { type: 'matchLoser',  matchKey: 'F5' } },
    { rank: 7, from: { type: 'matchWinner', matchKey: 'F7' } },
    { rank: 8, from: { type: 'matchLoser',  matchKey: 'F7' } }
  ]
};

/** 6 隊：兩組循環 ＋ 同名次對決。每隊 3 場，共 9 場。U6/U8/U10 建議採用。 */
const F6_TWO_GROUPS_MIRROR = {
  formatId: 'F6_TWO_GROUPS_MIRROR',
  name: '6隊 兩組循環＋同名次對決',
  teamCount: 6,
  description: '每隊固定 3 場，單組別共 9 場。適合單日多組別並行',
  stages: [
    {
      stageId: 'group', name: '分組循環', type: 'roundRobin', order: 1,
      groupCount: 2, groupSize: 3, legs: 1, seedingMethod: 'snake'
    },
    {
      stageId: 'final', name: '名次對決', type: 'knockout', order: 2,
      drawRule: 'penalty',
      slots: [
        { matchKey: 'F1', label: '冠軍賽',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 1 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 1 } },
        { matchKey: 'F3', label: '季軍賽',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 2 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 2 } },
        { matchKey: 'F5', label: '五六名賽',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 3 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 3 } }
      ]
    }
  ],
  finalRankingMap: [
    { rank: 1, from: { type: 'matchWinner', matchKey: 'F1' } },
    { rank: 2, from: { type: 'matchLoser',  matchKey: 'F1' } },
    { rank: 3, from: { type: 'matchWinner', matchKey: 'F3' } },
    { rank: 4, from: { type: 'matchLoser',  matchKey: 'F3' } },
    { rank: 5, from: { type: 'matchWinner', matchKey: 'F5' } },
    { rank: 6, from: { type: 'matchLoser',  matchKey: 'F5' } }
  ]
};

/** 6 隊：兩組循環 ＋ 交叉準決賽。共 11 場（場次不齊一，見 description）。 */
const F6_TWO_GROUPS_CROSS = {
  formatId: 'F6_TWO_GROUPS_CROSS',
  name: '6隊 兩組循環＋交叉準決賽',
  teamCount: 6,
  description: '單組別共 11 場。晉級 4 隊每隊 4 場、分組第 3 名 2 隊每隊 3 場（場次不齊一）',
  stages: [
    {
      stageId: 'group', name: '分組循環', type: 'roundRobin', order: 1,
      groupCount: 2, groupSize: 3, legs: 1, seedingMethod: 'snake'
    },
    {
      stageId: 'placement', name: '準決賽', type: 'knockout', order: 2,
      drawRule: 'penalty',
      slots: [
        { matchKey: 'SF1', label: '準決賽①',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 1 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 2 } },
        { matchKey: 'SF2', label: '準決賽②',
          home: { type: 'standing', stageId: 'group', groupId: 'B', rank: 1 },
          away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 2 } }
      ]
    },
    {
      stageId: 'final', name: '名次決賽', type: 'knockout', order: 3,
      drawRule: 'penalty',
      slots: [
        { matchKey: 'F1', label: '冠軍賽',
          home: { type: 'matchWinner', matchKey: 'SF1' },
          away: { type: 'matchWinner', matchKey: 'SF2' } },
        { matchKey: 'F3', label: '季軍賽',
          home: { type: 'matchLoser', matchKey: 'SF1' },
          away: { type: 'matchLoser', matchKey: 'SF2' } },
        { matchKey: 'F5', label: '五六名賽',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 3 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 3 } }
      ]
    }
  ],
  finalRankingMap: [
    { rank: 1, from: { type: 'matchWinner', matchKey: 'F1' } },
    { rank: 2, from: { type: 'matchLoser',  matchKey: 'F1' } },
    { rank: 3, from: { type: 'matchWinner', matchKey: 'F3' } },
    { rank: 4, from: { type: 'matchLoser',  matchKey: 'F3' } },
    { rank: 5, from: { type: 'matchWinner', matchKey: 'F5' } },
    { rank: 6, from: { type: 'matchLoser',  matchKey: 'F5' } }
  ]
};

/** 4 隊：單循環 ＋ 冠軍賽與季軍賽。每隊 4 場，共 8 場。 */
const F4_RR_FINAL = {
  formatId: 'F4_RR_FINAL',
  name: '4隊單循環＋冠軍季軍賽',
  teamCount: 4,
  description: '每隊 4 場，單組別共 8 場',
  stages: [
    {
      stageId: 'group', name: '單循環', type: 'roundRobin', order: 1,
      groupCount: 1, groupSize: 4, legs: 1, seedingMethod: 'snake'
    },
    {
      stageId: 'final', name: '名次決賽', type: 'knockout', order: 2,
      drawRule: 'penalty',
      slots: [
        { matchKey: 'F1', label: '冠軍賽',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 1 },
          away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 2 } },
        { matchKey: 'F3', label: '季軍賽',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 3 },
          away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 4 } }
      ]
    }
  ],
  finalRankingMap: [
    { rank: 1, from: { type: 'matchWinner', matchKey: 'F1' } },
    { rank: 2, from: { type: 'matchLoser',  matchKey: 'F1' } },
    { rank: 3, from: { type: 'matchWinner', matchKey: 'F3' } },
    { rank: 4, from: { type: 'matchLoser',  matchKey: 'F3' } }
  ]
};

const FORMATS = {
  F8_GROUP_CROSS,
  F6_TWO_GROUPS_MIRROR,
  F6_TWO_GROUPS_CROSS,
  F4_RR_FINAL
};

// ══════════════════════════════════════════════════════════════════
//  RankingRules
// ══════════════════════════════════════════════════════════════════

/** FIFA 標準行為分罰分（分數越接近 0 越好） */
const FAIR_PLAY = { yellow: -1, secondYellow: -3, directRed: -4, yellowThenRed: -5 };

/** 飛達盃預設：對戰關係優先，最後落到主辦裁定 */
const RR_FEDA_DEFAULT = {
  rankingRuleId: 'RR_FEDA_DEFAULT',
  name: '飛達盃預設（對戰關係優先）',
  points: { win: 3, draw: 1, loss: 0 },
  criteria: [
    'points',
    'headToHeadPoints',
    'headToHeadGoalDiff',
    'headToHeadGoalsFor',
    'goalDiff',
    'goalsFor',
    'goalsAgainstAsc',
    'fairPlay',
    'manual'
  ],
  fairPlay: FAIR_PLAY
};

/** 兒童組：拿掉行為分，較早落到主辦裁定，避免用得失球差鼓勵大比分 */
const RR_FEDA_YOUTH = {
  rankingRuleId: 'RR_FEDA_YOUTH',
  name: '飛達盃兒童組',
  points: { win: 3, draw: 1, loss: 0 },
  criteria: [
    'points',
    'headToHeadPoints',
    'headToHeadGoalDiff',
    'goalDiff',
    'goalsFor',
    'manual'
  ],
  fairPlay: FAIR_PLAY
};

/** 國際對照版（FIFA 2026 世界盃小組同分判定順序），備用 */
const RR_FIFA_2026 = {
  rankingRuleId: 'RR_FIFA_2026',
  name: 'FIFA 2026 標準',
  points: { win: 3, draw: 1, loss: 0 },
  criteria: [
    'points',
    'headToHeadPoints', 'headToHeadGoalDiff', 'headToHeadGoalsFor',
    'goalDiff', 'goalsFor',
    'fairPlay', 'drawLots'
  ],
  fairPlay: FAIR_PLAY
};

const RANKING_RULES = { RR_FEDA_DEFAULT, RR_FEDA_YOUTH, RR_FIFA_2026 };

// ══════════════════════════════════════════════════════════════════
//  本次活動的組別設定（seed 用）
// ══════════════════════════════════════════════════════════════════

const DIVISIONS = [
  { divisionId: 'u6',         name: 'U6',        shortName: 'U6',   date: '2026-10-09',
    teamCount: 6, playersOnField: 5, matchDurationMin: 20,
    formatId: 'F6_TWO_GROUPS_MIRROR', rankingRuleId: 'RR_FEDA_YOUTH',
    colorToken: 'div-u6',    order: 1, code: 'U6',
    display: { mercyRule: { enabled: true, cap: 7 }, scorerBoard: false } },

  { divisionId: 'u8',         name: 'U8',        shortName: 'U8',   date: '2026-10-09',
    teamCount: 6, playersOnField: 5, matchDurationMin: 20,
    formatId: 'F6_TWO_GROUPS_MIRROR', rankingRuleId: 'RR_FEDA_YOUTH',
    colorToken: 'div-u8',    order: 2, code: 'U8',
    display: { mercyRule: { enabled: true, cap: 7 }, scorerBoard: false } },

  { divisionId: 'u10',        name: 'U10',       shortName: 'U10',  date: '2026-10-09',
    teamCount: 6, playersOnField: 5, matchDurationMin: 20,
    formatId: 'F6_TWO_GROUPS_MIRROR', rankingRuleId: 'RR_FEDA_YOUTH',
    colorToken: 'div-u10',   order: 3, code: 'U10',
    display: { mercyRule: { enabled: true, cap: 7 }, scorerBoard: false } },

  { divisionId: 'women',      name: '女子組',     shortName: '女子',  date: '2026-10-09',
    teamCount: 4, playersOnField: 5, matchDurationMin: 20,
    formatId: 'F4_RR_FINAL', rankingRuleId: 'RR_FEDA_DEFAULT',
    colorToken: 'div-women', order: 4, code: 'WM',
    display: { mercyRule: { enabled: false, cap: 7 }, scorerBoard: true } },

  { divisionId: 'adult-fun',  name: '成人興趣組',  shortName: '興趣',  date: '2026-10-10',
    teamCount: 8, playersOnField: 9, matchDurationMin: 30,
    formatId: 'F8_GROUP_CROSS', rankingRuleId: 'RR_FEDA_DEFAULT',
    colorToken: 'div-fun',   order: 5, code: 'AF',
    display: { mercyRule: { enabled: false, cap: 7 }, scorerBoard: true } },

  { divisionId: 'adult-open', name: '成人公開組',  shortName: '公開',  date: '2026-10-11',
    teamCount: 8, playersOnField: 9, matchDurationMin: 30,
    formatId: 'F8_GROUP_CROSS', rankingRuleId: 'RR_FEDA_DEFAULT',
    colorToken: 'div-open',  order: 6, code: 'AO',
    display: { mercyRule: { enabled: false, cap: 7 }, scorerBoard: true } }
];

/** 階段代碼（用於 matchId：{組別碼}-{階段碼}-{小組}-{序}） */
const STAGE_CODE = { group: 'G', placement: 'P', final: 'F' };

export { FORMATS, RANKING_RULES, DIVISIONS, FAIR_PLAY, STAGE_CODE };

// CommonJS 相容（供 functions/ 以 require 使用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FORMATS, RANKING_RULES, DIVISIONS, FAIR_PLAY, STAGE_CODE };
}
