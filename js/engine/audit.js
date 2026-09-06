/**
 * 稽核紀錄
 * ------------------------------------------------------------------
 * 規格：docs/05、R-SEC-002（只能新增，不可改不可刪）
 *
 * 「一切可修正、一切留痕」是不可協商的產品行為第 3 條。留了痕之後，
 * 這一層負責把它變成**人看得懂的一句話**——一坨 JSON 對主辦沒有用。
 *
 * 純函式：不碰 Firestore、不呼叫 Date.now()、不查名字（名字由呼叫端
 * 用 `lookup` 傳進來）。
 *
 * ⚠️ 這個集合裡有**兩種欄位形狀**，因為歷史上有三個寫入者：
 *
 *   | 寫入者 | 目標欄位 | actor |
 *   |---|---|---|
 *   | `js/modules/staff/data.js`（賽務端）| `entity` / `entityId` | `{uid, name}` |
 *   | `functions/store.js`（結果管線）| `entity` / `entityId` | `{uid: null, name: 'system'}` |
 *   | `js/modules/admin/data.js`（管理後台，早期）| `targetType` / `targetId` | `{uid, at}` |
 *
 * 管理後台已改用 `entity` / `entityId`（跟另外兩個一致），但 demo 上
 * 已經有 14 筆舊形狀的紀錄，而**稽核紀錄不可以改寫**（R-SEC-002）——
 * 所以正規化只能發生在讀取的時候，而且必須永遠留著。
 */

import { ROLE_INFO, PERMISSION_BY_CODE } from '../config.js';

/** 目標種類的顯示名 */
const ENTITY_LABEL = {
  team: '球隊', staff: '身分', rolePermissions: '權限',
  match: '場次', timeline: '事件', standing: '積分榜', division: '組別',
  member: '名單', player: '玩家', venue: '場地', config: '設定', event: '賽事', export: '匯出'
};

/** 毫秒 → 台北時間「10:30」。引擎不能 import lib，所以這裡自己有一份（只用在稽核的人話裡） */
function hhmmOf(v) {
  const ms = typeof v === 'number' ? v : (typeof v?.toMillis === 'function' ? v.toMillis() : null);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
}

/** `teamId/memberId` → teamId（Function 寫的名單稽核用這種 entityId） */
const teamOfMemberId = id => String(id ?? '').split('/')[0] || null;

/**
 * 把兩種欄位形狀收斂成一種。
 *
 * 讀不到的欄位一律給 `null`，**不要猜**——猜錯的方向是「把某個人的
 * 操作算到另一個人頭上」，那比顯示「未知」糟得多。
 */
export function normalizeAudit(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const entity = raw.entity ?? raw.targetType ?? null;
  const entityId = raw.entityId ?? raw.targetId ?? null;
  return {
    auditId: raw.auditId ?? raw.id ?? null,
    action: typeof raw.action === 'string' ? raw.action : null,
    entity,
    entityId,
    entityLabel: ENTITY_LABEL[entity] ?? entity ?? '—',
    before: raw.before ?? null,
    after: raw.after ?? null,
    reason: raw.reason ?? null,
    actorUid: raw.actor?.uid ?? null,
    actorName: raw.actor?.name ?? null,
    // serverTimestamp 在本機快照上是 null（還沒同步）。這裡照實回 null，
    // 畫面顯示「同步中」——填一個本機時間會讓稽核紀錄的時間軸失真。
    at: raw.createdAt ?? raw.actor?.at ?? null
  };
}

/** 角色代碼陣列 → 「記錄員」 */
const roleText = roles => (Array.isArray(roles) ? roles : [])
  .map(r => ROLE_INFO[r]?.label ?? r).join('、') || '（無）';

/** 權限碼 → 「送出完賽」 */
const permText = code => PERMISSION_BY_CODE[code]?.label ?? code;

/**
 * `{home, away}` → `2:1`。
 * ⚠️ 不用 `Number()`：0 分是合法比分，而 `Number(null)` 也是 0——
 *    「沒有比分」跟「0:0」在稽核紀錄上是兩件事（R-ENG-002）。
 */
function scoreText(s) {
  const n = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const h = n(s?.home);
  const a = n(s?.away);
  return h == null || a == null ? null : `${h}:${a}`;
}

