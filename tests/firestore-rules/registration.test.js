/**
 * firestore.rules｜M4 報名與球隊管理（R34–R64）
 * 對應 docs/10 §5.1／§5.2、§10 的驗收條件 A01–A06、A10
 *
 * 這一組守的是三條線：
 *   ① 權限升級只有一條路——只有 super_admin 動得了身分，Admin 連自己的都不行
 *   ② 報名開關是 fail-closed——設定讀不到就是關著
 *   ③ 名單凍結是真的凍結——隊長不能自己把鎖打開
 */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, collectionGroup, query, where, Timestamp
} from 'firebase/firestore';
import { makeEnv, seedBaseline, asAdminSdk, authed, guest, EVENT } from './helpers.js';

let env;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seedBaseline(env);
  await openRegistration();
});

const TEAM = 't-new';
const CAP = 'u-captain';
const PARENT = 'u-parent';

const teamRef = (db, id = TEAM) => doc(db, 'events', EVENT, 'teams', id);
const memberRef = (db, mid, tid = TEAM) => doc(db, 'events', EVENT, 'teams', tid, 'members', mid);

/** 報名開放中（沒有起訖限制） */
async function openRegistration(over = {}) {
  await asAdminSdk(env, db => setDoc(doc(db, 'config', 'registration'), {
    open: true, opensAt: null, closesAt: null, maxTeamsPerAccount: 3, ...over
  }));
}

const newTeamDoc = (over = {}) => ({
  teamId: TEAM, eventId: EVENT, divisionId: 'adult-open',
  name: '測試隊', shortName: '測試',
  captainUid: CAP, captainName: '隊長',
  status: 'draft', rosterLocked: false, memberCount: 0,
  inviteCode: 'ABC123',
  ...over
});

/** 直接鋪一支球隊（繞過 rules），供更新類的案例用 */
async function seedTeam(over = {}) {
  await asAdminSdk(env, db => setDoc(teamRef(db), newTeamDoc(over)));
}

const newMemberDoc = (over = {}) => ({
  memberId: 'm-1', guardianUid: PARENT, isSelf: false,
  name: '王小明', birthDate: '2016-03-14', idLast4: '1234',
  jerseyNo: 7, kind: 'player', status: 'pending',
  consent: { given: true, at: null, byUid: PARENT }, source: 'guardian',
  ...over
});

async function seedMember(over = {}) {
  await asAdminSdk(env, db => setDoc(memberRef(db, over.memberId || 'm-1'), newMemberDoc(over)));
}

/** 教練（隊長）自己新增的小球員：沒有 guardianUid、直接 approved、source 是 coach */
const coachMemberDoc = (over = {}) => ({
  memberId: 'm-c1', guardianUid: null, addedBy: CAP, isSelf: false,
  name: '小豆子', nameKind: 'nickname',
  birthDate: '2017-03-05', idLast4: '1234',
  jerseyNo: 9, kind: 'player', role: 'player', status: 'approved',
  source: 'coach',
  ...over
});

// ══════════════════════════════════════════════════════════════
describe('R34–R39 身分授權（docs/10 §5.1）', () => {
  const staffRef = (db, u) => doc(db, 'staff', u);

  test('R34 ⭐ Admin 不能把自己升成 super_admin（驗收 A05）', async () => {
    await assertFails(updateDoc(staffRef(authed(env, 'u-admin'), 'u-admin'), {
      roles: ['admin', 'super_admin']
    }));
  });

  test('R35 ⭐ Admin 不能改任何人的身分，連降級別人也不行', async () => {
    await assertFails(updateDoc(staffRef(authed(env, 'u-admin'), 'u-scorer'), { roles: ['admin'] }));
    await assertFails(updateDoc(staffRef(authed(env, 'u-admin'), 'u-scorer'), { active: false }));
  });

  test('R36 ⭐ 大總管可以指派 admin（驗收 A06）', async () => {
    await assertSucceeds(setDoc(staffRef(authed(env, 'u-super'), 'u-new'), {
      uid: 'u-new', name: '新管理員', roles: ['admin'], active: true,
      assignment: { eventId: EVENT, venueIds: [], divisionIds: [], challengeIds: [] }
    }));
  });

  test('R37 ⭐ 大總管也不能由介面造出第二個大總管', async () => {
    // 白名單裡沒有 super_admin。第一位由種子／Console 建立，走 Admin SDK 不經 rules。
    await assertFails(setDoc(staffRef(authed(env, 'u-super'), 'u-new'), {
      uid: 'u-new', name: '第二個大總管', roles: ['super_admin'], active: true,
      assignment: { eventId: EVENT, venueIds: [], divisionIds: [], challengeIds: [] }
    }));
  });

  test('R38 大總管可以改自己的指派場地（roles 原封不動）', async () => {
    // 他自己的 roles 是 ['super_admin']，過不了白名單，所以規則要放行「角色沒變」的更新
    await assertSucceeds(updateDoc(staffRef(authed(env, 'u-super'), 'u-super'), {
      assignment: { eventId: EVENT, venueIds: ['venue-a'], divisionIds: [], challengeIds: [] }
    }));
  });

  test('R39 只有大總管刪得掉 staff 文件', async () => {
    await assertFails(deleteDoc(staffRef(authed(env, 'u-admin'), 'u-scorer')));
    await assertSucceeds(deleteDoc(staffRef(authed(env, 'u-super'), 'u-scorer')));
  });
});

