/**
 * firestore.rules｜完賽後三分鐘自撤回（分支 D）
 * 對應 docs/10 §5.3、docs/07 §2.4 的 R24–R30
 *
 * 前端的 undoState() 已經有一整組單元測試，但那是**畫面**的判斷。
 * 真正的防線在這裡：時間基準必須是伺服器的 request.time 與伺服器寫下的
 * scoreSubmittedAt，把手機時間調回去、離線放一小時再送，都不能撈到撤回權。
 */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, Timestamp, serverTimestamp } from 'firebase/firestore';
import {
  makeEnv, seedBaseline, asAdminSdk, authed,
  EVENT, MATCH, baseMatch
} from './helpers.js';

let env;

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seedBaseline(env);
});

const matchRef = (db, id = MATCH) => doc(db, 'events', EVENT, 'matches', id);

/** 造一個「已完賽並鎖定」的場次，送出者是 who，送出時間是 agoSec 秒前 */
async function finishedMatch({ who = 'u-scorer', agoSec = 5, status = 'finished' } = {}) {
  await asAdminSdk(env, db => setDoc(
    doc(db, 'events', EVENT, 'matches', MATCH),
    baseMatch(MATCH, 'venue-a', {
      status,
      period: 'ft',
      score: { home: 2, away: 1 },
      lock: { locked: true, lockedAt: null, lockedBy: who },
      scoreSubmittedBy: who,
      scoreSubmittedAt: Timestamp.fromMillis(Date.now() - agoSec * 1000),
      result: { winner: 'home', method: 'regulation', homePoints: 3, awayPoints: 0 }
    })
  ));
}

/** 標準的撤回 patch（與 buildUndoPatch 產出的欄位一致） */
const undoPatch = (uid = 'u-scorer') => ({
  status: 'live',
  period: 'h2',
  result: null,
  lock: { locked: false, lockedAt: null, lockedBy: null },
  scoreSubmittedAt: null,
  scoreSubmittedBy: null,
  updatedBy: uid
});

describe('三分鐘自撤回', () => {
  test('R24 送出者在三分鐘內可以把場次退回進行中', async () => {
    await finishedMatch({ agoSec: 5 });
    await assertSucceeds(updateDoc(matchRef(authed(env, 'u-scorer')), undoPatch()));
  });

  test('R25 ⭐ 超過三分鐘就不行（時間基準在伺服器，不是手機）', async () => {
    await finishedMatch({ agoSec: 200 });
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer')), undoPatch()));
  });

  test('R26 ⭐ 別人送出的完賽，同場地的另一位賽務也不能撤回', async () => {
    await finishedMatch({ who: 'u-referee', agoSec: 5 });
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer')), undoPatch('u-scorer')));
  });

  test('R27 ⭐ 撤回時不可以順便改比分', async () => {
    await finishedMatch({ agoSec: 5 });
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer')), {
      ...undoPatch(), score: { home: 9, away: 0 }
    }));
  });

  test('R28 ⭐ 主辦覆核（confirmed）之後就撤不回來了', async () => {
    await finishedMatch({ agoSec: 5, status: 'confirmed' });
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer')), undoPatch()));
  });

  test('R29 ⭐ 撤回時必須清掉 scoreSubmittedAt，不能留著讓視窗一直續命', async () => {
    await finishedMatch({ agoSec: 5 });
    const keep = { ...undoPatch() };
    delete keep.scoreSubmittedAt;              // 想留著原本的送出時間
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer')), keep));
  });

  test('R30 ⭐ 賽務不能自己塞一個未來的 scoreSubmittedAt 把視窗變成無限期', async () => {
    // 這是 serverStampedSubmit() 要擋的攻擊：先在完賽時寫一個 2099 年的時間戳，
    // 之後任何時候都還在「三分鐘內」。
    await asAdminSdk(env, db => setDoc(
      doc(db, 'events', EVENT, 'matches', MATCH),
      baseMatch(MATCH, 'venue-a', { status: 'live' })
    ));
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer')), {
      status: 'finished',
      lock: { locked: true, lockedAt: null, lockedBy: 'u-scorer' },
      scoreSubmittedBy: 'u-scorer',
      scoreSubmittedAt: Timestamp.fromDate(new Date('2099-01-01T00:00:00Z')),
      updatedBy: 'u-scorer'
    }));
  });

  test('R30b 用 serverTimestamp() 寫送出時間則是允許的（正常路徑）', async () => {
    await asAdminSdk(env, db => setDoc(
      doc(db, 'events', EVENT, 'matches', MATCH),
      baseMatch(MATCH, 'venue-a', { status: 'live' })
    ));
    await assertSucceeds(updateDoc(matchRef(authed(env, 'u-scorer')), {
      status: 'finished',
      period: 'ft',
      lock: { locked: true, lockedAt: null, lockedBy: 'u-scorer' },
      scoreSubmittedBy: 'u-scorer',
      scoreSubmittedAt: serverTimestamp(),
      updatedBy: 'u-scorer'
    }));
  });

  test('附加：撤回之後場次已解鎖，賽務可以照常繼續改比分', async () => {
    // 撤回的重點就是「回到可以工作的狀態」。
    // （原本這裡寫的是「不能再撤一次」，但那是錯的：撤回之後場次是
    //   未鎖定的 live，再寫一次 live→live 只是一筆無害的重複寫入，
    //   分支 B 本來就該放行。要擋的是「已鎖定的成績被動」，不是重複按。）
    await finishedMatch({ agoSec: 5 });
    const db = authed(env, 'u-scorer');
    await assertSucceeds(updateDoc(matchRef(db), undoPatch()));
    await assertSucceeds(updateDoc(matchRef(db), {
      score: { home: 2, away: 2 }, updatedBy: 'u-scorer'
    }));
  });

  test('⭐ 撤回之後重新完賽，三分鐘要從新的送出時間重算', async () => {
    // 舊的 scoreSubmittedAt 必須在撤回時被清成 null（R29），
    // 重新完賽時再由 serverTimestamp() 寫一個新的。
    // 若沒清乾淨，第二次完賽會沿用第一次的時間，視窗等於被偷走。
    await finishedMatch({ agoSec: 170 });          // 只剩 10 秒
    const db = authed(env, 'u-scorer');
    await assertSucceeds(updateDoc(matchRef(db), undoPatch()));
    await assertSucceeds(updateDoc(matchRef(db), {
      status: 'finished', period: 'ft',
      lock: { locked: true, lockedAt: null, lockedBy: 'u-scorer' },
      scoreSubmittedBy: 'u-scorer',
      scoreSubmittedAt: serverTimestamp(),
      updatedBy: 'u-scorer'
    }));
    // 新視窗剛開始，所以現在撤得掉
    await assertSucceeds(updateDoc(matchRef(db), undoPatch()));
  });

  test('附加：不在指派場地的場次，即使是自己送出的也不能撤回', async () => {
    await asAdminSdk(env, db => setDoc(
      doc(db, 'events', EVENT, 'matches', 'AO-G-B-01'),
      baseMatch('AO-G-B-01', 'venue-b', {
        status: 'finished',
        lock: { locked: true, lockedAt: null, lockedBy: 'u-scorer' },
        scoreSubmittedBy: 'u-scorer',
        scoreSubmittedAt: Timestamp.fromMillis(Date.now() - 5000)
      })
    ));
    await assertFails(updateDoc(matchRef(authed(env, 'u-scorer'), 'AO-G-B-01'), undoPatch()));
  });
});
