/**
 * T62 掃到的內容 → 玩家代號（parseScannedId）
 * ------------------------------------------------------------------
 * QR 裡放的是攤位頁的網址；攤位可能是相機掃、頁內掃、念代號、貼整串網址。
 * 每一種都要吃得下，吃不下就回 null（不猜）。
 */
import { parseScannedId, normalizePlayerId } from '../../js/engine/challenge.js';

describe('T62 parseScannedId', () => {
  test('代號本身：大小寫、空白、只打數字都接得住', () => {
    expect(parseScannedId('FEDA-0182')).toBe('FEDA-0182');
    expect(parseScannedId('feda 0182')).toBe('FEDA-0182');
    expect(parseScannedId('0182')).toBe('FEDA-0182');
    expect(parseScannedId(' 182 ')).toBe('FEDA-0182');
  });

  test('攤位頁的網址（QR 裡放的就是這個）', () => {
    expect(parseScannedId('https://cup.toosterx.com/#/booth?id=FEDA-0182')).toBe('FEDA-0182');
    expect(parseScannedId('https://cup-demo.toosterx.com/#/booth?id=FEDA-0182&x=1')).toBe('FEDA-0182');
    expect(parseScannedId('https://cup.toosterx.com/?id=feda-0182')).toBe('FEDA-0182');
  });

  test('⭐ 夾在別的文字裡也抓得到（有人把整張卡的文字複製過來）', () => {
    expect(parseScannedId('FEDA CUP 挑戰卡　我的代號 FEDA-0182　阿哲')).toBe('FEDA-0182');
  });

  test('不是代號就 null，不猜', () => {
    expect(parseScannedId('')).toBeNull();
    expect(parseScannedId(null)).toBeNull();
    expect(parseScannedId('abc')).toBeNull();
    expect(parseScannedId('https://example.com/nothing')).toBeNull();
  });

  test('跟 normalizePlayerId 的結果一致', () => {
    for (const s of ['FEDA-0007', 'feda0007', '7']) expect(parseScannedId(s)).toBe(normalizePlayerId(s));
  });
});