describe('R40–R42 使用者名錄（docs/10 §1.4）', () => {
  const userRef = (db, u) => doc(db, 'users', u);

  test('R40 登入者可以留下自己的一筆', async () => {
    await assertSucceeds(setDoc(userRef(authed(env, CAP), CAP), {
      uid: CAP, displayName: '隊長', pictureUrl: null, firstSeenAt: null, lastSeenAt: null
    }));
  });

  test('R41 ⭐ 但不准自帶 roles（那是快取，權威在 staff/{uid}）', async () => {
    await assertFails(setDoc(userRef(authed(env, CAP), CAP), {
      uid: CAP, displayName: '我是管理員', roles: ['admin']
    }));
  });

  test('R42 不能寫別人的那一筆，也不能刪', async () => {
    await assertFails(setDoc(userRef(authed(env, CAP), PARENT), { uid: PARENT, displayName: 'x' }));
    await asAdminSdk(env, db => setDoc(userRef(db, CAP), { uid: CAP, displayName: '隊長' }));
    await assertFails(deleteDoc(userRef(authed(env, CAP), CAP)));
  });
});

describe('R43–R48 報名開關與建隊（docs/10 §2.3）', () => {
  test('R43 ⭐ 報名關閉時不能建隊（驗收 A10）', async () => {
    await openRegistration({ open: false });
    await assertFails(setDoc(teamRef(authed(env, CAP)), newTeamDoc()));
  });

  test('R44 ⭐ 已過截止日不能建隊', async () => {
    await openRegistration({ closesAt: Timestamp.fromMillis(Date.now() - 60_000) });
    await assertFails(setDoc(teamRef(authed(env, CAP)), newTeamDoc()));
  });

  test('R44b 還沒到開放日也不行', async () => {
    await openRegistration({ opensAt: Timestamp.fromMillis(Date.now() + 60_000) });
    await assertFails(setDoc(teamRef(authed(env, CAP)), newTeamDoc()));
  });

  test('R45 ⭐ 設定文件不存在時一律視為關閉（fail-closed）', async () => {
    await asAdminSdk(env, db => deleteDoc(doc(db, 'config', 'registration')));
    await assertFails(setDoc(teamRef(authed(env, CAP)), newTeamDoc()));
  });

  test('R46 開放中可以建隊', async () => {
    await assertSucceeds(setDoc(teamRef(authed(env, CAP)), newTeamDoc()));
  });

  test('R46b 訪客不能建隊', async () => {
    await assertFails(setDoc(teamRef(guest(env)), newTeamDoc()));
  });

  test('R47 ⭐ 不能冒名建隊（captainUid 必須是自己）', async () => {
    await assertFails(setDoc(teamRef(authed(env, CAP)), newTeamDoc({ captainUid: PARENT })));
  });

  test('R48 ⭐ 建隊時不准自帶已核准狀態或鎖定旗標', async () => {
    await assertFails(setDoc(teamRef(authed(env, CAP)), newTeamDoc({ status: 'approved' })));
    await assertFails(setDoc(teamRef(authed(env, CAP)), newTeamDoc({ rosterLocked: true })));
    await assertFails(setDoc(teamRef(authed(env, CAP)), newTeamDoc({ memberCount: 99 })));
  });
});

