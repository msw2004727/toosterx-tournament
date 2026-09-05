/**
 * T48 場次改判的純邏輯
 * ------------------------------------------------------------------
 * 規格：docs/04 §6；競賽規章第十八條第 6 款
 *
 * 這一組是**比賽當天記錯分時唯一的補救工具**，所以守的都是
 * 「改完之後積分榜會不會算錯」：
 *   ・改比分沒重算 result → 畫面 2:1，積分卻記著對手贏
 *   ・重開沒把 lock 三個欄位寫齊 → updateDoc 整包取代，欄位靜靜消失
 *   ・棄賽比分手填 → 不同場次判法不一致，到頒獎才看得出來
 */

import {
  scoreOf, resultOf,
  canConfirm, canReopen, canOverride, canWalkover,
  buildConfirmPatch, buildReopenPatch, buildOverridePatch,
  buildWalkoverPatch, buildStatusPatch, consequencesOf,
  DECIDED_STATUSES, NOT_STARTED_STATUSES
} from '../../js/modules/admin/match-actions.js';
import { DEFAULT_WALKOVER } from '../../js/engine/tally.js';

const UID = 'u-admin';
const match = (over = {}) => ({
  matchId: 'AO-G-A-01', divisionId: 'adult-open', stageId: 'group', groupId: 'A',
  home: { teamId: 't1', name: '野狼' }, away: { teamId: 't2', name: '猛虎' },
  score: { home: 2, away: 1 }, penaltyScore: { home: null, away: null },
  status: 'finished', revisionCount: 0,
  lock: { locked: true, lockedAt: null, lockedBy: 'u-scorer' },
  result: { winner: 'home', method: 'regulation', homePoints: 3, awayPoints: 0 },
  ...over
});

describe('T48-A 比分與判定', () => {
  test('⭐ 0 是合法比分，null／字串不是（不可以用 Number()）', () => {
    expect(scoreOf(0)).toBe(0);
    expect(scoreOf(3)).toBe(3);
    expect(scoreOf(null)).toBeNull();
    expect(scoreOf('2')).toBeNull();
    expect(scoreOf(-1)).toBeNull();
    expect(scoreOf(1.5)).toBeNull();
  });

  test('勝負與積分', () => {
    expect(resultOf({ home: 2, away: 1 })).toMatchObject({ winner: 'home', homePoints: 3, awayPoints: 0 });
    expect(resultOf({ home: 1, away: 2 })).toMatchObject({ winner: 'away', homePoints: 0, awayPoints: 3 });
    expect(resultOf({ home: 1, away: 1 })).toMatchObject({ winner: 'draw', homePoints: 1, awayPoints: 1 });
  });

  test('⭐ PK 只在正規時間平手時才決定勝負', () => {
    // 反過來寫的話，2:1 但 PK 輸的那一場會被判成敗——那在足球裡不存在
    expect(resultOf({ home: 2, away: 1 }, { home: 3, away: 5 }))
      .toMatchObject({ winner: 'home', method: 'regulation' });
    expect(resultOf({ home: 1, away: 1 }, { home: 5, away: 3 }))
      .toMatchObject({ winner: 'home', method: 'penalty' });
  });

  test('PK 也平手就還是和局', () => {
    expect(resultOf({ home: 1, away: 1 }, { home: 3, away: 3 }))
      .toMatchObject({ winner: 'draw', method: 'regulation' });
  });

  test('比分缺一邊就算不出來，回 null 而不是猜', () => {
    expect(resultOf({ home: 2 })).toBeNull();
    expect(resultOf(null)).toBeNull();
  });
});

