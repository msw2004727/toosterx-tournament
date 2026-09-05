/**
 * T53 「我報名的球員」的純邏輯（#/my，docs/10 §1.3，M4-d）
 * ------------------------------------------------------------------
 * 一個 LINE 帳號可以對應多個球員，而且分在不同球隊。這裡守的是
 * 「查回來的一批 members ＋ 球隊字典 → 家長看到的列」：
 *   ・每一筆要配到自己那一隊（從路徑取 teamId），查不到隊也要列出來
 *   ・排序：還在名單上（或還在等）的在前面，已經不在的在後面
 *   ・標題的人數只算前者
 */
import { describe, test, expect } from '@jest/globals';
import {
  buildMyPlayerRows, teamIdOfPath, countActive, MEMBER_STATUS
} from '../../js/modules/account/my-players.js';

const E = 'feda-cup-2026';
const m = (team, id, data) => ({ id, path: `events/${E}/teams/${team}/members/${id}`, data });
const TEAMS = {
  't-1': { teamId: 't-1', name: '大甲金剛', divisionId: 'u10' },
  't-2': { teamId: 't-2', name: '龍井白鯊', divisionId: 'u8' }
};

describe('T53-1 teamIdOfPath', () => {
  test('從 collectionGroup 的文件路徑取出球隊 id', () => {
    expect(teamIdOfPath(`events/${E}/teams/t-1/members/m-a`)).toBe('t-1');
  });
  test('不是球隊底下的路徑回 null，不丟例外', () => {
    expect(teamIdOfPath('players/FEDA-0001')).toBeNull();
    expect(teamIdOfPath(null)).toBeNull();
    expect(teamIdOfPath('')).toBeNull();
  });
});

describe('T53-2 buildMyPlayerRows', () => {
  test('⭐ 每一筆配到自己那一隊（兩個小孩分在不同隊）', () => {
    const rows = buildMyPlayerRows({
      members: [
        m('t-1', 'm-a', { name: '王小明', status: 'approved', kind: 'player', jerseyNo: 7 }),
        m('t-2', 'm-b', { name: '王小華', status: 'approved', kind: 'player', jerseyNo: 4 })
      ],
      teamsById: TEAMS
    });
    expect(rows.map(r => [r.name, r.teamName, r.divisionId])).toEqual([
      ['王小明', '大甲金剛', 'u10'],
      ['王小華', '龍井白鯊', 'u8']
    ]);
  });

  test('⭐ 查不到球隊文件仍然列出來（隊名退回 id），不可以整列消失', () => {
    const rows = buildMyPlayerRows({
      members: [m('t-gone', 'm-a', { name: '王小明', status: 'pending' })],
      teamsById: {}
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].teamName).toBe('t-gone');
  });

  test('⭐ 排序：等同意／在名單上的在前，婉拒／移除的在後', () => {
    const rows = buildMyPlayerRows({
      members: [
        m('t-1', 'm-r', { name: '甲', status: 'removed' }),
        m('t-1', 'm-a', { name: '乙', status: 'approved' }),
        m('t-1', 'm-x', { name: '丙', status: 'rejected' }),
        m('t-1', 'm-p', { name: '丁', status: 'pending' })
      ],
      teamsById: TEAMS
    });
    expect(rows.map(r => r.status)).toEqual(['pending', 'approved', 'rejected', 'removed']);
  });

  test('同一個狀態依隊名、再依背號', () => {
    const rows = buildMyPlayerRows({
      members: [
        m('t-2', 'm-1', { name: '甲', status: 'approved', jerseyNo: 9 }),
        m('t-1', 'm-2', { name: '乙', status: 'approved', jerseyNo: 11 }),
        m('t-1', 'm-3', { name: '丙', status: 'approved', jerseyNo: 2 }),
        m('t-1', 'm-4', { name: '丁', status: 'approved', jerseyNo: null })
      ],
      teamsById: TEAMS
    });
    // 大甲金剛（#2、#11、沒背號）→ 龍井白鯊（#9）
    expect(rows.map(r => `${r.teamName}:${r.name}`)).toEqual([
      '大甲金剛:丙', '大甲金剛:乙', '大甲金剛:丁', '龍井白鯊:甲'
    ]);
  });

  test('狀態文字給家長看；沒見過的狀態照原樣印，不會變成 undefined', () => {
    const rows = buildMyPlayerRows({
      members: [
        m('t-1', 'm-a', { name: '甲', status: 'pending' }),
        m('t-1', 'm-b', { name: '乙', status: 'weird' })
      ],
      teamsById: TEAMS
    });
    expect(rows[0].statusLabel).toBe(MEMBER_STATUS.pending);
    expect(rows[1].statusLabel).toBe('weird');
  });

  test('不會丟例外：members 不是陣列、文件缺欄位', () => {
    expect(buildMyPlayerRows({ members: null })).toEqual([]);
    const rows = buildMyPlayerRows({ members: [{ id: 'x', data: {} }] });
    expect(rows[0]).toMatchObject({ name: '（沒有名字）', status: 'pending', jerseyNo: null, teamId: null });
  });
});

describe('T53-3 countActive', () => {
  test('⭐ 標題的人數只算等同意與在名單上的', () => {
    const rows = buildMyPlayerRows({
      members: [
        m('t-1', 'a', { name: 'a', status: 'pending' }),
        m('t-1', 'b', { name: 'b', status: 'approved' }),
        m('t-1', 'c', { name: 'c', status: 'rejected' }),
        m('t-1', 'd', { name: 'd', status: 'removed' })
      ],
      teamsById: TEAMS
    });
    expect(countActive(rows)).toBe(2);
    expect(countActive(null)).toBe(0);
  });
});