describe('R49–R54 球隊狀態機（docs/10 §3）', () => {
  test('R49 隊長可以送出報名（draft → submitted）', async () => {
    await seedTeam();
    await assertSucceeds(updateDoc(teamRef(authed(env, CAP)), {
      status: 'submitted', submittedAt: null, updatedBy: CAP
    }));
  });

  test('R50 ⭐ 送出之後隊伍資料就凍結了（驗收 A03）', async () => {
    await seedTeam({ status: 'submitted' });
    await assertFails(updateDoc(teamRef(authed(env, CAP)), { name: '改過的隊名' }));
  });

  test('R51 但可以撤回報名（submitted → draft），撤回後又能改', async () => {
    await seedTeam({ status: 'submitted' });
    const db = authed(env, CAP);
    await assertSucceeds(updateDoc(teamRef(db), { status: 'draft', updatedBy: CAP }));
    await assertSucceeds(updateDoc(teamRef(db), { name: '改過的隊名' }));
  });

  test('R52 ⭐ 隊長不能自己把報名改成已核准', async () => {
    await seedTeam({ status: 'submitted' });
    await assertFails(updateDoc(teamRef(authed(env, CAP)), { status: 'approved' }));
  });

  test('R53 ⭐ 隊長不能自己關掉 rosterLocked（凍結就形同虛設）', async () => {
    await seedTeam({ status: 'approved', rosterLocked: true });
    await assertFails(updateDoc(teamRef(authed(env, CAP)), { rosterLocked: false }));
  });

  test('R53c ⭐ 還在 draft 時隊長也設不了 rosterLocked（那是 Admin 的鎖）', async () => {
    // ⚠️ 這一條跟 R53 不一樣，別合併：R53 的球隊已經 approved，
    //    擋住它的其實是「凍結後只准動 status」那一段，白名單有沒有列
    //    rosterLocked 根本測不出來（變異 RU#6 就是這樣逃掉的）。
    //    要驗白名單，球隊必須處在**可編輯**的狀態。
    await seedTeam();                       // status: 'draft'
    await assertFails(updateDoc(teamRef(authed(env, CAP)), { rosterLocked: true }));
  });

  test('R53b 隊長也動不了 seed / finalRank 這類主辦欄位', async () => {
    await seedTeam();
    await assertFails(updateDoc(teamRef(authed(env, CAP)), { seed: 1 }));
    await assertFails(updateDoc(teamRef(authed(env, CAP)), { finalRank: 1 }));
  });

  test('R54 Admin 可以審核通過並鎖定名單', async () => {
    await seedTeam({ status: 'submitted' });
    await assertSucceeds(updateDoc(teamRef(authed(env, 'u-admin')), {
      status: 'approved', rosterLocked: true, reviewedBy: 'u-admin'
    }));
  });

  test('R54b 別人的球隊碰不得', async () => {
    await seedTeam();
    await assertFails(updateDoc(teamRef(authed(env, PARENT)), { name: '搶過來' }));
  });
});

describe('R55–R64 名單與加入申請（docs/10 §3.3／§4）', () => {
  test('R55 家長可以送出加入申請（驗收 A01）', async () => {
    await seedTeam();
    await assertSucceeds(setDoc(memberRef(authed(env, PARENT), 'm-1'), newMemberDoc()));
  });

  test('R56 ⭐ 申請人不能自己核准——隊長同意才是閘門（§3.3）', async () => {
    await seedTeam();
    await assertFails(setDoc(memberRef(authed(env, PARENT), 'm-1'),
      newMemberDoc({ status: 'approved' })));
  });

  test('R56b ⭐ 也不能冒別人的名義申請', async () => {
    await seedTeam();
    await assertFails(setDoc(memberRef(authed(env, PARENT), 'm-1'),
      newMemberDoc({ guardianUid: 'u-someone-else' })));
  });

  test('R57 ⭐ 隊長同意之後人數才算數（驗收 A02）', async () => {
    await seedTeam();
    await seedMember();
    await assertSucceeds(updateDoc(memberRef(authed(env, CAP), 'm-1'), {
      status: 'approved', decidedBy: CAP
    }));
  });

  test('R57b 隊長可以婉拒，也可以移除已核准的隊員', async () => {
    await seedTeam();
    await seedMember({ memberId: 'm-2', status: 'approved' });
    await assertSucceeds(updateDoc(memberRef(authed(env, CAP), 'm-2'), { status: 'removed' }));
  });

  test('R57c ⭐ 被系統退件的那一筆隊長可以收掉（移除），但不能改成已加入', async () => {
    // 每人限報乙隊／重複申請是 Function 事後退件的；不讓隊長移除的話，
    // 每退一次就多一列永遠留在名單頁上（2026-09-06 驗收：同一個孩子重試了四次）
    await seedTeam();
    await seedMember({ memberId: 'm-3', status: 'rejected', decidedBy: 'fn:onePlayerOneTeam', rejectReason: '每人限報乙隊' });
    await assertFails(updateDoc(memberRef(authed(env, CAP), 'm-3'), { status: 'approved' }));
    await assertSucceeds(updateDoc(memberRef(authed(env, CAP), 'm-3'), { status: 'removed', decidedBy: CAP }));
  });

  test('R58 ⭐ 名單凍結後隊長不能再決定申請（驗收 A04）', async () => {
    await seedTeam({ status: 'approved', rosterLocked: true });
    await seedMember();
    await assertFails(updateDoc(memberRef(authed(env, CAP), 'm-1'), { status: 'approved' }));
  });

  test('R59 但備註凍結後還是能改（不影響參賽資格，§4）', async () => {
    await seedTeam({ status: 'approved', rosterLocked: true });
    await seedMember({ status: 'approved' });
    await assertSucceeds(updateDoc(memberRef(authed(env, CAP), 'm-1'), { note: '腳踝有舊傷' }));
  });

  test('R60 ⭐ 名單一律不可刪除（移除是改 status）', async () => {
    await seedTeam();
    await seedMember();
    await assertFails(deleteDoc(memberRef(authed(env, CAP), 'm-1')));
    await assertFails(deleteDoc(memberRef(authed(env, 'u-admin'), 'm-1')));
  });

  test('R61 家長可以在被決定之前修正自己填的資料', async () => {
    await seedTeam();
    await seedMember();
    await assertSucceeds(updateDoc(memberRef(authed(env, PARENT), 'm-1'), {
      name: '王小華', jerseyNo: 9
    }));
  });

  test('R61b ⭐ 但改不動 status，也不能把自己換成別人', async () => {
    await seedTeam();
    await seedMember();
    const db = authed(env, PARENT);
    await assertFails(updateDoc(memberRef(db, 'm-1'), { status: 'approved' }));
    await assertFails(updateDoc(memberRef(db, 'm-1'), { guardianUid: 'u-someone-else' }));
  });

  test('R62 ⭐ 決定之後家長就改不動了', async () => {
    await seedTeam();
    await seedMember({ status: 'approved' });
    await assertFails(updateDoc(memberRef(authed(env, PARENT), 'm-1'), { name: '偷改' }));
  });

  test('R63 ⭐ 讀取邊界：隊長、本人、賽務看得到；其他登入者看不到', async () => {
    await seedTeam();
    await seedMember();
    await assertSucceeds(getDoc(memberRef(authed(env, CAP), 'm-1')));
    await assertSucceeds(getDoc(memberRef(authed(env, PARENT), 'm-1')));
    await assertSucceeds(getDoc(memberRef(authed(env, 'u-scorer'), 'm-1')));

    // 生日與身分證後四碼在這份文件上，路人不該讀得到
    await assertFails(getDoc(memberRef(authed(env, 'u-outsider'), 'm-1')));
    await assertFails(getDoc(memberRef(guest(env), 'm-1')));
  });

  test('R64 ⭐ 報名截止後不能再送申請', async () => {
    await seedTeam();
    await openRegistration({ open: false });
    await assertFails(setDoc(memberRef(authed(env, PARENT), 'm-9'),
      newMemberDoc({ memberId: 'm-9' })));
  });

  test('R64b 名單凍結後也不能再送申請', async () => {
    await seedTeam({ status: 'submitted' });
    await assertFails(setDoc(memberRef(authed(env, PARENT), 'm-9'),
      newMemberDoc({ memberId: 'm-9' })));
  });
});

