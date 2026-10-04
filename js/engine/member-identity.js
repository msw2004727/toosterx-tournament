import { parseYmd, checkAge } from './eligibility.js';

/** 與 CSV 名冊一致：保留中英文及姓名內的空格，拒絕空白與控制字元。 */
export function validateMemberName(value) {
  if (typeof value !== 'string') return { value: null, error: '隊員姓名／暱稱必須是文字。' };
  const name = value.trim();
  if (!name || name.length > 40 || /[\u0000-\u001F\u007F]/u.test(value)) {
    return { value: null, error: '請填隊員姓名／暱稱，最多 40 字，不可含換行或控制字元。' };
  }
  return { value: name, error: null };
}

/** 空白是未指定，不是 0；有填才驗證 0–99。前端、CSV 與 callable 共用。 */
export function validateJerseyNo(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return { value: null, error: null };
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 99) return { value, error: null };
  if (typeof value === 'string' && /^\d{1,2}$/.test(value.trim())) return { value: parseInt(value.trim(), 10), error: null };
  return { value: null, error: '背號請留空，或填 0–99 的整數。' };
}

/** 可先留白；填了就必須有效。補齊後才可核對證件。 */
export function validateIdentity({ birthDate, idLast4 }, division, asOf) {
  const errors = [];
  if (!division || !parseYmd(asOf)) errors.push('賽事日期或組別未設定，無法檢查資格。');
  if (typeof birthDate !== 'string' || typeof idLast4 !== 'string') return { errors: ['生日與身分證後四碼必須是文字。'], complete: false };
  if (birthDate) {
    if (!parseYmd(birthDate) || birthDate < '1900-01-01' || birthDate >= asOf) errors.push('出生日期須為有效西元 YYYY-MM-DD，且早於賽事日期。');
    const age = checkAge(birthDate, division);
    if (!age.ok) errors.push(age.message);
  }
  if (idLast4 && !/^\d{4}$/.test(idLast4)) errors.push('身分證後四碼須為四位數字（含開頭的 0），勿填完整字號。');
  return { errors, complete: !errors.length && !!birthDate && !!idLast4 };
}

/** 舊版 CSV 沒有 identityComplete：以實際欄位判定，不能只信旗標。 */
export function csvIdentityPending(member) {
  return member?.source === 'csv' && (member.identityComplete === false || !parseYmd(member.birthDate) || !/^\d{4}$/.test(member.idLast4 ?? ''));
}
