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