describe('T48-B 能不能做', () => {
  test('⭐ 只有已完賽的才覆核得了（跟 rules 分支 (C) 同一條界線）', () => {
    expect(canConfirm(match({ status: 'finished' })).ok).toBe(true);
    expect(canConfirm(match({ status: 'live' })).ok).toBe(false);
    expect(canConfirm(match({ status: 'confirmed' })).ok).toBe(false);
    expect(canConfirm(match({ status: 'confirmed' })).reason).toContain('已經覆核');
  });

  test('有結果的才需要重開', () => {
    for (const s of DECIDED_STATUSES) expect(canReopen(match({ status: s })).ok).toBe(true);
    expect(canReopen(match({ status: 'scheduled' })).ok).toBe(false);
    expect(canReopen(match({ status: 'live' })).ok).toBe(false);
  });

  test('⭐ 還沒開打的場次不給改判，要用賽務台記分', () => {
    for (const s of NOT_STARTED_STATUSES) {
      const r = canOverride(match({ status: s }));
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('賽務台');
    }
    expect(canOverride(match({ status: 'live' })).ok).toBe(true);
    expect(canOverride(match({ status: 'finished' })).ok).toBe(true);
  });

  test('已取消的不判棄賽', () => {
    expect(canWalkover(match({ status: 'cancelled' })).ok).toBe(false);
    expect(canWalkover(match({ status: 'scheduled' })).ok).toBe(true);
  });

  test('場次不存在時每一條都說得出原因，不是丟例外', () => {
    for (const f of [canConfirm, canReopen, canOverride, canWalkover]) {
      expect(f(null)).toMatchObject({ ok: false });
      expect(f(null).reason).toBeTruthy();
    }
  });
});

describe('T48-C 覆核與重開', () => {
  test('覆核只動 status', () => {
    expect(buildConfirmPatch(UID)).toEqual({ status: 'confirmed', updatedBy: UID });
  });

  test('⭐ 重開要把 lock 三個欄位都寫出來（updateDoc 對巢狀 map 是整包取代）', () => {
    // 少列一個就等於把它從文件上刪掉——docs/01b §1.7 有定義 lockedAt
    const p = buildReopenPatch(UID);
    expect(Object.keys(p.lock).sort()).toEqual(['locked', 'lockedAt', 'lockedBy']);
    expect(p.lock.locked).toBe(false);
  });

  test('⭐ 重開清掉結果與送出紀錄，但不碰比分（不是「這場沒發生過」）', () => {
    const p = buildReopenPatch(UID);
    expect(p).toMatchObject({ status: 'live', result: null, scoreSubmittedAt: null, scoreSubmittedBy: null });
    expect(p).not.toHaveProperty('score');
  });
});

describe('T48-D 改判比分', () => {
  test('⭐ 一定要跟著重算 result（只改 score 的話積分榜會用舊的勝負）', () => {
    const p = buildOverridePatch({ score: { home: 0, away: 3 }, match: match(), uid: UID });
    expect(p.score).toEqual({ home: 0, away: 3 });
    expect(p.result).toMatchObject({ winner: 'away', homePoints: 0, awayPoints: 3 });
  });

  test('改判次數會累加（docs/01b 的 revisionCount）', () => {
    expect(buildOverridePatch({ score: { home: 1, away: 1 }, match: match({ revisionCount: 2 }), uid: UID })
      .revisionCount).toBe(3);
    // 舊資料沒有這個欄位時從 0 開始，不是 NaN
    expect(buildOverridePatch({ score: { home: 1, away: 1 }, match: match({ revisionCount: undefined }), uid: UID })
      .revisionCount).toBe(1);
  });

  test('改判 0:0 是合法的（雙方都沒進球）', () => {
    const p = buildOverridePatch({ score: { home: 0, away: 0 }, match: match(), uid: UID });
    expect(p.result.winner).toBe('draw');
  });

  test('比分不合法就丟錯，不寫一份半成品進去', () => {
    for (const bad of [{ home: null, away: 1 }, { home: -1, away: 0 }, { home: '2', away: 1 }, null]) {
      expect(() => buildOverridePatch({ score: bad, match: match(), uid: UID })).toThrow();
    }
  });

  test('PK 只在平手時帶進 result', () => {
    const p = buildOverridePatch({
      score: { home: 1, away: 1 }, penaltyScore: { home: 4, away: 2 }, match: match(), uid: UID
    });
    expect(p.penaltyScore).toEqual({ home: 4, away: 2 });
    expect(p.result).toMatchObject({ winner: 'home', method: 'penalty' });
  });

  test('沒填 PK 時寫成 null，不是留著上一次的值', () => {
    const p = buildOverridePatch({ score: { home: 2, away: 0 }, match: match(), uid: UID });
    expect(p.penaltyScore).toEqual({ home: null, away: null });
  });

  test('⭐ 原本是棄賽的維持棄賽（棄賽的比分是規章判的）', () => {
    const p = buildOverridePatch({ score: { home: 0, away: 2 }, match: match({ status: 'walkover' }), uid: UID });
    expect(p.status).toBe('walkover');
    // 一般完賽改判之後仍是 finished（不會退回 live）
    expect(buildOverridePatch({ score: { home: 1, away: 0 }, match: match({ status: 'live' }), uid: UID }).status)
      .toBe('finished');
  });
});

