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

import { FORMATS, RANKING_RULES, DIVISIONS, REGISTRATION_LIMITS } from '../../js/engine/formats.js';
// ⚠️ 賽程的產生與排定只有一份實作（R-ENG-001）。管理後台的「賽程管理」
//    走的是同一支——種子跟正式站排出來的東西不一樣的話，
//    要到比賽當天才會發現。
import {
  buildGroups, buildMatches, placeMatches, taipeiMs, slotSpanMin, SCHEDULE_DEFAULTS
} from '../../js/engine/schedule.js';
import { STAFF_CHAIN, defaultPermsOf } from '../../js/config.js';
import { rosterProjection } from '../../js/engine/privacy.js';

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

/**
 * 隊職員。代碼一律照**競賽規章第十二條**的三個職稱：
 *   leader 領隊／coach 教練／manager 管理（各 1 人）
 *
 * ⚠️ 改動前 `manager` 標的是「領隊」，而 js/config.js 的 KIND_LABEL 把
 *    manager 對到「管理」——同一筆資料在種子與畫面上叫不同的職稱，
 *    而且不會有任何錯誤。9 人制多一個隊醫（規章沒有，是現場實務）。
 */
const STAFF_ROLES_5 = [['coach', '教練'], ['leader', '領隊']];
const STAFF_ROLES_9 = [['coach', '教練'], ['leader', '領隊'], ['manager', '管理']];

// 兒童組驗齡基準（2026/1/1）
const BIRTH_YEAR = { u6: 2020, u8: 2018, u10: 2016, women: 1998, 'adult-fun': 1995, 'adult-open': 1996 };

/**
 * 學童組的生日必須**符合競賽規章第十一條的門檻**。
 *
 * 第一版是 `${birthYear}-0${1+(p%9)}-...`，對 u10 會產出 2016-01 ~ 2016-09，
 * 而門檻是 2016-09-01——種子資料裡每一個中年級球員都是超齡的。
 * 種子資料違反規章比沒有種子更糟：它會讓人以為資格檢查沒有生效。
 *
 * 這裡從門檻當天往後推，散在門檻之後的兩年內。
 */
function youthBirthDate(division, i) {
  const from = division?.eligibility?.bornOnOrAfter;
  if (!from) return null;
  const [y, m, d] = from.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + (i * 37) % 700);      // 門檻後 0–700 天
  return t.toISOString().slice(0, 10);
}

/**
 * 留在「待審核」的兩支球隊（demo 用）。
 *
 * 報名審核那一頁如果沒有東西可以審，就看不出它會不會動。
 *   ・`clean` → 完全合格，按核准會成功
 *   ・`dupJersey` → 兩位球員同號，示範「有問題就不畫核准鈕」
 *
 * ⚠️ 刻意**不**用超齡當範例：種子資料違反規章比沒有種子更糟
 *    （2026-09-03 才修過一次）。背號重複是系統限制，不是規章違規。
 */
const REVIEW_DEMO = { 臺中晨星: 'clean', 大甲金剛: 'dupJersey' };

/** 學童組公開端只顯示暱稱（R-PRIV-002），種子資料也照這個走 */
const NICKNAMES = [
  '小豆子', '阿光', '小虎', '球球', '小飛', '阿寶', '小杰', '毛毛',
  '小樹', '阿丘', '小恩', '波波', '小魚', '阿凱', '小葉', '咪咪'
];

// ─── 場地 ─────────────────────────────────────────────────────────
const VENUES = [
  { venueId: 'venue-a', name: 'A場', fullName: '太原足球場 A場', order: 1, fieldType: '9v9' },
  { venueId: 'venue-b', name: 'B場', fullName: '太原足球場 B場', order: 2, fieldType: '9v9' },
  { venueId: 'venue-c', name: 'C場', fullName: '太原足球場 C場', order: 3, fieldType: '5v5' }
];

/** 各日可用場地：10/9 三片（5 人制）、10/10 與 10/11 兩片（9 人制） */
/** 賽事日期。年齡遮蔽以**第一天**為基準：跨越活動生日的小孩，
 *  第一天還未滿 13 歲就該遮，取第一天是比較保守的那一邊（R-PRIV-001）。 */
