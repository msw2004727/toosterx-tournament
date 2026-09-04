/**
 * T40 報名開關
 * ------------------------------------------------------------------
 * 規格：docs/10 §2.3、R-ENG-005
 *
 * ⭐ 最重要的一條：**這裡的判斷必須跟 `firestore.rules` 的 `regOpen()` 一致**。
 *    畫面說「開放中」、送出卻被規則擋掉，對報名的家長來說就是系統壞了。
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  toMs, registrationState, checkRegistrationDates, buildRegistrationPatch
} from '../../js/engine/registration.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = iso => Date.parse(iso);
const NOW = T('2026-09-04T12:00:00+08:00');

const cfg = (over = {}) => ({
  open: true,
  opensAt: T('2026-09-01T00:00:00+08:00'),
  closesAt: T('2026-09-14T00:00:00+08:00'),
  ...over
});

describe('T40-A 開放判斷', () => {
  test('三個條件都成立才開放', () => {
    expect(registrationState(cfg(), NOW).open).toBe(true);
  });

  test('⭐ 讀不到設定一律當關閉（fail-closed）', () => {
    // 「沒設定就當開著」會讓一個還沒準備好的賽事在上線當天就開始收報名
    expect(registrationState(null, NOW).open).toBe(false);
    expect(registrationState(undefined, NOW).open).toBe(false);
    expect(registrationState(null, NOW).reason).toContain('還沒建立');
  });

  test('⭐ 手動關掉就是關掉，即使還在期間內', () => {
    const r = registrationState(cfg({ open: false }), NOW);
    expect(r.open).toBe(false);
    expect(r.reason).toContain('尚未開放');
  });

  test('⭐ 還沒到開始時間', () => {
    const r = registrationState(cfg(), T('2026-08-30T00:00:00+08:00'));
    expect(r.open).toBe(false);
    expect(r.reason).toContain('還沒開始');
  });

  test('⭐ 過了截止時間', () => {
    const r = registrationState(cfg(), T('2026-09-14T00:00:01+08:00'));
    expect(r.open).toBe(false);
    expect(r.reason).toContain('已經截止');
  });

  test('截止的那一刻仍然算開放（<=，跟 rules 一樣）', () => {
    expect(registrationState(cfg(), T('2026-09-14T00:00:00+08:00')).open).toBe(true);
  });

  test('開始的那一刻算開放（>=，跟 rules 一樣）', () => {
    expect(registrationState(cfg(), T('2026-09-01T00:00:00+08:00')).open).toBe(true);
  });

  test('沒有起訖限制時只看開關', () => {
    expect(registrationState({ open: true, opensAt: null, closesAt: null }, NOW).open).toBe(true);
    expect(registrationState({ open: false, opensAt: null, closesAt: null }, NOW).open).toBe(false);
  });

  test('open 只認 true（字串 "true" 不算）', () => {
    expect(registrationState(cfg({ open: 'true' }), NOW).open).toBe(false);
    expect(registrationState(cfg({ open: 1 }), NOW).open).toBe(false);
  });

  test('⭐ 條件與 firestore.rules 的 regOpen() 對得起來', () => {
    // 逐字比對規則裡那四行。兩邊分岔的方向是「畫面說開放、送出被擋」。
    const src = fs.readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
    const start = src.indexOf('function regOpen(');
    const body = src.slice(start, src.indexOf('}', start));
    expect(body).toContain("get(p).data.get('open', false) == true");
    expect(body).toContain('request.time >= get(p).data.opensAt');
    expect(body).toContain('request.time <= get(p).data.closesAt');
    expect(body).toContain('exists(p)');            // 文件不存在＝關閉
  });
});

describe('T40-B toMs', () => {
  test('吃得下 Timestamp / Date / ISO / 毫秒', () => {
    expect(toMs({ toMillis: () => 123 })).toBe(123);
    expect(toMs({ seconds: 2, nanoseconds: 0 })).toBe(2000);
    expect(toMs(new Date(456))).toBe(456);
    expect(toMs(789)).toBe(789);
    expect(toMs('2026-09-04T00:00:00Z')).toBe(Date.parse('2026-09-04T00:00:00Z'));
  });

  test('解析不出來回 null，不回 0', () => {
    // 0 是 1970-01-01，會讓「還沒開始」變成「早就開始了」
    expect(toMs(null)).toBeNull();
    expect(toMs('不是日期')).toBeNull();
    expect(toMs(new Date('x'))).toBeNull();
    expect(toMs(NaN)).toBeNull();
    expect(toMs({})).toBeNull();
  });
});

describe('T40-C 儲存前的提醒', () => {
  const chk = o => checkRegistrationDates({ nowMs: NOW, ...o }).map(w => w.code);

  test('⭐ 起訖顛倒（這樣報名永遠不會開放）', () => {
    expect(chk({ opensAt: T('2026-09-10T00:00:00+08:00'), closesAt: T('2026-09-01T00:00:00+08:00') }))
      .toContain('REVERSED');
  });

  test('相同時間也算顛倒', () => {
    const t = T('2026-09-10T00:00:00+08:00');
    expect(chk({ opensAt: t, closesAt: t })).toContain('REVERSED');
  });

  test('截止時間已過', () => {
    expect(chk({ opensAt: null, closesAt: T('2026-09-01T00:00:00+08:00') })).toContain('PAST');
  });

  test('⭐ 截止晚於第一個比賽日（比賽當天還收得到報名）', () => {
    expect(chk({ opensAt: null, closesAt: T('2026-10-10T00:00:00+08:00'), firstMatchDate: '2026-10-09' }))
      .toContain('AFTER_MATCH');
  });

  test('截止晚於彩排日', () => {
    expect(chk({ opensAt: null, closesAt: T('2026-10-07T12:00:00+08:00'), rehearsalDate: '2026-10-06' }))
      .toContain('AFTER_REHEARSAL');
  });

  test('正常設定沒有提醒', () => {
    expect(chk({
      opensAt: T('2026-09-01T00:00:00+08:00'), closesAt: T('2026-09-14T00:00:00+08:00'),
      firstMatchDate: '2026-10-09', rehearsalDate: '2026-10-06'
    })).toEqual([]);
  });

  test('⭐ 全部只是提醒，沒有一條會擋住儲存', () => {
    // 規章沒寫的事情不要升成錯誤——那等於系統替主辦訂了一條規章沒有的規則
    const all = checkRegistrationDates({
      nowMs: NOW,
      opensAt: T('2026-10-20T00:00:00+08:00'), closesAt: T('2026-10-10T00:00:00+08:00'),
      firstMatchDate: '2026-10-09', rehearsalDate: '2026-10-06'
    });
    expect(all.length).toBeGreaterThan(0);
    for (const w of all) expect(w.text).toEqual(expect.any(String));
    expect(all.some(w => w.level === 'error')).toBe(false);
  });

  test('沒有日期就沒有提醒', () => {
    expect(chk({ opensAt: null, closesAt: null, firstMatchDate: '2026-10-09' })).toEqual([]);
  });
});

describe('T40-D 要寫進去的內容', () => {
  test('開關與兩個時間', () => {
    const p = buildRegistrationPatch({ open: true, opensAt: 1000, closesAt: 2000 });
    expect(p.open).toBe(true);
    expect(p.opensAt.getTime()).toBe(1000);
    expect(p.closesAt.getTime()).toBe(2000);
  });

  test('⭐ null 照實寫進去（那是「不限制」，不是「沒填」）', () => {
    const p = buildRegistrationPatch({ open: false, opensAt: null, closesAt: null });
    expect(p).toHaveProperty('opensAt', null);
    expect(p).toHaveProperty('closesAt', null);
  });

  test('⭐ 只帶這一頁管得到的欄位（人數與費用照規章，不在這裡）', () => {
    // 讓主辦在這裡改人數上限，等於讓系統可以跟規章不一致（R-REG-001）
    const p = buildRegistrationPatch({ open: true, opensAt: null, closesAt: null });
    expect(Object.keys(p).sort()).toEqual(['closesAt', 'open', 'opensAt']);
  });

  test('maxTeamsPerAccount 有給才寫', () => {
    expect(buildRegistrationPatch({ open: true, opensAt: null, closesAt: null, maxTeamsPerAccount: 3 }))
      .toHaveProperty('maxTeamsPerAccount', 3);
  });

  test('⭐ open 只收 boolean', () => {
    expect(() => buildRegistrationPatch({ open: 'true', opensAt: null, closesAt: null })).toThrow();
    expect(() => buildRegistrationPatch({ open: undefined, opensAt: null, closesAt: null })).toThrow();
  });

  test('球隊數上限要是 1 以上的整數', () => {
    const base = { open: true, opensAt: null, closesAt: null };
    expect(() => buildRegistrationPatch({ ...base, maxTeamsPerAccount: 0 })).toThrow();
    expect(() => buildRegistrationPatch({ ...base, maxTeamsPerAccount: -1 })).toThrow();
    expect(() => buildRegistrationPatch({ ...base, maxTeamsPerAccount: 1.5 })).toThrow();
    expect(() => buildRegistrationPatch({ ...base, maxTeamsPerAccount: '3' })).toThrow();
  });
});
