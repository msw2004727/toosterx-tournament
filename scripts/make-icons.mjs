/**
 * 產生 PWA 圖示
 * ------------------------------------------------------------------
 * 為什麼要有這支：`manifest.json` 指到 /img/icon-192.png 等三個檔，
 * 檔案不存在的話 Chrome 不會給「安裝」選項，而且**不會報錯**——
 * 只是安裝鈕永遠不出現，看起來像 PWA 沒做。
 *
 * 為什麼不放二進位檔進版控、也不裝繪圖套件：
 *   ・PNG 進 git 之後改一次色就是一次二進位 diff，看不出改了什麼
 *   ・sharp / canvas 都要編譯原生模組，CI 與新設備會多一個壞掉的理由
 * 這支只用 Node 內建的 zlib，把像素自己壓成 PNG，執行不用網路。
 *
 *   node scripts/make-icons.mjs          產生
 *   node scripts/make-icons.mjs --check  檢查現有檔案是不是最新（CI 用）
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'img');

/** 品牌色。與 manifest.json 的 theme_color、tokens.css 的 --brand 同一個值。 */
const BG = [0x0b, 0x2e, 0x20];
const FG = [0xff, 0xff, 0xff];

// ── PNG 編碼 ────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** @param {Uint8Array} rgba 長度必須是 size*size*4 */
function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // colour type: RGBA
  // 10–12 = compression / filter / interlace，全部 0

  // 每一列前面要加一個 filter byte。一律用 0（None）：
  // 圖是大色塊，用不用 filter 差不到幾 KB，但 None 讓這支程式簡單到不會錯。
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── 幾何 ────────────────────────────────────────────────────

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** 點到線段的距離（畫縫線用） */
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return dist(px, py, ax + t * dx, ay + t * dy);
}

function insidePolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 圓角方形：角落用圓形補，其餘直接判邊界 */
function insideRoundRect(px, py, size, r) {
  const x = Math.min(px, size - px), y = Math.min(py, size - py);
  if (x >= r || y >= r) return px >= 0 && py >= 0 && px <= size && py <= size;
  return dist(x, y, r, r) <= r;
}

/**
 * 畫一顆足球。
 * maskable 的安全區是中央 80% 的圓，所以那一版要畫小一點，
 * 不然 Android 把四角切掉時會削到球。
 */
function render(size, { maskable }) {
  const rgba = new Uint8Array(size * size * 4);
  const c = size / 2;
  const R = size * (maskable ? 0.28 : 0.345);   // 球半徑
  const corner = size * 0.22;                   // 底板圓角
  const penR = R * 0.56;                        // 中央五角形外接圓（比照 icons.js 的 goal 圖示比例）
  const seam = R * 0.085;                       // 縫線粗細（太粗、五角形太小就會變成輪框）
  const SS = 3;                                 // 每個像素取 3×3 子樣本做抗鋸齒

  // 五角形（尖端朝上）
  const pent = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    pent.push([c + penR * Math.cos(a), c + penR * Math.sin(a)]);
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;

          // 底板：maskable 要滿版（Android 自己會遮），一般版走圓角
          const onPlate = maskable ? true : insideRoundRect(px, py, size, corner);
          if (!onPlate) continue;

          let col = BG;
          if (dist(px, py, c, c) <= R) {
            col = FG;                                   // 球體：白
            if (insidePolygon(px, py, pent)) col = BG;   // 中央五角形：綠
            else {
              // 五條縫線：從五角形每個頂點往外拉到球緣
              for (const [vx, vy] of pent) {
                const ux = (vx - c) / penR, uy = (vy - c) / penR;
                // 縫線收在球緣內側一點，讓白色球體保持一圈完整的輪廓
                if (distToSeg(px, py, vx, vy, c + ux * R * 0.94, c + uy * R * 0.94) <= seam) { col = BG; break; }
              }
            }
          }
          rSum += col[0]; gSum += col[1]; bSum += col[2]; aSum += 255;
        }
      }

      const n = SS * SS;
      const i = (y * size + x) * 4;
      // 邊緣的半透明像素要用 premultiply 的反運算，不然圓角外圈會發黑
      const a = aSum / n;
      rgba[i]     = a === 0 ? 0 : Math.round(rSum / (aSum / 255));
      rgba[i + 1] = a === 0 ? 0 : Math.round(gSum / (aSum / 255));
      rgba[i + 2] = a === 0 ? 0 : Math.round(bSum / (aSum / 255));
      rgba[i + 3] = Math.round(a);
    }
  }
  return encodePNG(size, rgba);
}

// ── 產出 ────────────────────────────────────────────────────

/** 檔名 → 產生器。改這裡的話 manifest.json 與 sw.js 的清單也要一起改。 */
const FILES = {
  'icon-192.png':      () => render(192, { maskable: false }),
  'icon-512.png':      () => render(512, { maskable: false }),
  'icon-maskable.png': () => render(512, { maskable: true }),
  'apple-touch-icon.png': () => render(180, { maskable: false })   // iOS 不看 manifest
};

const check = process.argv.includes('--check');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

let bad = 0;
for (const [name, make] of Object.entries(FILES)) {
  const path = join(OUT, name);
  const buf = make();
  if (check) {
    const same = existsSync(path) && readFileSync(path).equals(buf);
    if (!same) { bad++; console.error(`✗ img/${name} 與 scripts/make-icons.mjs 的輸出不一致`); }
  } else {
    writeFileSync(path, buf);
    console.log(`✓ img/${name}  ${(buf.length / 1024).toFixed(1)} KB`);
  }
}

if (check) {
  if (bad) {
    console.error('\n請執行 `node scripts/make-icons.mjs` 重新產生，並把結果一起 commit。');
    process.exit(1);
  }
  console.log('✓ PWA 圖示與產生器一致');
}
