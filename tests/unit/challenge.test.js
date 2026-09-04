/**
 * T46 挑戰系統引擎
 * ------------------------------------------------------------------
 * 規格：docs/06 §2、§6、§7；驗收 C04／C05／C07／C08／C09
 *
 * 三件最容易靜靜出錯的事：
 *   1. **`rankingRule: 'lower'`**（時間型，越小越好）目前五關都沒用到，
 *      但驗收 C09 要求。沒有人用的分支最容易寫錯又最不會被發現——
 *      所以每一個比較、排序、取最佳都同時測兩個方向。
 *   2. **0 分是合法成績**。用 `Number(null)` 取值的話「沒登錄」會變成 0 分，
 *      那個人就會出現在排行榜最後一名（R-ENG-002）。
 *   3. **作廢之後要退回次佳**（C07）。忘了濾掉 voided，一筆被作廢的
 *      最佳成績會永遠掛在榜首。
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  numOf, formatScore, rankingOf, isBetter,
  validateScore, sumShots, validateLadder,
  attemptMs, pickBest, diffBestFlags, attemptQuota,
  buildLeaderboard, myRank, drawEntries, nextCompleted,
  formatPlayerId, normalizePlayerId, DEFAULT_RANKING
} from '../../js/engine/challenge.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 橫樑：0–5 次，越多越好 */
const CROSSBAR = {
  challengeId: 'g03-crossbar', scoreType: 'count', unit: '次',
  rankingRule: 'higher', decimals: 0, minValue: 0, maxValue: 5,
  attemptPolicy: { maxAttemptsPerPlayer: 3, allowRepeat: true, rankBy: 'best' }
};
/** 九宮格：五球加總 */
const NINE = {
  challengeId: 'g01-nine-grid', scoreType: 'points', unit: '分',
  rankingRule: 'higher', decimals: 0, minValue: 0, maxValue: 15,
  inputMode: 'shots', shotCount: 5, shotOptions: [0, 1, 2, 3],
  attemptPolicy: { maxAttemptsPerPlayer: 3, rankBy: 'best' }
};
/** 頭球：階梯 */
const HEADER = {
  challengeId: 'g02-header-king', scoreType: 'height', unit: 'cm',
  rankingRule: 'higher', decimals: 0, minValue: 150, maxValue: 260,
  inputMode: 'ladder', ladderSteps: [180, 190, 200, 205, 210, 215, 220],
  attemptPolicy: { maxAttemptsPerPlayer: 2, rankBy: 'best' }
};
/** 未來的盤球障礙賽：時間，越小越好（驗收 C09） */
const DRIBBLE = {
  challengeId: 'gx-dribble', scoreType: 'time', unit: '秒',
  rankingRule: 'lower', decimals: 1, minValue: 5, maxValue: 120,
  attemptPolicy: { rankBy: 'best' }
};

const T = s => Date.parse(`2026-10-11T${s}:00+08:00`);
const att = (id, playerId, rawValue, hhmm, over = {}) => ({
  attemptId: id, playerId, rawValue, attemptAt: T(hhmm), voided: false, ...over
});

// ══════════════════════════════════════════════════════════════════

describe('T46-A 數值與顯示', () => {
  test('⭐ 0 是合法成績，null／空字串不是（不可以用 Number()）', () => {
    // Number(null) 是 0、Number('') 也是 0——「沒登錄」會變成 0 分，
    // 那個人就出現在排行榜最後一名
    expect(numOf(0)).toBe(0);
    expect(numOf(null)).toBeNull();
    expect(numOf('')).toBeNull();
    expect(numOf('3')).toBeNull();
    expect(numOf(undefined)).toBeNull();
    expect(numOf(NaN)).toBeNull();
    expect(numOf(Infinity)).toBeNull();
  });

  test('顯示值帶單位與小數位', () => {
    expect(formatScore(3, CROSSBAR)).toBe('3次');
    expect(formatScore(0, CROSSBAR)).toBe('0次');
    expect(formatScore(12.34, DRIBBLE)).toBe('12.3秒');
    expect(formatScore(205, HEADER)).toBe('205cm');
  });

  test('沒有成績顯示破折號，不是 0 也不是 undefined', () => {
    expect(formatScore(null, CROSSBAR)).toBe('—');
    expect(formatScore(undefined, CROSSBAR)).toBe('—');
  });

  test('小數位有上下限，設定亂填也不會炸', () => {
    expect(formatScore(1.23456, { unit: '', decimals: 99 })).toBe('1.235');
    expect(formatScore(1.5, { unit: '', decimals: -3 })).toBe('2');
    expect(formatScore(1.5, { unit: '' })).toBe('2');
  });
});

