import { el } from '../../core/ui.js';
import { now, startTicker } from '../../core/clock.js';
import { hold } from '../../core/store.js';
import { selectedActivityDate } from '../../engine/challenge-days.js';

export function dateLabel(date) {
  return date ? date.slice(5).replace('-', '/') : '';
}

export function dayTabs(dates, selected, onSelect) {
  selected ??= selectedActivityDate(now(), dates);
  return el('div', { class: 'chal__days', role: 'tablist', 'aria-label': '活動日期' }, dates.map(date => el('button', {
    class: `btn${date === selected ? ' btn--primary' : ''}`, type: 'button', role: 'tab',
    'aria-selected': String(date === selected), 'data-date': date, onClick: () => onSelect(date)
  }, dateLabel(date))));
}

/** Midnight and returning from the background both follow the actual event day. */
export function watchActivityDay(scope, getSettings, onChange) {
  let last = null;
  function tick() {
    const settings = getSettings();
    if (!settings?.dates?.length) return;
    const date = selectedActivityDate(now(), settings.dates, settings.timeZone);
    if (date !== last && onChange(date) !== false) last = date;
  }
  hold(scope, startTicker(tick, 1000), 'challenge:date-clock');
  tick();
}
