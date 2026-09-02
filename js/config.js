/**
 * 全站常數與版本
 * ------------------------------------------------------------------
 * CACHE_VERSION 只能由 `node scripts/bump-version.js` 修改。
 * 手動改這裡會讓四處版號不同步（js/config.js、sw.js、index.html、asset query）。
 */

export const CACHE_VERSION = '0.20260902h';

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

/** 角色（與 07-權限安全 §1.1 一致）
 *  2026-08-29：拿掉 venue_lead，新增 captain（球隊隊長，見 docs/10 §2）。
 *  captain 不是 staff 角色——它是「某一隊的隊長」，寫在 teams/{id}.captainUid，
 *  這裡列出來只是為了讓 UI 有一個統一的角色字典。 */
export const ROLES = [
  'guest', 'player', 'captain', 'booth', 'scorer', 'referee',
  'admin', 'super_admin'
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
