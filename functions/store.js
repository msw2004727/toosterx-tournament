/**
 * Functions｜Firestore 存取層
 * ------------------------------------------------------------------
 * 把「去哪裡讀」跟「怎麼算」分開：這一層只負責讀寫，
 * 所有計算都在 engine/（來源是 js/engine/，由 scripts/sync-engine.js 同步）。
 *
 * 兩條原則：
 *   1. **設定一律讀 Firestore**（config/rankingRules、config/formats、divisions/*），
 *      不從程式碼裡的常數拿。飛達盃只是第一個 Event，賽制要能在後台改。
 *   2. **缺資料一律 fail-closed**（R-ENG-005）：讀不到就丟錯，
 *      絕不「沒設定就套預設值」——那會讓一個打錯的 rankingRuleId
 *      安靜地用錯規則排出一份看起來很正常的積分榜。
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin.js';

export { db };

export const evRef = eventId => db().collection('events').doc(eventId);

/** 讀單一文件，不存在就丟錯（附上路徑，現場才查得到） */
async function must(ref, what, tx = null) {
  const snap = await (tx ? tx.get(ref) : ref.get());
  if (!snap.exists) throw new Error(`${what} 不存在：${ref.path}`);
  return snap.data();
}

// ── 設定 ─────────────────────────────────────────────────────

export async function loadRankingRule(rankingRuleId, tx = null) {
  if (!rankingRuleId) throw new Error('缺少 rankingRuleId');
  const { rules } = await must(db().doc('config/rankingRules'), 'config/rankingRules', tx);
  const rule = rules?.[rankingRuleId];
  if (!rule) throw new Error(`config/rankingRules 沒有 ${rankingRuleId}`);
  return rule;
}

export async function loadFormat(formatId, tx = null) {
  if (!formatId) throw new Error('缺少 formatId');
  const { formats } = await must(db().doc('config/formats'), 'config/formats', tx);
  const format = formats?.[formatId];
  if (!format) throw new Error(`config/formats 沒有 ${formatId}`);
  return format;
}

// ── 組別 / 階段 / 小組 ───────────────────────────────────────

export const loadDivision = (eventId, divisionId, tx = null) =>
  must(evRef(eventId).collection('divisions').doc(divisionId), '組別', tx);

/** 某階段的所有小組。淘汰賽階段沒有小組，回空陣列。 */
export async function loadGroups(eventId, divisionId, stageId, tx = null) {
  const query = evRef(eventId)
    .collection('divisions').doc(divisionId)
    .collection('stages').doc(stageId)
    .collection('groups');
  const snap = await (tx ? tx.get(query) : query.get());
  return snap.docs.map(d => ({ groupId: d.id, ...d.data() }));
}

// ── 場次 ─────────────────────────────────────────────────────

const rowsOf = snap => snap.docs.map(d => ({ matchId: d.id, ...d.data() }));

export async function loadDivisionMatches(eventId, divisionId, tx = null) {
  const query = evRef(eventId).collection('matches').where('divisionId', '==', divisionId);
  return rowsOf(await (tx ? tx.get(query) : query.get()));
}

/**
 * 某階段的場次。
 * ⚠️ 刻意不加 groupId 的 where：`divisionId + stageId` 這組複合索引已經存在
 *    （firestore.indexes.json），再多一個欄位就要多開一個索引，而一個階段
 *    最多十幾場，在記憶體裡篩比多養一個索引划算。
 */
export async function loadStageMatches(eventId, divisionId, stageId) {
  return rowsOf(await evRef(eventId).collection('matches')
    .where('divisionId', '==', divisionId)
    .where('stageId', '==', stageId).get());
}

/** 交易版：晉級解算與積分重算都要在交易裡重讀，才擋得住亂序寫入 */
export async function loadStageMatchesTx(tx, eventId, divisionId, stageId) {
  const q = evRef(eventId).collection('matches')
    .where('divisionId', '==', divisionId)
    .where('stageId', '==', stageId);
  return rowsOf(await tx.get(q));
}

