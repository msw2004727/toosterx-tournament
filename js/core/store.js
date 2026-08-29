/**
 * 監聽管理與 unsubscribe 回收
 * ------------------------------------------------------------------
 * 規格：docs/08-UI規範與前端架構.md §5、docs/01 §即時監聽上限
 *
 * 為什麼需要這個檔案：
 *   onSnapshot 忘記 unsubscribe 是這類 App 最常見的錯誤，症狀是
 *   「用久了越來越慢、帳單越來越貴」，而且不會有任何錯誤訊息。
 *   所以所有監聽一律經過這裡註冊，router 換頁時整批回收，
 *   超過 MAX_LISTENERS 就在開發階段丟警告。
 *
 * 交付前檢查表第 8 項：無未清除的 onSnapshot。
 */

import { MAX_LISTENERS } from '../config.js';

/** scope → Set<unsubscribe> */
const scopes = new Map();

/**
 * 註冊一個監聽。
 * @param {string} scope 通常是路由名稱；router 換頁時會 releaseScope(舊路由)
 * @param {Function} unsubscribe onSnapshot 回傳的取消函式
 * @param {string} [label] 除錯用
 */
export function hold(scope, unsubscribe, label = '') {
  if (typeof unsubscribe !== 'function') return () => {};
  if (!scopes.has(scope)) scopes.set(scope, new Set());
  const set = scopes.get(scope);
  const entry = Object.assign(unsubscribe, { __label: label });
  set.add(entry);

  if (count() > MAX_LISTENERS) {
    console.warn(
      `[store] 即時監聽數 ${count()} 已超過上限 ${MAX_LISTENERS}。`,
      '這通常代表換頁時沒有回收監聽，或是同一頁開了太多 onSnapshot。',
      describe()
    );
  }

  return () => {
    if (set.delete(entry)) { try { entry(); } catch (e) { console.error('[store] unsubscribe', e); } }
  };
}

/** 回收某個 scope 的所有監聽 */
export function releaseScope(scope) {
  const set = scopes.get(scope);
  if (!set) return 0;
  let n = 0;
  for (const fn of set) {
    try { fn(); n++; } catch (e) { console.error('[store] unsubscribe', e); }
  }
  set.clear();
  scopes.delete(scope);
  return n;
}

/** 全部回收（登出、切換環境時用） */
export function releaseAll() {
  let n = 0;
  for (const scope of [...scopes.keys()]) n += releaseScope(scope);
  return n;
}

export function count() {
  let n = 0;
  for (const set of scopes.values()) n += set.size;
  return n;
}

export function describe() {
  return [...scopes.entries()].map(([scope, set]) => ({
    scope, count: set.size, labels: [...set].map(f => f.__label).filter(Boolean)
  }));
}

// ── 簡易資料快取 ─────────────────────────────────────────────
// Firestore SDK 自己有本機快取，這裡只放「跨頁面共用、且不值得重新監聽」的東西，
// 例如目前登入者的 staff 文件與 config。

const cache = new Map();

export function put(key, value) { cache.set(key, { value, at: Date.now() }); return value; }
export function get(key, maxAgeMs = Infinity) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > maxAgeMs) { cache.delete(key); return undefined; }
  return hit.value;
}
export function drop(key) { cache.delete(key); }
export function clearCache() { cache.clear(); }

export function initStore() {
  return { hold, releaseScope, releaseAll, count };
}
