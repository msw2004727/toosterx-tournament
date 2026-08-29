/**
 * 比賽時鐘｜對應 docs/04 §5.2、docs/02 §9.1
 */
import {
  elapsedSec, startClock, pauseClock, resetClock, emptyClock,
  nextPeriod, statusForPeriod, isPlayingPeriod, periodLimitSec, isInAddedTime,
  setServerOffset, getServerOffset, now
} from '../../js/core/clock.js';
import { displayMinute, clockText } from '../../js/lib/format.js';

const T0 = Date.parse('2026-10-11T09:30:00+08:00');

afterEach(() => setServerOffset(0));

describe('計時基本行為', () => {
  test('未開始時是 0', () => {
    expect(elapsedSec(emptyClock(), T0)).toBe(0);
    expect(elapsedSec(null, T0)).toBe(0);
  });

  test('跑動中依現在時間累加', () => {
    const c = startClock(emptyClock(), T0);
    expect(elapsedSec(c, T0)).toBe(0);
    expect(elapsedSec(c, T0 + 63_000)).toBe(63);
  });

  test('暫停後固定秒數，時間再過也不動', () => {
    const c = pauseClock(startClock(emptyClock(), T0), T0 + 63_000);
    expect(c.running).toBe(false);
    expect(c.elapsedSecAtPause).toBe(63);
    expect(elapsedSec(c, T0 + 999_000)).toBe(63);
  });

  test('繼續後從暫停點累加', () => {
    const paused = pauseClock(startClock(emptyClock(), T0), T0 + 60_000);
    const resumed = startClock(paused, T0 + 300_000);
    expect(elapsedSec(resumed, T0 + 300_000)).toBe(60);
    expect(elapsedSec(resumed, T0 + 310_000)).toBe(70);
  });

  test('⭐ 手機時間往回跳時不可倒退（校時、換時區）', () => {
    const c = startClock({ ...emptyClock(), elapsedSecAtPause: 100 }, T0);
    expect(elapsedSec(c, T0 - 60_000)).toBe(100);   // 不是 40
  });

  test('重複按開始不會重置已跑秒數', () => {
    const c = startClock(emptyClock(), T0);
    const again = startClock(c, T0 + 30_000);
    expect(elapsedSec(again, T0 + 30_000)).toBe(30);
  });

  test('換期別歸零，但保留補時設定', () => {
    const c = resetClock({ elapsedSecAtPause: 900, addedTimeSec: 120 });
    expect(c.elapsedSecAtPause).toBe(0);
    expect(c.running).toBe(false);
    expect(c.addedTimeSec).toBe(120);
  });

  test('periodStartedAt 可以是 Firestore Timestamp 或 ISO 字串', () => {
    const iso = { running: true, periodStartedAt: '2026-10-11T09:30:00+08:00', elapsedSecAtPause: 0 };
    expect(elapsedSec(iso, T0 + 45_000)).toBe(45);
    const ts = { running: true, periodStartedAt: { toMillis: () => T0 }, elapsedSecAtPause: 0 };
    expect(elapsedSec(ts, T0 + 45_000)).toBe(45);
  });

  test('running 但缺 periodStartedAt 時退回暫停秒數，不會算出 NaN', () => {
    expect(elapsedSec({ running: true, periodStartedAt: null, elapsedSecAtPause: 12 }, T0)).toBe(12);
  });
});

describe('伺服器時間校正', () => {
  test('offset 會反映在 now()', () => {
    setServerOffset(5000);
    expect(getServerOffset()).toBe(5000);
    expect(Math.abs(now() - (Date.now() + 5000))).toBeLessThan(50);
  });

  test('離譜的 offset 一律忽略（超過一天視為資料錯誤）', () => {
    setServerOffset(48 * 3600 * 1000);
    expect(getServerOffset()).toBe(0);
    setServerOffset(NaN);
    expect(getServerOffset()).toBe(0);
  });
});

