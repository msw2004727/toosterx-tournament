/**
 * T38 校時探測
 * ------------------------------------------------------------------
 * 2026-09-04 由使用者回報：主控台每次載入都紅一條
 *   GET .../documents/__ping__/__ping__ 400 (Bad Request)
 *
 * 原因是 Firestore 把 `__...__` 當保留識別字。程式只讀 Date 標頭，
 * 所以功能上「能用」——但每一位使用者的主控台都會多一條紅字，
 * 真正的錯誤就藏在那裡面。
 *
 * 這一份守著「網址不會再變回會噴錯的形式」。
 */

import { pingUrl, offsetFrom } from '../../js/lib/ping.js';

describe('T38-A 探測網址', () => {
  const url = pingUrl('feda-cup-demo');

  test('⭐ 不含 Firestore 的保留識別字（__...__）', () => {
    // 這是使用者實際回報的那個 400
    const path = new URL(url).pathname;
    expect(path).not.toMatch(/__[^/]*__/);
  });

  test('⭐ 打的是集合列表，不是單一文件', () => {
    // 正式專案現在是空的（資料走管理後台匯入，R-SEED-001），
    // 任何單一文件路徑在那裡都是 404——一樣會噴紅字。
    // 集合列表沒有任何文件時照樣回 200。
    const after = new URL(url).pathname.split('/documents/')[1];
    expect(after).toBe('events');                 // 奇數段＝集合
    expect(after.split('/').length % 2).toBe(1);
  });

  test('只要標頭不要內容（pageSize 與 mask）', () => {
    const q = new URL(url).searchParams;
    expect(q.get('pageSize')).toBe('1');
    expect(q.get('mask.fieldPaths')).toBe('eventId');
  });

  test('⭐ 是跨來源的 Firestore，不是同源靜態檔', () => {
    // 同源會被 Service Worker 接走（非 HTML 是 cache-first，
    // 離線時還會忽略 query 退回快取）——拿到快取那份的舊 Date，
    // 校時反而更錯。sw.js 對跨來源直接放行。
    expect(new URL(url).origin).toBe('https://firestore.googleapis.com');
  });

  test('專案 ID 有帶進去', () => {
    expect(pingUrl('feda-cup-2026')).toContain('/projects/feda-cup-2026/');
    expect(pingUrl('feda-cup-demo')).toContain('/projects/feda-cup-demo/');
  });
});

describe('T38-B 算時差', () => {
  const D = 'Fri, 04 Sep 2026 03:00:00 GMT';
  const ms = Date.parse(D);

  test('往返對稱時取中點', () => {
    expect(offsetFrom(D, ms - 1000, ms - 600)).toBe(800);
  });

  test('本機準的時候是 0', () => {
    expect(offsetFrom(D, ms, ms)).toBe(0);
  });

  test('⭐ 讀不到標頭回 null，不是 0', () => {
    // 0 是一個有意義的值（「時鐘完全準」）。回 0 等於在沒有資料的時候
    // 假裝校時成功了——而校時錯了會讓三分鐘自撤回的倒數整個歪掉。
    expect(offsetFrom(null, 0, 1)).toBeNull();
    expect(offsetFrom('', 0, 1)).toBeNull();
    expect(offsetFrom(undefined, 0, 1)).toBeNull();
  });

  test('⭐ 標頭解析不出來也回 null', () => {
    expect(offsetFrom('not a date', 0, 1)).toBeNull();
    expect(offsetFrom('2026-13-99', 0, 1)).toBeNull();
  });

  test('時間戳壞掉回 null', () => {
    expect(offsetFrom(D, NaN, 1)).toBeNull();
    expect(offsetFrom(D, 0, NaN)).toBeNull();
    expect(offsetFrom(D, 100, 50)).toBeNull();     // t1 早於 t0
  });
});
