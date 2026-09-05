/**
 * 直播設定 `#/admin/stream`
 * ------------------------------------------------------------------
 * 規格：docs/03 §5（YouTube 直播整合）
 *
 * 公開端的場次頁與直播牆讀的是 `venues/{id}.stream`（場地整日直播）與
 * `matches/{id}.stream`（單場覆蓋，在 #/admin/match 設）。影片 ID 原本只能從
 * Firebase Console 改——這一頁讓主辦自己改，而且貼整串網址也會被抽成 ID。
 *
 * 三件事：
 *   1. **貼網址也行。** 主辦手上是 youtu.be/… 的連結，不是 11 碼的 ID。
 *      存整串網址進去 embed 會壞而且不報錯，所以 `js/lib/youtube.js` 先抽。
 *   2. **開關獨立於 ID。** 直播中斷時把狀態切成「關」，公開端改顯示佔位，
 *      不用把 ID 清掉（docs/03 §5.4）。
 *   3. **整包 stream 寫回。** updateDoc 對巢狀 map 是整包取代，少列一個欄位就等於刪掉。
 *
 * ⚠️ 頁面模組的順序陷阱：render() 會用到的東西一律具名函式。
 */
import { el, mount, toast, skeleton } from '../../core/ui.js';
import { iconText } from '../../core/icons.js';
import { can, onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { parseYoutubeId, parseYoutubeChannelId } from '../../lib/youtube.js';
import * as data from './data.js';
import { adminHead, denied } from './bits.js';

export async function adminStreamPage({ scope, view }) {
  const root = el('div', { class: 'adm' });
  mount(view, root);
  mount(root, adminHead('直播設定'), skeleton(3));

  const state = { venues: undefined, drafts: {}, busy: null, error: null };

  hold(scope, onAuth(() => render()), 'auth:admin-stream');

  if (!can('stream.manage')) { mount(root, adminHead('直播設定'), denied('直播設定', '管理員')); return; }

  load();

  // ── 具名函式（會被提升）───────────────────────────────────

  async function load() {
    try {
      state.venues = await data.getVenues();
      for (const v of state.venues) state.drafts[v.venueId] = draftFrom(v);
    } catch (err) {
      state.error = err; state.venues = [];
    }
    render();
  }

  function draftFrom(v) {
    const s = v.stream ?? {};
    return {
      status: s.status === 'live' ? 'live' : 'off',
      videoId: s.videoId ?? '',
      channelId: s.channelId ?? '',
      videoInput: s.videoId ?? '',
      channelInput: s.channelId ?? '',
      videoError: null, channelError: null
    };
  }

  function dirty(v) {
    const d = state.drafts[v.venueId];
    const base = draftFrom(v);
    return d.status !== base.status || d.videoId !== base.videoId || d.channelId !== base.channelId;
  }

  /** 貼進來的東西先抽成 ID；抽不出來就留在畫面上說清楚，不存 */
  function setVideo(d, raw) {
    d.videoInput = raw;
    const t = String(raw).trim();
    if (!t) { d.videoId = ''; d.videoError = null; return; }
    const id = parseYoutubeId(t);
    d.videoId = id ?? '';
    d.videoError = id ? null : '看不出這是 YouTube 影片：請貼影片網址或 11 碼的影片 ID';
  }
  function setChannel(d, raw) {
    d.channelInput = raw;
    const t = String(raw).trim();
    if (!t) { d.channelId = ''; d.channelError = null; return; }
    const id = parseYoutubeChannelId(t);
    d.channelId = id ?? '';
    d.channelError = id ? null : '頻道 ID 要是 UC 開頭 24 碼，或 youtube.com/channel/UC… 的網址（@名稱認不出來）';
  }

  function embedUrlOf(d) {
    if (d.status !== 'live') return null;
    if (d.videoId) return `https://www.youtube-nocookie.com/embed/${d.videoId}`;
    if (d.channelId) return `https://www.youtube-nocookie.com/embed/live_stream?channel=${d.channelId}`;
    return null;
  }

  async function save(v) {
    const d = state.drafts[v.venueId];
    if (d.videoError || d.channelError) { toast('先修正紅字的欄位', 'warn'); return; }
    if (d.status === 'live' && !d.videoId && !d.channelId) {
      toast('開了直播卻沒有影片 ID 或頻道 ID，公開端會是一片空白', 'warn'); return;
    }
    const stream = {
      enabled: d.status === 'live',
      provider: 'youtube',
      channelId: d.channelId || null,
      videoId: d.videoId || null,
      status: d.status
    };
    state.busy = v.venueId; render();
    try {
      await data.saveVenueStream(v.venueId, stream);
      await data.writeAudit({
        action: 'stream.update', targetType: 'venue', targetId: v.venueId,
        before: v.stream ?? null, after: stream, reason: null
      });
      v.stream = stream;
      state.drafts[v.venueId] = draftFrom(v);
      toast(`已儲存「${v.name ?? v.venueId}」的直播設定`, 'success');
    } catch (err) {
      toast(data.explain(err, '沒有儲存成功。'), 'error');
    } finally {
      state.busy = null; render();
    }
  }

  // ── 畫面 ─────────────────────────────────────────────────

  function venueCard(v) {
    const d = state.drafts[v.venueId];
    const busy = state.busy === v.venueId;
    const url = embedUrlOf(d);
    return el('section', { class: 'adm__box adm__stream', dataset: { venue: v.venueId } }, [
      el('div', { class: 'adm__perm' }, [
        el('div', { class: 'adm__permMain' }, [
          el('strong', { class: 'adm__permLabel', text: v.name ?? v.venueId }),
          el('span', { class: 'adm__permMeta', text: d.status === 'live' ? '直播中：公開端會嵌入播放器' : '關閉：公開端顯示佔位圖' })
        ]),
        el('button', {
          class: `adm__switch${d.status === 'live' ? ' is-on' : ''}`, type: 'button',
          role: 'switch', 'aria-checked': d.status === 'live' ? 'true' : 'false',
          'aria-label': `${v.name ?? v.venueId} 直播開關`, disabled: busy,
          onClick: () => { d.status = d.status === 'live' ? 'off' : 'live'; render(); }
        }, el('span', { class: 'adm__switchKnob' }))
      ]),

      el('div', { class: 'adm__field' }, [
        el('label', { class: 'adm__fieldLabel', for: `st-video-${v.venueId}`, text: '影片 ID（單支影片或這一場的直播）' }),
        el('input', {
          class: 'adm__search', id: `st-video-${v.venueId}`, type: 'text',
          placeholder: '貼 YouTube 網址，或 11 碼的影片 ID', value: d.videoInput,
          onInput: e => { setVideo(d, e.target.value); }, onChange: () => render()
        }),
        d.videoError ? el('p', { class: 'adm__permNote adm__permNote--err', text: d.videoError })
                     : d.videoId ? el('p', { class: 'adm__permNote', text: `＝ 影片 ID ${d.videoId}` }) : null
      ].filter(Boolean)),

      el('div', { class: 'adm__field' }, [
        el('label', { class: 'adm__fieldLabel', for: `st-ch-${v.venueId}`, text: '頻道 ID（固定機位整日直播，沒有單支影片時用）' }),
        el('input', {
          class: 'adm__search', id: `st-ch-${v.venueId}`, type: 'text',
          placeholder: 'UC 開頭 24 碼，或 youtube.com/channel/UC… 的網址', value: d.channelInput,
          onInput: e => { setChannel(d, e.target.value); }, onChange: () => render()
        }),
        d.channelError ? el('p', { class: 'adm__permNote adm__permNote--err', text: d.channelError })
                       : d.channelId ? el('p', { class: 'adm__permNote', text: `＝ 頻道 ID ${d.channelId}` }) : null
      ].filter(Boolean)),

      el('p', { class: 'adm__permNote', text: url ? `公開端會嵌入：${url}` : '目前公開端不會嵌入播放器。' }),

      el('div', { class: 'adm__actions' }, [
        el('button', {
          class: 'btn btn--primary btn--lg', type: 'button',
          disabled: busy || !dirty(v) || !!d.videoError || !!d.channelError,
          onClick: () => save(v)
        }, iconText('check', busy ? '儲存中…' : '儲存')),
        dirty(v)
          ? el('button', {
              class: 'btn btn--lg', type: 'button', disabled: busy,
              onClick: () => { state.drafts[v.venueId] = draftFrom(v); render(); }
            }, iconText('undo', '放棄變更'))
          : null
      ].filter(Boolean))
    ]);
  }

  function render() {
    if (state.venues === undefined) { mount(root, adminHead('直播設定'), skeleton(3)); return; }
    mount(root,
      adminHead('直播設定', { sub: `${state.venues.length} 個場地` }),
      state.error
        ? el('div', { class: 'adm__box adm__box--warn', role: 'alert' }, [
            el('strong', { text: '讀不到場地' }),
            el('p', { class: 'adm__note', text: data.explain(state.error) })
          ])
        : null,
      el('p', { class: 'adm__note', text:
        '每個場地一組設定，公開端的場次頁與直播牆會照這裡嵌入 YouTube（youtube-nocookie）。' +
        '單一場次要用不同影片，到「賽程管理 → 該場次 → 場次改判」頁的直播欄位設定。' }),
      state.venues.length
        ? state.venues.map(venueCard)
        : el('p', { class: 'adm__empty', text: '這個賽事還沒有場地。' })
    );
  }
}
