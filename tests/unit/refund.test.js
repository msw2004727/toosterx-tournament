/**
 * T55 退費機制與取消辦法（競賽規章第二十七條）
 * ------------------------------------------------------------------
 * 規章只寫了兩件事：活動日前 15 天內不退（可轉讓，賽前 3 天通知）、不可抗力全退。
 * 15 天以前退幾成規章沒寫——系統算「可退、建議全額」，主辦改金額要寫原因。
 */
import { describe, test, expect } from '@jest/globals';
import {
  feeOf, refundPolicy, refundAmount, buildCancelRequest, buildWithdrawPatch
} from '../../js/engine/refund.js';
import { REFUND_RULES, DIVISIONS } from '../../js/engine/formats.js';

const EVENT_DATE = '2026-10-09';
const at = iso => Date.parse(iso);

describe('T55-1 規章常數與報名費', () => {
  test('15 天、3 天（規章第二十七條）', () => {
    expect(REFUND_RULES.noRefundWithinDays).toBe(15);
    expect(REFUND_RULES.transferNoticeDays).toBe(3);
  });
  test('報名費依組別設定判斷：學童 5,000、其餘 6,000（規章第十三條）', () => {
    const byId = Object.fromEntries(DIVISIONS.map(d => [d.divisionId, d]));
    expect(feeOf(byId['u10'])).toBe(5000);
    expect(feeOf(byId['women'])).toBe(6000);
    expect(feeOf(byId['adult-open'])).toBe(6000);
    // 沒見過的代碼但有年齡門檻 → 也是學童（設定檔驅動，不寫死代碼）
    expect(feeOf({ divisionId: 'u12', eligibility: { bornOnOrAfter: '2014-09-01' } })).toBe(5000);
  });
});

describe('T55-2 refundPolicy', () => {
  test('活動日前 19 天申請：可退', () => {
    const p = refundPolicy({ requestedAtMs: at('2026-09-20T12:00:00+08:00'), eventDateIso: EVENT_DATE });
    expect(p).toMatchObject({ ready: true, refundable: true, ratio: 1, rule: 'before15', daysBefore: 18 });
  });

  test('⭐ 活動日前 15 天內不退：9/24 00:00 起算（10/9 − 15 天）', () => {
    const p = refundPolicy({ requestedAtMs: at('2026-09-24T00:00:00+08:00'), eventDateIso: EVENT_DATE });
    expect(p).toMatchObject({ ready: true, refundable: false, ratio: 0, rule: 'within15' });
    expect(p.text).toContain('轉讓');
    // 前一分鐘還可以
    expect(refundPolicy({ requestedAtMs: at('2026-09-23T23:59:00+08:00'), eventDateIso: EVENT_DATE }).refundable).toBe(true);
  });

  test('⭐ 不可抗力：任何時間點都全額退', () => {
    const p = refundPolicy({ requestedAtMs: at('2026-10-08T20:00:00+08:00'), eventDateIso: EVENT_DATE, forceMajeure: true });
    expect(p).toMatchObject({ ready: true, refundable: true, ratio: 1, rule: 'forceMajeure' });
  });

  test('名額轉讓的最後通知日：活動前 3 天', () => {
    const p = refundPolicy({ requestedAtMs: at('2026-09-30T10:00:00+08:00'), eventDateIso: EVENT_DATE });
    expect(new Date(p.transferDeadlineMs).toISOString()).toBe(new Date(at('2026-10-06T00:00:00+08:00')).toISOString());
  });

  test('⭐ 沒有活動日期或申請時間就算不出來（fail-closed）', () => {
    expect(refundPolicy({ requestedAtMs: at('2026-09-20T00:00:00+08:00'), eventDateIso: null })).toMatchObject({ ready: false });
    expect(refundPolicy({ requestedAtMs: NaN, eventDateIso: EVENT_DATE })).toMatchObject({ ready: false });
  });
});

describe('T55-3 refundAmount', () => {
  const ok = refundPolicy({ requestedAtMs: at('2026-09-01T00:00:00+08:00'), eventDateIso: EVENT_DATE });
  const no = refundPolicy({ requestedAtMs: at('2026-10-01T00:00:00+08:00'), eventDateIso: EVENT_DATE });
  test('可退→報名費全額；不退→0', () => {
    expect(refundAmount({ fee: 6000, policy: ok })).toBe(6000);
    expect(refundAmount({ fee: 6000, policy: no })).toBe(0);
  });
  test('主辦可以另外給金額，但要是 0 以上的整數', () => {
    expect(refundAmount({ fee: 6000, policy: no, override: 3000 })).toBe(3000);
    expect(() => refundAmount({ fee: 6000, policy: ok, override: -1 })).toThrow('整數');
    expect(() => refundAmount({ fee: 6000, policy: ok, override: 1.5 })).toThrow('整數');
  });
});

describe('T55-4 隊長申請與主辦處理', () => {
  const policy = refundPolicy({ requestedAtMs: at('2026-09-10T00:00:00+08:00'), eventDateIso: EVENT_DATE });
  test('取消申請要有原因', () => {
    expect(() => buildCancelRequest({ reason: ' ' })).toThrow('原因');
    expect(buildCancelRequest({ reason: '球員受傷太多', actorUid: 'u-cap' }))
      .toEqual({ reason: '球員受傷太多', byUid: 'u-cap', status: 'requested' });
  });
  test('⭐ 照規章金額處理：不用寫原因；金額不同就一定要寫', () => {
    const team = { cancelRequest: { reason: 'x', byUid: 'u-cap', status: 'requested' } };
    const p = buildWithdrawPatch({ team, fee: 6000, policy, amount: 6000, note: '', actorUid: 'u-admin' });
    expect(p).toMatchObject({
      status: 'withdrawn',
      refund: { rule: 'before15', refundable: true, fee: 6000, suggested: 6000, amount: 6000, note: null, byUid: 'u-admin' },
      cancelRequest: { status: 'processed' }
    });
    expect(() => buildWithdrawPatch({ team, fee: 6000, policy, amount: 3000, note: '' })).toThrow('原因');
    expect(buildWithdrawPatch({ team, fee: 6000, policy, amount: 3000, note: '扣除已印製的背號' }).refund.amount).toBe(3000);
  });
  test('沒有取消申請（主辦接到電話直接處理）也可以', () => {
    expect(buildWithdrawPatch({ team: {}, fee: 5000, policy, amount: 5000 }).cancelRequest).toBeNull();
  });
  test('⭐ 金額不是整數或規則算不出來就擋', () => {
    expect(() => buildWithdrawPatch({ team: {}, fee: 6000, policy, amount: 'all' })).toThrow('整數');
    expect(() => buildWithdrawPatch({ team: {}, fee: 6000, policy: { ready: false, reason: '沒日期' }, amount: 0 })).toThrow('沒日期');
  });
});
