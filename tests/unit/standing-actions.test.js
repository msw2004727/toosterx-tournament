/**
 * T49 人工裁定同分的純邏輯
 * ------------------------------------------------------------------
 * 規章第十九條的第 5 順位是抽籤，而引擎依 R-ENG-004 不擲骰子——
 * 它只標 `hasUnresolvedTie` 等人回填。這一組負責「按下去之前算得出來的
 * 東西」：誰跟誰同分、換完之後的順序、抽籤抽出什麼。
 *
 * ⭐ 最重要的一條是 `pinsFrom` 用**原本那一群佔的名次**而不是 1、2、3。
 *    寫成 1、2 的話 `applyManualRanking` 不會抱怨，它只是照著釘——
 *    然後 A 組第 3、4 名同分的裁定會把那兩隊釘到榜首。
 */

import {
  tiedRowsOf, tieGroupsOf, needsRuling, isRuled,
  pinsFrom, moveInOrder, drawTieOrder, newSeed, consequencesOf, namesOf
} from '../../js/modules/admin/standing-actions.js';
import { applyManualRanking } from '../../js/engine/ranking.js';

/** 一份「第 1、2 名完全同分」的積分榜 */
const TIED_12 = {
  standingId: 'u6__group__A', divisionId: 'u6', stageId: 'group', groupId: 'A',
  hasUnresolvedTie: true,
  rows: [
    { teamId: 't1', rank: 1, points: 3, goalsFor: 1, goalsAgainst: 1, goalDiff: 0, hasUnresolvedTie: true, tiedWith: ['t2'] },
    { teamId: 't2', rank: 2, points: 3, goalsFor: 1, goalsAgainst: 1, goalDiff: 0, hasUnresolvedTie: true, tiedWith: ['t1'] },
    { teamId: 't3', rank: 3, points: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, hasUnresolvedTie: false, tiedWith: [] }
  ]
};

describe('T49-1 找出待裁定的同分群', () => {
  test('只收 hasUnresolvedTie 的列', () => {
    expect(tiedRowsOf(TIED_12).map(r => r.teamId)).toEqual(['t1', 't2']);
  });

  test('⭐ 權威是 hasUnresolvedTie，不是 tiedWith', () => {
    // t3 跟 t4 積分一樣、`tiedWith` 也互相指著（日後畫 tieBreakTrace 時
    // 很自然會這樣填），但對戰關係分得出勝負——引擎沒有標 hasUnresolvedTie。
    // 只看 tiedWith 的話他們會被列成待裁定，主辦會以為系統算不動。
    const s = {
      ...TIED_12,
      rows: [
        TIED_12.rows[0], TIED_12.rows[1],
        { teamId: 't3', rank: 3, points: 0, hasUnresolvedTie: false, tiedWith: ['t4'] },
        { teamId: 't4', rank: 4, points: 0, hasUnresolvedTie: false, tiedWith: ['t3'] }
      ]
    };
    const groups = tieGroupsOf(s);
    expect(groups).toHaveLength(1);
    expect(groups[0].teamIds).toEqual(['t1', 't2']);
  });

  test('一群只出現一次（t1 掃過之後不再由 t2 產生第二群）', () => {
    expect(tieGroupsOf(TIED_12)).toHaveLength(1);
  });

  test('三隊同分算一群', () => {
    const s = {
      hasUnresolvedTie: true,
      rows: [
        { teamId: 'a', rank: 1, hasUnresolvedTie: true, tiedWith: ['b', 'c'] },
        { teamId: 'b', rank: 2, hasUnresolvedTie: true, tiedWith: ['a', 'c'] },
        { teamId: 'c', rank: 3, hasUnresolvedTie: true, tiedWith: ['a', 'b'] }
      ]
    };
    const g = tieGroupsOf(s);
    expect(g).toHaveLength(1);
    expect(g[0].teamIds).toEqual(['a', 'b', 'c']);
    expect(g[0].ranks).toEqual([1, 2, 3]);
  });

  test('tiedWith 只有單邊記著時也收得到（B 記著 A、A 沒記 B）', () => {
    const s = {
      hasUnresolvedTie: true,
      rows: [
        { teamId: 'a', rank: 1, hasUnresolvedTie: true, tiedWith: [] },
        { teamId: 'b', rank: 2, hasUnresolvedTie: true, tiedWith: ['a'] }
      ]
    };
    // a 自己那一列湊不出兩隊 → 跳過；b 那一列補得起來
    expect(tieGroupsOf(s)[0].teamIds).toEqual(['a', 'b']);
  });

  test('同分群的名次照 rank 由小到大', () => {
    const s = {
      hasUnresolvedTie: true,
      rows: [
        { teamId: 'b', rank: 4, hasUnresolvedTie: true, tiedWith: ['a'] },
        { teamId: 'a', rank: 3, hasUnresolvedTie: true, tiedWith: ['b'] }
      ]
    };
    expect(tieGroupsOf(s)[0].ranks).toEqual([3, 4]);
  });

  test('沒有 rows 不會爆', () => {
    expect(tieGroupsOf(null)).toEqual([]);
    expect(tieGroupsOf({})).toEqual([]);
    expect(tiedRowsOf(null)).toEqual([]);
  });
});