// ── 卡片事件（行為分用）─────────────────────────────────────

/**
 * 指定場次的紅黃牌事件。
 *
 * 為什麼不用 collectionGroup('timeline').where('type','==','card')：
 * 那會掃到整個 event 所有組別的牌，一個小組的重算沒必要付那個錢，
 * 而且 engine 本來就只採 countedMatchIds 之內的卡片（R-ENG-003）。
 */
export async function loadCardEvents(eventId, matchIds, tx = null) {
  const out = [];
  const reads = matchIds.map(async id => {
    const query = evRef(eventId).collection('matches').doc(id).collection('timeline').where('type', '==', 'card');
    const snap = await (tx ? tx.get(query) : query.get());
    for (const d of snap.docs) out.push({ ...d.data(), timelineId: d.id, matchId: id });
  });
  await Promise.all(reads);
  return out;
}

/** 某場次的全部事件（對帳與射手榜用） */
export async function loadTimeline(eventId, matchId) {
  const snap = await evRef(eventId).collection('matches').doc(matchId)
    .collection('timeline').get();
  return snap.docs.map(d => ({ timelineId: d.id, ...d.data() }));
}

// ── 隊伍 ─────────────────────────────────────────────────────

/** teamId → 隊伍文件。缺的隊伍不會補預設值，呼叫端自己決定怎麼辦。 */
export async function loadTeams(eventId, teamIds, tx = null) {
  const ids = [...new Set(teamIds.filter(Boolean))];
  if (!ids.length) return {};
  const refs = ids.map(id => evRef(eventId).collection('teams').doc(id));
  const snaps = await (tx ?? db()).getAll(...refs);
  const out = {};
  for (const s of snaps) if (s.exists) out[s.id] = { teamId: s.id, ...s.data() };
  return out;
}

/**
 * 公開名冊投影（teams/{t}/roster/{m}）。
 *
 * ⚠️ 任何要寫進**公開可讀**文件的球員姓名，一律從這裡拿。
 *    timeline 事件上的 playerName 是賽務端記的**真名**，
 *    未滿 13 歲的球員在名冊上是遮蔽過的（王小＊，R-PRIV-001／docs/03 §7.3）。
 *    直接把事件上的名字寫進 boards/*，就是把兒童的真名公開掛出去。
 *
 * @returns {Object<string, {displayName, jerseyNo, teamId, divisionId}>} memberId → 投影
 */
export async function loadRosters(eventId, teamIds) {
  const ids = [...new Set(teamIds.filter(Boolean))];
  const out = {};
  await Promise.all(ids.map(async teamId => {
    const snap = await evRef(eventId).collection('teams').doc(teamId)
      .collection('roster').get();
    for (const d of snap.docs) {
      out[d.id] = { memberId: d.id, teamId, ...d.data() };
    }
  }));
  return out;
}

/** 隊伍資料 → engine 要的 teamMeta（只有顯示欄位） */
export function teamMetaOf(teams) {
  const meta = {};
  for (const [id, t] of Object.entries(teams)) {
    meta[id] = { name: t.shortName ?? t.name ?? null, abbr: t.abbr ?? null, logoUrl: t.logoUrl ?? null, seed: t.seed ?? null };
  }
  return meta;
}

export const withdrawnIdsOf = teams =>
  Object.values(teams).filter(t => t.withdrawn === true).map(t => t.teamId);

// ── 積分榜 ───────────────────────────────────────────────────

export const standingRef = (eventId, standingId) =>
  evRef(eventId).collection('standings').doc(standingId);

export async function loadStandings(eventId, divisionId, tx = null) {
  const query = evRef(eventId).collection('standings').where('divisionId', '==', divisionId);
  const snap = await (tx ? tx.get(query) : query.get());
  const out = {};
  for (const d of snap.docs) out[d.id] = { standingId: d.id, ...d.data() };
  return out;
}

// ── 挑戰系統（M6，docs/06）───────────────────────────────────

