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
      stats: { getDocs: 0, getDoc: 0 },
      // spec 可以讓頁面「一開始就離線」，重現開頁瞬間只有快取的情境
    })
  : { store: new Map(), watchers: new Set(), authCbs: new Set(),
      pending: [], online: true, failNext: null, currentUser: null, seeded: false,
      stats: { getDocs: 0, getDoc: 0 } };

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

/**
 * 呼叫次數統計。用來抓「同一頁被掛載兩次」——那種 bug 畫面上看不出來
 * （兩次畫的東西一樣），只有從「同一份資料被讀了兩次」才看得到。
 *
 * ⚠️ 一定要放在共用的 S 上，不能放模組作用域：這份替身會被當成四個獨立的
 *    模組實例載入（見檔頭），getDocs 累加的那一份跟 window.__fake 指到的
 *    那一份會是不同的物件，統計永遠是 0。
 */
export const __stats = S.stats;
export function __resetStats() { S.stats.getDocs = 0; S.stats.getDoc = 0; }
export function __pendingCount() { return S.pending.length; }

if (typeof window !== 'undefined') {
  window.__fake = { __seed, __goOffline, __goOnline, __failNext, __dump, __pendingCount, __setUser, __stats, __resetStats };
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
  // collectionGroup('members')：任何深度底下、倒數第二段叫 members 的文件都算
  //（真的 Firestore 就是這樣：只看集合名，不看在哪一棵樹底下）
  const inGroup = p => { const s = p.split('/'); return s.length >= 2 && s[s.length - 2] === w.group; };
  const inCollection = p => p.startsWith(w.prefix + '/') && p.slice(w.prefix.length + 1).split('/').length === 1;
  let rows = [...store.entries()]
    .filter(([p]) => (w.group ? inGroup(p) : inCollection(p)))
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
  const lim = (w.clauses || []).find(c => c.kind === 'limit');
  if (lim) rows = rows.slice(0, lim.n);
  return { docs: rows, size: rows.length, metadata: { fromCache: !S.online, hasPendingWrites: S.pending.length > 0 } };
}

/**
 * 排序用的鍵。
 *
 * Timestamp 是**物件**，兩個物件之間的 `<` 永遠是 false——所以原本
 * `orderBy('createdAt', 'desc')` 完全沒有作用，而測試看起來是綠的
 * （順序剛好等於插入順序）。真的 Firestore 會正確排序時間。
 */
const sortKey = v => {
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  if (v && typeof v.seconds === 'number') return v.seconds * 1000 + (v.nanoseconds ?? 0) / 1e6;
  if (v instanceof Date) return v.getTime();
  return v;
};

/**
 * ⚠️ `null` 在 Firestore 的排序裡是**最小**的，不是最大。
 *    所以 `orderBy('jerseyNo', 'asc')` 會把沒有背號的隊職員排在最前面——
 *    那正是 `js/modules/admin/teams.js` 的 sortForReview() 在處理的事。
 *    這裡原本把 null 當最大，方向剛好相反，等於讓那個修正沒有被測到。
 */
