/**
 * F01–F12｜結果管線整合測試（Firestore Emulator）
 * ------------------------------------------------------------------
 * 執行：npm run test:fn
 *
 * 引擎本身已經有 254 個純函式測試證明「算得對」。這一組要證的是另一件事：
 * **接線接對了**——設定真的從 Firestore 讀、積分榜真的寫回去、
 * 前置條件不成立時真的什麼都不寫、重放不會壞掉。
 *
 * 所以這裡刻意用真的 Emulator 而不是 mock：mock 的 Firestore 不會告訴你
 * 少一個索引、交易讀寫順序寫反、或 serverTimestamp 填在錯的層級。
 */
import { db as adminDb } from '../../functions/admin.js';

import { FORMATS, RANKING_RULES } from '../../js/engine/formats.js';
import {
  recalcStandingForMatch, recalcStandingsForStage, resolveDownstreamOf,
  resolveAdvancementForStage, computeFinalRankingFor, publishFinalRankingFor,
  rebuildBoardsFor, reconcileMatchScore
} from '../../functions/pipeline.js';

const E = 'feda-cup-2026';
const DIV = 'women';                       // F4_RR_FINAL：4 隊單循環 ＋ 冠軍賽／季軍賽
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-fn-test';

let db;

const TEAMS = [
  { teamId: 't1', name: '飛達女子一隊', shortName: '飛達一', abbr: 'FD1' },
  { teamId: 't2', name: '飛達女子二隊', shortName: '飛達二', abbr: 'FD2' },
  { teamId: 't3', name: '台中女足',     shortName: '台中',   abbr: 'TCH' },
  { teamId: 't4', name: '彰化女足',     shortName: '彰化',   abbr: 'CHW' }
];

/** 單循環 6 場。設計成沒有任何同分，名次才會唯一（同分會擋住晉級，那是另一條測試） */
const GROUP_MATCHES = [
  ['g1', 't1', 't2'], ['g2', 't1', 't3'], ['g3', 't1', 't4'],
  ['g4', 't2', 't3'], ['g5', 't2', 't4'], ['g6', 't3', 't4']
];

/** 打完之後：t1 = 9 分、t2 = 6、t3 = 3、t4 = 0 */
const RESULTS = {
  g1: [2, 0], g2: [3, 0], g3: [4, 0],
  g4: [2, 1], g5: [3, 0], g6: [1, 0]
};

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error('這組測試必須在 Firestore Emulator 底下跑（npm run test:fn）');
  const res = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' });
  if (!res.ok) throw new Error(`清空 Emulator 失敗：${res.status}`);
}

const matchRef = id => db.doc(`events/${E}/matches/${id}`);

function groupMatchDoc(matchId, home, away, i) {
  const meta = id => {
    const t = TEAMS.find(x => x.teamId === id);
    return { teamId: id, name: t.shortName, abbr: t.abbr, logoUrl: null };
  };
  return {
    matchId, eventId: E, divisionId: DIV, stageId: 'group', groupId: 'A',
    matchNo: i + 1, label: `第${i + 1}場`, matchKey: null,
    home: meta(home), away: meta(away), teamIds: [home, away],
    score: { home: 0, away: 0 }, status: 'scheduled', period: 'pre',
    kickoffAt: `2026-10-09T${String(9 + i).padStart(2, '0')}:00:00+08:00`,
    venueId: 'venue-a', date: '2026-10-09',
    lock: { locked: false, lockedAt: null, lockedBy: null },
    result: null, scoreMismatch: false
  };
}

function finalMatchDoc(matchKey, i) {
  return {
    matchId: matchKey, eventId: E, divisionId: DIV, stageId: 'final', groupId: null,
    matchNo: 100 + i, label: matchKey === 'F1' ? '冠軍賽' : '季軍賽', matchKey,
    home: { teamId: null, name: null, placeholder: 'A組第1名' },
    away: { teamId: null, name: null, placeholder: 'A組第2名' },
    teamIds: [],
    score: { home: 0, away: 0 }, status: 'scheduled', period: 'pre',
    kickoffAt: `2026-10-09T1${5 + i}:00:00+08:00`,
    venueId: 'venue-a', date: '2026-10-09',
    lock: { locked: false, lockedAt: null, lockedBy: null },
    result: null, scoreMismatch: false
  };
}

