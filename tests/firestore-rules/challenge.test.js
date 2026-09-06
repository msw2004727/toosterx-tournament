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

describe('Game Pass（綁 LINE 帳號、由 Function 配發；主辦 2026-09-06 決定）', () => {
  test('⭐ R16 訪客不能自己建挑戰卡（配發在 Function，走 Admin SDK）', async () => {
    await assertFails(setDoc(doc(guest(env), 'events', EVENT, 'players', 'FEDA-0182'), gamePass()));
  });

  test('⭐ R16a 一般 LINE 使用者也不能自己建（只能透過配發）', async () => {
    await assertFails(setDoc(doc(authed(env, 'u-player'), 'events', EVENT, 'players', 'FEDA-0182'), gamePass()));
  });

  test('R16b 攤位可以代建，但不可自帶抽獎張數或已完成關卡', async () => {
    await assertSucceeds(setDoc(
      doc(authed(env, 'u-booth'), 'events', EVENT, 'players', 'FEDA-0182'), gamePass({ createdVia: 'staff' })
    ));
    await assertFails(setDoc(
      doc(authed(env, 'u-booth'), 'events', EVENT, 'players', 'FEDA-0183'),
      gamePass({ playerId: 'FEDA-0183', luckyDrawEntries: 99 })
    ));
    await assertFails(setDoc(
      doc(authed(env, 'u-booth'), 'events', EVENT, 'players', 'FEDA-0184'),
      gamePass({ playerId: 'FEDA-0184', completedChallengeIds: [CHALLENGE] })
    ));
  });

  test('R16c 暱稱長度超過 12 字時拒絕', async () => {
    await assertFails(setDoc(
      doc(authed(env, 'u-booth'), 'events', EVENT, 'players', 'FEDA-0185'),
      gamePass({ playerId: 'FEDA-0185', nickname: '這是一個非常非常長的暱稱超過限制' })
    ));
  });

  /**
   * ⭐ R17 撞號要被擋下來。配發在 Function 的交易裡做，但攤位代建是從客戶端寫的：
   * `players` 只放行 create，撞到已存在的文件時 setDoc 會被當成 update 而擋下來。
   * 這一條若失守，後來的人會把先來的人整份蓋掉——完成關卡與抽獎張數瞬間歸零。
   */
  test('⭐ R17 撞號：已存在的挑戰卡不可以被整份蓋掉', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'events', EVENT, 'players', 'FEDA-0182'), {
        playerId: 'FEDA-0182', eventId: EVENT, nickname: '先來的人',
        completedChallengeIds: [CHALLENGE], luckyDrawEntries: 3
      });
    });
    await assertFails(setDoc(
      doc(authed(env, 'u-booth'), 'events', EVENT, 'players', 'FEDA-0182'), gamePass({ nickname: '後來的人' })
    ));
  });

  test('⭐ R17a 進度與抽獎張數只有 Function／Admin 可改，連卡主也不行', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'events', EVENT, 'players', 'FEDA-0182'), {
        playerId: 'FEDA-0182', nickname: '阿哲', completedChallengeIds: [], luckyDrawEntries: 0
      });
      await setDoc(doc(ctx.firestore(), 'users', 'u-player'), { uid: 'u-player', gamePassId: 'FEDA-0182' });
    });
    await assertFails(updateDoc(
      doc(guest(env), 'events', EVENT, 'players', 'FEDA-0182'), { luckyDrawEntries: 50 }
    ));
    await assertFails(updateDoc(
      doc(authed(env, 'u-player'), 'events', EVENT, 'players', 'FEDA-0182'),
      { luckyDrawEntries: 50, completedChallengeIds: [CHALLENGE] }
    ));
  });

  /**
   * ⭐ R17b 暱稱只有卡主改得動：users/{uid}.gamePassId 指到這一張才算。
   * 原本暱稱對任何人開放（被亂改只是玩笑）；綁 LINE 之後有「主人」這個概念，就收到主人身上。
   */
  test('⭐ R17b 暱稱只有這張卡的主人改得動', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'events', EVENT, 'players', 'FEDA-0182'), {
        playerId: 'FEDA-0182', nickname: '阿哲', completedChallengeIds: [], luckyDrawEntries: 0
      });
      await setDoc(doc(ctx.firestore(), 'users', 'u-player'), { uid: 'u-player', gamePassId: 'FEDA-0182' });
      await setDoc(doc(ctx.firestore(), 'users', 'u-other'), { uid: 'u-other', gamePassId: 'FEDA-0999' });
    });
    await assertSucceeds(updateDoc(
      doc(authed(env, 'u-player'), 'events', EVENT, 'players', 'FEDA-0182'), { nickname: '阿哲2' }
    ));
    await assertFails(updateDoc(
      doc(authed(env, 'u-other'), 'events', EVENT, 'players', 'FEDA-0182'), { nickname: '被改了' }
    ));
    await assertFails(updateDoc(
      doc(guest(env), 'events', EVENT, 'players', 'FEDA-0182'), { nickname: '被改了' }
    ));
  });

  test('⭐ R17d 聯絡方式誰都改不動（含卡主），只能走 Function', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'events', EVENT, 'players', 'FEDA-0182'), {
        playerId: 'FEDA-0182', nickname: '阿哲', completedChallengeIds: [], luckyDrawEntries: 0,
        contact: { phone: null, lineUserId: null }
      });
      await setDoc(doc(ctx.firestore(), 'users', 'u-player'), { uid: 'u-player', gamePassId: 'FEDA-0182' });
    });
    await assertFails(updateDoc(
      doc(authed(env, 'u-player'), 'events', EVENT, 'players', 'FEDA-0182'),
      { contact: { phone: '0912345678', lineUserId: null } }
    ));
    await assertFails(updateDoc(
      doc(guest(env), 'events', EVENT, 'players', 'FEDA-0182'),
      { contact: { phone: '0912345678', lineUserId: null } }
    ));
  });
});

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
