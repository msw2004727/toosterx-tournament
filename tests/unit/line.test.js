/**
 * T34 LINE 登入的信任判斷（functions/line.js）
 * ------------------------------------------------------------------
 * 規格：docs/07 §3.2、docs/10 §8.5
 *
 * `assertLinePayload()` 是整條登入鏈上唯一「判斷要不要相信對方」的地方。
 * 它擋掉的是一件很具體的事：**別人的 LINE 應用程式發出來的 token**。
 * LINE 的 verify 端點會驗簽章與有效期，但「這個 token 是不是發給我們的」
 * 要我們自己確認 aud。
 */
import { assertLinePayload } from '../../functions/line.js';

const CH = '2011382448';
const good = (over = {}) => ({
  iss: 'https://access.line.me',
  sub: 'U7774e1410479bafff4997f51b2c47b95',
  aud: CH,
  name: '小麥',
  picture: 'https://profile.line-scdn.net/abc',
  exp: 9999999999,
  ...over
});

describe('T34 LINE payload 驗證', () => {
  test('正常的 payload 回傳 uid 與個人資料', () => {
    expect(assertLinePayload(good(), CH)).toEqual({
      uid: 'U7774e1410479bafff4997f51b2c47b95',
      displayName: '小麥',
      pictureUrl: 'https://profile.line-scdn.net/abc'
    });
  });

  test('⭐ aud 不是我們的 Channel 一律拒絕', () => {
    // 少了這一條，任何人拿別的 LINE 應用程式發出的 token 都能登入我們的系統
    expect(() => assertLinePayload(good({ aud: '9999999999' }), CH)).toThrow(/不是發給本應用程式/);
    expect(() => assertLinePayload(good({ aud: null }), CH)).toThrow(/不是發給本應用程式/);
  });

  test('aud 是陣列時也要真的含有我們的 Channel', () => {
    expect(assertLinePayload(good({ aud: ['9999999999', CH] }), CH).uid).toBeTruthy();
    expect(() => assertLinePayload(good({ aud: ['9999999999'] }), CH)).toThrow(/不是發給本應用程式/);
  });

  test('⭐ 簽發者必須是 LINE', () => {
    expect(() => assertLinePayload(good({ iss: 'https://evil.example.com' }), CH)).toThrow(/簽發者不是 LINE/);
  });

  test('⭐ 沒有 sub 就沒有 uid，不可以自己編一個', () => {
    // uid 必須直接用 LINE userId（docs/10 §8.5），拿不到就只能拒絕
    for (const sub of [undefined, null, '', 123, {}]) {
      expect(() => assertLinePayload(good({ sub }), CH)).toThrow(/沒有 userId/);
    }
  });

  test('Channel ID 用字串比較，數字型別也要能通過', () => {
    expect(assertLinePayload(good({ aud: CH }), Number(CH)).uid).toBeTruthy();
    expect(assertLinePayload(good({ aud: CH }), CH).uid).toBeTruthy();
  });

  test('名字與頭像缺漏時給 null，不要塞 undefined 進 Firestore', () => {
    const r = assertLinePayload(good({ name: undefined, picture: 42 }), CH);
    expect(r.displayName).toBeNull();
    expect(r.pictureUrl).toBeNull();
  });

  test('整包不是物件就拒絕', () => {
    for (const bad of [null, undefined, 'ok', 42]) {
      expect(() => assertLinePayload(bad, CH)).toThrow(/沒有回傳可用的內容/);
    }
  });
});