async function seed({ rankingRuleId = 'RR_FEDA_DEFAULT' } = {}) {
  const b = db.batch();
  b.set(db.doc('config/formats'), { formats: FORMATS });
  b.set(db.doc('config/rankingRules'), { rules: RANKING_RULES });
  b.set(db.doc(`events/${E}`), { eventId: E, name: 'FEDA CUP 2026' });

  b.set(db.doc(`events/${E}/divisions/${DIV}`), {
    divisionId: DIV, name: '女子組', shortName: '女子',
    formatId: 'F4_RR_FINAL', rankingRuleId,
    display: { mercyRule: { enabled: false, cap: 7 }, scorerBoard: true },
    status: 'scheduled', finalRankingPublished: false, finalRanking: null
  });
  for (const st of FORMATS.F4_RR_FINAL.stages) {
    b.set(db.doc(`events/${E}/divisions/${DIV}/stages/${st.stageId}`), {
      stageId: st.stageId, name: st.name, type: st.type, order: st.order
    });
  }
  b.set(db.doc(`events/${E}/divisions/${DIV}/stages/group/groups/A`), {
    groupId: 'A', name: 'A組', teamIds: TEAMS.map(t => t.teamId), order: 1
  });

  for (const t of TEAMS) {
    b.set(db.doc(`events/${E}/teams/${t.teamId}`), { ...t, divisionId: DIV, withdrawn: false });
  }
  // 公開名冊投影。displayName 是**已經遮蔽過**的那一份（R-PRIV-001），
  // 跟 members 裡的真名不同——看板只准用這一份。
  b.set(db.doc(`events/${E}/teams/t1/roster/p-1`), {
    memberId: 'p-1', teamId: 't1', divisionId: DIV, displayName: '林小＊', jerseyNo: 10
  });
  b.set(db.doc(`events/${E}/teams/t2/roster/p-9`), {
    memberId: 'p-9', teamId: 't2', divisionId: DIV, displayName: '陳大＊', jerseyNo: 4
  });
  GROUP_MATCHES.forEach(([id, h, a], i) => b.set(matchRef(id), groupMatchDoc(id, h, a, i)));
  ['F1', 'F3'].forEach((k, i) => b.set(matchRef(k), finalMatchDoc(k, i)));

  await b.commit();
}

/** 送出完賽（模擬賽務端寫入），然後跑一次 trigger 會做的事 */
async function play(matchId, home, away, { recalc = true } = {}) {
  const winner = home > away ? 'home' : home < away ? 'away' : 'draw';
  await matchRef(matchId).update({
    score: { home, away }, status: 'finished', period: 'ft',
    result: {
      winner, method: 'regulation',
      homePoints: winner === 'home' ? 3 : winner === 'draw' ? 1 : 0,
      awayPoints: winner === 'away' ? 3 : winner === 'draw' ? 1 : 0
    },
    lock: { locked: true, lockedAt: null, lockedBy: 'u-scorer' }
  });
  if (!recalc) return;
  const snap = await matchRef(matchId).get();
  return recalcStandingForMatch({ eventId: E, match: { matchId, ...snap.data() } });
}

async function playGroupStage(only = null) {
  for (const [id] of GROUP_MATCHES) {
    if (only && !only.includes(id)) continue;
    await play(id, ...RESULTS[id]);
  }
}

const standing = async (stageId = 'group', groupId = 'A') =>
  (await db.doc(`events/${E}/standings/${DIV}__${stageId}__${groupId}`).get()).data();

