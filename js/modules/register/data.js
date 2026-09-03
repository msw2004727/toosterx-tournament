/**
 * 報名端資料存取
 * ------------------------------------------------------------------
 * 規格：docs/10 §2、§3
 *
 * 這一層只負責讀寫，判斷「能不能做」的權威在 firestore.rules
 * （R34–R64）。前端擋一次是為了給好的錯誤訊息，不是為了安全——
 * 所以這裡不重複實作規則，只在送出失敗時把原因翻成人話。
 */

import { db, sdk, user } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { EVENT_ID } from '../../config.js';

const uid = () => user()?.uid ?? null;
const teamsCol = () => {
  const { collection } = sdk();
  return collection(db(), 'events', EVENT_ID, 'teams');
};

// ── 設定 ─────────────────────────────────────────────────────

/**
 * 報名開關（docs/10 §2.3）。
 * 開放條件是 AND：`open === true` **且**現在在起訖之間。
 * 讀不到就當作關閉——跟 rules 的 fail-closed 一致，畫面才不會說「開放中」
 * 卻在送出時被擋。
 */
export async function getRegistration() {
  const { doc, getDoc } = sdk();
  try {
    const snap = await getDoc(doc(db(), 'config', 'registration'));
    return snap.exists() ? snap.data() : null;
  } catch {
    return null;
  }
}

/** @returns {{open:boolean, reason:string, closesAt:*}} */
export function registrationState(cfg, nowMs = Date.now()) {
  if (!cfg) return { open: false, reason: '報名設定還沒建立，請聯絡主辦。', closesAt: null };
  const opensAt = toMs(cfg.opensAt);
  const closesAt = toMs(cfg.closesAt);

  if (cfg.open !== true) return { open: false, reason: '報名尚未開放。', closesAt };
  if (opensAt != null && nowMs < opensAt) return { open: false, reason: '報名還沒開始。', closesAt };
  if (closesAt != null && nowMs > closesAt) return { open: false, reason: '報名已經截止。', closesAt };
  return { open: true, reason: '', closesAt };
}

const toMs = v => (v?.toMillis ? v.toMillis() : typeof v === 'number' ? v : null);

/** 單一組別設定。讀不到回 null——上層一律 fail-closed。 */
export async function getDivision(divisionId) {
  const { doc, getDoc } = sdk();
  try {
    const snap = await getDoc(doc(db(), 'events', EVENT_ID, 'divisions', String(divisionId || '')));
    return snap.exists() ? { divisionId: snap.id, ...snap.data() } : null;
  } catch {
    return null;
  }
}

export async function getDivisions() {
  const { getDocs, query, orderBy, collection } = sdk();
  const snap = await getDocs(query(
    collection(db(), 'events', EVENT_ID, 'divisions'), orderBy('order', 'asc')
  ));
  return snap.docs.map(d => ({ divisionId: d.id, ...d.data() }));
}

// ── 球隊 ─────────────────────────────────────────────────────

export async function getTeam(teamId) {
  const { doc, getDoc } = sdk();
  const snap = await getDoc(doc(db(), 'events', EVENT_ID, 'teams', teamId));
  return snap.exists() ? { teamId: snap.id, ...snap.data() } : null;
}

/** 用邀請碼找球隊。碼是公開的——知道碼只能「申請」，隊長同意才是閘門（§3.3）。 */
export async function findTeamByInviteCode(code) {
  const { getDocs, query, where, limit } = sdk();
  const snap = await getDocs(query(teamsCol(), where('inviteCode', '==', String(code).toUpperCase()), limit(1)));
  const d = snap.docs[0];
  return d ? { teamId: d.id, ...d.data() } : null;
}

export function watchTeam(scope, teamId, cb, onError) {
  const { doc, onSnapshot } = sdk();
  const unsub = onSnapshot(doc(db(), 'events', EVENT_ID, 'teams', teamId),
    snap => cb(snap.exists() ? { teamId: snap.id, ...snap.data() } : null),
    err => onError?.(err));
  return hold(scope, unsub, `team:${teamId}`);
}

