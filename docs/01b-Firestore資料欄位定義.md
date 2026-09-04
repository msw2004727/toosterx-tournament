# 01b｜Firestore 資料欄位定義

> 承接 `01-架構與資料模型.md` §2 的集合總覽。本文件逐一定義每個集合的欄位。
> 標註 ⚠️ 的欄位屬個資，存取限制見 `07-權限安全與CloudFunctions.md` §5。

---

## 1. 欄位定義

### 1.1 `events/{eventId}`

```js
{
  eventId: 'feda-cup-2026',            // = document id
  name: 'FEDA CUP 2026｜飛達盃',
  officialName: '2026臺中市足球教育發展協會理事長盃足球賽',
  subtitle: '臺中足球社群賽',
  seriesTag: 'Community Taichung Series',
  slogan: '從社群走向賽場',
  organizer: '臺中市足球教育發展協會',
  sponsors: [
    { name: '台灣美津濃股份有限公司', tier: 'partner',
      logoUrl: '...', linkUrl: '...' }
  ],
  dates: ['2026-10-09', '2026-10-10', '2026-10-11'],
  venueName: '太原足球場',
  timezone: 'Asia/Taipei',
  status: 'published',                 // draft | published | live | finished | archived
  // 現場控制開關
  flags: {
    publicScoreVisible: true,
    liveStreamEnabled: true,
    checkinEnabled: true,
    challengeEnabled: true,
    registrationOpen: false
  },
  challengeQrToken: 'FEDA26',          // 現場活動 QR 用的短碼
  createdAt, updatedAt, updatedBy
}
```

### 1.2 `divisions/{divisionId}`

```js
{
  divisionId: 'adult-open',            // u6 | u8 | u10 | women | adult-fun | adult-open
  name: '成人公開組',
  shortName: '公開',
  date: '2026-10-11',
  teamCount: 8,
  playersOnField: 9,                   // 5 或 9
  matchDurationMin: 30,
  formatId: 'F8_GROUP_CROSS',          // 指向 config/formats
  rankingRuleId: 'RR_FEDA_DEFAULT',    // 指向 config/rankingRules
  colorToken: 'div-open',              // UI 配色語彙
  order: 6,                            // 顯示排序
  status: 'scheduled',                 // scheduled | live | finished
  finalRankingPublished: false,

  // ── 賽程管理（M4-c）────────────────────────────────────────
  // 賽程發布之前，公開端不顯示這一組的場次。
  // ⚠️ 只有明確的 false 才隱藏——這個欄位是後來才加的，
  //    既有的組別文件沒有它，當成「未發布」會讓原有賽程整個消失。
  // ⚠️ 這不是安全邊界：matches 的讀取規則是 allow read: if true。
  schedulePublished: true,

  // 分組怎麼來的（規章第十四條：統一由大會代為抽籤排定）。
  // seed 是重放的依據：同一個種子一定得到同一組分組。
  // 手動指定分組時 method='manual'、seed=null。
  draw: { seed: 20260904123, at: Timestamp, method: 'random' },  // random | manual

  createdAt, updatedAt
}
```

### 1.3 `divisions/{divisionId}/stages/{stageId}`

```js
{
  stageId: 'group',                    // group | placement | final
  name: '分組循環',
  type: 'roundRobin',                  // roundRobin | knockout | placement
  order: 1,
  groupCount: 2,                       // roundRobin 時的小組數
  legs: 1,                             // 單循環=1、雙循環=2
  // knockout / placement 專用
  bracketSlots: [ /* Slot 型別見 02-賽制引擎 §2.1 */ ],
  status: 'finished',                  // pending | live | finished
  // 只有前一階段 finished 後才可解算晉級
  advancementResolved: false,
  createdAt, updatedAt
}
```

### 1.4 `divisions/{d}/stages/{s}/groups/{groupId}`

```js
{
  groupId: 'A',
  name: 'A組',
  teamIds: ['t-101','t-102','t-103','t-104'],
  order: 1
}
```

### 1.5 `teams/{teamId}`

