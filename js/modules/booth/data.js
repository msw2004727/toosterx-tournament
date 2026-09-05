/**
 * 攤位端資料存取
 * ------------------------------------------------------------------
 * 所有寫入一律經過 `sync.track()`，才會有送出三態（docs/04 §5.7）——
 * 挑戰攤位跟賽務台一樣，現場網路不能假設得到（docs/06 §10）。
 */

import { db, sdk, user } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { track } from '../../core/sync.js';
import { EVENT_ID } from '../../config.js';
import { newPlayerDoc } from '../../engine/challenge.js';

const uid = () => user()?.uid ?? null;
const evCol = (...segs) => {
  const { collection } = sdk();
  return collection(db(), 'events', EVENT_ID, ...segs);
};

// ── 讀 ───────────────────────────────────────────────────────

export async function getChallenges() {
  const { getDocs, query, orderBy } = sdk();
  const snap = await getDocs(query(evCol('challenges'), orderBy('order', 'asc')));
  return snap.docs.map(d => ({ challengeId: d.id, ...d.data() }));
}

export async function getChallenge(challengeId) {
  const { doc, getDoc } = sdk();
  const snap = await getDoc(doc(db(), 'events', EVENT_ID, 'challenges', challengeId));
  return snap.exists() ? { challengeId: snap.id, ...snap.data() } : null;
}

export async function getPlayer(playerId) {
  const { doc, getDoc } = sdk();
  const snap = await getDoc(doc(db(), 'events', EVENT_ID, 'players', playerId));
  return snap.exists() ? { playerId: snap.id, ...snap.data() } : null;
}

/**
 * 這位玩家在這一關的成績。
 *
 * 單一 where 加不了第二個條件就會要複合索引，所以用 `playerId` 查、
 * 在前端篩關卡——一位玩家最多也就十幾筆。
 */
export async function getPlayerAttempts(playerId, challengeId) {
  const { getDocs, query, where } = sdk();
  const snap = await getDocs(query(evCol('attempts'), where('playerId', '==', playerId)));
  return snap.docs
    .map(d => ({ attemptId: d.id, ...d.data() }))
    .filter(a => a.challengeId === challengeId);
}

/**
 * 這台裝置最近送出的紀錄（作廢用）。
 *
 * ⚠️ 用**監聽**而不是一次性讀取：離線送出的那幾筆要立刻出現在清單上
 *    （本機快取會先回，metadata.hasPendingWrites 為 true），
 *    不然攤位人員會以為沒送出去而再按一次。
 */
export function watchMyRecent(scope, cb, onError, max = 20) {
  const { onSnapshot, query, where, orderBy, limit } = sdk();
  const me = uid();
  if (!me) { cb([]); return () => {}; }
  const q = query(evCol('attempts'),
    where('staffUid', '==', me), orderBy('createdAt', 'desc'), limit(max));
  const unsub = onSnapshot(q,
    snap => cb(snap.docs.map(d => ({ attemptId: d.id, ...d.data() }))),
    err => onError?.(err));
  return hold(scope, unsub, 'booth:recent');
}

/** 一關的排行榜（送出後要顯示名次） */
export function watchLeaderboard(scope, challengeId, cb, onError) {
  const { doc, onSnapshot } = sdk();
  const unsub = onSnapshot(doc(db(), 'events', EVENT_ID, 'leaderboards', challengeId),
    snap => cb(snap.exists() ? snap.data() : null),
    err => onError?.(err));
  return hold(scope, unsub, `booth:lb:${challengeId}`);
}

// ── 寫 ───────────────────────────────────────────────────────

/**
 * 送出一筆成績。
 *
 * ⚠️ `track()` 回傳的是 `{ id, promise }`，而且那個 promise **永遠不 reject**
 *    ——失敗會變成右上角的紅燈與重試清單。呼叫端不要 `.catch()`
 *    （多一條互相競爭的錯誤通道），更不要 `await`（R-UI-002：離線時
 *    Firestore 的 setDoc 永遠 pending，畫面會卡住）。
 */
export function submitAttempt({ attemptId, doc: data }, label) {
  const { doc, setDoc, serverTimestamp } = sdk();
  const ref = doc(db(), 'events', EVENT_ID, 'attempts', attemptId);
  return track(label, () => setDoc(ref, {
    ...data,
    eventId: EVENT_ID,
    // ⚠️ 一定要 serverTimestamp：rules 的 10 分鐘作廢窗是拿這個欄位
    //    跟 request.time 比的，填本機時間會讓那道窗失效
    createdAt: serverTimestamp()
  }), { kind: 'attempt', challengeId: data.challengeId, playerId: data.playerId });
}

/** 作廢一筆（只動 voided / voidReason——rules 的白名單就這兩個） */
export function voidAttempt(attemptId, reason, label) {
  const { doc, updateDoc } = sdk();
  const ref = doc(db(), 'events', EVENT_ID, 'attempts', attemptId);
  return track(label, () => updateDoc(ref, {
    voided: true,
    voidReason: String(reason ?? '').slice(0, 200) || '攤位作廢'
  }), { kind: 'void', attemptId });
}

/**
 * 現場代建 Game Pass（docs/06 §10：玩家手機沒電）。
 *
 * 欄位受 rules 的白名單限制，而且 `completedChallengeIds` 與
 * `luckyDrawEntries` 一定要是空的／0——那兩個只有 Function 改得動。
 */
export function createPlayer({ playerId, nickname, ageBand }, label) {
  const { doc, setDoc, serverTimestamp } = sdk();
  const ref = doc(db(), 'events', EVENT_ID, 'players', playerId);
  return track(label, () => setDoc(ref, {
    // ⚠️ 欄位形狀只有 `js/engine/challenge.js` 的 newPlayerDoc 一份。
    //    rules 用 hasOnly([...]) 逐項列了准許的鍵，兩邊分岔的話會被整筆
    //    擋掉，而現場只看得到「permission-denied」。
    ...newPlayerDoc({ playerId, eventId: EVENT_ID, nickname, ageBand, createdVia: 'staff' }),
    createdAt: serverTimestamp(),
    lastActiveAt: serverTimestamp()
  }), { kind: 'player', playerId });
}

/** 把錯誤碼翻成攤位人員看得懂的話 */
export function explain(err, fallback = '沒有成功，請再試一次。') {
  const code = err?.code || '';
  if (code === 'permission-denied') {
    return '這個帳號不能登錄這一關的成績。請確認你被指派到這個攤位，或聯絡總管。';
  }
  if (code === 'unauthenticated') return '登入已失效，請重新登入。';
  if (code === 'unavailable' || code === 'failed-precondition') {
    return '現在連不上伺服器，成績已排入待同步。';
  }
  return err?.message || fallback;
}