const EVENT_DATES = ['2026-10-09', '2026-10-10', '2026-10-11'];

const VENUES_BY_DATE = {
  '2026-10-09': ['venue-a', 'venue-b', 'venue-c'],
  '2026-10-10': ['venue-a', 'venue-b'],
  '2026-10-11': ['venue-a', 'venue-b']
};

const DAY_START_HOUR = 8;
const DAY_START_MIN = 30;
const DAY_END = '18:00';
const BUFFER_MIN = 10;
/** 同一隊兩場之間的休息下限。規章沒有這一條，是我們自己給的預設值 */
const MIN_REST_MIN = 20;

// ─── Challenge 五關 ───────────────────────────────────────────────
const CHALLENGES = [
  { challengeId: 'g01-nine-grid', order: 1, icon: 'target',
    name: '九宮格射門挑戰', shortName: '九宮格', boothLocation: '攤位 1',
    description: '球門設置九宮格目標，於指定距離射門，不同位置不同分數。',
    rulesText: '每人 5 球。一般區 1 分、中難度 2 分、高難度角落 3 分，加總為總分。',
    scoreType: 'points', unit: '分', rankingRule: 'higher', decimals: 0,
    minValue: 0, maxValue: 15, inputMode: 'shots', shotCount: 5, shotOptions: [0, 1, 2, 3] },

  { challengeId: 'g02-header-king', order: 2, icon: 'ladder',
    name: 'C羅高空頭球挑戰', shortName: 'C羅頭球', boothLocation: '攤位 2',
    description: '取材自 C 羅具代表性的高空頭球，挑戰能完成多高位置的頭球。',
    rulesText: '依序挑戰各高度，完成後可挑戰下一級，紀錄成功完成的最高高度。',
    scoreType: 'height', unit: 'cm', rankingRule: 'higher', decimals: 0,
    minValue: 150, maxValue: 260, inputMode: 'ladder',
    ladderSteps: [180, 190, 200, 205, 210, 215, 220] },

  { challengeId: 'g03-crossbar', order: 3, icon: 'crossbar',
    name: 'Ronaldinho 橫樑挑戰', shortName: '橫樑', boothLocation: '攤位 3',
    description: '取材自 Ronaldinho 經典的橫樑足球技巧，從指定距離射門擊中橫樑。',
    rulesText: '固定 5 球，紀錄擊中橫樑次數。',
    scoreType: 'count', unit: '次', rankingRule: 'higher', decimals: 0,
    minValue: 0, maxValue: 5, inputMode: 'stepper', stepperMax: 5 },

  { challengeId: 'g04-speed-king', order: 4, icon: 'speed',
    name: '足球球速王', shortName: '球速王', boothLocation: '攤位 4',
    description: '使用球速雷達測量射門球速。',
    rulesText: '每人 3 球，取最高一次球速。',
    scoreType: 'speed', unit: 'km/h', rankingRule: 'higher', decimals: 0,
    minValue: 20, maxValue: 150, inputMode: 'numpad' },

  // 圖示不跟 g01 共用：五關在挑戰首頁是並排的，兩個一樣的圖示分不出來。
  // 同心圓對應這一關的計分結構（完美區／控制區／外圍）。
  { challengeId: 'g05-first-touch', order: 5, icon: 'first-touch',
    name: '停球王挑戰', shortName: '停球王', boothLocation: '攤位 5',
    description: '利用發球設備將球送向玩家，玩家必須完成第一腳停球控制。',
    rulesText: '5 次停球。完美區 3 分、控制區 2 分、外圍 1 分、失敗 0 分。',
    scoreType: 'points', unit: '分', rankingRule: 'higher', decimals: 0,
    minValue: 0, maxValue: 15, inputMode: 'shots', shotCount: 5, shotOptions: [0, 1, 2, 3] }
];

const DEFAULT_ATTEMPT_POLICY = { maxAttemptsPerPlayer: 3, allowRepeat: true, rankBy: 'best' };

