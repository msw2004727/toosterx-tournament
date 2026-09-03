/**
 * 參賽資格判定
 * ------------------------------------------------------------------
 * 依據：《FEDA CUP 2026｜飛達盃-競賽規章》第十一條
 *
 *   學童幼稚園：2020 年 09 月 01 日以後出生
 *   學童低年級：2018 年 09 月 01 日以後出生
 *   學童中年級：2016 年 09 月 01 日以後出生
 *
 * 為什麼要有這一支：規章第十八條第 3 款說「如有冒名頂替者立即停止該球隊
 * 繼續比賽資格，已賽成績不予計算」。整隊被取消是很重的處罰，而超齡通常
 * 不是故意的——是教練沒注意到某個孩子生日差了兩週。系統在報名當下就
 * 擋下來，比在比賽當天由檢錄員發現好得多。
 *
 * 純函式：不碰 Firestore、不呼叫 Date.now()、不用隨機（R-ENG-004）。
 * 「今天」由呼叫端傳進來。
 *
 * ⚠️ 民國年（ROC）只存在於畫面上。這裡與資料庫一律用西元 ISO
 *    `YYYY-MM-DD`——混用會在跨年時差 1911 年而且不會有任何錯誤訊息。
 *    轉換工具在 js/lib/roc.js。
 */

/** @typedef {{ok:boolean, code:string|null, message:string}} EligibilityResult */

const OK = { ok: true, code: null, message: '' };

/** `YYYY-MM-DD` → `{y,m,d}`，格式不對回 null。與 privacy.js 的同名函式一致。 */
export function parseYmd(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // 擋掉 2 月 31 日這種「格式對但日子不存在」的輸入
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/** a 在 b 之前？兩者都是 {y,m,d} */
const before = (a, b) => a.y !== b.y ? a.y < b.y : a.m !== b.m ? a.m < b.m : a.d < b.d;

/**
 * 這個生日符合該組別的年齡門檻嗎？
 *
 * 規章寫「以後出生」，中文法規文字的「以後」**含當日**，所以門檻當天
 * 出生的孩子可以參加（>=，不是 >）。差一天就差一個組別，這裡不能猜。
 *
 * @param {string|null} birthDate  西元 `YYYY-MM-DD`
 * @param {object} division        formats.js 的 division 物件
 * @returns {EligibilityResult}
 */
export function checkAge(birthDate, division) {
  const limit = division?.eligibility?.bornOnOrAfter ?? null;
  if (limit == null) return OK;                 // 成人組沒有年齡門檻

  const b = parseYmd(birthDate);
  // fail-closed（R-ENG-005）：沒填或格式不對一律不通過。
  // 反過來寫的話，一筆沒填生日的超齡球員會直接混進學童組。
  if (!b) {
    return { ok: false, code: 'BIRTHDATE_MISSING', message: '請填出生年月日（民國年）' };
  }
  const l = parseYmd(limit);
  if (!l) return { ok: false, code: 'DIVISION_MISCONFIGURED', message: '這個組別的年齡門檻設定有問題，請聯絡主辦' };

  if (before(b, l)) {
    return {
      ok: false,
      code: 'TOO_OLD',
      message: `${division.name}限 ${rocLabel(limit)} 以後出生，這位球員的生日早於門檻`
    };
  }
  return OK;
}

/** `2016-09-01` → `民國105年9月1日`，訊息裡用得到 */
function rocLabel(iso) {
  const d = parseYmd(iso);
  return d ? `民國 ${d.y - 1911} 年 ${d.m} 月 ${d.d} 日` : iso;
}

/**
 * 這個組別要不要走「教練直接管理名單」？
 *
 * 學童三組不走邀請碼：小球員沒有 LINE 帳號，家長也不見得會操作。
 * 由球隊負責人（教練）自己新增與刪除，檢錄當天再由教練帶證件核對
 * （主辦 2026-09-03 指定的流程）。
 *
 * 判斷依據是**有沒有年齡門檻**，不是 divisionId ——
 * `if (divisionId === 'u10')` 這種寫法在辦第二場時就會錯。
 */
export const isYouthDivision = division => division?.eligibility?.bornOnOrAfter != null;

/**
 * 新增／編輯一筆名單資料時的完整檢查。
 *
 * @param {object} member  { name, birthDate, idLast4, jerseyNo, kind }
 * @param {object} division
 * @returns {{ok:boolean, errors:Record<string,string>}}
 *          errors 的鍵是欄位名，值是給家長看的中文——直接掛在該欄位下面。
 */
export function validateMember(member, division) {
  const errors = {};
  const youth = isYouthDivision(division);
  const kind = member?.kind ?? 'player';

  const name = String(member?.name ?? '').trim();
  if (name.length < 1) {
    errors.name = youth ? '請填暱稱' : '請填姓名';
  } else if (name.length > 20) {
    errors.name = '太長了，請控制在 20 字以內';
  }

  // 隊職員（領隊／教練／管理）不上場，不必查年齡與後四碼
  if (kind === 'player') {
    const age = checkAge(member?.birthDate, division);
    if (!age.ok) errors.birthDate = age.message;

    if (youth) {
      // 檢錄當天靠「後四碼＋生日」跟證件核對——只存暱稱的話，
      // 這兩個欄位是唯一對得起來的東西，不能是選填。
      const last4 = String(member?.idLast4 ?? '').trim();
      if (!/^\d{4}$/.test(last4)) errors.idLast4 = '請填身分證後四碼（4 個數字）';
    }
  }

  const jersey = member?.jerseyNo;
  if (jersey != null && jersey !== '') {
    const n = Number(jersey);
    if (!Number.isInteger(n) || n < 0 || n > 99) errors.jerseyNo = '背號請填 0–99';
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * 名單人數是否還在規章第十二條的上限內。
 *
 * @param {Array<object>} members 現有名單（已排除 removed / rejected）
 * @param {'player'|'staff'} adding 要新增的類型
 * @param {{maxPlayers:number, maxStaff:number}} limits
 */
export function canAddMember(members, adding, limits) {
  const list = Array.isArray(members) ? members : [];
  const isPlayer = m => (m?.kind ?? 'player') === 'player';
  const players = list.filter(isPlayer).length;
  const staff = list.length - players;

  if (adding === 'player' && players >= limits.maxPlayers) {
    return { ok: false, code: 'MAX_PLAYERS', message: `球員最多 ${limits.maxPlayers} 人（競賽規章第十二條）` };
  }
  if (adding !== 'player' && staff >= limits.maxStaff) {
    return { ok: false, code: 'MAX_STAFF', message: `隊職員最多 ${limits.maxStaff} 人：領隊、教練、管理各 1 位（競賽規章第十二條）` };
  }
  return OK;
}
