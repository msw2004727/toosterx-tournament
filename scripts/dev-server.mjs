#!/usr/bin/env node
/**
 * E2E 用的靜態檔案伺服器
 * ------------------------------------------------------------------
 * 原本用 `python3 -m http.server`。它是多執行緒的，但在 Windows 上
 * 每個連線開一條執行緒，套件長到四百多條之後（3 個 worker × 每頁
 * 二三十個模組請求）會開始出現 `WinError 10053`（連線被中止），
 * 表現成隨機一條測試在 `waitForFunction(() => !!window.__fake)` 逾時。
 *
 * 偶發紅燈比慢一點危險得多——久了大家會開始無視 CI。所以換成自己的一支：
 *   ・Node 的 http 是事件驅動，不會為每個連線開執行緒
 *   ・keep-alive 由我們控制
 *   ・不增加任何相依（Node 本來就要有）
 *
 * 只服務專案根目錄底下的靜態檔，不做任何建置——這個站沒有建置步驟。
 *
 *   node scripts/dev-server.mjs [port]
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const server = createServer((req, res) => {
  // 查詢字串要丟掉：模組網址帶著 ?v=版號（R-REL-016）
  const raw = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = normalize(raw).replace(/^([/\\])+/, '');

  // 目錄跳脫：normalize 之後仍以 .. 開頭就是想往上跑
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  const path = join(ROOT, rel === '' ? 'index.html' : rel);
  let stat;
  try {
    stat = statSync(path);
  } catch {
    // 這個站是 hash 路由，實體檔案找不到就回 index.html——
    // 跟 Cloudflare Pages 的 SPA fallback 一致，才測得到真實行為
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    createReadStream(join(ROOT, 'index.html')).pipe(res);
    return;
  }
  if (stat.isDirectory()) {
    res.writeHead(302, { Location: raw.endsWith('/') ? `${raw}index.html` : `${raw}/` }).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME[extname(path).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    // 測試永遠要拿到最新的檔案，不然改完程式跑到的是舊版
    'Cache-Control': 'no-store'
  });
  createReadStream(path).pipe(res);
});

// 預設 5 秒對「一頁二三十個模組」太短，連線會被反覆重建
server.keepAliveTimeout = 30_000;
server.headersTimeout = 35_000;

server.listen(PORT, '127.0.0.1', () => {
  console.log(`static server on http://127.0.0.1:${PORT} (root: ${ROOT})`);
});
