/**
 * firestore.rules｜檢錄員與檢錄紀錄（R73–R82）
 * ------------------------------------------------------------------
 * 規格：競賽規章第十八條第 3 款、docs/01b §1.12、docs/07 §1.1
 *
 * 檢錄員（`checkin`）是 2026-09-03 新增的角色。現場檢錄多半交給志工，
 * 所以權限給最小的那一份：
 *   ・寫得了 checkins
 *   ・讀得到 members（生日與身分證後四碼只存在那裡，檢錄要拿證件核對）
 *   ・**記分、完賽、改判一律不行**
 *
 * 最容易寫壞的是最後一條：把檢錄併進 isScorer() 很省事，但那等於
 * 給每個志工改比分的權限。
 */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { makeEnv, seedBaseline, asAdminSdk, authed, guest, EVENT, MATCH, MATCH_B } from './helpers.js';

let env;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seedBaseline(env);
});

const MEMBER = 'm-101-07';
const ID = `${MATCH}__${MEMBER}`;

const matchRef = db => doc(db, 'events', EVENT, 'matches', MATCH);

const ref = (db, id = ID) => doc(db, 'events', EVENT, 'checkins', id);
const memberRef = db => doc(db, 'events', EVENT, 'teams', 't-101', 'members', MEMBER);

const rec = (over = {}) => ({
  checkinId: ID, matchId: MATCH, teamId: 't-101', memberId: MEMBER,
  memberName: '小豆子', jerseyNo: 7,
  result: 'pass', failReason: null, method: 'manual',
  scannedBy: 'u-checkin', note: '',
  ...over
});

async function seedRec(over = {}) {
  await asAdminSdk(env, db => setDoc(ref(db, over.checkinId || ID), rec(over)));
}

describe('R73–R77 誰寫得了檢錄', () => {
  test('R73 ⭐ 檢錄員寫得了檢錄', async () => {
    await assertSucceeds(setDoc(ref(authed(env, 'u-checkin')), rec()));
  });

  test('R74 賽務、裁判、Admin 也寫得了（他們本來就做得了檢錄）', async () => {
    for (const u of ['u-scorer', 'u-referee', 'u-admin']) {
      await assertSucceeds(setDoc(ref(authed(env, u), `${MATCH}__x-${u}`),
        rec({ checkinId: `${MATCH}__x-${u}`, memberId: `x-${u}`, scannedBy: u })));
    }
  });

  test('R75 ⭐ 一般登入者與訪客都寫不了', async () => {
    await assertFails(setDoc(ref(authed(env, 'u-random')), rec({ scannedBy: 'u-random' })));
    await assertFails(setDoc(ref(guest(env)), rec({ scannedBy: null })));
  });

  test('R76 ⭐ 停用的帳號寫不了（active:false）', async () => {
    await assertFails(setDoc(ref(authed(env, 'u-suspended')), rec({ scannedBy: 'u-suspended' })));
  });

  test('R77 ⭐ 只有挑戰攤位身分的人寫不了檢錄', async () => {
    // booth 跟 checkin 都是「單一用途」角色，不該互通
    await assertFails(setDoc(ref(authed(env, 'u-booth')), rec({ scannedBy: 'u-booth' })));
  });
});

describe('R78–R79 紀錄本身的完整性', () => {
  test('R78 ⭐ scannedBy 必須是自己（不能冒名記檢錄）', async () => {
    // 罰則是取消整隊資格，紀錄要查得到是誰放行的
    await assertFails(setDoc(ref(authed(env, 'u-checkin')), rec({ scannedBy: 'u-scorer' })));
  });

  test('R79 ⭐ 文件 id 必須是 matchId__memberId', async () => {
    // id 天然防重複（docs/01b §1.12）。放任自訂 id 就會出現同一場同一人
    // 兩筆結果不同的紀錄，事後查核時說不清哪一筆算數。
    await assertFails(setDoc(ref(authed(env, 'u-checkin'), 'random-id'), rec()));
    await assertFails(setDoc(ref(authed(env, 'u-checkin'), `${MATCH}__someone-else`), rec()));
  });
});

