/**
 * T41 檢錄
 * ------------------------------------------------------------------
 * 規格：競賽規章第十八條第 3 款、docs/04 §4、docs/01b §1.12
 *
 * 「應於賽前 30 分鐘至大會檢錄，如有冒名頂替者立即停止該球隊繼續比賽
 *   資格，已賽成績不予計算。」——罰則是取消整隊，所以檢錄的紀錄要
 * 經得起事後查核：誰在幾點確認了誰出賽，取消也要留痕。
 */

import {
  buildCheckin, checkinSummary, presentIds, readyToStart, CHECKIN_RESULTS,
  requiredMinOf, checkinGate, buildCheckinConfirmPatch
} from '../../js/modules/staff/checkin-actions.js';

const P = (memberId, over = {}) => ({
  memberId, displayName: '小豆子', jerseyNo: 9, role: 'player',
  birthRoc: '106/03/05', idLast4: '1234', ...over
});

describe('T41-1 建立一筆檢錄', () => {
  test('文件 id 是 matchId__memberId（同場同人天然只有一筆）', () => {
    const d = buildCheckin({ matchId: 'U10-G-A-01', teamId: 't-1', member: P('m-1'), result: 'pass', uid: 'u-x' });
    expect(d.checkinId).toBe('U10-G-A-01__m-1');
    expect(d.matchId).toBe('U10-G-A-01');
    expect(d.memberId).toBe('m-1');
  });

  test('⭐ 不呼叫 Date.now()，時間戳由寫入層填（R-ENG-004）', () => {
    const d = buildCheckin({ matchId: 'M1', teamId: 't-1', member: P('m-1'), result: 'pass', uid: 'u-x' });
    expect(d.scannedAt).toBeUndefined();
    expect(d.syncedAt).toBeUndefined();
    // 同樣的輸入永遠產生同樣的輸出——離線佇列要能重放
    expect(d).toEqual(buildCheckin({ matchId: 'M1', teamId: 't-1', member: P('m-1'), result: 'pass', uid: 'u-x' }));
  });

  test('⭐ 記下是誰確認的（罰則是取消整隊，紀錄要查得到人）', () => {
    const d = buildCheckin({ matchId: 'M1', teamId: 't-1', member: P('m-1'), result: 'pass', uid: 'u-vol' });
    expect(d.scannedBy).toBe('u-vol');
  });

  test('學童組是用眼睛核對證件，method 是 manual 不是 qr', () => {
    const d = buildCheckin({ matchId: 'M1', teamId: 't-1', member: P('m-1'), result: 'pass', uid: 'u-x' });
    expect(d.method).toBe('manual');
  });

  test('⭐ 不認得的 result 一律變成 null，不會存進奇怪的狀態', () => {
    for (const r of ['ok', 'PASS', true, 1, {}, undefined]) {
      const d = buildCheckin({ matchId: 'M1', teamId: 't-1', member: P('m-1'), result: r, uid: 'u-x' });
      expect(d.result).toBeNull();
    }
    expect(CHECKIN_RESULTS).toEqual(['pass', 'fail']);
  });

  test('標「有問題」時不猜原因，只記下沒過', () => {
    const d = buildCheckin({ matchId: 'M1', teamId: 't-1', member: P('m-1'), result: 'fail', uid: 'u-x' });
    expect(d.result).toBe('fail');
    expect(d.failReason).toBe('MANUAL_FLAG');
    // 通過的那筆不留 failReason
    const ok = buildCheckin({ matchId: 'M1', teamId: 't-1', member: P('m-1'), result: 'pass', uid: 'u-x' });
    expect(ok.failReason).toBeNull();
  });

  test('存的是名冊上的顯示名（學童組就是暱稱），拿不到真名', () => {
    const d = buildCheckin({ matchId: 'M1', teamId: 't-1', member: P('m-1'), result: 'pass', uid: 'u-x' });
    expect(d.memberName).toBe('小豆子');
    expect(d.idLast4).toBeUndefined();      // 核對用的東西不必再抄一份進紀錄
    expect(d.birthDate).toBeUndefined();
  });
});

