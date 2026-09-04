/**
 * 管理後台的 Firestore 存取
 * ------------------------------------------------------------------
 * 這一層只負責讀寫。「能不能做」的權威在 firestore.rules，
 * 畫面上的 can() 只是為了不要畫出按了會失敗的按鈕。
 */

import { db, sdk, user } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { EVENT_ID } from '../../config.js';

const uid = () => user()?.uid ?? null;

// ── 球隊與名單 ───────────────────────────────────────────────

/**
 * 監聽全部球隊。
 *
 * 不在查詢裡篩 status：報名期間全部加起來也就幾十隊，一次拉回來在前端分頁，
 * 換分頁不用重開監聽（換一次就多一次讀取，而且切回來還要再讀一次）。
 */
export function watchTeams(scope, cb, onError) {
  const { collection, onSnapshot, query, orderBy } = sdk();
  const q = query(collection(db(), 'events', EVENT_ID, 'teams'), orderBy('name', 'asc'));
  const unsub = onSnapshot(q,
    snap => cb(snap.docs.map(d => ({ teamId: d.id, ...d.data() }))),
    err => onError?.(err));
  return hold(scope, unsub, 'admin:teams');
}

/**
 * 一支球隊的完整名單。
 *
 * ⚠️ 讀的是 `members`（私密）不是公開的 `roster`：審核要看的生日與
 *    身分證後四碼只存在 members 上（ROSTER_FIELDS 白名單刻意沒有它們）。
 */
export async function getMembers(teamId) {
  const { collection, getDocs, query, orderBy } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'teams', teamId, 'members'),
    orderBy('jerseyNo', 'asc')
  ));
  return snap.docs.map(d => ({ memberId: d.id, ...d.data() }));
}

export async function getDivisions() {
  const { collection, getDocs, query, orderBy } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'divisions'), orderBy('order', 'asc')
  ));
  return snap.docs.map(d => ({ divisionId: d.id, ...d.data() }));
}

/**
 * 寫入審核結果。
 *
 * `reviewedAt` 在這裡才補 serverTimestamp——引擎是純函式，不碰時間
 * （R-ENG-004）。
 */
export async function reviewTeam(teamId, patch) {
  const { doc, updateDoc, serverTimestamp } = sdk();
  await updateDoc(doc(db(), 'events', EVENT_ID, 'teams', teamId), {
    ...patch,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid()
  });
}

/**
 * 稽核紀錄。
 *
 * 「一切可修正、一切留痕」是不可協商的產品行為第 3 條：
 * 所有結果性資料都能改，但必留 before/after/who/when/why。
 * audits 只能新增（R-SEC-002），改不動也刪不掉。
 */
export async function writeAudit({ action, targetType, targetId, before, after, reason }) {
  const { collection, doc, setDoc, serverTimestamp } = sdk();
  const ref = doc(collection(db(), 'events', EVENT_ID, 'audits'));
  await setDoc(ref, {
    auditId: ref.id,
    eventId: EVENT_ID,
    action,
    // ⚠️ 欄位名是 `entity` / `entityId`，跟賽務端（js/modules/staff/data.js）
    //    與結果管線（functions/store.js）一致。這一支早期寫的是
    //    `targetType` / `targetId`，demo 上已經有 14 筆那種形狀——
    //    而稽核紀錄不可以改寫（R-SEC-002），所以舊的那些只能靠
    //    `js/engine/audit.js` 的 normalizeAudit() 在讀取時收斂。
    entity: targetType, entityId: targetId,
    before: before ?? null,
    after: after ?? null,
    reason: reason ?? null,
    actor: { uid: uid(), at: serverTimestamp() },
    createdAt: serverTimestamp()
  });
}

/** 把 Firestore 的錯誤碼翻成人話 */
export function explain(err, fallback = '操作沒有成功，請稍後再試。') {
  const code = err?.code || '';
  if (code === 'permission-denied') {
    return '你的身分沒有這項權限。如果剛被指派，請重新整理一次；還是不行請聯絡總管。';
  }
  if (code === 'unauthenticated') return '登入已失效，請重新用 LINE 登入。';
  if (code === 'unavailable' || code === 'failed-precondition') {
    return '現在連不上伺服器。請確認網路後再試一次。';
  }
  return err?.message || fallback;
}

// ── 身分授權 ─────────────────────────────────────────────────

/**
 * 監聽全部工作人員身分。
 *
 * 不篩 `active`：停用的也要看得見，不然復用不了，而且
 * 「這個人以前是記錄員」是查帳時要看的。
 */
export function watchStaff(scope, cb, onError) {
  const { collection, onSnapshot } = sdk();
  const unsub = onSnapshot(collection(db(), 'staff'),
    snap => cb(snap.docs.map(d => ({ uid: d.id, ...d.data() }))),
    err => onError?.(err));
  return hold(scope, unsub, 'admin:staff');
}

/**
 * 登入過的人（`users` 名錄）。
 *
 * ⚠️ 這是唯一查得到 LINE uid 的地方。uid 沒辦法憑空產生，所以
 *    「指派身分」的第一步永遠是「請對方先用 LINE 登入一次」——
 *    介面上一定要把這句話寫出來，不然總管會一直找那個人的名字。
 *
 * 一次性讀取而不是監聽：名錄只在有人第一次登入時才變，
 * 而總管指派完就離開這一頁了。
 */