describe('R80–R81 修改與刪除', () => {
  test('R80 檢錄員可以改自己記的結果（勾錯要救得回來）', async () => {
    await seedRec();
    await assertSucceeds(updateDoc(ref(authed(env, 'u-checkin')), {
      result: 'fail', failReason: 'MANUAL_FLAG', scannedBy: 'u-checkin'
    }));
  });

  test('R80b ⭐ 但改不動 matchId 或 memberId（那等於偽造另一筆）', async () => {
    await seedRec();
    await assertFails(updateDoc(ref(authed(env, 'u-checkin')), { memberId: 'm-other', scannedBy: 'u-checkin' }));
    await assertFails(updateDoc(ref(authed(env, 'u-checkin')), { matchId: 'U10-G-A-02', scannedBy: 'u-checkin' }));
  });

  test('R80c 改的時候 scannedBy 也要換成自己（留痕是誰改的）', async () => {
    await seedRec();
    await assertFails(updateDoc(ref(authed(env, 'u-checkin')), { result: 'fail', scannedBy: 'u-scorer' }));
  });

  test('R81 ⭐ 檢錄紀錄一律不可刪除', async () => {
    // 取消勾選是把 result 設成 null，不是刪文件——
    // 「誰在幾點確認了誰出賽，後來又取消」整段都要留痕。
    await seedRec();
    for (const u of ['u-checkin', 'u-scorer', 'u-admin', 'u-super']) {
      await assertFails(deleteDoc(ref(authed(env, u))));
    }
  });
});

describe('R82 檢錄員讀得到 members，但只有 members', () => {
  test('R82 ⭐ 讀得到球員的生日與身分證後四碼（檢錄要拿證件核對）', async () => {
    // 公開的 roster 投影刻意沒有這兩個欄位（ROSTER_FIELDS 白名單），
    // 所以檢錄只能讀 members。
    await assertSucceeds(getDoc(memberRef(authed(env, 'u-checkin'))));
  });

  test('R82b ⭐ 一般登入者仍然讀不到 members', async () => {
    await assertFails(getDoc(memberRef(authed(env, 'u-random'))));
    await assertFails(getDoc(memberRef(guest(env))));
  });

  test('R82c ⭐ 檢錄員改不動比分（權限只到檢錄）', async () => {
    // 把檢錄併進 isScorer() 很省事，但那等於給每個志工改比分的權限。
    //
    // ⚠️ 這裡送的是一個**完全合法的賽務寫入**（同 R05b），連 updatedBy 都填了，
    //    唯一的差別是身分。少了 updatedBy 的話擋住它的是那條檢查，
    //    不是角色——把 checkin 併進 isScorer() 測試照樣全綠（變異 RU#19）。
    await assertSucceeds(updateDoc(matchRef(authed(env, 'u-scorer')), {
      score: { home: 1, away: 0 }, updatedBy: 'u-scorer'
    }));
    await assertFails(updateDoc(matchRef(authed(env, 'u-checkin')), {
      score: { home: 5, away: 0 }, updatedBy: 'u-checkin'
    }));
  });

  test('R82d ⭐ 檢錄員也不能把場次改成完賽', async () => {
    await assertFails(updateDoc(matchRef(authed(env, 'u-checkin')), {
      status: 'finished', lock: { locked: true, lockedBy: 'u-checkin' }, updatedBy: 'u-checkin'
    }));
  });
});

// ── 第三輪驗收（2026-09-07，檢錄員 C-5）：完成檢錄要寫回場次 ──────────────
// 在 (E) 分支出現之前，檢錄員根本沒有一條寫得到場次文件的路，
// 所以「完成檢錄」只能跳一則成功提示，什麼都沒寫。

