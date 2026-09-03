/**
 * T41 檢錄
 * ------------------------------------------------------------------
 * 規格：競賽規章第十八條第 3 款、docs/04 §4、docs/01b §1.12
 *
 * 「應於賽前 30 分鐘至大會檢錄，如有冒名頂替者立即停止該球隊繼續比賽
 *   資格，已賽成績不予計算。」——罰則是取消整隊，所以檢錄的紀錄要
 * 經得起事後查核：誰在幾點確認了誰出賽，取消也要留痕。
 */

import { buildCheckin, checkinSummary, presentIds, readyToStart, CHECKIN_RESULTS }
  from '../../js/modules/staff/checkin-actions.js';

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
