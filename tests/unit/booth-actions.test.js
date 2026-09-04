/**
 * T47 攤位端的純邏輯
 * ------------------------------------------------------------------
 * 規格：docs/06 §4、§6.2、§6.3、§10
 *
 * 這裡守的是「攤位人員按下去之後會發生什麼」，尤其是四個現場情境：
 *   ・連按兩次送出（去重）
 *   ・超過次數上限（要提示但**不能硬擋**）
 *   ・離線送出之後想作廢（伺服器時間還不存在，不能畫倒數）
 *   ・十分鐘過了才想作廢（要說得出「找管理員」）
 */

import {
  inputModeOf, resolveScore, isDuplicate, buildAttempt, submitFeedback,
  quotaState, canVoid, msOf, myChallenges,
  SUBMIT_LOCK_MS, DEDUPE_MS, VOID_WINDOW_MS
} from '../../js/modules/booth/actions.js';

const CROSSBAR = {
  challengeId: 'g03-crossbar', name: '橫樑', scoreType: 'count', unit: '次',
  rankingRule: 'higher', decimals: 0, minValue: 0, maxValue: 5,
  inputMode: 'stepper', stepperMax: 5,
  attemptPolicy: { maxAttemptsPerPlayer: 3, rankBy: 'best' }
};
const NINE = {
  challengeId: 'g01-nine-grid', name: '九宮格', scoreType: 'points', unit: '分',
  rankingRule: 'higher', decimals: 0, minValue: 0, maxValue: 15,
  inputMode: 'shots', shotCount: 5, shotOptions: [0, 1, 2, 3],
  attemptPolicy: { maxAttemptsPerPlayer: 3, rankBy: 'best' }
};
const HEADER = {
  challengeId: 'g02-header-king', name: '頭球', scoreType: 'height', unit: 'cm',
  rankingRule: 'higher', decimals: 0, minValue: 150, maxValue: 260,
  inputMode: 'ladder', ladderSteps: [180, 190, 200, 205],
  attemptPolicy: { maxAttemptsPerPlayer: 2, rankBy: 'best' }
};

const T = s => Date.parse(`2026-10-11T${s}:00+08:00`);
const att = (id, rawValue, at, over = {}) => ({
  attemptId: id, playerId: 'FEDA-0001', challengeId: CROSSBAR.challengeId,
  rawValue, createdAt: T(at), voided: false, staffUid: 'u-booth', ...over
});

describe('T47-A 輸入介面', () => {
  test('依設定切換四種介面', () => {
    expect(inputModeOf(CROSSBAR)).toBe('stepper');
    expect(inputModeOf(NINE)).toBe('shots');
    expect(inputModeOf(HEADER)).toBe('ladder');
    expect(inputModeOf({ inputMode: 'numpad' })).toBe('numpad');
  });

  test('⭐ 設定漏了 inputMode 時退回 numpad，不是讓這一關打不開', () => {
    // 攤位在現場最不需要的就是「這一關開不了」。
    // 成績範圍仍然由 validateScore fail-closed 守著，不會因此收到亂值。
    expect(inputModeOf({})).toBe('numpad');
    expect(inputModeOf(null)).toBe('numpad');
    expect(inputModeOf({ inputMode: '不認得的模式' })).toBe('numpad');
  });
});

