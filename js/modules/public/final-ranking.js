import {el} from '../../core/ui.js';
import {navigate} from '../../core/router.js';
import {icon} from '../../core/icons.js';
import {sectionCard} from './bits.js';
import {publishedFinalRanking, finalRankLabel} from './division-progress.js';

/** 積分榜與晉級圖共用正式名次呈現，不自行推算勝負。 */
export function finalRankingCard(division, teams = []) {
  const ranking = publishedFinalRanking(division);
  const nameOf = row => {
    const team = teams.find(t => t.teamId === row.teamId);
    return team?.shortName || team?.name || row.name || row.teamId;
  };
  const teamButton = row => el('button', {
    class: 'pstand-final__team', type: 'button', text: nameOf(row),
    onClick: () => navigate(`/team/${encodeURIComponent(row.teamId)}`)
  });
  return sectionCard('最終名次', 'trophy', ranking.length ? [
    el('div', { class: 'pstand-final__podium', 'aria-label': '前三名' }, [2, 1, 3].map(rank => {
      const row = ranking.find(r => r.rank === rank);
      if (!row) return null;
      return el('div', { class: `pstand-final__place pstand-final__place--${rank}` }, [
        teamButton(row),
        el('div', { class: 'pstand-final__base' }, [icon(rank === 1 ? 'trophy' : 'medal'),
          el('span', { text: finalRankLabel(rank) })])
      ]);
    })),
    ranking.some(r => r.rank > 3) ? el('ol', { class: 'pstand-final__list', start: 4 }, ranking.filter(r => r.rank > 3).map(row =>
      el('li', { class: 'pstand-final__row' }, [el('span', { class: 'pstand-final__rank', text: finalRankLabel(row.rank) }), teamButton(row)]))) : null,
    el('p', { class: 'pstand__legend', text: '主辦已發布正式最終名次' })
  ] : el('p', { class: 'pstand-final__pending', text: '最終名次尚未公布，主辦發布後會顯示於此。' }));
}