beforeAll(() => {
  // ⚠️ 測試**不可以**自己 initializeApp()。
  //    專案裡有兩份 firebase-admin（根目錄一份、functions/ 一份），
  //    自己初始化會初始化到根目錄那份的 AppStore，而 pipeline 解析到的是
  //    functions/ 那份 —— 於是只要有人在 functions/ 跑過 npm install，
  //    整組測試就會變成「default Firebase app does not exist」。
  //    一律經過 functions/admin.js，拿到的就一定跟正式路徑同一個 app。
  db = adminDb();
});
beforeEach(async () => { await clearFirestore(); await seed(); });

// ══════════════════════════════════════════════════════════════
describe('F01–F04 積分榜', () => {
  test('F01 ⭐ 完賽之後積分榜真的被寫回 Firestore', async () => {
    // 這是 M3.9 存在的理由：在此之前，引擎算得再對也沒有任何東西呼叫它，
    // 積分榜文件根本不會被產生出來。
    const ref = db.doc(`events/${E}/standings/${DIV}__group__A`);
    expect((await ref.get()).exists).toBe(false);

    await play('g1', 2, 0);

    const st = await standing();
    const t1 = st.rows.find(r => r.teamId === 't1');
    expect(t1.played).toBe(1);
    expect(t1.points).toBe(3);
    expect(t1.goalsFor).toBe(2);
    expect(st.computedBy).toBe('fn:recalcStanding');
    expect(st.computedAt).toBeTruthy();          // serverTimestamp 由這一層補
  });

  test('F02 ⭐ 打完整組之後名次正確（9/6/3/0）', async () => {
    await playGroupStage();
    const st = await standing();
    expect(st.rows.map(r => r.teamId)).toEqual(['t1', 't2', 't3', 't4']);
    expect(st.rows.map(r => r.points)).toEqual([9, 6, 3, 0]);
    expect(st.rows.map(r => r.rank)).toEqual([1, 2, 3, 4]);
    expect(st.hasUnresolvedTie).toBe(false);
  });

  test('F03 隊名從 teams 帶進積分榜，公開端不必再查一次', async () => {
    await play('g1', 2, 0);
    const row = (await standing()).rows.find(r => r.teamId === 't1');
    expect(row.name).toBe('飛達一');
    expect(row.abbr).toBe('FD1');
  });

  test('F04 ⭐ 重放同一場不會改變結果，只會遞增 version（冪等）', async () => {
    await playGroupStage();
    const before = await standing();

    const snap = await matchRef('g1').get();
    await recalcStandingForMatch({ eventId: E, match: { matchId: 'g1', ...snap.data() } });
    const after = await standing();

    const strip = st => st.rows.map(({ rank, teamId, points, goalDiff }) => ({ rank, teamId, points, goalDiff }));
    expect(strip(after)).toEqual(strip(before));
    expect(after.version).toBe(before.version + 1);
  });
});

describe('F05–F06 行為分與對帳', () => {
  test('F05 ⭐ 紅黃牌會經由 timeline 進到積分榜的行為分', async () => {
    await db.doc(`events/${E}/matches/g1/timeline/0001-card`).set({
      matchId: 'g1', type: 'card', cardType: 'yellow', side: 'home',
      teamId: 't1', playerId: 'p-1', seq: 1, clockSec: 600, voided: false
    });
    await play('g1', 2, 0);

    const t1 = (await standing()).rows.find(r => r.teamId === 't1');
    expect(t1.yellow).toBe(1);
    expect(t1.fairPlayPoints).toBe(-1);
  });

  test('F06 ⭐ 事件加總與登錄比分不符 → scoreMismatch 被標起來', async () => {
    await play('g1', 2, 0);                       // 比分 2:0，但一顆進球事件都沒有
    const r = await reconcileMatchScore({ eventId: E, matchId: 'g1' });
    expect(r.changed).toBe(true);
    expect(r.mismatch).toBe(true);
    expect((await matchRef('g1').get()).data().scoreMismatch).toBe(true);

    // 補上兩顆進球之後就一致了，而且旗標要自己收回去
    for (const seq of [1, 2]) {
      await db.doc(`events/${E}/matches/g1/timeline/000${seq}-goal`).set({
        matchId: 'g1', type: 'goal', side: 'home', teamId: 't1',
        playerId: `p-${seq}`, playerName: `球員${seq}`, seq, clockSec: 300 * seq, voided: false
      });
    }
    const r2 = await reconcileMatchScore({ eventId: E, matchId: 'g1' });
    expect(r2.mismatch).toBe(false);
    expect((await matchRef('g1').get()).data().scoreMismatch).toBe(false);

    // 結論沒變就不該再寫一次：無條件寫入會把 onMatchWritten 叫起來，
    // 兩個 trigger 互相打，而且每一顆進球都白花一次寫入。
    const r3 = await reconcileMatchScore({ eventId: E, matchId: 'g1' });
    expect(r3.changed).toBe(false);
  });
});

