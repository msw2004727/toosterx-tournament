/**
 * 離線佇列狀態｜送出三態
 * ------------------------------------------------------------------
 * 規格：docs/04-功能規格-賽務裁判端.md §5.7
 *
 * ══════════════════════════════════════════════════════════════
 *  不可協商：按下送出後，UI 絕不能顯示成功但實際沒寫入。
 * ══════════════════════════════════════════════════════════════
 *
 * Firestore SDK 開了本機快取之後，setDoc() 的行為是：
 *   ・本機立刻生效（UI 馬上看得到）
 *   ・回傳的 Promise 要等**伺服器確認**才 resolve
 *   ・離線時 Promise 一直 pending，恢復連線自動送出後才 resolve
 *   ・被 rules 擋下時 reject，而且**本機那筆會被回滾**
 *
 * 所以三態就是這個 Promise 的三個狀態：
 *   pending → queued（已記錄，等待同步）
 *   resolve → saved （已儲存）
 *   reject  → failed（儲存失敗，要人工處理）
 *
 * ⚠️ 絕對不要 await 這個 Promise 再更新 UI——離線時它永遠不會 resolve，
 *    畫面會卡住，賽務會以為當機而重複點擊。
 *
 * 這個模組刻意不 import 任何 Firebase 的東西：它只收「會回傳 Promise 的函式」，
 * 因此 Node 測得到，也能在沒有網路的環境跑測試。
 */

/** @typedef {'queued'|'saved'|'failed'} WriteState */

let seq = 0;
const writes = new Map();          // id → { id, label, state, error, thunk, at, tries }
const listeners = new Set();
let online = true;
let detach = null;

/** 失敗紀錄保留上限，避免現場累積過多 */
const MAX_KEPT_FAILED = 50;
/** 超過這個待送筆數就提示賽務找網路（docs/04 §8） */
export const QUEUE_WARN_THRESHOLD = 20;

// ── 對外狀態 ─────────────────────────────────────────────────

export function summary() {
  let queued = 0, failed = 0;
  for (const w of writes.values()) {
    if (w.state === 'queued') queued++;
    else if (w.state === 'failed') failed++;
  }
  return {
    online, queued, failed,
    total: writes.size,
    // 燈號：紅（有失敗）> 黃（有待送或離線）> 綠
    level: failed > 0 ? 'failed' : (queued > 0 || !online) ? 'queued' : 'saved',
    warnQueue: queued >= QUEUE_WARN_THRESHOLD
  };
}

export function list() {
  return [...writes.values()]
    .map(({ thunk, ...rest }) => rest)      // 不外洩 thunk
    .sort((a, b) => b.at - a.at);
}

export function subscribe(fn) {
  listeners.add(fn);
  // 初次呼叫也要包起來：某個畫面的訂閱者出錯，不該讓整個 subscribe() 失敗
  try { fn(summary()); } catch (e) { console.error('[sync] listener', e); }
  return () => listeners.delete(fn);
}

function emit() {
  const s = summary();
  for (const fn of listeners) {
    try { fn(s); } catch (e) { console.error('[sync] listener', e); }
  }
}

// ── 核心：追蹤一次寫入 ───────────────────────────────────────

/**
 * 送出一次寫入並追蹤三態。
 *
 * @param {string} label 給人看的描述，例如「記錄進球 #7 王小明」。
 *                       失敗時會顯示在重試清單裡，所以要寫得夠具體。
 * @param {() => Promise<any>} thunk 實際執行寫入的函式（要能重跑，重試時會再呼叫一次）
 * @param {object} [meta] 附加資訊，例如 { matchId, kind:'goal' }
 * @returns {{id:number, promise:Promise<{state:WriteState, error:object|null, value:any}>}}
 *
 * ⚠️ 回傳的 promise **永遠 resolve，不會 reject**。
 *    這是刻意的：三態 UI 的前提就是「送出後不要 await」，
 *    若這裡會 reject，每個呼叫端都得記得 .catch()，忘記一次就是
 *    unhandled rejection——現場最不需要的就是這種隨機崩潰。
 *    要判斷結果請看回傳的 state，或訂閱 subscribe()。
 */
export function track(label, thunk, meta = {}) {
  const id = ++seq;
  const rec = { id, label, meta, state: 'queued', error: null, at: Date.now(), tries: 0, thunk };
  writes.set(id, rec);
  emit();
  return { id, promise: run(rec) };
}