describe('T46-B 排序方向（驗收 C09）', () => {
  test('設定寫什麼就用什麼', () => {
    expect(rankingOf(CROSSBAR)).toBe('higher');
    expect(rankingOf(DRIBBLE)).toBe('lower');
  });

  test('⭐ 沒寫時依成績型態推，time 是唯一「越小越好」的', () => {
    expect(rankingOf({ scoreType: 'time' })).toBe('lower');
    expect(rankingOf({ scoreType: 'speed' })).toBe('higher');
    expect(DEFAULT_RANKING.time).toBe('lower');
  });

  test('完全讀不到設定時當 higher，不要當成 lower', () => {
    // 猜錯方向的後果是「最差的排第一」，而且看起來完全正常
    expect(rankingOf(null)).toBe('higher');
    expect(rankingOf({ scoreType: '不認得的型態' })).toBe('higher');
  });

  test('⭐ isBetter 兩個方向都要對', () => {
    expect(isBetter(5, 3, 'higher')).toBe(true);
    expect(isBetter(3, 5, 'higher')).toBe(false);
    expect(isBetter(3, 5, 'lower')).toBe(true);
    expect(isBetter(5, 3, 'lower')).toBe(false);
  });

  test('平手不算比較好（同分要靠時間分先後，不是靠比較）', () => {
    expect(isBetter(3, 3, 'higher')).toBe(false);
    expect(isBetter(3, 3, 'lower')).toBe(false);
  });

  test('沒有值的一方一定輸；兩邊都沒有值也不算贏', () => {
    expect(isBetter(null, 3, 'higher')).toBe(false);
    expect(isBetter(3, null, 'higher')).toBe(true);
    expect(isBetter(null, null, 'higher')).toBe(false);
    // 0 分要贏過「沒成績」——這是 numOf 那條規矩的下游
    expect(isBetter(0, null, 'higher')).toBe(true);
  });
});

describe('T46-C 成績驗證', () => {
  test('範圍內通過、範圍外擋下', () => {
    expect(validateScore(3, CROSSBAR).ok).toBe(true);
    expect(validateScore(0, CROSSBAR).ok).toBe(true);
    expect(validateScore(5, CROSSBAR).ok).toBe(true);
    expect(validateScore(6, CROSSBAR).ok).toBe(false);
    expect(validateScore(-1, CROSSBAR).ok).toBe(false);
  });

  test('⭐ 關卡沒有設定上下限一律擋下（fail-closed）', () => {
    // 沒有防呆的話，一個手滑的 8500 km/h 會永遠掛在排行榜第一名
    expect(validateScore(3, { unit: '次' }).ok).toBe(false);
    expect(validateScore(3, { minValue: 0, unit: '次' }).ok).toBe(false);
    expect(validateScore(3, null).ok).toBe(false);

    // ⭐ **0 分是這條守衛唯一擋得住的情況**，一定要測。
    //    拿掉 `min == null || max == null` 之後，下一行的 `n < min || n > max`
    //    會把 null 當成 0：3 分因為 `3 > 0` 還是被擋下來（看起來守衛沒用），
    //    但 0 分的 `0 < 0` 與 `0 > 0` 都是 false —— 直接放行。
    //    而 0 分是九宮格與橫樑的合法成績，這個 fail-open 真的會發生。
    //    變異 #CH4 就是在守這件事（第一版用 3 分測，抓不到）。
    expect(validateScore(0, { unit: '分' }).ok).toBe(false);
    expect(validateScore(0, { minValue: 0, unit: '分' }).ok).toBe(false);
    expect(validateScore(0, { maxValue: 15, unit: '分' }).ok).toBe(false);
    // 有完整設定時 0 分當然要收
    expect(validateScore(0, { minValue: 0, maxValue: 15, unit: '分' }).ok).toBe(true);
  });

  test('沒輸入成績時說得出原因', () => {
    expect(validateScore(null, CROSSBAR).reason).toContain('還沒有輸入');
  });

  test('⭐ 界線跟 firestore.rules 的 validChallengeScore() 一致', () => {
    // 畫面說可以送、規則擋下來，對攤位工作人員來說就是系統壞了
    const rules = fs.readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
    expect(rules).toContain('v >= c.minValue && v <= c.maxValue');
    // 規則是閉區間，引擎也要是閉區間
    expect(validateScore(CROSSBAR.minValue, CROSSBAR).ok).toBe(true);
    expect(validateScore(CROSSBAR.maxValue, CROSSBAR).ok).toBe(true);
  });
});

