/**
 * T37 設定檔必須與競賽規章一致
 * ------------------------------------------------------------------
 * 來源：`FEDA CUP 2026｜飛達盃-競賽規章.pdf`（主辦 2026-09-03 提供）
 *
 * 這一組把規章的數字抄成常數放在這裡，設定檔一改就撞紅。
 * 抄一份而不是解析 PDF：規章是人核定的文件，改了應該由人看過再決定跟進，
 * 自動跟著變就不叫守衛了（同 roles-fc-parity.test.js 的作法）。
 *
 * ⭐ 為什麼值得寫：這些全部是「錯了也跑得動」的數字。
 *    比賽 20 分鐘還是 25 分鐘、棄權 3:0 還是 0:2、同分第幾順位看什麼——
 *    程式不會抱怨，只會在比賽當天算出一個跟規章推導不一樣的名次。
 */

import { DIVISIONS, RANKING_RULES, REGISTRATION_LIMITS } from '../../js/engine/formats.js';
import { DEFAULT_WALKOVER } from '../../js/engine/tally.js';

/** 規章第十一、十二、十五、十七、十八條 */
const REG = {
  divisions: {
    u6:           { name: '學童幼稚園', bornOnOrAfter: '2020-09-01', onField: 5, minutes: 25, ball: 4 },
    u8:           { name: '學童低年級', bornOnOrAfter: '2018-09-01', onField: 5, minutes: 25, ball: 4 },
    u10:          { name: '學童中年級', bornOnOrAfter: '2016-09-01', onField: 5, minutes: 25, ball: 4 },
    women:        { name: '女子公開組', bornOnOrAfter: null,         onField: 5, minutes: 25, ball: 5 },
    'adult-fun':  { name: '男子興趣組', bornOnOrAfter: null,         onField: 9, minutes: 30, ball: 5 },
    'adult-open': { name: '男子公開組', bornOnOrAfter: null,         onField: 9, minutes: 30, ball: 5 }
  },
  points: { win: 3, draw: 1, loss: 0 },
  /** 第十九條：積分 → 對戰關係 → 正負球數 → 進球數多 → 被進球數少 → 抽籤 */
  tiebreak: ['points', 'headToHeadPoints', 'goalDiff', 'goalsFor', 'goalsAgainstAsc', 'drawLots'],
  walkover: { winner: 2, loser: 0 },
  maxPlayers: 15,
  maxStaff: 3
};

const byId = Object.fromEntries(DIVISIONS.map(d => [d.divisionId, d]));

describe('T37-1 組別（規章第十一、十五、十七、十八條）', () => {
  test('六個組別，一個不多一個不少', () => {
    expect(Object.keys(byId).sort()).toEqual(Object.keys(REG.divisions).sort());
  });

  test('⭐ 名稱用規章上的名字（家長要跟報名表對得起來）', () => {
    for (const [id, reg] of Object.entries(REG.divisions)) {
      expect(byId[id].name).toBe(reg.name);
    }
  });

  test('⭐ 上場人數：學童三組與女子公開 5 人、男子兩組 9 人', () => {
    for (const [id, reg] of Object.entries(REG.divisions)) {
      expect(byId[id].playersOnField).toBe(reg.onField);
    }
  });

  test('⭐ 比賽時間：學童三組與女子公開 25 分、男子兩組 30 分', () => {
    // 原本學童與女子是 20 分鐘。時鐘會照設定跑，錯了不會有任何提示。
    for (const [id, reg] of Object.entries(REG.divisions)) {
      expect(byId[id].matchDurationMin).toBe(reg.minutes);
    }
  });

  test('⭐ 六個組別全部不分上下半場（periods === 1）', () => {
    // 規章第十八條第 2 款括號裡的「不分上、下半場」。
    // periods 是 2 的話賽務台會畫「結束上半場」，賽務按下去比賽就卡在中場。
    for (const d of DIVISIONS) expect(d.periods).toBe(1);
  });

  test('用球號數：學童三組 4 號、其餘 5 號', () => {
    for (const [id, reg] of Object.entries(REG.divisions)) {
      expect(byId[id].ballSize).toBe(reg.ball);
    }
  });
});

