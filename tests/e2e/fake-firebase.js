/**
 * 記憶體版 Firebase SDK 替身（只給 E2E 用）
 * ------------------------------------------------------------------
 * 為什麼需要它：
 *   賽務台最關鍵的行為是「按下去之後畫面怎麼變、寫入怎麼排隊」，
 *   這些單元測試測不到（它們不碰 DOM），連到真專案又太慢也不穩定。
 *   所以把 gstatic 的四個 SDK 模組換成這一份，行為刻意做得跟真的一樣：
 *
 *   ・setDoc/updateDoc 回傳的 Promise 要等「伺服器」確認才 resolve
 *   ・__goOffline() 之後 Promise 一直 pending（這正是三態的前提）
 *   ・__goOnline() 會把排隊的寫入一次送出並 resolve
 *   ・onSnapshot 立刻回一次，之後每次資料變動再回一次
 *
 * 這個檔案不進正式站，只在 Playwright 的 route 攔截中被送出。
 */

// ── 內部狀態 ─────────────────────────────────────────────────
//
// ⚠️ app.js 會 import 四個不同的 gstatic 網址（app / firestore / auth / functions），
//    Playwright 把四個都導向這一份原始碼，但瀏覽器會當成**四個獨立的模組實例**，
//    各自有一份模組作用域。若把資料放在模組變數，就會出現
//    「setDoc 寫進 firestore 實例、window.__fake 卻指向 functions 實例」
//    這種寫了卻查不到的鬼打牆。所以狀態一律掛在同一個 window 物件上共用。
const S = (typeof window !== 'undefined')
  ? (window.__FAKE_STATE ||= {
      store: new Map(), watchers: new Set(), authCbs: new Set(),
      pending: [], online: window.__FAKE_OFFLINE !== true, failNext: null,
      currentUser: window.__FAKE_USER || null, seeded: false,
      // spec 可以讓頁面「一開始就離線」，重現開頁瞬間只有快取的情境
    })
  : { store: new Map(), watchers: new Set(), authCbs: new Set(),
      pending: [], online: true, failNext: null, currentUser: null, seeded: false };

const store = S.store;
const watchers = S.watchers;
const authCbs = S.authCbs;

// spec 用 addInitScript 先設好種子與身分，模組一被求值就生效。
// 不能改用「載入後再輪詢設定」——路由守衛在初始化當下就會讀 user()，
// 慢一步就會被導去登入頁。
if (typeof window !== 'undefined' && window.__FAKE_SEED && !S.seeded) {
  S.seeded = true;
  for (const [p, d] of Object.entries(window.__FAKE_SEED)) store.set(p, structuredClone(d));
}

export function __seed(docs) {
  for (const [path, data] of Object.entries(docs)) store.set(path, structuredClone(data));
  notify();
}
export function __goOffline() { S.online = false; notify(); }
export function __goOnline() {
  S.online = true;
  const q = S.pending; S.pending = [];
  for (const p of q) { p.apply(); p.resolve(); }
  notify();
}
export function __failNext(code) { S.failNext = code; }
export function __dump() { return Object.fromEntries(store); }
export function __pendingCount() { return S.pending.length; }

if (typeof window !== 'undefined') {
  window.__fake = { __seed, __goOffline, __goOnline, __failNext, __dump, __pendingCount, __setUser };
}

function notify() {
  for (const w of [...watchers]) {
    try {
      if (w.path) w.cb(snapOf(w.path));
      else w.cb(querySnapOf(w));
    } catch (e) { console.error('[fake] watcher', e); }
  }
}

const snapOf = path => ({
  id: path.split('/').pop(),
  exists: () => store.has(path),
  data: () => structuredClone(store.get(path)),
  metadata: { fromCache: !S.online, hasPendingWrites: S.pending.length > 0 }
});

function querySnapOf(w) {
  let rows = [...store.entries()]
    .filter(([p]) => p.startsWith(w.prefix + '/') && p.slice(w.prefix.length + 1).split('/').length === 1)
    .map(([p, d]) => ({ id: p.split('/').pop(), data: () => structuredClone(d), ref: { path: p } }));
  for (const c of w.clauses || []) {
    if (c.kind === 'where') {
      rows = rows.filter(r => {
        const v = r.data()[c.field];
        if (c.op === '==') return v === c.value;
        if (c.op === 'in') return c.value.includes(v);
        return true;
      });
    }
  }
  for (const c of (w.clauses || []).filter(c => c.kind === 'orderBy')) {
    rows.sort((a, b) => cmp(a.data()[c.field], b.data()[c.field]) * (c.dir === 'desc' ? -1 : 1));
  }
  return { docs: rows, size: rows.length, metadata: { fromCache: !S.online, hasPendingWrites: S.pending.length > 0 } };
}

