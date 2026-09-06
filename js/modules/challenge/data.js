/**
 * 挑戰區（玩家端）的 Firestore 存取
 * ------------------------------------------------------------------
 * 規格：docs/06 §5、§8
 *
 * 這一端**完全免登入**。`challenges` / `players` / `leaderboards` /
 * `attempts` 的讀取在 rules 都是 `allow read: if true`，前端不假裝擋任何
 * 東西——邊界在規則那邊。
 *
 * ⚠️ 寫入只有一個：建立自己的 Game Pass。**不經 `sync.track()`**——
 *    那條佇列是給賽務端「離線也要能記分」用的，而建立 Game Pass 需要
 *    立刻知道成功或失敗（撞號要換一組重試）。離線時它會失敗，
 *    畫面就照實說「連不上，等一下再試」。
 */

import { db, sdk, callFunction, user } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { EVENT_ID } from '../../config.js';
import { newPlayerDoc } from '../../engine/challenge.js';

/** 五個關卡。照 `order` 排——攤位的編號是照這個印在立牌上的 */
export async function getChallenges() {
  const { collection, getDocs, query, orderBy } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'challenges'), orderBy('order', 'asc')
  ));
  return snap.docs.map(d => ({ challengeId: d.id, ...d.data() }));
}

export async function getChallenge(challengeId) {
  const { doc, getDoc } = sdk();
  const s = await getDoc(doc(db(), 'events', EVENT_ID, 'challenges', challengeId));
  return s.exists() ? { challengeId: s.id, ...s.data() } : null;
}

/**
 * 監聽自己的 Game Pass。
 *
 * 用監聽而不是讀一次：玩家挑戰完一關，攤位一送出，這一頁的進度與抽獎
 * 張數要自己更新——玩家常常就站在攤位旁邊看著手機。
 */
export function watchPlayer(scope, playerId, cb, onError) {
  const { doc, onSnapshot } = sdk();
  const unsub = onSnapshot(doc(db(), 'events', EVENT_ID, 'players', playerId),
    s => cb(s.exists() ? { playerId: s.id, ...s.data() } : null),
    err => onError?.(err));
  return hold(scope, unsub, `challenge:player:${playerId}`);
}

export async function getPlayer(playerId) {
  const { doc, getDoc } = sdk();
  const s = await getDoc(doc(db(), 'events', EVENT_ID, 'players', playerId));
  return s.exists() ? { playerId: s.id, ...s.data() } : null;
}

/** 某一關的排行榜（Function 產的，`allow read: if true`） */
export function watchLeaderboard(scope, challengeId, cb, onError) {
  const { doc, onSnapshot } = sdk();
  const unsub = onSnapshot(doc(db(), 'events', EVENT_ID, 'leaderboards', challengeId),
    s => cb(s.exists() ? { challengeId: s.id, ...s.data() } : null),
    err => onError?.(err));
  return hold(scope, unsub, `challenge:board:${challengeId}`);
}

/** 我在各關的成績。作廢的不算——`isBest` 只會落在沒被作廢的那一筆上 */
export async function getMyBests(playerId) {
  const { collection, getDocs, query, where } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'attempts'),
    where('playerId', '==', playerId),
    where('isBest', '==', true)
  ));
  return snap.docs.map(d => ({ attemptId: d.id, ...d.data() }));
}

/** 抽獎規則。讀不到就回 null，畫面顯示「主辦尚未公布」而不是猜一個數字 */
export async function getRewards() {
  const { doc, getDoc } = sdk();
  try {
    const s = await getDoc(doc(db(), 'config', 'challengeRewards'));
    return s.exists() ? s.data() : null;
  } catch {
    return null;
  }
}

/**
 * 中獎聯絡方式（docs/06 §7.2）：走 Function，帶建卡時留在手機上的憑證本體。
 * ⚠️ callable 會 reject（跟 sync.track 相反），離線時直接失敗——呼叫端要接住並留在畫面上。
 * @returns {Promise<{playerId:string, maskedPhone:string}>}
 */
export async function setContact({ playerId, phone }) {
  return callFunction('setPlayerContact', { eventId: EVENT_ID, playerId, phone });
}

/**
 * 配發挑戰卡（綁 LINE 帳號，一人一張；再叫一次拿到同一張）。要登入。
 * @returns {Promise<{playerId:string, nickname:string|null, created:boolean}>}
 */
export async function issuePass() {
  return callFunction('issuePlayerQr', { eventId: EVENT_ID });
}

/** 用 LINE 登入的人（demo 的「切換身分」是匿名登入，不算） */
export function isLineUser(u = user()) {
  return !!u && u.isAnonymous !== true;
}

/** 把錯誤碼翻成玩家看得懂的話 */
export function explain(err, fallback = '沒有成功，請再試一次。') {
  const code = err?.code || '';
  if (code === 'permission-denied') {
    return '這組代號已經有人用了，請再按一次「開始挑戰」。';
  }
  if (code === 'unavailable' || code === 'failed-precondition') {
    return '現在連不上伺服器。請確認網路後再試一次。';
  }
  return err?.message || fallback;
}
