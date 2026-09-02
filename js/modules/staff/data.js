/**
 * 賽務端資料存取
 * ------------------------------------------------------------------
 * 把 Firestore 的細節集中在這裡，畫面只跟這裡打交道。
 * 所有寫入一律經過 sync.track()，才會有三態（docs/04 §5.7）。
 */

import { db, sdk, evPath, user } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { track } from '../../core/sync.js';
import { EVENT_ID } from '../../config.js';

const uid = () => user()?.uid ?? null;

// ── 監聽 ─────────────────────────────────────────────────────

/** 單一場次 */
export function watchMatch(scope, matchId, cb, onError) {
  const { doc, onSnapshot } = sdk();
  const unsub = onSnapshot(
    doc(db(), 'events', EVENT_ID, 'matches', matchId),
    { includeMetadataChanges: true },
    snap => cb(snap.exists() ? { matchId: snap.id, ...snap.data() } : null, snap.metadata),
    err => onError?.(err)
  );
  return hold(scope, unsub, `match:${matchId}`);
}

/** 某場次的事件流 */
export function watchTimeline(scope, matchId, cb, onError) {
  const { collection, onSnapshot, query, orderBy } = sdk();
  const q = query(
    collection(db(), 'events', EVENT_ID, 'matches', matchId, 'timeline'),
    orderBy('seq', 'asc')
  );
  const unsub = onSnapshot(q,
    snap => cb(snap.docs.map(d => ({ timelineId: d.id, ...d.data() }))),
    err => onError?.(err));
  return hold(scope, unsub, `timeline:${matchId}`);
}

/** 我今天負責的場次。未指派場地者看全部。 */
export function watchMyMatches(scope, { date, venueIds = [], divisionIds = [] }, cb, onError) {
  const { collection, onSnapshot, query, where, orderBy } = sdk();
  const clauses = [where('date', '==', date)];
  // Firestore 的 in 最多 30 個值，場地不會這麼多；空陣列代表不限
  if (venueIds.length) clauses.push(where('venueId', 'in', venueIds.slice(0, 30)));

  const q = query(collection(db(), 'events', EVENT_ID, 'matches'), ...clauses, orderBy('kickoffAt', 'asc'));
  // ⚠️ 一定要 includeMetadataChanges：
  //    第一筆快照來自本機快取（fromCache=true），伺服器確認後如果資料完全相同，
  //    沒有這個選項就**不會再觸發一次**，畫面會永遠卡在「目前顯示的是手機裡的資料」。
  const unsub = onSnapshot(q, { includeMetadataChanges: true }, snap => {
    let rows = snap.docs.map(d => ({ matchId: d.id, ...d.data() }));
    // 組別在客戶端過濾：多一個 where 就要多一個複合索引，不划算
    if (divisionIds.length) rows = rows.filter(m => divisionIds.includes(m.divisionId));
    cb(rows, snap.metadata);
  }, err => onError?.(err));
  return hold(scope, unsub, `myMatches:${date}`);
}

// ── 一次性讀取 ───────────────────────────────────────────────

export async function getTeamRoster(teamId) {
  const { collection, getDocs, query, orderBy } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'teams', teamId, 'roster'),
    orderBy('jerseyNo', 'asc')
  ));
  return snap.docs.map(d => ({ memberId: d.id, ...d.data() }));
}

