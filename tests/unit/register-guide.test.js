/**
 * T63 報名圖文教學的內容（js/modules/register/guide-steps.js）
 * ------------------------------------------------------------------
 * 畫面在 tutorial.js（E2E 守），這裡守的是內容本身：
 *   ・每一步都有圖、標題、說明，圖真的在 img/tutorial/ 底下
 *   ・圖是 390×560 的 2 倍截圖——標記框的座標就是照這個尺寸算的，
 *     換一張別的尺寸進來，框會靜靜地圈到錯的地方
 *   ・標記框沒有超出圖的範圍
 *
 * 少一張圖不會有任何錯誤訊息：畫面上只是一個空框，然後家長把教學關掉。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLOWS, FLOW_KEYS, SHOT_W, SHOT_H, guideImages } from '../../js/modules/register/guide-steps.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const IMG_DIR = path.join(ROOT, 'img', 'tutorial');

/** 讀 PNG 的 IHDR（第 16–23 位元組是寬高，big-endian） */
function pngSize(file) {
  const b = fs.readFileSync(file);
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe('T63 報名圖文教學', () => {
  test('T63-1 兩條流程都在，每一步都有圖、標題、說明與至少一個標記', () => {
    expect(FLOW_KEYS).toEqual(['adult', 'youth']);
    for (const k of FLOW_KEYS) {
      const f = FLOWS[k];
      expect(f.steps.length).toBeGreaterThanOrEqual(6);
      expect(f.stages.length).toBeGreaterThanOrEqual(3);
      for (const s of f.steps) {
        expect(typeof s.img).toBe('string');
        expect(s.title.length).toBeGreaterThan(3);
        expect(s.desc.length).toBeGreaterThan(10);
        expect(Array.isArray(s.marks) && s.marks.length >= 1).toBe(true);
      }
    }
  });

  test('T63-2 每一張圖都真的在 img/tutorial/ 底下', () => {
    const missing = guideImages().filter(n => !fs.existsSync(path.join(IMG_DIR, `${n}.png`)));
    expect(missing).toEqual([]);
  });

  test('T63-3 圖是 390×560 的 2 倍截圖（標記座標照這個尺寸算）', () => {
    for (const n of guideImages()) {
      const { w, h } = pngSize(path.join(IMG_DIR, `${n}.png`));
      expect({ img: n, w, h }).toEqual({ img: n, w: SHOT_W * 2, h: SHOT_H * 2 });
    }
  });

  test('T63-4 標記框都在圖的範圍內，而且有大小', () => {
    for (const k of FLOW_KEYS) {
      for (const s of FLOWS[k].steps) {
        for (const m of s.marks) {
          expect(m.x).toBeGreaterThanOrEqual(0);
          expect(m.y).toBeGreaterThanOrEqual(0);
          expect(m.w).toBeGreaterThan(8);
          expect(m.h).toBeGreaterThan(8);
          expect(m.x + m.w).toBeLessThanOrEqual(SHOT_W);
          expect(m.y + m.h).toBeLessThanOrEqual(SHOT_H);
        }
      }
    }
  });

  test('T63-5 階段只會往前走，而且不超出 stages 的數量', () => {
    for (const k of FLOW_KEYS) {
      const f = FLOWS[k];
      let last = 0;
      for (const s of f.steps) {
        expect(s.stage).toBeGreaterThanOrEqual(last);
        expect(s.stage).toBeLessThan(f.stages.length);
        last = s.stage;
      }
      expect(f.steps[0].stage).toBe(0);
      expect(f.steps.at(-1).stage).toBe(f.stages.length - 1);
    }
  });

  test('T63-6 兩條流程的第一步都是同一顆「我要建立球隊」（改一份就好）', () => {
    expect(FLOWS.adult.steps[0].img).toBe('home');
    expect(FLOWS.youth.steps[0].img).toBe('home');
    expect(FLOWS.youth.steps[0].title).toBe(FLOWS.adult.steps[0].title);
  });

  test('T63-7 學童組沒有邀請碼那幾步、成人組沒有教練填名單那幾步（兩條路不能混）', () => {
    const adultText = FLOWS.adult.steps.map(s => s.title + s.desc).join('');
    const youthText = FLOWS.youth.steps.map(s => s.title + s.desc).join('');
    expect(adultText).toContain('邀請碼');
    expect(youthText).toContain('後四碼');
    expect(youthText).toContain('不發邀請碼');
    expect(adultText).not.toContain('後四碼');
  });

  test('T63-8 內容裡沒有 emoji（R-UI-004）', () => {
    const text = JSON.stringify(FLOWS);
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)).toBe(false);
  });
});