describe('T49-2 需不需要裁定 / 有沒有被裁定過', () => {
  test('hasUnresolvedTie 為真而且真的湊得出同分群才算待裁定', () => {
    expect(needsRuling(TIED_12)).toBe(true);
  });

  test('旗標是真、但沒有任何一列標記時不算（不畫一張裁不了的卡）', () => {
    expect(needsRuling({ hasUnresolvedTie: true, rows: [{ teamId: 'a', rank: 1 }] })).toBe(false);
  });

  test('旗標是假就不算，即使某一列忘了清乾淨', () => {
    expect(needsRuling({ hasUnresolvedTie: false, rows: TIED_12.rows })).toBe(false);
  });

  test('isRuled 看 manualOverride 或 rows 上的 locked', () => {
    expect(isRuled({ manualOverride: { enabled: true } })).toBe(true);
    expect(isRuled({ rows: [{ teamId: 'a', rank: 1, locked: true }] })).toBe(true);
    expect(isRuled({ manualOverride: { enabled: false }, rows: TIED_12.rows })).toBe(false);
    expect(isRuled(null)).toBe(false);
  });
});

describe('T49-3 pinsFrom：名次是原本那一群佔的名次', () => {
  test('第 1、2 名同分 → 釘 1、2', () => {
    expect(pinsFrom(['t2', 't1'], [1, 2])).toEqual([
      { teamId: 't2', rank: 1 }, { teamId: 't1', rank: 2 }
    ]);
  });

  test('⭐ 第 3、4 名同分 → 釘 3、4，不是 1、2', () => {
    // 這是這一支存在的理由。寫成 1、2 的話 applyManualRanking 照樣照著釘，
    // 而那會把兩隊搬到榜首——整張積分榜錯掉，而且不會有任何錯誤訊息。
    expect(pinsFrom(['d', 'c'], [3, 4])).toEqual([
      { teamId: 'd', rank: 3 }, { teamId: 'c', rank: 4 }
    ]);
  });

  test('名次沒有排序過也要由小到大配', () => {
    expect(pinsFrom(['x', 'y'], [4, 3])).toEqual([
      { teamId: 'x', rank: 3 }, { teamId: 'y', rank: 4 }
    ]);
  });

  test('隊數跟名次數對不上要丟錯，不可以默默少釘一隊', () => {
    expect(() => pinsFrom(['a', 'b', 'c'], [1, 2])).toThrow();
    expect(() => pinsFrom(['a'], [1, 2])).toThrow();
  });

  test('接上引擎：釘 3、4 之後前兩名不動', () => {
    const rows = [
      { teamId: 'a', rank: 1 }, { teamId: 'b', rank: 2 },
      { teamId: 'c', rank: 3, hasUnresolvedTie: true, tiedWith: ['d'] },
      { teamId: 'd', rank: 4, hasUnresolvedTie: true, tiedWith: ['c'] }
    ];
    const out = applyManualRanking(rows, pinsFrom(['d', 'c'], [3, 4]));
    expect(out.map(r => r.teamId)).toEqual(['a', 'b', 'd', 'c']);
    expect(out.map(r => r.rank)).toEqual([1, 2, 3, 4]);
    expect(out.every(r => r.hasUnresolvedTie !== true)).toBe(true);
  });
});

