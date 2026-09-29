import { decodeCsvBytes, readCsvFile, CsvFileError, csvImportErrorMessage } from '../../js/lib/csv-file.js';
import { IMPORT_MAX_BYTES } from '../../js/engine/team-import.js';

const text = '飛達,小飛';
const big5 = Buffer.from('adb8b9462ca470adb8', 'hex');
const fakeFile = bytes => ({ name: '名冊.csv', size: bytes.length, arrayBuffer: async () => bytes });
const originalReader = globalThis.FileReader;
afterEach(() => { globalThis.FileReader = originalReader; });

test.each([false, true])('UTF-8 有／無 BOM 都保留中文：%s', bom => {
  expect(decodeCsvBytes(Buffer.from((bom ? '\uFEFF' : '') + text))).toMatchObject({ text, encoding: 'utf-8' });
});
test('Big5 中文自動辨識，不替換成亂碼', () => {
  expect(decodeCsvBytes(big5)).toMatchObject({ text, encoding: 'big5' });
});
test.each(['utf-16le', 'utf-16be'])('Excel UTF-16 BOM %s 能正確讀取', encoding => {
  const bytes = Buffer.from('\uFEFF' + text, 'utf16le');
  if (encoding === 'utf-16be') bytes.swap16();
  expect(decodeCsvBytes(bytes)).toMatchObject({ text, encoding });
});
test('明確選錯編碼會阻擋，可改選 Big5；BOM 衝突不擅自覆寫', () => {
  expect(() => decodeCsvBytes(big5, 'utf-8')).toThrow(CsvFileError);
  expect(decodeCsvBytes(big5, 'big5').text).toBe(text);
  expect(() => decodeCsvBytes(Buffer.from('\uFEFF' + text), 'big5')).toThrow('檔案標示為 UTF-8');
});
test('UTF-8 BOM 後有壞位元組不能改猜 Big5、截斷 UTF-16 也拒絕', () => {
  expect(() => decodeCsvBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), big5]))).toThrow('無法完整解碼');
  expect(() => decodeCsvBytes(Buffer.from([0xff, 0xfe, 0x61]))).toThrow('無法完整解碼');
  expect(() => decodeCsvBytes(Buffer.from([0x81]))).toThrow('無法使用所選編碼');
});
test('已損壞的替代字元不靜默接受', () => {
  expect(() => decodeCsvBytes(Buffer.from('飛\uFFFD'))).toThrow('替代字元');
});
test.each([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from([0xd0, 0xcf, 0x11, 0xe0])])('誤改副檔名的 Excel 活頁簿不是編碼問題：%j', bytes => {
  expect(() => decodeCsvBytes(bytes)).toThrow('Excel 活頁簿');
});
test('一般 File.arrayBuffer 讀取後能解碼，檔案類型與大小先檢查', async () => {
  expect(await readCsvFile(fakeFile(big5))).toMatchObject({ text, encoding: 'big5' });
  await expect(readCsvFile({ ...fakeFile(big5), name: '名冊.xlsx' })).rejects.toMatchObject({ code: 'format' });
  await expect(readCsvFile({ ...fakeFile(big5), size: IMPORT_MAX_BYTES + 1 })).rejects.toThrow('1 MB');
});
test.each(['missing', 'throws'])('arrayBuffer %s 時用 FileReader 讀取有效 UTF-8', async mode => {
  const bytes = Buffer.from('\uFEFF' + text);
  globalThis.FileReader = class { readAsArrayBuffer() { this.result = bytes; this.onload(); } };
  const file = { name: '名冊.csv', size: bytes.length };
  if (mode === 'throws') file.arrayBuffer = async () => { throw new TypeError('File API unavailable'); };
  expect(await readCsvFile(file)).toMatchObject({ text, encoding: 'utf-8' });
});
test.each(['error', 'abort', 'throws'])('FileReader %s 只回報檔案讀取問題', async mode => {
  globalThis.FileReader = class {
    readAsArrayBuffer() {
      if (mode === 'throws') throw new TypeError('file read failed');
      if (mode === 'abort') this.onabort(); else this.onerror();
    }
  };
  await expect(readCsvFile({ name: '名冊.csv', size: 10 })).rejects.toMatchObject({ code: 'read' });
  await expect(readCsvFile({ name: '名冊.csv', size: 10 })).rejects.toThrow('儲存在本機');
});
test('程式／驗證 TypeError 不冒充 UTF-8 錯誤，已分類的錯誤保留原訊息', () => {
  const result = csvImportErrorMessage(new TypeError('欄位驗證失敗'));
  expect(result).toContain('CSV 內容檢查失敗');
  expect(result).not.toContain('UTF-8');
  expect(csvImportErrorMessage(new CsvFileError('read', '讀取失敗'))).toBe('讀取失敗');
});
