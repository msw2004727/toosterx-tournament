import { describe, test, expect } from '@jest/globals';
import { CHALLENGES, buildSeed } from '../../scripts/seed/build.js';
import { drawEntries, completionProgress, settledDrawEntries, formatScore, validateScore, completesChallenge } from '../../js/engine/challenge.js';
import { resolveScore, inputModeOf } from '../../js/modules/booth/actions.js';
import { luckyDrawRows } from '../../js/engine/csv.js';

const rewards = buildSeed().docs.find(d => d.path === 'config/challengeRewards').data;
const ids = CHALLENGES.map(c => c.challengeId);
const medical = CHALLENGES.find(c => c.inputMode === 'checkin');
const cones = CHALLENGES.find(c => c.requireShotDetails);

describe('七項集章與一次抽獎', () => {
  test('設定包含原五關、中醫簽到及一球三桶，七個不同圖示', () => {
    expect(CHALLENGES).toHaveLength(7);
    expect(CHALLENGES.map(c => c.name)).toEqual(expect.arrayContaining(['中醫運動恢復站', '一球三桶']));
    expect(new Set(CHALLENGES.map(c => c.icon)).size).toBe(7);
    expect(rewards.requiredChallengeIds).toEqual(ids);
  });
  test.each([0, 1, 5, 6])('完成 %i 項沒有資格', count => {
    expect(drawEntries({ completedChallengeIds: ids.slice(0, count), rewards }).entries).toBe(0);
  });
  test('全七項只發一次，重複挑戰不多發，額外項目不影響', () => {
    expect(drawEntries({ completedChallengeIds: [...ids, ...ids, 'extra'], rewards }))
      .toEqual({ entries: 1, fromCompletion: 0, bonus: 1, allComplete: true });
  });
  test('六個指定項目加一個未知代碼不能湊成七項', () => {
    expect(drawEntries({ completedChallengeIds: [...ids.slice(0, 6), 'unknown'], challengeTotal: 7, rewards }).entries).toBe(0);
    expect(completionProgress([...ids.slice(0, 6), 'unknown'], CHALLENGES, rewards).done).toHaveLength(6);
  });
  test.each([null, [], ['a', 'a'], ['a', null]])('必要項目設定錯誤不發券：%j', requiredChallengeIds => {
    expect(drawEntries({ completedChallengeIds: ids, rewards: { ...rewards, requiredChallengeIds } }).entries).toBe(0);
  });
  test('缺少規則／無效張數設定不發券', () => {
    expect(drawEntries({ completedChallengeIds: ids }).entries).toBe(0);
    expect(drawEntries({ completedChallengeIds: ids, rewards: { ...rewards, entriesOnAllComplete: '1' } }).entries).toBe(0);
  });
  test('新規則結算前不顯示或匯出舊張數', () => {
    const old = { playerId: 'old', luckyDrawEntries: 7, completedChallengeIds: ids.slice(0, 5) };
    const current = { playerId: 'current', luckyDrawEntries: 1, completedChallengeIds: ids, luckyDrawRuleVersion: rewards.version };
    expect(settledDrawEntries(old, rewards)).toBeNull();
    expect(settledDrawEntries(current, rewards)).toBe(1);
    expect(luckyDrawRows([old, current], { rewards }).map(p => [p.playerId, p.entries])).toEqual([['current', 1]]);
  });
});

describe('新增項目輸入與完成認定', () => {
  test('中醫必須先由人員確認，送出單純簽到值', () => {
    expect(inputModeOf(medical)).toBe('checkin');
    expect(resolveScore({ challenge: medical, value: null }).ok).toBe(false);
    expect(resolveScore({ challenge: medical, value: 0 }).ok).toBe(false);
    expect(resolveScore({ challenge: medical, value: 1 })).toMatchObject({ ok: true, rawValue: 1, detail: null });
    expect(formatScore(1, medical)).toBe('已簽到');
    expect(medical.leaderboardEnabled).toBe(false);
  });
  test('三球逐球記錄成功／失敗，加總全倒次數', () => {
    expect(resolveScore({ challenge: cones, detail: [1, 0, 1] })).toMatchObject({ ok: true, rawValue: 2, detail: [1, 0, 1] });
    expect(resolveScore({ challenge: cones, detail: [0, 0, 0] })).toMatchObject({ ok: true, rawValue: 0 });
    expect(resolveScore({ challenge: cones, detail: [1, 1] }).ok).toBe(false);
    expect(resolveScore({ challenge: cones, detail: [1, 2, 1] }).ok).toBe(false);
    expect(validateScore(0.5, cones).ok).toBe(false);
  });
  test('完成認定由設定決定，作廢不集章', () => {
    expect(completesChallenge({ rawValue: 0 }, { completionMinValue: 0 })).toBe(true);
    expect(completesChallenge({ rawValue: 0 }, { completionMinValue: 1 })).toBe(false);
    expect(completesChallenge({ rawValue: 1 }, { completionMinValue: 1 })).toBe(true);
    expect(completesChallenge({ rawValue: 1, voided: true }, { completionMinValue: 1 })).toBe(false);
    expect(completesChallenge({ rawValue: 1 }, { completionMinValue: '1' })).toBe(false);
  });
});