// ─── 角色權限 ─────────────────────────────────────────────────────
// 2026-08-29：拿掉 venue_lead（場地主任）。覆核改由 admin 做，
// captain（球隊隊長）不在這張表裡——它是球隊層級的身分，見 docs/10 §2。
/**
 * 權限矩陣的初始值（`config/rolePermissions/{role}`）。
 *
 * ⚠️ **從 js/config.js 的 PERMISSIONS 推出來，不要在這裡手寫第二份。**
 *    手寫的那一份 2026-09-03 已經跟程式碼分岔了（裁判有覆核權、
 *    沒有 checkin 這個角色），而分岔不會有任何錯誤訊息：
 *    介面依 can() 顯示按鈕，資料庫裡那份只是被讀出來覆寫，
 *    兩邊不一樣的時候看起來只像「這個人的權限怪怪的」。
 *
 * 這裡寫的是**預設值展開後的樣子**，總管在授權介面上逐條調整之後
 * 會覆寫這幾份文件。
 */
const ROLE_PERMISSIONS = Object.fromEntries(
  STAFF_CHAIN.map(role => [role, {
    role,
    perms: Object.fromEntries(defaultPermsOf(role).map(code => [code, true])),
    note: '由 scripts/seed 依 js/config.js 的 PERMISSIONS 產生；總管可逐條調整'
  }])
);

/** Demo 環境用的工作人員（safety：seed 只在 demo 專案執行） */
/** 邀請碼：6 碼英數。種子資料用可預測的算法，正式報名由 Function 產生亂碼。 */
function inviteCodeOf(n) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉 I O 0 1，現場念得出來
  let out = '', x = n * 2654435761 % 1073741824;
  for (let i = 0; i < 6; i++) { out += A[x % A.length]; x = Math.floor(x / A.length) + n * 31; }
  return out;
}

const DEMO_STAFF = [
  // 大總管是唯一能指派身分的人（docs/10 §5.1）。第一位一定要由種子／Console 寫入，
  // 因為 rules 的角色白名單裡沒有 super_admin——介面永遠造不出第二個。
  { uid: 'demo-super',   name: '示範大總管', roles: ['super_admin'], venueIds: [],                    challengeIds: [] },
  { uid: 'U7774e1410479bafff4997f51b2c47b95', name: '小麥（大總管）', roles: ['super_admin'], venueIds: [], challengeIds: [] },
  { uid: 'demo-admin',   name: '示範管理員', roles: ['admin'],      venueIds: [],                     challengeIds: [] },
  { uid: 'demo-scorer-a',name: '示範賽務A',   roles: ['scorer'],     venueIds: ['venue-a'],            challengeIds: [] },
  { uid: 'demo-scorer-b',name: '示範賽務B',   roles: ['scorer'],     venueIds: ['venue-b'],            challengeIds: [] },
  { uid: 'demo-referee', name: '示範裁判',    roles: ['referee'],    venueIds: ['venue-a', 'venue-b'], challengeIds: [] },
  { uid: 'demo-checkin', name: '示範檢錄員',  roles: ['checkin'],    venueIds: ['venue-a'],            challengeIds: [] },
  ...CHALLENGES.map((c, i) => ({
    uid: `demo-booth-${i + 1}`, name: `示範攤位${i + 1}`, roles: ['booth'],
    venueIds: [], challengeIds: [c.challengeId]
  }))
];

/**
 * 登入過、但還**沒有**任何身分的人。
 *
 * 身分授權那一頁的主要動作是「把身分指派給還沒有身分的人」。
 * 名錄裡如果每一個人都已經是工作人員，那一頁在 demo 上就永遠示範不到
 * 這個動作——跟報名審核需要留幾支待審的球隊是同一個理由。
 */
