/** CSV 球隊名冊：前端預覽與伺服器共用，任何錯誤都整份拒絕。 */
import { parseYmd, checkAge } from './eligibility.js';
import { isMinor } from './privacy.js';
import { REGISTRATION_LIMITS } from './formats.js';
import { toCsv } from './csv.js';

export const IMPORT_MAX_BYTES = 1024 * 1024;
export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_COLUMNS = [
  ['divisionId', '組別代碼'], ['teamName', '球隊名稱'], ['shortName', '球隊簡稱'],
  ['playerName', '球員姓名或暱稱'], ['jerseyNo', '背號'], ['birthDate', '出生日期'],
  ['idLast4', '身分證後四碼'], ['isGoalkeeper', '守門員'], ['isCaptain', '隊長']
];
const REQUIRED = ['divisionId', 'teamName', 'playerName', 'jerseyNo', 'birthDate', 'idLast4'];
export const normalizedTeamName = name => String(name ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('zh-TW');
export const importTeamKey = (divisionId, name) => JSON.stringify([divisionId, normalizedTeamName(name)]);

/** RFC 4180，包括 BOM、引號內逗號／換行／雙引號。不可用 split(',')。 */
export function parseTeamCsv(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > IMPORT_MAX_BYTES) throw new Error('CSV 必須小於 1 MB。');
  const source = text.replace(/^\uFEFF/, '');
  const table = [];
  let row = [], cell = '', quoted = false, closed = false;
  function endCell() { row.push(cell.trim()); cell = ''; closed = false; }
  function endRow() {
    endCell();
    if (row.some(Boolean)) table.push(row);
    row = [];
    if (table.length > IMPORT_MAX_ROWS + 1) throw new Error(`每份 CSV 最多 ${IMPORT_MAX_ROWS} 位球員。`);
  }
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (ch === ',') endCell();
    else if (ch === '\r' || ch === '\n') { endRow(); if (ch === '\r' && source[i + 1] === '\n') i++; }
    else if (ch === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || ch === '"') throw new Error('CSV 引號格式錯誤，請重新另存為 CSV UTF-8。');
      cell += ch;
    }
  }
  if (quoted) throw new Error('CSV 有未關閉的雙引號。');
  endRow();
  if (table.length < 2) throw new Error('CSV 需要標題列及至少一位球員。');
  const aliases = new Map(IMPORT_COLUMNS.flatMap(([key, label]) => [[key, key], [label, key]]));
  const headers = table.shift().map(h => aliases.get(h));
  if (headers.some(h => !h)) throw new Error('CSV 有不支援的欄位，請使用下載的範本（勿包含完整身分證字號或聯絡資料）。');
  if (new Set(headers).size !== headers.length) throw new Error('CSV 欄位名稱重複。');
  const missing = REQUIRED.filter(h => !headers.includes(h));
  if (missing.length) throw new Error(`缺少欄位：${missing.map(h => IMPORT_COLUMNS.find(c => c[0] === h)[1]).join('、')}。`);
  return table.map((cells, i) => {
    if (cells.length !== headers.length) throw new Error(`第 ${i + 2} 列的欄位數與標題列不同。`);
    return Object.fromEntries(headers.map((h, n) => [h, cells[n]]));
  });
}

export function teamCsvTemplate(divisionId = '') {
  return toCsv(IMPORT_COLUMNS.map(([key, label]) => ({ key, label })), [{
    divisionId, teamName: '範例球隊（請替換）', shortName: '範例', playerName: '小飛（未成年填暱稱）',
    jerseyNo: '7', birthDate: '2021-01-01', idLast4: '1234', isGoalkeeper: '否', isCaptain: '是'
  }]);
}

