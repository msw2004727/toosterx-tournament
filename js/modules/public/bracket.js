import { el, mount, skeleton } from '../../core/ui.js';
import { hold } from '../../core/store.js';
import { setDivisionTheme } from '../../core/division-theme.js';
import { navigate } from '../../core/router.js';
import { icon, iconText } from '../../core/icons.js';
import { dateTimeLabel, scoreText, pkText, STATUS_LABEL } from '../../lib/format.js';
import { pageHead, empty, matchRow, sectionCard } from './bits.js';
import { divisionTabs } from './division-tabs.js';
import { buildBracketModel, isWinningBracketNode } from './bracket-model.js';
import { watchBracketDivision, watchBracketFormats, watchBracketMatches } from './data.js';

/** 三個公開監聽；不讀私人名冊、不寫比賽、不自行解算小組排名。 */
export function publicBracket({ params: { divisionId }, scope, view }) {
  const root = el('div', { class: 'pub pbracket-page' });
  mount(view, root);
  const state = { division: null, formats: null, matches: null, error: null, cached: false };
  let disposed = false;
  const observers = [];
  hold(scope, () => { disposed = true; observers.splice(0).forEach(o => o.disconnect()); });
  const failed = err => { state.error = err; render(); };
  watchBracketDivision(scope, divisionId, d => { state.division = d; render(); }, failed);
  watchBracketFormats(scope, formats => { state.formats = formats; render(); }, failed);
  watchBracketMatches(scope, divisionId, (matches, meta) => {
    state.matches = matches; state.cached = meta?.fromCache === true; render();
  }, failed);
  render();

  function render() {
    if (disposed) return;
    const scrolls = [...root.querySelectorAll('.pbracket__scroll')].map(n => n.scrollLeft);
    const focused = root.contains(document.activeElement) ? document.activeElement?.dataset?.nodeId : null;
    observers.splice(0).forEach(o => o.disconnect());
    setDivisionTheme(root, state.division || divisionId);
    mount(root, pageHead(state.division?.name || divisionId, {
      sub: state.division ? `${state.division.playersOnField ?? ''}人制　·　每場 ${state.division.matchDurationMin ?? ''} 分鐘` : '',
      onBack: () => navigate('/')
    }), divisionTabs(divisionId, 'bracket'), body());
    [...root.querySelectorAll('.pbracket__scroll')].forEach((n, i) => { n.scrollLeft = scrolls[i] ?? Math.max(0, (n.scrollWidth - n.clientWidth) / 2); });
    for (const tree of root.querySelectorAll('.pbracket__tree')) {
      const viewport = tree.closest('.pbracket__viewport');
      const draw = () => { drawLinks(tree); viewport.__updateHints(); };
      const observer = new ResizeObserver(draw);
      observers.push(observer); observer.observe(tree);
      observer.observe(viewport);
      for (const node of tree.querySelectorAll('.pbracket__node')) observer.observe(node);
      draw();
    }
    if (focused) [...root.querySelectorAll('[data-node-id]')].find(n => n.dataset.nodeId === focused)?.focus({ preventScroll: true });
  }

  function body() {
    if (state.error) return empty('讀不到晉級圖', '請重新載入後再試。', { label: '重新載入', onClick: () => navigate(`/division/${encodeURIComponent(divisionId)}?tab=bracket`) });
    if (!state.division || !state.formats || !state.matches) return skeleton(4);
    if (state.division.missing) return empty('找不到組別', '請返回首頁選擇組別。');
    if (state.division.schedulePublished !== true) return empty('賽程準備中', '發布賽程後即可查看晉級與名次對戰。');
    const model = buildBracketModel(state.formats[state.division.formatId], state.matches, state.division);
    if (model.state === 'none') return empty('本組採循環賽', '名次請查看積分榜。');
    if (model.state !== 'ready') return empty('對戰圖整理中', '賽制資料尚未完整，請先查看賽程。');
    return el('div', { class: 'pbracket' }, [
      state.cached ? el('p', { class: 'notice notice--info', role: 'status', text: '目前顯示快取資料，連線恢復後會自動更新。' }) : null,
      el('p', { class: 'pbracket__hint' }, [icon('move-vertical'), el('span', { text: '上下滑動查看輪次，由下往上看晉級；點選隊伍方框可查看比賽。' })]),
      ...model.trees.map(tree => treeView(tree)),
      model.extra.length ? sectionCard('其他名次賽', 'trophy',
        el('ul', { class: 'plist' }, model.extra.map(entry => entry.match
          ? matchRow({ match: entry.match, division: state.division, onOpen: openMatch })
          : el('li', { class: 'pbracket__missing', text: `${entry.slot.label}：場次待排定` })))) : null
    ]);
  }

  function treeView(tree) {
    const canvas = el('div', { class: 'pbracket__tree', style: `--bracket-leaves:${tree.leafCount};min-width:${tree.leafCount * 160 + (tree.leafCount - 1) * 16}px` });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('pbracket__links'); svg.setAttribute('aria-hidden', 'true');
    canvas.append(svg);
    for (let depth = 0; depth < tree.levels; depth++) {
      canvas.append(el('div', { class: 'pbracket__tier' }, tree.nodes.filter(n => n.depth === depth).map(n => {
        const m = n.match;
        const started = ['live', 'halftime', 'finished', 'confirmed', 'walkover'].includes(m?.status);
        const score = scoreText(m?.score, state.division.display?.mercyRule);
        const scored = started && n.teamId;
        const caption = n.side ? n.label : tree.title;
        const game = m?.label || '場次待排定';
        const stateText = m ? STATUS_LABEL[m.status] || '待確認' : '場次待排定';
        const points = scored && n.side ? score[n.side] : null;
        const won = isWinningBracketNode(n);
        const button = el(m ? 'button' : 'div', {
          class: `pbracket__node${n.depth === 0 ? ' pbracket__node--root' : ''}${!n.teamId ? ' is-pending' : ''}${won ? ' is-winner' : ''}`,
          type: m ? 'button' : null, dataset: { nodeId: n.id },
          'aria-label': `${caption}，${n.name}，${game}，${stateText}${won ? '，已獲勝' : ''}${points != null ? `，比分 ${points}` : ''}`,
          onClick: m ? () => openMatch(m) : null
        }, [
          won ? el('span', { class: 'pbracket__winnerMark', 'aria-hidden': 'true' }, icon('check')) : null,
          n.depth === 0 ? icon('trophy') : null,
          !n.children.length && n.depth < tree.levels - 1 ? el('span', { class: 'pbracket__source', text: '輪空' }) : null,
          n.name !== caption ? el('span', { class: 'pbracket__source', text: caption }) : null,
          el('span', { class: 'pbracket__name', text: n.name }),
          points != null ? el('span', { class: 'pbracket__score num', text: points }) : null,
          el('span', { class: 'pbracket__game', text: game }),
          el('span', { class: 'pbracket__status', text: stateText }),
          started && pkText(m) ? el('span', { class: 'pbracket__pk num', text: pkText(m) }) : null,
          m?.kickoffAt ? el('span', { class: 'pbracket__time', text: dateTimeLabel(m.kickoffAt) }) : null
        ]);
        return el('div', { class: 'pbracket__cell', style: `grid-column:${n.start + 1} / span ${n.span}` }, button);
      })));
    }
    canvas.__edges = tree.nodes.flatMap(n => n.children.map(c => [n.id, c.id]));
    const scroll = el('div', { class: 'pbracket__scroll', tabindex: '0', role: 'region', 'aria-label': `${tree.title}對戰圖，可左右捲動`, onScroll: () => viewport.__updateHints() }, canvas);
    const move = direction => scroll.scrollBy({ left: direction * scroll.clientWidth * .75,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const left = el('button', { class: 'pbracket__scrollArrow', type: 'button', 'aria-label': `${tree.title}晉級圖向左查看`, onClick: () => move(-1) }, icon('chevrons-left'));
    const right = el('button', { class: 'pbracket__scrollArrow', type: 'button', 'aria-label': `${tree.title}晉級圖向右查看`, onClick: () => move(1) }, icon('chevrons-right'));
    const guide = el('div', { class: 'pbracket__scrollGuide' }, [left, el('span', { text: '左右滑動看更多' }), right]);
    const viewport = el('div', { class: 'pbracket__viewport' }, [guide, scroll]);
    viewport.__updateHints = () => {
      guide.hidden = scroll.scrollWidth <= scroll.clientWidth + 1;
      left.disabled = scroll.scrollLeft <= 1;
      right.disabled = scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 1;
    };
    return el('section', { class: 'pbracket__section', 'aria-label': `${tree.title}晉級圖` }, [
      el('h2', { class: 'pbracket__heading' }, iconText('trophy', `${tree.title}之路`)),
      viewport
    ]);
  }
  function openMatch(m) { navigate(`/match/${encodeURIComponent(m.matchId)}`); }
}

function drawLinks(tree) {
  if (!tree.isConnected) return;
  const rect = tree.getBoundingClientRect(), svg = tree.querySelector('.pbracket__links');
  svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  const nodes = new Map([...tree.querySelectorAll('[data-node-id]')].map(n => [n.dataset.nodeId, n.getBoundingClientRect()]));
  mount(svg, (tree.__edges || []).map(([parent, child]) => {
    const p = nodes.get(parent), c = nodes.get(child);
    const px = p.left - rect.left + p.width / 2, py = p.bottom - rect.top;
    const cx = c.left - rect.left + c.width / 2, cy = c.top - rect.top;
    const mid = (py + cy) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${px},${py} V${mid} H${cx} V${cy}`);
    return path;
  }));
}
