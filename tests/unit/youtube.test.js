/**
 * T56 YouTube 影片／頻道 ID（後台直播設定）
 * ------------------------------------------------------------------
 * 主辦貼進來的是整串網址。存整串網址進去 embed 會壞而且不報錯，所以要抽成 ID。
 */
import { describe, test, expect } from '@jest/globals';
import { parseYoutubeId, parseYoutubeChannelId } from '../../js/lib/youtube.js';

const ID = 'dQw4w9WgXcQ';

describe('T56-1 parseYoutubeId', () => {
  test('裸 ID 原樣回傳', () => {
    expect(parseYoutubeId(ID)).toBe(ID);
    expect(parseYoutubeId(`  ${ID}  `)).toBe(ID);
  });
  test('⭐ 各種網址都抽得出 ID', () => {
    expect(parseYoutubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYoutubeId(`https://www.youtube.com/watch?v=${ID}&t=42s`)).toBe(ID);
    expect(parseYoutubeId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(parseYoutubeId(`https://youtu.be/${ID}?si=abc`)).toBe(ID);
    expect(parseYoutubeId(`https://www.youtube.com/live/${ID}?feature=share`)).toBe(ID);
    expect(parseYoutubeId(`https://www.youtube-nocookie.com/embed/${ID}`)).toBe(ID);
    expect(parseYoutubeId(`https://m.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(parseYoutubeId(`youtube.com/watch?v=${ID}`)).toBe(ID);     // 沒有 https:// 也接
  });
  test('⭐ 不是 YouTube、或看起來像 ID 但不合法的，回 null（不存整串網址）', () => {
    expect(parseYoutubeId('https://vimeo.com/123456789')).toBeNull();
    expect(parseYoutubeId('https://www.youtube.com/')).toBeNull();
    expect(parseYoutubeId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseYoutubeId('abcdefghij=')).toBeNull();    // 11 碼但含 =
    expect(parseYoutubeId('')).toBeNull();
    expect(parseYoutubeId(null)).toBeNull();
  });
});

describe('T56-2 parseYoutubeChannelId', () => {
  const CH = 'UC' + 'a'.repeat(22);
  test('裸 ID 與 /channel/ 網址', () => {
    expect(parseYoutubeChannelId(CH)).toBe(CH);
    expect(parseYoutubeChannelId(`https://www.youtube.com/channel/${CH}/live`)).toBe(CH);
  });
  test('@handle 與其他字串認不出來就回 null', () => {
    expect(parseYoutubeChannelId('https://www.youtube.com/@fedacup')).toBeNull();
    expect(parseYoutubeChannelId('UC-too-short')).toBeNull();
    expect(parseYoutubeChannelId('')).toBeNull();
  });
});
