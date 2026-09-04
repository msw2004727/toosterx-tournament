/**
 * 全站常數與版本
 * ------------------------------------------------------------------
 * CACHE_VERSION 只能由 `node scripts/bump-version.js` 修改。
 * 手動改這裡會讓四處版號不同步（js/config.js、sw.js、index.html、asset query）。
 */

export const CACHE_VERSION = '0.20260904g';

/** 本次活動。未來要辦第二場時，這裡改成從路由或設定讀取。 */
export const EVENT_ID = 'feda-cup-2026';

export const EVENT = {
  id: EVENT_ID,
  name: 'FEDA CUP 2026｜飛達盃',
  officialName: '2026臺中市足球教育發展協會理事長盃足球賽',
  slogan: '從社群走向賽場',
  dates: ['2026-10-09', '2026-10-10', '2026-10-11'],
  venueName: '太原足球場',
  timezone: 'Asia/Taipei'
};

/** 組別顯示順序與代碼（實際賽制設定放 Firestore config/formats） */
export const DIVISION_ORDER = ['u6', 'u8', 'u10', 'women', 'adult-fun', 'adult-open'];

/** 場次狀態（與 02-賽制引擎 §9.1 狀態機一致） */
export const MATCH_STATUS = [
  'scheduled', 'checkin', 'ready', 'live', 'halftime',
  'finished', 'confirmed', 'postponed', 'cancelled', 'walkover'
];

/** 比賽期別 */
export const PERIODS = ['pre', 'h1', 'ht', 'h2', 'et1', 'et2', 'pk', 'ft'];

/**
 * 角色字典（與 07-權限安全 §1.1、docs/10 §5.1 一致）
 * ------------------------------------------------------------------
 * ⚠️ **與 FC-Football（github.com/msw2004727/FC）對齊。**
 *    兩個專案共用同一批 LINE 使用者（uid 相同，docs/10 §8.5），未來要對接，
 *    所以**角色代碼與階層數值必須一字不差**。FC 的權威定義在
 *    `js/config.js` 的 `_BASE_ROLES` / `_BASE_ROLE_LEVEL_MAP`。
 *    `tests/unit/roles-fc-parity.test.js` 會盯著這件事不要漂移。
 *
 * FC 共用的六個（代碼、level、標籤都相同）：
 *    user 0 一般用戶／coach 1 教練／captain 2 領隊／
 *    venue_owner 3 場主／admin 4 管理員／super_admin 5 總管
 *
 * ── 兩邊刻意不同的地方（有意識的分歧，不是漂移）──────────────
 *
 * 1. **多出四個賽務角色**：booth／checkin／referee／scorer。
 *    FC 沒有這些（它不辦賽事）。level 用小數插在領隊(2)與管理員(4)之間，
 *    不撞到 FC 既有的整數，對接時語意也對（比領隊高、比管理員低）。
 *
 * 2. **形狀**：FC 是 `user.role` 單一字串；這裡是 `staff/{uid}.roles` 陣列。
 *    現場一個人真的會同時是記錄員與裁判，而且賽務角色還有「指派場地」
 *    這個維度，壓不成單一字串。
 *
 * 3. **少用 coach／venue_owner**，但字典裡保留：對接時要看得懂 FC 傳來的值。
 */
export const ROLE_INFO = {
  // ── 與 FC 完全相同 ──
  user:        { level: 0, label: '一般用戶', fc: true },
  coach:       { level: 1, label: '教練',     fc: true },
  captain:     { level: 2, label: '領隊',     fc: true },
  venue_owner: { level: 3, label: '場主',     fc: true },
  admin:       { level: 4, label: '管理員',   fc: true },
  super_admin: { level: 5, label: '總管',     fc: true },

  // ── 賽事營運專用（FC 沒有）。順序由主辦 2026-09-03 指定 ──
  booth:       { level: 2.1, label: '挑戰攤位', fc: false },
  checkin:     { level: 2.2, label: '檢錄員',   fc: false },
  referee:     { level: 2.3, label: '裁判',     fc: false },
  scorer:      { level: 2.4, label: '記錄員',   fc: false }
};

/**
 * 賽務角色的**繼承鏈**（主辦 2026-09-03 指定：向上包含）。
 *
 *   挑戰攤位 < 檢錄員 < 裁判 < 記錄員 < 管理員 < 總管
 *
 * ⚠️ **為什麼用一條明列的鏈，而不是比 `level` 大小。**
 *    FC 的 `venue_owner` 是 level 3，正好夾在記錄員(2.4)與管理員(4)之間。
 *    用 `level >=` 判斷的話，一個從 FC 同步過來的「場主」會自動繼承
 *    記錄員、裁判、檢錄員的全部權限——那個人可能只是租場地的老闆。
 *    明列的鏈讓「誰在鏈上」是一個決定，不是一個副作用。
 *
 * `level` 仍然存在，但**只用來排序與顯示**。
 */
export const STAFF_CHAIN = ['booth', 'checkin', 'referee', 'scorer', 'admin', 'super_admin'];