const cmp = (a0, b0) => {
  const a = sortKey(a0), b = sortKey(b0);
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

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

/**
 * `doc(db, ...segs)` 或 `doc(collectionRef)`（自動 id）。
 *
 * ⚠️ 第二種形式一定要支援。真的 Firestore 用它產生自動 id
 * （audits／timeline／attempts 就是這樣寫的，R-ID-007 的例外）。
 * 少了這一段，`doc(collection(db,...))` 會拿 collection ref 當 db、
 * segs 是空的，於是**安靜地寫到路徑 ''**——測試看起來只是「資料沒出現」，
 * 不會有任何錯誤（2026-09-04 在報名審核的稽核紀錄上踩過）。
 */
let autoId = 0;
export function doc(dbOrRef, ...segs) {
  if (dbOrRef?.__col && segs.length === 0) {
    // 20 碼英數，形狀跟 Firestore 的自動 id 一致
    const id = `fake${String(++autoId).padStart(4, '0')}${'x'.repeat(12)}`;
    return { __doc: true, path: `${dbOrRef.path}/${id}`, id };
  }
  return { __doc: true, path: segs.join('/'), id: segs[segs.length - 1] };
}
export function collection(_db, ...segs) { return { __col: true, path: segs.join('/') }; }
/** 跨球隊查名單用（#/my 的「我報名的球員」）。path 只是給人看的，比對用 __group */
export function collectionGroup(_db, name) { return { __col: true, __group: name, path: `(group:${name})` }; }

export function query(ref, ...clauses) { return { ...ref, clauses }; }
export const where = (field, op, value) => ({ kind: 'where', field, op, value });
export const orderBy = (field, dir = 'asc') => ({ kind: 'orderBy', field, dir });
export const limit = n => ({ kind: 'limit', n });

export async function getDoc(ref) {
  S.stats.getDoc += 1;
  const snapshot = snapOf(ref.path);
  const delay = globalThis.window?.__FAKE_READ_DELAYS?.[ref.path] ?? 0;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  return snapshot;
}
/**
 * 模擬伺服器對某一種查詢回錯（缺複合索引、規則變更）：
 *   window.__FAKE_SNAPSHOT_FAIL = { path: 'attempts', field: 'staffUid', code: 'failed-precondition' }
 * `path` 是集合路徑的子字串；`field`（選填）要出現在 where／orderBy 裡才算——
 * 缺的是「某一組欄位」的索引，同一個集合用別的欄位查照樣成功，替身要分得出來。
 */
function failFor(ref) {
  const fail = window.__FAKE_SNAPSHOT_FAIL;
  if (!fail || !String(ref.path || '').includes(fail.path)) return null;
  if (fail.field && !(ref.clauses || []).some(c => c.field === fail.field)) return null;
  return Object.assign(new Error(fail.message || 'FAILED_PRECONDITION: The query requires an index.'), { code: fail.code || 'failed-precondition' });
}

export async function getDocs(ref) {
  S.stats.getDocs += 1;
  // 一次性查詢也會失敗：缺複合索引時真的 SDK 是 reject（驗收 D-01b）
  const err = failFor(ref);
  if (err) throw err;
  return querySnapOf({ prefix: ref.path, group: ref.__group, clauses: ref.clauses });
}

// Server-only reads reject offline; they must never silently return local cached rows.
export async function getDocFromServer(ref) {
  if (!S.online) throw Object.assign(new Error('無法從伺服器取得最新資料，請連線後重試。'), { code: 'unavailable' });
  return getDoc(ref);
}
export async function getDocsFromServer(ref) {
  if (!S.online) throw Object.assign(new Error('無法從伺服器取得最新資料，請連線後重試。'), { code: 'unavailable' });
  return getDocs(ref);
}

export function onSnapshot(ref, a, b, c) {
  const cb = typeof a === 'function' ? a : b;
  const onErr = typeof a === 'function' ? b : c;
  // 模擬伺服器回錯（見 failFor）：真的 SDK 會呼叫 onError 而且**不再送任何快照**；
  // 畫面若吞掉錯誤，那一區就靜靜消失（驗收 D-03）。
  const err = failFor(ref);
  if (err) {
    setTimeout(() => { try { onErr?.(err); } catch (e) { console.error(e); } }, 0);
    return () => {};
  }
  const w = ref.__doc ? { path: ref.path, cb } : { prefix: ref.path, group: ref.__group, clauses: ref.clauses, cb };
  watchers.add(w);
  try { cb(ref.__doc ? snapOf(ref.path) : querySnapOf(w)); } catch (e) { console.error(e); }
  return () => watchers.delete(w);
}

/**
 * `setDoc(..., { merge: true })` 的**巢狀 map 是深層合併**，不是整包取代。
 *
 * 這裡原本是淺層 `{...prev, ...next}`，於是
 * `setDoc(ref, { perms: { 'match.finish': false } }, { merge: true })`
 * 會把 `perms` 底下其他十幾條權限整組刪掉——而真的 Firestore 不會。
 *
 * 替身寫錯 schema 或行為比沒有測試更危險：它會主動證明錯的東西是對的。
 * `tests/firestore-rules/assign.test.js` 的 R109 用真的模擬器盯著這一條，
 * 這樣替身再漂移一次就會有人發現。
 *
 * ⚠️ `updateDoc` 刻意**不**深層合併：真的 Firestore 對 updateDoc 的巢狀 map
 *    就是整包取代（CLAUDE.md「已知但未修」那一條講的就是這件事）。
 */
const deepMerge = (prev, next) => {
  const out = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    const isMap = x => x && typeof x === 'object' && !Array.isArray(x);
    out[k] = isMap(v) && isMap(prev?.[k]) ? deepMerge(prev[k], v) : v;
  }
  return out;
};

