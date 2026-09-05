/**
 * 管理後台的 Firestore 存取
 * ------------------------------------------------------------------
 * 這一層只負責讀寫。「能不能做」的權威在 firestore.rules，
 * 畫面上的 can() 只是為了不要畫出按了會失敗的按鈕。
 */

import { db, sdk, user, callFunction } from '../../core/firebase.js';
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

/**
 * 一次性讀全部球隊。
 *
 * 賽程管理用這一支而不是 `watchTeams`：編排到一半被別人的快照蓋掉，
 * 抽好的分組草稿就沒了。要看最新的資料按「再試一次」重新載入。
 */
export async function getTeams() {
  const { collection, getDocs, query, orderBy } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'teams'), orderBy('name', 'asc')
  ));
  return snap.docs.map(d => ({ teamId: d.id, ...d.data() }));
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

// ── 報名開關 ─────────────────────────────────────────────────

/**
 * 監聽報名設定。
 *
 * 用監聽而不是一次性讀取：這一頁上有一個「現在到底開不開放」的判斷，
 * 而它會隨時間變化（截止時間一到就自己翻面）。另一位總管同時在改也看得到。
 */
export function watchRegistration(scope, cb, onError) {
  const { doc, onSnapshot } = sdk();
  const unsub = onSnapshot(doc(db(), 'config', 'registration'),
    snap => cb(snap.exists() ? snap.data() : null),
    err => onError?.(err));
  return hold(scope, unsub, 'admin:registration');
}

/**
 * 寫入報名設定。
 *
 * ⚠️ 一定要 merge：這份文件上還有人數上限與費用（照規章第十二條），
 *    那些不歸這一頁管。整份覆蓋會把它們一起抹掉，而抹掉之後
 *    畫面看起來完全正常。
 */
export async function saveRegistration(patch) {
  const { doc, setDoc, serverTimestamp } = sdk();
  await setDoc(doc(db(), 'config', 'registration'), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: uid()
  }, { merge: true });
}

// ── 單一場次的改判（M4-c 補救工具）───────────────────────────

/** 一場的完整內容。監聽而不是一次讀：改判當下畫面要立刻反映。 */
export function watchMatch(scope, matchId, cb, onError) {
  const { doc, onSnapshot } = sdk();
  const unsub = onSnapshot(doc(db(), 'events', EVENT_ID, 'matches', matchId),
    snap => cb(snap.exists() ? { matchId: snap.id, ...snap.data() } : null),
    err => onError?.(err));
  return hold(scope, unsub, `admin:match:${matchId}`);
}

/**
 * 改判場次。
 *
 * ⚠️ `lock` 這種巢狀 map 由呼叫端（match-actions.js）整包給齊——
 *    `updateDoc` 對巢狀 map 是整包取代，少列一個欄位就等於刪掉它。
 *
 * ⚠️ 時間戳一律 serverTimestamp：改判的時間軸是稽核的依據，
 *    本機時間被調過就失真了。
 */
export async function patchMatch(matchId, patch) {
  const { doc, updateDoc, serverTimestamp } = sdk();
  await updateDoc(doc(db(), 'events', EVENT_ID, 'matches', matchId), {
    ...patch,
    // lock.lockedAt 只有在 patch 真的帶 lock 時才補（buildWalkoverPatch 會帶）
    ...(patch.lock && patch.lock.locked === true
      ? { lock: { ...patch.lock, lockedAt: serverTimestamp() } }
      : {}),
    updatedAt: serverTimestamp(),
    updatedBy: uid()
  });
}

/** 這一場的稽核紀錄。單一 where，用不到複合索引。 */
export async function getMatchAudits(matchId, max = 50) {
  const { collection, getDocs, query, where, limit } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'audits'),
    where('entityId', '==', matchId), limit(max)
  ));
  return snap.docs.map(d => ({ auditId: d.id, ...d.data() }));
}

// ── 賽程管理 ─────────────────────────────────────────────────