describe('T47-B 算出成績', () => {
  test('stepper：一個數字', () => {
    expect(resolveScore({ challenge: CROSSBAR, value: 3 })).toMatchObject({ ok: true, rawValue: 3, detail: null });
  });

  test('⭐ 0 分送得出去（一球都沒進是合法成績）', () => {
    expect(resolveScore({ challenge: CROSSBAR, value: 0 }).ok).toBe(true);
  });

  test('沒輸入就不能送', () => {
    expect(resolveScore({ challenge: CROSSBAR, value: null }).ok).toBe(false);
  });

  test('超出範圍擋下來，而且說得出範圍', () => {
    const r = resolveScore({ challenge: CROSSBAR, value: 9 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('0–5');
  });

  test('shots：五球加總，而且細項要留下來（事後分析哪一格最難）', () => {
    const r = resolveScore({ challenge: NINE, detail: [3, 0, 2, 1, 3] });
    expect(r).toMatchObject({ ok: true, rawValue: 9 });
    expect(r.detail).toEqual([3, 0, 2, 1, 3]);
  });

  test('shots：有一球還沒選就不能送', () => {
    expect(resolveScore({ challenge: NINE, detail: [3, 0, 2, 1, null] }).ok).toBe(false);
    expect(resolveScore({ challenge: NINE, detail: [3, 0] }).ok).toBe(false);
  });

  test('ladder：只收階梯上的高度', () => {
    expect(resolveScore({ challenge: HEADER, value: 200 }).ok).toBe(true);
    expect(resolveScore({ challenge: HEADER, value: 201 }).ok).toBe(false);
  });

  test('⭐ detail 是複製的，不是同一個陣列（畫面之後還會改它）', () => {
    const detail = [3, 0, 2, 1, 3];
    const r = resolveScore({ challenge: NINE, detail });
    detail[0] = 0;
    expect(r.detail[0]).toBe(3);
  });
});

describe('T47-C 連按兩次（docs/06 §10）', () => {
  const now = T('10:00');
  const recent = [{ playerId: 'FEDA-0001', challengeId: 'g03-crossbar', rawValue: 3, atMs: now - 2000 }];

  test('⭐ 同玩家同關同分數，五秒內視為重複', () => {
    expect(isDuplicate(recent, { playerId: 'FEDA-0001', challengeId: 'g03-crossbar', rawValue: 3 }, now)).toBe(true);
  });

  test('過了五秒就不算重複（真的想再挑戰一次）', () => {
    expect(isDuplicate(recent, { playerId: 'FEDA-0001', challengeId: 'g03-crossbar', rawValue: 3 }, now + DEDUPE_MS)).toBe(false);
  });

  test('換人、換關、換分數都不算重複', () => {
    const next = { playerId: 'FEDA-0001', challengeId: 'g03-crossbar', rawValue: 3 };
    expect(isDuplicate(recent, { ...next, playerId: 'FEDA-0002' }, now)).toBe(false);
    expect(isDuplicate(recent, { ...next, challengeId: 'g01-nine-grid' }, now)).toBe(false);
    expect(isDuplicate(recent, { ...next, rawValue: 4 }, now)).toBe(false);
  });

  test('沒有紀錄時不會炸', () => {
    expect(isDuplicate(null, { playerId: 'a', challengeId: 'b', rawValue: 1 }, now)).toBe(false);
  });

  test('鎖住按鈕與去重是兩個不同的秒數', () => {
    expect(SUBMIT_LOCK_MS).toBe(3000);
    expect(DEDUPE_MS).toBe(5000);
  });
});

describe('T47-D 送出的文件', () => {
  const base = { challenge: CROSSBAR, playerId: 'FEDA-0001', rawValue: 3, staffUid: 'u-booth', atMs: T('10:00') };

  test('欄位齊全，而且 isBest 一律是 false（由 Function 判定）', () => {
    const { doc } = buildAttempt(base);
    expect(doc).toMatchObject({
      challengeId: 'g03-crossbar', playerId: 'FEDA-0001',
      rawValue: 3, displayValue: '3次', isBest: false,
      source: 'free', staffUid: 'u-booth', voided: false, voidReason: null
    });
  });

  test('⭐ attemptId 是決定性的（離線佇列重送不會變成兩筆）', () => {
    const a = buildAttempt(base).attemptId;
    const b = buildAttempt(base).attemptId;
    expect(a).toBe(b);
    expect(a).toBe('FEDA-0001__g03-crossbar__' + T('10:00'));
  });

  test('不同時間送出的是不同 id', () => {
    expect(buildAttempt(base).attemptId)
      .not.toBe(buildAttempt({ ...base, atMs: T('10:01') }).attemptId);
  });

  test('⭐ 文件裡不可以有 createdAt（要由呼叫端填 serverTimestamp）', () => {
    // rules 的 10 分鐘作廢窗是拿 resource.data.createdAt 跟 request.time 比的，
    // 填本機時間的話那道窗就失效了（或永遠有效）
    expect(Object.prototype.hasOwnProperty.call(buildAttempt(base).doc, 'createdAt')).toBe(false);
  });

  test('缺必要參數一律丟錯，不送一份半成品出去', () => {
    expect(() => buildAttempt({ ...base, staffUid: null })).toThrow(/staffUid/);
    expect(() => buildAttempt({ ...base, playerId: null })).toThrow(/playerId/);
    expect(() => buildAttempt({ ...base, rawValue: null })).toThrow(/rawValue/);
    expect(() => buildAttempt({ ...base, challenge: null })).toThrow(/關卡/);
    expect(() => buildAttempt({ ...base, atMs: undefined })).toThrow(TypeError);
  });
});

describe('T47-E 送出後的回饋（docs/06 §4.3）', () => {
  test('第一次挑戰就是個人最佳', () => {
    const r = submitFeedback({ challenge: CROSSBAR, attempts: [], rawValue: 3, nickname: '阿哲' });
    expect(r.isPersonalBest).toBe(true);
    expect(r.headline).toBe('阿哲 3次');
    expect(r.best).toBe('最佳 3次');
  });

  test('⭐ 破紀錄時說個人最佳，沒破時說本次與最佳', () => {
    const prev = [att('a1', 4, '09:00')];
    const worse = submitFeedback({ challenge: CROSSBAR, attempts: prev, rawValue: 2, nickname: '阿哲' });
    expect(worse.isPersonalBest).toBe(false);
    expect(worse.sub).toContain('本次 2次');
    expect(worse.best).toBe('最佳 4次');

    const better = submitFeedback({ challenge: CROSSBAR, attempts: prev, rawValue: 5, nickname: '阿哲' });
    expect(better.isPersonalBest).toBe(true);
    expect(better.best).toBe('最佳 5次');
  });

  test('⭐ 平手不算破紀錄（同分要看誰先達成，那不是「更好」）', () => {
    const r = submitFeedback({ challenge: CROSSBAR, attempts: [att('a1', 3, '09:00')], rawValue: 3, nickname: '阿哲' });
    expect(r.isPersonalBest).toBe(false);
  });

  test('作廢過的不算舊紀錄', () => {
    const r = submitFeedback({
      challenge: CROSSBAR, attempts: [att('a1', 5, '09:00', { voided: true })],
      rawValue: 2, nickname: '阿哲'
    });
    expect(r.isPersonalBest).toBe(true);
  });
});

describe('T47-F 次數上限（docs/06 §6.2）', () => {
  const three = [att('a1', 1, '10:00'), att('a2', 2, '10:05'), att('a3', 3, '10:10')];

  test('沒滿的時候用一般來源', () => {
    const q = quotaState(three.slice(0, 1), CROSSBAR);
    expect(q).toMatchObject({ used: 1, nextAttemptNo: 2, exhausted: false, source: 'free' });
    expect(q.note).toBe('');
  });

  test('⭐ 滿了不是硬擋：改用 staff 來源送出，而且說得出這是加場', () => {
    // 「現場彈性比嚴格限制重要」是規格明文
    const q = quotaState(three, CROSSBAR);
    expect(q.exhausted).toBe(true);
    expect(q.source).toBe('staff');
    expect(q.nextAttemptNo).toBe(4);
    expect(q.note).toContain('加場');
    expect(q.note).toContain('稽核');
  });

  test('不限次數的關卡永遠是 free', () => {
    const free = { ...CROSSBAR, attemptPolicy: { maxAttemptsPerPlayer: null } };
    expect(quotaState(three, free)).toMatchObject({ exhausted: false, source: 'free' });
  });
});

describe('T47-G 作廢（docs/06 §6.3）', () => {
  const now = T('10:05');
  const mine = att('a1', 3, '10:00');

  test('自己送的、十分鐘內、還沒作廢 → 可以', () => {
    const r = canVoid(mine, { uid: 'u-booth', nowMs: now });
    expect(r.ok).toBe(true);
    expect(r.leftMs).toBe(VOID_WINDOW_MS - 5 * 60 * 1000);
  });

  test('⭐ 超過十分鐘就不行，而且要說得出去找誰', () => {
    const r = canVoid(mine, { uid: 'u-booth', nowMs: T('10:11') });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('管理員');
  });

  test('⭐ 別人送出的不行（跟 firestore.rules 同一條界線）', () => {
    const r = canVoid(mine, { uid: 'u-other', nowMs: now });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('自己');
  });

  test('已經作廢的不會再作廢一次', () => {
    expect(canVoid({ ...mine, voided: true }, { uid: 'u-booth', nowMs: now }).ok).toBe(false);
  });

  test('⭐ 還在待同步時不給作廢（伺服器認可的時間還不存在）', () => {
    // 硬畫一顆倒數中的作廢鈕，攤位會照著按然後被 rules 擋掉——那就是假成功。
    // 跟賽務端「離線不給撤回」同一條規矩。
    const r = canVoid({ ...mine, createdAt: null }, { uid: 'u-booth', nowMs: now });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('伺服器');
  });

  test('十分鐘這個數字跟 firestore.rules 一致', () => {
    expect(VOID_WINDOW_MS).toBe(10 * 60 * 1000);
  });

  test('⭐ msOf 吃得下 Timestamp／Date／數字／ISO 字串', () => {
    expect(msOf(1000)).toBe(1000);
    expect(msOf(new Date(2000))).toBe(2000);
    expect(msOf({ toMillis: () => 4000 })).toBe(4000);
    expect(msOf(null)).toBeNull();

    // ⭐ 字串那一路是重點：真的 Firestore 回 Timestamp 物件，漏掉也看不出來，
    //    但替身 SDK 與任何序列化過的資料都是字串——漏掉的話作廢鈕會永遠
    //    顯示「還在等伺服器確認」（第一版自己寫了一份 msOf，就是這樣壞的）
    expect(msOf('2026-10-11T02:00:00.000Z')).toBe(Date.parse('2026-10-11T02:00:00.000Z'));
    expect(msOf('不是時間')).toBeNull();

    // 已序列化的 Timestamp 只取到秒（js/lib/format.js 的 toMillis 就是這樣）。
    // 對 10 分鐘的作廢窗來說毫秒級精度無關緊要，這裡把行為釘住免得日後誤會
    expect(msOf({ seconds: 3, nanoseconds: 500e6 })).toBe(3000);
  });
});

describe('T47-H 我負責哪幾關', () => {
  const all = [CROSSBAR, NINE, HEADER];

  test('只看得到自己被指派的', () => {
    const mine = myChallenges(all, { challengeIds: ['g01-nine-grid'], isAdmin: false });
    expect(mine.map(c => c.challengeId)).toEqual(['g01-nine-grid']);
  });

  test('⭐ 管理員以上不受指派限制（跟 rules 的 assignedChallenge() 一致）', () => {
    // 不然主辦自己進不了任何攤位頁
    expect(myChallenges(all, { challengeIds: [], isAdmin: true })).toHaveLength(3);
  });

  test('沒有指派就是空的（畫面會顯示「還沒有被指派」）', () => {
    expect(myChallenges(all, { challengeIds: [], isAdmin: false })).toEqual([]);
    expect(myChallenges(all, {})).toEqual([]);
  });

  test('關卡清單壞掉也不會炸', () => {
    expect(myChallenges(null, { isAdmin: true })).toEqual([]);
    expect(myChallenges([null, { challengeId: 'x' }], { isAdmin: true })).toHaveLength(1);
  });
});
