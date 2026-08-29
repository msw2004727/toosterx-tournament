/**
 * firestore.rules 測試共用工具
 * ------------------------------------------------------------------
 * 規格：docs/07-權限安全與CloudFunctions.md §2.4（R01–R23）
 *
 * 執行：npm run test:rules（會自動起 Firestore Emulator）
 */
import fs from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp, setLogLevel } from 'firebase/firestore';

// assertFails 的案例一定會噴 PERMISSION_DENIED 警告，關掉才看得見真正的失敗
setLogLevel('silent');

export const EVENT = 'feda-cup-2026';
export const MATCH = 'AO-G-A-01';
export const MATCH_B = 'AO-G-B-01';
export const CHALLENGE = 'g03-crossbar';

export async function makeEnv() {
  return initializeTestEnvironment({
    projectId: 'demo-rules-test',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: fs.readFileSync('firestore.rules', 'utf8')
    }
  });
}

/** 各種身分的 staff 文件 */
const STAFF = {
  'u-scorer':  { roles: ['scorer'],     venueIds: ['venue-a'], challengeIds: [] },
  'u-scorer-b':{ roles: ['scorer'],     venueIds: ['venue-b'], challengeIds: [] },
  'u-referee': { roles: ['referee'],    venueIds: ['venue-a'], challengeIds: [] },
  'u-lead':    { roles: ['venue_lead'], venueIds: ['venue-a'], challengeIds: [] },
  'u-admin':   { roles: ['admin'],      venueIds: [],          challengeIds: [] },
  'u-booth':   { roles: ['booth'],      venueIds: [],          challengeIds: [CHALLENGE] },
  'u-booth-x': { roles: ['booth'],      venueIds: [],          challengeIds: ['g01-nine-grid'] },
  'u-suspended': { roles: ['scorer'],   venueIds: ['venue-a'], challengeIds: [], inactive: true }
};

/** 建立測試基準資料（繞過 rules） */
export async function seedBaseline(env) {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();

    for (const [uid, s] of Object.entries(STAFF)) {
      await setDoc(doc(db, 'staff', uid), {
        uid, name: uid, roles: s.roles,
        assignment: { eventId: EVENT, venueIds: s.venueIds, divisionIds: [], challengeIds: s.challengeIds },
        active: s.inactive ? false : true
      });
    }

    await setDoc(doc(db, 'rolePermissions', 'scorer'), { perms: { 'match.score.write': true } });
    await setDoc(doc(db, 'events', EVENT), { eventId: EVENT, name: 'FEDA CUP 2026' });

    await setDoc(doc(db, 'events', EVENT, 'teams', 't-101'), { teamId: 't-101', name: '臺中野狼' });
    await setDoc(doc(db, 'events', EVENT, 'teams', 't-101', 'members', 'm-101-07'), {
      memberId: 'm-101-07', name: '王小明', birthDate: '1996-03-14', idLast4: '1234'
    });
    await setDoc(doc(db, 'events', EVENT, 'teams', 't-101', 'roster', 'm-101-07'), {
      memberId: 'm-101-07', displayName: '王小明', jerseyNo: 7
    });

    for (const [id, venueId] of [[MATCH, 'venue-a'], [MATCH_B, 'venue-b']]) {
      await setDoc(doc(db, 'events', EVENT, 'matches', id), baseMatch(id, venueId));
    }

    await setDoc(doc(db, 'events', EVENT, 'challenges', CHALLENGE), {
      challengeId: CHALLENGE, name: 'Ronaldinho 橫樑挑戰',
      scoreType: 'count', minValue: 0, maxValue: 5, rankingRule: 'higher'
    });

    await setDoc(doc(db, 'events', EVENT, 'attempts', 'a-fresh'), {
      attemptId: 'a-fresh', challengeId: CHALLENGE, playerId: 'FEDA-0001',
      rawValue: 3, staffUid: 'u-booth', voided: false,
      createdAt: Timestamp.now()
    });
    await setDoc(doc(db, 'events', EVENT, 'attempts', 'a-old'), {
      attemptId: 'a-old', challengeId: CHALLENGE, playerId: 'FEDA-0002',
      rawValue: 2, staffUid: 'u-booth', voided: false,
      createdAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000)   // 11 分鐘前
    });

    await setDoc(doc(db, 'events', EVENT, 'leaderboards', CHALLENGE), { challengeId: CHALLENGE, rows: [] });
    await setDoc(doc(db, 'events', EVENT, 'audits', 'audit-1'), {
      entity: 'match', entityId: MATCH, action: 'score.update',
      actor: { uid: 'u-admin', name: '示範管理員' }
    });
  });
}

export function baseMatch(matchId, venueId = 'venue-a', over = {}) {
  return {
    matchId, eventId: EVENT, divisionId: 'adult-open', stageId: 'group', groupId: 'A',
    venueId, date: '2026-10-11',
    home: { teamId: 't-101', name: '臺中野狼' },
    away: { teamId: 't-102', name: '臺中猛虎' },
    teamIds: ['t-101', 't-102'],
    score: { home: 0, away: 0 },
    status: 'live',
    lock: { locked: false, lockedAt: null, lockedBy: null },
    updatedBy: 'u-admin',
    ...over
  };
}

/** 直接改資料庫狀態（繞過 rules），供個別案例佈置前置條件 */
export async function asAdminSdk(env, fn) {
  await env.withSecurityRulesDisabled(async ctx => fn(ctx.firestore()));
}

export const authed = (env, uid) => env.authenticatedContext(uid).firestore();
export const guest = env => env.unauthenticatedContext().firestore();
