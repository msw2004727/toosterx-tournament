import { validateMemberName, validateJerseyNo, validateIdentity } from './member-identity.js';
import { normalizedTeamName } from './team-import.js';
import { isMinor } from './privacy.js';
import { isPlayer } from './review.js';

export const MAX_PLAYERS_PER_ADD = 50;

/** 管理名冊可先只填姓名；有填的選填資料與同隊重複項目仍須有效。 */
export function validateTeamPlayers(rows, { division, asOf, existingMembers = [] } = {}) {
  const players = [], errors = [];
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_PLAYERS_PER_ADD) {
    return { players, errors: [`請新增 1–${MAX_PLAYERS_PER_ADD} 位球員。`] };
  }
  const current = existingMembers.filter(m => ['approved', 'pending'].includes(m.status) && isPlayer(m));
  const names = new Set(current.map(m => normalizedTeamName(m.name)));
  const jerseys = new Set(current.map(m => m.jerseyNo).filter(n => n != null));
  let captain = current.some(m => m.isCaptain === true);
  for (const [index, row] of rows.entries()) {
    const addError = message => errors.push(`第 ${index + 1} 位球員：${message}`);
    if (!row || typeof row !== 'object' || Array.isArray(row)) { addError('資料格式不正確。'); continue; }
    const name = validateMemberName(row.name), jersey = validateJerseyNo(row.jerseyNo);
    if (name.error) addError(name.error);
    if (jersey.error) addError(jersey.error);
    const birthDate = row.birthDate ?? '', idLast4 = row.idLast4 ?? '';
    const fields = { birthDate: typeof birthDate === 'string' ? birthDate.trim() : birthDate,
      idLast4: typeof idLast4 === 'string' ? idLast4.trim() : idLast4 };
    const identity = validateIdentity(fields, division, asOf);
    identity.errors.forEach(addError);
    for (const key of ['isCaptain', 'isGoalkeeper']) if (row[key] != null && typeof row[key] !== 'boolean') addError('隊長與守門員選項不正確。');
    const key = normalizedTeamName(name.value);
    if (name.value && names.has(key)) addError('同隊已有相同姓名／暱稱，請確認是否重複新增。');
    if (jersey.value != null && jerseys.has(jersey.value)) addError(`${jersey.value} 號已使用，請更換背號或留空。`);
    if (row.isCaptain === true && captain) addError('同隊只能有一位場上隊長。');
    if (name.value) names.add(key);
    if (jersey.value != null) jerseys.add(jersey.value);
    if (row.isCaptain === true) captain = true;
    players.push({ name: name.value, jerseyNo: jersey.value, ...fields, identityComplete: identity.complete,
      nameKind: fields.birthDate && !identity.errors.length && isMinor(fields.birthDate, asOf, 18) ? 'nickname' : 'real',
      isCaptain: row.isCaptain === true, isGoalkeeper: row.isGoalkeeper === true, kind: 'player', role: 'player', status: 'approved' });
  }
  return { players, errors };
}
