/**
 * YouTube 影片／頻道 ID
 * ------------------------------------------------------------------
 * 主辦貼進來的多半是整串網址（youtu.be/…、youtube.com/watch?v=…、/live/…），
 * 不是 11 碼的 ID。存整串網址進去，公開端的 embed 會壞而且不報錯，
 * 所以在這裡就把它抽成 ID；抽不出來就回 null，畫面說清楚。
 *
 * 純函式，沒有相依。
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const HOSTS = /^(youtube\.com|youtu\.be|youtube-nocookie\.com)$/;

function urlOf(s) {
  try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
}

/** 影片 ID：接受裸 ID 或各種 YouTube 網址；認不出來回 null */
export function parseYoutubeId(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (VIDEO_ID.test(s)) return s;
  const u = urlOf(s);
  if (!u) return null;
  const host = u.hostname.replace(/^(www|m)\./, '');
  if (!HOSTS.test(host)) return null;
  const v = u.searchParams.get('v');
  if (v && VIDEO_ID.test(v)) return v;
  const seg = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') return seg[0] && VIDEO_ID.test(seg[0]) ? seg[0] : null;
  const i = seg.findIndex(x => ['live', 'embed', 'shorts', 'v'].includes(x));
  if (i >= 0 && seg[i + 1] && VIDEO_ID.test(seg[i + 1])) return seg[i + 1];
  return null;
}

/** 頻道 ID（UC 開頭 24 碼）：接受裸 ID 或 youtube.com/channel/UC… 的網址 */
export function parseYoutubeChannelId(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (CHANNEL_ID.test(s)) return s;
  const u = urlOf(s);
  if (!u) return null;
  const seg = u.pathname.split('/').filter(Boolean);
  const i = seg.indexOf('channel');
  return i >= 0 && seg[i + 1] && CHANNEL_ID.test(seg[i + 1]) ? seg[i + 1] : null;
}