// ══════════════════════════════════════════════════════════════
describe('R65–R72 教練直接管理名單（學童組，主辦 2026-09-03 指定）', () => {
  test('R65 ⭐ 隊長可以直接新增已核准的成員', async () => {
    // 學童三組不走邀請碼：小球員沒有 LINE 帳號，家長也不見得會操作。
    await seedTeam();
    await assertSucceeds(setDoc(memberRef(authed(env, CAP), 'm-c1'), coachMemberDoc()));
  });

  test('R66 ⭐ 不是隊長就不能直接新增已核准的成員', async () => {
    // 少了這一條，任何登入者知道 teamId 就能把人塞進別人的名單。
    //
    // ⚠️ addedBy **一定要填成送出者自己**，否則擋住這一筆的是
    //    coachAddedMemberOk() 的 addedBy 檢查，不是 isCaptainOf——
    //    兩道守衛互相遮蔽，把 isCaptainOf 整條拿掉測試照樣全綠（變異 RU#13）。
    await seedTeam();
    await assertFails(setDoc(memberRef(authed(env, PARENT), 'm-c1'),
      coachMemberDoc({ addedBy: PARENT })));
    await assertFails(setDoc(memberRef(authed(env, 'u-random'), 'm-c1'),
      coachMemberDoc({ addedBy: 'u-random' })));
  });

  test('R67 ⭐ 直接新增的那筆必須標成 coach 且 addedBy 是自己', async () => {
    // source 不只是標記：R69 靠它判斷「這筆是不是隊長自己填的」。
    // 冒充成 coach 就能改到家長填的資料。
    await seedTeam();
    await assertFails(setDoc(memberRef(authed(env, CAP), 'm-c1'),
      coachMemberDoc({ source: 'guardian' })));
    await assertFails(setDoc(memberRef(authed(env, CAP), 'm-c1'),
      coachMemberDoc({ addedBy: PARENT })));
  });

  test('R68 ⭐ 直接新增的那筆不可以帶 guardianUid', async () => {
    // 帶了的話那位家長就能用「本人」的身分改這筆資料（guardianMemberPatchOk）
    await seedTeam();
    await assertFails(setDoc(memberRef(authed(env, CAP), 'm-c1'),
      coachMemberDoc({ guardianUid: PARENT })));
  });

  test('R69 ⭐ 隊長改得動自己填的那幾筆', async () => {
    await seedTeam();
    await seedMember(coachMemberDoc());
    await assertSucceeds(updateDoc(memberRef(authed(env, CAP), 'm-c1'), {
      name: '小豆', birthDate: '2017-04-01', idLast4: '5678', jerseyNo: 10
    }));
  });

  test('R69b ⭐ 但改不動家長填的那幾筆的內容', async () => {
    // 隊長對家長送來的申請只能「同意」或「婉拒」，不能改人家填的資料
    await seedTeam();
    await seedMember();                                     // source: 'guardian'
    await assertFails(updateDoc(memberRef(authed(env, CAP), 'm-1'), {
      name: '被改掉的名字', idLast4: '9999'
    }));
  });

  test('R70 ⭐ 隊長不能藉由編輯把 status 改掉', async () => {
    // 編輯與狀態轉換是兩條不同的路。混在一起的話「改個背號」
    // 就能順手把 removed 的人放回名單。
    await seedTeam();
    await seedMember(coachMemberDoc());
    await assertFails(updateDoc(memberRef(authed(env, CAP), 'm-c1'), {
      name: '小豆', status: 'pending'
    }));
  });

  test('R70b 移除仍然走狀態轉換（approved → removed）', async () => {
    await seedTeam();
    await seedMember(coachMemberDoc());
    await assertSucceeds(updateDoc(memberRef(authed(env, CAP), 'm-c1'), {
      status: 'removed', decidedBy: CAP
    }));
  });

  test('R71 ⭐ 名單凍結後隊長不能再新增或編輯', async () => {
    await seedTeam({ status: 'submitted' });
    await assertFails(setDoc(memberRef(authed(env, CAP), 'm-c2'), coachMemberDoc({ memberId: 'm-c2' })));

    await asAdminSdk(env, db => setDoc(memberRef(db, 'm-c1'), coachMemberDoc()));
    await assertFails(updateDoc(memberRef(authed(env, CAP), 'm-c1'), { name: '改不動' }));
  });

  test('R72 ⭐ 報名截止後隊長也不能再新增', async () => {
    await openRegistration({ closesAt: Timestamp.fromMillis(Date.now() - 60_000) });
    await seedTeam();
    await assertFails(setDoc(memberRef(authed(env, CAP), 'm-c1'), coachMemberDoc()));
  });
});


