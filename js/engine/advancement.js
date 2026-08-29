/**
 * 晉級解算
 * ------------------------------------------------------------------
 * 規格：docs/02-賽制引擎與排名規則.md §7 與 §8
 *
 * TeamSource：
 *   { type:'standing',    stageId, groupId, rank }
 *   { type:'matchWinner', matchKey }
 *   { type:'matchLoser',  matchKey }
 *   { type:'fixed',       teamId }
 *
 * 設計原則：**寧可回傳 null，也不要猜**。
 * 現場最怕的不是「晉級還沒填」，而是「填錯了但沒人發現」。
 * 因此積分榜只要 hasUnresolvedTie，就一律不解算，等主辦裁定。
 */

import { standingIdOf } from './standing.js';

/** 可視為「已產生勝負」的狀態 */
const DECIDED_STATUSES = ['finished', 'confirmed', 'walkover'];

/**
 * 下游場次還沒開打、可以安全覆寫 home/away 的狀態。
 * ⚠️ 必須包含 'ready'：解算成功會把場次設成 ready（§7.2 步驟 4），
 *    少了它，第二次解算就會被自己的產物擋住——
 *    重放不冪等，而且「分組賽改判後重解晉級」（§10）會永久失敗。
 */
const WRITABLE_STATUSES = ['scheduled', 'checkin', 'ready'];

/**
 * 求值單一 TeamSource。
 *
 * @param {object} source TeamSource
 * @param {object} ctx
 * @param {string} ctx.divisionId
 * @param {Object<string,object>} ctx.standings   standingId → standing 文件
 * @param {Object<string,object>} ctx.matchesByKey matchKey → match 文件
 * @returns {string|null} teamId；尚未能決定時回傳 null
 */
export function resolveTeamSource(source, ctx) {
  return explainTeamSource(source, ctx).teamId;
}

/**
 * 同 resolveTeamSource，但附上「為什麼還解不出來」——這是給 Admin 看的。
 * @returns {{teamId:string|null, ready:boolean, reason:string}}
 */
export function explainTeamSource(source, ctx) {
  if (!source || !source.type) return miss('來源未定義');

  if (source.type === 'fixed') {
    return source.teamId ? hit(source.teamId, '指定隊伍') : miss('fixed 缺 teamId');
  }

  if (source.type === 'standing') {
    const id = standingIdOf(ctx.divisionId, source.stageId, source.groupId);
    const st = ctx.standings?.[id];
    if (!st) return miss(`找不到積分榜 ${id}`);
    if (st.hasUnresolvedTie) return miss(`${id} 有待裁定的同分，暫不解算`);
    const row = st.rows?.[source.rank - 1];
    if (!row?.teamId) return miss(`${id} 尚無第 ${source.rank} 名`);
    return hit(row.teamId, `${source.groupId}組第${source.rank}名`);
  }

  if (source.type === 'matchWinner' || source.type === 'matchLoser') {
    const m = ctx.matchesByKey?.[source.matchKey];
    if (!m) return miss(`找不到場次 ${source.matchKey}`);
    if (!DECIDED_STATUSES.includes(m.status)) return miss(`${source.matchKey} 尚未完賽`);
    const w = m.result?.winner;
    if (w !== 'home' && w !== 'away') {
      // 淘汰賽平手代表 drawRule 沒被執行（PK 未登錄），這是資料問題，不猜
      return miss(`${source.matchKey} 未產生勝負（result.winner=${w ?? 'null'}）`);
    }
    const want = source.type === 'matchWinner' ? w : (w === 'home' ? 'away' : 'home');
    const teamId = m[want]?.teamId;
    return teamId
      ? hit(teamId, `${source.matchKey} ${source.type === 'matchWinner' ? '勝隊' : '敗隊'}`)
      : miss(`${source.matchKey} 的 ${want} 尚無 teamId`);
  }

  return miss(`未知的 TeamSource type：${source.type}`);
}

const hit = (teamId, reason) => ({ teamId, ready: true, reason });
const miss = reason => ({ teamId: null, ready: false, reason });

/** 公開端顯示用的佔位文字（未解算時） */
export function describeTeamSource(source, labels = {}) {
  if (!source) return '待定';
  if (source.type === 'standing') return `${source.groupId}組第${source.rank}名`;
  if (source.type === 'matchWinner') return `${labels[source.matchKey] || source.matchKey}勝隊`;
  if (source.type === 'matchLoser') return `${labels[source.matchKey] || source.matchKey}敗隊`;
  return '待定';
}

/**
 * 下游場次是否還能安全寫入晉級隊伍（§7.3）。
 * 已經有比分或已開打的場次一律擋下，改由 Admin 先清除比分。
 */
export function isSlotWritable(match) {
  if (!match) return false;
  if (!WRITABLE_STATUSES.includes(match.status)) return false;
  const s = match.score || {};
  if (Number(s.home) > 0 || Number(s.away) > 0) return false;
  return true;
}

/**
 * 解算某個 Stage 的所有 slot。
 *
 * @param {object} format Format 設定
 * @param {string} stageId 要解算的階段
 * @param {object} ctx  同 resolveTeamSource，另可帶 ctx.teams（teamId → 隊伍資料）
 * @returns {{updates:Array<object>, blocked:Array<object>, resolvedCount:number, allResolved:boolean}}
 *          updates：可直接套用到 match 的 patch；blocked：解不出或不可寫入的原因
 */
