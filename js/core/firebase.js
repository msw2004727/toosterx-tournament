/**
 * Firebase 初始化、離線快取與 Auth 狀態
 * ------------------------------------------------------------------
 * 規格：docs/01-架構與資料模型.md §1.1、docs/04 §2、docs/07 §1
 *
 * 沒有打包工具，所以 SDK 直接從 gstatic 以 ES module 載入並鎖版本。
 * 版本一旦更動要重新驗證離線行為——這是整個賽務端的地基。
 *
 * ⚠️ 這個檔案是唯一能決定「連哪個專案」的地方，而那件事又只由
 *    js/firebase-config.js 依 location.hostname 決定。本機一律連 demo。
 */

import { FIREBASE_CONFIG, FUNCTIONS_REGION, ENV } from '../firebase-config.js';
import { EVENT_ID } from '../config.js';
import { setOnline } from './sync.js';
import { setServerOffset } from './clock.js';
import { put, get as cacheGet } from './store.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.0.0';

/** @type {{app:*, db:*, auth:*, fns:*, sdk:*}|null} */
let ctx = null;
const authListeners = new Set();
let currentUser = null;
let currentStaff = null;

export function fb() {
  if (!ctx) throw new Error('[firebase] 尚未初始化，請先 await initFirebase()');
  return ctx;
}
export const db = () => fb().db;
export const auth = () => fb().auth;
export const sdk = () => fb().sdk;

