import { el } from '../../core/ui.js';
import { navigate } from '../../core/router.js';
import { iconText } from '../../core/icons.js';

export const DIVISION_TABS = [
  { key: 'table', label: '積分榜', icon: 'table' },
  { key: 'schedule', label: '賽程', icon: 'list' },
  { key: 'bracket', label: '晉級／名次圖', icon: 'trophy' },
  { key: 'teams', label: '球隊', icon: 'team' }
];

export function divisionTabs(divisionId, selected) {
  return el('div', { class: 'ptabs ptabs--sub ptabs--division', role: 'tablist', 'aria-label': '組別資訊' },
    DIVISION_TABS.map(t => el('button', {
      class: `ptabs__btn ${selected === t.key ? 'is-active' : ''}`, type: 'button',
      role: 'tab', 'aria-selected': String(selected === t.key),
      onClick: () => navigate(`/division/${encodeURIComponent(divisionId)}?tab=${t.key}`, { replace: true })
    }, iconText(t.icon, t.label))));
}