export function resolveStage(format, stageId, ctx) {
  const stage = (format?.stages || []).find(s => s.stageId === stageId);
  const updates = [];
  const blocked = [];
  if (!stage) {
    return { updates, blocked: [{ reason: `Format 沒有 stage ${stageId}` }], resolvedCount: 0, allResolved: false };
  }
  // 循環賽階段沒有 slots，不需要解算。回 allResolved:true 會讓呼叫端誤以為「解算完成」
  if (!stage.slots?.length) {
    return {
      updates, blocked: [{ stageId, reason: `${stageId} 不是需要解算的階段（沒有 slots）` }],
      resolvedCount: 0, allResolved: false, notApplicable: true
    };
  }

  for (const slot of stage.slots || []) {
    const match = ctx.matchesByKey?.[slot.matchKey];
    if (!match) { blocked.push({ matchKey: slot.matchKey, reason: '找不到對應場次' }); continue; }

    const home = explainTeamSource(slot.home, ctx);
    const away = explainTeamSource(slot.away, ctx);

    if (!home.ready || !away.ready) {
      blocked.push({
        matchKey: slot.matchKey, matchId: match.matchId,
        reason: [home.ready ? null : `home：${home.reason}`, away.ready ? null : `away：${away.reason}`]
          .filter(Boolean).join('；')
      });
      continue;
    }
    if (home.teamId === away.teamId) {
      blocked.push({ matchKey: slot.matchKey, matchId: match.matchId, reason: '兩邊解出同一隊，設定有誤' });
      continue;
    }
    // ⚠️ noop 檢查一定要排在可寫入檢查之前。
    //    已經填好且結果相同時根本不需要寫，就算場次已開打也不該回報失敗——
    //    否則 Function 重放會全數 blocked，冪等性破功。
    if (match.home?.teamId === home.teamId && match.away?.teamId === away.teamId) {
      updates.push({ matchId: match.matchId, matchKey: slot.matchKey, noop: true });
      continue;
    }
    if (!isSlotWritable(match)) {
      blocked.push({
        matchKey: slot.matchKey, matchId: match.matchId,
        reason: `場次已進行（status=${match.status}、score=${match.score?.home ?? 0}:${match.score?.away ?? 0}），需先清除比分並退回 scheduled`
      });
      continue;
    }

    updates.push({
      matchId: match.matchId,
      matchKey: slot.matchKey,
      noop: false,
      patch: {
        home: teamRefOf(home.teamId, ctx),
        away: teamRefOf(away.teamId, ctx),
        teamIds: [home.teamId, away.teamId],
        status: 'ready'
      },
      trace: { home: home.reason, away: away.reason }
    });
  }

  const resolvedCount = updates.length;
  return {
    updates, blocked, resolvedCount,
    allResolved: blocked.length === 0 && resolvedCount === (stage.slots || []).length
  };
}

function teamRefOf(teamId, ctx) {
  const t = ctx.teams?.[teamId] || {};
  return {
    teamId,
    name: t.shortName ?? t.name ?? null,
    abbr: t.abbr ?? null,
    logoUrl: t.logoUrl ?? null,
    colorPrimary: t.colors?.primary ?? null,
    placeholder: null,
    displayName: t.shortName ?? t.name ?? null
  };
}

/**
 * 某個 Stage 是否具備解算下一階段的前置條件（§7.1）。
 * @returns {{ready:boolean, reason:string}}
 */
export function canResolve(format, stageId, ctx, stageState = {}) {
  if (stageState.manualHold === true) return { ready: false, reason: 'Admin 已鎖定自動晉級' };

  // ⚠️ 這裡不可以 fail-open。少帶 stageMatches、stageId 拼錯、傳空陣列，
  //    都必須當成「不知道，所以不放行」，否則會拿沒打完的分組賽去填晉級名單。
  const stageMatches = ctx.stageMatches?.[stageId];
  if (!Array.isArray(stageMatches) || stageMatches.length === 0) {
    return { ready: false, reason: `缺少 ${stageId} 的場次資料，無法確認是否全部完賽` };
  }
  const pending = stageMatches.filter(m => !DECIDED_STATUSES.includes(m.status));
  if (pending.length) {
    return { ready: false, reason: `${stageId} 尚有 ${pending.length} 場未完賽` };
  }
  const tied = Object.values(ctx.standings || {})
    .filter(s => s.stageId === stageId && s.hasUnresolvedTie);
  if (tied.length) {
    return { ready: false, reason: `${tied.map(s => s.standingId).join('、')} 有待裁定的同分` };
  }
  return { ready: true, reason: '' };
}

/**
 * 依 Format.finalRankingMap 解算最終排名（§8.1）。
 *
 * @returns {{ranking:Array<{rank:number, teamId:string, name:string|null}>,
 *            complete:boolean, missing:Array<{rank:number, reason:string}>}}
 */
export function computeFinalRanking(format, ctx) {
  const ranking = [];
  const missing = [];

  for (const item of format?.finalRankingMap || []) {
    const r = explainTeamSource(item.from, ctx);
    if (!r.ready) { missing.push({ rank: item.rank, reason: r.reason }); continue; }
    const t = ctx.teams?.[r.teamId] || {};
    ranking.push({
      rank: item.rank,
      teamId: r.teamId,
      name: t.shortName ?? t.name ?? null,
      logoUrl: t.logoUrl ?? null
    });
  }

  ranking.sort((a, b) => a.rank - b.rank);
  return { ranking, complete: missing.length === 0, missing };
}
