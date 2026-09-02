/**
 * 格式化工具
 * ------------------------------------------------------------------
 * 規格：docs/08-UI規範與前端架構.md §9（內容與文案原則）
 *
 * 文案鐵則：
 *   ・時間一律 24 小時制（09:30），日期用 10/9（四）
 *   ・用「場次」不用「比賽編號」；用「完賽」不用「結束」
 *   ・兒童組不用「淘汰」，用「名次賽」
 *
 * 純函式、零依賴，Node 測得到。所有時間都以 Asia/Taipei 呈現——
 * 賽務手機可能設成任何時區，但賽程表上的 09:30 永遠是台北的 09:30。
 */

export const TZ = 'Asia/Taipei';

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

/** Firestore Timestamp / Date / ISO 字串 / 毫秒 → 毫秒數；無法解析回傳 null */
export function toMillis(v) {
  if (v == null) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;     // 已序列化的 Timestamp
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** 取得該時間在台北時區的年月日時分（不依賴執行環境的時區設定） */
function taipeiParts(ms) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short'
  });
  const p = Object.fromEntries(f.formatToParts(ms).map(x => [x.type, x.value]));
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +(p.hour === '24' ? '00' : p.hour), minute: +p.minute
  };
}

/** 09:30 */
export function hhmm(v) {
  const ms = toMillis(v);
  if (ms == null) return '--:--';
  const { hour, minute } = taipeiParts(ms);
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** 10/9（四） */
export function dateLabel(v) {
  const ms = toMillis(v);
  if (ms == null) return '';
  const { year, month, day } = taipeiParts(ms);
  // 用 UTC 建構避免本機時區把日期推移一天
  const wd = WEEKDAY[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day}（${wd}）`;
}

/** 2026-10-09 → 10/9（四）；輸入已經是日期字串時不做時區換算 */
export function dateLabelFromYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return String(ymd || '');
  const [, y, mo, d] = m;
  const wd = WEEKDAY[new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDay()];
  return `${+mo}/${+d}（${wd}）`;
}

/** 10/9（四）09:30 */
export function dateTimeLabel(v) {
  const ms = toMillis(v);
  if (ms == null) return '';
  return `${dateLabel(ms)} ${hhmm(ms)}`;
}

/** 秒數 → 63:24（計時器用，等寬數字） */
export function clockText(totalSec) {
  const s = Math.max(0, Math.floor(Number(totalSec) || 0));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

/**
 * 比賽分鐘顯示。
 * ⚠️ 不可寫死 45／90：本賽事成人組 30 分鐘、兒童組 20 分鐘，
 *    上下半場的分界一律由 matchDurationMin 推算（docs/02 §9）。
 *
 * @param {number} elapsedSec  該期別已進行秒數
 * @param {string} period      pre|h1|ht|h2|et1|et2|pk|ft
 * @param {number} matchDurationMin 全場分鐘數（不含延長）
 * @returns {string} 例：12'、30+2'、45'
 */
export function displayMinute(elapsedSec, period, matchDurationMin = 30) {
  const half = Math.round(matchDurationMin / 2);
  const base = { h1: 0, ht: half, h2: half, et1: matchDurationMin, et2: matchDurationMin + 5 };
  if (!(period in base)) return '';

  const limit = period === 'h1' ? half
              : period === 'h2' ? matchDurationMin
              : period === 'et1' ? matchDurationMin + 5
              : matchDurationMin + 10;

  const minute = base[period] + Math.floor(Math.max(0, elapsedSec) / 60);
  if (minute > limit) return `${limit}+${minute - limit}'`;
  return `${minute}'`;
}

/** 期別中文 */
export const PERIOD_LABEL = {
  pre: '未開賽', h1: '上半場', ht: '中場', h2: '下半場',
  et1: '延長上半', et2: '延長下半', pk: 'PK 大戰', ft: '完賽'
};

/** 場次狀態中文（用「完賽」不用「結束」） */
export const STATUS_LABEL = {
  scheduled: '未開始', checkin: '檢錄中', ready: '待開賽', live: '進行中',
  halftime: '中場', finished: '已完賽', confirmed: '已確認',
  postponed: '延期', cancelled: '取消', walkover: '判定勝'
};

/**
 * 比分文字。兒童組開啟仁慈規則時，分差達 cap 就顯示 7+（docs/02 §6.2）。
 * @returns {{home:string, away:string, masked:boolean}}
 */
export function scoreText(score, mercyRule) {
  // 嚴格檢查：Number(null) 是 0，用 Number() 會把「還沒填比分」顯示成 0:0（R-ENG-002）
  const h = strictNum(score?.home);
  const a = strictNum(score?.away);
  if (h === null || a === null) return { home: '-', away: '-', masked: false };

  const cap = mercyRule?.enabled ? Math.max(1, Math.trunc(mercyRule.cap ?? 7)) : null;
  if (cap != null && Math.abs(h - a) >= cap) {
    return h > a
      ? { home: `${cap}+`, away: String(a), masked: true }
      : { home: String(h), away: `${cap}+`, masked: true };
  }
  return { home: String(h), away: String(a), masked: false };
}

/** #7 王小明 */
export function playerLabel(p) {
  if (!p) return '';
  const no = p.jerseyNo != null ? `#${p.jerseyNo} ` : '';
  return `${no}${p.displayName ?? p.name ?? ''}`.trim();
}

/**
 * 未滿 13 歲公開端顯示遮蔽名（R-PRIV-001、docs/03 §7.3）。
 *
 * 實作在 `js/engine/privacy.js`——那一份會被 scripts/sync-engine.js 同步給
 * Cloud Function 用（投影 roster 的時候要遮），三個地方共用同一份（R-ENG-001）。
 * 這裡只是 re-export，讓既有的 import 路徑不必跟著動。
 *
 * ⚠️ 公開端**優先用 roster 的 displayName**（那一份已經遮蔽過了），
 *    這個函式只是最後一道保險，不要拿它去遮 members 的真名再顯示。
 */
export { maskName } from '../engine/privacy.js';

/** 相對時間：剛剛／3 分鐘前／10:24 */
export function agoText(v, nowMs = Date.now()) {
  const ms = toMillis(v);
  if (ms == null) return '';
  const diff = Math.floor((nowMs - ms) / 1000);
  if (diff < 30) return '剛剛';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`;
  return hhmm(ms);
}

export const pad2 = n => String(n).padStart(2, '0');

/** 只接受真正的數字。與 js/engine/tally.js 的 strictNum 同一條規則（R-ENG-002）。 */
function strictNum(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
