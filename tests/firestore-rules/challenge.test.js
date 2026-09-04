/**
 * firestore.rules｜Challenge 挑戰系統
 * 對應 docs/07 §2.4 的 R13–R17、R19
 */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { makeEnv, seedBaseline, authed, guest, EVENT, CHALLENGE } from './helpers.js';

let env;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedBaseline(env); });

const attempt = (over = {}) => ({
  attemptId: 'a-new', eventId: EVENT, challengeId: CHALLENGE, playerId: 'FEDA-0182',
  playerNickname: '阿哲', attemptNo: 1, rawValue: 3, displayValue: '3 次',
  isBest: true, source: 'free', staffUid: 'u-booth', boothDeviceId: 'booth-03',
  voided: false, voidReason: null, createdAt: serverTimestamp(), ...over
});

const gamePass = (over = {}) => ({
  playerId: 'FEDA-0182', eventId: EVENT, nickname: '阿哲', avatarSeed: 'a7f3',
  ageBand: 'adult', qrCode: 'FEDAP.FEDA-0182.1760227200.3c9a1f7b',
  createdAt: serverTimestamp(), createdVia: 'self-qr',
  completedChallengeIds: [], luckyDrawEntries: 0, linkedTeamId: null,
  lastActiveAt: serverTimestamp(), ...over
});

describe('Challenge 成績', () => {
  test('R13 攤位不可寫非指派關卡的成績', async () => {
    // u-booth-x 只被指派 g01-nine-grid
    await assertFails(setDoc(
      doc(authed(env, 'u-booth-x'), 'events', EVENT, 'attempts', 'a-new'),
      attempt({ staffUid: 'u-booth-x' })
    ));
  });

  test('R13b 攤位可寫自己指派關卡的成績', async () => {
    await assertSucceeds(setDoc(
      doc(authed(env, 'u-booth'), 'events', EVENT, 'attempts', 'a-new'), attempt()
    ));
  });

  test('R14 成績超出關卡 min/max 範圍時拒絕', async () => {
    await assertFails(setDoc(
      doc(authed(env, 'u-booth'), 'events', EVENT, 'attempts', 'a-new'),
      attempt({ rawValue: 9 })          // 橫樑挑戰 maxValue = 5
    ));
    await assertFails(setDoc(
      doc(authed(env, 'u-booth'), 'events', EVENT, 'attempts', 'a-neg'),
      attempt({ rawValue: -1 })
    ));
  });

  test('R14b staffUid 必須等於自己的 uid', async () => {
    await assertFails(setDoc(
      doc(authed(env, 'u-booth'), 'events', EVENT, 'attempts', 'a-new'),
      attempt({ staffUid: 'u-admin' })
    ));
  });

  test('R15 攤位不可作廢 10 分鐘前的紀錄', async () => {
    const db = authed(env, 'u-booth');
    await assertSucceeds(updateDoc(
      doc(db, 'events', EVENT, 'attempts', 'a-fresh'), { voided: true, voidReason: '掃錯人' }
    ));
    await assertFails(updateDoc(
      doc(db, 'events', EVENT, 'attempts', 'a-old'), { voided: true, voidReason: '太晚了' }
    ));
  });

  test('R15b Admin 不受 10 分鐘限制', async () => {
    await assertSucceeds(updateDoc(
      doc(authed(env, 'u-admin'), 'events', EVENT, 'attempts', 'a-old'),
      { voided: true, voidReason: '主辦更正' }
    ));
  });

  test('附加：成績永不可刪除，只能作廢', async () => {
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(authed(env, 'u-admin'), 'events', EVENT, 'attempts', 'a-fresh')));
  });
});

describe('Game Pass（免註冊玩家）', () => {
  test('附加：訪客可自行建立 Game Pass', async () => {
    await assertSucceeds(setDoc(
      doc(guest(env), 'events', EVENT, 'players', 'FEDA-0182'), gamePass()
    ));
  });

  test('R16 訪客不可自帶抽獎張數', async () => {
    await assertFails(setDoc(
      doc(guest(env), 'events', EVENT, 'players', 'FEDA-0182'),
      gamePass({ luckyDrawEntries: 99 })
    ));
  });

  test('R16b 訪客不可自帶已完成關卡', async () => {
    await assertFails(setDoc(
      doc(guest(env), 'events', EVENT, 'players', 'FEDA-0183'),
      gamePass({ playerId: 'FEDA-0183', completedChallengeIds: [CHALLENGE] })
    ));
  });

  test('R16c 暱稱長度超過 12 字時拒絕', async () => {
    await assertFails(setDoc(
      doc(guest(env), 'events', EVENT, 'players', 'FEDA-0184'),
      gamePass({ playerId: 'FEDA-0184', nickname: '這是一個非常非常長的暱稱超過限制' })
    ));
  });

  test('R17 訪客不可改別人的完成進度與抽獎張數', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'events', EVENT, 'players', 'FEDA-0182'), {
        playerId: 'FEDA-0182', nickname: '阿哲',
        completedChallengeIds: [], luckyDrawEntries: 0
      });
    });
    await assertFails(updateDoc(
      doc(guest(env), 'events', EVENT, 'players', 'FEDA-0182'),
      { luckyDrawEntries: 50, completedChallengeIds: [CHALLENGE] }
    ));
    // 只改暱稱是允許的
    await assertSucceeds(updateDoc(
      doc(guest(env), 'events', EVENT, 'players', 'FEDA-0182'), { nickname: '阿哲2' }
    ));
  });

  test('R19 訪客不可寫排行榜（只有 Function 能寫）', async () => {
    await assertFails(setDoc(
      doc(guest(env), 'events', EVENT, 'leaderboards', CHALLENGE),
      { challengeId: CHALLENGE, rows: [{ rank: 1, nickname: '我最強', value: 999 }] }
    ));
  });
});