// ══════════════════════════════════════════════════════════════
describe('R93–R98 報名審核（docs/05 §8.2、docs/10 §3）', () => {
  test('R93 ⭐ Admin 核准：狀態改成 approved 並鎖名單', async () => {
    await seedTeam({ status: 'submitted' });
    await assertSucceeds(updateDoc(teamRef(authed(env, 'u-admin')), {
      status: 'approved', rosterLocked: true, reviewedBy: 'u-admin'
    }));
  });

  test('R94 ⭐ Admin 退回：狀態改成 rejected 並解凍', async () => {
    // rosterFrozen() 看的是 status in ['draft','rejected'] && !rosterLocked。
    // 退回時順手鎖起來的話，隊長改不動卻看不出為什麼。
    await seedTeam({ status: 'submitted' });
    await assertSucceeds(updateDoc(teamRef(authed(env, 'u-admin')), {
      status: 'rejected', rosterLocked: false, rejectReason: '超齡'
    }));
  });

  test('R95 ⭐ 隊長自己核准不了（審核是主辦的閘門）', async () => {
    await seedTeam({ status: 'submitted' });
    await assertFails(updateDoc(teamRef(authed(env, CAP)), {
      status: 'approved', rosterLocked: true
    }));
  });

  test('R96 ⭐ 記錄員也核准不了（覆核與審核都在管理員以上）', async () => {
    await seedTeam({ status: 'submitted' });
    await assertFails(updateDoc(teamRef(authed(env, 'u-scorer')), { status: 'approved' }));
  });

  test('R97 ⭐ 核准之後隊長改不動名單（第二道鎖）', async () => {
    await seedTeam({ status: 'approved', rosterLocked: true });
    await assertFails(setDoc(memberRef(authed(env, CAP), 'm-new'),
      newMemberDoc({ memberId: 'm-new' })));
  });

  test('R98 退回之後隊長可以改，也可以再送一次', async () => {
    await seedTeam({ status: 'rejected', rosterLocked: false });
    await assertSucceeds(setDoc(memberRef(authed(env, PARENT), 'm-again'),
      newMemberDoc({ memberId: 'm-again' })));
    await assertSucceeds(updateDoc(teamRef(authed(env, CAP)), { status: 'draft' }));
  });

  test('R98c ⭐ 被退回的球隊改完可以直接再送出（rejected → submitted，不必先退回草稿）', async () => {
    // 管理頁在「已退回」狀態畫的就是「送出報名」——那顆鈕寫的是 submitted。
    // 只放行 rejected → draft 的話，隊長按下去會被規則打回來，而且畫面先顯示
    // 「待主辦審核」再消失（本機快照的假成功）。2026-09-06 在 demo 實測抓到。
    await seedTeam({ status: 'rejected', rosterLocked: false, rejectReason: '請補背號' });
    await assertSucceeds(updateDoc(teamRef(authed(env, CAP)), {
      status: 'submitted', submittedAt: new Date()
    }));
  });

  test('R98d 被退回的球隊仍然不能由隊長自己改成 approved', async () => {
    await seedTeam({ status: 'rejected', rosterLocked: false });
    await assertFails(updateDoc(teamRef(authed(env, CAP)), { status: 'approved' }));
  });

  test('R98e ⭐ 草稿可以由隊長自己取消（還沒送出、沒有報名費，不必勞煩主辦）', async () => {
    await seedTeam({ status: 'draft', rosterLocked: false });
    await assertSucceeds(updateDoc(teamRef(authed(env, CAP)), {
      status: 'withdrawn', cancelRequest: { reason: '球員湊不齊', byUid: CAP, status: 'self' }
    }));
  });

  test('R98f ⭐ 送出之後隊長就取消不了，只能申請（取消與退費由主辦處理）', async () => {
    await seedTeam({ status: 'submitted' });
    await assertFails(updateDoc(teamRef(authed(env, CAP)), { status: 'withdrawn' }));
    await seedTeam({ status: 'approved', rosterLocked: true });
    await assertFails(updateDoc(teamRef(authed(env, CAP)), { status: 'withdrawn' }));
  });

  test('R98b ⭐ 稽核紀錄只能新增，改不動也刪不掉（R-SEC-002）', async () => {
    const auditRef = db => doc(db, 'events', EVENT, 'audits', 'a-1');
    await assertSucceeds(setDoc(auditRef(authed(env, 'u-admin')), {
      auditId: 'a-1', action: 'team.approve', targetType: 'team', targetId: TEAM,
      actor: { uid: 'u-admin', at: null }
    }));
    await assertFails(updateDoc(auditRef(authed(env, 'u-admin')), { action: 'x' }));
    await assertFails(deleteDoc(auditRef(authed(env, 'u-super'))));
  });
});