describe('F07–F09 晉級解算', () => {
  test('F07 ⭐ 分組賽沒打完就不解算，而且一個欄位都不准寫', async () => {
    await playGroupStage(['g1', 'g2', 'g3', 'g4', 'g5']);   // 差 g6

    const out = await resolveDownstreamOf({ eventId: E, divisionId: DIV, stageId: 'group' });
    expect(out).toHaveLength(1);
    expect(out[0].ready).toBe(false);
    expect(out[0].reason).toMatch(/尚有 1 場未完賽/);
    expect(out[0].applied).toEqual([]);

    // fail-closed 的重點不是「回報失敗」，是「沒有留下半個字」
    const f1 = (await matchRef('F1').get()).data();
    expect(f1.home.teamId).toBeNull();
    expect(f1.status).toBe('scheduled');
  });

  test('F08 ⭐ 打完之後冠軍賽與季軍賽自動填上正確的隊伍', async () => {
    await playGroupStage();
    const out = await resolveDownstreamOf({ eventId: E, divisionId: DIV, stageId: 'group' });
    expect(out[0].ready).toBe(true);
    expect(out[0].applied).toHaveLength(2);

    const f1 = (await matchRef('F1').get()).data();
    expect([f1.home.teamId, f1.away.teamId]).toEqual(['t1', 't2']);   // 第1 vs 第2
    expect(f1.status).toBe('ready');
    expect(f1.home.name).toBe('飛達一');

    const f3 = (await matchRef('F3').get()).data();
    expect([f3.home.teamId, f3.away.teamId]).toEqual(['t3', 't4']);   // 第3 vs 第4
  });

  test('F09 ⭐ 解算是冪等的：再跑一次不會失敗也不會重寫', async () => {
    await playGroupStage();
    await resolveDownstreamOf({ eventId: E, divisionId: DIV, stageId: 'group' });
    const again = await resolveDownstreamOf({ eventId: E, divisionId: DIV, stageId: 'group' });

    expect(again[0].ready).toBe(true);
    expect(again[0].applied).toEqual([]);      // 全部 noop
    expect(again[0].blocked).toEqual([]);      // 「已經填好了」不該被當成失敗
  });

  test('F09b 已經開打的下游場次不會被覆寫（要先請 Admin 清比分）', async () => {
    await playGroupStage();
    await resolveDownstreamOf({ eventId: E, divisionId: DIV, stageId: 'group' });

    // 冠軍賽已經有比分了，此時把分組賽改判
    await matchRef('F1').update({ score: { home: 1, away: 0 }, status: 'live' });
    await play('g1', 0, 5);                    // t2 逆轉，第一名換人

    const r = await resolveAdvancementForStage({ eventId: E, divisionId: DIV, stageId: 'final' });
    expect(r.applied).toEqual([]);
    expect(r.blocked.some(b => b.matchId === 'F1' && /已進行/.test(b.reason))).toBe(true);
    expect((await matchRef('F1').get()).data().score).toEqual({ home: 1, away: 0 });
  });
});