/**
 * 排程設定（開賽時間、緩衝、休息下限、各日可用場地）。
 *
 * 文件不存在時回 null，讓畫面明說「還沒設定過，用的是預設值」——
 * 悄悄套預設值的話，主辦會以為那幾個數字已經存進資料庫了。
 */
export async function getScheduleConfig() {
  const { doc, getDoc } = sdk();
  const snap = await getDoc(doc(db(), 'config', 'schedule'));
  return snap.exists() ? snap.data() : null;
}

/** ⚠️ merge：這份文件日後可能長出別的欄位，整份覆蓋會把它們抹掉 */
export async function saveScheduleConfig(patch) {
  const { doc, setDoc, serverTimestamp } = sdk();
  await setDoc(doc(db(), 'config', 'schedule'), {
    ...patch, updatedAt: serverTimestamp(), updatedBy: uid()
  }, { merge: true });
}

/** 賽制範本。通用範本產生後也寫回這裡，Cloud Functions 讀的是同一份。 */
export async function getFormats() {
  const { doc, getDoc } = sdk();
  const snap = await getDoc(doc(db(), 'config', 'formats'));
  return snap.exists() ? (snap.data().formats ?? {}) : {};
}

/**
 * 新增一個賽制範本。
 *
 * ⚠️ 一定要 merge，而且是**巢狀**的 `formats.{id}` 路徑：
 *    整份覆蓋會把規章定案的四個範本抹掉，而抹掉之後
 *    Cloud Functions 的晉級解算會在比賽當天才失敗。
 */
export async function addFormat(format) {
  const { doc, setDoc } = sdk();
  await setDoc(doc(db(), 'config', 'formats'), { formats: { [format.formatId]: format } }, { merge: true });
}

/** 一個組別的全部場次。單一 where，用不到複合索引。 */
export async function getMatchesOf(divisionId) {
  const { collection, getDocs, query, where } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'matches'), where('divisionId', '==', divisionId)
  ));
  return snap.docs.map(d => ({ matchId: d.id, ...d.data() }));
}

/**
 * 全賽事的場次。
 *
 * 衝突檢查一定要看**全部**組別：兩個組別排到同一片場地的同一個時段，
 * 只看自己那一組是看不出來的。場次總數是幾十到一百多筆，一次拉回來就好。
 */
export async function getAllMatches() {
  const { collection, getDocs } = sdk();
  const snap = await getDocs(collection(db(), 'events', EVENT_ID, 'matches'));
  return snap.docs.map(d => ({ matchId: d.id, ...d.data() }));
}

/** 場次寫入。分批送出（Firestore 一批上限 500，這裡遠遠用不到）。 */
export async function writeMatches(docsToWrite) {
  const { doc, writeBatch } = sdk();
  const CHUNK = 400;
  for (let i = 0; i < docsToWrite.length; i += CHUNK) {
    const batch = writeBatch(db());
    for (const d of docsToWrite.slice(i, i + CHUNK)) {
      batch.set(doc(db(), 'events', EVENT_ID, 'matches', d.matchId), d.data, { merge: d.merge !== false });
    }
    await batch.commit();
  }
}

/**
 * 刪除場次（重新產生時用）。
 *
 * ⚠️ Firestore 刪文件**不會刪子集合**，所以 `timeline` 會留下來成為孤兒，
 *    而且 matchId 是決定性的（`{組別碼}-{階段碼}-{小組}-{序}`）——
 *    重新產生會產出同樣的 id，舊事件就會黏回新場次上。
 *
 *    這件事被 `canRegenerate()` 擋住了：只要有任何一場開打就不准重產，
 *    而沒開打的場次不會有 timeline 事件（那是賽務台在比賽中才寫的）。
 *    **所以那個守衛不只是資料一致性的問題，也是這裡的前提。**
 *    日後若放寬重產條件，這裡要一併處理子集合。
 */
