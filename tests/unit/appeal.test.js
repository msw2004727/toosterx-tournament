/**
 * T54 申訴（競賽規章第二十條、附件三）
 * ------------------------------------------------------------------
 * 規章明文三件事：領隊或總教練提出、賽後三十分鐘內、保證金貳仟元；
 * 不成立保證金不予發還。這一組守的是「系統照規章擋、照規章記」。
 */
import { describe, test, expect } from '@jest/globals';
import {
  APPEAL_ROLES, APPEAL_STATUSES, appealWindow, buildAppealDoc, buildAppealDecision, matchAppealFlag
} from '../../js/engine/appeal.js';
import { APPEAL_RULES } from '../../js/engine/formats.js';
import { APPEAL_STATUS_LABEL } from '../../js/lib/format.js';

const END = Date.parse('2026-10-11T10:00:00+08:00');
const MIN = 60_000;
const match = {
  matchId: 'AO-G-A-01', matchNo: 5, divisionId: 'adult-open',
  home: { teamId: 't-1' }, away: { teamId: 't-2' }, teamIds: ['t-1', 't-2']
};
const base = {
  match, teamId: 't-1', role: 'leader', filerName: '王領隊', phone: '0912-345-678',
  reason: '第 60 分鐘的進球越位在先', filedAtMs: END + 10 * MIN, matchEndedAtMs: END, depositPaid: true,
  actorUid: 'u-admin'
};

describe('T54-1 規章常數', () => {
  test('三十分鐘、貳仟元、領隊或總教練（規章第二十條）', () => {
    expect(APPEAL_RULES.windowMin).toBe(30);
    expect(APPEAL_RULES.deposit).toBe(2000);
    expect(Object.keys(APPEAL_ROLES).sort()).toEqual(['headCoach', 'leader']);
    // 每一個狀態代碼都有顯示文字（少一個的話公開端會印出英文代碼）
    for (const s of APPEAL_STATUSES) expect(APPEAL_STATUS_LABEL[s]).toBeTruthy();
  });
});

describe('T54-2 appealWindow', () => {
  test('賽後 10 分鐘在期限內', () => {
    const w = appealWindow({ matchEndedAtMs: END, filedAtMs: END + 10 * MIN });
    expect(w).toMatchObject({ ready: true, withinWindow: true, minutesAfter: 10, deadlineMs: END + 30 * MIN });
  });
  test('⭐ 剛好 30 分鐘算在期限內，31 分鐘就不算', () => {
    expect(appealWindow({ matchEndedAtMs: END, filedAtMs: END + 30 * MIN }).withinWindow).toBe(true);
    expect(appealWindow({ matchEndedAtMs: END, filedAtMs: END + 31 * MIN }).withinWindow).toBe(false);
  });
  test('⭐ 沒有完賽時間就算不出期限（fail-closed，不假裝在期限內）', () => {
    expect(appealWindow({ matchEndedAtMs: null, filedAtMs: END })).toMatchObject({ ready: false });
    expect(appealWindow({ matchEndedAtMs: END, filedAtMs: undefined })).toMatchObject({ ready: false });
  });
});

describe('T54-3 buildAppealDoc', () => {
  test('⭐ 合法的申訴：id 是 場次-隊伍，文件記齊規章要的東西', () => {
    const { appealId, doc } = buildAppealDoc(base);
    expect(appealId).toBe('AO-G-A-01-t-1');
    expect(doc).toMatchObject({
      matchId: 'AO-G-A-01', matchNo: 5, divisionId: 'adult-open',
      teamId: 't-1', opponentTeamId: 't-2',
      filedBy: { role: 'leader', name: '王領隊', phone: '0912-345-678' },
      minutesAfter: 10, withinWindow: true, late: false,
      deposit: 2000, depositPaid: true,
      status: 'filed', decision: null, createdBy: 'u-admin'
    });
  });

  test('⭐ 申訴單位必須是這一場的其中一隊', () => {
    expect(() => buildAppealDoc({ ...base, teamId: 't-9' })).toThrow('其中一隊');
  });

  test('⭐ 只有領隊或總教練能提（教練、隊長都不行）', () => {
    expect(() => buildAppealDoc({ ...base, role: 'coach' })).toThrow('領隊或總教練');
    expect(buildAppealDoc({ ...base, role: 'headCoach' }).doc.filedBy.role).toBe('headCoach');
  });

  test('⭐ 保證金沒收到不受理', () => {
    expect(() => buildAppealDoc({ ...base, depositPaid: false })).toThrow('保證金');
    expect(() => buildAppealDoc({ ...base, depositPaid: 'yes' })).toThrow('保證金');
  });

  test('事由太短、姓名空白都擋', () => {
    expect(() => buildAppealDoc({ ...base, reason: '不服' })).toThrow('5 個字');
    expect(() => buildAppealDoc({ ...base, filerName: '  ' })).toThrow('姓名');
  });

  test('⭐ 逾時的申訴規章不受理；主辦要破例必須明確帶 late，而且文件會記下 late', () => {
    const lateAt = END + 45 * MIN;
    expect(() => buildAppealDoc({ ...base, filedAtMs: lateAt })).toThrow('30 分鐘');
    const { doc } = buildAppealDoc({ ...base, filedAtMs: lateAt, late: true });
    expect(doc).toMatchObject({ withinWindow: false, late: true, minutesAfter: 45 });
  });

  test('沒有完賽時間就登記不了', () => {
    expect(() => buildAppealDoc({ ...base, matchEndedAtMs: null })).toThrow('完賽');
  });
});

describe('T54-4 buildAppealDecision', () => {
  test('⭐ 成立退還保證金；不成立不予發還（由規章決定，不由畫面選）', () => {
    expect(buildAppealDecision({ upheld: true, note: '進球前確有越位', actorUid: 'u-a' }))
      .toMatchObject({ status: 'upheld', decision: { upheld: true, depositReturned: true, byUid: 'u-a' } });
    expect(buildAppealDecision({ upheld: false, note: '錄影顯示無越位', actorUid: 'u-a' }))
      .toMatchObject({ status: 'dismissed', decision: { upheld: false, depositReturned: false } });
  });
  test('⭐ 裁決意見必填；成立與否要明確', () => {
    expect(() => buildAppealDecision({ upheld: true, note: '' })).toThrow('裁決意見');
    expect(() => buildAppealDecision({ upheld: 'yes', note: 'x' })).toThrow('成立');
  });
});

describe('T54-5 matchAppealFlag', () => {
  test('寫到場次上的只有狀態與隊伍，沒有事由與電話', () => {
    const { doc } = buildAppealDoc(base);
    expect(matchAppealFlag(doc)).toEqual({ status: 'filed', teamId: 't-1' });
    expect(matchAppealFlag(null)).toBeNull();
  });
});
