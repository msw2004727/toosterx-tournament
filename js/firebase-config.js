/**
 * 環境切換｜Environment resolver
 * ------------------------------------------------------------------
 * 本站沒有打包工具，因此不使用 .env。
 * 由 location.hostname 決定要連哪一組 Firebase 專案。
 *
 * 正式版  cup.toosterx.com            → feda-cup-2026
 * Demo 版 cup-demo.toosterx.com       → feda-cup-demo
 * 本機     localhost / 127.0.0.1       → feda-cup-demo（永遠不會誤連正式資料庫）
 *
 * ⚠️ 規則：新增網域時只改 PROD_HOSTS，不要在別處判斷環境。
 * ⚠️ Demo 用 cup-demo.toosterx.com 而不是 demo.cup.toosterx.com：
 *     Cloudflare 免費版 Universal SSL 只涵蓋 toosterx.com 與 *.toosterx.com，
 *     不涵蓋兩層以上的 *.cup.toosterx.com，會出現 SSL 交握失敗。
 */

const PROD_HOSTS = [
  'cup.toosterx.com',
  'www.cup.toosterx.com',
  'feda-cup.pages.dev'
];

const PROD = {
  apiKey: 'AIzaSyBS0hck7LLEuuG_LIJYIkUe0wvRNVddu68',
  authDomain: 'feda-cup-2026.firebaseapp.com',
  projectId: 'feda-cup-2026',
  storageBucket: 'feda-cup-2026.firebasestorage.app',
  messagingSenderId: '223092701593',
  appId: '1:223092701593:web:cc263b54b1d1da42b2fb08'
};

const DEMO = {
  apiKey: 'AIzaSyD5Feda3EWnI-Jye9xTzr3JO4l73LrD27A',
  authDomain: 'feda-cup-demo.firebaseapp.com',
  projectId: 'feda-cup-demo',
  storageBucket: 'feda-cup-demo.firebasestorage.app',
  messagingSenderId: '479711861820',
  appId: '1:479711861820:web:30e444a5b60032ad1b7739'
};

/** 目前是不是正式環境 */
export const IS_PROD = PROD_HOSTS.includes(location.hostname);

/** 目前是不是 Demo 環境（含本機開發） */
export const IS_DEMO = !IS_PROD;

/** 環境代號，供 UI 與稽核使用 */
export const ENV = IS_PROD ? 'prod' : 'demo';

/** 這一份就是要傳給 initializeApp() 的設定 */
export const FIREBASE_CONFIG = IS_PROD ? PROD : DEMO;

/** Cloud Functions region（兩個環境一致） */
export const FUNCTIONS_REGION = 'asia-east1';

/**
 * LIFF（LINE 登入）。
 *
 * LIFF ID 與 Channel ID 都是**公開值**——會出現在前端的網址列與 SDK 呼叫裡，
 * 放在這裡沒有安全問題。Channel secret 是另一回事，只放 Secret Manager（R-SEC-001）。
 *
 * ⚠️ 兩個 Channel 都建在 FC-Football 所屬的**同一個 LINE Provider** 底下。
 *    LINE 的 userId 是每個 Provider 一組發的，換 Provider 同一個人會拿到
 *    完全不同的 userId，而我們整個身分設計建立在「飛達盃的 uid 等於
 *    FC-Football 的 uid」上面（docs/10 §8.5）。這一步做錯要整個重來。
 */
const LIFF_PROD = { liffId: '2011382367-7GvTaaXv', channelId: '2011382367' };
const LIFF_DEMO = { liffId: '2011382448-5wfKxpsM', channelId: '2011382448' };

export const LIFF = IS_PROD ? LIFF_PROD : LIFF_DEMO;

/**
 * Demo 專屬功能開關。
 * ⚠️ 正式版必須永遠是 false —— 這些功能不是「用 flag 關掉」，
 *    而是靠 IS_DEMO 讓相關模組整段不載入（見 app.js 的動態 import）。
 */
export const DEMO_FEATURES = IS_DEMO && {
  banner: true,        // 頂部常駐 DEMO 橫幅（不可關閉）
  roleSwitcher: true,  // 免 LINE 登入的角色切換器
  resetSeed: true      // 一鍵重置種子資料
};