export async function getMatchSheet(matchId, teamId) {
  const { doc, getDoc } = sdk();
  const snap = await getDoc(doc(db(), 'events', EVENT_ID, 'matchSheets', `${matchId}__${teamId}`));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getVenues() {
  const { getDocs, query, orderBy } = sdk();
  const snap = await getDocs(query(evPath('venues'), orderBy('order', 'asc')));
  return snap.docs.map(d => ({ venueId: d.id, ...d.data() }));
}

export async function getDivision(divisionId) {
  const { doc, getDoc } = sdk();
  const snap = await getDoc(doc(db(), 'events', EVENT_ID, 'divisions', divisionId));
  return snap.exists() ? { divisionId: snap.id, ...snap.data() } : null;
}

// ── 寫入（全部經過三態追蹤）─────────────────────────────────

/**
 * 更新場次。
 * 一律補上 updatedAt / updatedBy——rules 會檢查 updatedBy 必須等於自己（防冒名）。
 */
export function patchMatch(matchId, patch, label, meta = {}) {
  const { doc, updateDoc, serverTimestamp } = sdk();
  const ref = doc(db(), 'events', EVENT_ID, 'matches', matchId);
  const full = { ...patch, updatedAt: serverTimestamp(), updatedBy: uid() };
  return track(label, () => updateDoc(ref, full), { matchId, ...meta });
}

/**
 * 完賽送出。
 *
 * 與 patchMatch 的差別只在 scoreSubmittedAt：它必須是**伺服器**時間，
 * 因為三分鐘自撤回的視窗是拿它跟 rules 的 request.time 相減算出來的。
 * 引擎（buildFinishPatch）是純函式、不碰 serverTimestamp，所以在這裡補。
 */
export function submitFinish(matchId, patch, label) {
  const { doc, updateDoc, serverTimestamp } = sdk();
  const ref = doc(db(), 'events', EVENT_ID, 'matches', matchId);
  const full = {
    ...patch,
    // lock 是巢狀 map，updateDoc 會整包取代它——所以 lockedAt 要在這裡補進去，
    // 否則 docs/01b §262 定義的這個欄位會在完賽的瞬間從文件上消失。
    // 引擎（buildFinishPatch）是純函式、不碰 serverTimestamp，同 scoreSubmittedAt。
    lock: { ...patch.lock, lockedAt: serverTimestamp() },
    scoreSubmittedAt: serverTimestamp(),
    scoreSubmittedBy: uid(),
    updatedAt: serverTimestamp(),
    updatedBy: uid()
  };
  return track(label, () => updateDoc(ref, full), { matchId, kind: 'finish' });
}

/** 三分鐘內自行撤回完賽（rules 分支 D）。超時或非本人會被擋，並顯示紅燈。 */
export function undoFinish(matchId, patch, label) {
  const { doc, updateDoc, serverTimestamp } = sdk();
  const ref = doc(db(), 'events', EVENT_ID, 'matches', matchId);
  return track(label, () => updateDoc(ref, {
    ...patch, updatedAt: serverTimestamp(), updatedBy: uid()
  }), { matchId, kind: 'undo-finish' });
}

/**
 * 新增比賽事件。
 * 用固定 id（seq 補零）而非 add()：離線時 add() 產生的 id 在恢復連線後
 * 仍然唯一，但我們要的是「同一顆進球重複按兩次不會變成兩筆」。
 * R-ID-007 的例外清單裡雖然允許 timeline 用 add()，但這裡用可預測的 id 更穩。
 */
export function addTimelineEvent(matchId, event, label) {
  const { doc, setDoc, serverTimestamp } = sdk();
  const id = `${String(event.seq).padStart(4, '0')}-${event.type}`;
  const ref = doc(db(), 'events', EVENT_ID, 'matches', matchId, 'timeline', id);
  return track(label, () => setDoc(ref, { ...event, timelineId: id, createdAt: serverTimestamp() }), {
    matchId, kind: event.type, seq: event.seq
  });
}

/** 作廢事件（永不刪除，R-SEC-002） */
export function voidTimelineEvent(matchId, timelineId, reason, label) {
  const { doc, updateDoc, serverTimestamp } = sdk();
  const ref = doc(db(), 'events', EVENT_ID, 'matches', matchId, 'timeline', timelineId);
  return track(label, () => updateDoc(ref, {
    voided: true, voidedBy: uid(), voidedAt: serverTimestamp(), voidReason: reason || null
  }), { matchId, timelineId });
}

/** 稽核紀錄。只能新增，不可改不可刪。 */
export function writeAudit({ entity, entityId, action, before, after, reason }) {
  const { collection, addDoc, serverTimestamp } = sdk();
  const me = user();
  return track('寫入稽核紀錄', () => addDoc(
    collection(db(), 'events', EVENT_ID, 'audits'),
    {
      entity, entityId, action,
      actor: { uid: me?.uid ?? null, name: me?.displayName ?? null },
      before: before ?? null, after: after ?? null, reason: reason ?? null,
      createdAt: serverTimestamp()
    }
  ), { entity, entityId, action });
}

/** 確認出場名單 */
export function saveMatchSheet(matchId, teamId, data, label) {
  const { doc, setDoc, serverTimestamp } = sdk();
  const ref = doc(db(), 'events', EVENT_ID, 'matchSheets', `${matchId}__${teamId}`);
  return track(label, () => setDoc(ref, {
    matchSheetId: `${matchId}__${teamId}`, matchId, teamId, eventId: EVENT_ID,
    ...data, updatedAt: serverTimestamp(), updatedBy: uid()
  }, { merge: true }), { matchId, teamId });
}