const cmp = (a, b) => (a == null ? 1 : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0);

/**
 * 模擬「本機立刻生效、伺服器稍後確認」
 *
 * apply(offline) 會被呼叫兩次：離線寫入的當下一次（serverTimestamp 還是 null），
 * 恢復連線送出時再一次（這次才填得出時間）。真的 Firestore 就是這樣：
 * 預設的 serverTimestamps: 'none' 讓還沒被伺服器確認的時間戳讀出來是 **null**。
 * 這件事很重要——三分鐘自撤回的倒數就是靠「時間戳還是不是 null」判斷能不能開始算。
 */
function write(path, apply, label) {
  apply(!S.online);                         // 本機立即生效
  notify();
  if (S.failNext) {
    const code = S.failNext; S.failNext = null;
    return Promise.reject(Object.assign(new Error(code), { code }));
  }
  if (!S.online) {
    return new Promise((resolve, reject) =>
      S.pending.push({ resolve, reject, apply: () => apply(false), label, path }));
  }
  return Promise.resolve();
}

// ── firebase-app ─────────────────────────────────────────────
export const initializeApp = cfg => ({ options: cfg, name: '[FAKE]' });

// ── firebase-firestore ───────────────────────────────────────
export const initializeFirestore = () => ({ __fake: true });
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const memoryLocalCache = () => ({});
export const getFirestore = () => ({ __fake: true });

export function doc(_db, ...segs) { return { __doc: true, path: segs.join('/') }; }
export function collection(_db, ...segs) { return { __col: true, path: segs.join('/') }; }

export function query(ref, ...clauses) { return { ...ref, clauses }; }
export const where = (field, op, value) => ({ kind: 'where', field, op, value });
export const orderBy = (field, dir = 'asc') => ({ kind: 'orderBy', field, dir });
export const limit = n => ({ kind: 'limit', n });

export async function getDoc(ref) { return snapOf(ref.path); }
export async function getDocs(ref) { return querySnapOf({ prefix: ref.path, clauses: ref.clauses }); }

export function onSnapshot(ref, a, b, c) {
  const cb = typeof a === 'function' ? a : b;
  const w = ref.__doc ? { path: ref.path, cb } : { prefix: ref.path, clauses: ref.clauses, cb };
  watchers.add(w);
  try { cb(ref.__doc ? snapOf(ref.path) : querySnapOf(w)); } catch (e) { console.error(e); }
  return () => watchers.delete(w);
}

export function setDoc(ref, data, opts) {
  return write(ref.path, offline => {
    const prev = opts?.merge ? (store.get(ref.path) || {}) : {};
    store.set(ref.path, { ...prev, ...resolveSentinels(data, offline) });
  });
}
export function updateDoc(ref, data) {
  return write(ref.path, offline =>
    store.set(ref.path, { ...(store.get(ref.path) || {}), ...resolveSentinels(data, offline) }));
}
export function addDoc(ref, data) {
  const id = 'auto-' + Math.random().toString(36).slice(2, 10);
  const path = `${ref.path}/${id}`;
  return write(path, offline => store.set(path, resolveSentinels(data, offline)))
    .then(() => ({ id, path }));
}
export const deleteDoc = ref => write(ref.path, () => store.delete(ref.path));

export const serverTimestamp = () => ({ __sentinel: 'ts' });
const resolveSentinels = (obj, offline = false) => JSON.parse(JSON.stringify(obj, (k, v) =>
  v && v.__sentinel === 'ts' ? (offline ? null : new Date().toISOString()) : v));

export const Timestamp = { now: () => ({ toMillis: () => Date.now() }), fromMillis: ms => ({ toMillis: () => ms }) };
export const setLogLevel = () => {};

// ── firebase-auth ────────────────────────────────────────────
export const getAuth = () => ({ __fake: true });
export function onAuthStateChanged(_auth, cb) { authCbs.add(cb); cb(S.currentUser); return () => authCbs.delete(cb); }
export async function signInAnonymously() {
  S.currentUser = { uid: 'u-e2e', isAnonymous: true, displayName: null };
  for (const cb of authCbs) cb(S.currentUser);
  return { user: S.currentUser };
}
export async function signInWithCustomToken() { return signInAnonymously(); }
export async function signOut() { S.currentUser = null; for (const cb of authCbs) cb(null); }

/** 讓 spec 直接指定身分，省掉登入流程 */
export function __setUser(u) {
  S.currentUser = u;
  for (const cb of authCbs) cb(S.currentUser);
}

// ── firebase-functions ───────────────────────────────────────
export const getFunctions = () => ({ __fake: true });
export const httpsCallable = () => async () => ({ data: {} });