// ══════════════════════════════════════════════════════════════
describe('R133 球員最多 15 人（規章第十二條，伺服器端強制）', () => {
  /**
   * rules 看的是 Function 維護在球隊文件上的 `playerCount`（只數已核准的球員）。
   * 這裡直接把那一格設成 15，模擬「名單已經滿了」。
   */
  test('⭐ R133 名單已有 15 位球員時，教練再加第 16 位會被擋', async () => {
    await seedTeam({ playerCount: 15 });
    await assertFails(setDoc(memberRef(authed(env, CAP), 'm-c16'), coachMemberDoc({ memberId: 'm-c16' })));
  });

  test('R133b 14 位時還加得進去', async () => {
    await seedTeam({ playerCount: 14 });
    await assertSucceeds(setDoc(memberRef(authed(env, CAP), 'm-c15'), coachMemberDoc({ memberId: 'm-c15' })));
  });

  test('⭐ R133c 上限只數球員：15 位球員滿了，隊職員照樣加得進去', async () => {
    // 規章第十二條：球員 15 人、隊職員 3 人是兩個上限。把教練也算進 15 人，
    // 一支滿編的隊就沒辦法登記領隊——那是比賽當天才會發現的事
    await seedTeam({ playerCount: 15 });
    await assertSucceeds(setDoc(memberRef(authed(env, CAP), 'm-coach'),
      coachMemberDoc({ memberId: 'm-coach', kind: 'coach', role: 'coach' })));
  });

  test('⭐ R133d 隊長「同意」第 16 位球員的申請也會被擋', async () => {
    // 成人組走邀請碼：家長申請是 pending，隊長按同意才算進名單。
    // 只擋教練直接新增、不擋同意的話，上限在成人組等於沒有
    await seedTeam({ playerCount: 15 });
    await seedMember({ memberId: 'm-p16', status: 'pending' });
    await assertFails(updateDoc(memberRef(authed(env, CAP), 'm-p16'),
      { status: 'approved', decidedAt: null, decidedBy: CAP }));
  });

  test('R133e 同意第 15 位可以', async () => {
    await seedTeam({ playerCount: 14 });
    await seedMember({ memberId: 'm-p15', status: 'pending' });
    await assertSucceeds(updateDoc(memberRef(authed(env, CAP), 'm-p15'),
      { status: 'approved', decidedAt: null, decidedBy: CAP }));
  });

  test('R133f 隊長婉拒不受上限影響（滿了還是可以退件）', async () => {
    await seedTeam({ playerCount: 15 });
    await seedMember({ memberId: 'm-p16', status: 'pending' });
    await assertSucceeds(updateDoc(memberRef(authed(env, CAP), 'm-p16'),
      { status: 'rejected', decidedAt: null, decidedBy: CAP }));
  });

  test('⭐ R133g 隊長建隊時不能自己帶一個 playerCount（那格只有 Function 寫）', async () => {
    await assertFails(setDoc(teamRef(authed(env, CAP), 't-cheat'),
      newTeamDoc({ teamId: 't-cheat', playerCount: -5 })));
    await assertSucceeds(setDoc(teamRef(authed(env, CAP), 't-ok'),
      newTeamDoc({ teamId: 't-ok', playerCount: 0 })));
  });
});

