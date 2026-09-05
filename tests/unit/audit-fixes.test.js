/**
 * T58 驗收整合修正（2026-09-06）
 * ------------------------------------------------------------------
 * 兩份外部驗收報告（《驗收計畫書整合版》D-01…D-15、《Codex 獨立唯讀驗收》C-01）
 * 指出的缺陷，逐條在現行程式碼上核實之後修掉。每一條在這裡留一個會紅的測試
 * （R-TEST-001），對應的變異在 scripts/mutation-check.cjs 的 #AF 系列。
 *
 * 純邏輯的部分直接呼叫函式；只在畫面層才看得到的（D-01／D-02／D-13／D-14）
 * 由 tests/e2e/audit-fixes.spec.js 守，這裡另外用「讀原始碼」的方式釘住
 * 修法本身——它比 E2E 快兩個數量級，而且 `test:mutation` 跑的只有 test:unit。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { matchResult, scoreOf } from '../../js/engine/result.js';
import {
  buildFinishPatch, lastPlayedPeriod, eventText, sortRosterForMatch, isPlayerRow
} from '../../js/modules/staff/live-actions.js';
import { buildReopenPatch, buildOverridePatch, resultOf } from '../../js/modules/admin/match-actions.js';
import { hadResult, canRegenerate } from '../../js/modules/admin/schedule-actions.js';
import { ROLE_INFO } from '../../js/config.js';

// ⚠️ Windows 上 `new URL(...).pathname` 是 /D:/…，丟給 fs 會變成 D:\D:\…（icons.test.js 踩過）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const per = (id, over = {}) => ({ type: 'period_start', periodId: id, seq: 1, voided: false, ...over });

describe('T58-A 勝負只有引擎一份（C-01）', () => {
  test('正規時間已分勝負時，PK 不改判、也不標成 PK 決勝', () => {
    const r = matchResult({ home: 3, away: 1 }, { home: 2, away: 4 });
    expect(r).toEqual({ winner: 'home', method: 'regulation', homePoints: 3, awayPoints: 0 });
  });

  test('正規平手才看 PK', () => {
    expect(matchResult({ home: 1, away: 1 }, { home: 4, away: 3 })).toMatchObject({ winner: 'home', method: 'penalty' });
    expect(matchResult({ home: 1, away: 1 }, { home: null, away: null })).toEqual({ winner: 'draw', method: 'regulation', homePoints: 1, awayPoints: 1 });
    expect(matchResult({ home: 1, away: 1 })).toMatchObject({ winner: 'draw' });
  });

  test('比分不合法一律 null（R-ENG-002：Number(null) 是 0 那條路不能走）', () => {
    expect(matchResult({ home: null, away: 1 })).toBeNull();
    expect(matchResult({ home: '2', away: 1 })).toBeNull();
    expect(matchResult({ home: 1.5, away: 1 })).toBeNull();
    expect(scoreOf(null)).toBeNull();
    expect(scoreOf(0)).toBe(0);
    expect(scoreOf('3')).toBeNull();
  });

  test('管理端的 resultOf 就是引擎的 matchResult', () => {
    expect(resultOf({ home: 3, away: 1 }, { home: 2, away: 4 })).toEqual(matchResult({ home: 3, away: 1 }, { home: 2, away: 4 }));
    expect(resultOf({ home: 0, away: 0 }, { home: 5, away: 4 })).toEqual(matchResult({ home: 0, away: 0 }, { home: 5, away: 4 }));
  });

  test('賽務端送出完賽也走同一份：3:1 加 PK 2:4 是 regulation、主隊勝', () => {
    const p = buildFinishPatch({ uid: 'u1', events: [], score: { home: 3, away: 1 }, penaltyScore: { home: 2, away: 4 } });
    expect(p.result).toEqual({ winner: 'home', method: 'regulation', homePoints: 3, awayPoints: 0 });
    expect(p.penaltyScore).toEqual({ home: 2, away: 4 });   // PK 的數字照樣留著（那是發生過的事）
  });
});

describe('T58-B 重開退回最後打過的那一期（D-06）', () => {
  test('沒有任何 period_start 就是第一期，不是「下半場」', () => {
    expect(lastPlayedPeriod([])).toBe('h1');
    expect(lastPlayedPeriod(undefined)).toBe('h1');
  });

  test('照 timeline 走：只打過 h1 → h1；打到 h2 → h2；被作廢的不算', () => {
    expect(lastPlayedPeriod([per('h1')])).toBe('h1');
    expect(lastPlayedPeriod([per('h1'), per('h2', { seq: 3 })])).toBe('h2');
    expect(lastPlayedPeriod([per('h1'), per('h2', { seq: 3, voided: true })])).toBe('h1');
  });

  test('buildReopenPatch 的 period 由事件流決定，lock 三個欄位寫齊', () => {
    const p = buildReopenPatch('u-admin', []);
    expect(p.period).toBe('h1');
    expect(p.status).toBe('live');
    expect(p.result).toBeNull();
    expect(p.walkoverSide).toBeNull();      // 重開之後「棄賽方」跟 result 一起失效（D-11）
    expect(p.lock).toEqual({ locked: false, lockedAt: null, lockedBy: null });
    expect(buildReopenPatch('u-admin', [per('h1'), per('h2', { seq: 3 })]).period).toBe('h2');
    expect(buildReopenPatch('u-admin').period).toBe('h1');     // 沒給事件流也不能猜成下半場
  });
});

describe('T58-C 期別文字看組別的 periods（D-07）', () => {
  test('單節的組別叫「比賽」，不是「上半場」', () => {
    expect(eventText({ type: 'period_start', periodId: 'h1' }, { periods: 1 })).toBe('比賽 開始');
    expect(eventText({ type: 'period_end', periodId: 'h1' }, { periods: 1 })).toBe('比賽 結束');
  });

  test('兩節的組別維持上下半場；沒給 periods 時退回兩節', () => {
    expect(eventText({ type: 'period_start', periodId: 'h1' }, { periods: 2 })).toBe('上半場 開始');
    expect(eventText({ type: 'period_start', periodId: 'h2' })).toBe('下半場 開始');
  });
});

describe('T58-D 名冊順序：球員在前、隊職員在後（D-08）', () => {
  const rows = [
    { memberId: 'c', displayName: '林教練', role: 'coach', jerseyNo: 1 },      // 教練也可能有背號
    { memberId: 'p9', displayName: '陳阿虎', role: 'player', jerseyNo: 9 },
    { memberId: 'pn', displayName: '沒背號', role: 'player', jerseyNo: null },
    { memberId: 'p4', displayName: '林大明', jerseyNo: 4 },                    // 沒有 role 的舊資料當球員
    { memberId: 'k', displayName: '王領隊', kind: 'captain', jerseyNo: null }
  ];

  test('球員依背號、沒背號的球員接在後面、隊職員最後', () => {
    expect(sortRosterForMatch(rows).map(r => r.memberId)).toEqual(['p4', 'p9', 'pn', 'c', 'k']);
  });

  test('不改動原陣列', () => {
    const copy = [...rows];
    sortRosterForMatch(rows);
    expect(rows).toEqual(copy);
  });

  test('isPlayerRow：沒有 role／kind 當球員；coach／captain 不是', () => {
    expect(isPlayerRow({})).toBe(true);
    expect(isPlayerRow({ role: 'player' })).toBe(true);
    expect(isPlayerRow({ role: 'coach' })).toBe(false);
    expect(isPlayerRow({ kind: 'captain' })).toBe(false);
  });
});

describe('T58-E 改判比分要清掉 walkoverSide（D-11）', () => {
  test('一般完賽改判：walkoverSide 明確寫成 null（不是留著舊值、也不是漏掉）', () => {
    const p = buildOverridePatch({ score: { home: 1, away: 1 }, match: { status: 'finished', walkoverSide: 'away', revisionCount: 0 }, uid: 'u' });
    expect(p.walkoverSide).toBeNull();
    expect(p.status).toBe('finished');
    expect(p.result.winner).toBe('draw');
  });

  test('原本就是棄賽的維持棄賽方', () => {
    const p = buildOverridePatch({ score: { home: 0, away: 2 }, match: { status: 'walkover', walkoverSide: 'home', revisionCount: 0 }, uid: 'u' });
    expect(p.status).toBe('walkover');
    expect(p.walkoverSide).toBe('home');
  });
});

describe('T58-F 取消／延期但已有結果的場次擋重產（D-10）', () => {
  const won = { winner: 'home', method: 'regulation', homePoints: 3, awayPoints: 0 };

  test('hadResult：狀態沒開打但 result 還在 → 打過', () => {
    expect(hadResult({ matchId: 'm1', status: 'cancelled', result: won })).toBe(true);
    expect(hadResult({ matchId: 'm1', status: 'postponed', lock: { locked: true } })).toBe(true);
    expect(hadResult({ matchId: 'm1', status: 'postponed', revisionCount: 1 })).toBe(true);
    expect(hadResult({ matchId: 'm1', status: 'live' })).toBe(true);
  });

  test('hadResult：真的沒打過的取消／延期 → 沒打過', () => {
    expect(hadResult({ matchId: 'm1', status: 'cancelled' })).toBe(false);
    expect(hadResult({ matchId: 'm1', status: 'postponed', result: null, lock: { locked: false } })).toBe(false);
    expect(hadResult(null)).toBe(false);
  });

  test('canRegenerate 依 hadResult，不只看狀態', () => {
    const g = canRegenerate([{ matchId: 'AO-G-A-01', status: 'cancelled', result: won }]);
    expect(g.ok).toBe(false);
    expect(g.started).toEqual(['AO-G-A-01']);
    expect(g.reason).toContain('AO-G-A-01');
    expect(canRegenerate([{ matchId: 'AO-G-A-01', status: 'cancelled' }]).ok).toBe(true);
  });
});

describe('T58-G 畫面層修法釘在原始碼上（E2E 另外守行為）', () => {
  test('D-01 檢錄台讀巢狀的 home.teamId，不再讀不存在的 homeTeamId', () => {
    // 只看程式碼，不看註解（註解裡會提到那個錯的欄位名）
    const src = read('js/modules/staff/checkin.js').replace(/\/\/.*$/gm, '');
    expect(src).toContain('state.match?.[side]?.teamId');
    expect(src).toContain('state.match?.home?.teamId');
    expect(src).not.toMatch(/homeTeamId|awayTeamId|TeamId`|TeamName`/);
  });

  test('D-02 登入頁先看 user() 再訂閱 onAuth（首次回呼是同步的，反過來會撞 TDZ）', () => {
    const src = read('js/modules/account/login.js');
    const guard = src.indexOf('if (user()) { navigate(next); return; }');
    const sub = src.indexOf('const off = onAuth(');
    expect(guard).toBeGreaterThan(-1);
    expect(sub).toBeGreaterThan(guard);
    expect(read('js/core/firebase.js')).toMatch(/export function onAuth\(fn\) \{[\s\S]*?try \{ fn\(currentUser, currentStaff\); \}/);
  });

  test('D-03 攤位「最近登錄」的查詢有對應的複合索引（正式站沒索引會 FAILED_PRECONDITION，模擬器不會）', () => {
    const q = read('js/modules/booth/data.js');
    expect(q).toContain("where('staffUid', '==', me), orderBy('createdAt', 'desc')");
    const idx = JSON.parse(read('firestore.indexes.json'));
    const hit = idx.indexes.find(i => i.collectionGroup === 'attempts' && i.queryScope === 'COLLECTION'
      && i.fields.length === 2
      && i.fields[0].fieldPath === 'staffUid' && i.fields[0].order === 'ASCENDING'
      && i.fields[1].fieldPath === 'createdAt' && i.fields[1].order === 'DESCENDING');
    expect(hit).toBeTruthy();
  });

  test('D-01b 檢錄名單的查詢（status ＋ jerseyNo）有對應的複合索引', () => {
    // D-01 修好之後名單查詢第一次真的執行，demo 實地驗證立刻回 failed-precondition：
    // 模擬器與替身都不查索引，只有正式資料庫會。
    const q = read('js/modules/staff/checkin-data.js');
    expect(q).toContain("where('status', '==', 'approved'),\n    orderBy('jerseyNo', 'asc')");
    const idx = JSON.parse(read('firestore.indexes.json'));
    const hit = idx.indexes.find(i => i.collectionGroup === 'members' && i.queryScope === 'COLLECTION'
      && i.fields.length === 2
      && i.fields[0].fieldPath === 'status' && i.fields[0].order === 'ASCENDING'
      && i.fields[1].fieldPath === 'jerseyNo' && i.fields[1].order === 'ASCENDING');
    expect(hit).toBeTruthy();
  });

  test('D-01b 檢錄台讀不到名單時說「讀不到」，不說「還沒有名單」', () => {
    const src = read('js/modules/staff/checkin.js');
    expect(src).toContain("id: 'chk-roster-error'");
    expect(src).toContain('state.rosterError[side] = rosterErrorText(err);');
  });

  test('D-03 攤位的 onSnapshot 不再吞掉錯誤', () => {
    const src = read('js/modules/booth/booth.js');
    expect(src).not.toMatch(/watch(MyRecent|Leaderboard)\([\s\S]{0,200}\(\) => \{\}\)/);
    expect(src).toContain('state.recentError');
  });

  test('D-04 現場代建也把輸入區歸零（0 分才送得出去）', () => {
    const src = read('js/modules/booth/booth.js');
    const fn = src.slice(src.indexOf('async function createOnSite'), src.indexOf('toast(\'已代建'));
    expect(fn).toContain('resetInput()');
    const lookup = src.slice(src.indexOf('async function lookup'), src.indexOf('async function createOnSite'));
    expect(lookup).toContain('resetInput()');
  });

  test('D-07 公開比賽頁：單節不顯示半場、期別文字走 periodLabel', () => {
    const src = read('js/modules/public/match.js');
    expect(src).toContain('(state.division?.periods ?? 2) > 1 && m.htScore');
    expect(src).not.toContain('PERIOD_LABEL[');
    expect(src).toContain('periodLabel(e.periodId, periods)');
  });

  test('D-09 抽籤鈕受 canRegenerate 守衛（畫面與 doDraw 各一次）', () => {
    const src = read('js/modules/admin/schedule.js');
    expect(src).toContain('disabled: !!state.busy || !canRegenerate(existing()).ok');
    expect(src).toMatch(/function doDraw\(\) \{\n\s+const drawGuard = canRegenerate\(existing\(\)\);/);
  });

  test('D-12 棄賽鈕反灰時把原因畫出來', () => {
    expect(read('js/modules/admin/match.js')).toContain("id: 'walkover-reason', text: woG.reason");
  });

  test('D-13 賽務首頁的檢錄／出場名單鈕走 can()（R-PERM-001）', () => {
    const src = read('js/modules/staff/home.js');
    const bar = src.slice(src.indexOf('function toolsBar'), src.indexOf('return () => { offSync()'));
    expect(bar).toContain("can('checkin.write')");
    expect(bar).toContain("can('matchsheet.write')");
  });

  test('D-14 找不到頁面時也換 document.title', () => {
    const src = read('js/core/router.js');
    const nf = src.slice(src.indexOf('if (!match) {'), src.indexOf('mount(view, notFound(path));'));
    expect(nf).toContain("document.title = '找不到頁面｜FEDA CUP 2026'");
  });

  test('D-15 主題切換與積分榜隊名的觸控目標不低於 --tap', () => {
    const comp = read('css/components.css');
    const opt = comp.slice(comp.indexOf('.theme-switch__opt{'), comp.indexOf('.theme-switch__opt.is-on'));
    expect(opt).toContain('min-height:var(--tap)');
    expect(opt).toContain('min-width:var(--tap)');
    const pub = read('css/modules/public.css');
    const team = pub.slice(pub.indexOf('button.ptable__team{'), pub.indexOf('.ptable__pts'));
    expect(team).toContain('min-height:var(--tap)');
  });

  test('⭐ 權限碼要由擁有那個功能的頁面自己讀（別的頁面順手讀一次不算）', () => {
    // T42-8 只問「有沒有人讀」。賽務首頁（D-13）也讀了 matchsheet.write 之後，
    // 出場名單頁改讀別的權限（變異 #C10）在 T42-8 底下就逃掉了。這裡釘住擁有者。
    const OWNER = {
      'matchsheet.write': ['js/modules/staff/sheet.js', ["can('matchsheet.write')"]],
      'checkin.write': ['js/modules/staff/checkin.js', ["can('checkin.write')", 'canCheckin(']],
      'member.read': ['js/modules/staff/checkin.js', ["can('member.read')"]],
      'match.finish': ['js/modules/staff/live.js', ["can('match.finish')"]],
      'match.score.write': ['js/modules/staff/live.js', ["can('match.score.write')", 'canScore(']],
      'match.period': ['js/modules/staff/live.js', ["can('match.period')"]],
      'match.confirm': ['js/modules/admin/match.js', ["'match.confirm'"]],
      'match.reopen': ['js/modules/admin/match.js', ["'match.reopen'"]],
      'match.score.override': ['js/modules/admin/match.js', ["can('match.score.override')"]],
      'schedule.manage': ['js/modules/admin/schedule.js', ["can('schedule.manage')"]],
      'challenge.attempt.write': ['js/modules/booth/booth.js', ["can('challenge.attempt.write')"]]
    };
    for (const [code, [file, needles]] of Object.entries(OWNER)) {
      const src = read(file);
      expect({ code, file, ok: needles.some(n => src.includes(n)) }).toEqual({ code, file, ok: true });
    }
  });

  test('CLAUDE.md 的角色表跟 ROLE_INFO 的 level 一致（Codex 抓到的文件漂移）', () => {
    const md = read('CLAUDE.md');
    const rows = [...md.matchAll(/^\| `([a-z_]+)` \| ([0-9.]+) \| /gm)];
    expect(rows.length).toBeGreaterThanOrEqual(9);
    for (const [, code, level] of rows) {
      expect(ROLE_INFO[code]).toBeDefined();
      expect(Number(level)).toBe(ROLE_INFO[code].level);
    }
    for (const code of ['booth', 'checkin', 'referee', 'scorer']) {
      expect(rows.some(r => r[1] === code)).toBe(true);
    }
  });
});
