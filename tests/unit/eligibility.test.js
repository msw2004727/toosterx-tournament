/**
 * T39 參賽資格與民國年
 * ------------------------------------------------------------------
 * 規格：競賽規章第十一條、第十二條；docs/10 §3
 *
 * 兩件事在這裡守：
 *   1. 年齡門檻是「差一天就差一個組別」的判斷，而且規章第十八條第 3 款
 *      對超齡的罰則是**取消整隊資格**——不能猜，也不能沒填就放行
 *   2. 民國年與西元差 1911 年。混用不會報錯，只會讓 105 年出生的孩子
 *      被算成 105 歲
 */

import { checkAge, validateMember, canAddMember, isYouthDivision, parseYmd } from '../../js/engine/eligibility.js';
import { rocToIso, isoToRoc, rocLabel, rocShort, rocToAd, adToRoc } from '../../js/lib/roc.js';
import { DIVISIONS, REGISTRATION_LIMITS } from '../../js/engine/formats.js';

const byId = Object.fromEntries(DIVISIONS.map(d => [d.divisionId, d]));
const U10 = byId['u10'];        // 2016-09-01 以後
const U6 = byId['u6'];          // 2020-09-01 以後
const ADULT = byId['adult-open'];

describe('T39-1 年齡門檻（規章第十一條）', () => {
  test('⭐ 門檻當天出生算通過（規章的「以後」含當日）', () => {
    // 差一天就差一個組別。規章文字是「2016年09月01日以後出生」，
    // 中文法規的「以後」含當日，所以是 >= 不是 >。
    expect(checkAge('2016-09-01', U10).ok).toBe(true);
    expect(checkAge('2016-08-31', U10).ok).toBe(false);
    expect(checkAge('2016-09-02', U10).ok).toBe(true);
  });

  test('太早出生會說明是哪一天的門檻，而且用民國年講', () => {
    const r = checkAge('2015-12-31', U10);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TOO_OLD');
    expect(r.message).toContain('民國 105 年 9 月 1 日');
  });

  test('⭐ 沒填生日一律不通過（fail-closed）', () => {
    // 反過來寫的話，一筆沒填生日的超齡球員會直接混進學童組，
    // 然後在比賽當天被檢錄員抓到，整隊資格被取消。
    for (const v of [null, undefined, '', '2016/09/01', '2016-9-1', '不知道']) {
      const r = checkAge(v, U10);
      expect(r.ok).toBe(false);
      expect(r.code).toBe('BIRTHDATE_MISSING');
    }
  });

  test('⭐ 格式對但日子不存在也不通過', () => {
    expect(parseYmd('2017-02-30')).toBeNull();
    expect(checkAge('2017-02-30', U10).ok).toBe(false);
  });

  test('成人組沒有年齡門檻，連生日都不必填', () => {
    expect(checkAge(null, ADULT).ok).toBe(true);
    expect(checkAge('1975-01-01', ADULT).ok).toBe(true);
  });

  test('三個學童組的門檻各自獨立', () => {
    // 2017 年出生：中年級可以，幼稚園不行
    expect(checkAge('2017-05-01', U10).ok).toBe(true);
    expect(checkAge('2017-05-01', U6).ok).toBe(false);
  });

  test('組別設定壞掉時不通過，而且說得出是設定的問題', () => {
    const broken = { name: 'X', eligibility: { bornOnOrAfter: '亂寫' } };
    expect(checkAge('2018-01-01', broken)).toMatchObject({ ok: false, code: 'DIVISION_MISCONFIGURED' });
  });
});

