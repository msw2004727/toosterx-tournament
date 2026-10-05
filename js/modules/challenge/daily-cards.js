import { el } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { dailyProgress, isChallengeOpen, selectedActivityDate } from '../../engine/challenge-days.js';
import { activityTime as now } from '../../core/activity-clock.js';
import { formatScore } from '../../engine/challenge.js';
import { dateLabel } from './days.js';

export function dailyCards({ attempts, challenges, rewards, date, player = null, challengesLoaded = true, attemptsConfirmed = true }) {
  date ??= selectedActivityDate(now(), rewards.dates, rewards.timeZone);
  const p = dailyProgress({ attempts: attempts ?? [], challenges, date, timeZone: rewards.timeZone });
  const settled = dailyProgress({ attempts: (attempts ?? []).filter(a => !a.pending), challenges, date, timeZone: rewards.timeZone });
  const loading = !challengesLoaded || (player && (attempts == null || (!attemptsConfirmed && !p.allComplete)));
  return [
    el('div', { class: 'chal__card chal__card--draw' }, [
      el('div', { class: 'chal__cardHead' }, [
        el('strong', {}, iconText('ticket', `${dateLabel(date)} 我的抽獎資格`)),
        el('span', { class: 'chal__count', text: loading ? '載入中' : `${settled.entries} 張` })
      ]),
      el('div', { class: 'chal__stamps', role: 'group', 'aria-label': `已完成 ${p.done.length} / ${p.total} 項` },
        p.required.map((id, i) => el('span', { class: 'chal__stamp', 'data-done': String(p.done.includes(id)),
          title: challenges.find(c => c.challengeId === id)?.name ?? id,
          'aria-label': `第 ${i + 1} 項${p.done.includes(id) ? '已完成' : '未完成'}`
        }, p.done.includes(id) ? icon('check') : String(i + 1)))),
      el('div', { class: 'chal__qualification', 'data-qualified': String(settled.entries > 0) }, [
        el('strong', { text: loading ? '正在載入當日集章紀錄' : !p.total ? '本日沒有開放活動'
          : settled.allComplete ? '已取得 1 次抽獎機會' : p.allComplete ? '今日集章完成，待同步確認'
            : player ? '尚未取得當日抽獎資格' : '完成本日開放攤位即可取得抽獎機會' }),
        el('p', { class: 'chal__hint', text: loading ? '紀錄載入後會自動更新。'
          : p.allComplete ? `當日 ${p.total} 項已全部完成。重複登錄不增加抽獎次數。`
            : p.total ? `已完成 ${p.done.length} / ${p.total} 項，還差 ${p.missing.length} 項。` : '本日不發放抽獎券。' })
      ])
    ]),
    el('ul', { class: 'chal__list' }, challenges.map(c => {
      const open = isChallengeOpen(c, date), done = p.done.includes(c.challengeId), b = p.bests[c.challengeId];
      return el('li', { class: 'chal__item', 'data-done': String(done), 'data-open': String(open) }, [
        el('span', { class: 'chal__itemIcon' }, icon(c.icon || 'target')),
        el('div', { class: 'chal__itemMain' }, [
          el('strong', { class: 'chal__itemName', text: c.shortName || c.name || c.challengeId }),
          el('span', { class: 'chal__itemVenue', text: c.boothLocation ?? '' })
        ]),
        el('span', { class: 'chal__itemScore', text: !open ? '本日未開放' : loading ? '載入中'
          : b ? formatScore(b.rawValue, c) : done ? '已完成' : c.inputMode === 'checkin' ? '未簽到' : '未挑戰' }),
        done ? el('span', { class: 'chal__itemDone' }, icon('check')) : null
      ]);
    }))
  ];
}