/**
 * 展開一組角色的實際身分（含繼承來的）。
 *
 * `['scorer']` → `['booth','checkin','referee','scorer']`
 * `['booth','admin']` → 鏈上到 admin 為止的全部
 * 不在鏈上的角色（captain／coach／venue_owner／未知值）原樣保留，不展開。
 *
 * @param {string[]} roles
 * @returns {string[]} 去重，順序照 STAFF_CHAIN 再接非鏈上的
 */
export function impliedRoles(roles = []) {
  const list = Array.isArray(roles) ? roles : [];
  let top = -1;
  const extras = [];
  for (const r of list) {
    const i = STAFF_CHAIN.indexOf(r);
    if (i >= 0) top = Math.max(top, i);
    else if (r && !extras.includes(r)) extras.push(r);
  }
  return top < 0 ? extras : [...STAFF_CHAIN.slice(0, top + 1), ...extras];
}

/** 有沒有這個角色（含繼承）。判權限請用 can()，這支只回答「是不是」。 */
export const hasRoleAtLeast = (roles, role) => impliedRoles(roles).includes(role);

/** 由高到低。UI 顯示多重身分時取最高的那個當主標籤。 */
export const ROLES = Object.keys(ROLE_INFO)
  .sort((a, b) => ROLE_INFO[b].level - ROLE_INFO[a].level);

export const roleLabel = key => ROLE_INFO[key]?.label ?? key;

/**
 * 一組角色裡「最高」的那一個。**只用於顯示。**
 * 判斷能不能做某件事一律走 can()／權限碼，不要寫 `level >= 4`。
 */
export const topRole = (roles = []) =>
  [...roles].filter(r => ROLE_INFO[r]).sort((a, b) => ROLE_INFO[b].level - ROLE_INFO[a].level)[0] ?? null;

/**
 * 權限碼字典 —— 每一個「獨立功能」一條。
 * ------------------------------------------------------------------
 * 這是總管在授權介面上看到的清單。`minRole` 是**預設**歸屬（含繼承），
 * 總管可以在 `rolePermissions/{role}` 逐條開關來覆寫。
 *
 * `destructive: true` 的那幾條**同時寫在 firestore.rules 裡**
 * （主辦 2026-09-03 決定：破壞性操作進規則，其餘只控畫面）。
 * 這些條目把開關關掉只是收起按鈕，真正擋得住的是 rules；
 * 反過來說，把它們打開也不代表 rules 會放行。
 *
 * ⚠️ 非 destructive 的條目**只控制畫面**。不要用它們來保護資料——
 *    懂技術的人直接送請求還是寫得進去。
 */
export const PERMISSIONS = [
  // ── 挑戰攤位 ──
  { code: 'challenge.attempt.write', label: '登錄挑戰成績', group: '挑戰區', minRole: 'booth' },

  // ── 檢錄 ──
  { code: 'checkin.write',    label: '檢錄勾選出賽',   group: '檢錄', minRole: 'checkin' },
  { code: 'member.read',      label: '看球員個資（生日／身分證後四碼）', group: '檢錄', minRole: 'checkin' },

  // ── 裁判 ──
  // 時鐘與期別**不在**這裡：rules 對 matches 文件是一道整體的閘
  // （isScorer()），拆成兩支會讓那條規則長一倍。裁判在系統裡的職能是
  // 名單與檢錄，場上的哨音本來就不需要系統。
  { code: 'matchsheet.write', label: '編輯出場名單',   group: '賽務', minRole: 'referee' },

  // ── 記錄員 ──
  { code: 'match.period',      label: '控制比賽時鐘與期別', group: '賽務', minRole: 'scorer', destructive: true },
  { code: 'match.score.write', label: '記錄比分與事件', group: '賽務', minRole: 'scorer', destructive: true },
  { code: 'match.finish',      label: '送出完賽',       group: '賽務', minRole: 'scorer', destructive: true },
  { code: 'match.undo',        label: '三分鐘內自撤回', group: '賽務', minRole: 'scorer', destructive: true },

  // ── 管理員 ──
  // ⚠️ 覆核刻意**不在**記錄員身上（主辦 2026-09-03 決定）：
  //    覆核的意義是「第二雙眼睛」，記分的人自己覆核自己等於沒有覆核。
  { code: 'match.confirm',     label: '覆核完賽',       group: '管理', minRole: 'admin', destructive: true },
  { code: 'match.reopen',      label: '重開已鎖定的場次', group: '管理', minRole: 'admin', destructive: true },
  { code: 'match.score.override', label: '改判比分',    group: '管理', minRole: 'admin', destructive: true },
  { code: 'schedule.manage',   label: '編排賽程與場次', group: '管理', minRole: 'admin', destructive: true },
  { code: 'standing.manual',   label: '人工裁定同分',   group: '管理', minRole: 'admin', destructive: true },
  { code: 'team.manage',       label: '審核報名與球隊', group: '管理', minRole: 'admin', destructive: true },
  { code: 'audit.read',        label: '查看稽核紀錄',   group: '管理', minRole: 'admin' },
  { code: 'export',            label: '匯出資料',       group: '管理', minRole: 'admin' },

  // ── 總管 ──
  { code: 'staff.assign',      label: '指派身分',       group: '總管', minRole: 'super_admin', destructive: true },
  { code: 'perms.manage',      label: '調整權限開關',   group: '總管', minRole: 'super_admin', destructive: true },
  { code: 'registration.manage', label: '開關報名與截止日', group: '總管', minRole: 'super_admin', destructive: true }
];

