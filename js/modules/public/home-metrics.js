import { el } from '../../core/ui.js';
import { sdk } from '../../core/firebase.js';
import { EVENT_ID } from '../../config.js';
import { HOME_METRICS, campaignShares, displayedTraffic } from '../../engine/home-metrics.js';

const number = new Intl.NumberFormat('zh-TW');
const key = 'feda:homeVisitor';
function visitorId() {
  try {
    const stored = localStorage.getItem(key);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored ?? '')) return stored;
    const id = crypto.randomUUID(); localStorage.setItem(key, id); return id;
  } catch { return crypto.randomUUID(); }
}

export function homeMetrics() {
  const visitor = visitorId(), visit = crypto.randomUUID();
  let disposed = false, pending = false, sequence = 0, current = null, receivedAt = 0, stale = false;
  const values = {};
  const root = el('aside', { class: 'p-homeMetrics', 'aria-label': '首頁瀏覽及分享統計' }, [
    el('dl', { class: 'p-homeMetrics__stats' }, [['online', '即時在線'], ['views', '累計瀏覽'], ['shares', '分享數']].map(([name, label]) => {
      values[name] = el('dd', { text: '—', 'data-metric': name });
      return el('div', { class: 'p-homeMetrics__stat' }, [el('dt', { text: label }), values[name]]);
    }))
  ]);

  function paint() {
    const outdated = stale || (current && performance.now() - receivedAt > HOME_METRICS.presenceLifetimeMs);
    const online = outdated ? null : displayedTraffic(current?.realOnline);
    const views = current ? displayedTraffic(current.realViews) : null;
    const shares = current ? campaignShares(current.shareStartedAtMs, current.serverNowMs + performance.now() - receivedAt) : null;
    for (const [name, value] of Object.entries({ online, views, shares })) values[name].textContent = value == null ? '—' : number.format(value);
    values.online.title = current && !outdated ? `實際在線 ${number.format(current.realOnline)} +33 活動基數；每 30 秒更新，同瀏覽器多頁籤只計一次，離線至多 90 秒移除` : '統計連線中／暫時無法取得即時在線';
    values.views.title = current ? `實際累計瀏覽 ${number.format(current.realViews)} +33 活動基數；從功能上線開始記錄，每次開啟首頁計一次，心跳及資料重畫不重複計數${stale ? '；目前顯示上次同步結果' : ''}` : '統計連線中';
    values.shares.title = '活動展示數，33 起每 10 分鐘 +6，至台灣時間 2026/10/12 00:00 凍結；非實際社群分享次數';
    root.dataset.state = current ? (outdated ? 'stale' : 'ready') : 'loading';
  }

  async function pulse(visible, final = false) {
    if (!final && (disposed || pending || navigator.onLine === false)) return;
    if (!final) pending = true;
    const sentSequence = ++sequence;
    try {
      const response = await sdk().httpsCallable(sdk()._fns, 'reportHomeMetrics')({ eventId: EVENT_ID,
        visitorId: visitor, visitId: visit, visible, sequence: sentSequence });
      const result = response.data?.ok === true ? response.data.data : null;
      if (!result || !Number.isSafeInteger(result.realOnline) || !Number.isSafeInteger(result.realViews)
        || !Number.isSafeInteger(result.shareStartedAtMs) || !Number.isFinite(result.serverNowMs)) throw Error('Invalid metrics');
      if (!disposed && !final && sentSequence === sequence) { current = result; receivedAt = performance.now(); stale = false; paint(); }
    } catch { if (!disposed && !final) { stale = true; paint(); } }
    finally { if (!final) pending = false; }
  }
  const visible = () => document.visibilityState === 'visible';
  const visibility = () => { void pulse(visible(), !visible()); };
  const online = () => { if (visible()) void pulse(true); };
  const offline = () => { stale = true; paint(); };
  const pagehide = () => { void pulse(false, true); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('online', online); window.addEventListener('offline', offline); window.addEventListener('pagehide', pagehide);
  const heartbeat = setInterval(() => { if (visible()) void pulse(true); }, HOME_METRICS.heartbeatMs);
  const clock = setInterval(paint, 1000);
  if (visible()) void pulse(true);
  return { element: root, dispose() {
    if (disposed) return;
    disposed = true; clearInterval(heartbeat); clearInterval(clock);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('online', online); window.removeEventListener('offline', offline); window.removeEventListener('pagehide', pagehide);
    void pulse(false, true);
  } };
}