```js
{
  teamId: 't-101',
  eventId: 'feda-cup-2026',
  divisionId: 'adult-open',
  name: '臺中野狼足球隊',
  shortName: '野狼',
  abbr: 'WLF',                         // 記分板用 3 碼
  logoUrl: 'gs://.../teams/t-101.png',
  colors: { primary: '#1B2A4A', secondary: '#F5A623' },
  kit: { home: '深藍', away: '白' },
  contact: {                           // 僅 admin 可讀
    managerName: '呂維哲',
    phone: '0985-679-923',
    email: 'tfeda2024@gmail.com',
    lineUserId: 'U....'
  },
  intro: '成立於 2019 年，以社區成人休閒足球為主……',   // 球隊簡介（公開）
  founded: 2019,
  homeRegion: '臺中市',
  // 名單控制
  rosterLocked: true,
  rosterLockedAt: Timestamp,
  memberCount: { player: 14, staff: 3 },
  // 賽事狀態
  seed: 3,                             // 種子序（可空）
  groupId: 'A',                        // 分組賽所屬小組
  withdrawn: false,
  finalRank: null,                     // 完賽後由系統寫入
  createdAt, updatedAt, updatedBy
}
```

### 1.6 `teams/{teamId}/members/{memberId}`

```js
{
  memberId: 'm-101-07',
  teamId: 't-101',
  eventId: 'feda-cup-2026',
  divisionId: 'adult-open',

  role: 'player',                      // player | coach | manager | staff | medic
  name: '王小明',
  displayName: '王小明',               // 公開顯示名（可用暱稱）
  jerseyNo: 7,                         // 職員為 null
  position: 'MF',                      // GK | DF | MF | FW | null
  isCaptain: true,
  isGoalkeeper: false,

  photoUrl: 'gs://.../members/m-101-07.jpg',
  birthYear: 1996,                     // 兒童組驗齡用（僅存年份即可判 U6/U8/U10）
  birthDate: '1996-03-14',             // 兒童組必填；成人組可空
  idLast4: '1234',                     // ⚠️ 僅後四碼，且僅 admin/賽務可讀
  guardianConsent: true,               // 未成年肖像權與參賽同意
  guardianName: '王大明',              // 未成年必填

  // 檢錄
  qrCode: 'FEDA1.feda-cup-2026.t-101.m-101-07.1760227200.9f3c1a8e',
  qrIssuedAt: Timestamp,
  qrRevoked: false,

  // 賽事統計（由 Function 累加，非權威來源，權威是 timeline）
  stats: { apps: 3, goals: 2, assists: 1, yellow: 1, red: 0, minutes: 90 },

  eligibility: {                        // 參賽資格檢核結果
    status: 'ok',                       // ok | pending | rejected
    checkedBy: 'uid...',
    checkedAt: Timestamp,
    note: ''
  },

  createdAt, updatedAt, updatedBy
}
```

> **個資原則**：`idLast4`、`birthDate`、`guardianName`、`contact` 皆不在公開讀取範圍。公開端只讀 `displayName / jerseyNo / position / photoUrl / stats`。實作上以 rules 的欄位白名單 + 前端只查 `publicView` 投影（見 `01` §5.2 與下方 §1.6.1）。

#### 1.6.1 `teams/{teamId}/roster/{memberId}`（公開投影・唯一權威欄位清單）

由 `onMemberWritten` Function 同步產生，公開端只讀這一份。**除下列欄位外，一律不得出現在此文件中。**

```js
{
  memberId, teamId, divisionId,
  displayName: '王小明',       // 未滿 13 歲時為遮蔽後的顯示名（王小＊）
  jerseyNo: 7,
  position: 'MF',
  role: 'player',              // player | coach | manager | staff | medic
  isCaptain: true,
  isGoalkeeper: false,
  photoUrl: null,              // 未取得公開同意時為 null
  stats: { apps: 3, goals: 2, assists: 1, yellow: 1, red: 0 },
  order: 7                     // 顯示排序（球員依背號、職員依角色）
}
```

### 1.7 `matches/{matchId}`

