/**
 * FC01–FC13｜挑戰系統結果管線（Firestore Emulator）
 * ------------------------------------------------------------------
 * 執行：npm run test:fn
 *
 * 引擎本身已經有 52 個純函式測試證明「算得對」（T46）。這一組要證的是
 * **接線接對了**：設定真的從 Firestore 讀、排行榜真的寫回去、
 * 作廢真的會退回次佳、抽獎張數不會因為觸發器重放而多發。
 *
 * ⚠️ 最後一件事特別重要：**抽獎券發出去就收不回來**。
 *    所以張數一律「依現在完成了哪幾關算出來」，不是 `+1`。
 *    FC08 專門測重放。
 */
import { db as adminDb } from '../../functions/admin.js';
import { onAttemptSubmitted, playerProgress, setPlayerContactFor } from '../../functions/pipeline.js';
import { createHash } from 'node:crypto';
import { rankInLadder } from '../../js/engine/challenge.js';

const E = 'feda-cup-2026';
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-fn-test';

let db;

/** 橫樑：0–5 次，越多越好 */
const CROSSBAR = {
  challengeId: 'g03-crossbar', order: 3, name: 'Ronaldinho 橫樑挑戰', shortName: '橫樑',
  scoreType: 'count', unit: '次', rankingRule: 'higher', decimals: 0,
  minValue: 0, maxValue: 5, inputMode: 'stepper',
  attemptPolicy: { maxAttemptsPerPlayer: 3, allowRepeat: true, rankBy: 'best' },
  status: 'open', stats: { players: 0, attempts: 0 }
};
/** 未來的盤球障礙賽：時間，越小越好（驗收 C09） */
const DRIBBLE = {
  challengeId: 'gx-dribble', order: 9, name: '盤球障礙賽', shortName: '盤球',
  scoreType: 'time', unit: '秒', rankingRule: 'lower', decimals: 1,
  minValue: 5, maxValue: 120, attemptPolicy: { rankBy: 'best' },
  status: 'open'
};
/** 湊滿五關用的空殼（只有 drawEntries 的「全破」判定會讀到關卡總數） */
const FILLER = ['g01-nine-grid', 'g02-header-king', 'g04-speed-king', 'g05-first-touch']
  .map((id, i) => ({
    challengeId: id, order: i + 1, name: id, shortName: id,
    scoreType: 'points', unit: '分', rankingRule: 'higher', decimals: 0,
    minValue: 0, maxValue: 15, attemptPolicy: { rankBy: 'best' }, status: 'open'
  }));

const REWARDS = { rule: 'perChallengeCompleted', entriesPerCompletion: 1, bonusAllComplete: 2, maxEntriesPerPlayer: 10 };

const T = s => new Date(`2026-10-11T${s}:00+08:00`);

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error('這組測試必須在 Firestore Emulator 底下跑（npm run test:fn）');
  const res = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' });
  if (!res.ok) throw new Error(`清空 Emulator 失敗：${res.status}`);
}

async function seed({ rewards = REWARDS, challenges = [CROSSBAR, ...FILLER] } = {}) {
  const b = db.batch();
  b.set(db.doc(`events/${E}`), { eventId: E, name: 'FEDA CUP 2026' });
  if (rewards) b.set(db.doc('config/challengeRewards'), rewards);
  for (const c of challenges) b.set(db.doc(`events/${E}/challenges/${c.challengeId}`), c);
  for (const p of ['FEDA-0001', 'FEDA-0002', 'FEDA-0003']) {
    b.set(db.doc(`events/${E}/players/${p}`), {
      playerId: p, eventId: E, nickname: `玩家${p.slice(-1)}`, ageBand: 'adult',
      completedChallengeIds: [], luckyDrawEntries: 0, createdVia: 'self-qr'
    });
  }
  await b.commit();
}

/** 攤位送出一筆成績（模擬 booth 端寫入），再跑一次 trigger 會做的事 */
async function submit(attemptId, { challengeId = CROSSBAR.challengeId, playerId = 'FEDA-0001',
  rawValue, at = '10:00', voided = false } = {}) {
  await db.doc(`events/${E}/attempts/${attemptId}`).set({
    attemptId, eventId: E, challengeId, playerId,
    rawValue, isBest: false, source: 'free', staffUid: 'u-booth',
    voided, voidReason: null, attemptAt: T(at), createdAt: T(at)
  });
  return onAttemptSubmitted({ eventId: E, challengeId, playerId });
}