export async function initFirebase() {
  if (ctx) return ctx;

  const [appMod, fsMod, authMod, fnMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-firestore.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-functions.js`)
  ]);

  const app = appMod.initializeApp(FIREBASE_CONFIG);

  // 離線優先：本機持久化快取 ＋ 多分頁協調。
  // 沒有這一段，飛航模式下的檢錄與記分全部做不到（docs/04 §8）。
  let db_;
  try {
    db_ = fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() })
    });
  } catch (err) {
    // 無痕視窗、關閉 IndexedDB、或瀏覽器不支援時退回記憶體快取。
    // 功能仍可用，但關閉分頁就會失去佇列——必須明講，不能靜靜降級。
    console.warn('[firebase] 無法啟用本機持久化快取，改用記憶體快取。離線佇列在關閉分頁後會遺失。', err);
    db_ = fsMod.initializeFirestore(app, { localCache: fsMod.memoryLocalCache() });
    put('persistence:degraded', true);
  }

  ctx = {
    app, db: db_,
    auth: authMod.getAuth(app),
    fns: fnMod.getFunctions(app, FUNCTIONS_REGION),
    sdk: { ...fsMod, ...authMod, httpsCallable: fnMod.httpsCallable, _fns: fnMod.getFunctions(app, FUNCTIONS_REGION) }
  };

  authMod.onAuthStateChanged(ctx.auth, async user => {
    currentUser = user || null;
    currentStaff = user ? await loadStaff(user.uid) : null;
    for (const fn of authListeners) {
      try { fn(currentUser, currentStaff); } catch (e) { console.error('[firebase] auth listener', e); }
    }
  });

  watchConnectivity();
  syncServerOffset().catch(() => { /* 校時失敗不影響使用 */ });

  console.info('[firebase] project =', FIREBASE_CONFIG.projectId, '| env =', ENV);
  return ctx;
}

/** 快取降級提示：UI 要據此顯示警告 */
export const isPersistenceDegraded = () => cacheGet('persistence:degraded') === true;

// ── Auth ─────────────────────────────────────────────────────

export function onAuth(fn) {
  authListeners.add(fn);
  fn(currentUser, currentStaff);
  return () => authListeners.delete(fn);
}

export const user = () => currentUser;
export const staff = () => currentStaff;

/** 目前使用者是否具備某個角色 */
export function hasRole(...roles) {
  const mine = currentStaff?.roles || [];
  return roles.some(r => mine.includes(r));
}

/** 賽務以上（可記分） */
export const canScore = () => hasRole('scorer', 'referee', 'admin', 'super_admin');
// 覆核／稽核閱讀權原本屬於 venue_lead，2026-08-29 起併回 admin
export const isLead   = () => hasRole('admin', 'super_admin');
export const isAdmin  = () => hasRole('admin', 'super_admin');

/** 是否被指派到這個場地（admin 不受限，未指派場地者視為全場地） */
export function assignedToVenue(venueId) {
  if (isAdmin()) return true;
  const ids = currentStaff?.assignment?.venueIds || [];
  return ids.length === 0 || ids.includes(venueId);
}

async function loadStaff(uid) {
  try {
    const { doc, getDoc } = ctx.sdk;
    const snap = await getDoc(doc(ctx.db, 'staff', uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (e) {
    console.warn('[firebase] 讀取 staff 失敗（可能離線）', e);
    return null;
  }
}

/**
 * LINE LIFF → Custom Token（docs/04 §2、docs/07 §3.4）。
 *
 * ⚠️ callable 的回傳有**兩層 data**：httpsCallable 把 Function 的回傳值包在
 *    `.data` 裡，而我們的 Function 本身回的是 `{ ok: true, data: {...} }` 信封。
 *    所以 customToken 在 `res.data.data.customToken`。
 *    先前這裡讀的是 `res.data.customToken`，永遠是 undefined——
 *    LIFF 一接上就會卡在「沒有回傳 customToken」。
 */
export async function signInWithLine(idToken) {
  const { httpsCallable, signInWithCustomToken } = ctx.sdk;
  const call = httpsCallable(ctx.sdk._fns, 'lineLogin');
  const res = await call({ idToken });
  const payload = res?.data?.data ?? res?.data ?? null;   // 兩種形狀都吃得下
  if (!payload?.customToken) throw new Error('lineLogin 沒有回傳 customToken');
  return signInWithCustomToken(ctx.auth, payload.customToken);
}

export async function signOutStaff() {
  const { signOut } = ctx.sdk;
  await signOut(ctx.auth);
}

// ── 路徑輔助 ─────────────────────────────────────────────────

export function evPath(...segs) {
  const { doc, collection } = ctx.sdk;
  const parts = ['events', EVENT_ID, ...segs];
  return parts.length % 2 === 0 ? doc(ctx.db, ...parts) : collection(ctx.db, ...parts);
}

// ── 連線偵測 ─────────────────────────────────────────────────
//
// navigator.onLine 只能告訴你「網卡有沒有連上」，連到沒有網際網路的
// 場地 Wi-Fi 時它照樣回 true。所以再用 Firestore 自己的 metadata
// （fromCache）交叉判斷：這才是「寫得出去嗎」的真實答案。

function watchConnectivity() {
  const { doc, onSnapshot } = ctx.sdk;
  try {
    onSnapshot(
      doc(ctx.db, 'events', EVENT_ID),
      { includeMetadataChanges: true },
      snap => setOnline(!snap.metadata.fromCache),
      err => { console.warn('[firebase] 連線偵測中斷', err); setOnline(false); }
    );
  } catch (e) {
    console.warn('[firebase] 無法建立連線偵測', e);
  }
}

/**
 * 伺服器時間校正。
 * 寫一筆 serverTimestamp 再讀回來太吵，改用 Firestore REST 的回應標頭：
 * 一次 fetch 就能拿到伺服器時間，誤差在往返時間之內，對「第幾分鐘」綽綽有餘。
 */
async function syncServerOffset() {
  const t0 = Date.now();
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/__ping__/__ping__`, { method: 'GET', cache: 'no-store' });
  const t1 = Date.now();
  const dateHeader = res.headers.get('date');
  if (!dateHeader) return;
  const serverMs = Date.parse(dateHeader);
  if (Number.isNaN(serverMs)) return;
  // 假設往返對稱，伺服器時間對應本機的中點
  setServerOffset(serverMs - (t0 + (t1 - t0) / 2));
}