describe('R134 我的球員：collectionGroup(members) 只讀得到自己報的（docs/10 §1.3，M4-d）', () => {
  // 家長替兩個小孩報不同隊：t-new 的 m-1、t-2 的 m-2；t-2 還有別人家的 m-3
  async function seedTwoTeams() {
    await seedTeam();
    await seedMember();                                        // m-1，PARENT
    await asAdminSdk(env, async db => {
      await setDoc(teamRef(db, 't-2'), newTeamDoc({ teamId: 't-2', name: '第二隊', captainUid: 'u-cap2' }));
      await setDoc(memberRef(db, 'm-2', 't-2'), newMemberDoc({ memberId: 'm-2', name: '王小華', status: 'approved' }));
      await setDoc(memberRef(db, 'm-3', 't-2'), newMemberDoc({ memberId: 'm-3', name: '別人家的', guardianUid: 'u-other' }));
      await setDoc(memberRef(db, 'm-c', 't-2'), coachMemberDoc({ memberId: 'm-c' }));   // 教練填的，沒有 guardianUid
    });
  }
  const mine = (db, who) => query(collectionGroup(db, 'members'), where('guardianUid', '==', who));

  test('R134 ⭐ 家長跨球隊查得到自己報的兩筆，別人家的與教練填的不在裡面', async () => {
    await seedTwoTeams();
    const snap = await assertSucceeds(getDocs(mine(authed(env, PARENT), PARENT)));
    expect(snap.docs.map(d => d.id).sort()).toEqual(['m-1', 'm-2']);
  });

  test('R134b ⭐ 查別人的 guardianUid 整個查詢被擋（不是回空的）', async () => {
    await seedTwoTeams();
    await assertFails(getDocs(mine(authed(env, PARENT), 'u-other')));
  });

  test('R134c ⭐ 沒有帶 where guardianUid 整個查詢被擋', async () => {
    await seedTwoTeams();
    await assertFails(getDocs(collectionGroup(authed(env, PARENT), 'members')));
  });

  test('R134d 未登入不能查', async () => {
    await seedTwoTeams();
    await assertFails(getDocs(mine(guest(env), PARENT)));
  });

  test('R134e 賽務要看名單走球隊底下那條，不走這一條（這裡只認 guardianUid 是自己）', async () => {
    await seedTwoTeams();
    await assertFails(getDocs(mine(authed(env, 'u-scorer'), PARENT)));
    // 直接讀單一文件仍然可以（R63 的邊界沒有變）
    await assertSucceeds(getDoc(memberRef(authed(env, 'u-scorer'), 'm-1')));
  });
});

describe('R135 申訴登記（規章第二十條）：只有管理員讀寫，不可刪除', () => {
  const appealRef = (db, id = 'AO-G-A-01-t-new') => doc(db, 'events', EVENT, 'appeals', id);
  const appealDoc = {
    appealId: 'AO-G-A-01-t-new', matchId: 'AO-G-A-01', teamId: TEAM, opponentTeamId: 't-2',
    filedBy: { role: 'leader', name: '王領隊', phone: '0912345678' },
    deposit: 2000, depositPaid: true, withinWindow: true, late: false,
    reason: '第 60 分鐘進球越位', status: 'filed', decision: null, createdBy: 'u-admin'
  };
  test('R135 ⭐ 管理員登記與裁決', async () => {
    await assertSucceeds(setDoc(appealRef(authed(env, 'u-admin')), appealDoc));
    await assertSucceeds(updateDoc(appealRef(authed(env, 'u-admin')),
      { status: 'dismissed', decision: { upheld: false, note: '無越位', depositReturned: false } }));
    await assertSucceeds(getDoc(appealRef(authed(env, 'u-admin'))));
  });
  test('R135b ⭐ 隊長、賽務、路人都不能登記；賽務與路人也讀不到（有電話與事由）', async () => {
    await seedTeam();
    await assertFails(setDoc(appealRef(authed(env, CAP)), appealDoc));
    await assertFails(setDoc(appealRef(authed(env, 'u-scorer')), appealDoc));
    await assertFails(setDoc(appealRef(guest(env)), appealDoc));
    await asAdminSdk(env, db => setDoc(appealRef(db), appealDoc));
    await assertFails(getDoc(appealRef(authed(env, 'u-scorer'))));
    await assertFails(getDoc(appealRef(authed(env, CAP))));
    await assertFails(getDoc(appealRef(guest(env))));
  });
  test('R135c ⭐ 申訴紀錄不可刪除（連管理員也不行）', async () => {
    await asAdminSdk(env, db => setDoc(appealRef(db), appealDoc));
    await assertFails(deleteDoc(appealRef(authed(env, 'u-admin'))));
  });
});

