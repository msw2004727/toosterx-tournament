#!/usr/bin/env node
/** 限定七項挑戰的設定發布：先 --dry-run，確認備份後 --apply。禁用 seed/reset。 */
import { buildSeed, CHALLENGES, EVENT_ID } from './seed/build.js';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

async function main() {
const args = process.argv.slice(2);
const val = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const project = val('--project'), apply = args.includes('--apply');
if (!['feda-cup-demo', 'feda-cup-2026'].includes(project) || (!apply && !args.includes('--dry-run'))) throw Error('必須指定已授權專案與 --dry-run 或 --apply');
if (process.env.FIRESTORE_EMULATOR_HOST) throw Error('雲端發布不能連到模擬器');
process.env.GCLOUD_PROJECT = project;
const { db } = await import('../functions/admin.js');
const { installChallengeRelease, refreshChallengeQualification } = await import('../functions/challenge-release.js');
const rewards = buildSeed().docs.find(d => d.path === 'config/challengeRewards').data;
const challenges = CHALLENGES.slice(5).map(c => ({ attemptPolicy: { maxAttemptsPerPlayer: 3, allowRepeat: true, rankBy: 'best' }, ...c }));
const config = await db().doc('config/challengeRewards').get();
const players = await db().collection(`events/${EVENT_ID}/players`).get();
const time = config.updateTime?.toDate().toISOString() ?? null;
const plan = { project, eventId: EVENT_ID, version: rewards.version, mode: apply ? 'apply' : 'dry-run',
  rewardsUpdateTime: time, newChallengeIds: challenges.map(c => c.challengeId), playersToRecalculate: players.size,
  rules: rewards, keepsAllAttemptsAndCompletionRecords: true };
if (val('--output')) writeFileSync(val('--output'), JSON.stringify(plan, null, 2) + '\n');
console.log(JSON.stringify(plan));
if (apply) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!val('--expected-head') || val('--expected-head') !== head || execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw Error('必須從指定且乾淨的已驗證提交發布');
  const reason = '主辦 2026-10-01 指定新增中醫看診與一球三桶，七項全部完成才有一次抽獎機會。';
  const expected = val('--expected-rewards-update-time');
  if (!expected) throw Error('必須指定 dry-run 確認過的抽獎設定更新時間');
  await installChallengeRelease({ eventId: EVENT_ID, challenges, rewards, reason, expectedRewardsUpdateTime: expected === 'null' ? null : expected });
  let changed = 0;
  for (const p of players.docs) {
    const result = await refreshChallengeQualification({ eventId: EVENT_ID, playerId: p.id, version: rewards.version, reason });
    if (result.changed) changed++;
  }
  console.log(JSON.stringify({ success: true, project, head, version: rewards.version, playersRecalculated: changed }));
}
}
await main().catch(err => { console.error(String(err.message).replace(/ya29\.[\w.-]+/g, '[REDACTED]')
  .replace(/1\/\/[^\s"']+/g, '[REDACTED]')); process.exitCode = 1; });
