/** 隊名修正：驗證與顯示投影共用，不變更球隊識別、成績或名次。 */
export function teamNameBasis(team) {
  return { name: team.name ?? null, shortName: team.shortName ?? null, revision: team.nameRevision ?? 0 };
}

export function validateTeamNames({ name, shortName, reason } = {}) {
  const errors = [];
  for (const [value, label, max] of [[name, '球隊名稱', 60], [shortName, '球隊簡稱', 20], [reason, '修改原因', 200]]) {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u001F\u007F]/u.test(value ?? '')) {
      errors.push(`${label}必須是文字，不可含換行或控制字元，且最多 ${max} 字。`);
    }
  }
  const full = typeof name === 'string' ? name.trim() : '';
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (!full) errors.push('請填球隊名稱。');
  if (!why) errors.push('請填修改原因。');
  return { errors, fields: { name: full, shortName: typeof shortName === 'string' && shortName.trim() ? shortName.trim() : full.slice(0, 20), reason: why } };
}

export function renamedMatchPatch(match, teamId, names) {
  const patch = {};
  for (const side of ['home', 'away']) if (match[side]?.teamId === teamId) {
    patch[`${side}.name`] = names.name;
    patch[`${side}.displayName`] = names.shortName;
  }
  return patch;
}

export const renamedRankingRows = (rows, teamId, names) => rows.map(row =>
  row.teamId === teamId ? { ...row, name: names.shortName } : row);

export function renamedBoardPatch(board, boardId, teamId, names) {
  const patch = {};
  if (Array.isArray(board.rows) && board.rows.some(row => row.teamId === teamId)) {
    if (boardId === 'fairplay') patch.rows = board.rows.map(row => row.teamId === teamId ? { ...row, name: names.name } : row);
    else if (board.rows.some(row => row.teamId === teamId && Object.hasOwn(row, 'teamName'))) {
      patch.rows = board.rows.map(row => row.teamId === teamId && Object.hasOwn(row, 'teamName') ? { ...row, teamName: names.shortName } : row);
    }
  }
  for (const key of ['liveMatches', 'nextMatches', 'justFinished']) {
    if (!Array.isArray(board[key]) || !board[key].some(match => match.home?.teamId === teamId || match.away?.teamId === teamId)) continue;
    patch[key] = board[key].map(match => {
      const next = { ...match };
      for (const side of ['home', 'away']) if (match[side]?.teamId === teamId) next[side] = { ...match[side], name: names.name, displayName: names.shortName };
      return next;
    });
  }
  return patch;
}