export function watchMembers(scope, teamId, cb, onError) {
  const { collection, onSnapshot, query, orderBy } = sdk();
  const q = query(
    collection(db(), 'events', EVENT_ID, 'teams', teamId, 'members'),
    orderBy('appliedAt', 'asc')
  );
  const unsub = onSnapshot(q,
    snap => cb(snap.docs.map(d => ({ memberId: d.id, ...d.data() }))),
    err => onError?.(err));
  return hold(scope, unsub, `members:${teamId}`);
}

/**
 * 邀請碼：6 碼英數。
 * 去掉 I O 0 1——現場要用嘴巴念給隊友聽，那四個字太容易聽錯。
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeInviteCode(rand = () => Math.random()) {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return out;
}

/** 建立球隊。id 用可讀的前綴＋亂數，避免 add() 產生看不懂的 id（R-ID-007）。 */
export async function createTeam({ name, shortName, divisionId, contact }) {
  const { doc, setDoc, serverTimestamp } = sdk();
  const teamId = `t-${makeInviteCode().toLowerCase()}`;
  const ref = doc(db(), 'events', EVENT_ID, 'teams', teamId);

  await setDoc(ref, {
    teamId, eventId: EVENT_ID, divisionId,
    name, shortName: shortName || name.slice(0, 4), abbr: null, colorPrimary: null,
    captainUid: uid(), captainName: null,
    contact: { phone: contact?.phone || null, email: contact?.email || null, lineDisplayName: null },
    status: 'draft',
    submittedAt: null, reviewedAt: null, reviewedBy: null, rejectReason: null,
    inviteCode: makeInviteCode(),
    announcement: { text: null, updatedAt: null, updatedBy: null },
    rosterLocked: false,
    memberCount: 0,
    seed: null, finalRank: null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: uid()
  });
  return teamId;
}

export async function patchTeam(teamId, patch) {
  const { doc, updateDoc, serverTimestamp } = sdk();
  await updateDoc(doc(db(), 'events', EVENT_ID, 'teams', teamId), {
    ...patch, updatedAt: serverTimestamp(), updatedBy: uid()
  });
}

// ── 名單 ─────────────────────────────────────────────────────

/**
 * 送出加入申請。**一定是 pending**——隊長同意才是閘門（§3.3），
 * rules 也只放行 pending（R56）。
 */