function run(rec) {
  rec.tries += 1;
  rec.state = 'queued';
  rec.error = null;
  emit();

  const settled = (state, value) => ({ id: rec.id, state, error: rec.error, value });

  let p;
  try {
    p = rec.thunk();
  } catch (err) {                       // thunk 同步就丟例外（例如參數組錯）
    fail(rec, err);
    return Promise.resolve(settled('failed', undefined));
  }
  if (!p || typeof p.then !== 'function') {   // 不是 Promise 就當作立刻成功
    done(rec);
    return Promise.resolve(settled('saved', p));
  }

  return p.then(
    v => { done(rec); return settled('saved', v); },
    e => { fail(rec, e); return settled('failed', undefined); }
  );
}

function done(rec) {
  rec.state = 'saved';
  rec.error = null;
  // 成功的紀錄不需要留著佔記憶體，但要留一拍讓 UI 有機會顯示綠燈。
  // unref() 讓這個計時器不會擋住 Node 結束（否則 jest 會抱怨有未關閉的 handle）。
  const t = setTimeout(() => {
    if (writes.get(rec.id)?.state === 'saved') { writes.delete(rec.id); emit(); }
  }, 2000);
  t?.unref?.();
  emit();
  return rec;
}

function fail(rec, err) {
  rec.state = 'failed';
  rec.error = describeError(err);
  pruneFailed();
  emit();
  return rec;
}

/**
 * 把 Firestore 的錯誤碼翻成「下一步該做什麼」。
 * docs/08 §9：錯誤訊息要說下一步，不是只說「驗證失敗」。
 */
export function describeError(err) {
  const code = err?.code || '';
  const map = {
    'permission-denied': '權限不足。這個場次可能不在你的指派場地，或已被鎖定；請聯絡管理員處理。',
    'unauthenticated': '登入已失效，請重新登入後再送出一次。',
    'not-found': '找不到這筆資料，可能已被管理員刪除或改判。',
    'failed-precondition': '資料狀態已改變（可能有人同時修改），請重新整理後再試。',
    'invalid-argument': '資料格式有誤，請截圖回報給管理員。',
    'resource-exhausted': '寫入次數已達上限，請稍候再試。',
    'unavailable': '暫時連不上伺服器，稍後會自動重送。'
  };
  return {
    code: code || 'unknown',
    message: map[code] || (err?.message ? `送出失敗：${err.message}` : '送出失敗，請重試或截圖回報。'),
    raw: err?.message || String(err)
  };
}

function pruneFailed() {
  const failed = [...writes.values()].filter(w => w.state === 'failed').sort((a, b) => a.at - b.at);
  while (failed.length > MAX_KEPT_FAILED) writes.delete(failed.shift().id);
}

// ── 重試與清除 ───────────────────────────────────────────────

export function retry(id) {
  const rec = writes.get(id);
  if (!rec || rec.state !== 'failed') return null;
  return run(rec);
}

export function retryAll() {
  return Promise.allSettled(
    [...writes.values()].filter(w => w.state === 'failed').map(w => run(w))
  );
}

/** 放棄一筆失敗的寫入（賽務決定改用紙本補登時） */
export function dismiss(id) {
  if (writes.delete(id)) emit();
}

/** 匯出失敗內容，讓賽務可以複製給管理員（docs/04 §5.7 的 [複製內容]） */
export function exportFailed() {
  return list()
    .filter(w => w.state === 'failed')
    .map(w => `[${new Date(w.at).toISOString()}] ${w.label}\n  ${w.error?.message}\n  ${JSON.stringify(w.meta)}`)
    .join('\n\n');
}

// ── 連線狀態 ─────────────────────────────────────────────────

export function setOnline(v) {
  const next = !!v;
  if (next === online) return;
  online = next;
  emit();
  // 恢復連線時自動重試失敗的寫入。
  // 只重試「疑似網路造成」的，權限錯誤重試一百次也還是會失敗。
  if (online) {
    for (const w of writes.values()) {
      if (w.state === 'failed' && RETRYABLE.has(w.error?.code)) run(w);
    }
  }
}

const RETRYABLE = new Set(['unavailable', 'deadline-exceeded', 'internal', 'unknown', 'aborted']);

export function isOnline() { return online; }

export function initSync() {
  const g = globalThis;
  online = typeof g.navigator?.onLine === 'boolean' ? g.navigator.onLine : true;

  if (typeof g.addEventListener === 'function') {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    g.addEventListener('online', on);
    g.addEventListener('offline', off);
    detach = () => { g.removeEventListener('online', on); g.removeEventListener('offline', off); };
  }
  emit();
  return summary();
}

/** 測試與熱重載用 */
export function resetSync() {
  detach?.();
  detach = null;
  writes.clear();
  listeners.clear();
  online = true;
  seq = 0;
}
