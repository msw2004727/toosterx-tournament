/** User shared YouTube links: canonical video IDs only; never persist arbitrary URLs/HTML. */
export function sharedYoutubeId(input) {
  if (typeof input !== 'string' || input.length > 2048) return null;
  const text = input.trim();
  let url;
  try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); }
  catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  if (!['youtube.com', 'youtu.be'].includes(host)) return null;
  const path = url.pathname.split('/').filter(Boolean);
  const id = host === 'youtu.be' && path.length === 1 ? path[0]
    : url.pathname === '/watch' ? url.searchParams.get('v')
      : path.length === 2 && ['live', 'embed', 'shorts'].includes(path[0]) ? path[1] : null;
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export const streamShareDensity = count => count === 1 ? 'solo' : count < 5 ? 'regular' : 'compact';

export function streamShareEmbed(videoId) {
  if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1`;
}