describe('T41-2 進度統計', () => {
  const roster = [P('m-1'), P('m-2'), P('m-3'), P('s-1', { role: 'coach' }), P('s-2', { role: 'leader' })];

  test('⭐ 分母只算球員，不算隊職員', () => {
    // 把領隊教練算進分母，「3 / 5」會讓檢錄員一直找那兩個不存在的人
    expect(checkinSummary(roster, {}).total).toBe(3);
  });

  test('數已通過與有問題的筆數', () => {
    const c = {
      'm-1': { result: 'pass' },
      'm-2': { result: 'fail' },
      's-1': { result: 'pass' }        // 隊職員被勾了也不算進球員進度
    };
    expect(checkinSummary(roster, c)).toEqual({ total: 3, present: 1, failed: 1 });
  });

  test('沒有 role 的舊資料當成球員', () => {
    expect(checkinSummary([{ memberId: 'x' }], {}).total).toBe(1);
  });

  test('名冊是空的或壞掉時不會爆', () => {
    expect(checkinSummary(null, {})).toEqual({ total: 0, present: 0, failed: 0 });
    expect(checkinSummary([], undefined)).toEqual({ total: 0, present: 0, failed: 0 });
  });
});

describe('T41-3 已確認出賽的名單', () => {
  test('照名冊順序（背號），不是勾選順序', () => {
    const roster = [P('m-1', { jerseyNo: 3 }), P('m-2', { jerseyNo: 7 }), P('m-3', { jerseyNo: 9 })];
    const c = { 'm-3': { result: 'pass' }, 'm-1': { result: 'pass' } };
    expect(presentIds(roster, c)).toEqual(['m-1', 'm-3']);
  });

  test('標有問題的不算出賽', () => {
    const roster = [P('m-1'), P('m-2')];
    expect(presentIds(roster, { 'm-1': { result: 'fail' } })).toEqual([]);
  });
});

describe('T41-4 開賽人數（fail-closed）', () => {
  test('⭐ 讀不到門檻一律不放行，而且說得出原因', () => {
    // 「沒設定就當作通過」在人數不足時會默默放行，
    // 而規章第十八條第 6 款對不出場的處理是棄權論 0:2。
    for (const v of [null, undefined, NaN, '5', Infinity]) {
      const r = readyToStart({ total: 10, present: 9, failed: 0 }, v);
      expect(r.ready).toBe(false);
      expect(r.reason).toContain('門檻');
    }
  });

  test('人數不足時說清楚差幾個', () => {
    const r = readyToStart({ total: 10, present: 4, failed: 0 }, 5);
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('4');
    expect(r.reason).toContain('5');
  });

  test('剛好到門檻就放行', () => {
    expect(readyToStart({ total: 10, present: 5, failed: 0 }, 5).ready).toBe(true);
  });
});

// ── 第三輪驗收（2026-09-07，檢錄員 C-5）：一個人也能「完成檢錄」──────────
// 真實的場次文件沒有 requiredMin，門檻要從組別設定來；而完成鈕原本從來沒有問過門檻。

describe('T41-5 完成檢錄的門檻', () => {
  test('⭐ 優先序：場次 requiredMin → 組別 minPlayersToStart → 組別 playersOnField', () => {
    expect(requiredMinOf({ match: { checkin: { requiredMin: 4 } }, division: { minPlayersToStart: 3, playersOnField: 5 } })).toBe(4);
    expect(requiredMinOf({ match: { checkin: {} }, division: { minPlayersToStart: 3, playersOnField: 5 } })).toBe(3);
    // 真實資料：場次只有 homeConfirmed／awayConfirmed／confirmedAt，門檻落到規章第十五條的上場人數
    expect(requiredMinOf({
      match: { checkin: { homeConfirmed: false, awayConfirmed: false, confirmedAt: null } },
      division: { playersOnField: 5 }
    })).toBe(5);
  });

  test('⭐ 三個都讀不到就是 null（fail-closed），不是 0', () => {
    expect(requiredMinOf({ match: {}, division: {} })).toBeNull();
    expect(requiredMinOf({})).toBeNull();
    expect(requiredMinOf()).toBeNull();
    for (const bad of ['5', 0, -1, NaN, Infinity, null, undefined]) {
      expect(requiredMinOf({ match: { checkin: { requiredMin: bad } }, division: { playersOnField: bad } })).toBeNull();
    }
  });

  test('⭐ 人數不足：檢錄員按不下去，而且說得出差幾人', () => {
    const g = checkinGate({ summary: { total: 8, present: 1, failed: 0 }, requiredMin: 5 });
    expect(g.allowed).toBe(false);
    expect(g.short).toBe(true);
    expect(g.missing).toBe(4);
    expect(g.needsReason).toBe(false);
  });

  test('⭐ 人數不足：管理員可以放行，但一定要填原因', () => {
    const g = checkinGate({ summary: { total: 8, present: 1, failed: 0 }, requiredMin: 5, canForce: true });
    expect(g.allowed).toBe(true);
    expect(g.short).toBe(true);
    expect(g.needsReason).toBe(true);
    expect(g.missing).toBe(4);
  });

  test('⭐ 門檻讀不到時連管理員也不放行（那是設定壞了，要先修設定）', () => {
    const g = checkinGate({ summary: { total: 8, present: 8, failed: 0 }, requiredMin: null, canForce: true });
    expect(g.allowed).toBe(false);
    expect(g.needsReason).toBe(false);
    expect(g.missing).toBeNull();
    expect(g.reason).toContain('門檻');
  });

  test('人數夠就不必填原因，管理員也一樣', () => {
    expect(checkinGate({ summary: { total: 8, present: 5, failed: 3 }, requiredMin: 5, canForce: true }))
      .toEqual({ allowed: true, short: false, missing: 0, reason: '', needsReason: false });
    expect(checkinGate({ summary: { total: 8, present: 5, failed: 0 }, requiredMin: 5 }).allowed).toBe(true);
  });
});

