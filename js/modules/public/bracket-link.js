import { el } from '../../core/ui.js';
import { iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';
import { getBracketFormats } from './data.js';
import { isBracketMatch } from './bracket-model.js';

/** 與比賽按鈕並列，避免巢狀按鈕或點擊同時觸發兩個導頁。 */
export async function appendBracketLink(row, match, division) {
  if (!match?.divisionId || !match.matchKey || division?.schedulePublished !== true) return;
  try {
    const formats = await getBracketFormats();
    if (!row.isConnected || !isBracketMatch(formats[division.formatId], match)) return;
    const badge = row.querySelector('.division-badge');
    row.classList.add('prow--bracket');
    row.append(el('div', { class: 'prow__bracketActions' }, [
      badge,
      el('button', { class: 'prow__bracketLink', type: 'button',
        onClick: () => navigate(`/division/${encodeURIComponent(match.divisionId)}?tab=bracket`)
      }, iconText('trophy', '晉級／名次圖'))
    ]));
  } catch { /* 賽制暫時讀不到時，原本比賽卡仍可正常操作。 */ }
}