export async function deleteMatches(matchIds) {
  const { doc, writeBatch } = sdk();
  const CHUNK = 400;
  for (let i = 0; i < matchIds.length; i += CHUNK) {
    const batch = writeBatch(db());
    for (const id of matchIds.slice(i, i + CHUNK)) {
      batch.delete(doc(db(), 'events', EVENT_ID, 'matches', id));
    }
    await batch.commit();
  }
}

/** 階段與小組（積分榜與晉級解算都靠它）。 */
export async function writeStagesAndGroups(divisionId, stages, groups) {
  const { doc, writeBatch } = sdk();
  const batch = writeBatch(db());
  const base = ['events', EVENT_ID, 'divisions', divisionId, 'stages'];
  for (const st of stages) batch.set(doc(db(), ...base, st.stageId), st, { merge: true });
  for (const g of groups) {
    batch.set(doc(db(), ...base, g.stageId, 'groups', g.groupId), {
      groupId: g.groupId, name: g.name, teamIds: g.teamIds, order: g.order
    }, { merge: true });
  }
  await batch.commit();
}

/**
 * 空的積分榜。
 *
 * 產生賽程時就要建立：`resolveAdvancement` 找不到積分榜文件時是
 * fail-closed（回「找不到積分榜」），晉級會永遠解不開。
 */
export async function writeStandings(divisionId, groups, teamsById) {
  const { doc, writeBatch, serverTimestamp } = sdk();
  const batch = writeBatch(db());
  for (const g of groups) {
    const standingId = `${divisionId}__${g.stageId}__${g.groupId}`;
    batch.set(doc(db(), 'events', EVENT_ID, 'standings', standingId), {
      standingId, eventId: EVENT_ID, divisionId, stageId: g.stageId, groupId: g.groupId,
      rows: g.teamIds.map((teamId, i) => {
        const t = teamsById[teamId] ?? {};
        return {
          rank: i + 1, teamId, name: t.shortName ?? t.name ?? null, abbr: t.abbr ?? null,
          logoUrl: t.logoUrl ?? null,
          played: 0, win: 0, draw: 0, loss: 0,
          goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0,
          yellow: 0, red: 0, fairPlayPoints: 0, form: [], tieBreakTrace: [],
          locked: false, note: ''
        };
      }),
      version: 0, hasUnresolvedTie: false,
      manualOverride: { enabled: false, by: null, at: null, reason: null },
      updatedAt: serverTimestamp()
    });
  }
  await batch.commit();
}

/** 球隊的小組與種子序回填。 */
export async function writeTeamGroups(assignments) {
  const { doc, writeBatch, serverTimestamp } = sdk();
  const batch = writeBatch(db());
  for (const a of assignments) {
    batch.set(doc(db(), 'events', EVENT_ID, 'teams', a.teamId), {
      groupId: a.groupId, seed: a.seed, updatedAt: serverTimestamp(), updatedBy: uid()
    }, { merge: true });
  }
  await batch.commit();
}

/** 組別設定（賽制、發布狀態、抽籤紀錄）。 */
export async function updateDivision(divisionId, patch) {
  const { doc, setDoc, serverTimestamp } = sdk();
  await setDoc(doc(db(), 'events', EVENT_ID, 'divisions', divisionId), {
    ...patch, updatedAt: serverTimestamp(), updatedBy: uid()
  }, { merge: true });
}

/** 最早的比賽日與彩排日，給日期提醒用。讀不到就不提醒，不擋儲存。 */
export async function getScheduleBounds() {
  const { collection, getDocs, query, orderBy, limit } = sdk();
  try {
    const snap = await getDocs(query(
      collection(db(), 'events', EVENT_ID, 'divisions'), orderBy('date', 'asc'), limit(1)
    ));
    return { firstMatchDate: snap.docs[0]?.data()?.date ?? null };
  } catch {
    return { firstMatchDate: null };
  }
}

// ── 人工裁定同分 ─────────────────────────────────────────────

/**
 * 監聽全部積分榜。
 *
 * 用監聽而不是一次性讀取：主辦裁定完之後，同一頁上的「待裁定」清單
 * 要立刻少一列。裁定是低頻操作，一份監聽的成本可以接受。
 */