describe('T41-6 完成檢錄寫回場次', () => {
  const m = (over = {}) => ({
    status: 'scheduled',
    checkin: { homeConfirmed: false, awayConfirmed: false, confirmedAt: null },
    ...over
  });

  test('⭐ 第一隊完成 → 狀態進入檢錄中；另一隊的旗標原封不動（updateDoc 對巢狀 map 是整包取代）', () => {
    const p = buildCheckinConfirmPatch({ match: m(), side: 'home', uid: 'u1', present: 5, stamp: 'T' });
    expect(p.status).toBe('checkin');
    expect(p.checkin.homeConfirmed).toBe(true);
    expect(p.checkin.awayConfirmed).toBe(false);
    expect(p.checkin.homeConfirmedBy).toBe('u1');
    expect(p.checkin.homeConfirmedAt).toBe('T');
    expect(p.checkin.homePresent).toBe(5);
    expect(p.checkin.homeForcedReason).toBeNull();
    expect(p.checkin.confirmedAt).toBeNull();
  });

  test('⭐ 兩隊都完成 → 待開賽，confirmedAt 這時才填', () => {
    const prev = m({ status: 'checkin', checkin: { homeConfirmed: true, awayConfirmed: false, confirmedAt: null, homeConfirmedBy: 'u0' } });
    const p = buildCheckinConfirmPatch({ match: prev, side: 'away', uid: 'u1', present: 5, stamp: 'T' });
    expect(p.status).toBe('ready');
    expect(p.checkin.confirmedAt).toBe('T');
    expect(p.checkin.homeConfirmedBy).toBe('u0');   // 主隊那一邊的留痕不能被洗掉
    expect(p.checkin.awayConfirmedBy).toBe('u1');
  });

  test('⭐ 已開打的場次不動狀態（規則對那些狀態只放行 from == to）', () => {
    for (const s of ['live', 'halftime', 'finished', 'confirmed']) {
      expect(buildCheckinConfirmPatch({ match: m({ status: s }), side: 'home', uid: 'u1', present: 5 }).status).toBe(s);
    }
  });

  test('場次沒有 status 欄位時 patch 裡也不放 status（updateDoc 不吃 undefined）', () => {
    const p = buildCheckinConfirmPatch({ match: { checkin: {} }, side: 'home', uid: 'u1', present: 5 });
    expect('status' in p).toBe(false);
  });

  test('放行時原因跟著寫，而且截到 200 字', () => {
    const p = buildCheckinConfirmPatch({ match: m(), side: 'home', uid: 'u1', present: 3, forcedReason: 'x'.repeat(300) });
    expect(p.checkin.homeForcedReason).toHaveLength(200);
  });

  test('side 只能是 home 或 away', () => {
    expect(() => buildCheckinConfirmPatch({ match: m(), side: 'x', uid: 'u1' })).toThrow();
  });
});