/** before/after 是 `{ 權限碼: boolean }`，取出唯一那一條 */
function togglePair(a) {
  const key = Object.keys(a.after ?? {})[0] ?? Object.keys(a.before ?? {})[0] ?? null;
  return key === null ? null : { code: key, on: a.after?.[key] === true };
}

/**
 * 一筆紀錄的人話描述。
 *
 * @param {object} a  normalizeAudit() 的結果
 * @param {object} [lookup] `{ teams: {id:name}, people: {uid:name} }`
 *                          查不到就退回 id——**不要顯示空白**，
 *                          那會讓人以為紀錄壞了。
 * @returns {{title:string, detail:string[]}}
 */
export function describeAudit(a, lookup = {}) {
  const team = id => lookup.teams?.[id] ?? id ?? '（不明球隊）';
  const person = uid => lookup.people?.[uid] ?? uid ?? '（不明）';
  const detail = [];
  let title;

  switch (a.action) {
    case 'team.approve':
      title = `核准了「${team(a.entityId)}」的報名`;
      detail.push('名單已鎖定，隊長不能再增減');
      break;
    case 'team.reject':
      title = `退回了「${team(a.entityId)}」的報名`;
      detail.push('名單已解凍，隊長可以修改後再送');
      break;
    case 'staff.assign':
      title = `把「${roleText(a.after?.roles)}」指派給 ${person(a.entityId)}`;
      break;
    case 'staff.update':
      title = `把 ${person(a.entityId)} 的身分從「${roleText(a.before?.roles)}」改成「${roleText(a.after?.roles)}」`;
      break;
    case 'staff.deactivate':
      title = `停用了 ${person(a.entityId)} 的身分`;
      detail.push('紀錄留著，之後可以再啟用');
      break;
    case 'staff.reactivate':
      title = `重新啟用了 ${person(a.entityId)} 的身分`;
      break;
    case 'perms.toggle': {
      const t = togglePair(a);
      title = t
        ? `${t.on ? '打開' : '關閉'}了「${roleText([a.entityId])}」的「${permText(t.code)}」`
        : `調整了「${roleText([a.entityId])}」的權限`;
      break;
    }
    case 'match.finish.undo':
      title = `撤回了 ${a.entityId ?? '某場次'} 的完賽`;
      detail.push('比分與事件都留著，場次退回進行中');
      break;

    // ── 管理員的改判（docs/04 §6）───────────────────────────
    case 'match.confirm':
      title = `覆核了 ${a.entityId ?? '某場次'} 的完賽`;
      detail.push('結果定案，仍然可以由管理員重開');
      break;
    case 'match.reopen':
      title = `重開了 ${a.entityId ?? '某場次'}`;
      detail.push('積分榜把這一場的分數收回去，比分與事件都留著');
      break;
    case 'match.override': {
      const b = scoreText(a.before?.score);
      const f = scoreText(a.after?.score);
      title = b && f
        ? `把 ${a.entityId ?? '某場次'} 的比分從 ${b} 改判成 ${f}`
        : `改判了 ${a.entityId ?? '某場次'} 的比分`;
      detail.push('積分榜依新的比分重算，公開端立刻跟著變');
      break;
    }
    case 'match.walkover': {
      const side = a.after?.walkoverSide;
      title = `判 ${a.entityId ?? '某場次'} 的${side === 'home' ? '主隊' : side === 'away' ? '客隊' : '一方'}棄賽`;
      detail.push(`比分依競賽規章第十八條第 6 款判為 ${scoreText(a.after?.score) ?? '0:2'}`);
      break;
    }
    case 'match.postponed':
      title = `把 ${a.entityId ?? '某場次'} 改成延期`;
      detail.push('比分沒有被清掉，這一場暫時不計入積分榜');
      break;
    case 'match.cancelled':
      title = `取消了 ${a.entityId ?? '某場次'}`;
      detail.push('比分沒有被清掉，這一場不計入積分榜');
      break;
    case 'timeline.void':
      title = `作廢了 ${a.entityId ?? '某場次'} 的一筆事件`;
      detail.push('事件不會被刪除，只是標記為作廢');
      break;
    case 'advancement.resolve':
      title = `系統解出了 ${a.entityId ?? '某組別'} 的晉級`;
      break;

    // ── 積分榜的人工裁定（規章第十九條第 5 順位：抽籤／主辦裁定）──────
    // 2026-09-06 主辦驗收：這幾種在 demo 與正式站都真的發生過，卻只印成
    // 「standing.manualRanking：積分榜 u10__group__A」，主辦以為沒有紀錄。
    case 'standing.manualRanking': {
      const pins = Array.isArray(a.after?.pins) ? a.after.pins : [];
      title = `人工裁定了 ${a.entityId ?? '某積分榜'} 的同分名次`;
      if (pins.length) detail.push(pins.map(p => `第 ${p.rank} 名 ${team(p.teamId)}`).join('、'));
      detail.push(a.after?.drawSeed != null ? `以抽籤決定（種子 ${a.after.drawSeed}，可重放）` : '由主辦直接裁定');
      break;
    }
    case 'standing.clearManual':
      title = `解除了 ${a.entityId ?? '某積分榜'} 的人工裁定`;
      detail.push('同分回到「待主辦裁定」，晉級要等再裁定一次');
      break;
    case 'standing.rankChanged':
      title = `${a.entityId ?? '某積分榜'} 的名次因重算而變動`;
      break;
    case 'finalRanking.publish':
      title = `系統算出了 ${a.entityId ?? '某組別'} 的最終排名`;
      break;

    // ── 賽程管理（docs/05 §6）────────────────────────────────
    case 'schedule.draw':
      title = `抽了 ${a.entityId ?? '某組別'} 的籤`;
      if (a.after?.seed != null) detail.push(`種子 ${a.after.seed}，任何人都能重放出同一組分組`);
      break;
    case 'schedule.generate':
      title = `產生了 ${a.entityId ?? '某組別'} 的對戰表`;
      break;
    case 'schedule.place':
      title = `排定了 ${a.entityId ?? '某組別'} 的時間與場地`;
      break;
    case 'schedule.move': {
      const from = hhmmOf(a.before?.kickoffAt), to = hhmmOf(a.after?.kickoffAt);
      title = `調整了 ${a.entityId ?? '某場次'} 的時間或場地`;
      if (from && to && from !== to) detail.push(`開賽時間從 ${from} 改成 ${to}`);
      if (a.before?.venueId !== a.after?.venueId && (a.before?.venueId || a.after?.venueId)) {
        detail.push(`場地從 ${a.before?.venueId ?? '（未指定）'} 改成 ${a.after?.venueId ?? '（未指定）'}`);
      }
      break;
    }
    case 'schedule.shift':
      title = `整體順延了 ${a.entityId ?? '某組別'} 的場次`;
      break;
    case 'schedule.publish':
      title = `發布了 ${a.entityId ?? '某組別'} 的賽程`;
      detail.push('公開端從這一刻起看得到這一組的場次');
      break;
    case 'schedule.unpublish':
      title = `收回了 ${a.entityId ?? '某組別'} 的賽程`;
      detail.push('公開端暫時看不到；讀得到資料的人仍然讀得到');
      break;

    // ── 申訴、直播、報名開關（2026-09-05 補齊的規章項目）──────
    case 'appeal.filed':
      title = `登記了 ${a.entityId ?? '某場次'} 的申訴`;
      if (a.after?.late) detail.push('逾時受理（規章第二十條的 30 分鐘已過，主辦破例）');
      break;
    case 'appeal.decided':
      title = `裁決了 ${a.entityId ?? '某場次'} 的申訴：${a.after?.upheld === true ? '成立' : a.after?.upheld === false ? '不成立' : '（結果不明）'}`;
      detail.push(a.after?.upheld === true ? '保證金退還' : '保證金不予發還');
      break;
    case 'stream.update':
      title = `更新了 ${a.entityId ?? '某處'} 的直播設定`;
      if (a.after?.videoId) detail.push(`影片 ${a.after.videoId}`);
      break;
    case 'registration.update':
      title = '更新了報名開關';
      if (typeof a.after?.open === 'boolean') detail.push(a.after.open ? '手動開關：開放' : '手動開關：關閉');
      break;

    // ── 系統自動退件（每人限報乙隊、重複申請、人數上限）──────
    case 'member.crossTeamRejected':
      title = `系統退回了「${team(teamOfMemberId(a.entityId))}」的一位成員：每人限報乙隊`;
      detail.push('同一位球員（後四碼＋生日相同）已在另一支球隊的名單上');
      break;
    case 'member.duplicateRejected':
      title = `系統退回了「${team(teamOfMemberId(a.entityId))}」的一筆重複申請`;
      detail.push('同一個帳號對同一支球隊一次只能有一筆待審申請');
      break;
    case 'member.capRejected':
      title = `系統退回了「${team(a.entityId)}」超過上限的球員`;
      break;
    case 'team.withdraw': {
      const amt = a.after?.refund?.amount;
      title = `取消了「${team(a.entityId)}」的報名`;
      if (typeof amt === 'number') detail.push(`退費 NT$ ${amt.toLocaleString()}`);
      break;
    }
    case 'export.luckyDraw':
      title = '匯出了抽獎名單';
      break;
    case 'challenge.playerMissing':
      title = `挑戰成績找不到玩家 ${a.entityId ?? ''}`.trim();
      break;
    default:
      // 不認得的動作要**照原樣印出來**，不可以吞掉——
      // 日後新增的動作在這裡沒有分支時，主辦仍然看得到「發生過某件事」。
      title = `${a.action ?? '（不明動作）'}：${a.entityLabel} ${a.entityId ?? ''}`.trim();
  }

  if (a.reason) detail.push(`原因：${a.reason}`);
  return { title, detail };
}