const attempt = id => db.doc(`events/${E}/attempts/${id}`).get().then(s => s.data());
const player = id => db.doc(`events/${E}/players/${id}`).get().then(s => s.data());
const board = id => db.doc(`events/${E}/leaderboards/${id}`).get().then(s => s.data());
const challenge = id => db.doc(`events/${E}/challenges/${id}`).get().then(s => s.data());

beforeAll(() => {
  // ⚠️ 不可以自己 initializeApp()：專案裡有兩份 firebase-admin
  //    （見 pipeline.test.js 的說明）。一律經過 functions/admin.js。
  db = adminDb();
});

beforeEach(async () => { await clearFirestore(); await seed(); });

// ══════════════════════════════════════════════════════════════
describe('FC01–FC02 最佳成績與排行榜', () => {
  test('FC01 ⭐ 送出一筆成績：isBest、排行榜、關卡統計都真的寫回 Firestore', async () => {
    // 這是 M6-a 存在的理由：在此之前引擎算得再對也沒有東西呼叫它，
    // 攤位登錄完成績，排行榜是空的
    await submit('a1', { rawValue: 3 });

    expect((await attempt('a1')).isBest).toBe(true);

    const lb = await board(CROSSBAR.challengeId);
    expect(lb.rows).toHaveLength(1);
    expect(lb.rows[0]).toMatchObject({ rank: 1, playerId: 'FEDA-0001', value: 3, displayValue: '3次' });
    expect(lb.totalPlayers).toBe(1);
    expect(lb.topN).toBe(50);

    expect((await challenge(CROSSBAR.challengeId)).stats).toMatchObject({ attempts: 1, players: 1, voided: 0 });
  });

  test('FC02 ⭐ 同一玩家三次：三筆都保留，只有最佳那一筆標 isBest（驗收 C04）', async () => {
    await submit('a1', { rawValue: 2, at: '10:00' });
    await submit('a2', { rawValue: 4, at: '10:10' });
    await submit('a3', { rawValue: 3, at: '10:20' });

    expect((await attempt('a1')).isBest).toBe(false);
    expect((await attempt('a2')).isBest).toBe(true);
    expect((await attempt('a3')).isBest).toBe(false);

    const lb = await board(CROSSBAR.challengeId);
    expect(lb.rows).toHaveLength(1);            // 排行榜只取最佳，不是三列
    expect(lb.rows[0].value).toBe(4);
    expect(lb.rows[0].attempts).toBe(3);
  });
});

describe('FC03–FC05 抽獎資格', () => {
  test('FC03 ⭐ 首次完成一關 → 抽獎資格 +1（驗收 C05）', async () => {
    await submit('a1', { rawValue: 3 });
    const p = await player('FEDA-0001');
    expect(p.completedChallengeIds).toEqual([CROSSBAR.challengeId]);
    expect(p.luckyDrawEntries).toBe(1);
  });

  test('FC04 ⭐ 同一關再挑戰不會再多一張券', async () => {
    await submit('a1', { rawValue: 3 });
    await submit('a2', { rawValue: 5 });
    await submit('a3', { rawValue: 1 });
    const p = await player('FEDA-0001');
    expect(p.completedChallengeIds).toEqual([CROSSBAR.challengeId]);
    expect(p.luckyDrawEntries).toBe(1);
  });

  test('FC05 五關全破拿到加成', async () => {
    for (const c of [CROSSBAR, ...FILLER]) {
      await submit(`a-${c.challengeId}`, { challengeId: c.challengeId, rawValue: 3 });
    }
    const p = await player('FEDA-0001');
    expect(p.completedChallengeIds).toHaveLength(5);
    expect(p.luckyDrawEntries).toBe(7);          // 5 關 × 1 ＋ 全破 2
  });
});