describe('F10–F11 最終排名', () => {
  async function playThrough() {
    await playGroupStage();
    await resolveDownstreamOf({ eventId: E, divisionId: DIV, stageId: 'group' });
    await play('F1', 1, 0, { recalc: false });   // t1 勝 t2
    await play('F3', 2, 1, { recalc: false });   // t3 勝 t4
  }

  test('F10 ⭐ 依 finalRankingMap 解出 1–4 名', async () => {
    await playThrough();
    const r = await computeFinalRankingFor({ eventId: E, divisionId: DIV });
    expect(r.complete).toBe(true);
    expect(r.ranking.map(x => [x.rank, x.teamId])).toEqual([[1, 't1'], [2, 't2'], [3, 't3'], [4, 't4']]);
  });

  test('F11 ⭐ 還沒打完就不准發布（公開端寧可少一個名次，也不能掛錯的）', async () => {
    await playGroupStage();
    await resolveDownstreamOf({ eventId: E, divisionId: DIV, stageId: 'group' });
    await play('F1', 1, 0, { recalc: false });   // 季軍賽還沒打

    const r = await publishFinalRankingFor({ eventId: E, divisionId: DIV });
    expect(r.published).toBe(false);
    expect(r.missing.length).toBeGreaterThan(0);
    expect((await db.doc(`events/${E}/divisions/${DIV}`).get()).data().finalRankingPublished).toBe(false);
  });

  test('F11b 打完之後發布成功，並留下稽核', async () => {
    await playThrough();
    const r = await publishFinalRankingFor({ eventId: E, divisionId: DIV, actorUid: 'u-admin' });
    expect(r.published).toBe(true);

    const div = (await db.doc(`events/${E}/divisions/${DIV}`).get()).data();
    expect(div.finalRankingPublished).toBe(true);
    expect(div.finalRanking.map(x => x.teamId)).toEqual(['t1', 't2', 't3', 't4']);

    const audits = await db.collection(`events/${E}/audits`)
      .where('action', '==', 'finalRanking.publish').get();
    expect(audits.size).toBe(1);
  });
});

describe('F12 設定驅動與 fail-closed', () => {
  test('F12 ⭐ rankingRuleId 打錯就丟錯，不可以偷偷套預設規則', async () => {
    await clearFirestore();
    await seed({ rankingRuleId: 'RR_DOES_NOT_EXIST' });
    await expect(play('g1', 2, 0)).rejects.toThrow(/RR_DOES_NOT_EXIST/);
  });

  test('F12b ⭐ 小組設定讀不到就丟錯，不可以拿場次裡出現過的隊伍硬湊名單', async () => {
    await db.doc(`events/${E}/divisions/${DIV}/stages/group/groups/A`).delete();
    await expect(play('g1', 2, 0)).rejects.toThrow(/找不到小組設定/);
  });

  test('F12c 積分規則真的是從 Firestore 讀的：改成 2 分制就會照著算', async () => {
    // 設定檔驅動不是口號。把 config 裡的勝場分數改掉，算出來就要跟著變。
    const twoPoints = {
      ...RANKING_RULES,
      RR_FEDA_DEFAULT: { ...RANKING_RULES.RR_FEDA_DEFAULT, points: { win: 2, draw: 1, loss: 0 } }
    };
    await db.doc('config/rankingRules').set({ rules: twoPoints });

    await playGroupStage();
    expect((await standing()).rows.map(r => r.points)).toEqual([6, 4, 2, 0]);
  });

  test('F12d recalcStandingsForStage 會把該階段所有小組都算過一遍', async () => {
    await playGroupStage();
    const out = await recalcStandingsForStage({ eventId: E, divisionId: DIV, stageId: 'group' });
    expect(out).toHaveLength(1);
    expect(out[0].standingId).toBe(`${DIV}__group__A`);
  });
});

