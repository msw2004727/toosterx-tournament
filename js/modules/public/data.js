/**
 * 公開端資料存取
 * ------------------------------------------------------------------
 * 規格：docs/03-功能規格-公開端.md §2.2、§4.3、§12.4
 *
 * 公開端**只讀不寫**，所以這裡沒有 sync.track，也沒有任何 setDoc。
 *
 * 監聽預算：同時 ≤ 3（docs/03 §12.4，js/config.js 的 MAX_LISTENERS 是 4）。
 * 所有 onSnapshot 一律經 store.hold(scope, ...) 註冊，換頁自動回收（R-UI-003）。
 * 不需要即時的東西（場地、組別、名單、積分榜）一律用一次性讀取 + 快取。
 */

import { db, sdk, evPath } from '../../core/firebase.js';
import { hold, get as cacheGet, put as cachePut } from '../../core/store.js';
import { EVENT_ID } from '../../config.js';

const CACHE_MS = 5 * 60 * 1000;      // 場地、名單這類設定五分鐘內不重讀

/**
 * 組別的快取要短很多。
 *
 * ⚠️ 2026-09-05 在真站上抓到：組別本來是靜態設定，五分鐘快取完全無害。
 *    但賽程管理加了 `schedulePublished` 之後，**組別會在活動期間被改**——
 *    主辦按下「發布賽程」、拿自己的手機看公開站，最多五分鐘看不到東西，
 *    然後以為功能壞了。「按了沒反應」是最難回報的故障。
 *
 *    三十秒是折衷：換分頁、來回點組別仍然不會重讀，
 *    而發布之後最多半分鐘就看得到。組別只有六筆小文件，代價可以忽略。
 */
const DIVISION_CACHE_MS = 30 * 1000;

/* ── 監聽（即時）─────────────────────────────────────────── */

/**
 * 首頁看板。docs/03 §2.2：首頁**只監聽 1 份文件**。
 *
 * ⚠️ boards/live 由 Cloud Function 扇出寫入，而那個 Function 目前還沒上線。
 *    文件不存在時 cb 會收到 null，呼叫端要退回「直接監聽今日場次」——
 *    看板是效能最佳化，不是功能的前提。
 */
export function watchLiveBoard(scope, cb, onError) {
  const { doc, onSnapshot } = sdk();
  const unsub = onSnapshot(
    doc(db(), 'events', EVENT_ID, 'boards', 'live'),
    snap => cb(snap.exists() ? { boardId: snap.id, ...snap.data() } : null),
    err => onError?.(err)
  );
  return hold(scope, unsub, 'boards:live');
}

/** 某一天的所有場次（賽程頁；也是首頁看板不存在時的退路） */
export function watchMatchesByDate(scope, date, cb, onError) {
  const { collection, onSnapshot, query, where, orderBy } = sdk();
  const q = query(
    collection(db(), 'events', EVENT_ID, 'matches'),
    where('date', '==', date),
    orderBy('kickoffAt', 'asc')
  );
  // includeMetadataChanges：第一筆快照來自本機快取，若伺服器資料相同
  // 沒有這個選項就不會再觸發，「離線中」的提示會永遠掛著（M3 踩過）
  const unsub = onSnapshot(q, { includeMetadataChanges: true },
    snap => cb(snap.docs.map(d => ({ matchId: d.id, ...d.data() })), snap.metadata),
    err => onError?.(err));
  return hold(scope, unsub, `matches:${date}`);
}

/** 單一場次（LIVE 頁） */
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

/** 某場次的事件流。docs/03 §4.3：新的在上，最多 50 筆。 */
export function watchTimeline(scope, matchId, cb, onError) {
  const { collection, onSnapshot, query, orderBy, limit } = sdk();
  const q = query(
    collection(db(), 'events', EVENT_ID, 'matches', matchId, 'timeline'),
    orderBy('seq', 'desc'),
    limit(50)
  );
  const unsub = onSnapshot(q,
    snap => cb(snap.docs.map(d => ({ timelineId: d.id, ...d.data() }))),
    err => onError?.(err));
  return hold(scope, unsub, `timeline:${matchId}`);
}

/** 某組別的所有積分榜文件（組別頁）。 */
export function watchStandings(scope, divisionId, cb, onError) {
  const { collection, onSnapshot, query, where } = sdk();
  // 只用單一 where、排序交給前端：多一個 orderBy 就要多一個複合索引，
  // 而這裡的排序（階段→小組）是純呈現，不是資料層的事
  const q = query(
    collection(db(), 'events', EVENT_ID, 'standings'),
    where('divisionId', '==', divisionId)
  );
  const unsub = onSnapshot(q,
    snap => cb(snap.docs.map(d => ({ standingId: d.id, ...d.data() }))),
    err => onError?.(err));
  return hold(scope, unsub, `standings:${divisionId}`);
}

/* ── 一次性讀取（含快取）─────────────────────────────────── */

async function cached(key, loader, ms = CACHE_MS) {
  const hit = cacheGet(key, ms);
  if (hit !== undefined) return hit;
  return cachePut(key, await loader());
}