export const PERMISSION_BY_CODE = Object.fromEntries(PERMISSIONS.map(p => [p.code, p]));

/** 權限分組的顯示順序 */
export const PERMISSION_GROUPS = ['挑戰區', '檢錄', '賽務', '管理', '總管'];

/**
 * 一個角色**預設**拿得到哪些權限碼（依 minRole ＋ 繼承鏈）。
 * @param {string} role
 */
export function defaultPermsOf(role) {
  const mine = impliedRoles([role]);
  return PERMISSIONS.filter(p => mine.includes(p.minRole)).map(p => p.code);
}

/**
 * 一組角色實際擁有的權限碼。
 *
 * @param {string[]} roles   staff/{uid}.roles
 * @param {object} [matrix]  rolePermissions 集合的內容
 *                           `{ scorer: { perms: { 'match.finish': false } } }`
 *                           只列覆寫，沒列的走預設。
 * @returns {Set<string>}
 */
export function effectivePerms(roles = [], matrix = {}) {
  const mine = impliedRoles(roles);

  // 總管永遠是全部。少了這一條，總管可能把自己鎖在門外——
  // 而「調整權限開關」本身也是一條權限，關掉就再也打不開了。
  if (mine.includes('super_admin')) return new Set(PERMISSIONS.map(p => p.code));

  const out = new Set();
  for (const p of PERMISSIONS) {
    // 預設：這組角色的繼承鏈有沒有覆蓋到 minRole
    let on = mine.includes(p.minRole);
    // 覆寫：任何一個持有的角色明確開啟就開、明確關閉就關（開優先）
    let sawTrue = false;
    let sawFalse = false;
    for (const r of mine) {
      const v = matrix?.[r]?.perms?.[p.code];
      if (v === true) sawTrue = true;
      else if (v === false) sawFalse = true;
    }
    if (sawTrue) on = true;
    else if (sawFalse) on = false;
    if (on) out.add(p.code);
  }
  return out;
}

/**
 * 專屬首頁（`#/my`）上的功能入口。
 * ------------------------------------------------------------------
 * 每一條對應一個權限碼。層級越高，這一頁看得到的功能越多——
 * 這就是主辦要的「層級越高權限越大功能越多」。
 *
 * `route` 是 null 代表**還沒做**。這種條目會畫成一列說明文字而不是按鈕：
 * 畫一顆按了沒反應的按鈕比沒有按鈕更糟，但完全不顯示又會讓人以為
 * 自己的身分沒生效。折衷是「看得到、標明規劃中、按不下去」。
 */
export const FEATURES = [
  { code: 'checkin.write',    label: '檢錄',       hint: '賽前 30 分鐘核對名單與證件', route: '/staff', icon: 'list' },
  { code: 'matchsheet.write', label: '出場名單',   hint: '確認先發與替補',           route: '/staff', icon: 'team' },
  { code: 'match.score.write',label: '賽務台',     hint: '記錄比分、事件與完賽送出',  route: '/staff', icon: 'whistle' },
  { code: 'challenge.attempt.write', label: '挑戰攤位', hint: '挑戰區成績登錄',      route: null,     icon: 'goal' },
  { code: 'team.manage',      label: '報名審核',   hint: '審核球隊報名與名單',       route: '/admin/teams', icon: 'check' },
  { code: 'schedule.manage',  label: '賽程管理',   hint: '編排場次與場地',           route: null,     icon: 'table' },
  { code: 'audit.read',       label: '稽核紀錄',   hint: '誰在什麼時候改了什麼',      route: null,     icon: 'note' },
  { code: 'staff.assign',     label: '身分授權',   hint: '指派管理員／賽務／檢錄員',  route: '/admin/staff', icon: 'person' },
  { code: 'perms.manage',     label: '權限開關',   hint: '逐條調整每個身分能做的事',  route: '/admin/perms', icon: 'more' },
  { code: 'registration.manage', label: '報名開關', hint: '開放／截止與日期',        route: null,     icon: 'clock' }
];

/** Challenge 成績型態 */
export const SCORE_TYPES = [
  'points', 'count', 'time', 'speed', 'distance', 'height', 'boolean'
];

/** 球員證 QR 格式版本前綴 */
export const QR_PREFIX = 'FEDA1';
export const EVENT_SHORT = 'FC26';

/** 即時監聽上限（超過就是設計出問題了，開發階段丟警告） */
export const MAX_LISTENERS = 4;