describe('T46-D shots 與 ladder', () => {
  test('五球加總', () => {
    expect(sumShots([3, 0, 2, 1, 3], NINE)).toMatchObject({ ok: true, total: 9 });
    expect(sumShots([0, 0, 0, 0, 0], NINE)).toMatchObject({ ok: true, total: 0 });
  });

  test('球數不對、有球沒選、選了不在選項裡的值都擋下', () => {
    expect(sumShots([3, 0, 2], NINE).ok).toBe(false);
    expect(sumShots([3, 0, 2, 1, null], NINE).ok).toBe(false);
    expect(sumShots([3, 0, 2, 1, 9], NINE).ok).toBe(false);
    expect(sumShots(null, NINE).ok).toBe(false);
  });

  test('關卡沒設定球數就擋下', () => {
    expect(sumShots([1, 2], { shotOptions: [0, 1, 2] }).ok).toBe(false);
  });

  test('ladder 只收階梯上的高度', () => {
    expect(validateLadder(205, HEADER).ok).toBe(true);
    expect(validateLadder(206, HEADER).ok).toBe(false);
    expect(validateLadder(null, HEADER).ok).toBe(false);
    expect(validateLadder(205, { ladderSteps: [] }).ok).toBe(false);
  });
});

describe('T46-E 最佳成績', () => {
  const list = [
    att('a1', 'p1', 2, '10:00'),
    att('a2', 'p1', 4, '10:10'),
    att('a3', 'p1', 3, '10:20')
  ];

  test('best 取最好的一次', () => {
    expect(pickBest(list, CROSSBAR)).toMatchObject({ value: 4, count: 3 });
    expect(pickBest(list, CROSSBAR).attempt.attemptId).toBe('a2');
  });

  test('⭐ lower 的關卡取最小的（驗收 C09）', () => {
    expect(pickBest(list, DRIBBLE).attempt.attemptId).toBe('a1');
    expect(pickBest(list, DRIBBLE).value).toBe(2);
  });

  test('⭐ 同成績時較早那一次算數（§5.3）', () => {
    const tie = [att('late', 'p1', 5, '11:00'), att('early', 'p1', 5, '09:00')];
    expect(pickBest(tie, CROSSBAR).attempt.attemptId).toBe('early');
  });

  test('⭐ 作廢的不算，最佳要退回次佳（驗收 C07）', () => {
    const voided = [...list.slice(0, 2).map(a => a.attemptId === 'a2' ? { ...a, voided: true } : a), list[2]];
    expect(pickBest(voided, CROSSBAR).value).toBe(3);
    expect(pickBest(voided, CROSSBAR).count).toBe(2);
  });

  test('rankBy first / last / sum', () => {
    const f = { ...CROSSBAR, attemptPolicy: { rankBy: 'first' } };
    const l = { ...CROSSBAR, attemptPolicy: { rankBy: 'last' } };
    const s = { ...CROSSBAR, attemptPolicy: { rankBy: 'sum' } };
    expect(pickBest(list, f).value).toBe(2);
    expect(pickBest(list, l).value).toBe(3);
    expect(pickBest(list, s).value).toBe(9);
  });

  test('一筆都沒有時回 null，不是 0', () => {
    expect(pickBest([], CROSSBAR)).toMatchObject({ value: null, attempt: null, count: 0 });
    expect(pickBest(null, CROSSBAR).value).toBeNull();
  });

  test('⭐ 還沒同步的紀錄（時間戳 null）排最後，不會插到已確定的成績前面', () => {
    const pending = [att('sync', 'p1', 5, '10:00'), { attemptId: 'q', playerId: 'p1', rawValue: 5, attemptAt: null, voided: false }];
    expect(pickBest(pending, CROSSBAR).attempt.attemptId).toBe('sync');
  });

  test('attemptMs 吃得下 Timestamp／Date／數字', () => {
    expect(attemptMs({ attemptAt: 1000 })).toBe(1000);
    expect(attemptMs({ attemptAt: new Date(2000) })).toBe(2000);
    expect(attemptMs({ attemptAt: { seconds: 3, nanoseconds: 500e6 } })).toBe(3500);
    expect(attemptMs({ createdAt: { toMillis: () => 4000 } })).toBe(4000);
    expect(attemptMs({})).toBeNull();
  });
});