describe('T48-E 判棄賽（規章第十八條第 6 款）', () => {
  test('⭐ 比分由設定算，是 0:2 不是手填', () => {
    const p = buildWalkoverPatch({ side: 'home', uid: UID });
    expect(p.score).toEqual({ home: DEFAULT_WALKOVER.scoreAgainst, away: DEFAULT_WALKOVER.scoreFor });
    expect(DEFAULT_WALKOVER.scoreFor).toBe(2);
    expect(DEFAULT_WALKOVER.scoreAgainst).toBe(0);
  });

  test('⭐ walkoverSide 記的是棄賽那一方，對手獲判勝', () => {
    const home = buildWalkoverPatch({ side: 'home', uid: UID });
    expect(home.walkoverSide).toBe('home');
    expect(home.result).toMatchObject({ winner: 'away', method: 'walkover', awayPoints: 3, homePoints: 0 });

    const away = buildWalkoverPatch({ side: 'away', uid: UID });
    expect(away.walkoverSide).toBe('away');
    expect(away.result.winner).toBe('home');
    expect(away.score).toEqual({ home: 2, away: 0 });
  });

  test('棄賽會鎖住場次，而且 lock 三個欄位齊全', () => {
    const p = buildWalkoverPatch({ side: 'home', uid: UID });
    expect(p.lock.locked).toBe(true);
    expect(Object.keys(p.lock).sort()).toEqual(['locked', 'lockedAt', 'lockedBy']);
  });

  test('沒指定哪一方就丟錯', () => {
    expect(() => buildWalkoverPatch({ uid: UID })).toThrow();
    expect(() => buildWalkoverPatch({ side: 'both', uid: UID })).toThrow();
  });

  test('設定可以覆寫（辦第二場時判法可能不同）', () => {
    const p = buildWalkoverPatch({ side: 'home', uid: UID, walkover: { scoreFor: 3, scoreAgainst: 0 } });
    expect(p.score).toEqual({ home: 0, away: 3 });
  });
});

describe('T48-F 延期與取消', () => {
  test('⭐ 不清比分（延期的場次改天要打，取消的留著紀錄）', () => {
    const p = buildStatusPatch('postponed', UID);
    expect(p.status).toBe('postponed');
    expect(p).not.toHaveProperty('score');
    expect(p).not.toHaveProperty('result');
  });

  test('時鐘停下來', () => {
    expect(buildStatusPatch('cancelled', UID).clock.running).toBe(false);
  });

  test('只收這兩個狀態', () => {
    expect(() => buildStatusPatch('live', UID)).toThrow();
    expect(() => buildStatusPatch('finished', UID)).toThrow();
  });
});

describe('T48-G 按下去之前要講的後果', () => {
  test('⭐ 重開要講「積分榜收回分數」與「晉級要等重新完賽」', () => {
    const c = consequencesOf(match(), 'reopen').join('｜');
    expect(c).toContain('收回');
    expect(c).toContain('晉級');
    expect(c).toContain('保留');
  });

  test('改判已完賽的場次要講名次可能改變', () => {
    expect(consequencesOf(match({ status: 'finished' }), 'override').join('｜')).toContain('名次');
  });

  test('⭐ 棄賽要講比分是規章判的，不是手填', () => {
    expect(consequencesOf(match(), 'walkover').join('｜')).toContain('規章');
  });

  test('每一個動作都說得出至少一句話', () => {
    for (const a of ['reopen', 'override', 'walkover', 'confirm', 'postponed', 'cancelled']) {
      expect(consequencesOf(match(), a).length).toBeGreaterThan(0);
    }
  });
});
