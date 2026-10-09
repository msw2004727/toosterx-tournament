import { sharedYoutubeId, sharedStreamSource, streamShareSource, streamShareUrl,
  streamShareDensity, streamShareEmbed, twitchChannelId } from '../../js/engine/stream-share.js';

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

test.each(['https://www.twitch.tv/TwitchDev', 'https://twitch.tv/twitchdev/?foo=bar',
  'm.twitch.tv/twitchdev', 'twitch.tv/twitchdev?parent=attacker.test'])('TWITCH-URL 頻道直播正規化：%s', url => {
  expect(sharedStreamSource(url)).toEqual({ provider: 'twitch', channelId: 'twitchdev' });
});

test.each(['https://twitch.tv.evil.test/twitchdev', 'https://attacker@twitch.tv/twitchdev',
  'https://twitch.tv:444/twitchdev', 'https://evil.twitch.tv/twitchdev', 'javascript:alert(1)',
  'https://twitch.tv/videos/123', 'https://twitch.tv/twitchdev/clip/abc', 'https://clips.twitch.tv/abc',
  'https://twitch.tv/directory', 'https://player.twitch.tv/?channel=twitchdev',
  'https://twitch.tv/twitchdev/about', 'https://twitch.tv/a%2Fb', 'https://twitch.tv/' + 'a'.repeat(26)])(
  'TWITCH-INVALID 偽装域名及非直播連結不接受：%s', url => expect(sharedStreamSource(url)).toBeNull());

test('TWITCH-PARENT 播放器使用目前網站 hostname，不能插入其他 query、URL 或 port', () => {
  const source = sharedStreamSource('https://twitch.tv/TwitchDev?parent=attacker.test');
  const url = new URL(streamShareEmbed(source, { parent: 'cup.toosterx.com' }));
  expect(url.origin).toBe('https://player.twitch.tv');
  expect([...url.searchParams]).toEqual([['channel', 'twitchdev'], ['parent', 'cup.toosterx.com'], ['autoplay', 'true']]);
  for (const parent of [undefined, 'https://cup.toosterx.com', 'cup.toosterx.com:443', 'cup.test&evil=1', '']) {
    expect(streamShareEmbed(source, { parent })).toBeNull();
  }
  expect(streamShareEmbed(source, { parent: 'localhost', autoplay: false })).toContain('autoplay=false');
  expect(streamShareUrl(source)).toBe('https://www.twitch.tv/twitchdev');
});

test('舊 YouTube 文件維持可播，未知 provider 及惡意頻道無法產生播放網址', () => {
  expect(streamShareSource({ videoId: 'dQw4w9WgXcQ' })).toEqual({ provider: 'youtube', videoId: 'dQw4w9WgXcQ' });
  expect(sharedStreamSource('https://youtu.be/dQw4w9WgXcQ')).toEqual({ provider: 'youtube', videoId: 'dQw4w9WgXcQ' });
  expect(streamShareUrl({ videoId: 'dQw4w9WgXcQ' })).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  expect(streamShareSource({ provider: 'evil', videoId: 'dQw4w9WgXcQ' })).toBeNull();
  expect(streamShareUrl({ provider: 'twitch', channelId: 'a?parent=evil' })).toBeNull();
  expect(twitchChannelId('XqC')).toBe('xqc');
});