```js
{
  matchId: 'AO-G-A-01',                // 可讀 ID：組別-階段-小組-序號
  eventId: 'feda-cup-2026',
  divisionId: 'adult-open',
  stageId: 'group',
  groupId: 'A',
  round: 1,                            // 第幾輪
  matchNo: 31,                         // 全賽事流水號（現場廣播用）
  label: 'A組 第1輪',

  date: '2026-10-11',
  kickoffAt: Timestamp,                // 排定開賽時間
  venueId: 'venue-a',
  venueName: 'A場',

  home: {
    teamId: 't-101', name: '臺中野狼', abbr: 'WLF',
    logoUrl: '...', colorPrimary: '#1B2A4A',
    placeholder: null                  // 未定隊伍時用（見 §1.7.1）
  },
  away: { /* 同上 */ },

  score:      { home: 2, away: 1 },
  htScore:    { home: 1, away: 0 },    // 半場
  penaltyScore: { home: null, away: null },  // PK 大戰

  status: 'finished',
  // scheduled | checkin | ready | live | halftime | finished | confirmed
  // | postponed | cancelled | walkover

  period: 'ft',                        // pre | h1 | ht | h2 | et1 | et2 | pk | ft
  clock: {
    running: false,
    periodStartedAt: Timestamp,        // 該期別開始的伺服器時間
    elapsedSecAtPause: 1800,           // 暫停當下已過秒數
    addedTimeSec: 0
  },

  result: {
    winner: 'home',                    // home | away | draw | null
    method: 'regulation',              // regulation | penalty | walkover | forfeit
    homePoints: 3, awayPoints: 0
  },
  walkoverSide: null,                  // 'home' | 'away'：哪一方棄賽（status='walkover' 時必填）
  walkoverReason: null,

  officials: {
    referee:   { uid: '...', name: '林裁判' },
    assistants: [{ name: '...' }],
    scorer:    { uid: '...', name: '陳賽務' }
  },

  stream: {
    enabled: true,
    provider: 'youtube',
    videoId: 'dQw4w9WgXcQ',            // 或 channelId 做 live_stream
    startOffsetSec: 0,
    status: 'live'                     // upcoming | live | ended | off
  },

  checkin: {
    homeConfirmed: true, awayConfirmed: true,
    confirmedAt: Timestamp
  },

  lock: {
    locked: true,                      // 完賽後鎖定，避免重複送出
    lockedAt: Timestamp, lockedBy: 'uid...'
  },

  // 稽核輔助
  scoreSubmittedAt: Timestamp,
  scoreSubmittedBy: 'uid...',
  revisionCount: 0,

  createdAt, updatedAt, updatedBy
}
```

#### 1.7.1 未定隊伍的佔位（placeholder）

排名階段的賽程要在分組賽結束前就先產生（讓觀眾看得到「準決賽 A1 vs B2」）。未定隊伍以 placeholder 表示：

```js
home: {
  teamId: null,
  placeholder: { type: 'standing', stageId: 'group', groupId: 'A', rank: 1 },
  displayName: 'A組第1名'
}
// 或
home: {
  teamId: null,
  placeholder: { type: 'matchWinner', matchId: 'AO-P-SF1' },
  displayName: '準決賽①勝隊'
}
```

`resolveAdvancement` Function 在前置條件滿足時把 `teamId` 與顯示資料填入。

### 1.8 `matches/{matchId}/timeline/{timelineId}`

比賽事件流。參考 Opta 事件模型簡化，只保留基層賽事實際用得到的型別。

```js
{
  timelineId: 'auto',
  matchId: 'AO-G-A-01',
  seq: 12,                             // 遞增序號，同分鐘排序用
  type: 'goal',
  minute: 23,                          // 顯示用（第 23 分鐘）
  periodId: 'h1',
  clockSec: 1380,                      // 該場累計秒數，權威
  side: 'home',                        // home | away | neutral
  teamId: 't-101',

  // 依 type 使用的欄位
  playerId: 'm-101-07',                // 進球者／持卡者／被換下
  playerName: '王小明',
  jerseyNo: 7,
  assistPlayerId: 'm-101-11',          // goal
  subInPlayerId: 'm-101-15',           // substitution
  goalType: 'open',                    // open | penalty | freekick | header | own
  cardType: 'yellow',                  // yellow | second_yellow | red

  note: '',
  createdBy: 'uid...',
  createdAt: Timestamp,
  // 修正時保留原紀錄，僅標記
  voided: false,
  voidedBy: null, voidedAt: null, voidReason: null
}
```

**事件型別表**