describe('R82e–R82l 完成檢錄：檢錄員寫得到場次的 checkin 那一包，但只有那一包', () => {
  const flags = (over = {}) => ({
    homeConfirmed: true, awayConfirmed: false, confirmedAt: null,
    homeConfirmedBy: 'u-checkin', homeConfirmedAt: null, homePresent: 5, homeForcedReason: null,
    ...over
  });
  const scheduled = () => asAdminSdk(env, db => updateDoc(matchRef(db), { status: 'scheduled' }));

  test('R82e ⭐ 檢錄員完成一隊檢錄：旗標 ＋ 狀態進入檢錄中', async () => {
    await scheduled();
    await assertSucceeds(updateDoc(matchRef(authed(env, 'u-checkin')), {
      checkin: flags(), status: 'checkin', updatedBy: 'u-checkin'
    }));
  });

  test('R82e2 兩隊都完成 → 待開賽（checkin → ready）', async () => {
    await asAdminSdk(env, db => updateDoc(matchRef(db), { status: 'checkin', checkin: flags() }));
    await assertSucceeds(updateDoc(matchRef(authed(env, 'u-checkin')), {
      checkin: flags({ awayConfirmed: true }), status: 'ready', updatedBy: 'u-checkin'
    }));
  });

  test('R82e3 已開打的場次也寫得了旗標（遲到的隊伍），但狀態不能動', async () => {
    // baseline 是 live：只寫 checkin，狀態 from == to
    await assertSucceeds(updateDoc(matchRef(authed(env, 'u-checkin')), { checkin: flags(), updatedBy: 'u-checkin' }));
  });

  test('R82f ⭐ 同一筆寫入夾帶比分就整筆被擋（這條路只有 checkin 那一包）', async () => {
    await scheduled();
    await assertFails(updateDoc(matchRef(authed(env, 'u-checkin')), {
      checkin: flags(), status: 'checkin', score: { home: 3, away: 0 }, updatedBy: 'u-checkin'
    }));
  });

  test('R82g ⭐ 從這條路不能把狀態推到 live／finished（狀態機本身放行 scheduled → live，是這條分支擋的）', async () => {
    await scheduled();
    await assertFails(updateDoc(matchRef(authed(env, 'u-checkin')), { checkin: flags(), status: 'live', updatedBy: 'u-checkin' }));
    await assertFails(updateDoc(matchRef(authed(env, 'u-checkin')), { checkin: flags(), status: 'finished', updatedBy: 'u-checkin' }));
  });

  test('R82h ⭐ 不是自己場地的場次寫不了；管理員不受場地限制', async () => {
    const refB = db => doc(db, 'events', EVENT, 'matches', MATCH_B);
    await asAdminSdk(env, db => updateDoc(refB(db), { status: 'scheduled' }));
    await assertFails(updateDoc(refB(authed(env, 'u-checkin')), { checkin: flags(), status: 'checkin', updatedBy: 'u-checkin' }));
    await assertSucceeds(updateDoc(refB(authed(env, 'u-admin')), {
      checkin: flags({ homeConfirmedBy: 'u-admin' }), status: 'checkin', updatedBy: 'u-admin'
    }));
  });

  test('R82i 已鎖定的場次寫不了', async () => {
    await asAdminSdk(env, db => updateDoc(matchRef(db), {
      status: 'finished', lock: { locked: true, lockedAt: null, lockedBy: 'u-scorer' }
    }));
    await assertFails(updateDoc(matchRef(authed(env, 'u-checkin')), { checkin: flags(), updatedBy: 'u-checkin' }));
  });

  test('R82j updatedBy 必須是自己（留痕是誰放行的）', async () => {
    await scheduled();
    await assertFails(updateDoc(matchRef(authed(env, 'u-checkin')), { checkin: flags(), status: 'checkin', updatedBy: 'u-scorer' }));
  });

  test('R82k 裁判也走得了這條路（裁判含檢錄員的職能）', async () => {
    await scheduled();
    await assertSucceeds(updateDoc(matchRef(authed(env, 'u-referee')), {
      checkin: flags({ homeConfirmedBy: 'u-referee' }), status: 'checkin', updatedBy: 'u-referee'
    }));
  });

  test('R82l 攤位人員與一般登入者寫不了', async () => {
    await scheduled();
    await assertFails(updateDoc(matchRef(authed(env, 'u-booth')), { checkin: flags(), status: 'checkin', updatedBy: 'u-booth' }));
    await assertFails(updateDoc(matchRef(authed(env, 'u-random')), { checkin: flags(), status: 'checkin', updatedBy: 'u-random' }));
  });
});
