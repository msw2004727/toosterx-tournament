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

import { db, sdk } from '../../core/firebase.js';
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
 * 建立 Game Pass。
 *
 * ⚠️ **撞號由伺服器擋，不是由前端查。** 先讀一次「這個 ID 在不在」再寫，
 *    中間那一瞬間仍然可能被別人插隊（現場幾十支手機同時在建）。
 *    rules 的 `players` 只放行 `create`，撞到已存在的文件會變成 `update`
 *    而被擋下——所以這裡把 `permission-denied` 當成「換一組再試」。
 *
 * @param {() => string} nextId 產生下一組候選編號
 * @returns {Promise<{playerId: string}>}
 */
export async function createPass({ nextId, nickname, ageBand = null, tries = 5 }) {
  const { doc, setDoc, serverTimestamp } = sdk();
  let last = null;
  for (let i = 0; i < tries; i++) {
    const playerId = nextId();
    try {
      await setDoc(doc(db(), 'events', EVENT_ID, 'players', playerId), {
        // 欄位形狀只有 engine 的 newPlayerDoc 一份（rules 用 hasOnly 逐項列）
        ...newPlayerDoc({ playerId, eventId: EVENT_ID, nickname, ageBand, createdVia: 'self' }),
        createdAt: serverTimestamp(),
        lastActiveAt: serverTimestamp()
      });
      return { playerId };
    } catch (err) {
      last = err;
      // 撞號才重試。其他錯誤（離線、規則不合）重試幾次也一樣，直接往上丟
      if (err?.code !== 'permission-denied') throw err;
    }
  }
  throw last ?? new Error('配號失敗');
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