describe('T39-2 哪些組別走教練管理名單', () => {
  test('⭐ 依「有沒有年齡門檻」判斷，不寫死 divisionId', () => {
    // if (divisionId === 'u10') 在辦第二場時就會錯（專案本質是設定檔驅動）
    for (const id of ['u6', 'u8', 'u10']) expect(isYouthDivision(byId[id])).toBe(true);
    for (const id of ['women', 'adult-fun', 'adult-open']) expect(isYouthDivision(byId[id])).toBe(false);

    // ⚠️ 只測現有的六個組別是抓不到「寫死代碼」這個錯的——
    //    u6/u8/u10 剛好就在那份寫死的清單裡（變異 #R13 就是這樣逃掉的）。
    //    真正有鑑別力的是「代碼沒見過、但有年齡門檻」的組別。
    expect(isYouthDivision({ divisionId: 'kinder-2028', eligibility: { bornOnOrAfter: '2022-09-01' } })).toBe(true);
    // 反過來：代碼看起來像兒童組、但沒有年齡門檻的，不該切成教練模式
    expect(isYouthDivision({ divisionId: 'u10', eligibility: { bornOnOrAfter: null } })).toBe(false);
  });

  test('讀不到組別時當成非學童組（不會誤把成人也切成教練模式）', () => {
    expect(isYouthDivision(null)).toBe(false);
    expect(isYouthDivision({})).toBe(false);
  });
});

describe('T39-3 名單欄位檢查', () => {
  const ok = { name: '小豆子', birthDate: '2017-03-05', idLast4: '1234', kind: 'player' };

  test('學童組：暱稱、生日、後四碼齊全才過', () => {
    expect(validateMember(ok, U10).ok).toBe(true);
  });

  test('⭐ 學童組的身分證後四碼是必填', () => {
    // 只存暱稱的話，檢錄當天唯一能跟證件對起來的就是「後四碼＋生日」。
    // 選填等於檢錄員拿不到任何可核對的東西。
    const r = validateMember({ ...ok, idLast4: '' }, U10);
    expect(r.ok).toBe(false);
    expect(r.errors.idLast4).toContain('後四碼');

    expect(validateMember({ ...ok, idLast4: '12' }, U10).ok).toBe(false);
    expect(validateMember({ ...ok, idLast4: 'abcd' }, U10).ok).toBe(false);
  });

  test('成人組不強制後四碼', () => {
    expect(validateMember({ name: '王大明', kind: 'player' }, ADULT).ok).toBe(true);
  });

  test('隊職員不必查年齡與後四碼（他們不上場）', () => {
    // 規章第十二條的隊職員是領隊、教練、管理，兒童組偶爾有超齡的隨隊職員
    expect(validateMember({ name: '林教練', kind: 'staff' }, U10).ok).toBe(true);
  });

  test('暱稱空白或太長要擋，而且學童組講「暱稱」不講「姓名」', () => {
    expect(validateMember({ ...ok, name: '  ' }, U10).errors.name).toBe('請填暱稱');
    expect(validateMember({ ...ok, name: '王大明' }, ADULT).ok).toBe(true);
    expect(validateMember({ name: '', kind: 'player' }, ADULT).errors.name).toBe('請填姓名');
    expect(validateMember({ ...ok, name: 'x'.repeat(21) }, U10).errors.name).toContain('太長');
  });

  test('背號限 0–99', () => {
    expect(validateMember({ ...ok, jerseyNo: 7 }, U10).ok).toBe(true);
    expect(validateMember({ ...ok, jerseyNo: 0 }, U10).ok).toBe(true);
    expect(validateMember({ ...ok, jerseyNo: 100 }, U10).errors.jerseyNo).toBeTruthy();
    expect(validateMember({ ...ok, jerseyNo: -1 }, U10).errors.jerseyNo).toBeTruthy();
    expect(validateMember({ ...ok, jerseyNo: null }, U10).ok).toBe(true);   // 選填
  });
});

describe('T39-4 人數上限（規章第十二條）', () => {
  const L = REGISTRATION_LIMITS;
  const players = n => Array.from({ length: n }, () => ({ kind: 'player' }));
  const staff = n => Array.from({ length: n }, () => ({ kind: 'staff' }));

  test('⭐ 球員最多 15 人', () => {
    expect(canAddMember(players(14), 'player', L).ok).toBe(true);
    expect(canAddMember(players(15), 'player', L).ok).toBe(false);
    expect(canAddMember(players(15), 'player', L).message).toContain('15');
  });

  test('⭐ 隊職員最多 3 人，而且球員與隊職員分開算', () => {
    expect(canAddMember([...players(15), ...staff(2)], 'staff', L).ok).toBe(true);
    expect(canAddMember([...players(15), ...staff(3)], 'staff', L).ok).toBe(false);
    // 球員滿了不影響還能不能加隊職員
    expect(canAddMember(players(15), 'staff', L).ok).toBe(true);
  });

  test('沒有 kind 的舊資料當成球員', () => {
    expect(canAddMember(Array.from({ length: 15 }, () => ({})), 'player', L).ok).toBe(false);
  });
});