export async function applyMember(teamId, { name, birthDate, idLast4, jerseyNo, position, kind, isSelf }) {
  const { doc, setDoc, serverTimestamp } = sdk();
  const memberId = `m-${makeInviteCode().toLowerCase()}`;
  await setDoc(doc(db(), 'events', EVENT_ID, 'teams', teamId, 'members', memberId), {
    memberId,
    guardianUid: uid(), isSelf: isSelf === true,
    name, birthDate: birthDate || null, idLast4: idLast4 || null,
    jerseyNo: typeof jerseyNo === 'number' ? jerseyNo : null,
    position: position || null,
    kind: kind || 'player', role: kind || 'player',
    status: 'pending',
    appliedAt: serverTimestamp(), decidedAt: null, decidedBy: null,
    note: '',
    // 家長本人送出即為同意，存下來當證據（docs/10 §1.3）
    consent: { given: true, at: serverTimestamp(), byUid: uid() },
    source: isSelf === true ? 'self' : 'guardian',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  return memberId;
}

/**
 * 教練（球隊負責人）直接新增一位成員。
 *
 * 學童三組走這條，不走邀請碼（主辦 2026-09-03 指定）：小球員沒有 LINE
 * 帳號，家長也不見得會操作。填的是**暱稱**、身分證後四碼、出生年月日，
 * 檢錄當天由教練帶證件與大會名單核對。
 *
 * 與 applyMember() 的三個差別，每一個 firestore.rules 都在看（R65–R72）：
 *   ・`status` 直接是 approved——隊長本來就是那個閘門，不必再自己同意一次
 *   ・`source: 'coach'`＋`addedBy`——rules 靠它判斷「這筆是隊長自己填的」，
 *     家長送來的那幾筆隊長只能同意或婉拒，不能改內容
 *   ・**不寫 guardianUid**。寫了的話那位家長就能用「本人」的身分改這一筆
 *
 * @param {string} teamId
 * @param {object} m { name, birthDate(西元 ISO), idLast4, jerseyNo, position, kind }
 */
export async function addMemberByCoach(teamId, { name, birthDate, idLast4, jerseyNo, position, kind }) {
  const { doc, setDoc, serverTimestamp } = sdk();
  const memberId = `m-${makeInviteCode().toLowerCase()}`;
  await setDoc(doc(db(), 'events', EVENT_ID, 'teams', teamId, 'members', memberId), {
    memberId,
    guardianUid: null, addedBy: uid(), isSelf: false,
    name,
    // 暱稱不是真名，公開投影不必再遮一次（見 js/engine/privacy.js）
    nameKind: 'nickname',
    birthDate: birthDate || null,
    idLast4: idLast4 || null,
    jerseyNo: typeof jerseyNo === 'number' ? jerseyNo : null,
    position: position || null,
    kind: kind || 'player', role: kind || 'player',
    status: 'approved',
    appliedAt: serverTimestamp(), decidedAt: serverTimestamp(), decidedBy: uid(),
    note: '',
    // 由球隊負責人代填並負責，不是家長本人按的同意（docs/10 §1.3）
    consent: { given: true, at: serverTimestamp(), byUid: uid(), by: 'teamLead' },
    source: 'coach',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  return memberId;
}

/** 教練改自己填的那一筆。rules 只放行 source === 'coach' 的文件（R69）。 */
export async function editMemberByCoach(teamId, memberId, { name, birthDate, idLast4, jerseyNo, position, kind }) {
  const { doc, updateDoc, serverTimestamp } = sdk();
  await updateDoc(doc(db(), 'events', EVENT_ID, 'teams', teamId, 'members', memberId), {
    name,
    birthDate: birthDate || null,
    idLast4: idLast4 || null,
    jerseyNo: typeof jerseyNo === 'number' ? jerseyNo : null,
    position: position || null,
    kind: kind || 'player', role: kind || 'player',
    updatedAt: serverTimestamp()
  });
}

export async function decideMember(teamId, memberId, status) {
  const { doc, updateDoc, serverTimestamp } = sdk();
  await updateDoc(doc(db(), 'events', EVENT_ID, 'teams', teamId, 'members', memberId), {
    status, decidedAt: serverTimestamp(), decidedBy: uid(), updatedAt: serverTimestamp()
  });
}

export async function setMemberNote(teamId, memberId, note) {
  const { doc, updateDoc, serverTimestamp } = sdk();
  await updateDoc(doc(db(), 'events', EVENT_ID, 'teams', teamId, 'members', memberId), {
    note: String(note ?? '').slice(0, 200), updatedAt: serverTimestamp()
  });
}

// ── 錯誤翻譯 ─────────────────────────────────────────────────

/**
 * 把 Firestore 的錯誤碼翻成人話。
 * `permission-denied` 在這個流程裡幾乎都是「報名關了」或「名單凍結了」——
 * 直接說「權限不足」對報名的家長毫無幫助。
 */
export function explain(err, fallback = '送出沒有成功，請稍後再試。') {
  const code = err?.code || '';
  if (code === 'permission-denied') {
    return '送不出去。可能是報名已經截止，或這支球隊的名單已經送審凍結了。重新整理看看最新狀態，還是不行請聯絡主辦。';
  }
  if (code === 'unauthenticated') return '登入已失效，請重新用 LINE 登入。';
  if (code === 'unavailable' || code === 'failed-precondition') {
    return '現在連不上伺服器。請確認網路後再送一次。';
  }
  return err?.message || fallback;
}
