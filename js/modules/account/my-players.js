/**
 * 「我報名的球員」的純邏輯（`#/my`，docs/10 §1.3）
 * ------------------------------------------------------------------
 * 一個 LINE 帳號可以對應多個球員，而且可能分在不同球隊——家長替兩個小孩
 * 報不同隊是合法的（FR07）。所以名單要跨球隊查（collectionGroup('members')），
 * 再把每一筆配上它所屬的球隊。
 *
 * 這一支不碰 Firestore、不碰 DOM，只做「一批 members ＋ 球隊字典 → 畫面列」。
 * 查詢本身（含 where guardianUid == 自己）在 my.js；邊界在 firestore.rules。
 */

/** 成員狀態的顯示文字。給家長看的，不是給主辦看的 */
export const MEMBER_STATUS = {
  pending: '等隊長同意',
  approved: '已在名單上',
  rejected: '已被婉拒',
  removed: '已移除'
};

// 還在名單上（或還在等）的排前面，已經不在的排後面
const STATUS_RANK = { pending: 0, approved: 1, rejected: 2, removed: 3 };

/**
 * 從文件路徑取出球隊 id。
 * collectionGroup 查回來的文件只有路徑知道它在哪一隊：
 * `events/{e}/teams/{teamId}/members/{memberId}`
 * @returns {string|null}
 */
export function teamIdOfPath(path) {
  const seg = String(path ?? '').split('/');
  const i = seg.indexOf('teams');
  return i >= 0 && seg[i + 1] ? seg[i + 1] : null;
}

/**
 * @param {object} o
 * @param {Array<{ id: string, path?: string, data: object }>} o.members  查回來的成員（含路徑）
 * @param {Record<string, object>} o.teamsById  球隊文件字典（查不到的隊仍要列出來，只是隊名退回 id）
 * @returns {Array<object>} 依「狀態 → 隊名 → 背號 → 名字」排好的畫面列
 */
export function buildMyPlayerRows({ members, teamsById = {} }) {
  const rows = (Array.isArray(members) ? members : []).map(m => {
    const d = m?.data ?? {};
    const teamId = d.teamId ?? teamIdOfPath(m?.path);
    const team = (teamId && teamsById[teamId]) || null;
    const status = typeof d.status === 'string' ? d.status : 'pending';
    return {
      memberId: m?.id ?? d.memberId ?? null,
      teamId,
      teamName: team?.name || teamId || '（找不到球隊）',
      divisionId: team?.divisionId ?? null,
      name: d.name || '（沒有名字）',
      kind: d.kind || 'player',
      jerseyNo: typeof d.jerseyNo === 'number' ? d.jerseyNo : null,
      birthDate: typeof d.birthDate === 'string' ? d.birthDate : null,
      idLast4: typeof d.idLast4 === 'string' ? d.idLast4 : null,
      isSelf: d.isSelf === true,
      status,
      statusLabel: MEMBER_STATUS[status] || status
    };
  });

  rows.sort((a, b) =>
    (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
    || a.teamName.localeCompare(b.teamName, 'zh-Hant')
    || (a.jerseyNo ?? 999) - (b.jerseyNo ?? 999)
    || a.name.localeCompare(b.name, 'zh-Hant'));
  return rows;
}

/** 還在名單上（或還在等）的有幾位——標題用 */
export function countActive(rows) {
  return (rows ?? []).filter(r => r.status === 'pending' || r.status === 'approved').length;
}
