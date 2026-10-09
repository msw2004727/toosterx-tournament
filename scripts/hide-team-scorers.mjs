#!/usr/bin/env node
/** 球隊退出公開射手榜；預設唯讀，--apply 才備份、交易更新並留稽核。 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { EVENT_ID } from '../js/config.js';

// 必須與 functions/admin.js 使用同一份 SDK，避免跨套件實例的 FieldValue 無法序列化。
const { FieldValue } = createRequire(new URL('../functions/admin.js', import.meta.url))('firebase-admin/firestore');

const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const env = option('env'), teamId = option('team'), expectedName = option('expect-name');
assert(['demo', 'prod'].includes(env), '請指定 --env=demo 或 --env=prod');
assert(teamId && !teamId.includes('/') && expectedName, '請指定 --team 與 --expect-name');
assert(!process.env.FIRESTORE_EMULATOR_HOST, '雲端維護不可連模擬器');
process.env.GCLOUD_PROJECT = env === 'prod' ? 'feda-cup-2026' : 'feda-cup-demo';
const { db } = await import('../functions/admin.js');
const database = db();
database.settings({ preferRest: true });
const base = database.doc(`events/${EVENT_ID}`);
const teamRef = base.collection('teams').doc(teamId), boardRef = base.collection('boards').doc('scorers');
const [team, board] = await database.getAll(teamRef, boardRef);
assert(team.exists && team.data().name === expectedName, '球隊不存在或名称不符');
const rows = board.data()?.rows ?? [];
const summary = { env, project: database.projectId, eventId: EVENT_ID, teamId, teamName: expectedName,
  displayBefore: team.data().display?.scorerBoard ?? null, removedRows: rows.filter(r => r.teamId === teamId).length,
  retainedRows: rows.filter(r => r.teamId !== teamId).length };
console.log(JSON.stringify(summary));
if (!process.argv.includes('--apply')) process.exit(0);

// 驗證原始比分與事件未被維護動作改寫；只輸出雜湊，不印球員資料。
async function sourceDigest() {
  const matches = await base.collection('matches').where('divisionId', '==', team.data().divisionId).get();
  const sources = [];
  for (const m of matches.docs.filter(d => [d.data().home?.teamId, d.data().away?.teamId].includes(teamId))) {
    const timeline = await m.ref.collection('timeline').get();
    sources.push({ path: m.ref.path, match: m.data(), timeline: timeline.docs.map(d => ({ id: d.id, ...d.data() })) });
  }
  return createHash('sha256').update(JSON.stringify(sources)).digest('hex');
}
const sourceBefore = await sourceDigest();
const directory = resolve('tools', 'backups');
await mkdir(directory, { recursive: true });
const backup = resolve(directory, `team-scorers-${env}-${Date.now()}.json`);
await writeFile(backup, JSON.stringify({ summary, sourceBefore, before: [team, board].map(s => ({ path: s.ref.path, data: s.data() ?? null })) }, null, 2), { flag: 'wx' });
await database.runTransaction(async tx => {
  const [currentTeam, currentBoard] = await Promise.all([tx.get(teamRef), tx.get(boardRef)]);
  assert(currentTeam.exists && currentTeam.data().name === expectedName);
  const oldRows = currentBoard.data()?.rows ?? [], kept = oldRows.filter(r => r.teamId !== teamId);
  const stamp = FieldValue.serverTimestamp();
  const actor = { uid: null, name: '射手榜維護', source: 'maintenance' };
  const reason = '主辦指定此隊全體球員不顯示於射手榜，保留原始進球事件與比分';
  if (currentTeam.data().display?.scorerBoard !== false) {
    tx.update(teamRef, { 'display.scorerBoard': false, updatedAt: stamp });
    tx.create(base.collection('audits').doc(), { entity: 'team', entityId: teamId,
      action: 'team.scorerBoard.hide', actor, reason,
      before: { scorerBoard: currentTeam.data().display?.scorerBoard ?? null }, after: { scorerBoard: false }, createdAt: stamp });
  }
  if (currentBoard.exists && kept.length !== oldRows.length) {
    tx.update(boardRef, { rows: kept, updatedAt: stamp });
    tx.create(base.collection('audits').doc(), { entity: 'board', entityId: 'scorers',
      action: 'scorers.removeHiddenTeam', actor, reason,
      before: { rows: oldRows.length }, after: { rows: kept.length, excludedTeamId: teamId }, createdAt: stamp });
  }
});
const [updatedTeam, updatedBoard] = await database.getAll(teamRef, boardRef);
assert.equal(updatedTeam.data().display.scorerBoard, false);
assert(!(updatedBoard.data()?.rows ?? []).some(r => r.teamId === teamId));
const sourceAfter = await sourceDigest();
assert.equal(sourceAfter, sourceBefore, '原始比賽資料已變動，請核對是否為同時進行的賽務更新');
console.log(JSON.stringify({ ...summary, backup, sourceUnchanged: true, verified: true }));
