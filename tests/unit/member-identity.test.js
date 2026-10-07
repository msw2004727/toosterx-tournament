import { validateIdentity, csvIdentityPending, validateJerseyNo, validateMemberName } from '../../js/engine/member-identity.js';
import { validateTeamImport, parseTeamCsv } from '../../js/engine/team-import.js';
import { buildCheckin, checkinSummary, presentIds } from '../../js/modules/staff/checkin-actions.js';
const division = { divisionId: 'youth', eligibility: { bornOnOrAfter: '2016-09-01' } };
const date = '2026-10-09';

test.each([null, 123, {}, [], '', '   ', '名'.repeat(41), '王\n小明', '\t王小明', '王\u0000明', '王\u007F明'])('隊員更名拒絕空白、非文字及控制字元 %j', value => {
  expect(validateMemberName(value).error).toBeTruthy();
});
test.each([['  陳小飛  ', '陳小飛'], ['Mary Jane', 'Mary Jane'], ['名'.repeat(40), '名'.repeat(40)]])('隊員更名保留有效顯示名 %j', (input, value) => {
  expect(validateMemberName(input)).toEqual({ value, error: null });
});

test.each([null, undefined, '', '  '])('未指定背號 %j 不變成 0', value => {
  expect(validateJerseyNo(value)).toEqual({ value: null, error: null });
});
test.each([[0, 0], ['0', 0], ['00', 0], ['07', 7], [' 99 ', 99], [100, 100], ['111', 111], ['167', 167], ['999', 999], ['007', 7], ['000', 0]])('有效背號 %j 正規化', (input, value) => {
  expect(validateJerseyNo(input)).toEqual({ value, error: null });
});
test.each([-1, 1000, 1.5, true, {}, [], NaN, '1e1', '+1', '7.0', '0000', '０'])('拒絕非法背號 %j', value => {
  expect(validateJerseyNo(value).error).toBeTruthy();
});
test('沒有背號不影響有效身分檢錄；0 號仍保留', () => {
  for (const jerseyNo of [null, 0]) {
    const member = { memberId: 'independent-id', source: 'csv', birthDate: '2017-01-01', idLast4: '0012', jerseyNo };
    expect(csvIdentityPending(member)).toBe(false);
    expect(buildCheckin({ member, result: 'pass' })).toMatchObject({ jerseyNo, memberId: 'independent-id', result: 'pass' });
  }
});

test('省略身分欄位、多人留白不會誤判重複，仍可建立已核准球隊', () => {
  const rows = parseTeamCsv('divisionId,teamName,playerName,jerseyNo\nyouth,新隊,小飛,1\nyouth,新隊,小球,2');
  const plan = validateTeamImport(rows, { divisions: [division], asOf: date });
  expect(plan.errors).toEqual([]);
  expect(plan.teams[0].members).toHaveLength(2);
  expect(plan.teams[0].members.every(m => m.status === 'approved' && m.identityComplete === false && m.nameKind === 'real')).toBe(true);
});
test.each([{ birthDate: '', idLast4: '' }, { birthDate: '2017-01-01', idLast4: '' }, { birthDate: '', idLast4: '0012' }])('允許部分補件但不當作完整 %j', fields => {
  expect(validateIdentity(fields, division, date)).toEqual({ errors: [], complete: false });
});
test.each([{ birthDate: '2015-01-01', idLast4: '' }, { birthDate: '2020-02-30', idLast4: '0012' }, { birthDate: '', idLast4: '12' }, { birthDate: null, idLast4: 1234 }, { birthDate: '2027-01-01', idLast4: '1234' }])('有填錯值仍擋下 %j', fields => {
  expect(validateIdentity(fields, division, date).errors.length).toBeGreaterThan(0);
});
test('資格設定遺失不能判成通過；有效後四碼保留零', () => {
  const fields = { birthDate: '2017-01-01', idLast4: '0012' };
  expect(validateIdentity(fields, division, date).complete).toBe(true);
  expect(validateIdentity(fields, null, date).complete).toBe(false);
  expect(validateIdentity(fields, division, '').complete).toBe(false);
});
test('CSV 待補球員可先檢錄，pass 計入出賽；待補提示仍保留', () => {
  const m = { memberId: 'p', source: 'csv', birthDate: '', idLast4: '0012', identityComplete: true };
  expect(csvIdentityPending(m)).toBe(true);
  expect(buildCheckin({ member: m, result: 'pass' }).result).toBe('pass');
  expect(buildCheckin({ member: m, result: 'fail' }).result).toBe('fail');
  expect(checkinSummary([m], { p: { result: 'pass' } }).present).toBe(1);
  expect(presentIds([m], { p: { result: 'pass' } })).toEqual(['p']);
  expect(csvIdentityPending({ ...m, birthDate: '2017-01-01', identityComplete: undefined })).toBe(false);
  expect(csvIdentityPending({ ...m, birthDate: '2017-01-01', identityComplete: false })).toBe(true);
});
