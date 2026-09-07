/**
 * 檢錄的 Firestore 存取
 * ------------------------------------------------------------------
 * 所有寫入一律經過 sync.track()，才會有三態（docs/04 §5.7）。
 *
 * ⚠️ 這裡**不 await** 任何 Firestore 的 Promise 再回報結果：
 *    離線時 setDoc() 回傳的 Promise 永遠 pending（R-UI-002）。
 *    track() 只負責把它交給 sync.js 追蹤，畫面立刻往下走。
 */

import { db, sdk, user } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { track } from '../../core/sync.js';
import { EVENT_ID } from '../../config.js';
import { rocShort } from '../../lib/roc.js';

const uid = () => user()?.uid ?? null;

const col = () => {
  const { collection } = sdk();
  return collection(db(), 'events', EVENT_ID, 'checkins');
};

/**
 * 檢錄用的球隊名單。
 *
 * ⚠️ 讀的是 **`members`**（私密），不是公開的 `roster`。
 *    檢錄要核對的「出生年月日」與「身分證後四碼」只存在 members 上——
 *    roster 是 `allow read: if true`，那兩個欄位放進去等於公開個資
 *    （ROSTER_FIELDS 白名單刻意沒有它們）。
 *    rules 只放行檢錄員以上讀 members。
 */
export async function getCheckinRoster(teamId) {
  const { collection, getDocs, query, where, orderBy } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'teams', teamId, 'members'),
    where('status', '==', 'approved'),
    orderBy('jerseyNo', 'asc')
  ));
  const rows = snap.docs.map(d => {
    const m = d.data();
    return {
      memberId: d.id,
      // 學童組是暱稱、成人組是姓名——這一頁只有檢錄員看得到，不遮
      displayName: m.name ?? null,
      jerseyNo: typeof m.jerseyNo === 'number' ? m.jerseyNo : null,
      role: m.kind ?? m.role ?? 'player',
      birthDate: m.birthDate ?? null,
      birthRoc: rocShort(m.birthDate),
      idLast4: m.idLast4 ?? null,
      // 配戴眼鏡上場（規章附件二）：裁判賽前要檢查裝備，檢錄員先看切結書收了沒
      glasses: m.glasses === true,
      glassesWaiver: m.glassesWaiver?.signed === true
    };
  });
  return sortForCheckin(rows);
}

/**
 * 球員先（依背號），隊職員後。
 *
 * ⚠️ `orderBy('jerseyNo', 'asc')` **會把沒有背號的隊職員排在最前面**——
 *    Firestore 的 null 排序是最小的。檢錄員拿著證件一個一個對，
 *    第一眼看到的卻是三位大人，而他要找的是小孩。
 *    報名審核那一頁（sortForReview）踩過同一個坑。
 */
export function sortForCheckin(rows) {
  const isStaff = m => (m?.role ?? 'player') !== 'player';
  const byNo = (a, b) => (a.jerseyNo ?? 999) - (b.jerseyNo ?? 999);
  const list = rows ?? [];
  return [...list.filter(m => !isStaff(m)).sort(byNo), ...list.filter(isStaff)];
}

/**
 * 某一場的所有檢錄紀錄。
 *
 * 文件 id 是 `${matchId}__${memberId}`，所以同一場同一人天然只會有一筆
 * （docs/01b §1.12）——重複勾選是覆寫，不會長出第二筆。
 */
export function watchCheckins(scope, matchId, cb, onError) {
  const { onSnapshot, query, where } = sdk();
  const unsub = onSnapshot(
    query(col(), where('matchId', '==', matchId)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => onError?.(err)
  );
  return hold(scope, unsub, `checkins:${matchId}`);
}

/**
 * 寫入／取消一筆檢錄。
 *
 * 取消勾選走 `result: null` 而不是刪文件：rules 的 `allow delete: if false`
 * 是刻意的——檢錄紀錄是「誰在幾點確認了誰出賽」，被取消也要留痕
 * （不可協商的產品行為第 3 條）。
 *
 * @param {boolean} clear true = 取消勾選
 */
export function saveCheckin(matchId, memberId, doc_, clear = false) {
  const { doc, setDoc, serverTimestamp } = sdk();
  const ref = doc(db(), 'events', EVENT_ID, 'checkins', `${matchId}__${memberId}`);
  const payload = {
    ...doc_,
    result: clear ? null : doc_.result,
    scannedBy: uid(),
    scannedAt: serverTimestamp(),
    syncedAt: serverTimestamp()
  };
  const label = clear ? `取消 ${doc_.memberName ?? memberId} 的檢錄` : `檢錄 ${doc_.memberName ?? memberId}`;
  // merge:true —— 同一筆會被改好幾次（勾、取消、標有問題），
  // 整份覆蓋會把先前的 note 洗掉
  return track(label, () => setDoc(ref, payload, { merge: true }), { matchId, memberId });
}

/** 給引擎當時間戳用的 serverTimestamp()（引擎自己不碰時間，R-ENG-004） */
export const stamp = () => sdk().serverTimestamp();

/**
 * 完成一隊的檢錄：把旗標寫回場次文件（patch 由 buildCheckinConfirmPatch 組）。
 *
 * 規則的 (E) 分支只放行 checkin／status／updatedAt／updatedBy，而且狀態只能在
 * 未開始／檢錄中／待開賽之間走——比分與完賽在這條路上是寫不進去的。
 * 第三輪驗收 C-5 之前，「完成檢錄」按下去什麼都沒寫，只跳一則成功提示。
 */
export function confirmCheckin(matchId, patch, label) {
  const { doc, updateDoc, serverTimestamp } = sdk();
  const ref = doc(db(), 'events', EVENT_ID, 'matches', matchId);
  return track(label, () => updateDoc(ref, { ...patch, updatedAt: serverTimestamp(), updatedBy: uid() }),
    { matchId, kind: 'checkin' });
}