export function watchStandings(scope, cb, onError) {
  const { collection, onSnapshot } = sdk();
  const unsub = onSnapshot(collection(db(), 'events', EVENT_ID, 'standings'),
    snap => cb(snap.docs.map(d => ({ standingId: d.id, ...d.data() }))),
    err => onError?.(err));
  return hold(scope, unsub, 'admin:standings');
}

/**
 * 送出裁定。
 *
 * ⚠️ **不可以直接寫 `standings/`**（雖然 rules 對 admin 是放行的）。
 *    名次要由 `buildStanding` 重算一次，而重算需要 rankingRule、cardEvents、
 *    withdrawnTeamIds、mercyRule——前端自己拼一份 opts 遲早會跟管線分岔，
 *    而分岔的症狀是「積分榜的數字對不上」，不會有任何錯誤訊息。
 *    而且直接寫的話晉級不會被解算，那正是這個功能存在的理由。
 *
 * ⚠️ 這一支**會 reject**：callable 沒有離線佇列（跟 sync.track 相反）。
 *    呼叫端一定要接住並把原因留在畫面上。
 */
export async function setManualRanking(payload) {
  return callFunction('setManualRanking', { eventId: EVENT_ID, ...payload });
}

// ── 匯出（M6-d）────────────────────────────────────────────

/**
 * 全部 Game Pass。
 *
 * 一次性讀取而不是監聽：匯出是「按下去的那一刻拍一張快照」，
 * 中途被新資料蓋掉反而讓主辦搞不清楚下載到的是哪一份。
 *
 * ⚠️ 沒有分頁。現場規模是幾百人，一次讀回來沒有問題；
 *    真的破千再處理——分頁會讓「匯出的是同一個時間點」這件事變複雜。
 */
export async function getPlayers() {
  const { collection, getDocs, query, orderBy } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'players'), orderBy('playerId', 'asc')
  ));
  return snap.docs.map(d => ({ playerId: d.id, ...d.data() }));
}

/** 關卡設定。只為了知道「幾關算全破」——不可以在畫面裡寫死 5 */
export async function getChallenges() {
  const { collection, getDocs, query, orderBy } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'challenges'), orderBy('order', 'asc')
  ));
  return snap.docs.map(d => ({ challengeId: d.id, ...d.data() }));
}

// ── 直播設定（docs/03 §5，#/admin/stream）──────────────────
/** 場地整日直播：整包 stream map 寫回（updateDoc 對巢狀 map 是整包取代，欄位要寫齊） */
export async function saveVenueStream(venueId, stream) {
  const { doc, updateDoc, serverTimestamp } = sdk();
  await updateDoc(doc(db(), 'events', EVENT_ID, 'venues', venueId), {
    stream, updatedAt: serverTimestamp(), updatedBy: uid()
  });
}

// ── 申訴（規章第二十條，#/admin/match/:matchId）─────────────
export async function getAppealsOf(matchId) {
  const { collection, getDocs, query, where } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'appeals'), where('matchId', '==', matchId)
  ));
  return snap.docs.map(d => ({ appealId: d.id, ...d.data() }));
}

/** 登記：id 是 場次-隊伍（R-ID-007：doc(id).set()，不用 add） */
export async function saveAppeal(appealId, doc_) {
  const { doc, setDoc, serverTimestamp } = sdk();
  await setDoc(doc(db(), 'events', EVENT_ID, 'appeals', appealId), {
    ...doc_, receivedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
}

export async function decideAppeal(appealId, patch) {
  const { doc, updateDoc, serverTimestamp } = sdk();
  await updateDoc(doc(db(), 'events', EVENT_ID, 'appeals', appealId), {
    ...patch, decidedAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
}

// ── 抽獎中獎聯絡方式（只有管理員讀得到；寫入走 Function）──────
export async function getPlayerContacts() {
  const { collection, getDocs } = sdk();
  const snap = await getDocs(collection(db(), 'events', EVENT_ID, 'playerContacts'));
  return Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
}
