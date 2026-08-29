/**
 * Firebase 初始化與 Auth 狀態
 * 規格：docs/01-架構與資料模型.md §1.1
 * 狀態：TODO(M1)
 */
import { FIREBASE_CONFIG } from '../firebase-config.js';

export async function initFirebase() {
  // TODO(M1): initializeApp(FIREBASE_CONFIG) + initializeFirestore(persistentLocalCache)
  console.info('[firebase] project =', FIREBASE_CONFIG.projectId);
}