describe('T39-5 民國年轉換', () => {
  test('民國元年是西元 1912', () => {
    expect(rocToAd(1)).toBe(1912);
    expect(adToRoc(1912)).toBe(1);
    expect(rocToIso(1, 1, 1)).toBe('1912-01-01');
  });

  test('⭐ 105/09/01 是 2016-09-01（正好是中年級的門檻）', () => {
    expect(rocToIso(105, 9, 1)).toBe('2016-09-01');
    expect(isoToRoc('2016-09-01')).toEqual({ y: 105, m: 9, d: 1 });
    expect(rocLabel('2016-09-01')).toBe('民國 105 年 9 月 1 日');
    expect(rocShort('2016-09-01')).toBe('105/09/01');
  });

  test('補零，不會產生 2016-9-1 這種資料庫吃不下的字串', () => {
    expect(rocToIso(109, 3, 7)).toBe('2020-03-07');
  });

  test('⭐ 空字串不可以變成民國 0 年', () => {
    // Number('') 是 0。R-ENG-002 講的就是這個坑：0 是合法數字，
    // 於是「沒填」會通過檢查，變成西元 1911 年出生。
    expect(rocToIso('', 9, 1)).toBeNull();
    expect(rocToIso(' ', 9, 1)).toBeNull();
    expect(rocToIso(null, 9, 1)).toBeNull();
    expect(rocToIso(0, 9, 1)).toBeNull();
  });

  test('⭐ 只吃十進位整數字串，不做 Number() 的寬鬆解析', () => {
    // ⚠️ 上面那條擋得住空字串，但擋不住 Number() 的其他花樣——
    //    民國年的範圍檢查（1–200）會把 0 接住，所以「空字串」那條
    //    在改用 Number() 之後照樣是綠的（變異 #R15 就是這樣逃掉的）。
    //    真正只有嚴格解析擋得住的是這幾個：
    expect(Number('0x69')).toBe(105);          // 十六進位，看起來完全不像 105
    expect(rocToIso('0x69', 9, 1)).toBeNull();
    expect(Number('1e2')).toBe(100);           // 科學記號
    expect(rocToIso('1e2', 9, 1)).toBeNull();
    expect(rocToIso('105.0', 9, 1)).toBeNull();
    expect(rocToIso('+105', 9, 1)).toBeNull();
  });

  test('每一格都在範圍內但日子不存在也要擋', () => {
    expect(rocToIso(105, 2, 30)).toBeNull();
    expect(rocToIso(105, 13, 1)).toBeNull();
    expect(rocToIso(105, 9, 31)).toBeNull();
  });

  test('閏年的 2 月 29 日是合法的', () => {
    expect(rocToIso(105, 2, 29)).toBe('2016-02-29');   // 2016 是閏年
    expect(rocToIso(106, 2, 29)).toBeNull();           // 2017 不是
  });

  test('非數字一律回 null，不做寬鬆解析', () => {
    expect(rocToIso('105年', 9, 1)).toBeNull();
    expect(rocToIso('一〇五', 9, 1)).toBeNull();
  });

  test('isoToRoc 對壞資料回 null，畫面才不會印出 NaN', () => {
    expect(isoToRoc('')).toBeNull();
    expect(isoToRoc('2016/09/01')).toBeNull();
    expect(isoToRoc(null)).toBeNull();
    expect(rocLabel('壞掉')).toBe('');
    expect(rocShort(null)).toBe('');
  });

  test('民國前的年份不處理', () => {
    expect(isoToRoc('1900-01-01')).toBeNull();
  });
});
