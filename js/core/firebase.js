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
import { impliedRoles, effectivePerms, EVENT_ID } from '../config.js';
import { setOnline } from './sync.js';
import { setServerOffset } from './clock.js';
import { pingUrl, offsetFrom } from '../lib/ping.js';
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
    await reloadIdentity();
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

/**
 * 目前使用者是否具備某個角色（**含繼承**）。
 * 挑戰攤位 < 檢錄員 < 裁判 < 記錄員 < 管理員 < 總管（主辦 2026-09-03 指定），
 * 所以 hasRole('checkin') 對一位記錄員會回 true。
 */
export function hasRole(...roles) {
  const mine = impliedRoles(currentStaff?.roles || []);
  return roles.some(r => mine.includes(r));
}

/** 目前使用者展開後的全部身分（含繼承）。UI 顯示與除錯用。 */
export const myRoles = () => impliedRoles(currentStaff?.roles || []);

/**
 * 權限開關矩陣（`config/rolePermissions`）。
 * 登入時載入一次；總管改過之後由授權介面自己重載。
 * 讀不到就是空物件——**空物件代表「全部走預設」**，不是「全部關閉」：
 * 讀不到設定就把賽務的按鈕全部收掉，現場會以為系統壞了。
 * 真正的防線是 rules，不是這份矩陣（R-RULES-002）。
 */
let permMatrix = {};
export const permissionMatrix = () => permMatrix;

export async function loadPermissionMatrix() {
  try {
    const { collection, getDocs } = ctx.sdk;
    const snap = await getDocs(collection(ctx.db, 'rolePermissions'));
    permMatrix = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
  } catch (e) {
    console.warn('[firebase] 讀取權限矩陣失敗，改走預設', e);
    permMatrix = {};
  }
  return permMatrix;
}

/**
 * ⭐ 前端統一的權限判斷入口。
 *
 * ⚠️ 這是**畫面層**的判斷，不是安全邊界。破壞性操作（改比分、完賽、
 *    改判、發身分）真正擋得住的是 firestore.rules；這裡回 true 不代表
 *    寫得進去，回 false 也只是把按鈕收起來。
 *    畫一顆按了會失敗的按鈕比沒有按鈕更糟，所以兩邊要一致。
 *
 * @param {string} code js/config.js 的 PERMISSIONS 代碼
 */
export function can(code) {
  return effectivePerms(currentStaff?.roles || [], permMatrix).has(code);
}

/** 目前使用者的全部權限碼（授權介面與除錯用） */
export const myPerms = () => effectivePerms(currentStaff?.roles || [], permMatrix);

// ── 常用捷徑（都走 can()，不要再自己列角色清單）──────────────
export const canScore   = () => can('match.score.write');
export const canCheckin = () => can('checkin.write');
export const canConfirm = () => can('match.confirm');
export const isLead   = () => hasRole('admin');
export const isAdmin  = () => hasRole('admin');

/** 是否被指派到這個場地（admin 不受限，未指派場地者視為全場地） */
export function assignedToVenue(venueId) {
  if (isAdmin()) return true;
  const ids = currentStaff?.assignment?.venueIds || [];
  return ids.length === 0 || ids.includes(venueId);
}

/**
 * 重新讀取身分（staff 文件 ＋ 權限矩陣）並通知所有訂閱者。
 *
 * ⚠️ 這支要 export，因為**有一種情況是登入之後才寫 staff 文件**：
 *    demo 的「切換身分」先 signInAnonymously()，再把 staff 文件寫進去。
 *    onAuthStateChanged 在第一步就觸發了，那時文件還不存在，
 *    currentStaff 會停在 null——切了身分卻什麼權限都沒有，
 *    畫面看起來只是「這個角色沒有功能」，不像壞掉（2026-09-03 回報）。
 */
export async function reloadIdentity() {
  currentStaff = currentUser ? await loadStaff(currentUser.uid) : null;
  // 有身分的人才需要權限矩陣；一般使用者與訪客不必多打一次讀取
  if (currentStaff?.roles?.length) await loadPermissionMatrix();
  else permMatrix = {};
  for (const fn of authListeners) {
    try { fn(currentUser, currentStaff); } catch (e) { console.error('[firebase] auth listener', e); }
  }
  return currentStaff;
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
 *
 * 網址怎麼挑的（三個坑）寫在 `js/lib/ping.js`。
 */
async function syncServerOffset() {
  const t0 = Date.now();
  const res = await fetch(pingUrl(FIREBASE_CONFIG.projectId), { method: 'GET', cache: 'no-store' });
  const t1 = Date.now();
  const offset = offsetFrom(res.headers.get('date'), t0, t1);
  if (offset === null) return;      // 算不出來就不動，不要用 0 假裝校時成功
  setServerOffset(offset);
}
