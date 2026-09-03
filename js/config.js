/**
 * 全站常數與版本
 * ------------------------------------------------------------------
 * CACHE_VERSION 只能由 `node scripts/bump-version.js` 修改。
 * 手動改這裡會讓四處版號不同步（js/config.js、sw.js、index.html、asset query）。
 */

export const CACHE_VERSION = '0.20260903a';

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
 * 1. **形狀**：FC 是 `user.role` 單一字串＋數值階層；
 *    這裡是 `staff/{uid}.roles` **陣列**，沒有階層。
 *    原因是賽事現場一個人真的會同時是記錄員與裁判，而且權限是
 *    「角色 × 指派範圍（場地／組別）」的交集，壓不成一條線
 *    （R-RULES-002）。level 在這裡只用來排序與顯示，**不用來判權限**。
 *
 * 2. **多出三個賽務角色**：scorer／referee／booth。
 *    FC 沒有這些（它不辦賽事）。level 插在 captain(2) 與 admin(4) 之間，
 *    對接時 FC 端看到會落在「比領隊高、比管理員低」，語意是對的。
 *
 * 3. **少了 coach／venue_owner**：這個系統用不到，但**保留在字典裡**——
 *    對接時要看得懂 FC 傳過來的角色，不能因為沒用到就當成無效值。
 */
export const ROLE_INFO = {
  // ── 與 FC 完全相同 ──
  user:        { level: 0, label: '一般用戶', fc: true },
  coach:       { level: 1, label: '教練',     fc: true },
  captain:     { level: 2, label: '領隊',     fc: true },
  venue_owner: { level: 3, label: '場主',     fc: true },
  admin:       { level: 4, label: '管理員',   fc: true },
  super_admin: { level: 5, label: '總管',     fc: true },

  // ── 賽事營運專用（FC 沒有）──
  scorer:      { level: 2.4, label: '記錄員',   fc: false },
  referee:     { level: 2.6, label: '裁判',     fc: false },
  booth:       { level: 2.2, label: '挑戰攤位', fc: false }
};

/** 由高到低。UI 顯示多重身分時取最高的那個當主標籤。 */
export const ROLES = Object.keys(ROLE_INFO)
  .sort((a, b) => ROLE_INFO[b].level - ROLE_INFO[a].level);

export const roleLabel = key => ROLE_INFO[key]?.label ?? key;

/**
 * 一組角色裡「最高」的那一個。
 * ⚠️ 只用於顯示。判斷能不能做某件事一律看有沒有那個角色本身，
 *    不可以寫成 `level >= 4`——賽務角色的權限是範圍交集，不是階層。
 */
export const topRole = (roles = []) =>
  [...roles].filter(r => ROLE_INFO[r]).sort((a, b) => ROLE_INFO[b].level - ROLE_INFO[a].level)[0] ?? null;

/** Challenge 成績型態 */
export const SCORE_TYPES = [
  'points', 'count', 'time', 'speed', 'distance', 'height', 'boolean'
];

/** 球員證 QR 格式版本前綴 */
export const QR_PREFIX = 'FEDA1';
export const EVENT_SHORT = 'FC26';

/** 即時監聽上限（超過就是設計出問題了，開發階段丟警告） */
export const MAX_LISTENERS = 4;
