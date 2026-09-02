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

/** 只登出 LINE 這一側（Firebase 那側由 signOutStaff 處理） */
export async function logoutLine() {
  try {
    const liff = await initLiff();
    if (liff.isLoggedIn()) liff.logout();
  } catch { /* 載不到 SDK 就沒什麼好登出的 */ }
}

/** 給畫面用的設定資訊（不含任何機密——LIFF ID 與 Channel ID 都是公開值） */
export const liffInfo = () => ({ liffId: LIFF.liffId, channelId: LIFF.channelId });
