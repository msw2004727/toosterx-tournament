#!/usr/bin/env node
/**
 * 版號遞增｜格式 0.YYYYMMDD{suffix}（台北時間）
 * ------------------------------------------------------------------
 * 同步四處：
 *   1. js/config.js   #CACHE_VERSION
 *   2. sw.js          #CACHE_NAME
 *   3. index.html     window.__APP_VERSION__
 *   4. index.html     asset query 版號（?v=）
 *   5. package.json   version（純粹避免 npm 顯示舊版造成誤判）
 *   6. manifest.json  圖示網址的 ?v=
 *
 * 為什麼連圖示都要帶版號：Cloudflare Pages 對不存在的路徑回 200 + index.html，
 * 邊緣一旦把那份 HTML 存成 /img/icon-192.png 的答案就會卡很久
 * （2026-09-03 實地發生）。換一個查詢字串就是換一個快取鍵，立刻繞開。
 *
 * 用法：
 *   node scripts/bump-version.js          遞增
 *   node scripts/bump-version.js --check  只檢查四處是否一致（CI 用）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const FILES = { config: 'js/config.js', sw: 'sw.js', html: 'index.html', pkg: 'package.json', manifest: 'manifest.json' };
const read  = f => readFileSync(f, 'utf8');
const write = (f, s) => writeFileSync(f, s, 'utf8');

function offlineModules(dir = 'js') {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = `${dir}/${entry.name}`;
    if (path === 'js/modules/demo') return [];
    return entry.isDirectory() ? offlineModules(path) : entry.name.endsWith('.js') ? [`/${path}`] : [];
  }).sort();
}
const moduleDeclaration = () => `const OFFLINE_MODULES = ${JSON.stringify(offlineModules(), null, 2)};`;

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).replaceAll('-', '');

const currentOf = {
  config: () => read(FILES.config).match(/CACHE_VERSION\s*=\s*'([^']+)'/)?.[1],
  sw:     () => read(FILES.sw).match(/CACHE_NAME\s*=\s*'feda-cup-([^']+)'/)?.[1],
  html:   () => read(FILES.html).match(/__APP_VERSION__\s*=\s*'([^']+)'/)?.[1],
  pkg:    () => JSON.parse(read(FILES.pkg)).version
};

function check() {
  if (!read(FILES.sw).includes(moduleDeclaration())) {
    console.error('❌ 離線模組清單不同步，請執行 bump-version.js');
    process.exit(1);
  }
  const v = Object.entries(currentOf).map(([k, fn]) => [k, fn()]);
  const set = new Set(v.map(([, x]) => x));
  const queryVersions = new Set([
    ...read(FILES.html).matchAll(/\?v=([0-9.a-z]+)/g),
    ...read(FILES.manifest).matchAll(/\?v=([0-9.a-z]+)/g)
  ].map(m => m[1]));
  if (set.size !== 1 || queryVersions.size !== 1 || !set.has([...queryVersions][0])) {
    console.error('❌ 版號不一致：', Object.fromEntries(v), '｜asset query:', [...queryVersions]);
    process.exit(1);
  }
  console.log('✅ 版號一致：', [...set][0]);
}

function next(cur) {
  const d = today();
  if (!cur?.startsWith(`0.${d}`)) return `0.${d}`;
  const suffix = cur.slice(`0.${d}`.length);
  if (!suffix) return `0.${d}a`;
  const c = suffix.charCodeAt(0);
  if (c >= 122) throw new Error('同一天已用到 z，請隔日再 bump');
  return `0.${d}${String.fromCharCode(c + 1)}`;
}

if (process.argv.includes('--check')) { check(); process.exit(0); }

const cur = currentOf.config();
const ver = next(cur);

write(FILES.config, read(FILES.config).replace(/CACHE_VERSION\s*=\s*'[^']+'/, `CACHE_VERSION = '${ver}'`));
write(FILES.sw,     read(FILES.sw).replace(/CACHE_NAME\s*=\s*'feda-cup-[^']+'/, `CACHE_NAME = 'feda-cup-${ver}'`)
  .replace(/const OFFLINE_MODULES = \[[\s\S]*?\];/, moduleDeclaration()));
write(FILES.html,   read(FILES.html)
  .replace(/__APP_VERSION__\s*=\s*'[^']+'/, `__APP_VERSION__ = '${ver}'`)
  .replace(/\?v=[0-9.a-z]+/g, `?v=${ver}`));
write(FILES.pkg,    read(FILES.pkg).replace(/("version":\s*")[^"]+(")/, `$1${ver}$2`));
if (existsSync('package-lock.json')) {
  const lock = JSON.parse(read('package-lock.json'));
  lock.version = ver;
  if (lock.packages?.['']) lock.packages[''].version = ver;
  write('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
}
write(FILES.manifest, read(FILES.manifest).replace(/\?v=[0-9.a-z]+/g, `?v=${ver}`));

console.log(`✅ ${cur} → ${ver}`);
