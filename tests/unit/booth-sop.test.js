import { validateAssignment, buildStaffDoc, mergeDirectory } from '../../js/engine/assign.js';
import { luckyDrawRows } from '../../js/engine/csv.js';
import { CHALLENGES, buildSeed } from '../../scripts/seed/build.js';
import decode from '../../js/lib/vendor/jsqr.js';
import { qrMatrix } from '../../js/lib/qr-render.js';

const ids = CHALLENGES.map(c => c.challengeId);
const rewards = buildSeed().docs.find(d => d.path === 'config/challengeRewards').data;
test('七項均有簡介，中醫運動恢復站保持原 ID 與簽到政策', () => {
  expect(CHALLENGES).toHaveLength(7);
  for (const c of CHALLENGES) expect(c.summary.length).toBeGreaterThan(8);
  expect(CHALLENGES[5]).toMatchObject({ challengeId: 'g06-medical-checkin', name: '中醫運動恢復站', inputMode: 'checkin', leaderboardEnabled: false });
});
test('攤位指派必須選關卡且只允許有效的不重複 ID', () => {
  const base = { uid: 'worker', role: 'booth', knownChallengeIds: ids };
  expect(validateAssignment(base).code).toBe('NO_CHALLENGE');
  for (const challengeIds of [null, 'bad', [null], [ids[0], ids[0]]])
    expect(validateAssignment({ ...base, challengeIds }).code).toBe('INVALID_CHALLENGES');
  expect(validateAssignment({ ...base, challengeIds: ['removed'] }).code).toBe('UNKNOWN_CHALLENGE');
  expect(validateAssignment({ ...base, challengeIds: ids.slice(5) }).ok).toBe(true);
});
test('已指派攤位的存檔、重新編輯與升級賽務身分不會清掉關卡', () => {
  for (const role of ['booth', 'checkin', 'referee', 'scorer']) {
    const selected = ids.slice(5);
    const doc = buildStaffDoc({ uid: 'worker', role, eventId: 'event', challengeIds: selected });
    selected.length = 0;
    expect(doc.assignment.challengeIds).toEqual(ids.slice(5));
    expect(mergeDirectory([], [doc])[0].challengeIds).toEqual(ids.slice(5));
  }
  expect(buildStaffDoc({ uid: 'manager', role: 'admin', challengeIds: ids }).assignment.challengeIds).toEqual([]);
});
test('七項 CSV 只收版本有效且全部完成的每人一張；不接受缺章、舊版或異常張數', () => {
  const p = { playerId: 'eligible', completedChallengeIds: ids, luckyDrawEntries: 1, luckyDrawRuleVersion: rewards.version };
  const people = [p, { ...p, playerId: 'six', completedChallengeIds: ids.slice(0, 6) },
    { ...p, playerId: 'duplicate', completedChallengeIds: [...ids.slice(0, 6), ids[0]] },
    { ...p, playerId: 'old', luckyDrawRuleVersion: 'old' }, { ...p, playerId: 'excess', luckyDrawEntries: 7 },
    { ...p, playerId: 'pending', luckyDrawEntries: 0 }];
  expect(luckyDrawRows(people, { rewards }).map(r => [r.playerId, r.entries])).toEqual([['eligible', 1]]);
});
test('jsQR 備援能辨識實際產生的挑戰卡 QR 像素', () => {
  const text = 'https://cup.toosterx.com/#/booth?id=FEDA-0182';
  const { modules, size } = qrMatrix(text);
  const scale = 6, width = (size + 8) * scale, pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) {
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const at = (((y + 4) * scale + dy) * width + (x + 4) * scale + dx) * 4;
      pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
    }
  }
  expect(decode(pixels, width, width)?.data).toBe(text);
});
