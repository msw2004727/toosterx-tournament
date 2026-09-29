import { parseTeamCsv, validateTeamImport, teamCsvTemplate, IMPORT_COLUMNS, IMPORT_MAX_BYTES } from '../../js/engine/team-import.js';
import { toCsv } from '../../js/engine/csv.js';
import { registrationState, buildRegistrationPatch } from '../../js/engine/registration.js';

const div = { divisionId: 'youth', name: '學童組', eligibility: { bornOnOrAfter: '2016-09-01' } };
const ctx = { divisions: [div], asOf: '2026-10-09' };
const row = over => ({ divisionId: 'youth', teamName: '飛達', shortName: '飛達', playerName: '小飛', jerseyNo: '7', birthDate: '2017-01-01', idLast4: '0012', isCaptain: '', isGoalkeeper: '', ...over });
const csv = rows => toCsv(IMPORT_COLUMNS.map(([key, label]) => ({ key, label })), rows);
const errors = (rows, context = ctx) => validateTeamImport(rows, context).errors;

test('UTF-8 BOM 範本可往返，保留後四碼開頭 0', () => {
  expect(parseTeamCsv(csv([row()]))).toEqual([row()]);
  expect(parseTeamCsv(teamCsvTemplate('youth'))[0].divisionId).toBe('youth');
});
test('引號內逗號、雙引號與換行不會切錯欄位', () => {
  expect(parseTeamCsv(csv([row({ playerName: '小,飛"\n同學' })]))[0].playerName).toBe('小,飛"\n同學');
});
test.each(['', '球隊名稱\n飛達', 'teamName,teamName\na,b', 'teamName,secrets\na,b', '"unterminated', 'teamName\na"b', 'teamName\n"a"x'])('拒絕錯誤 CSV %s', source => {
  expect(() => parseTeamCsv(source)).toThrow();
});
test('拒絕過大檔案及欄位數不符', () => {
  expect(() => parseTeamCsv('x'.repeat(IMPORT_MAX_BYTES + 1))).toThrow('1 MB');
  expect(() => parseTeamCsv(csv([row()]) + 'a,b\n')).toThrow('欄位數');
});
test('多隊分組、直接核准、未成年只以暱稱投影', () => {
  const plan = validateTeamImport([row(), row({ teamName: '另一隊', jerseyNo: '9', idLast4: '8888' })], ctx);
  expect(plan.errors).toEqual([]);
  expect(plan.teams).toHaveLength(2);
  expect(plan.teams[0].members[0]).toMatchObject({ nameKind: 'nickname', status: 'approved', jerseyNo: 7, idLast4: '0012' });
  expect(plan.teams[0].members[0]).not.toHaveProperty('guardianUid');
});
test.each([
  { divisionId: 'missing' }, { birthDate: '115-01-01' }, { birthDate: '2020-02-30' }, { birthDate: '2015-08-01' },
  { birthDate: '2027-01-01' }, { idLast4: '12' }, { idLast4: 'A123456789' }, { jerseyNo: '1.5' }, { jerseyNo: '-1' },
  { jerseyNo: '100' }, { playerName: '' }, { teamName: 'x\nname' }, { isCaptain: 'maybe' }, { jerseyNo: 5 }
])('第 2 列格式或資格錯誤會擋匯入 %j', patch => {
  expect(errors([row(patch)])[0].row).toBe(2);
});
test('同隊背號重複、簡稱不同與兩位隊長均擋下', () => {
  expect(errors([row(), row({ idLast4: '9999' })]).some(e => e.message.includes('號重複'))).toBe(true);
  expect(errors([row(), row({ idLast4: '8888', jerseyNo: '8', shortName: '另一簡稱' })]).some(e => e.message.includes('簡稱'))).toBe(true);
  expect(errors([row({ isCaptain: '是' }), row({ idLast4: '8888', jerseyNo: '8', isCaptain: '是' })]).some(e => e.message.includes('一位場上隊長'))).toBe(true);
});
test('同組同隊不得覆蓋，含全形及空格正規化', () => {
  expect(errors([row({ teamName: 'Ａ ＦＣ' })], { ...ctx, existingTeams: [{ divisionId: 'youth', name: 'a  fc' }] })).not.toEqual([]);
});
test('15 人可匯入，16 人不行；缺設定及 1,001 列失敗', () => {
  const rows = Array.from({ length: 16 }, (_, i) => row({ jerseyNo: String(i), idLast4: String(1000 + i) }));
  expect(errors(rows.slice(0, 15))).toEqual([]);
  expect(errors(rows).some(e => e.message.includes('15'))).toBe(true);
  expect(errors([row()], {})).not.toEqual([]);
  expect(errors(Array(1001).fill(row()))).not.toEqual([]);
});
test('未成年成人組也用暱稱，成年使用姓名；忽略額外的管理欄位', () => {
  const context = { ...ctx, divisions: [{ divisionId: 'youth' }] };
  const plan = validateTeamImport([row({ birthDate: '2000-01-01', status: 'pending', guardianUid: 'fake' })], context);
  expect(plan.teams[0].members[0]).toMatchObject({ nameKind: 'real', status: 'approved' });
  expect(plan.teams[0].members[0].guardianUid).toBeUndefined();
});
test('隱藏報名優先於開放旗標，儲存隱藏必定同步關閉', () => {
  expect(registrationState({ open: true, hidden: true }).open).toBe(false);
  expect(buildRegistrationPatch({ open: true, hidden: true })).toMatchObject({ open: false, hidden: true });
});

test('同一球員可同份 CSV 匯入不同隊，生日及後四碼相同不阻擋', () => {
  const plan = validateTeamImport([row(), row({ teamName: '其他队' })], ctx);
  expect(plan.errors).toEqual([]);
  expect(plan.teams).toHaveLength(2);
});