| type | 說明 | 影響比分 | 必填欄位 |
|---|---|---|---|
| `period_start` | 期別開始 | — | periodId |
| `period_end` | 期別結束 | — | periodId |
| `goal` | 進球 | ✅ | side, playerId, goalType |
| `own_goal` | 烏龍球 | ✅（記給對方） | side（進球者所屬隊）, playerId |
| `penalty_scored` | 罰球進 | ✅ | side, playerId |
| `penalty_missed` | 罰球失 | — | side, playerId |
| `card` | 出牌 | — | side, playerId, cardType |
| `substitution` | 換人 | — | side, playerId(下), subInPlayerId(上) |
| `injury` | 傷停 | — | side, playerId |
| `note` | 賽務備註 | — | note |

> **比分的權威來源**：`match.score` 是「顯示值」，由裁判端直接維護；`timeline` 是「明細」。系統在完賽時做一次一致性檢查（timeline 加總 vs score），不一致則在 Admin 端亮警示，但**不自動覆寫**——現場以裁判判定為準。

### 1.9 `standings/{standingId}`

id 格式：`${divisionId}__${stageId}__${groupId}`，例如 `adult-open__group__A`。

```js
{
  standingId: 'adult-open__group__A',
  eventId, divisionId, stageId, groupId,
  rows: [
    {
      rank: 1,
      teamId: 't-101', name: '臺中野狼', abbr: 'WLF', logoUrl: '...',
      played: 3, win: 2, draw: 1, loss: 0,
      goalsFor: 7, goalsAgainst: 2, goalDiff: 5,
      points: 7,
      yellow: 2, red: 0, fairPlayPoints: -2,
      form: ['W','D','W'],             // 近期戰績
      tieBreakTrace: ['pts=7', 'h2h=n/a', 'gd=5'],   // 排序依據紀錄，供 Admin 稽核
      locked: false,                    // Admin 手動指定名次時為 true
      note: ''
    }
  ],
  computedAt: Timestamp,
  computedBy: 'fn:recalcStanding',
  version: 12,                          // 每次重算 +1
  hasUnresolvedTie: false,              // 需人工裁定時為 true
  manualOverride: {                     // Admin 手動排序時
    enabled: false, by: null, at: null, reason: null
  }
}
```

### 1.10 `venues/{venueId}`

```js
{
  venueId: 'venue-a',
  name: 'A場',
  fullName: '太原足球場 A場',
  order: 1,
  fieldType: '9v9',                    // 5v5 | 9v9
  geo: { lat: 24.1698, lng: 120.7150 },
  stream: {                            // 場地固定機位直播
    enabled: true, provider: 'youtube',
    channelId: 'UCxxxx', videoId: null, status: 'live'
  },
  activeMatchId: 'AO-G-A-01'
}
```

### 1.11 `matchSheets/{matchSheetId}`

id：`${matchId}__${teamId}`。這是「該場次誰可以上場」的權威文件。

```js
{
  matchSheetId: 'AO-G-A-01__t-101',
  matchId, teamId, divisionId, eventId,
  starters: [                          // 先發（5 人制 5 人 / 9 人制 9 人）
    { memberId, name, jerseyNo, position, isCaptain, isGoalkeeper }
  ],
  substitutes: [ /* 同上 */ ],
  staff: [ { memberId, name, role } ],
  checkedInCount: 14,
  requiredMin: 7,                      // 低於此數不得開賽（可設定）
  status: 'confirmed',                 // draft | checking | confirmed | rejected
  confirmedBy: 'uid...', confirmedAt: Timestamp,
  signature: {                         // 隊職員簽核（可選）
    teamRepName: '李教練', signedAt: Timestamp
  },
  issues: [ { memberId, code: 'NOT_CHECKED_IN', message: '未完成檢錄' } ]
}
```

### 1.12 `checkins/{checkinId}`

id：`${matchId}__${memberId}`（同場次同人只會有一筆，天然防重複）。

```js
{
  checkinId: 'AO-G-A-01__m-101-07',
  eventId, matchId, teamId, memberId,
  memberName: '王小明', jerseyNo: 7,
  result: 'pass',                      // pass | fail | manual
  failReason: null,                    // WRONG_MATCH | REVOKED | NOT_IN_ROSTER | AGE | DUPLICATE
  method: 'qr',                        // qr | manual | photo
  verifiedOffline: true,               // 離線驗證後補傳
  deviceId: 'stf-03',
  scannedBy: 'uid...',
  scannedAt: Timestamp,                // 掃描當下（裝置時間）
  syncedAt: Timestamp                  // 寫入伺服器時間
}
```

### 1.13 `boards/{boardId}`