export async function getUsers() {
  const { collection, getDocs } = sdk();
  const snap = await getDocs(collection(db(), 'users'));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

export async function getVenues() {
  const { collection, getDocs, query, orderBy } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'venues'), orderBy('order', 'asc')
  ));
  return snap.docs.map(d => ({ venueId: d.id, ...d.data() }));
}

/**
 * 寫入一份身分。
 *
 * 用 `setDoc` 整份覆蓋而不是 merge：改身分時舊的 `assignment.venueIds`
 * 一定要被換掉。merge 的話「從記錄員降成挑戰攤位」會留著原本的場地指派，
 * 而畫面上看不出來。
 */
export async function saveStaff(targetUid, doc_) {
  const { doc, setDoc, serverTimestamp } = sdk();
  await setDoc(doc(db(), 'staff', targetUid), {
    ...doc_,
    updatedAt: serverTimestamp(),
    updatedBy: uid()
  });
}

/** 停用／復用。只動 `active`，roles 原封不動（rules 靠這點放行）。 */
export async function setStaffActive(targetUid, patch) {
  const { doc, updateDoc, serverTimestamp } = sdk();
  await updateDoc(doc(db(), 'staff', targetUid), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: uid()
  });
}

// ── 權限開關 ─────────────────────────────────────────────────

/**
 * 監聽權限矩陣。
 *
 * 用監聽而不是一次性讀取：總管可能開兩個分頁，或是跟另一位總管
 * 同時在調。看到別人剛改的值比看到自己頁面上的舊值重要。
 */
export function watchRolePermissions(scope, cb, onError) {
  const { collection, onSnapshot } = sdk();
  const unsub = onSnapshot(collection(db(), 'rolePermissions'),
    snap => cb(Object.fromEntries(snap.docs.map(d => [d.id, d.data()]))),
    err => onError?.(err));
  return hold(scope, unsub, 'admin:rolePermissions');
}

/**
 * 改一條權限開關。
 *
 * ⚠️ 一定要 merge。整份覆蓋會把同一個角色其他權限的設定一起抹掉，
 *    而那份設定可能是賽前調好的——而且抹掉之後畫面看起來完全正常
 *    （讀不到值就走預設）。
 */
export async function setRolePermission(role, patch) {
  const { doc, setDoc, serverTimestamp } = sdk();
  await setDoc(doc(db(), 'rolePermissions', role), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: uid()
  }, { merge: true });
}

// ── 稽核紀錄 ─────────────────────────────────────────────────

/**
 * 最近的稽核紀錄。
 *
 * 用一次性讀取而不是監聽：這一頁是「回頭查」用的，不是即時看板，
 * 而且每一筆稽核都是別人操作時產生的——掛一個永久監聽只是白白多花讀取。
 *
 * ⚠️ 只 orderBy 一個欄位（`createdAt`），不在查詢裡篩 action。
 *    篩選要複合索引，而索引要另外部署——賽前臨時想加一個分類就得動
 *    `firestore.indexes.json` 再跑一次 deploy。幾百筆在前端篩就夠了。
 */
export async function getAudits(max = 200) {
  const { collection, getDocs, query, orderBy, limit } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'audits'),
    orderBy('createdAt', 'desc'), limit(max)
  ));
  return snap.docs.map(d => ({ auditId: d.id, ...d.data() }));
}

/**
 * 把 uid 與 teamId 翻成名字。
 *
 * ⚠️ 稽核紀錄上的 `actor.name` **不能信**：賽務端寫的是 Firebase 使用者的
 *    displayName，而 custom token 登入的人那一格永遠是 null（docs/10 §8.5）。
 *    權威在 `users/{uid}`，所以名字一律讀取時再查。
 *
 * 查不到就讓畫面退回 id——顯示空白會讓人以為紀錄壞了。
 */
export async function getAuditLookup() {
  const { collection, getDocs, query, orderBy } = sdk();
  const [users, staff, teams] = await Promise.all([
    getDocs(collection(db(), 'users')).catch(() => null),
    getDocs(collection(db(), 'staff')).catch(() => null),
    getDocs(query(collection(db(), 'events', EVENT_ID, 'teams'), orderBy('name', 'asc'))).catch(() => null)
  ]);
  const people = {};
  // ⚠️ staff 先鋪、users 後蓋：兩邊都有名字時以名錄（LINE 名稱）為準，
  //    但**只有 staff 有名字的人也要查得到**——用 grant-super-admin.mjs
  //    建立的總管、以及 demo 的自助身分都沒有 users 文件。
  //    少了這一段，稽核頁會印出一長串 uid（2026-09-04 在真站上看到）。
  for (const d of staff?.docs ?? []) if (d.data().name) people[d.id] = d.data().name;
  for (const d of users?.docs ?? []) {
    const n = d.data().displayName || d.data().name;
    if (n) people[d.id] = n;
  }
  return {
    people,
    teams: Object.fromEntries((teams?.docs ?? []).map(d => [d.id, d.data().name]).filter(([, v]) => v))
  };
}