export function getDivisions() {
  return cached('pub:divisions', async () => {
    const { getDocs, query, orderBy } = sdk();
    const snap = await getDocs(query(evPath('divisions'), orderBy('order', 'asc')));
    return snap.docs.map(d => ({ divisionId: d.id, ...d.data() }));
  }, DIVISION_CACHE_MS);
}

export function getVenues() {
  return cached('pub:venues', async () => {
    const { getDocs, query, orderBy } = sdk();
    const snap = await getDocs(query(evPath('venues'), orderBy('order', 'asc')));
    return snap.docs.map(d => ({ venueId: d.id, ...d.data() }));
  });
}

export function getDivision(divisionId) {
  return cached(`pub:division:${divisionId}`, async () => {
    const { doc, getDoc } = sdk();
    const snap = await getDoc(doc(db(), 'events', EVENT_ID, 'divisions', divisionId));
    return snap.exists() ? { divisionId: snap.id, ...snap.data() } : null;
  }, DIVISION_CACHE_MS);
}

export function getTeam(teamId) {
  return cached(`pub:team:${teamId}`, async () => {
    const { doc, getDoc } = sdk();
    const snap = await getDoc(doc(db(), 'events', EVENT_ID, 'teams', teamId));
    return snap.exists() ? { teamId: snap.id, ...snap.data() } : null;
  });
}

/** 公開名單投影。私密欄位由 selectors.publicMember() 再擋一次。 */
export function getRoster(teamId) {
  return cached(`pub:roster:${teamId}`, async () => {
    const { collection, getDocs } = sdk();
    const snap = await getDocs(collection(db(), 'events', EVENT_ID, 'teams', teamId, 'roster'));
    return snap.docs.map(d => ({ memberId: d.id, ...d.data() }));
  });
}

/** 某組別的所有場次（組別頁的賽程分頁）。單一 where，用不到複合索引。 */
export async function getDivisionMatches(divisionId) {
  const { collection, getDocs, query, where } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'matches'),
    where('divisionId', '==', divisionId)
  ));
  return snap.docs.map(d => ({ matchId: d.id, ...d.data() }));
}

/** 某隊的所有場次（球隊頁）。teamIds 是陣列欄位，用 array-contains。 */
export async function getTeamMatches(teamId) {
  const { collection, getDocs, query, where } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'matches'),
    where('teamIds', 'array-contains', teamId)
  ));
  return snap.docs.map(d => ({ matchId: d.id, ...d.data() }));
}

/**
 * 榜單。由 Function 在每一場完賽後重算（docs/01b §1.13）。
 *
 * **是兩份文件，不是一份**：
 *   boards/scorers   射手榜   rows 是球員（playerId / name / goals）
 *   boards/fairplay  行為分   rows 是**球隊**（teamId / fairPlayPoints / yellow / red）
 * 兩者的 rows 形狀不同，畫面要分開渲染，不可以互相退回去當備援。
 *
 * ⚠️ 拿不到就回 null，畫面顯示「整理中」——
 *    **絕對不要在前端從 timeline 自己算一份**（R-ENG-001：只能有一份實作）。
 */
export async function getBoards() {
  const { doc, getDoc } = sdk();
  const one = async id => {
    const snap = await getDoc(doc(db(), 'events', EVENT_ID, 'boards', id));
    return snap.exists() ? { boardId: snap.id, ...snap.data() } : null;
  };
  const [scorers, fairplay] = await Promise.all([one('scorers'), one('fairplay')]);
  return { scorers, fairplay };
}

/**
 * 全站開關（`config/featureFlags`，公開可讀）。
 * `youthScorerBoard` 控制兒童組要不要對外顯示個人射手榜（docs/03 §9.1）。
 * 讀不到時回 `{}`——所有旗標視為未開啟，也就是**比較保守**的那一邊。
 */
export async function getFeatureFlags() {
  const { doc, getDoc } = sdk();
  const snap = await getDoc(doc(db(), 'config', 'featureFlags'));
  return snap.exists() ? snap.data() : {};
}

/**
 * 某位球員的出賽紀錄（球員頁）。
 *
 * ⚠️ 這需要一個 collectionGroup('timeline') 的複合索引與對應的 rules，
 *    兩者目前都還沒有。所以這裡把錯誤吞掉回 null，讓畫面顯示
 *    「出賽紀錄整理中」，而不是整頁紅字——摘要數字用 roster.stats 就夠了。
 *    需要的索引已列在交付說明裡。
 */
export async function getPlayerTimeline(memberId) {
  try {
    const { collectionGroup, getDocs, query, where, orderBy, limit } = sdk();
    if (typeof collectionGroup !== 'function') return null;
    const snap = await getDocs(query(
      collectionGroup(db(), 'timeline'),
      where('playerId', '==', memberId),
      orderBy('seq', 'desc'),
      limit(100)
    ));
    return snap.docs.map(d => ({ timelineId: d.id, ...d.data() }));
  } catch (err) {
    console.info('[public] 球員出賽紀錄暫時讀不到（索引或權限還沒開）', err?.code || err);
    return null;
  }
}
