/**
 * 格式化｜對應 docs/08 §9（內容與文案原則）
 */
import {
  toMillis, hhmm, dateLabel, dateLabelFromYmd, dateTimeLabel,
  clockText, scoreText, playerLabel, maskName, agoText, PERIOD_LABEL, STATUS_LABEL
} from '../../js/lib/format.js';
import { escapeHTML, html, raw } from '../../js/core/ui.js';

const KICKOFF = '2026-10-09T08:30:00+08:00';

describe('時間解析', () => {
  test('接受 ISO 字串、Date、毫秒、Firestore Timestamp', () => {
    const ms = Date.parse(KICKOFF);
    expect(toMillis(KICKOFF)).toBe(ms);
    expect(toMillis(new Date(ms))).toBe(ms);
    expect(toMillis(ms)).toBe(ms);
    expect(toMillis({ toMillis: () => ms })).toBe(ms);
    expect(toMillis({ seconds: ms / 1000 })).toBe(ms);
  });

  test('無法解析時回傳 null，不回傳 NaN', () => {
    for (const bad of [null, undefined, '', 'abc', {}, NaN, new Date('x')]) {
      expect(toMillis(bad)).toBeNull();
    }
  });
});

describe('顯示格式（一律台北時區、24 小時制）', () => {
  test('⭐ 不受執行環境時區影響：UTC 環境下 08:30 仍是 08:30', () => {
    expect(hhmm(KICKOFF)).toBe('08:30');
    expect(hhmm('2026-10-11T14:30:00+08:00')).toBe('14:30');
    expect(hhmm('2026-10-09T00:30:00+08:00')).toBe('00:30');
  });

  test('日期用 10/9（四）格式', () => {
    expect(dateLabel(KICKOFF)).toBe('10/9（五）');
    expect(dateLabelFromYmd('2026-10-09')).toBe('10/9（五）');
    expect(dateLabelFromYmd('2026-10-11')).toBe('10/11（日）');
  });

  test('日期字串格式錯誤時原樣回傳，不炸', () => {
    expect(dateLabelFromYmd('20261009')).toBe('20261009');
    expect(dateLabelFromYmd(null)).toBe('');
  });

  test('日期時間合併', () => {
    expect(dateTimeLabel(KICKOFF)).toBe('10/9（五） 08:30');
  });

  test('無效輸入給佔位符而不是 Invalid Date', () => {
    expect(hhmm(null)).toBe('--:--');
    expect(dateLabel(null)).toBe('');
    expect(dateTimeLabel('abc')).toBe('');
  });

  test('計時器等寬 mm:ss', () => {
    expect(clockText(0)).toBe('00:00');
    expect(clockText(605)).toBe('10:05');
  });
});

describe('比分文字與仁慈規則', () => {
  test('一般情況直接顯示', () => {
    expect(scoreText({ home: 2, away: 1 })).toEqual({ home: '2', away: '1', masked: false });
  });

  test('⭐ 兒童組分差達 cap 時公開端顯示 7+', () => {
    expect(scoreText({ home: 15, away: 0 }, { enabled: true, cap: 7 }))
      .toEqual({ home: '7+', away: '0', masked: true });
    expect(scoreText({ home: 0, away: 9 }, { enabled: true, cap: 7 }))
      .toEqual({ home: '0', away: '7+', masked: true });
  });

  test('未達 cap 或未啟用仁慈規則時照實顯示', () => {
    expect(scoreText({ home: 6, away: 0 }, { enabled: true, cap: 7 }).masked).toBe(false);
    expect(scoreText({ home: 15, away: 0 }, { enabled: false, cap: 7 }).home).toBe('15');
    expect(scoreText({ home: 15, away: 0 }).home).toBe('15');
  });

  test('比分未填時顯示 -，不顯示 0（避免誤解為 0:0）', () => {
    expect(scoreText({ home: null, away: null })).toEqual({ home: '-', away: '-', masked: false });
    expect(scoreText(null).home).toBe('-');
  });
});

describe('球員與隱私', () => {
  test('球員標籤含背號', () => {
    expect(playerLabel({ jerseyNo: 7, displayName: '王小明' })).toBe('#7 王小明');
    expect(playerLabel({ displayName: '王小明' })).toBe('王小明');
    expect(playerLabel(null)).toBe('');
  });

  test('遮蔽名（R-PRIV-001：未滿 13 歲公開端）', () => {
    expect(maskName('王小明')).toBe('王○明');
    expect(maskName('歐陽小明')).toBe('歐○○明');
    expect(maskName('王明')).toBe('王○');
    expect(maskName('王')).toBe('王');
    expect(maskName('')).toBe('');
  });
});

describe('相對時間', () => {
  const now = Date.parse('2026-10-11T10:30:00+08:00');
  test('剛剛／N 分鐘前／時間', () => {
    expect(agoText(now - 10_000, now)).toBe('剛剛');
    expect(agoText(now - 180_000, now)).toBe('3 分鐘前');
    expect(agoText(now - 7200_000, now)).toBe('08:30');
  });
});

describe('文案用詞（docs/08 §9）', () => {
  test('用「完賽」不用「結束」', () => {
    expect(STATUS_LABEL.finished).toBe('已完賽');
    expect(Object.values(STATUS_LABEL).join()).not.toContain('結束');
  });

  test('期別中文完整', () => {
    for (const p of ['pre', 'h1', 'ht', 'h2', 'et1', 'et2', 'pk', 'ft']) {
      expect(PERIOD_LABEL[p]).toBeTruthy();
    }
  });

  test('所有狀態都有中文，不會漏出英文代碼', () => {
    for (const s of ['scheduled', 'checkin', 'ready', 'live', 'halftime',
                     'finished', 'confirmed', 'postponed', 'cancelled', 'walkover']) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_LABEL[s]).not.toMatch(/[a-z]/);
    }
  });
});

describe('HTML 逸出（R-CODE-002）', () => {
  test('五個危險字元都被逸出', () => {
    expect(escapeHTML(`<img src=x onerror="alert('x')">&`))
      .toBe('&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;');
  });

  test('null/undefined 逸出成空字串而不是字面的 "null"', () => {
    expect(escapeHTML(null)).toBe('');
    expect(escapeHTML(undefined)).toBe('');
  });

  test('⭐ 樣板插入的隊名會自動逸出', () => {
    const teamName = '<script>steal()</script>野狼';
    expect(html`<b>${teamName}</b>`).toBe('<b>&lt;script&gt;steal()&lt;/script&gt;野狼</b>');
  });

  test('陣列插入時每一項都逸出', () => {
    expect(html`<i>${['<a>', '<b>']}</i>`).toBe('<i>&lt;a&gt;&lt;b&gt;</i>');
  });

  test('raw() 才會原樣輸出（只能用在自己產生的標記上）', () => {
    expect(html`<b>${raw('<i>ok</i>')}</b>`).toBe('<b><i>ok</i></b>');
  });
});