describe('T46-F isBest 旗標', () => {
  test('只回傳需要改的那幾筆', () => {
    const list = [
      att('a1', 'p1', 2, '10:00', { isBest: true }),
      att('a2', 'p1', 4, '10:10', { isBest: false })
    ];
    expect(diffBestFlags(list, CROSSBAR)).toEqual([
      { attemptId: 'a1', isBest: false },
      { attemptId: 'a2', isBest: true }
    ]);
  });

  test('已經對的就不寫（不必要的寫入會白白觸發下游重算）', () => {
    const list = [
      att('a1', 'p1', 2, '10:00', { isBest: false }),
      att('a2', 'p1', 4, '10:10', { isBest: true })
    ];
    expect(diffBestFlags(list, CROSSBAR)).toEqual([]);
  });

  test('⭐ 作廢的一律不是 best', () => {
    const list = [att('a1', 'p1', 5, '10:00', { isBest: true, voided: true })];
    expect(diffBestFlags(list, CROSSBAR)).toEqual([{ attemptId: 'a1', isBest: false }]);
  });
});

describe('T46-G 次數限制', () => {
  const three = [att('a1', 'p1', 1, '10:00'), att('a2', 'p1', 2, '10:05'), att('a3', 'p1', 3, '10:10')];

  test('用掉幾次、上限幾次都說得出來', () => {
    expect(attemptQuota(three, CROSSBAR)).toMatchObject({ used: 3, max: 3, exhausted: true });
    expect(attemptQuota(three.slice(0, 1), CROSSBAR).text).toBe('已挑戰 1 / 3 次');
  });

  test('⭐ maxAttemptsPerPlayer 是 null 代表不限，不是 0 次', () => {
    const free = { ...CROSSBAR, attemptPolicy: { maxAttemptsPerPlayer: null } };
    expect(attemptQuota(three, free)).toMatchObject({ max: null, exhausted: false });
    expect(attemptQuota(three, free).text).toBe('已挑戰 3 次');
  });

  test('沒有 attemptPolicy 也當不限', () => {
    expect(attemptQuota(three, { challengeId: 'x' }).exhausted).toBe(false);
  });

  test('作廢的不佔次數', () => {
    const withVoid = [...three, att('a4', 'p1', 4, '10:15', { voided: true })];
    expect(attemptQuota(withVoid, CROSSBAR).used).toBe(3);
  });
});

describe('T46-H 排行榜', () => {
  const players = {
    p1: { nickname: '阿哲', ageBand: 'adult' },
    p2: { nickname: 'Kevin', ageBand: 'youth' },
    p3: { nickname: '小明', ageBand: 'child' }
  };
  const attempts = [
    att('a1', 'p1', 4, '10:00'),
    att('a2', 'p1', 2, '10:30'),
    att('a3', 'p2', 5, '11:00'),
    att('a4', 'p3', 3, '09:00')
  ];

  test('每位玩家一列，取其計分成績', () => {
    const { rows, totalPlayers } = buildLeaderboard({ attempts, challenge: CROSSBAR, players });
    expect(totalPlayers).toBe(3);
    expect(rows.map(r => [r.rank, r.nickname, r.value])).toEqual([
      [1, 'Kevin', 5], [2, '阿哲', 4], [3, '小明', 3]
    ]);
    expect(rows[0].displayValue).toBe('5次');
    expect(rows[1].attempts).toBe(2);
  });

  test('⭐ 同成績依較早達成排前（§5.3）', () => {
    const tie = [att('x', 'p1', 3, '11:00'), att('y', 'p2', 3, '09:00')];
    const { rows } = buildLeaderboard({ attempts: tie, challenge: CROSSBAR, players });
    expect(rows.map(r => r.playerId)).toEqual(['p2', 'p1']);
    // 名次逐一遞增，不做並列——同分已經用時間分出先後了
    expect(rows.map(r => r.rank)).toEqual([1, 2]);
  });

  test('⭐ lower 的關卡整張榜要反過來排（驗收 C09）', () => {
    const { rows } = buildLeaderboard({ attempts, challenge: DRIBBLE, players });
    expect(rows.map(r => r.value)).toEqual([2, 3, 5]);
  });

  test('⭐ 作廢之後榜上要跟著退（驗收 C07）', () => {
    const voided = attempts.map(a => a.attemptId === 'a3' ? { ...a, voided: true } : a);
    const { rows, totalPlayers } = buildLeaderboard({ attempts: voided, challenge: CROSSBAR, players });
    expect(totalPlayers).toBe(2);
    expect(rows[0].nickname).toBe('阿哲');
  });

  test('topN 只截清單，totalPlayers 仍是完整人數（自己不在前 50 時要算得出名次）', () => {
    const { rows, totalPlayers } = buildLeaderboard({ attempts, challenge: CROSSBAR, players, topN: 1 });
    expect(rows).toHaveLength(1);
    expect(totalPlayers).toBe(3);
  });

  test('查不到玩家資料時仍然上榜，暱稱留 null（不要讓一筆成績消失）', () => {
    const { rows } = buildLeaderboard({ attempts, challenge: CROSSBAR, players: {} });
    expect(rows).toHaveLength(3);
    expect(rows[0].nickname).toBeNull();
  });

  test('空的榜不會炸', () => {
    expect(buildLeaderboard({}).rows).toEqual([]);
    expect(buildLeaderboard({ attempts: [], challenge: CROSSBAR }).totalPlayers).toBe(0);
  });

  test('myRank 找得到自己那一列，找不到回 null', () => {
    const { rows } = buildLeaderboard({ attempts, challenge: CROSSBAR, players });
    expect(myRank(rows, 'p1').rank).toBe(2);
    expect(myRank(rows, '不存在')).toBeNull();
  });
});

