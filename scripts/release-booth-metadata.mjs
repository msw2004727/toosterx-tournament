#!/usr/bin/env node
/** Narrow, audited display metadata update. Never seed/reset or change scoring/rewards/staff. */
import { CHALLENGES, EVENT_ID } from './seed/build.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

async function main() {
  const args = process.argv.slice(2);
  const val = flag => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : null; };
  const project = val('--project'), apply = args.includes('--apply');
  if (!['feda-cup-demo', 'feda-cup-2026'].includes(project) || (!apply && !args.includes('--dry-run'))
    || process.env.FIRESTORE_EMULATOR_HOST) throw Error('PROJECT_OR_MODE_GUARD');
  process.env.GCLOUD_PROJECT = project;
  const { db } = await import('../functions/admin.js');
  const { updateChallengeMetadata } = await import('../functions/challenge-release.js');
  const updates = CHALLENGES.map(c => ({ challengeId: c.challengeId, patch: Object.fromEntries(
    (c.inputMode === 'checkin' ? ['summary', 'name', 'shortName', 'boothLocation', 'description', 'rulesText'] : ['summary'])
      .map(key => [key, c[key]])) }));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const snapshots = await Promise.all(updates.map(u => db().doc(`events/${EVENT_ID}/challenges/${u.challengeId}`).get()));
  if (snapshots.some(s => !s.exists)) throw Error('MISSING_CHALLENGE');
  const expectedUpdateTimes = Object.fromEntries(snapshots.map(s => [s.id, s.updateTime.toDate().toISOString()]));
  const requestHash = createHash('sha256').update(JSON.stringify(updates)).digest('hex');
  const plan = { project, head, eventId: EVENT_ID, releaseId: 'booth-sop-v1-20261001', requestHash, expectedUpdateTimes, updates,
    before: snapshots.map(s => ({ challengeId: s.id, data: s.data() })), keepsScoringRewardsAttemptsPlayersAndStaff: true };
  if (!apply) {
    if (!val('--output')) throw Error('BACKUP_PATH_REQUIRED');
    writeFileSync(val('--output'), JSON.stringify(plan, null, 2) + '\n');
    console.log(JSON.stringify({ project, head, requestHash, fields: updates.map(u => ({ id: u.challengeId, fields: Object.keys(u.patch) })) }));
    return;
  }
  if (val('--expected-head') !== head || execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw Error('CLEAN_VERIFIED_SOURCE_REQUIRED');
  const checked = JSON.parse(readFileSync(val('--plan'), 'utf8'));
  if (checked.project !== project || checked.head !== head || checked.requestHash !== requestHash || checked.eventId !== EVENT_ID) throw Error('PLAN_MISMATCH');
  const result = await updateChallengeMetadata({ eventId: EVENT_ID, updates, expectedUpdateTimes: checked.expectedUpdateTimes,
    releaseId: checked.releaseId, reason: '主辦指定七項皆顯示玩法簡介，中醫看診改名為中醫問診，保留原項目代碼及所有成績。' });
  console.log(JSON.stringify({ project, head, success: true, ...result }));
}
await main().catch(e => { console.error(String(e.message).replace(/ya29\.[\w.-]+/g, '[REDACTED]').replace(/1\/\/[^\s"']+/g, '[REDACTED]')); process.exitCode = 1; });
