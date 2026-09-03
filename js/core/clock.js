/**
 * 比賽時鐘與伺服器時間校正
 * ------------------------------------------------------------------
 * 規格：docs/04-功能規格-賽務裁判端.md §5.2、docs/08 §5
 *
 * 設計重點：
 *   1. **狀態變更才寫 Firestore**（開始／暫停／結束期別），不是每秒寫。
 *      現場三個場地同時進行，每秒寫入是完全不必要的成本與衝突來源。
 *   2. 計時在本機跑，斷網完全不受影響。
 *   3. 時鐘的「真相」是 { running, periodStartedAt, elapsedSecAtPause }，
 *      任何裝置拿到這三個值都能算出同一個秒數——公開端也是靠這個。
 *
 * 這個檔案的計算部分是純函式，Node 測得到；只有 ticker 需要瀏覽器。
 */

import { toMillis } from '../lib/format.js';

// ── 伺服器時間校正 ────────────────────────────────────────────
// 賽務手機的時間可能不準。公開端顯示的「第 63 分鐘」若用本機時間算，
// 手機慢 2 分鐘就會少 2 分鐘。offset 由 core/firebase.js 在連線後設定。
let serverOffsetMs = 0;

export function setServerOffset(ms) {
  if (typeof ms === 'number' && Number.isFinite(ms) && Math.abs(ms) < 24 * 3600 * 1000) {
    serverOffsetMs = ms;
  }
}
export function getServerOffset() { return serverOffsetMs; }

/** 校正後的現在時間 */
export function now() { return Date.now() + serverOffsetMs; }

// ── 時鐘計算（純函式）────────────────────────────────────────

/** 空時鐘 */
export const emptyClock = () => ({
  running: false, periodStartedAt: null, elapsedSecAtPause: 0, addedTimeSec: 0
});

/**
 * 目前期別已進行的秒數。
 * @param {{running:boolean, periodStartedAt:*, elapsedSecAtPause:number}} clock
 * @param {number} [nowMs] 預設用校正後的現在時間
 */
export function elapsedSec(clock, nowMs = now()) {
  if (!clock) return 0;
  const paused = Math.max(0, Number(clock.elapsedSecAtPause) || 0);
  if (!clock.running) return paused;

  const startedAt = toMillis(clock.periodStartedAt);
  if (startedAt == null) return paused;

  // 手機時間往回跳（校時、換時區）時不能算出負值，否則計時器會倒退
  return paused + Math.max(0, Math.floor((nowMs - startedAt) / 1000));
}

/** 開始或繼續計時 */
export function startClock(clock, nowMs = now()) {
  if (clock?.running) return { ...clock };
  return {
    ...emptyClock(), ...clock,
    running: true,
    periodStartedAt: new Date(nowMs),
    elapsedSecAtPause: Math.max(0, Number(clock?.elapsedSecAtPause) || 0)
  };
}

/** 暫停：把已跑的秒數固定下來 */
export function pauseClock(clock, nowMs = now()) {
  if (!clock?.running) return { ...emptyClock(), ...clock, running: false };
  return {
    ...clock,
    running: false,
    periodStartedAt: null,
    elapsedSecAtPause: elapsedSec(clock, nowMs)
  };
}

/** 換期別：秒數歸零重新算 */
export function resetClock(clock = {}) {
  return { ...emptyClock(), addedTimeSec: Number(clock.addedTimeSec) || 0, elapsedSecAtPause: 0 };
}

// ── 期別狀態機（純函式）──────────────────────────────────────

/**
 * 期別流程：pre → h1 → ht → h2 → ft，延長 ft 之前插入 et1 → et2 → pk
 * 對應 docs/02 §9.1 的 match 狀態機。
 */
export const PERIOD_FLOW = {
  pre: ['h1'],
  h1:  ['ht'],
  ht:  ['h2'],
  h2:  ['ft', 'et1'],       // 平手且 drawRule 允許時才有 et1
  et1: ['et2'],
  et2: ['ft', 'pk'],
  pk:  ['ft'],
  ft:  []
};

