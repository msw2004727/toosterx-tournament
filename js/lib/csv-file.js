/** CSV 檔案讀取與解碼；只有解碼失敗才能回報文字編碼錯誤。 */
import { IMPORT_MAX_BYTES } from '../engine/team-import.js';

export const CSV_ENCODINGS = [
  ['auto', '自動辨識（建議）'], ['utf-8', 'UTF-8'], ['big5', 'Big5（繁體中文）'],
  ['utf-16le', 'UTF-16 LE'], ['utf-16be', 'UTF-16 BE']
];
const LABELS = Object.fromEntries(CSV_ENCODINGS);
export class CsvFileError extends Error {
  constructor(code, message) { super(message); this.name = 'CsvFileError'; this.code = code; }
}
const fail = (code, message) => { throw new CsvFileError(code, message); };

export function decodeCsvBytes(buffer, encoding = 'auto') {
  const bytes = new Uint8Array(buffer);
  if (typeof TextDecoder !== 'function') fail('unsupported', '這個瀏覽器不支援文字解碼，請改用新版 Chrome、Edge 或 Safari。');
  if (!CSV_ENCODINGS.some(([key]) => key === encoding)) fail('encoding', '請選擇支援的 CSV 文字編碼。');
  if ((bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) ||
      (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)) {
    fail('format', '這是 Excel 活頁簿，不能只把副檔名改成 .csv；請在 Excel 使用「另存新檔」匯出 CSV。');
  }
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 'utf-8'
    : bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : null;
  if (bom && encoding !== 'auto' && encoding !== bom) fail('encoding', `檔案標示為 ${LABELS[bom]}，請改選「自動辨識」或 ${LABELS[bom]}。`);
  // 有 BOM 時遵守檔案標示，損壞的 UTF-8 不可以再猜成 Big5。
  const candidates = encoding !== 'auto' ? [encoding] : bom ? [bom] : ['utf-8', 'big5'];
  for (const candidate of candidates) {
    let text;
    try { text = new TextDecoder(candidate, { fatal: true }).decode(bytes); }
    catch { continue; }
    if (text.includes('\uFFFD')) fail('encoding', '檔案含有無法辨識的替代字元，請由原始名冊重新匯出，避免球員姓名損壞。');
    return { text: text.replace(/^\uFEFF/, ''), encoding: candidate, label: LABELS[candidate] };
  }
  fail('encoding', bom
    ? `檔案標示為 ${LABELS[bom]}，但內容無法完整解碼，請由原始名冊重新匯出。`
    : '無法使用所選編碼讀取檔案。請確認「CSV 文字編碼」，或由 Excel 另存為「CSV UTF-8（逗號分隔）」。');
}

async function readBytes(file) {
  // 部分 WebView 沒有 Blob.arrayBuffer，或會在讀取時拋 TypeError。
  if (typeof file.arrayBuffer === 'function') {
    try { return await file.arrayBuffer(); } catch { /* 改用相容性較高的 FileReader */ }
  }
  if (typeof FileReader !== 'function') fail('read', '這個瀏覽器無法讀取檔案，請改用新版 Chrome、Edge 或 Safari。');
  try {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.onabort = () => reject(new Error('讀取已取消'));
      reader.readAsArrayBuffer(file);
    });
  } catch {
    fail('read', '讀不到這個檔案。請先將檔案儲存在本機，再重新選擇；若仍失敗，請更換瀏覽器。');
  }
}

export async function readCsvFile(file, encoding = 'auto') {
  if (!file || !/\.csv$/i.test(file.name)) fail('format', '請選擇 .csv 檔案。');
  if (file.size > IMPORT_MAX_BYTES) fail('format', 'CSV 必須小於 1 MB。');
  return decodeCsvBytes(await readBytes(file), encoding);
}

export function csvImportErrorMessage(error) {
  if (error instanceof CsvFileError) return error.message;
  return `CSV 內容檢查失敗：${error?.message || '請重新選擇檔案。'}`;
}