/** 只選取白名單欄位，不採用客戶端的 status、uid、teamId 或公開投影。 */
export function validateTeamImport(rows, { divisions = [], existingTeams = [], asOf } = {}) {
  const errors = [], teams = new Map(), people = new Map();
  const add = (row, message) => errors.push({ row, message });
  if (!Array.isArray(rows) || !rows.length || rows.length > IMPORT_MAX_ROWS) return { teams: [], errors: [{ row: 0, message: `請提供 1–${IMPORT_MAX_ROWS} 位球員。` }] };
  if (!parseYmd(asOf)) return { teams: [], errors: [{ row: 0, message: '賽事日期未設定，無法檢查參賽資格。' }] };
  const exists = new Set(existingTeams.map(t => importTeamKey(t.divisionId, t.name)));
  for (const [i, raw] of rows.entries()) {
    const rowNo = i + 2;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { add(rowNo, '資料列格式錯誤。'); continue; }
    const r = {};
    for (const [key] of IMPORT_COLUMNS) {
      if (raw[key] != null && typeof raw[key] !== 'string') add(rowNo, `${key} 必須是文字。`);
      r[key] = typeof raw[key] === 'string' ? raw[key].trim() : '';
    }
    for (const key of REQUIRED) if (!r[key]) add(rowNo, `請填${IMPORT_COLUMNS.find(c => c[0] === key)[1]}。`);
    const div = divisions.find(d => d.divisionId === r.divisionId);
    if (!div) { add(rowNo, `找不到組別「${r.divisionId}」，請使用下方組別代碼。`); continue; }
    for (const [key, max] of [['teamName', 60], ['shortName', 20], ['playerName', 40]]) {
      if (r[key].length > max || /[\u0000-\u001F\u007F]/u.test(r[key])) add(rowNo, `${IMPORT_COLUMNS.find(c => c[0] === key)[1]}不可含換行／控制字元，且最多 ${max} 字。`);
    }
    if (!/^\d{1,2}$/.test(r.jerseyNo)) add(rowNo, '背號必須是 0–99 的整數。');
    if (!parseYmd(r.birthDate) || r.birthDate < '1900-01-01' || r.birthDate >= asOf) add(rowNo, '出生日期須為有效西元 YYYY-MM-DD，且早於賽事日期。');
    if (!/^\d{4}$/.test(r.idLast4)) add(rowNo, '身分證後四碼須為四位數字（含開頭的 0），勿填完整字號。');
    const age = checkAge(r.birthDate, div);
    if (!age.ok) add(rowNo, age.message);
    const flag = key => {
      if (['', '否', 'false', '0'].includes(r[key])) return false;
      if (['是', 'true', '1'].includes(r[key])) return true;
      add(rowNo, `${IMPORT_COLUMNS.find(c => c[0] === key)[1]}請填「是」或「否」。`);
      return false;
    };
    const key = importTeamKey(r.divisionId, r.teamName);
    if (!teams.has(key)) {
      if (exists.has(key)) add(rowNo, `「${r.teamName}」已存在於此組別，不能重複匯入或覆蓋。`);
      teams.set(key, { key, divisionId: r.divisionId, name: r.teamName, shortName: r.shortName || r.teamName.slice(0, 20), members: [], row: rowNo });
    }
    const team = teams.get(key);
    if (r.shortName && team.shortName !== r.shortName) add(rowNo, '同一球隊的簡稱不一致。');
    const member = {
      name: r.playerName, nameKind: isMinor(r.birthDate, asOf, 18) ? 'nickname' : 'real',
      birthDate: r.birthDate, idLast4: r.idLast4, jerseyNo: /^\d{1,2}$/.test(r.jerseyNo) ? parseInt(r.jerseyNo, 10) : null,
      isGoalkeeper: flag('isGoalkeeper'), isCaptain: flag('isCaptain'), kind: 'player', role: 'player', status: 'approved'
    };
    if (team.members.some(m => m.jerseyNo === member.jerseyNo)) add(rowNo, `「${team.name}」的 ${r.jerseyNo} 號重複。`);
    if (member.isCaptain && team.members.some(m => m.isCaptain)) add(rowNo, `「${team.name}」只能有一位場上隊長。`);
    const person = `${r.birthDate}:${r.idLast4}`;
    if (people.has(person)) add(rowNo, `球員與第 ${people.get(person)} 列重複（生日及身分證後四碼相同），每人限報一隊。`);
    people.set(person, rowNo);
    team.members.push(member);
  }
  if (teams.size > 100) add(0, '每份 CSV 最多 100 支球隊。');
  for (const team of teams.values()) if (team.members.length > REGISTRATION_LIMITS.maxPlayers) add(team.row, `「${team.name}」超過每隊 ${REGISTRATION_LIMITS.maxPlayers} 位球員上限。`);
  return { teams: [...teams.values()], errors };
}