const DEMO_UNASSIGNED = [
  { uid: 'demo-user-1', name: '待指派・王小明' },
  { uid: 'demo-user-2', name: '待指派・李美玲' }
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
      // 報名審核那一頁要有東西可以審，不然在 demo 上永遠是空的。
      // 一支完全合格（核准會成功），一支背號重複（示範「擋下來」的樣子）——
      // 背號重複是**系統限制**不是規章違規，所以種子資料仍然符合規章。
      const reviewDemo = REVIEW_DEMO[name] ?? null;
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
        // ── M4 報名欄位（docs/10 §2.1）──────────────────────
        // 種子的球隊多數當作「已經報名並通過審核」：status=approved、名單已鎖。
        // ⚠️ 但**留兩支在待審核**（見 REVIEW_DEMO）——不然報名審核那一頁
        //    在 demo 上永遠是空的，看不出它會不會動。
        // captainUid 給一個可預測的 demo uid，方便在 demo 站試隊長端。
        captainUid: `demo-cap-${teamSeq}`,
        captainName: `${name}隊長`,
        contact: { phone: null, email: null, lineDisplayName: null },
        status: reviewDemo ? 'submitted' : 'approved',
        submittedAt: null, reviewedAt: null,
        reviewedBy: reviewDemo ? null : 'demo-admin', rejectReason: null,
        inviteCode: inviteCodeOf(teamSeq),
        announcement: { text: null, updatedAt: null, updatedBy: null },
        rosterLocked: !reviewDemo,
        // docs/10 §2.1：已核准人數，一個數字（由 Function 維護）。
        // docs/01b 早期寫成 { player, staff } 物件，但公開端拿它直接印
        // 「N 人」，物件會變成「[object Object] 人」。以 docs/10 為準。
        memberCount: playerCount + staffRoles.length,
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
        // dupJersey 那一支故意讓第 2 位跟第 1 位同號，示範審核擋下來的樣子
        const jerseyNo = (reviewDemo === 'dupJersey' && p === 1) ? 1 : p + 1;
        const pos = positions[p % positions.length];
        const birthYear = BIRTH_YEAR[div.divisionId] - (isYouth ? 0 : (p % 12));
        // 學童組：教練直接建名單，只填暱稱＋後四碼＋生日，不收真名（R-PRIV-002）
        const youthBirth = youthBirthDate(div, teamSeq * 7 + p);
        members.push({
          _teamId: teamId,
          memberId, teamId, eventId: EVENT_ID, divisionId: div.divisionId,
          role: 'player', kind: 'player',
          name: isYouth ? NICKNAMES[(teamSeq * 5 + p) % NICKNAMES.length] : `${pick(rng, SURNAMES)}${given}`,
          nameKind: isYouth ? 'nickname' : 'legal',
          status: 'approved',
          source: isYouth ? 'coach' : 'guardian',
          jerseyNo, position: pos,
          isCaptain: p === 6 % playerCount,
          isGoalkeeper: pos === 'GK',
          photoUrl: null,
          birthYear,
          birthDate: isYouth ? youthBirth : `${birthYear}-0${1 + (p % 9)}-1${p % 9}`,
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
          role, kind: role,
          // 名字用真的人名，職稱由畫面上的 KIND_LABEL 顯示。
          // 叫「李總教練」再配一個「教練」的標籤會變成「李總教練教練」。
          name: `${pick(rng, SURNAMES)}${pick(rng, GIVEN)}`,
          nameKind: 'legal',
          status: 'approved',
          source: isYouth ? 'coach' : 'guardian',
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

/**
 * 依 Format 產生某組別的所有 stage / group / match（尚未排時間）。
 *
 * ⚠️ 實作在 `js/engine/schedule.js`，跟管理後台的「賽程管理」是同一支
 *    （R-ENG-001）。差別只在分組順序的來源：種子用球隊身上的 `seed`
 *    （可重現），管理後台用抽籤的結果（規章第十四條）。
 */
function buildDivisionSchedule(div, divTeams) {
  const format = FORMATS[div.formatId];
  if (!format) throw new Error(`找不到 formatId=${div.formatId}`);
  const rr = format.stages.find(s => s.type === 'roundRobin');
  const ordered = [...divTeams].sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));
  return buildMatches({ division: div, format, groups: buildGroups(ordered, rr?.groupCount ?? 1) });
}

/**
 * 把某一天的所有場次排進時段與場地。
 *
 * 同一天可能有好幾個組別（10/9 就有四個），所以**一次排整天**而不是
 * 一個組別排完再排下一個：後者會讓第一個組別吃掉全部的早上時段，
 * 最後一個組別排到傍晚。
 */
function scheduleDay(date, dayMatches, divisionsById) {
  const venues = VENUES_BY_DATE[date].map(id => VENUES.find(v => v.venueId === id));
  const pad = n => String(n).padStart(2, '0');
  const dayStartMs = taipeiMs(date, `${pad(DAY_START_HOUR)}:${pad(DAY_START_MIN)}`);
  const dayEndMs = taipeiMs(date, DAY_END);

  // 時段長度取當日最長的一種，避免不同組別的場地時間互相錯開
  const divs = [...new Set(dayMatches.map(m => m.divisionId))].map(id => divisionsById[id]);
  const slotMin = Math.max(...divs.map(d => slotSpanMin(d.matchDurationMin, BUFFER_MIN)));

  const { placed, unplaced } = placeMatches({
    matches: dayMatches, venues, dayStartMs, dayEndMs, slotMin,
    bufferMin: BUFFER_MIN, divisions: divs, minRestMin: MIN_REST_MIN
  });
  if (unplaced.length) {
    throw new Error(`排程失敗：${date} 有 ${unplaced.length} 場排不下。${unplaced[0].reason}`);
  }
  return placed.map(m => ({ ...m, kickoffAt: new Date(m.kickoffMs) }));
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
  // 排程設定（開賽時間、緩衝、休息下限、各日可用場地）。
  // ⚠️ 這些**規章都沒有規定**，是營運決定，所以放在後台改得到的地方。
  //    比賽時間與用球在 formats.js（規章第十七、十八條），不在這裡。
  add('config/schedule', {
    ...SCHEDULE_DEFAULTS,
    startTime: `${String(DAY_START_HOUR).padStart(2, '0')}:${String(DAY_START_MIN).padStart(2, '0')}`,
    endTime: DAY_END,
    bufferMin: BUFFER_MIN,
    minRestMin: MIN_REST_MIN,
    venuesByDate: VENUES_BY_DATE,
    seedData: true
  });
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
  // LIFF（LINE 登入）。Function 用 channelId 向 LINE 驗證 idToken——
  // 「這個 token 是不是發給我們的」就靠它。讀不到就整個拒絕登入（fail-closed）。
  // ⚠️ 這是 demo 專案的 Channel。正式專案由 scripts/seed.js 的安全鎖擋住不會被灌到，
  //    正式站的 config/liff 由管理後台或 Console 建立。
  add('config/liff', {
    liffId: '2011382448-5wfKxpsM',
    channelId: '2011382448',
    note: 'Demo 站的 LINE Login Channel。與正式站建在同一個 LINE Provider 底下。'
  });

  // 報名開關（docs/10 §2.3）。開放條件是 AND：open 為真**且**在起訖區間內。
  // ⚠️ closesAt 尚未定案（docs/10 §9 待補 #1），先留 null＝不設截止。
  //    firestore.rules 讀不到這份文件時一律視為關閉（fail-closed），
  //    所以少了它報名不會意外開著，只會打不開。
  // 上限照競賽規章第十二條。日期由 scripts/set-registration.mjs 設定
  // （closesAt 必須是 Timestamp，在 Console 用字串填會讓報名安靜地打不開）。
  add('config/registration', {
    open: false,
    opensAt: null,
    closesAt: null,
    maxTeamsPerAccount: 3,
    minMembers: null,
    maxMembers: REGISTRATION_LIMITS.maxPlayers,
    maxStaff: REGISTRATION_LIMITS.maxStaff,
    onePlayerOneTeam: REGISTRATION_LIMITS.onePlayerOneTeam,
    fee: REGISTRATION_LIMITS.fee,
    note: '人數與費用照競賽規章第十二條。報名日期用 scripts/set-registration.mjs 設定。'
  });

  for (const [role, v] of Object.entries(ROLE_PERMISSIONS)) add(`rolePermissions/${role}`, v);

  // 使用者名錄（docs/10 §1.4）：LINE 的 userId 沒辦法憑空查，
  // 大總管要有一份名單才指派得了身分。正式站由每個人登入時自己寫一筆。
  for (const s of DEMO_STAFF) {
    add(`users/${s.uid}`, {
      uid: s.uid, displayName: s.name, pictureUrl: null,
      firstSeenAt: null, lastSeenAt: null,
      roles: s.roles,          // 快取，權威在 staff/{uid}.roles
      seedData: true
    });
  }
  // 只在名錄裡、沒有 staff 文件——身分授權那一頁要有人可以指派
  for (const u of DEMO_UNASSIGNED) {
    add(`users/${u.uid}`, {
      uid: u.uid, displayName: u.name, pictureUrl: null,
      firstSeenAt: null, lastSeenAt: null,
      seedData: true
    });
  }


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
    dates: EVENT_DATES,
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
  // 隊長也要進名錄。
  //
  // ⚠️ 這一段不是為了好看：`onTeamWritten` 會把 teamCount 寫進
  //    `users/{captainUid}`，所以**這些文件本來就會存在**，只是沒有名字。
  //    身分授權那一頁列的就是這個集合——沒有這一段，demo 上會出現
  //    三十幾列只有一串 uid 的空白項目。正式站不會有這個問題
  //    （每個人都是自己登入時由 lineLogin 寫進去的）。
  for (const t of teams) {
    add(`users/${t.captainUid}`, {
      uid: t.captainUid, displayName: t.captainName, pictureUrl: null,
      firstSeenAt: null, lastSeenAt: null,
      seedData: true
    });
  }

  // ── 賽程 ──
  const allMatches = [];
  const divisionsById = Object.fromEntries(DIVISIONS.map(d => [d.divisionId, d]));
  for (const div of DIVISIONS) {
    const divTeams = teams.filter(t => t.divisionId === div.divisionId);
    const { stages, groups, matches, groupAssign } = buildDivisionSchedule(div, divTeams);

    // ⚠️ 這裡是**逐欄搬**，不是 `{...div}`。逐欄搬的代價是「新增欄位要記得加」，
    //    而 2026-09-03 就漏了三個（periods / ballSize / eligibility）——
    //    前端讀不到 eligibility，整個學童組會退回成人流程，而且不會報錯。
    //    所以下面補了一條自檢：formats.js 有、這裡沒有的欄位一律丟錯。
    add(`${E}/divisions/${div.divisionId}`, {
      divisionId: div.divisionId, name: div.name, shortName: div.shortName,
      officialName: div.officialName,
      date: div.date, teamCount: div.teamCount, playersOnField: div.playersOnField,
      matchDurationMin: div.matchDurationMin,
      periods: div.periods, ballSize: div.ballSize,
      eligibility: div.eligibility,
      formatId: div.formatId, rankingRuleId: div.rankingRuleId,
      colorToken: div.colorToken, order: div.order, code: div.code,
      display: div.display,
      status: 'scheduled', finalRankingPublished: false, finalRanking: null,
      // 種子資料是「已經發布的賽程」，不然 demo 的公開端會是空的。
      // ⚠️ 公開端把「沒有這個欄位」當成已發布（既有資料沒有它），
      //    只有明確的 false 才隱藏——反過來寫的話，這一版一上線，
      //    demo 上原本看得到的賽程會整個消失。
      schedulePublished: true,
      seedData: true
    });

    // 自檢：formats.js 的每一個欄位都要被搬過去
    const written = docs[docs.length - 1].data;
    const missing = Object.keys(div).filter(k => !(k in written));
    if (missing.length) {
      throw new Error(
        `種子漏搬了組別欄位：${missing.join('、')}（${div.divisionId}）。` +
        '請在 scripts/seed/build.js 的 divisions 區塊補上——' +
        '前端讀不到的欄位不會報錯，只會安靜地不生效。'
      );
    }

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

    matches.forEach(m => allMatches.push({ ...m, _date: div.date }));
  }

  // 逐日排程
  const scheduled = [];
  for (const date of Object.keys(VENUES_BY_DATE)) {
    const dayMatches = allMatches.filter(m => m._date === date);
    scheduled.push(...scheduleDay(date, dayMatches, divisionsById));
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
    // 公開投影用引擎那一份（js/engine/privacy.js）——Cloud Function 的
    // onMemberWritten 產的是同一個函式的輸出，種子資料才不會跟線上長得不一樣。
    // 遮蔽依據是**年齡**（未滿 13 歲），不是組別。
    add(`${E}/teams/${_teamId}/roster/${m.memberId}`,
      rosterProjection(m, { teamId: m.teamId, divisionId: m.divisionId, asOf: EVENT_DATES[0] }));
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