describe('FC06–FC08 作廢與重放', () => {
  test('FC06 ⭐ 作廢最佳成績 → best 與排行榜自動退回次佳（驗收 C07）', async () => {
    await submit('a1', { rawValue: 2, at: '10:00' });
    await submit('a2', { rawValue: 5, at: '10:10' });
    expect((await board(CROSSBAR.challengeId)).rows[0].value).toBe(5);

    // 攤位在 10 分鐘內作廢（掃錯人／成績輸錯）
    await db.doc(`events/${E}/attempts/a2`).update({ voided: true, voidReason: '掃錯人' });
    await onAttemptSubmitted({ eventId: E, challengeId: CROSSBAR.challengeId, playerId: 'FEDA-0001' });

    expect((await attempt('a2')).isBest).toBe(false);
    expect((await attempt('a1')).isBest).toBe(true);
    const lb = await board(CROSSBAR.challengeId);
    expect(lb.rows[0].value).toBe(2);
    expect((await challenge(CROSSBAR.challengeId)).stats).toMatchObject({ attempts: 1, voided: 1 });
  });

  test('FC07 ⭐ 一關的成績全部被作廢 → 從完成清單移除，抽獎券跟著退回', async () => {
    // 只加不減的話，作廢之後玩家還留著那張券——而券發出去就收不回來
    await submit('a1', { rawValue: 3 });
    expect((await player('FEDA-0001')).luckyDrawEntries).toBe(1);

    await db.doc(`events/${E}/attempts/a1`).update({ voided: true, voidReason: '輸錯' });
    await onAttemptSubmitted({ eventId: E, challengeId: CROSSBAR.challengeId, playerId: 'FEDA-0001' });

    const p = await player('FEDA-0001');
    expect(p.completedChallengeIds).toEqual([]);
    expect(p.luckyDrawEntries).toBe(0);
  });

  test('FC08 ⭐ 重放同一筆不會多發券，也不會讓統計虛胖', async () => {
    // Firestore 的觸發器本來就可能重放；`luckyDrawEntries += 1` 在那時候
    // 會多發一張，而且看不出來
    await submit('a1', { rawValue: 3 });
    for (let i = 0; i < 3; i++) {
      await onAttemptSubmitted({ eventId: E, challengeId: CROSSBAR.challengeId, playerId: 'FEDA-0001' });
    }
    expect((await player('FEDA-0001')).luckyDrawEntries).toBe(1);
    expect((await challenge(CROSSBAR.challengeId)).stats.attempts).toBe(1);
    expect((await board(CROSSBAR.challengeId)).rows).toHaveLength(1);
  });
});

describe('FC09 排序方向', () => {
  test('FC09 ⭐ lower is better 的關卡整張榜要反過來排（驗收 C09）', async () => {
    await db.doc(`events/${E}/challenges/${DRIBBLE.challengeId}`).set(DRIBBLE);
    await submit('d1', { challengeId: DRIBBLE.challengeId, playerId: 'FEDA-0001', rawValue: 30.5 });
    await submit('d2', { challengeId: DRIBBLE.challengeId, playerId: 'FEDA-0002', rawValue: 12.2 });
    await submit('d3', { challengeId: DRIBBLE.challengeId, playerId: 'FEDA-0003', rawValue: 55.0 });

    const lb = await board(DRIBBLE.challengeId);
    expect(lb.rows.map(r => r.value)).toEqual([12.2, 30.5, 55]);
    expect(lb.rows[0].displayValue).toBe('12.2秒');
  });
});

