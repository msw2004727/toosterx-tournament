/**
 * 校時用的探測網址
 * ------------------------------------------------------------------
 * 我們只要一個東西：回應的 `Date` 標頭。但「隨便打一個網址」有三個坑，
 * 三個都踩過或差點踩到，所以這支獨立出來並有測試盯著。
 *
 * 1. **不可以用保留 ID。** 第一版打的是 `__ping__/__ping__`。
 *    Firestore 把 `__...__` 當保留識別字，所以那個請求**每一次都回 400**——
 *    程式只讀標頭，所以「壞掉但看起來能用」，代價是每一位使用者的
 *    主控台每次載入都紅一條。真正的錯誤就藏在那幾條裡面。
 *
 * 2. **不可以打單一文件。** 正式專案現在是空的（資料走管理後台匯入，
 *    R-SEED-001），`events/{id}` 與 `config/env` 在那裡都是 404。
 *    改打**集合列表**：沒有任何文件時照樣回 200 加一個空物件。
 *    實測 `feda-cup-2026` 回 200、3 bytes。
 *
 * 3. **不可以改打同源的靜態檔。** 那樣會被 Service Worker 接走
 *    （`sw.js` 對非 HTML 是 cache-first，而且離線時會忽略 query 退回快取）——
 *    拿到的是**快取那一份的舊 Date**，校時反而更錯。
 *    Firestore 是跨來源，`sw.js` 直接放行，不會有這個問題。
 *
 * 帶 `pageSize=1` 與 `mask.fieldPaths=eventId`：只要標頭，不要內容。
 */

/** 跨來源，所以 Service Worker 直接放行（見上面第 3 點） */
const PING_HOST = 'https://firestore.googleapis.com';

/** 集合列表 ＋ 只要一筆 ＋ 只要一個欄位（見上面第 1、2 點） */
const PING_PATH = 'events?pageSize=1&mask.fieldPaths=eventId';

/**
 * @param {string} projectId Firebase 專案 ID
 * @returns {string} 一個在「有資料」與「空資料庫」都回 200 的網址
 */
export function pingUrl(projectId) {
  return `${PING_HOST}/v1/projects/${projectId}/databases/(default)/documents/${PING_PATH}`;
}

/**
 * 從回應算出「伺服器時間與本機時間的差」。
 *
 * 假設往返對稱，伺服器時間對應本機的中點。誤差在往返時間之內，
 * 對「第幾分鐘」綽綽有餘。
 *
 * 讀不到或解析不出來就回 `null`——**不要回 0**。0 是一個有意義的值
 * （「時鐘完全準」），回 0 等於在沒有資料時假裝校時成功了。
 *
 * @returns {number|null} 毫秒
 */
export function offsetFrom(dateHeader, t0, t1) {
  if (!dateHeader) return null;
  const serverMs = Date.parse(dateHeader);
  if (Number.isNaN(serverMs)) return null;
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return null;
  return serverMs - (t0 + (t1 - t0) / 2);
}
