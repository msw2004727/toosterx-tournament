import { el } from '../../core/ui.js';
import { icon } from '../../core/icons.js';

export function challengeStamp(challenge, number, done) {
  const name = challenge?.shortName || challenge?.name || `第 ${number} 關`;
  const status = done ? '已完成' : '未完成';
  return el('span', { class: 'chal__stamp', 'data-done': String(done),
    title: `${name}：${status}`, 'aria-label': `第 ${number} 項 ${name} ${status}` }, [
    el('span', { class: 'chal__stampNumber', 'aria-hidden': 'true', text: String(number) }),
    el('span', { class: 'chal__stampIcon', 'aria-hidden': 'true' }, icon(challenge?.icon || 'target')),
    done ? el('span', { class: 'chal__stampCheck', 'aria-hidden': 'true' }, icon('check')) : null
  ]);
}