給公開首頁用的彙總文件，由 Function 扇出寫入。目的是**讓首頁只監聽 1 份文件**，而不是監聽 81 筆 match。

```js
// boards/live
{
  boardId: 'live',
  updatedAt: Timestamp,
  liveMatches: [
    { matchId, divisionName: '成人公開組', venueName: 'A場',
      home: { abbr:'WLF', name:'臺中野狼', logoUrl, score: 2 },
      away: { abbr:'TGR', name:'臺中猛虎', logoUrl, score: 1 },
      period: 'h2', minute: 63, status: 'live',
      streamUrl: 'https://youtube.com/watch?v=...' }
  ],
  nextMatches: [ /* 接下來 5 場精簡資料 */ ],
  justFinished: [ /* 剛結束 5 場 */ ]
}

// boards/today  今日賽程精簡版（依日期一份）

// boards/scorers  射手榜（M3.9 起由 fn:rebuildBoards 維護）
{
  boardId: 'scorers',
  rows: [
    {
      rank: 1,
      playerId: 'm-101-07',
      name: '王小＊',            // ⚠️ 取自 teams/{t}/roster 的 displayName（已遮蔽）
      teamId: 't-101', teamName: '臺中野狼', jerseyNo: 7,
      divisionId: 'adult-open',  // 公開端靠這個欄位篩組別
      goals: 5, penalties: 1, openPlay: 4,
      matchesPlayed: 3, minutesPlayed: null
    }
  ],
  updatedAt: Timestamp,
  computedBy: 'fn:rebuildBoards'
}

// boards/fairplay  行為分排行（同上，rows 帶 divisionId）
{ boardId: 'fairplay', rows: [ { rank, teamId, name, divisionId, fairPlayPoints, yellow, red, played } ], updatedAt }
```

> **每個組別最多 20 列**，六組共用同一份 `rows`。重建某一組別時只換掉
> `divisionId` 相符的那幾列，其他組別原封不動（交易保護，六組會同時完賽）。
>
> ⚠️ **姓名一律取自 `teams/{teamId}/roster/{memberId}` 的 `displayName`**，
> 不可以用 timeline 事件上的 `playerName`。後者是賽務端記的真名，
> 而 `boards/*` 是 `allow read: if true`——寫上去等於把未滿 13 歲球員的
> 真名公開掛出去（R-PRIV-001、docs/03 §7.3）。名冊上查不到的球員留 `null`，
> 公開端顯示背號即可。
>
> ⚠️ **PK 大戰的罰球不計入個人進球**（docs/03 §9.2）。它跟場中罰球在 timeline
> 上是同一個 type，只差 `periodId === 'pk'`。

### 1.14 `audits/{auditId}`

```js
{
  auditId: 'auto',
  eventId,
  entity: 'match',                     // match | standing | member | attempt | team | matchSheet
  entityId: 'AO-G-A-01',
  action: 'score.update',              // 動作代碼
  before: { score: { home: 2, away: 1 } },
  after:  { score: { home: 2, away: 2 } },
  diffKeys: ['score.away'],
  reason: '裁判回報第 88 分鐘進球漏記',
  actor: { uid: '...', name: '陳管理', role: 'admin' },
  source: 'admin-web',                 // admin-web | staff-web | function | script
  ip: null,
  createdAt: Timestamp
}
```

> 稽核文件**只能新增，不可更新或刪除**（rules 強制）。

### 1.15 Challenge 相關

