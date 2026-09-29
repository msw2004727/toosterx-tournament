/** 組別識別取自賽制設定，固定色碼只定義在 tokens.css。 */
import { DIVISIONS } from '../engine/formats.js';

const definitions = new Map(DIVISIONS.map(d => [d.divisionId, d]));
const tokens = new Set(DIVISIONS.map(d => d.colorToken));

/** 可直接展開到 el() props；未知組別維持中性色，不猜色、不注入任意 CSS。 */
export function divisionThemeAttrs(division) {
  const id = typeof division === 'string' ? division : division?.divisionId;
  const token = definitions.get(id)?.colorToken ?? division?.colorToken;
  if (!id || !tokens.has(token)) return {};
  return { 'data-division': id, 'data-division-tone': token };
}

/** 換篩選條件時也會清掉前一組色彩，避免「全部組別」殘留單組主題。 */
export function setDivisionTheme(node, division) {
  node.removeAttribute('data-division');
  node.removeAttribute('data-division-tone');
  for (const [name, value] of Object.entries(divisionThemeAttrs(division))) node.setAttribute(name, value);
  return node;
}
