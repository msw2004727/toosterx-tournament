import { el } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { roundProgress } from '../../engine/challenge-rounds.js';
import { activityDate } from '../../engine/challenge-days.js';
import { activityTime as now } from '../../core/activity-clock.js';
import { formatScore } from '../../engine/challenge.js';
import { dateLabel } from './days.js';

export function roundCards({ player, playerId = player?.playerId, attempts, challenges, rewards, date,
  challengesLoaded, attemptsConfirmed, owner = false, nextCardBusy = false, onNextCard }) {
  const progress = roundProgress({ player, playerId, attempts: attempts ?? [], challenges, date, timeZone: rewards.timeZone });
  const latest = progress.rounds.at(-1);
  const loading = !challengesLoaded || (player && attempts == null);
  const awaiting = player && !attemptsConfirmed;
  const rows = progress.rounds.map(row => {
    const saved = player?.challengeRounds?.[date]?.find(r => r.code === row.code);
    const qualified = !loading && !awaiting && saved?.entries === 1 && row.entries === 1;
    const active = row.code === latest.code;
    const enabled = owner && qualified && active && date === activityDate(now(), rewards.timeZone)
      && rewards.nextCardEnabled !== false && navigator.onLine && !nextCardBusy && typeof onNextCard === 'function';
    return el('div', { class: 'chal__card chal__card--draw', 'data-round': row.number, 'data-code': row.code ?? '' }, [
      el('div', { class: 'chal__cardHead' }, [
        el('strong', {}, iconText('ticket', `${dateLabel(date)} 我的抽獎資格${row.number === 1 ? '' : row.number}`)),
        el('span', { class: 'chal__count', text: loading ? '載入中' : awaiting ? '待確認' : `${qualified ? 1 : 0} 張` })
      ]),
      el('div', { class: 'chal__stamps', role: 'group', 'aria-label': `第 ${row.number} 輪已完成 ${row.done.length} / ${row.total} 項` },
        row.required.map((id, i) => el('span', { class: 'chal__stamp', 'data-done': String(row.done.includes(id)),
          title: challenges.find(c => c.challengeId === id)?.name ?? id,
          'aria-label': `第 ${i + 1} 項${row.done.includes(id) ? '已完成' : '未完成'}`
        }, row.done.includes(id) ? icon('check') : String(i + 1)))),
      el('small', { class: 'chal__roundCode' }, [
        el('span', { text: '本輪碼號：' }),
        el(row.code ? 'strong' : 'span', { class: row.code ? 'chal__roundCodeValue' : '', text: row.code ?? '尚未領卡' })
      ]),
      el('div', { class: 'chal__qualification', 'data-qualified': String(qualified) }, [
        el('strong', { text: loading ? '正在載入當日集章紀錄' : awaiting ? '離線資料，等待同步確認'
          : qualified ? '已取得 1 次抽獎機會' : row.entries ? '本輪集章完成，待伺服器確認'
            : !row.total ? '本日沒有開放活動' : '尚未取得當日抽獎資格' }),
        el('p', { class: 'chal__hint', text: qualified ? `本輪 ${row.total} 項已集滿，資格保留。`
          : `已完成 ${row.done.length} / ${row.total} 項，還差 ${row.missing.length} 項。` })
      ]),
      active && player ? el('div', { class: 'chal__roundActions' }, el('button', {
        class: 'btn btn--sm', type: 'button', disabled: !enabled, onClick: () => onNextCard?.(date, row.code)
      }, iconText('ticket', nextCardBusy ? '配發中…' : '代建新卡（領新碼進入下一輪）'))) : null
    ]);
  });
  return [...rows, el('ul', { class: 'chal__list' }, challenges.map(c => {
    const open = c.dailyOpen?.[date] === true, done = latest.done.includes(c.challengeId), b = latest.bests[c.challengeId];
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
  }))];
}