describe('T37-2 參賽資格（規章第十一條）', () => {
  test('⭐ 三個學童組的出生日期門檻', () => {
    // 規章明訂，而且第十八條第 3 款說冒名頂替「立即停止該球隊繼續比賽資格」。
    // 少了這個欄位，超齡球員報得進來而且系統一句話都不會說。
    for (const [id, reg] of Object.entries(REG.divisions)) {
      expect(byId[id].eligibility.bornOnOrAfter).toBe(reg.bornOnOrAfter);
    }
  });

  test('成人三組沒有出生日期門檻，但有資格說明', () => {
    for (const id of ['women', 'adult-fun', 'adult-open']) {
      expect(byId[id].eligibility.bornOnOrAfter).toBeNull();
      expect(byId[id].eligibility.note).toBeTruthy();
    }
  });
});

describe('T37-3 名次判別（規章第十九條）', () => {
  const rule = RANKING_RULES.RR_FEDA_2026;

  test('六個組別全部採用規章版排名規則', () => {
    for (const d of DIVISIONS) expect(d.rankingRuleId).toBe('RR_FEDA_2026');
  });

  test('勝 3 分、和 1 分、負 0 分', () => {
    expect(rule.points).toEqual(REG.points);
  });

  test('⭐ 同分判定順序與規章逐項相同', () => {
    expect(rule.criteria).toEqual(REG.tiebreak);
  });

  test('⭐ 規章沒有行為分，不得列入同分判定', () => {
    // 舊的 RR_FEDA_DEFAULT 把 fairPlay 放在第 5 順位——那是規章沒有授權的條件。
    // fairPlay 本身仍然要算（射手榜／風度獎要用），只是不決定名次。
    expect(rule.criteria).not.toContain('fairPlay');
    expect(rule.fairPlay).toBeTruthy();
  });

  test('⭐ 最後一關是抽籤，而且抽籤由人執行', () => {
    // R-ENG-004：引擎不呼叫隨機來源。drawLots 的語意是
    // 「標記 hasUnresolvedTie，等主辦抽完再回填」。
    expect(rule.criteria.at(-1)).toBe('drawLots');
  });
});

describe('T37-4 棄權（規章第十八條第 6 款）', () => {
  test('⭐ 逾時 5 分鐘不出場以棄權論 0:2', () => {
    expect(DEFAULT_WALKOVER.scoreFor).toBe(REG.walkover.winner);
    expect(DEFAULT_WALKOVER.scoreAgainst).toBe(REG.walkover.loser);
  });

  test('棄權方的對手拿滿分', () => {
    expect(DEFAULT_WALKOVER.awardPoints).toBe(REG.points.win);
  });
});

describe('T37-5 報名限制（規章第十二條）', () => {
  test('⭐ 球員最多 15 人、隊職員 3 人', () => {
    expect(REGISTRATION_LIMITS.maxPlayers).toBe(REG.maxPlayers);
    expect(REGISTRATION_LIMITS.maxStaff).toBe(REG.maxStaff);
  });

  test('隊職員是領隊、教練、管理各 1 人', () => {
    expect(REGISTRATION_LIMITS.staffRoles).toEqual(['leader', 'coach', 'manager']);
  });

  test('⭐ 每人限報乙隊', () => {
    expect(REGISTRATION_LIMITS.onePlayerOneTeam).toBe(true);
  });

  test('報名費：學童 5000、成人 6000', () => {
    expect(REGISTRATION_LIMITS.fee).toEqual({ youth: 5000, adult: 6000 });
  });
});

describe('T37-6 規章沒有的東西不要自己加', () => {
  test('⭐ 仁慈規則（比分封頂）一律關閉', () => {
    // u6/u8/u10 原本設了 cap: 7。規章沒有這一條，
    // 而「公開端顯示 7:0、實際是 12:0」對家長來說是系統在騙他。
    for (const d of DIVISIONS) {
      expect(d.display.mercyRule.enabled).toBe(false);
    }
  });

  test('兒童組仍然不公開個人射手榜（這是隱私，不是賽制）', () => {
    // R-PRIV-001。規章沒規定，但未滿 13 歲的個人成績不該掛在公開端。
    for (const id of ['u6', 'u8', 'u10']) expect(byId[id].display.scorerBoard).toBe(false);
    for (const id of ['women', 'adult-fun', 'adult-open']) expect(byId[id].display.scorerBoard).toBe(true);
  });
});