```js
// challenges/{challengeId}
{
  challengeId: 'g01-nine-grid',
  order: 1,
  name: '九宮格射門挑戰',
  shortName: '九宮格',
  icon: '🎯',
  description: '球門設置九宮格目標，於指定距離射門，不同位置不同分數。',
  rulesText: '每人 5 球，一般區 1 分、中難度 2 分、高難度角落 3 分。',
  scoreType: 'points',        // points | count | time | speed | distance | height | boolean
  unit: '分',
  rankingRule: 'higher',      // higher | lower
  decimals: 0,
  minValue: 0, maxValue: 15,  // 輸入防呆範圍
  attemptPolicy: {
    maxAttemptsPerPlayer: 3,  // null = 不限
    allowRepeat: true,
    rankBy: 'best'            // best | first | last | sum
  },
  boothLocation: '攤位 1',
  status: 'open',             // draft | open | paused | closed
  stats: { players: 0, attempts: 0 },
  createdAt, updatedAt
}

// players/{playerId}   Challenge 玩家（免註冊）
{
  playerId: 'FEDA-0182',      // = document id，現場可讀可念
  eventId,
  nickname: '阿哲',
  avatarSeed: 'a7f3',         // 產生預設頭像用
  ageBand: 'adult',           // kid | teen | adult（選填，用於分齡排行）
  contact: { phone: null, lineUserId: null },   // 中獎聯絡用，選填
  qrCode: 'FEDAP.FEDA-0182.1760227200.3c9a1f7b',
  linkedTeamId: null,         // 若同時是參賽球員可關聯
  completedChallengeIds: ['g01-nine-grid','g02-header'],
  luckyDrawEntries: 2,
  createdAt, createdVia: 'self-qr',   // self-qr | staff
  lastActiveAt
}

// attempts/{attemptId}
{
  attemptId: 'auto',
  eventId, challengeId, playerId,
  playerNickname: '阿哲',
  attemptNo: 2,               // 該玩家在該關的第幾次
  rawValue: 82,               // 原始成績
  displayValue: '82 km/h',
  isBest: true,               // 是否為該玩家該關最佳
  source: 'free',             // free | ticket | staff | other  ← 園遊券預留
  staffUid: '...', boothDeviceId: 'booth-04',
  voided: false, voidReason: null,
  createdAt: Timestamp
}

// leaderboards/{challengeId}   排行榜快取（Function 維護）
{
  challengeId: 'g04-speed-king',
  rows: [ { rank:1, playerId:'FEDA-0007', nickname:'Kevin',
             value: 93, displayValue:'93 km/h', attemptAt: Timestamp } ],
  topN: 50,
  totalPlayers: 137,
  computedAt: Timestamp, version: 88
}
```

### 1.16 `registrations/{registrationId}`

```js
{
  registrationId: 'auto',
  eventId, divisionId,
  teamName: '臺中野狼足球隊',
  contact: { name, phone, email, lineUserId },
  roster: [ { name, jerseyNo, position, birthDate, idLast4, guardianName } ],
  attachments: [ { type:'roster_pdf', url } ],
  fee: { amount: 0, status: 'waived' },   // 本次預設免金流
  status: 'pending',          // pending | approved | rejected | withdrawn
  reviewedBy, reviewedAt, reviewNote,
  createdTeamId: null,        // 核准後產生的 teams doc id
  createdAt, updatedAt
}
```

### 1.17 `config/{configKey}`（根層級）

```js
// config/formats
{ formats: { F8_GROUP_CROSS: {...}, F6_TWO_GROUPS_MIRROR: {...},
              F6_TWO_GROUPS_CROSS: {...}, F4_RR_FINAL: {...} } }

// config/rankingRules
{ rules: { RR_FEDA_DEFAULT: {...}, RR_FEDA_YOUTH: {...}, RR_FIFA_2026: {...} } }

// config/featureFlags
{ liveTimeline: true, scorerBoard: true, photoWall: false }

// config/schedule —— 排程設定（賽程管理用）
// ⚠️ 這幾個數字**規章都沒有規定**，是營運決定，所以放在後台改得到的地方。
//    比賽時間與用球在 config/formats（規章第十七、十八條），不在這裡。
{
  startTime: '08:30',        // 當天第一個時段
  endTime: '18:00',          // 最後一場必須在這之前開賽
  bufferMin: 10,             // 場間緩衝（場地佔用 = 比賽時間 + 緩衝）
  minRestMin: 20,            // 同一隊兩場之間的休息下限（不足只是 warn）
  maxGapMin: 240,            // 空等超過這個數字提醒（warn）
  venuesByDate: { '2026-10-09': ['venue-a', 'venue-b', 'venue-c'],
                  '2026-10-10': ['venue-a', 'venue-b'] }
}
```

⚠️ `config/formats` 除了規章定案的四個範本，還會有**系統產生的通用範本**
（`GEN_{N}T_{G}G`，見 `js/engine/schedule.js` 的 `genericFormat`）：
實際報名的隊數不是 4／6／8 時由賽程管理產生並寫回這裡。
Cloud Functions 解晉級讀的就是這一份——只改 `division.formatId`
而沒有把範本寫進來的話，晉級會在比賽當天才失敗。

詳細內容見 `02-賽制引擎與排名規則.md`。