describe('R136 取消報名與退費（規章第二十七條）', () => {
  test('R136 ⭐ 隊長可以在已核准（凍結）的球隊上申請取消，但不能自己把狀態改成 withdrawn', async () => {
    await seedTeam({ status: 'approved', rosterLocked: true });
    await assertSucceeds(updateDoc(teamRef(authed(env, CAP)),
      { cancelRequest: { reason: '球員受傷太多', byUid: CAP, status: 'requested', at: null }, updatedAt: null }));
    await assertFails(updateDoc(teamRef(authed(env, CAP)), { status: 'withdrawn', updatedAt: null }));
    // 凍結期間仍然不能順手改隊名
    await assertFails(updateDoc(teamRef(authed(env, CAP)),
      { cancelRequest: { reason: 'x', byUid: CAP, status: 'requested' }, name: '改名', updatedAt: null }));
  });
  test('R136b ⭐ 只有管理員能把球隊設成 withdrawn 並記退費', async () => {
    await seedTeam({ status: 'approved', rosterLocked: true,
      cancelRequest: { reason: 'x', byUid: CAP, status: 'requested' } });
    await assertFails(updateDoc(teamRef(authed(env, 'u-scorer')), { status: 'withdrawn' }));
    await assertSucceeds(updateDoc(teamRef(authed(env, 'u-admin')), {
      status: 'withdrawn',
      refund: { rule: 'before15', refundable: true, fee: 6000, suggested: 6000, amount: 6000, note: null, byUid: 'u-admin' },
      cancelRequest: { reason: 'x', byUid: CAP, status: 'processed' }
    }));
  });
});

describe('R137 抽獎聯絡方式（docs/06 §7.2）：只有管理員讀得到，只有 Function 寫得進去', () => {
  const contactRef = (db, id = 'FEDA-0001') => doc(db, 'events', EVENT, 'playerContacts', id);
  test('R137 ⭐ 管理員讀得到；攤位、路人讀不到', async () => {
    await asAdminSdk(env, db => setDoc(contactRef(db), { playerId: 'FEDA-0001', phone: '0912345678' }));
    await assertSucceeds(getDoc(contactRef(authed(env, 'u-admin'))));
    await assertFails(getDoc(contactRef(authed(env, 'u-booth'))));
    await assertFails(getDoc(contactRef(guest(env))));
  });
  test('R137b ⭐ 誰都寫不進去（連管理員），寫入只走 Function', async () => {
    await assertFails(setDoc(contactRef(authed(env, 'u-admin')), { playerId: 'FEDA-0001', phone: '0912345678' }));
    await assertFails(setDoc(contactRef(guest(env)), { playerId: 'FEDA-0001', phone: '0912345678' }));
  });
});

describe('R138 配戴眼鏡與切結書（規章附件二）', () => {
  test('R138 ⭐ 家長在申請被決定之前可以補「戴眼鏡＋已同意切結書」', async () => {
    await seedTeam();
    await seedMember();
    await assertSucceeds(updateDoc(memberRef(authed(env, PARENT), 'm-1'), {
      glasses: true, glassesWaiver: { signed: true, at: null, byUid: PARENT, by: 'guardian' }, updatedAt: null
    }));
    // 但仍然不能順手把自己改成 approved
    await assertFails(updateDoc(memberRef(authed(env, PARENT), 'm-1'), { glasses: true, status: 'approved' }));
  });
  test('R138b 教練可以在自己填的那一筆上記「戴眼鏡＋切結書已收到」', async () => {
    await seedTeam();
    await asAdminSdk(env, db => setDoc(memberRef(db, 'm-c1'), coachMemberDoc()));
    await assertSucceeds(updateDoc(memberRef(authed(env, CAP), 'm-c1'), {
      glasses: true, glassesWaiver: { signed: true, at: null, byUid: CAP, by: 'teamLead' }, updatedAt: null
    }));
  });
});

describe('R139 Game Pass 帶聯絡憑證雜湊', () => {
  const playerRef = (db, id) => doc(db, 'events', EVENT, 'players', id);
  const pass = (over = {}) => ({
    playerId: 'FEDA-0900', eventId: EVENT, nickname: '測', avatarSeed: '0900', ageBand: null,
    qrCode: null, linkedTeamId: null, contact: { phone: null, lineUserId: null },
    completedChallengeIds: [], luckyDrawEntries: 0, createdVia: 'self', ...over
  });
  test('R139 ⭐ 攤位代建的卡可以帶 contactKeyHash；帶了電話本身就擋（玩家自建已改由 Function 配發）', async () => {
    await assertSucceeds(setDoc(playerRef(authed(env, 'u-booth'), 'FEDA-0900'), pass({ contactKeyHash: 'ab'.repeat(32), createdVia: 'staff' })));
    await assertFails(setDoc(playerRef(authed(env, 'u-booth'), 'FEDA-0901'), pass({ playerId: 'FEDA-0901', phone: '0912345678', createdVia: 'staff' })));
  });
  test('R139b 建立之後 contactKeyHash 改不動（換憑證等於搶走這張卡的聯絡權）', async () => {
    await asAdminSdk(env, db => setDoc(playerRef(db, 'FEDA-0902'), pass({ playerId: 'FEDA-0902', contactKeyHash: 'a'.repeat(64) })));
    await assertFails(updateDoc(playerRef(guest(env), 'FEDA-0902'), { contactKeyHash: 'b'.repeat(64) }));
  });
});
