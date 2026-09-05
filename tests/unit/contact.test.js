/**
 * T57 抽獎中獎聯絡方式（docs/06 §7.2）
 * ------------------------------------------------------------------
 * players 文件任何人都讀得到，所以電話不放那裡、憑證只放雜湊。
 * 這裡守純函式：號碼正規化、遮罩、Game Pass 帶雜湊。
 */
import { describe, test, expect } from '@jest/globals';
import { normalizePhone, maskPhone, newPlayerDoc } from '../../js/engine/challenge.js';

describe('T57-1 normalizePhone', () => {
  test('台灣手機：破折號、空白、+886 都接', () => {
    expect(normalizePhone('0912-345-678')).toBe('0912345678');
    expect(normalizePhone('0912 345 678')).toBe('0912345678');
    expect(normalizePhone('+886 912 345 678')).toBe('0912345678');
    expect(normalizePhone('0912345678')).toBe('0912345678');
  });
  test('⭐ 市話、少一碼、亂打的回 null（簡訊與 LINE 通知打不到市話）', () => {
    expect(normalizePhone('02-2345-6789')).toBeNull();
    expect(normalizePhone('091234567')).toBeNull();
    expect(normalizePhone('09123456789')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('T57-2 maskPhone', () => {
  test('⭐ 只露頭四碼與尾三碼', () => {
    expect(maskPhone('0912345678')).toBe('0912***678');
    expect(maskPhone('')).toBe('');
    expect(maskPhone(null)).toBe('');
  });
});

describe('T57-3 newPlayerDoc 帶憑證雜湊', () => {
  const base = { playerId: 'FEDA-0182', eventId: 'e', nickname: '小豆子' };
  test('⭐ 自建的卡帶 contactKeyHash；沒給就是 null（攤位代建）', () => {
    expect(newPlayerDoc({ ...base, contactKeyHash: 'ab'.repeat(32) }).contactKeyHash).toBe('ab'.repeat(32));
    expect(newPlayerDoc(base).contactKeyHash).toBeNull();
    expect(newPlayerDoc({ ...base, contactKeyHash: 123 }).contactKeyHash).toBeNull();
    expect(newPlayerDoc({ ...base, contactKeyHash: '' }).contactKeyHash).toBeNull();
  });
  test('電話仍然不在 players 文件上', () => {
    const d = newPlayerDoc({ ...base, contactKeyHash: 'x'.repeat(64) });
    expect(d.contact).toEqual({ phone: null, lineUserId: null });
  });
});
