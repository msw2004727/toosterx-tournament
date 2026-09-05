/**
 * T51 Game Pass 的身分（js/modules/challenge/pass.js）
 * ------------------------------------------------------------------
 * 規格：docs/06 §5.1
 *
 * 這一支唯一的職責是「這台裝置上的玩家是誰」。它會在三種很糟的環境裡跑：
 * 無痕視窗、把網站資料設成封鎖、還有存了一半被清掉——三種都不可以
 * 讓整頁白掉，因為玩家只會看到一片空白然後關掉。
 */

import {
  savedPass, savePass, clearPass, newPlayerId, parsePlayerId, checkNickname, AGE_BANDS
} from '../../js/modules/challenge/pass.js';

const KEY = 'feda:gamePass';

/** 換上一個會照著設定行為的 localStorage 替身 */
function useStorage({ throwOnGet = false, throwOnSet = false } = {}) {
  const map = new Map();
  const fake = {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { if (throwOnSet) throw new Error('QuotaExceeded'); map.set(k, String(v)); },
    removeItem: k => map.delete(k)
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { if (throwOnGet) throw new Error('SecurityError'); return fake; }
  });
  return map;
}

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
});

describe('T51-1 存與讀', () => {
  test('存進去讀得回來', () => {
    useStorage();
    expect(savePass({ playerId: 'FEDA-0182', nickname: '阿哲' })).toBe(true);
    expect(savedPass()).toEqual({ playerId: 'FEDA-0182', nickname: '阿哲', contactKey: null, contactMasked: null });
  });

  test('沒存過就是 null（呼叫端會把人導去建立頁）', () => {
    useStorage();
    expect(savedPass()).toBeNull();
  });

  test('清掉之後就讀不到了', () => {
    useStorage();
    savePass({ playerId: 'FEDA-0182' });
    clearPass();
    expect(savedPass()).toBeNull();
  });

  test('存進去的代號會被正規化（大小寫、缺前綴都接得住）', () => {
    useStorage();
    savePass({ playerId: 'feda-182' });
    expect(savedPass().playerId).toBe('FEDA-0182');
  });
});

describe('T51-2 ⭐ 壞掉的環境不可以讓整頁白掉', () => {
  test('localStorage 這個屬性本身丟例外時，讀取回 null 而不是往上炸', () => {
    // 無痕視窗、把網站資料設成封鎖——這裡丟的不是「回傳 null」，
    // 是**存取屬性就丟例外**。沒接住的話頁面模組在第一行就死了
    useStorage({ throwOnGet: true });
    expect(() => savedPass()).not.toThrow();
    expect(savedPass()).toBeNull();
  });

  test('寫不進去時回 false，但**不丟例外**', () => {
    // 存不進去不算失敗：ID 仍然有效，只是下次要自己輸入。
    // 所以「我的挑戰卡」一定會把代號印得很大
    useStorage({ throwOnSet: true });
    expect(savePass({ playerId: 'FEDA-0182' })).toBe(false);
  });

  test('清不掉也不丟例外', () => {
    useStorage({ throwOnGet: true });
    expect(() => clearPass()).not.toThrow();
  });

  test('存到一半壞掉的 JSON 要當成沒有，不是丟例外', () => {
    const map = useStorage();
    map.set(KEY, '{"playerId":');
    expect(savedPass()).toBeNull();
  });

  test('存了一個不成格式的代號也當成沒有', () => {
    const map = useStorage();
    map.set(KEY, JSON.stringify({ playerId: '???' }));
    expect(savedPass()).toBeNull();
  });
});

describe('T51-3 配號', () => {
  test('產出來的一定是 FEDA-四位數', () => {
    for (let i = 0; i < 200; i++) expect(newPlayerId()).toMatch(/^FEDA-\d{4}$/);
  });

  test('⭐ 涵蓋得到 0000 與 9999 兩個邊界（不是 1..9998）', () => {
    // ESM 的 suite 沒有全域 jest，直接換掉 Math.random 再還原
    const real = Math.random;
    try {
      Math.random = () => 0;
      expect(newPlayerId()).toBe('FEDA-0000');
      Math.random = () => 0.99999;
      expect(newPlayerId()).toBe('FEDA-9999');
    } finally {
      Math.random = real;
    }
  });

  test('會抽到不只一組（寫死一個常數的話現場所有人都同一個號）', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(newPlayerId());
    expect(seen.size).toBeGreaterThan(50);
  });
});

describe('T51-4 手動輸入的代號', () => {
  test.each([
    ['FEDA-0182', 'FEDA-0182'],
    ['feda-0182', 'FEDA-0182'],
    ['FEDA0182', 'FEDA-0182'],
    ['0182', 'FEDA-0182'],
    ['182', 'FEDA-0182'],
    ['  182  ', 'FEDA-0182'],
    ['FEDA 0182', 'FEDA-0182']
  ])('%s → %s', (input, want) => {
    expect(parsePlayerId(input)).toBe(want);
  });

  test.each(['', '   ', 'abc', 'FEDA-', '-', null, undefined])('%s → null', input => {
    expect(parsePlayerId(input)).toBeNull();
  });
});

describe('T51-5 暱稱', () => {
  test('空白不行，而且錯誤訊息要說得出要做什麼', () => {
    const r = checkNickname('   ');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/暱稱/);
  });

  test('⭐ 上限 12 個字，跟 firestore.rules 一致', () => {
    // 兩邊分岔的方向是「畫面說可以、送出被擋」
    expect(checkNickname('一二三四五六七八九十一二').ok).toBe(true);     // 12
    expect(checkNickname('一二三四五六七八九十一二三').ok).toBe(false);  // 13
  });

  test('前後空白會被修掉', () => {
    expect(checkNickname('  阿哲  ')).toEqual({ ok: true, nickname: '阿哲' });
  });
});

describe('T51-6 年齡層', () => {
  test('三個選項，值跟 docs/06 §5.1 一致', () => {
    expect(AGE_BANDS.map(b => b.value)).toEqual(['kid', 'teen', 'adult']);
  });
});