describe('F13 看板', () => {
  test('F13 射手榜只採已完賽的場次，而且不算烏龍球', async () => {
    await db.doc(`events/${E}/matches/g1/timeline/0001-goal`).set({
      matchId: 'g1', type: 'goal', side: 'home', teamId: 't1',
      playerId: 'p-1', playerName: '林小美', jerseyNo: 10, seq: 1, clockSec: 300, voided: false
    });
    await db.doc(`events/${E}/matches/g1/timeline/0002-own`).set({
      matchId: 'g1', type: 'own_goal', goalType: 'own', side: 'away', teamId: 't2',
      playerId: 'p-9', playerName: '誤射', jerseyNo: 4, seq: 2, clockSec: 600, voided: false
    });
    // 還沒完賽的場次上的進球不該進榜
    await db.doc(`events/${E}/matches/g2/timeline/0001-goal`).set({
      matchId: 'g2', type: 'goal', side: 'home', teamId: 't1',
      playerId: 'p-1', playerName: '林小美', jerseyNo: 10, seq: 1, clockSec: 300, voided: false
    });

    await play('g1', 2, 0);
    await rebuildBoardsFor({ eventId: E, divisionId: DIV });

    // 規格是**單一文件** boards/scorers（docs/01b §1.13），不是每組一份：
    // 首頁只監聽一份文件是明確要求。
    const board = (await db.doc(`events/${E}/boards/scorers`).get()).data();
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].playerId).toBe('p-1');
    expect(board.rows[0].goals).toBe(1);
    expect(board.rows[0].teamName).toBe('飛達一');
    expect(board.rows[0].divisionId).toBe(DIV);      // 公開端靠這個欄位篩組別
  });

  test('F14 ⭐ 看板上的球員姓名一律取自已遮蔽的公開名冊，不可以用事件上的真名', async () => {
    // boards/* 是 allow read: if true。timeline 事件上的 playerName 是賽務端
    // 記的真名，未滿 13 歲的球員在名冊上才是遮蔽過的（王小＊）。
    // 把事件上的名字寫上去，就是把兒童真名公開掛出來（R-PRIV-001）。
    await db.doc(`events/${E}/matches/g1/timeline/0001-goal`).set({
      matchId: 'g1', type: 'goal', side: 'home', teamId: 't1',
      playerId: 'p-1', playerName: '林小美', jerseyNo: 10,   // ← 真名
      seq: 1, clockSec: 300, voided: false
    });
    await play('g1', 1, 0);
    await rebuildBoardsFor({ eventId: E, divisionId: DIV });

    const row = (await db.doc(`events/${E}/boards/scorers`).get()).data().rows[0];
    expect(row.name).toBe('林小＊');
    expect(row.name).not.toBe('林小美');
  });

  test('F14b 名冊上查不到的球員留 null，不要退回事件上的真名', async () => {
    await db.doc(`events/${E}/matches/g1/timeline/0001-goal`).set({
      matchId: 'g1', type: 'goal', side: 'home', teamId: 't1',
      playerId: 'p-unknown', playerName: '沒在名冊上的人', jerseyNo: 77,
      seq: 1, clockSec: 300, voided: false
    });
    await play('g1', 1, 0);
    await rebuildBoardsFor({ eventId: E, divisionId: DIV });

    const row = (await db.doc(`events/${E}/boards/scorers`).get()).data().rows[0];
    expect(row.name).toBeNull();
    expect(JSON.stringify(row)).not.toContain('沒在名冊上的人');
  });

  test('F14c 重建某一組別時，其他組別的列不會被清掉', async () => {
    // 單一文件的代價：六個組別共用一份 rows。這裡守的是「換自己那幾列」。
    await db.doc(`events/${E}/boards/scorers`).set({
      boardId: 'scorers',
      rows: [{ rank: 1, playerId: 'x-1', divisionId: 'adult-open', goals: 9 }]
    });
    await play('g1', 2, 0);
    await rebuildBoardsFor({ eventId: E, divisionId: DIV });

    const rows = (await db.doc(`events/${E}/boards/scorers`).get()).data().rows;
    expect(rows.some(r => r.divisionId === 'adult-open' && r.playerId === 'x-1')).toBe(true);
  });
});