describe('T46-I 抽獎資格', () => {
  const rewards = { entriesPerCompletion: 1, bonusAllComplete: 2, maxEntriesPerPlayer: 10 };

  test('完成一關一張', () => {
    expect(drawEntries({ completedChallengeIds: ['a', 'b'], challengeTotal: 5, rewards }))
      .toMatchObject({ entries: 2, fromCompletion: 2, bonus: 0, allComplete: false });
  });

  test('五關全破多兩張', () => {
    expect(drawEntries({ completedChallengeIds: ['a', 'b', 'c', 'd', 'e'], challengeTotal: 5, rewards }))
      .toMatchObject({ entries: 7, bonus: 2, allComplete: true });
  });

  test('上限會生效', () => {
    const capped = { ...rewards, entriesPerCompletion: 5, maxEntriesPerPlayer: 6 };
    expect(drawEntries({ completedChallengeIds: ['a', 'b'], challengeTotal: 5, rewards: capped }).entries).toBe(6);
  });

  test('⭐ 讀不到設定回 0，不猜一個預設值（多發的抽獎券收不回來）', () => {
    expect(drawEntries({ completedChallengeIds: ['a'], challengeTotal: 5, rewards: null }).entries).toBe(0);
    expect(drawEntries({}).entries).toBe(0);
  });

  test('重複的關卡代碼不會重複計數', () => {
    expect(drawEntries({ completedChallengeIds: ['a', 'a', 'b'], challengeTotal: 5, rewards }).entries).toBe(2);
  });

  test('關卡總數是 0 時不算全破（不然還沒設定關卡就先發全破獎）', () => {
    expect(drawEntries({ completedChallengeIds: [], challengeTotal: 0, rewards }).allComplete).toBe(false);
  });

  test('⭐ 首次完成才加進清單，重複挑戰不會多給券', () => {
    expect(nextCompleted(['a'], 'b')).toEqual(['a', 'b']);
    expect(nextCompleted(['a', 'b'], 'b')).toBeNull();
    expect(nextCompleted(null, 'a')).toEqual(['a']);
    expect(nextCompleted(['a'], null)).toBeNull();
  });
});

describe('T46-J 玩家識別碼', () => {
  test('補零到四位', () => {
    expect(formatPlayerId(182)).toBe('FEDA-0182');
    expect(formatPlayerId(1)).toBe('FEDA-0001');
    expect(formatPlayerId(12345)).toBe('FEDA-12345');
  });

  test('非整數丟錯，不產生一個看起來正常的爛 ID', () => {
    expect(() => formatPlayerId(1.5)).toThrow(RangeError);
    expect(() => formatPlayerId(-1)).toThrow(RangeError);
    expect(() => formatPlayerId('182')).toThrow(RangeError);
  });

  test('⭐ 手動輸入要接得住各種寫法（QR 掃不到時就靠這個）', () => {
    for (const input of ['FEDA-0182', 'feda-0182', 'FEDA0182', '182', ' 0182 ', 'feda 0182']) {
      expect(normalizePlayerId(input)).toBe('FEDA-0182');
    }
  });

  test('亂輸入回 null，不要猜一個 ID 出來', () => {
    expect(normalizePlayerId('')).toBeNull();
    expect(normalizePlayerId('abc')).toBeNull();
    expect(normalizePlayerId('FEDA-')).toBeNull();
    expect(normalizePlayerId(null)).toBeNull();
    expect(normalizePlayerId('12345678')).toBeNull();
  });
});