export function setDoc(ref, data, opts) {
  // ⚠️ 模擬「只放行 create」的集合（rules 上 `allow create` 而沒有 `allow update`）。
  //    真的 Firestore 對已存在的文件會把 setDoc 當成 update 而擋下來，
  //    替身若照寫不誤，Game Pass 的**撞號重試就永遠測不到**——而那是
  //    配號機制唯一的安全網。替身跟真的語意分岔已經出過三次事
  //    （深層 merge、orderBy 的 Timestamp、null 排序），這是第四道。
  const denyUpdate = (window.__FAKE_CREATE_ONLY || [])
    .some(prefix => ref.path.startsWith(prefix)) && store.has(ref.path);
  if (denyUpdate) {
    return Promise.reject(Object.assign(new Error('permission-denied'), { code: 'permission-denied' }));
  }
  return write(ref.path, offline => {
    const next = resolveSentinels(data, offline);
    store.set(ref.path, opts?.merge ? deepMerge(store.get(ref.path) || {}, next) : next);
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

/**
 * 批次寫入。
 *
 * ⚠️ `set(ref, data, { merge: true })` 一定要跟 `setDoc` 走**同一支**
 *    深層合併。批次那一支寫成淺層的話，賽程管理的「只改開賽時間」
 *    會把場次上的 `home` / `away` 整組刪掉——而畫面看起來完全正常。
 *
 * 提交前不生效（真的 Firestore 也是），提交時一次套用並只通知一次：
 * 逐筆通知會讓監聽者看到「半批」的狀態，那是真的 Firestore 不會發生的事。
 */
export function writeBatch() {
  const ops = [];
  return {
    set(ref, data, opts) { ops.push({ kind: 'set', path: ref.path, data, opts }); return this; },
    update(ref, data) { ops.push({ kind: 'update', path: ref.path, data }); return this; },
    delete(ref) { ops.push({ kind: 'delete', path: ref.path }); return this; },
    commit() {
      return write(`__batch(${ops.length})`, offline => {
        for (const op of ops) {
          if (op.kind === 'delete') { store.delete(op.path); continue; }
          const next = resolveSentinels(op.data, offline);
          const prev = store.get(op.path) || {};
          if (op.kind === 'update') store.set(op.path, { ...prev, ...next });
          else store.set(op.path, op.opts?.merge ? deepMerge(prev, next) : next);
        }
      }, 'batch');
    }
  };
}

export const serverTimestamp = () => ({ __sentinel: 'ts' });
const resolveSentinels = (obj, offline = false) => JSON.parse(JSON.stringify(obj, (k, v) =>
  v && v.__sentinel === 'ts' ? (offline ? null : new Date().toISOString()) : v));

export const Timestamp = { now: () => ({ toMillis: () => Date.now() }), fromMillis: ms => ({ toMillis: () => ms }) };
export const setLogLevel = () => {};

// ── firebase-auth ────────────────────────────────────────────
export const getAuth = () => ({ __fake: true });
export async function getIdTokenResult(current) {
  return { signInProvider: current?.provider ?? (current?.isAnonymous ? 'anonymous' : 'custom') };
}
export function onAuthStateChanged(_auth, cb) {
  authCbs.add(cb);
  const delay = globalThis.window?.__FAKE_AUTH_DELAY ?? 0;
  if (delay) setTimeout(() => cb(S.currentUser), delay);
  else cb(S.currentUser);
  return () => authCbs.delete(cb);
}
export async function signInAnonymously() {
  S.currentUser = { uid: 'u-e2e', isAnonymous: true, displayName: null };
  for (const cb of authCbs) cb(S.currentUser);
  return { user: S.currentUser };
}
export async function signInWithCustomToken() {
  // 真的流程裡 uid 就是 LINE userId（docs/10 §8.5）。替身沿用同一個值，
  // 這樣「登入後看得到自己的 uid」那條測試才有意義。
  S.currentUser = window.__FAKE_LINE_USER
    || { uid: 'U7774e1410479bafff4997f51b2c47b95', displayName: '小麥', photoURL: null };
  for (const cb of authCbs) cb(S.currentUser);
  return { user: S.currentUser };
}
export async function signOut() { S.currentUser = null; for (const cb of authCbs) cb(null); }

/** 讓 spec 直接指定身分，省掉登入流程 */
export function __setUser(u) {
  S.currentUser = u;
  for (const cb of authCbs) cb(S.currentUser);
}

// ── firebase-functions ───────────────────────────────────────
export const getFunctions = () => ({ __fake: true });
/**
 * Callable 的替身。
 *
 * ⚠️ 回傳形狀要跟真的一樣是**兩層 data**：httpsCallable 把 Function 的回傳值
 *    包在 .data，而我們的 Function 本身回 `{ ok, data }` 信封（docs/07 §3.4）。
 *    替身若只回 `{ data: {} }`，「登入成功」那條路徑就永遠測不到——
 *    而那正是實機上唯一會走的路徑。
 *
 * spec 可以用 window.__FAKE_CALL_ERROR 讓呼叫失敗，測失敗的顯示。
 */
export const httpsCallable = (_fns, name) => async (payload) => {
  // 呼叫紀錄留給 spec 檢查送出去的參數。替身沒辦法真的執行 Function，
  // 所以「裁定之後積分榜長什麼樣」只能靠 test:fn 守——這裡守的是
  // 「畫面有沒有把正確的東西送出去」。
  (window.__FAKE_CALLS ||= []).push({ name, payload });
  if (window.__FAKE_CALL_ERROR) {
    const failure = window.__FAKE_CALL_ERROR;
    throw Object.assign(new Error(typeof failure === 'string' ? failure : failure.message),
      { code: typeof failure === 'string' ? 'functions/failed-precondition' : failure.code });
  }
  if (name === 'shareMatchStream') {
    // UI 接線替身；實際身份、交易、稽核與所有權由 Functions Emulator 測試驗證。
    const { sharedYoutubeId } = await import(location.origin + '/js/engine/stream-share.js');
    const base = `events/${payload.eventId}/matches/${payload.matchId}`;
    const uid = S.currentUser?.uid;
    if (!uid) throw Error('請先用 LINE 登入');
    let shareId = payload.shareId;
    if (payload.action === 'share') {
      const videoId = sharedYoutubeId(payload.url);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([payload.eventId, payload.matchId, uid, videoId])));
      shareId = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const displayName = store.get(`users/${uid}`)?.displayName || S.currentUser.displayName;
      await setDoc(doc(null, `${base}/streamShares/${shareId}`), { shareId, videoId, displayName, createdAt: new Date().toISOString() });
      await setDoc(doc(null, `${base}/streamShareOwners/${shareId}`), { ownerUid: uid });
    } else {
      await deleteDoc(doc(null, `${base}/streamShares/${shareId}`));
      await deleteDoc(doc(null, `${base}/streamShareOwners/${shareId}`));
    }
    return { data: { ok: true, data: { shareId, action: payload.action, changed: true } } };
  }
  if (name === 'generateSchedule' || name === 'manageEvent') return fakeManagement(name, payload);
  if (name === 'publishManualSchedule') {
    // UI wiring only. Authorization, locks and atomicity are tested in the emulator.
    if (window.__FAKE_MANUAL_PENDING) await window.__FAKE_MANUAL_PENDING;
    if (Object.hasOwn(window, '__FAKE_MANUAL_RESULT')) return { data: { ok: true, data: window.__FAKE_MANUAL_RESULT } };
    const receipts = (window.__FAKE_MANUAL_RECEIPTS ||= {});
    if (receipts[payload.operationId]) return { data: { ok: true, data: receipts[payload.operationId] } };
    const base = `events/${payload.eventId}`, incoming = payload.draft;
    const divisionPath = `${base}/divisions/${incoming.divisionId}`;
    const division = store.get(divisionPath);
    if ((division.scheduleRevision ?? 0) !== incoming.expectedRevision) {
      throw Object.assign(new Error('賽程已更新，請重新載入核對。'), { code: 'functions/aborted' });
    }
    const { createManualDraft, manualMatchesOf } = await import(location.origin + '/js/engine/manual-schedule.js');
    const { genericFormat } = await import(location.origin + '/js/engine/schedule.js');
    const { matchDocOf } = await import(location.origin + '/js/engine/schedule-doc.js');
    const rows = prefix => [...store.entries()].filter(([path]) => path.startsWith(prefix) && path.slice(prefix.length).split('/').length === 1).map(([, row]) => row);
    const teams = rows(`${base}/teams/`);
    const format = incoming.generated ? genericFormat(incoming.orderedTeamIds.length, { groupCount: incoming.groupCount ?? undefined }) : store.get('config/formats')?.formats?.[incoming.formatId];
    const draft = createManualDraft({ division, teams, format, existingMatches: rows(`${base}/matches/`).filter(m => m.divisionId === division.divisionId), orderedTeamIds: incoming.orderedTeamIds });
    for (const editable of incoming.matches) Object.assign(draft.matches.find(m => m.matchId === editable.matchId), editable);
    for (const match of manualMatchesOf({ draft, division, teams })) {
      const path = `${base}/matches/${match.matchId}`;
      const old = store.get(path);
      const venueName = store.get(`${base}/venues/${match.venueId}`)?.name || null;
      store.set(path, { ...(old || matchDocOf({ m: match, division, eventId: payload.eventId })), ...match, venueName });
    }
    const result = { divisionId: division.divisionId, scheduleRevision: incoming.expectedRevision + 1, published: true,
      operationId: payload.operationId, auditId: `manual-${payload.operationId}`, matchCount: incoming.matches.length };
    store.set(divisionPath, { ...division, scheduleRevision: result.scheduleRevision, schedulePublished: true });
    store.set(`${base}/audits/${result.auditId}`, { action: 'schedule.manual.publish', before: division, after: incoming, reason: payload.reason });
    receipts[payload.operationId] = result; notify();
    if (window.__FAKE_MANUAL_LOST_RESPONSE) {
      window.__FAKE_MANUAL_LOST_RESPONSE = false;
      throw Object.assign(new Error('response lost'), { code: 'functions/unavailable' });
    }
    return { data: { ok: true, data: result } };
  }
  if (name === 'updateTeamName') {
    if (window.__FAKE_TEAM_NAME_PENDING) await window.__FAKE_TEAM_NAME_PENDING;
    if (Object.hasOwn(window, '__FAKE_TEAM_NAME_RESULT')) return { data: { ok: true, data: window.__FAKE_TEAM_NAME_RESULT } };
    const receipts = (window.__FAKE_TEAM_NAME_RECEIPTS ||= {});
    if (receipts[payload.operationId]) return { data: { ok: true, data: receipts[payload.operationId] } };
    const path = `events/${payload.eventId}/teams/${payload.teamId}`;
    const result = { teamId: payload.teamId, name: payload.name, shortName: payload.shortName,
      nameRevision: payload.expected.revision + 1, operationId: payload.operationId, auditId: `rename-${payload.operationId}` };
    await updateDoc(doc(null, path), { name: result.name, shortName: result.shortName, nameRevision: result.nameRevision });
    await setDoc(doc(null, `events/${payload.eventId}/audits/${result.auditId}`), {
      action: 'team.rename', before: payload.expected, after: { name: result.name, shortName: result.shortName }, reason: payload.reason
    });
    receipts[payload.operationId] = result;
    if (window.__FAKE_TEAM_NAME_LOST_RESPONSE) {
      window.__FAKE_TEAM_NAME_LOST_RESPONSE = false;
      throw Object.assign(new Error('response lost'), { code: 'functions/unavailable' });
    }
    return { data: { ok: true, data: result } };
  }
  if (name === 'updateMemberIdentity') {
    if (Object.hasOwn(window, '__FAKE_MEMBER_RESULT')) return { data: { ok: true, data: window.__FAKE_MEMBER_RESULT } };
    if (window.__FAKE_MEMBER_PENDING) await window.__FAKE_MEMBER_PENDING;
    const receipts = (window.__FAKE_MEMBER_RECEIPTS ||= {});
    if (receipts[payload.operationId]) return { data: { ok: true, data: receipts[payload.operationId] } };
    const fields = payload.nameOnly ? { name: payload.name } : { name: payload.name, jerseyNo: payload.jerseyNo,
      birthDate: payload.birthDate, idLast4: payload.idLast4, identityComplete: !!payload.birthDate && !!payload.idLast4 };
    const result = { memberId: payload.memberId, ...fields, identityRevision: payload.revision + 1, operationId: payload.operationId, auditId: `identity-${payload.operationId}` };
    await updateDoc(doc(null, `events/${payload.eventId}/teams/${payload.teamId}/members/${payload.memberId}`), fields);
    receipts[payload.operationId] = result;
    if (window.__FAKE_MEMBER_LOST_RESPONSE) {
      window.__FAKE_MEMBER_LOST_RESPONSE = false;
      throw Object.assign(new Error('response lost'), { code: 'functions/unavailable' });
    }
    return { data: { ok: true, data: result } };
  }
  if (name === 'importTeamsCsv') {
    // 僅確認 UI 接線；交易與實際資料驗證由 tests/functions/team-import.test.js 覆蓋。
    const { parseTeamCsv, validateTeamImport } = await import(location.origin + '/js/engine/team-import.js');
    const rows = parseTeamCsv(payload.csv);
    const divisions = [...store.entries()].filter(([p]) => p.startsWith(`events/${payload.eventId}/divisions/`)).map(([, d]) => d);
    const plan = validateTeamImport(rows, { divisions, asOf: '2026-10-09' });
    return { data: { ok: true, data: { importId: 'fake-import', teamCount: plan.teams.length, playerCount: rows.length } } };
  }
  if (name === 'issuePlayerQr') {
    // 綁 LINE 帳號配發：沒登入就拒絕；有登入就配（固定 FEDA-0182，spec 可用 __FAKE_PASS_ID 換）
    const u = S.currentUser;
    if (!u || u.isAnonymous === true) throw Object.assign(new Error('請先用 LINE 登入'), { code: 'functions/unauthenticated' });
    const eventId = payload?.eventId || 'feda-cup-2026';
    const pid = window.__FAKE_PASS_ID || 'FEDA-0182';
    const path = `events/${eventId}/players/${pid}`;
    if (!store.has(path)) {
      await setDoc({ path, __doc: true }, {
        playerId: pid, eventId, nickname: u.displayName || '玩家', avatarSeed: pid.slice(-4), ageBand: null,
        completedChallengeIds: [], luckyDrawEntries: 0, createdVia: 'line', createdAt: new Date().toISOString()
      });
    }
    await setDoc({ path: `users/${u.uid}`, __doc: true }, { uid: u.uid, gamePassId: pid }, { merge: true });
    return { data: { ok: true, data: { playerId: pid, nickname: store.get(path)?.nickname ?? null, created: true } } };
  }
  if (name === 'lineLogin') {
    return {
      data: {
        ok: true,
        data: {
          customToken: 'fake-custom-token',
          profile: { uid: 'U7774e1410479bafff4997f51b2c47b95', displayName: '小麥', pictureUrl: null },
          roles: [], isStaff: false
        }
      }
    };
  }
  return { data: { ok: true, data: {} } };
};

/** 僅供 UI 接線；真正交易、競態、容量及稽核失敗由 Functions Emulator 驗證。 */
async function fakeManagement(name, p) {
  if (!S.online) throw Object.assign(new Error('管理操作需要連線'), { code: 'unavailable' });
  if (S.failNext) { const code=S.failNext;S.failNext=null;throw Object.assign(new Error(code),{code}); }
  const base=`events/${p.eventId}`, actor={uid:S.currentUser?.uid??null}, ops=[];
  const put=(path,data,merge=false)=>ops.push({path,data,merge});
  const rows=prefix=>[...store.entries()].filter(([key])=>key.startsWith(prefix)&&key.slice(prefix.length).split('/').length===1).map(([key,data])=>({...data,_path:key}));
  const audit=(action,entity,entityId,before,after,reason)=>put(`${base}/audits/${p.operationId}`,{action,entity,entityId,before,after,reason,actor,createdAt:new Date().toISOString()});
  if(name==='generateSchedule'){
    const {planGeneration,matchDocOf}=await import(location.origin+'/js/engine/schedule-doc.js');
    const {genericFormat}=await import(location.origin+'/js/engine/schedule.js');
    const division=store.get(`${base}/divisions/${p.divisionId}`), teams=Object.fromEntries(rows(`${base}/teams/`).map(t=>[t.teamId,t]));
    const format=p.generated?genericFormat(p.orderedTeamIds.length,{groupCount:p.groupCount??undefined}):store.get('config/formats')?.formats?.[p.formatId];
    const plan=planGeneration({division,orderedTeams:p.orderedTeamIds.map(id=>teams[id]),format});
    for(const m of rows(`${base}/matches/`).filter(m=>m.divisionId===p.divisionId))ops.push({path:m._path,remove:true});
    for(const st of plan.stages)put(`${base}/divisions/${p.divisionId}/stages/${st.stageId}`,st);
    for(const g of plan.groupDocs){
      put(`${base}/divisions/${p.divisionId}/stages/${g.stageId}/groups/${g.groupId}`,g);
      put(`${base}/standings/${p.divisionId}__${g.stageId}__${g.groupId}`,{divisionId:p.divisionId,stageId:g.stageId,groupId:g.groupId,rows:[],version:0});
    }
    for(const a of plan.assignments)put(`${base}/teams/${a.teamId}`,{seed:a.seed,groupId:a.groupId},true);
    for(const m of plan.matches){const id=`${m.matchId}__g-${p.operationId}`;put(`${base}/matches/${id}`,matchDocOf({m:{...m,matchId:id},division,eventId:p.eventId}));}
    if(p.generated)put('config/formats',{formats:{[format.formatId]:format}},true);
    put(`${base}/divisions/${p.divisionId}`,{formatId:p.formatId,schedulePublished:false,scheduleRevision:(division.scheduleRevision??0)+1,draw:{seed:p.drawSeed,method:p.drawSeed==null?'manual':'random'}},true);
    audit('schedule.generate','division',p.divisionId,null,{matches:plan.matches.length,formatId:p.formatId,drawSeed:p.drawSeed},p.drawSeed==null?'手動指定分組':`抽籤（種子 ${p.drawSeed}）`);
  }else if(p.matchId){
    const actions=await import(location.origin+'/js/engine/admin-match.js');
    const appeal=await import(location.origin+'/js/engine/appeal.js');
    const path=`${base}/matches/${p.matchId}`,m=store.get(path);let patch=p.patch,before=m,after=null;
    if(p.action==='match.confirm')patch=actions.buildConfirmPatch(actor.uid);
    if(p.action==='match.reopen')patch=actions.buildReopenPatch(actor.uid,rows(path+'/timeline/'));
    if(p.action==='match.override')patch=actions.buildOverridePatch({match:m,score:p.patch.score,penaltyScore:p.patch.penaltyScore,uid:actor.uid});
    if(p.action==='match.walkover')patch=actions.buildWalkoverPatch({side:p.patch.walkoverSide,uid:actor.uid});
    if(['match.postponed','match.cancelled'].includes(p.action))patch=actions.buildStatusPatch(p.action.slice(6),actor.uid);
    if(p.action.startsWith('appeal.')){
      const ap=`${base}/appeals/${p.appeal.appealId}`,previous=store.get(ap);
      const doc=p.action==='appeal.filed'?p.appeal.doc:{...previous,...appeal.buildAppealDecision({upheld:p.appeal.patch.decision.upheld,note:p.appeal.patch.decision.note,actorUid:actor.uid})};
      put(ap,doc);patch={appeal:appeal.matchAppealFlag(doc)};
      before={match:m,appeal:previous??null};after={match:{...m,...patch},appeal:doc};
    }
    if(patch.lock?.locked===true)patch={...patch,lock:{...patch.lock,lockedAt:serverTimestamp()}};
    put(path,{...patch,managementRevision:(m.managementRevision??0)+1,updatedAt:serverTimestamp(),updatedBy:actor.uid},true);
    audit(p.action,'match',p.matchId,before,after??{...m,...patch},p.reason);
  }else{
    const path=`${base}/divisions/${p.divisionId}`,division=store.get(path);
    for(const u of p.updates)put(`${base}/matches/${u.matchId}`,u.patch,true);
    if(['schedule.place','schedule.publish'].includes(p.action)){
      const {assignMatchNos}=await import(location.origin+'/js/engine/schedule.js');
      const current=rows(`${base}/matches/`).map(m=>({...m,...p.updates.find(u=>u.matchId===m.matchId)?.patch}));
      for(const n of assignMatchNos(current,{frozen:current.some(m=>!['scheduled','checkin','ready','postponed','cancelled'].includes(m.status))}))put(`${base}/matches/${n.matchId}`,{matchNo:n.matchNo},true);
    }
    const patch={scheduleRevision:(division.scheduleRevision??0)+1,...(p.action==='schedule.publish'?{schedulePublished:true}:{}),...(p.action==='schedule.unpublish'?{schedulePublished:false}:{})};
    put(path,patch,true);audit(p.action,'division',p.divisionId,division,{...division,...patch},p.reason);
  }
  for(const op of ops){if(op.remove)store.delete(op.path);else store.set(op.path,resolveSentinels(op.merge?deepMerge(store.get(op.path)||{},op.data):op.data));}
  notify();return {data:{ok:true,data:{operationId:p.operationId}}};
}