/**
 * 這個期別按「結束本節」之後會走到哪裡。
 *
 * ⚠️ `periods: 1`（不分上下半場）是競賽規章第十八條第 2 款的規定：
 *    「每場比賽 25 分鐘（不分上、下半場）」。六個組別都是這樣。
 *    這時候 h1 直接走到 ft，中場與下半場**整個不存在**——
 *    不是把它們藏起來，是流程上沒有這兩個狀態。
 *    賽務台如果還畫「結束上半場」，賽務會按下去，然後比賽卡在中場。
 *
 * @param {object} [opts]
 * @param {boolean} [opts.tied]
 * @param {string}  [opts.drawRule]
 * @param {number}  [opts.periods] 1 = 不分上下半場；2（預設）= 有中場
 */
export function nextPeriod(period, { tied = false, drawRule = 'penalty', periods = 2 } = {}) {
  const options = PERIOD_FLOW[period] || [];
  if (!options.length) return null;
  if (periods === 1 && period === 'h1') {
    return tied && drawRule === 'goldenGoal' ? 'et1' : 'ft';
  }
  if (period === 'h2') return tied && drawRule === 'goldenGoal' ? 'et1' : 'ft';
  if (period === 'et2') return tied && drawRule === 'penalty' ? 'pk' : 'ft';
  return options[0];
}

/** 該期別是否正在進行（計時器該跑） */
export const isPlayingPeriod = p => ['h1', 'h2', 'et1', 'et2'].includes(p);

/**
 * 期別 → 場次狀態（docs/02 §9.1）。
 * 賽務台切期別時要同步更新 status，公開端才看得出「中場」與「進行中」。
 */
export function statusForPeriod(period) {
  if (period === 'pre') return 'ready';
  if (period === 'ht') return 'halftime';
  if (period === 'ft') return 'finished';
  return 'live';
}

/**
 * 該期別的正規長度（秒），供「補時」判斷。
 *
 * `periods === 1` 時 h1 就是**整場**，不是半場。少了這個參數的話
 * 25 分鐘的比賽會在第 13 分鐘就開始顯示補時（25/2），
 * 而賽務看到補時通常就準備吹哨了。
 */
export function periodLimitSec(period, matchDurationMin = 30, etHalfMin = 5, periods = 2) {
  if (period === 'h1' && periods === 1) return matchDurationMin * 60;
  const half = Math.round(matchDurationMin / 2);
  if (period === 'h1' || period === 'h2') return half * 60;
  if (period === 'et1' || period === 'et2') return etHalfMin * 60;
  return 0;
}

/** 是否已經超過正規時間（進入補時） */
export function isInAddedTime(clock, period, matchDurationMin, periods = 2) {
  const limit = periodLimitSec(period, matchDurationMin, 5, periods);
  return limit > 0 && elapsedSec(clock) > limit;
}

// ── Ticker（需要瀏覽器）──────────────────────────────────────

/**
 * 每秒回呼一次的計時器。用 setInterval 而非 requestAnimationFrame：
 * 手機切到背景時 rAF 會停，賽務把手機收進口袋再拿出來時間就錯了；
 * setInterval 雖然也會被節流，但回到前景時我們是「重算」而不是「累加」，
 * 所以 elapsedSec() 依然正確。
 *
 * @param {() => void} onTick
 * @returns {() => void} 停止函式
 */
export function startTicker(onTick, intervalMs = 250) {
  if (typeof setInterval !== 'function') return () => {};
  const id = setInterval(onTick, intervalMs);
  const onVisible = () => { if (!document.hidden) onTick(); };
  document.addEventListener?.('visibilitychange', onVisible);
  return () => {
    clearInterval(id);
    document.removeEventListener?.('visibilitychange', onVisible);
  };
}

export function initClock() {
  // 保留給 core 啟動流程；伺服器時間校正在 firebase.js 連線後呼叫 setServerOffset()
  return { now, elapsedSec, setServerOffset };
}