describe('FC10–FC13 缺資料時的行為', () => {
  test('FC10 ⭐ 關卡設定讀不到就丟錯（算錯的排行榜跟算對的長得一樣）', async () => {
    await expect(onAttemptSubmitted({ eventId: E, challengeId: '不存在的關卡', playerId: 'FEDA-0001' }))
      .rejects.toThrow(/關卡/);
  });

  test('FC11 ⭐ 玩家不存在時不讓整條管線爆掉，但要留下稽核', async () => {
    // 成績本身已經寫進去了，排行榜也該照樣重建；查不到的是抽獎張數
    const r = await submit('a1', { rawValue: 3, playerId: 'FEDA-9999' });
    expect(r.completedChanged).toBe(false);
    expect((await board(CROSSBAR.challengeId)).rows).toHaveLength(1);

    const audits = await db.collection(`events/${E}/audits`).get();
    const hit = audits.docs.map(d => d.data()).find(a => a.action === 'challenge.playerMissing');
    expect(hit).toBeTruthy();
    expect(hit.entityId).toBe('FEDA-9999');
  });

  test('FC12 ⭐ totalPlayers 是截斷前的人數（自己不在前 50 時要算得出名次）', async () => {
    const b = db.batch();
    for (let i = 0; i < 60; i++) {
      const pid = `P-${String(i).padStart(3, '0')}`;
      b.set(db.doc(`events/${E}/players/${pid}`), {
        playerId: pid, nickname: `玩家${i}`, completedChallengeIds: [], luckyDrawEntries: 0
      });
      b.set(db.doc(`events/${E}/attempts/x${i}`), {
        attemptId: `x${i}`, eventId: E, challengeId: CROSSBAR.challengeId, playerId: pid,
        rawValue: i % 6, isBest: false, voided: false, attemptAt: T('10:00'), createdAt: T('10:00')
      });
    }
    await b.commit();
    await onAttemptSubmitted({ eventId: E, challengeId: CROSSBAR.challengeId, playerId: 'P-000' });

    const lb = await board(CROSSBAR.challengeId);
    expect(lb.rows).toHaveLength(50);
    expect(lb.totalPlayers).toBe(60);
  });

  test('FC13 ⭐ 讀不到抽獎設定就是 0 張，不猜一份預設（多發的券收不回來）', async () => {
    await clearFirestore();
    await seed({ rewards: null });
    await submit('a1', { rawValue: 3 });
    const p = await player('FEDA-0001');
    expect(p.completedChallengeIds).toEqual([CROSSBAR.challengeId]);   // 完成了
    expect(p.luckyDrawEntries).toBe(0);                                // 但沒有券
  });

  test('FC13b playerProgress 讀得出完整進度（抽獎名單匯出會用）', async () => {
    await submit('a1', { rawValue: 3 });
    const r = await playerProgress({ eventId: E, playerId: 'FEDA-0001' });
    expect(r.challengeTotal).toBe(5);
    expect(r.completedCount).toBe(1);
    expect(r.draw.entries).toBe(1);
    expect(r.player.nickname).toBe('玩家1');
    expect(await playerProgress({ eventId: E, playerId: '不存在' })).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
describe('FC14 ⭐ ladder：前 N 名之外的玩家也要算得出名次', () => {
  /**
   * 排行榜文件只存前 N 列（正式是 50）。第 N+1 名之後的玩家在客戶端
   * **沒有東西可以算名次**——而那一列正是他點進排行榜的理由（docs/06 §5.3）。
   * 所以管線要一併寫一份只有數字的 `ladder`。
   */
  test('FC14 ⭐ ladder 涵蓋全部玩家，而且不含任何 playerId', async () => {
    await submit('a1', { playerId: 'FEDA-0001', rawValue: 5, at: '10:00' });
    await submit('a2', { playerId: 'FEDA-0002', rawValue: 3, at: '10:01' });
    await submit('a3', { playerId: 'FEDA-0003', rawValue: 1, at: '10:02' });

    const b = await board(CROSSBAR.challengeId);
    expect(b.totalPlayers).toBe(3);
    expect(b.ladder.values).toEqual([5, 3, 1]);
    expect(b.ladder.times).toHaveLength(3);
    // ⚠️ 代號只有一萬組、掃得完，而知道代號就改得動那個人的暱稱。
    //    ladder 上放 ID 等於公布一份完整的代號名冊。
    expect(JSON.stringify(b.ladder)).not.toMatch(/FEDA-/);
  });

  test('FC14b ⭐ 用 ladder 算出來的名次跟榜上的一致', async () => {
    await submit('a1', { playerId: 'FEDA-0001', rawValue: 5, at: '10:00' });
    await submit('a2', { playerId: 'FEDA-0002', rawValue: 3, at: '10:01' });
    await submit('a3', { playerId: 'FEDA-0003', rawValue: 1, at: '10:02' });

    const b = await board(CROSSBAR.challengeId);
    for (const row of b.rows) {
      expect(rankInLadder(b.ladder, { value: row.value, attemptAt: row.attemptAt }, CROSSBAR))
        .toBe(row.rank);
    }
  });

  test('FC14c ⭐ 作廢之後 ladder 要跟著縮短（不然名次永遠算多一個人）', async () => {
    await submit('a1', { playerId: 'FEDA-0001', rawValue: 5, at: '10:00' });
    await submit('a2', { playerId: 'FEDA-0002', rawValue: 3, at: '10:01' });
    expect((await board(CROSSBAR.challengeId)).ladder.values).toEqual([5, 3]);

    await db.doc(`events/${E}/attempts/a1`).update({ voided: true, voidReason: '掃錯人' });
    await onAttemptSubmitted({ eventId: E, challengeId: CROSSBAR.challengeId, playerId: 'FEDA-0001' });

    const b = await board(CROSSBAR.challengeId);
    expect(b.ladder.values).toEqual([3]);
    expect(b.totalPlayers).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════
describe('FC15 ⭐ 中獎聯絡方式（docs/06 §7.2）：憑證對得上才寫，電話只進 playerContacts', () => {
  const KEY = 'k-1234567890abcdef1234567890abcdef';
  const HASH = createHash('sha256').update(KEY).digest('hex');
  const contact = id => db.doc(`events/${E}/playerContacts/${id}`).get().then(s => (s.exists ? s.data() : null));

  beforeEach(async () => {
    await db.doc(`events/${E}/players/FEDA-0001`).update({ contactKeyHash: HASH });
  });

  test('FC15 ⭐ 憑證正確：電話正規化後寫進 playerContacts，回遮罩；players 文件上沒有電話', async () => {
    const r = await setPlayerContactFor({ eventId: E, playerId: 'feda-0001', key: KEY, phone: '0912-345-678' });
    expect(r).toEqual({ playerId: 'FEDA-0001', maskedPhone: '0912***678' });
    expect(await contact('FEDA-0001')).toMatchObject({ playerId: 'FEDA-0001', phone: '0912345678', via: 'self' });
    const p = await player('FEDA-0001');
    expect(JSON.stringify(p)).not.toContain('0912345678');
  });

  test('FC15b ⭐ 憑證不對就不寫（知道代號不等於本人）', async () => {
    await expect(setPlayerContactFor({ eventId: E, playerId: 'FEDA-0001', key: 'k-wrongwrongwrongwrongwrong', phone: '0912345678' }))
      .rejects.toThrow('憑證不符');
    expect(await contact('FEDA-0001')).toBeNull();
  });

  test('FC15c ⭐ 攤位代建的卡沒有憑證：說清楚要到攤位登記', async () => {
    await expect(setPlayerContactFor({ eventId: E, playerId: 'FEDA-0002', key: KEY, phone: '0912345678' }))
      .rejects.toThrow('攤位');
    expect(await contact('FEDA-0002')).toBeNull();
  });

  test('FC15d 手機格式不對不寫（市話、少一碼）', async () => {
    await expect(setPlayerContactFor({ eventId: E, playerId: 'FEDA-0001', key: KEY, phone: '02-2345-6789' }))
      .rejects.toThrow('09 開頭');
    expect(await contact('FEDA-0001')).toBeNull();
  });

  test('FC15e 查無此代號', async () => {
    await expect(setPlayerContactFor({ eventId: E, playerId: 'FEDA-9999', key: KEY, phone: '0912345678' }))
      .rejects.toThrow('查無');
  });

  test('FC15f ⭐ 攤位工作人員替代建的卡登記：不用憑證，但記下是誰登記的', async () => {
    const r = await setPlayerContactFor({ eventId: E, playerId: 'FEDA-0002', phone: '0987654321', staffUid: 'u-booth' });
    expect(r.maskedPhone).toBe('0987***321');
    expect(await contact('FEDA-0002')).toMatchObject({ phone: '0987654321', via: 'booth', byUid: 'u-booth' });
  });
});
