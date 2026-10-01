/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { scanOnce, scanSupported } from '../../js/modules/booth/scan.js';
let stops, getMedia;
const flush = () => new Promise(resolve => setTimeout(resolve, 20));
beforeEach(() => {
  document.body.innerHTML = '';
  stops = jest.fn();
  getMedia = jest.fn(async () => ({ getTracks: () => [{ stop: stops }] }));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: getMedia } });
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 2 });
  window.BarcodeDetector = class { async detect() { return []; } };
});
afterEach(() => jest.restoreAllMocks());
test('沒有 BarcodeDetector 仍能開相機', () => {
  delete window.BarcodeDetector;
  expect(scanSupported()).toBe(true);
});
test('取消授權等待後晚回來的串流也會停止', async () => {
  let complete;
  getMedia.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const result = scanOnce();
  document.querySelector('button').click();
  expect(await result).toBeNull();
  complete({ getTracks: () => [{ stop: stops }] }); await flush();
  expect(stops).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.scan')).toBeNull();
});
test('離頁取消會停止已取得串流並移除視窗', async () => {
  const abort = new AbortController(), result = scanOnce({ signal: abort.signal });
  await flush(); abort.abort();
  expect(await result).toBeNull();
  expect(stops).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.scan')).toBeNull();
});
test('原生辨識成功後停止相機，回傳合法卡号', async () => {
  window.BarcodeDetector = class { async detect() { return [{ rawValue: 'FEDA-0182' }]; } };
  expect(await scanOnce()).toBe('FEDA-0182');
  expect(stops).toHaveBeenCalledTimes(1);
});
test('拒絕相機權限會關閉视窗並提示手動卡號', async () => {
  getMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  await expect(scanOnce()).rejects.toThrow('手動輸入卡號');
  expect(document.querySelector('.scan')).toBeNull();
});
