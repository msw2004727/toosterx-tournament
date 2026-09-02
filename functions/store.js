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
async function must(ref, what) {
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`${what} 不存在：${ref.path}`);
  return snap.data();
}

// ── 設定 ─────────────────────────────────────────────────────

export async function loadRankingRule(rankingRuleId) {
  if (!rankingRuleId) throw new Error('缺少 rankingRuleId');
  const { rules } = await must(db().doc('config/rankingRules'), 'config/rankingRules');
  const rule = rules?.[rankingRuleId];
  if (!rule) throw new Error(`config/rankingRules 沒有 ${rankingRuleId}`);
  return rule;
}

export async function loadFormat(formatId) {
  if (!formatId) throw new Error('缺少 formatId');
  const { formats } = await must(db().doc('config/formats'), 'config/formats');
  const format = formats?.[formatId];
  if (!format) throw new Error(`config/formats 沒有 ${formatId}`);
  return format;
}

// ── 組別 / 階段 / 小組 ───────────────────────────────────────

export const loadDivision = (eventId, divisionId) =>
  must(evRef(eventId).collection('divisions').doc(divisionId), '組別');

/** 某階段的所有小組。淘汰賽階段沒有小組，回空陣列。 */
export async function loadGroups(eventId, divisionId, stageId) {
  const snap = await evRef(eventId)
    .collection('divisions').doc(divisionId)
    .collection('stages').doc(stageId)
    .collection('groups').get();
  return snap.docs.map(d => ({ groupId: d.id, ...d.data() }));
}

// ── 場次 ─────────────────────────────────────────────────────

const rowsOf = snap => snap.docs.map(d => ({ matchId: d.id, ...d.data() }));

export async function loadDivisionMatches(eventId, divisionId) {
  return rowsOf(await evRef(eventId).collection('matches')
    .where('divisionId', '==', divisionId).get());
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
export async function loadCardEvents(eventId, matchIds) {
  const out = [];
  const reads = matchIds.map(id =>
    evRef(eventId).collection('matches').doc(id)
      .collection('timeline').where('type', '==', 'card').get()
      .then(snap => snap.docs.forEach(d => out.push({ timelineId: d.id, ...d.data() })))
  );
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
export async function loadTeams(eventId, teamIds) {
  const ids = [...new Set(teamIds.filter(Boolean))];
  if (!ids.length) return {};
  const refs = ids.map(id => evRef(eventId).collection('teams').doc(id));
  const snaps = await db().getAll(...refs);
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

export async function loadStandings(eventId, divisionId) {
  const snap = await evRef(eventId).collection('standings')
    .where('divisionId', '==', divisionId).get();
  const out = {};
  for (const d of snap.docs) out[d.id] = { standingId: d.id, ...d.data() };
  return out;
}

// ── 稽核（R-SEC-002：只新增，不改不刪）──────────────────────

export function writeAudit(eventId, { entity, entityId, action, before = null, after = null, reason = null }) {
  return evRef(eventId).collection('audits').add({
    entity, entityId, action,
    actor: { uid: null, name: 'system', source: 'function' },
    before, after, reason,
    createdAt: FieldValue.serverTimestamp()
  });
}