/**
 * 關卡設定。**缺設定一律丟錯**（R-ENG-005）：沒有 minValue / maxValue /
 * rankingRule 的話，引擎算不出正確的最佳成績，而算錯的排行榜看起來
 * 跟算對的一模一樣。
 */
export const loadChallenge = (eventId, challengeId) =>
  must(evRef(eventId).collection('challenges').doc(challengeId), `關卡 ${challengeId}`);

export async function loadChallenges(eventId, tx = null) {
  const ref = evRef(eventId).collection('challenges');
  const snap = await (tx ? tx.get(ref) : ref.get());
  return snap.docs.map(d => ({ ...d.data(), challengeId: d.id }));
}

/**
 * 一位玩家在一關的全部成績（含作廢——引擎自己會濾）。
 *
 * ⚠️ 不在查詢裡篩 `voided`：作廢的那幾筆要拿來算 `diffBestFlags`
 *    （把舊的 isBest 關掉），查詢就濾掉的話它們永遠留著旗標。
 */
export async function loadPlayerAttempts(eventId, challengeId, playerId, tx = null) {
  const query = evRef(eventId).collection('attempts')
    .where('challengeId', '==', challengeId)
    .where('playerId', '==', playerId);
  const snap = await (tx ? tx.get(query) : query.get());
  return snap.docs.map(d => ({ ...d.data(), attemptId: d.id }));
}

/** 一關的全部成績（排行榜用） */
export async function loadChallengeAttempts(eventId, challengeId, tx = null) {
  const query = evRef(eventId).collection('attempts').where('challengeId', '==', challengeId);
  const snap = await (tx ? tx.get(query) : query.get());
  return snap.docs.map(d => ({ ...d.data(), attemptId: d.id }));
}

export const playerRef = (eventId, playerId) =>
  evRef(eventId).collection('players').doc(playerId);

export async function loadPlayers(eventId, playerIds, tx = null) {
  const ids = [...new Set((playerIds || []).filter(Boolean))];
  const out = {};
  // Firestore 的 getAll 一次上限 300，分批
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map(id => playerRef(eventId, id));
    if (!refs.length) continue;
    const snaps = await (tx ?? db()).getAll(...refs);
    for (const s of snaps) if (s.exists) out[s.id] = { playerId: s.id, ...s.data() };
  }
  return out;
}

/**
 * 抽獎規則。
 *
 * ⚠️ 讀不到就回 null，**不要套一份預設值**——引擎收到 null 會回 0 張，
 *    而多發出去的抽獎券收不回來（docs/06 §7.1）。
 */
export async function loadChallengeRewards(tx = null) {
  const ref = db().doc('config/challengeRewards');
  const snap = await (tx ? tx.get(ref) : ref.get());
  return snap.exists ? snap.data() : null;
}

export const leaderboardRef = (eventId, challengeId) =>
  evRef(eventId).collection('leaderboards').doc(challengeId);

// ── 稽核（R-SEC-002：只新增，不改不刪）──────────────────────

export function writeAudit(eventId, { entity, entityId, action, before = null, after = null, reason = null, actor = null }, tx = null, auditRef = null) {
  const ref = auditRef ?? evRef(eventId).collection('audits').doc();
  const doc = {
    auditId: ref.id, eventId,
    entity, entityId, action,
    actor: actor ?? { uid: null, name: 'system', source: 'function' },
    before, after, reason,
    createdAt: FieldValue.serverTimestamp()
  };
  if (tx) { tx.create(ref, doc); return ref.id; }
  return ref.create(doc);
}

/** 呼叫者 uid 只由 callable 的 Firebase Auth 取得；在提交交易內再次驗角色。 */
export async function adminActor(tx, uid) {
  if (uid == null) return { uid: null, name: 'system', source: 'function' };
  const staff = (await tx.get(db().doc(`staff/${uid}`))).data();
  if (staff?.active !== true || !Array.isArray(staff.roles)
      || !staff.roles.some(r => ['admin', 'super_admin'].includes(r))) {
    throw Object.assign(new Error('管理權限已失效'), { code: 'permission-denied' });
  }
  return { uid, name: staff.name ?? null, source: 'function' };
}
