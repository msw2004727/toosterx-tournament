import { sharedYoutubeId, streamShareDensity, streamShareEmbed } from '../../js/engine/stream-share.js';

test.each([
  'https://youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?si=hello',
  'https://www.youtube.com/live/dQw4w9WgXcQ', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30',
  'youtube.com/embed/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ'
])('分享常見 YouTube 網址只存影片 ID：%s', value => expect(sharedYoutubeId(value)).toBe('dQw4w9WgXcQ'));

test.each([
  null, '', {}, 'dQw4w9WgXcQ', 'javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
  'https://evil.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com@evil.test/watch?v=dQw4w9WgXcQ',
  'https://attacker@youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com:444/watch?v=dQw4w9WgXcQ',
  'https://youtube.com/channel/UC1234567890123456789012', 'https://youtube.com/watch?v=<script>',
  'https://youtu.be/dQw4w9WgXcQ/evil', 'https://youtube.com/redirect?v=dQw4w9WgXcQ', 'x'.repeat(2049)
])('拒絕錯誤或偽裝分享連結：%s', value => expect(sharedYoutubeId(value)).toBeNull());

test('按鈕密度在單筆、少量及大量分享的邊界切換', () => {
  expect([0, 1, 2, 4, 5, 24].map(streamShareDensity)).toEqual(['regular', 'solo', 'regular', 'regular', 'compact', 'compact']);
});

test('播放器只能使用固定 HTTPS YouTube embed，參數不能注入', () => {
  expect(streamShareEmbed('dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1');
  expect(streamShareEmbed('dQw4w9WgXcQ?evil')).toBeNull();
  expect(streamShareEmbed(null)).toBeNull();
});