// ══════════════════════════════════════════════════════════════
// R126–R128｜攤位端實際送出的文件形狀（M6-b）
//
// R13–R17 已經驗過「誰能寫什麼」。這幾條驗的是另一件事：
// **`js/modules/booth/data.js` 真正組出來的那份文件，過不過得了規則。**
// 欄位白名單多一個、少一個，現場就是送不出去——而那要到活動當天才會發現。
// ══════════════════════════════════════════════════════════════

describe('R126–R128 攤位端的文件形狀', () => {
  /** 跟 js/modules/booth/actions.js 的 buildAttempt() 一模一樣的欄位 */
  const boothAttempt = (over = {}) => ({
    attemptId: 'FEDA-0182__' + CHALLENGE + '__1760000000000',
    challengeId: CHALLENGE,
    playerId: 'FEDA-0182',
    playerNickname: '阿哲',
    attemptNo: 1,
    rawValue: 3,
    displayValue: '3次',
    detail: null,
    isBest: false,
    source: 'free',
    staffUid: 'u-booth',
    boothDeviceId: null,
    voided: false,
    voidReason: null,
    eventId: EVENT,
    createdAt: serverTimestamp(),
    ...over
  });

  /** 跟 js/modules/booth/data.js 的 createPlayer() 一模一樣的欄位 */
  const boothPlayer = (over = {}) => ({
    playerId: 'FEDA-0999',
    eventId: EVENT,
    nickname: 'FEDA-0999',
    ageBand: null,
    avatarSeed: '0999',
    qrCode: null,
    linkedTeamId: null,
    contact: { phone: null, lineUserId: null },
    completedChallengeIds: [],
    luckyDrawEntries: 0,
    createdVia: 'staff',
    createdAt: serverTimestamp(),
    lastActiveAt: serverTimestamp(),
    ...over
  });

  test('R126 ⭐ 攤位送出的成績文件過得了規則', async () => {
    const db = authed(env, 'u-booth');
    const id = 'FEDA-0182__' + CHALLENGE + '__1760000000000';
    await assertSucceeds(setDoc(doc(db, 'events', EVENT, 'attempts', id), boothAttempt()));
  });

  test('R126b shots 型態帶著每球細項也過得了（detail 是陣列）', async () => {
    const db = authed(env, 'u-booth');
    await assertSucceeds(setDoc(
      doc(db, 'events', EVENT, 'attempts', 'a-shots'),
      boothAttempt({ detail: [3, 0, 2, 1, 3], rawValue: 4 })));
  });

  test('R126c ⭐ 加場（source:staff）不會被規則擋掉', async () => {
    // 超過次數上限時攤位仍可送出，規則不管次數——次數是介面層的提示
    const db = authed(env, 'u-booth');
    await assertSucceeds(setDoc(
      doc(db, 'events', EVENT, 'attempts', 'a-extra'),
      boothAttempt({ source: 'staff', attemptNo: 4 })));
  });

  test('R127 ⭐ 攤位現場代建 Game Pass 的欄位組合過得了白名單', async () => {
    // 玩家手機沒電時要代建（docs/06 §10）。白名單多一個欄位就整份被擋，
    // 而那要到活動當天才會發現
    const db = authed(env, 'u-booth');
    await assertSucceeds(setDoc(doc(db, 'events', EVENT, 'players', 'FEDA-0999'), boothPlayer()));
  });

  test('R127b 代建時自帶抽獎張數照樣被擋', async () => {
    const db = authed(env, 'u-booth');
    await assertFails(setDoc(
      doc(db, 'events', EVENT, 'players', 'FEDA-0998'),
      boothPlayer({ playerId: 'FEDA-0998', luckyDrawEntries: 5 })));
  });

  test('R128 ⭐ 作廢只動 voided 與 voidReason（多動一個欄位就被擋）', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'events', EVENT, 'attempts', 'a-void'),
        { ...boothAttempt(), createdAt: new Date() });
    });
    const db = authed(env, 'u-booth');
    const ref = doc(db, 'events', EVENT, 'attempts', 'a-void');
    await assertSucceeds(updateDoc(ref, { voided: true, voidReason: '攤位作廢' }));
    // 順手改成績＝偽造，一律擋掉
    await assertFails(updateDoc(ref, { voided: true, voidReason: 'x', rawValue: 5 }));
  });
});