/**
 * 「by 誰」。
 *
 * ⚠️ 畫面與搜尋**必須用同一支**。第一版是畫面自己算一份、搜尋另外組一份，
 *    結果每一列都寫著「by 金小麥」，搜「金小麥」卻是 0 筆——
 *    使用者搜的是他看到的字（2026-09-04 在真站上實測到）。
 *
 * 名字一律用 `lookup` 查：紀錄上的 `actor.name` 不能信（custom token
 * 登入的人那一格永遠是 null）。查不到就退回 uid，不顯示空白。
 */
export function actorText(a, lookup = {}) {
  if (a?.actorName === 'system') return '系統';
  return lookup.people?.[a?.actorUid] ?? a?.actorName ?? a?.actorUid ?? '（不明）';
}

/**
 * 篩選用的分組。
 *
 * ⚠️ 每一筆都要落在**恰好一個**分類裡，最後的「其他」是前面全部的補集——
 *    分類的數字加起來要等於「全部」。2026-09-06 主辦驗收時正式站 87 筆裡有 62 筆
 *    （賽程、積分裁定、申訴、系統退件）不在任何分類，主辦以為人工裁定沒有留痕。
 */
const act = a => String(a?.action ?? '');
const CATEGORIES = [
  { key: 'team', label: '報名審核', match: a => /^(team|member|registration)\./.test(act(a)) },
  { key: 'staff', label: '身分授權', match: a => act(a).startsWith('staff.') },
  { key: 'perms', label: '權限開關', match: a => act(a).startsWith('perms.') },
  { key: 'match', label: '賽務改動', match: a => /^(match|timeline|advancement|appeal|stream)\./.test(act(a)) },
  { key: 'standing', label: '積分裁定', match: a => /^(standing|finalRanking)\./.test(act(a)) },
  { key: 'schedule', label: '賽程', match: a => act(a).startsWith('schedule.') }
];
export const AUDIT_FILTERS = [
  { key: 'all', label: '全部', match: () => true },
  ...CATEGORIES,
  { key: 'other', label: '其他', match: a => !CATEGORIES.some(f => f.match(a)) }
];

/**
 * 篩選。
 *
 * 搜尋比對的是**畫面上看得到的那句話**，不是原始欄位——
 * 使用者搜的是他看到的字。
 */
export function filterAudits(rows, { filter = 'all', q = '', lookup = {} } = {}) {
  const f = AUDIT_FILTERS.find(x => x.key === filter) ?? AUDIT_FILTERS[0];
  const needle = String(q ?? '').trim().toLowerCase();
  return (rows ?? []).filter(a => {
    if (!f.match(a)) return false;
    if (!needle) return true;
    const d = describeAudit(a, lookup);
    const hay = [d.title, ...d.detail, actorText(a, lookup), a.actorUid, a.entityId]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(needle);
  });
}
