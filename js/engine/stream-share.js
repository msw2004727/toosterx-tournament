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

const TWITCH_RESERVED = new Set(['directory', 'videos', 'downloads', 'settings', 'login', 'signup',
  'search', 'subscriptions', 'wallet', 'jobs', 'p', 'turbo', 'inventory', 'drops', 'prime', 'friends']);

export function twitchChannelId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9_]{1,25}$/i.test(value)) return null;
  const channel = value.toLowerCase();
  return TWITCH_RESERVED.has(channel) ? null : channel;
}

/** Channel live URLs only; never arbitrary embeds, VODs, clips or caller-supplied parent domains. */
export function sharedStreamSource(input) {
  const videoId = sharedYoutubeId(input);
  if (videoId) return { provider: 'youtube', videoId };
  if (typeof input !== 'string' || input.length > 2048) return null;
  let url;
  try { url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`); }
  catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  if (!['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'].includes(url.hostname.toLowerCase())) return null;
  const path = /^\/([a-z0-9_]{1,25})\/?$/i.exec(url.pathname);
  const channelId = path && twitchChannelId(path[1]);
  return channelId ? { provider: 'twitch', channelId } : null;
}

/** Old YouTube shares have no provider; keep those playable without a data migration. */
export function streamShareSource(source) {
  if (typeof source === 'string') source = { videoId: source };
  if (!source) return null;
  if (source.provider === 'twitch') {
    const channelId = twitchChannelId(source.channelId);
    return channelId ? { provider: 'twitch', channelId } : null;
  }
  if (source.provider != null && source.provider !== 'youtube') return null;
  return typeof source.videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(source.videoId)
    ? { provider: 'youtube', videoId: source.videoId } : null;
}

export function streamShareUrl(input) {
  const source = streamShareSource(input);
  if (!source) return null;
  return source.provider === 'twitch' ? `https://www.twitch.tv/${source.channelId}`
    : `https://www.youtube.com/watch?v=${source.videoId}`;
}

export function streamShareEmbed(input, { parent, autoplay = true } = {}) {
  const source = streamShareSource(input);
  if (!source) return null;
  if (source.provider === 'twitch') {
    if (typeof parent !== 'string' || !/^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/i.test(parent)) return null;
    const params = new URLSearchParams({ channel: source.channelId, parent, autoplay: String(autoplay) });
    return `https://player.twitch.tv/?${params}`;
  }
  return `https://www.youtube-nocookie.com/embed/${source.videoId}?autoplay=${autoplay ? 1 : 0}&playsinline=1`;
}
