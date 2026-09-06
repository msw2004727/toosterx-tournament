/**
 * LINE 登入（LIFF）
 * ------------------------------------------------------------------
 * 規格：docs/04 §2、docs/10 §1.4、§8.5
 *
 * 流程：
 *   liff.init() → liff.login()（會跳去 LINE 授權再導回來）
 *     → liff.getIDToken() → Cloud Function `lineLogin` 驗證並發 custom token
 *     → signInWithCustomToken
 *
 * ⚠️ **LIFF 只在註冊過的 Endpoint URL 上運作。**
 *    Demo 的 Endpoint 是 https://cup-demo.toosterx.com，
 *    所以在 localhost 按登入會被 LINE 導去 demo 站，不會回到本機。
 *    要測登入請直接開 demo 站（docs/11 §1）。
 *
 * ⚠️ LIFF SDK 是傳統 script 不是 ES module，只能用 <script> 掛進來。
 *    載不到就必須明講「登入暫時不可用」——不要靜靜留一顆按不動的按鈕，
 *    那就是假的可用（不可協商的產品行為 #1 的同一條精神）。
 */

import { LIFF } from '../firebase-config.js';
import { signInWithLine } from './firebase.js';

const SDK_URL = 'https://static.line-scdn.net/liff/edge/2/sdk.js';

/** @type {Promise<object>|null} 只初始化一次，之後共用同一個 promise */
let ready = null;

function loadSdk() {
  if (window.liff) return Promise.resolve(window.liff);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => (window.liff ? resolve(window.liff) : reject(new Error('LIFF SDK 載入了但沒有掛上 window.liff')));
    s.onerror = () => reject(new Error('連不到 LINE 的登入服務，請確認網路後再試一次'));
    document.head.append(s);
  });
}

/**
 * 初始化 LIFF。可以重複呼叫，只會真的做一次。
 * 失敗時**不吞例外**——呼叫端要據此把登入按鈕換成錯誤訊息。
 */
export function initLiff() {
  if (!ready) {
    ready = (async () => {
      const liff = await loadSdk();
      await liff.init({ liffId: LIFF.liffId });
      return liff;
    })().catch(err => {
      ready = null;                 // 讓使用者按「再試一次」時能重來
      throw err;
    });
  }
  return ready;
}

/** 現在是不是在 LINE 內建瀏覽器裡（決定要不要顯示「用外部瀏覽器開啟」的提示） */
export async function isInLineClient() {
  try {
    return (await initLiff()).isInClient() === true;
  } catch {
    return false;
  }
}

export async function isLineLoggedIn() {
  try {
    return (await initLiff()).isLoggedIn() === true;
  } catch {
    return false;
  }
}

/**
 * 走完整套登入。
 *
 * 尚未授權時會**離開這一頁**跳去 LINE，授權後導回 `redirectUri`；
 * 所以這個函式在那條路徑上不會回傳（頁面已經走了）。
 *
 * @param {string} [redirectUri] 預設回到目前的網址（含 hash，才會停在原本那一頁）
 * @returns {Promise<{uid:string}>}
 */
export async function loginWithLine(redirectUri = location.href) {
  const liff = await initLiff();

  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri });
    // 上一行會導頁。回傳一個永不 resolve 的 promise，
    // 免得呼叫端在頁面正在離開時又跑去更新畫面。
    return new Promise(() => {});
  }

  const idToken = liff.getIDToken();
  if (!idToken) {
    // 多半是 LIFF 的 scope 沒有勾 openid（docs/11 §1 步驟 ③）
    throw new Error('拿不到 LINE 的身分憑證，請確認 LIFF 的 Scopes 有勾選 openid');
  }

  const cred = await signInWithLine(idToken);
  return { uid: cred?.user?.uid ?? null };
}

/**
 * 從 LINE 授權導回來時要落腳的頁面。
 *
 * ⚠️ **不能靠網址的 hash 記住要去哪裡。**
 *    `liff.login({ redirectUri })` 走的是 OAuth 導轉，而 `#` 之後的內容
 *    在導轉過程中會被丟掉——實測按下登入之後回來是落在公開首頁，
 *    不是 `#/login`。所以目的地存在 sessionStorage 裡，
 *    由 completeLineRedirect() 在任何一頁把它撿回來。
 */
const NEXT_KEY = 'feda:loginNext';
export const rememberNext = path => { try { sessionStorage.setItem(NEXT_KEY, path); } catch {} };
const takeNext = () => {
  try { const v = sessionStorage.getItem(NEXT_KEY); sessionStorage.removeItem(NEXT_KEY); return v; }
  catch { return null; }
};

/**
 * 網址上有沒有「剛從 LINE 導回來」的痕跡。
 * LIFF 會在 query string 留下 code/state（或 liff.state / liffClientId），
 * 只有偵測到這些才載入 LINE 的 SDK——一般訪客不該為了一個用不到的登入
 * 多付一次跨網域請求。
 */
export function hasLineRedirect() {
  const q = new URLSearchParams(location.search);
  return q.has('liff.state') || q.has('liffClientId') || (q.has('code') && q.has('state')) || q.has('error');
}

/**
 * 在**任何一頁**完成 LINE 導回後的登入換發。由 app.js 開機時呼叫。
 *
 * @returns {Promise<{done:boolean, next:string|null, error:string|null}>}
 */
export async function completeLineRedirect(alreadySignedIn = false) {
  if (!hasLineRedirect()) return { done: false, next: null, error: null };

  const next = takeNext() || '/my';

  // LINE 那一側拒絕或使用者取消時，導回來的是 error／error_description，不是 code。
  // 原因要留給登入頁（例如使用者按了取消、或頻道還在 Developing 只讓開發者登入），
  // 只說「沒有完成」的話，回報上來的永遠是「登入失敗」四個字（驗收反饋 P-2）。
  const q0 = new URLSearchParams(location.search);
  if (q0.has('error')) {
    const why = q0.get('error_description') || q0.get('error');
    cleanUrl();
    return { done: false, next, error: `LINE 沒有完成授權：${why}` };
  }

  try {
    const liff = await initLiff();          // init 會消化掉網址上的 code
    cleanUrl();
    if (alreadySignedIn) return { done: true, next, error: null };
    if (!liff.isLoggedIn()) return { done: false, next, error: 'LINE 授權沒有完成' };

    const idToken = liff.getIDToken();
    if (!idToken) return { done: false, next, error: '拿不到 LINE 的身分憑證（LIFF 的 Scopes 要勾 openid）' };

    await signInWithLine(idToken);
    return { done: true, next, error: null };
  } catch (err) {
    cleanUrl();
    return { done: false, next, error: err.message };
  }
}

/** 把 code/state 這些一次性參數從網址上抹掉，重新整理才不會又跑一次 */
function cleanUrl() {
  try {
    const url = new URL(location.href);
    for (const k of ['code', 'state', 'liff.state', 'liffClientId', 'liffRedirectUri', 'error', 'error_description']) {
      url.searchParams.delete(k);
    }
    history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
  } catch { /* 動不了網址不影響登入結果 */ }
}

/** 只登出 LINE 這一側（Firebase 那側由 signOutStaff 處理） */
export async function logoutLine() {
  try {
    const liff = await initLiff();
    if (liff.isLoggedIn()) liff.logout();
  } catch { /* 載不到 SDK 就沒什麼好登出的 */ }
}

/** 給畫面用的設定資訊（不含任何機密——LIFF ID 與 Channel ID 都是公開值） */
export const liffInfo = () => ({ liffId: LIFF.liffId, channelId: LIFF.channelId });