describe('T49-4 上下移', () => {
  test('往上換一格', () => {
    expect(moveInOrder(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
  });

  test('往下換一格', () => {
    expect(moveInOrder(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });

  test('第一個往上、最後一個往下都是原地不動（不繞回去）', () => {
    // 繞回去的話按住往上會讓第一名突然掉到最後——按鈕在畫面上是 disabled，
    // 但鍵盤與程式呼叫繞得過去
    expect(moveInOrder(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  test('不動原陣列', () => {
    const src = ['a', 'b'];
    moveInOrder(src, 0, 1);
    expect(src).toEqual(['a', 'b']);
  });

  test('索引超出範圍原樣回傳', () => {
    expect(moveInOrder(['a', 'b'], 9, -1)).toEqual(['a', 'b']);
    expect(moveInOrder(['a', 'b'], -3, 1)).toEqual(['a', 'b']);
  });
});

describe('T49-5 抽籤要重放得出來', () => {
  test('⭐ 同一個種子永遠抽出同一個順序', () => {
    // 規章第十四／十九條要的是抽籤，而抽籤的價值在於事後重放得出來。
    const a = drawTieOrder(['t1', 't2', 't3', 't4'], 20260905);
    const b = drawTieOrder(['t1', 't2', 't3', 't4'], 20260905);
    expect(a).toEqual(b);
  });

  test('不同種子會抽出不同順序（至少在四隊時分得開）', () => {
    const seen = new Set();
    for (let s = 1; s <= 40; s++) seen.add(drawTieOrder(['a', 'b', 'c', 'd'], s).join(''));
    expect(seen.size).toBeGreaterThan(1);
  });

  test('抽出來的是同一批隊伍，不多不少', () => {
    const out = drawTieOrder(['a', 'b', 'c'], 7);
    expect([...out].sort()).toEqual(['a', 'b', 'c']);
  });

  test('沒有種子要丟錯，不可以自己生一個（R-ENG-004）', () => {
    expect(() => drawTieOrder(['a', 'b'])).toThrow();
    expect(() => drawTieOrder(['a', 'b'], 1.5)).toThrow();
  });

  test('newSeed 產出可以直接餵給 drawTieOrder 的正整數', () => {
    for (let i = 0; i < 20; i++) {
      const s = newSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(() => drawTieOrder(['a', 'b'], s)).not.toThrow();
    }
  });
});

describe('T49-6 按下去之前要講的話', () => {
  test('一定要提到公開端會馬上看到', () => {
    expect(consequencesOf().join('')).toMatch(/公開端/);
  });

  test('有下游時要提到晉級會被解算', () => {
    expect(consequencesOf({ hasDownstream: true }).join('')).toMatch(/晉級/);
    expect(consequencesOf({ hasDownstream: false }).join('')).not.toMatch(/晉級/);
  });

  test('一定要提到會留痕', () => {
    expect(consequencesOf().join('')).toMatch(/稽核/);
  });

  test('namesOf 查不到就退回 id，不顯示空白', () => {
    expect(namesOf(['a', 'zz'], { a: { name: '甲隊' } })).toBe('甲隊、zz');
  });
});