describe('期別狀態機', () => {
  test('正常流程 pre → h1 → ht → h2 → ft', () => {
    expect(nextPeriod('pre')).toBe('h1');
    expect(nextPeriod('h1')).toBe('ht');
    expect(nextPeriod('ht')).toBe('h2');
    expect(nextPeriod('h2')).toBe('ft');
    expect(nextPeriod('ft')).toBeNull();
  });

  test('平手且採 PK：延長下半之後進 PK', () => {
    expect(nextPeriod('et2', { tied: true, drawRule: 'penalty' })).toBe('pk');
    expect(nextPeriod('et2', { tied: false, drawRule: 'penalty' })).toBe('ft');
    expect(nextPeriod('pk')).toBe('ft');
  });

  test('黃金進球制才會從下半場進延長', () => {
    expect(nextPeriod('h2', { tied: true, drawRule: 'goldenGoal' })).toBe('et1');
    expect(nextPeriod('h2', { tied: true, drawRule: 'penalty' })).toBe('ft');
  });

  test('期別 → 場次狀態（公開端靠這個分辨中場與進行中）', () => {
    expect(statusForPeriod('pre')).toBe('ready');
    expect(statusForPeriod('h1')).toBe('live');
    expect(statusForPeriod('ht')).toBe('halftime');
    expect(statusForPeriod('h2')).toBe('live');
    expect(statusForPeriod('et1')).toBe('live');
    expect(statusForPeriod('ft')).toBe('finished');
  });

  test('只有比賽進行中的期別要跑計時器', () => {
    expect(['h1', 'h2', 'et1', 'et2'].every(isPlayingPeriod)).toBe(true);
    expect(['pre', 'ht', 'pk', 'ft'].some(isPlayingPeriod)).toBe(false);
  });
});

describe('顯示分鐘（不可寫死 45/90）', () => {
  test('成人組 30 分鐘：上半場 15 分、下半場從 15 分起算', () => {
    expect(displayMinute(0, 'h1', 30)).toBe("0'");
    expect(displayMinute(14 * 60, 'h1', 30)).toBe("14'");
    expect(displayMinute(15 * 60, 'h1', 30)).toBe("15'");
    expect(displayMinute(0, 'h2', 30)).toBe("15'");
    expect(displayMinute(14 * 60, 'h2', 30)).toBe("29'");
  });

  test('兒童組 20 分鐘：下半場從 10 分起算', () => {
    expect(displayMinute(0, 'h2', 20)).toBe("10'");
    expect(displayMinute(9 * 60, 'h2', 20)).toBe("19'");
  });

  test('⭐ 補時顯示 15+2 而不是 17（且分界依 matchDurationMin）', () => {
    expect(displayMinute(17 * 60, 'h1', 30)).toBe("15+2'");
    expect(displayMinute(11 * 60, 'h1', 20)).toBe("10+1'");
    expect(displayMinute(17 * 60, 'h2', 30)).toBe("30+2'");   // 下半場自己的第 17 分鐘
  });

  test('90 分鐘制沿用同一套公式，得到熟悉的 45+3', () => {
    expect(displayMinute(48 * 60, 'h1', 90)).toBe("45+3'");
    expect(displayMinute(0, 'h2', 90)).toBe("45'");
  });

  test('非比賽期別不顯示分鐘', () => {
    expect(displayMinute(0, 'pre', 30)).toBe('');
    expect(displayMinute(0, 'pk', 30)).toBe('');
  });

  test('計時器文字是等寬的 mm:ss', () => {
    expect(clockText(0)).toBe('00:00');
    expect(clockText(63)).toBe('01:03');
    expect(clockText(3784)).toBe('63:04');
    expect(clockText(-5)).toBe('00:00');
  });
});

describe('補時判斷', () => {
  test('各期別的正規長度依 matchDurationMin 推算', () => {
    expect(periodLimitSec('h1', 30)).toBe(900);
    expect(periodLimitSec('h2', 20)).toBe(600);
    expect(periodLimitSec('et1', 30, 5)).toBe(300);
    expect(periodLimitSec('ht', 30)).toBe(0);
  });

  test('超過正規時間才算進入補時', () => {
    const at = sec => ({ running: false, elapsedSecAtPause: sec });
    expect(isInAddedTime(at(899), 'h1', 30)).toBe(false);
    expect(isInAddedTime(at(901), 'h1', 30)).toBe(true);
    expect(isInAddedTime(at(9999), 'ht', 30)).toBe(false);
  });
});
