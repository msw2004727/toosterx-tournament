const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const LOCK = '.mutation-in-progress.json';
function writeSource(file, bytes) {
  const temporary = `${file}.mutation-${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: fs.existsSync(file) ? fs.statSync(file).mode : 0o666 });
    const deadline = Date.now() + 3000;
    for (;;) {
      try { fs.renameSync(temporary, file); break; }
      catch (e) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || Date.now() >= deadline) throw e;
        // Windows 的檔案監看器可能暫時持有讀取 handle；不退回截斷寫入。
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function createSession(files, cwd = process.cwd()) {
  const lockPath = path.join(cwd, LOCK);
  const token = randomUUID();
  for (const file of files) {
    const relative = path.relative(cwd, path.resolve(cwd, file));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Mutation target must stay inside the checkout');
  }
  // Exclusive creation also protects the race between checking and opening.
  const fd = fs.openSync(lockPath, 'wx');
  const backups = new Map();
  try {
    for (const file of new Set(files)) {
      const original = fs.readFileSync(path.resolve(cwd, file));
      if (original.includes(Buffer.from('\r\n'))) throw new Error(`${file}: CRLF; normalize to LF without discarding local edits`);
      backups.set(file, original);
    }
    fs.writeFileSync(fd, JSON.stringify({ version: 2, pid: process.pid, token,
      startedAt: new Date().toISOString(),
      files: Object.fromEntries([...backups].map(([f, b]) => [f, b.toString('base64')])) }));
  } catch (err) {
    fs.closeSync(fd); fs.unlinkSync(lockPath); throw err;
  }
  fs.closeSync(fd);
  let restored = false;
  function restore() {
    if (restored) return;
    // Leave the backup lock in place if even one restore fails.
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (lock.token !== token) throw new Error('Mutation lock ownership changed; refusing to remove it');
    for (const [file, bytes] of backups) writeSource(path.resolve(cwd, file), bytes);
    fs.unlinkSync(lockPath);
    restored = true;
  }
  const exitHandler = () => { try { restore(); } catch (e) { console.error(e.message); } };
  process.on('exit', exitHandler);
  return { backups, token, restore, env: { FEDA_MUTATION_RUN: '1', FEDA_MUTATION_TOKEN: token },
    dispose() { restore(); process.removeListener('exit', exitHandler); } };
}

function anchorLocation(original, mutant) {
  if (!mutant.from || mutant.from === mutant.to) throw new Error(`${mutant.id || mutant.name}: empty/no-op anchor`);
  const positions = [];
  for (let i = original.indexOf(mutant.from); i >= 0; i = original.indexOf(mutant.from, i + 1)) positions.push(i);
  if (!positions.length) throw new Error('anchor_missing');
  if (positions.length !== (mutant.anchorCount || 1)) throw new Error(`anchor_ambiguous: expected ${mutant.anchorCount || 1}, found ${positions.length}`);
  const occurrence = mutant.occurrence ?? 0;
  if (!Number.isInteger(occurrence) || occurrence < 0 || occurrence >= positions.length) throw new Error('anchor_occurrence_invalid');
  return positions[occurrence];
}
module.exports = { LOCK, createSession, anchorLocation, writeSource };
