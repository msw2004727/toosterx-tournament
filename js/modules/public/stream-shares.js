import { sdk, user, can, isAdmin, onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { el, mount, toast, confirmDialog } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';
import { sharedStreamSource, streamShareDensity, streamShareEmbed, streamShareUrl } from '../../engine/stream-share.js';
import { videoFacade, stopAllVideos } from './bits.js';
import { watchStreamShares, getOwnedStreamShares, submitStreamShare } from './data.js';

/** Persistent node: match/timeline redraws must not destroy drafts or a playing stream. */
export function matchStreamShares({ matchId, scope }) {
  const root = el('section', { class: 'pshares', 'aria-label': '球迷直播分享' });
  const content = el('div');
  const playerSlot = el('div');
  mount(root, content, playerSlot);
  const state = { rows: [], loaded: false, error: null, limit: 24, more: false,
    own: new Set(), line: false, identityLoading: true, form: false, draft: '', busy: false, message: '', disposed: false };
  let stopWatch, generation = 0, playback = null, selectedId = null, pendingCommand = null;
  watch();
  const stopAuth = onAuth(() => { void identity(); });
  const connectivity = () => render();
  window.addEventListener('online', connectivity);
  window.addEventListener('offline', connectivity);
  hold(scope, () => {
    state.disposed = true; generation++;
    stopAuth();
    window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity);
    closePlayer();
  }, 'stream-shares:cleanup');
  render();
  return root;

  function watch() {
    stopWatch?.();
    stopWatch = watchStreamShares(scope, matchId, state.limit, snapshot => {
      state.more = snapshot.more;
      state.rows = snapshot.rows;
      state.loaded = true; state.error = null;
      if (selectedId && !state.rows.some(row => row.shareId === selectedId)) closePlayer();
      render();
    }, () => { state.loaded = true; state.error = '直播分享暫時無法載入，請稍後重試。'; render(); });
  }

  async function identity() {
    const gen = ++generation, current = user();
    state.line = false; state.own = new Set(); state.identityLoading = !!current;
    if (!current) { state.form = false; render(); return; }
    render();
    try {
      const { getIdTokenResult } = sdk();
      const token = await getIdTokenResult(current);
      const owners = await getOwnedStreamShares(matchId, current.uid);
      if (gen !== generation || state.disposed) return;
      state.line = token.signInProvider === 'custom';
      state.own = owners;
    } catch { /* Sharing/removing stays unavailable if identity could not be established. */ }
    if (gen !== generation || state.disposed) return;
    state.identityLoading = false;
    render();
  }

  function closePlayer() {
    playback?.querySelector('.video')?.__stop?.();
    mount(playerSlot);
    playback = null; selectedId = null;
  }

  function play(row, trigger) {
    const url = streamShareEmbed(row, { parent: location.hostname });
    if (!url) { toast('這個直播連結無法播放，請聯絡分享者。', 'warn'); return; }
    closePlayer(); stopAllVideos();
    const facade = videoFacade(url, { title: `${row.displayName} 分享的賽事直播` });
    playback = el('div', { class: 'pshares__player', tabindex: '-1' }, [
      el('div', { class: 'pshares__playerHead' }, [
        el('span', { text: `${row.displayName} 的直播` }),
        el('button', { class: 'btn btn--ghost', type: 'button', 'aria-label': '關閉直播播放器', onClick: () => {
          closePlayer(); render();
          [...root.querySelectorAll('.pshares__item')].find(item => item.dataset.shareId === row.shareId)?.querySelector('.pshares__yt')?.focus();
        } }, icon('close'))
      ]), facade,
      el('a', { class: 'btn btn--ghost', href: streamShareUrl(row),
        target: '_blank', rel: 'noopener noreferrer', text: `在 ${row.provider === 'twitch' ? 'Twitch' : 'YouTube'} 開啟` })
    ]);
    selectedId = row.shareId;
    mount(playerSlot, playback); facade.__play(); playback.focus();
  }

  function render() {
    if (state.disposed) return;
    const online = navigator.onLine !== false;
    const allowModeration = can('stream.share.remove') && isAdmin();
    mount(content,
      el('div', { class: 'pshares__head' }, [
        el('h2', { text: '球迷直播分享' }),
        el('button', { class: 'btn btn--ghost', type: 'button', disabled: state.identityLoading || state.busy,
          onClick: () => {
            if (!state.line) { navigate(`/login?next=${encodeURIComponent(`/match/${matchId}`)}`); return; }
            state.form = !state.form; state.message = ''; render();
            root.querySelector('input')?.focus();
          } }, iconText('live', state.line ? '分享直播' : 'LINE 登入分享'))
      ]),
      !online ? el('p', { class: 'pshares__note', text: '目前離線，連線後才能分享或移除直播。' }) : null,
      state.error ? el('div', { role: 'alert', class: 'pshares__note' }, [
        el('span', { text: state.error }), el('button', { class: 'btn btn--ghost', type: 'button', onClick: watch, text: '重試' })
      ]) : !state.loaded ? el('p', { class: 'pshares__note', text: '載入直播分享…' })
        : !state.rows.length ? el('p', { class: 'pshares__note', text: '分享這場賽事的 YouTube 或 Twitch 直播，讓大家一起觀賽。' }) : null,
      el('ul', { class: 'pshares__grid', dataset: { density: streamShareDensity(state.rows.length) } }, state.rows.map(row => {
        const mayRemove = state.own.has(row.shareId) || allowModeration;
        const button = el('button', { class: 'pshares__yt', type: 'button',
          dataset: { provider: row.provider === 'twitch' ? 'twitch' : 'youtube' },
          'aria-label': `觀看 ${row.displayName} 分享的直播` }, [
          el('span', { class: 'pshares__ytLogo', 'aria-hidden': 'true' }, icon('play')),
          el('span', { text: `${row.provider === 'twitch' ? 'Twitch' : 'YouTube'} 直播` })
        ]);
        button.addEventListener('click', () => play(row, button));
        return el('li', { class: 'pshares__item', dataset: { shareId: row.shareId } }, [
          el('div', { class: 'pshares__byline' }, [
            el('span', { class: 'pshares__name', text: row.displayName, title: row.displayName }),
            mayRemove ? el('button', { class: 'pshares__remove', type: 'button', disabled: !online || state.busy,
              'aria-label': `移除 ${row.displayName} 的直播分享`, onClick: () => { void remove(row); } }, icon('close')) : null
          ]), button
        ]);
      })),
      state.more ? el('button', { class: 'btn btn--ghost pshares__more', type: 'button', onClick: () => {
        state.limit += 24; watch();
      }, text: '顯示更多直播' }) : null,
      state.form && state.line ? form(online) : null,
      state.message ? el('p', { class: 'pshares__message', role: 'status', text: state.message }) : null
    );
  }

  function form(online) {
    const input = el('input', { id: 'match-stream-url', type: 'url', inputmode: 'url', autocomplete: 'off',
      placeholder: 'https://www.youtube.com/live/…', value: state.draft, maxlength: '2048', disabled: state.busy,
      onInput: event => { state.draft = event.target.value; } });
    return el('form', { class: 'pshares__form', onSubmit: event => { event.preventDefault(); void publish(); } }, [
      el('label', { for: 'match-stream-url', text: 'YouTube 或 Twitch 直播連結' }), input,
      el('p', { class: 'pshares__note', text: 'YouTube：影片或直播網址；Twitch：https://www.twitch.tv/頻道名稱' }),
      el('p', { class: 'pshares__note', text: '分享後會公開你的 LINE 名稱與直播按鈕。' }),
      el('button', { class: 'btn btn--primary', type: 'submit', disabled: !online || state.busy,
        text: state.busy ? '正在送出…' : '分享這場直播' })
    ]);
  }

  async function command(action, details) {
    const key = JSON.stringify([user()?.uid, action, details]);
    if (pendingCommand?.key !== key) pendingCommand = { key, operationId: crypto.randomUUID() };
    const result = await submitStreamShare(matchId, { action,
      operationId: pendingCommand.operationId, ...details });
    pendingCommand = null;
    return result;
  }

  async function publish() {
    if (state.busy || !state.line || navigator.onLine === false) return;
    if (!sharedStreamSource(state.draft)) { state.message = '請貼上有效的 YouTube 影片或 Twitch 頻道直播網址。'; render(); return; }
    const gen = generation;
    state.busy = true; state.message = '正在送出直播分享…'; render();
    try {
      const result = await command('share', { url: state.draft });
      if (state.disposed || gen !== generation) return;
      state.own.add(result.shareId); state.form = false; state.draft = ''; state.message = '直播分享已儲存。';
    } catch (error) { if (gen === generation) state.message = error.message || '分享失敗，請重試。'; }
    finally { state.busy = false; render(); }
  }

  async function remove(row) {
    if (state.busy || navigator.onLine === false) return;
    const gen = generation;
    const confirmed = await confirmDialog({ title: '移除直播分享', body: `移除 ${row.displayName} 的直播分享？`,
      confirmText: '移除分享', tone: 'danger' });
    if (!confirmed || state.disposed || gen !== generation || state.busy || navigator.onLine === false) return;
    state.busy = true; state.message = '正在移除直播分享…'; render();
    try {
      await command('remove', { shareId: row.shareId });
      if (state.disposed || gen !== generation) return;
      state.own.delete(row.shareId); if (selectedId === row.shareId) closePlayer(); state.message = '直播分享已移除。';
    } catch (error) { if (gen === generation) state.message = error.message || '移除失敗，請重試。'; }
    finally { state.busy = false; render(); }
  }
}
