/**
 * firebase-admin 的單一入口
 * ------------------------------------------------------------------
 * 為什麼要多這一個檔案，而不是各自 `import { getFirestore } from 'firebase-admin/firestore'`：
 *
 * 專案裡有**兩份** firebase-admin——根目錄一份（測試用）、functions/ 一份（部署用）。
 * Node 依照檔案位置解析，functions/ 底下的程式碼拿到的是 functions/node_modules 那份，
 * 而從專案根目錄跑的測試若自己 initializeApp()，初始化的是另一份的 AppStore，
 * 於是 pipeline 一呼叫 getFirestore() 就是
 * 「The default Firebase app does not exist」——而且**只有在有人裝過 functions 相依之後**
 * 才會出現。CI 只在根目錄 npm ci，剛好躲過，本機一跑模擬器就炸。
 *
 * 解法：所有人都經過這個檔案拿 db。它跟 pipeline 在同一個目錄，
 * 所以不管誰 import 它，解析到的都是同一份 firebase-admin、同一個 app。
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * 冪等的初始化。
 * Function 執行時期只會跑一次；測試裡被重複 import 也不會丟
 * 「app already exists」。專案 id 由環境提供（GCLOUD_PROJECT／模擬器會設好）。
 */
export function ensureApp() {
  return getApps()[0] ?? initializeApp();
}

export function db() {
  ensureApp();
  return getFirestore();
}
