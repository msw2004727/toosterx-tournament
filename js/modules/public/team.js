/**
 * 球隊頁 `#/team/:teamId` 與球員頁 `#/player/:teamId/:memberId`
 * ------------------------------------------------------------------
 * 規格：docs/03-功能規格-公開端.md §7、§8
 *
 * ⚠️ 隱私（R-PRIV-001、docs/03 §7.2–7.3）：
 *    公開端**只讀 teams/{id}/roster**（Function 產生的公開投影），
 *    絕不讀 members（那裡有生日與身分證後四碼）。
 *    讀回來的每一筆再經 publicMember() 過一次白名單——
 *    投影 Function 還沒上線，種子與手動修補都可能讓私密欄位混進來。
 */

import { el, mount, skeleton } from '../../core/ui.js';
import { navigate } from '../../core/router.js';
import { icon, iconText } from '../../core/icons.js';
import { user, onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { dateLabelFromYmd } from '../../lib/format.js';
import * as data from './data.js';
import {
  publicMember, sortRoster, sortByKickoff, isDoneMatch, sideLabel
} from './selectors.js';
import { pageHead, empty, matchRow, sectionCard, shareButton } from './bits.js';

const TABS = [
  { key: 'roster', label: '名單', icon: 'team' },
  { key: 'schedule', label: '賽程', icon: 'list' }
];

export async function publicTeam({ params, view, query, scope }) {
  const { teamId } = params;
  const root = el('div', { class: 'pub' });
  mount(view, root);
  mount(root, skeleton(4));

  const state = {
    team: null, roster: [], matches: [], division: null,
    tab: TABS.some(t => t.key === query?.get('tab')) ? query.get('tab') : 'roster',
    loaded: false, notFound: false, rosterHidden: false
  };

  // 隊長看自己的球隊時要有一條路通往管理頁（審核、送出、取消都在那裡）。
  // 登入狀態晚一點才到位，所以要跟著重畫（2026-09-06 驗收 R-6：「隊長權限要有編輯／審核的連結」）
  hold(scope, onAuth(() => { if (state.loaded && !state.notFound) render(); }), 'auth:pteam');

  try {
    state.team = await data.getTeam(teamId);
    if (!state.team) { state.notFound = true; state.loaded = true; render(); return; }

    // 球隊可以選擇不公開名單（docs/03 §7.3）
    state.rosterHidden = state.team.publicRoster === false;

    const [raw, matches, division] = await Promise.all([
      state.rosterHidden ? Promise.resolve([]) : data.getRoster(teamId).catch(() => []),
      data.getTeamMatches(teamId).catch(() => []),
      state.team.divisionId ? data.getDivision(state.team.divisionId).catch(() => null) : null
    ]);
    state.roster = sortRoster(raw.map(publicMember));
    state.matches = sortByKickoff(matches);
    state.division = division;
  } catch (err) {
    state.loaded = true;
    mount(root, pageHead('球隊', { onBack: () => history.back() }),
      empty('讀不到這支球隊', err?.message || '請稍後再試。',
        { label: '回首頁', onClick: () => navigate('/') }));
    return;
  }

  state.loaded = true;
  render();

  function render() {
    if (state.notFound) {
      mount(root, pageHead('找不到球隊', { onBack: () => history.back() }),
        empty('查無這支球隊', `代碼 ${teamId} 不存在。`,
          { label: '回首頁', onClick: () => navigate('/') }));
      return;
    }
    const t = state.team;
    mount(root,
      pageHead(t.name || teamId, {
        sub: [state.division?.name, t.groupId ? `${t.groupId} 組` : null].filter(Boolean).join('　·　'),
        onBack: () => history.back()
      }),
      recordCard(),
      isCaptain()
        ? el('div', { class: 'pcard pcard--captain', id: 'pteam-captain' }, [
            el('p', { class: 'pcard__note', text: '你是這支球隊的隊長。審核申請、送出報名、取消報名都在管理頁。' }),
            el('button', {
              class: 'btn btn--lg btn--primary', type: 'button',
              onClick: () => navigate(`/team/${encodeURIComponent(teamId)}/manage`)
            }, iconText('team', '管理名單／審核申請'))
          ])
        : null,
      el('div', { class: 'pmatch__actions' }, [
        shareButton(`${t.name || teamId}｜FEDA CUP 2026`, location.href)
      ]),
      tabBar(),
      state.tab === 'schedule' ? scheduleTab() : rosterTab()
    );
  }

  /** 隊長：teams 文件上的 captainUid 就是我（docs/10 §1.2，隊長不是全站角色） */
  function isCaptain() {
    const u = user();
    return !!u && !!state.team?.captainUid && state.team.captainUid === u.uid;
  }

  /** 戰績只從已完賽的場次數，不重算積分（積分是 standings 的事） */
  function recordCard() {
    const done = state.matches.filter(isDoneMatch);
    let w = 0, d = 0, l = 0, gf = 0, ga = 0;
    for (const m of done) {
      const side = m.home?.teamId === teamId ? 'home' : m.away?.teamId === teamId ? 'away' : null;
      if (!side) continue;
      const mine = m.score?.[side];
      const other = m.score?.[side === 'home' ? 'away' : 'home'];
      if (typeof mine !== 'number' || typeof other !== 'number') continue;
      gf += mine; ga += other;
      if (mine > other) w++; else if (mine < other) l++; else d++;
    }
    const stat = (label, value) => el('div', { class: 'prec__cell' }, [
      el('span', { class: 'prec__val num', text: String(value) }),
      el('span', { class: 'prec__label', text: label })
    ]);
    return el('div', { class: 'prec' }, [
      stat('勝', w), stat('和', d), stat('負', l), stat('進', gf), stat('失', ga)
    ]);
  }

  function tabBar() {
    return el('div', { class: 'ptabs ptabs--sub', role: 'tablist', 'aria-label': '球隊資訊' },
      TABS.map(t => el('button', {
        class: `ptabs__btn ${state.tab === t.key ? 'is-active' : ''}`,
        type: 'button', role: 'tab', 'aria-selected': state.tab === t.key ? 'true' : 'false',
        onClick: () => {
          state.tab = t.key;
          location.replace(`#/team/${encodeURIComponent(teamId)}?tab=${t.key}`);
          render();
        }
      }, iconText(t.icon, t.label))));
  }

  function rosterTab() {
    if (state.rosterHidden) {
      return empty('這支球隊不公開名單', `報名時選擇了不公開，僅顯示人數：${state.team.memberCount ?? '—'} 人`);
    }
    if (!state.roster.length) return empty('名單準備中', '報名審核通過後公布。');

    const players = state.roster.filter(m => m.role === 'player');
    const staffs = state.roster.filter(m => m.role !== 'player');

    return el('div', {}, [
      sectionCard('球員', 'person', el('ul', { class: 'proster' }, players.map(memberRow))),
      staffs.length
        ? sectionCard('教練團', 'whistle', el('ul', { class: 'proster' }, staffs.map(memberRow)))
        : null
    ].filter(Boolean));
  }

  function memberRow(p) {
    return el('li', { class: 'proster__row' }, el('button', {
      class: 'proster__btn', type: 'button',
      onClick: () => navigate(`/player/${encodeURIComponent(teamId)}/${encodeURIComponent(p.memberId)}`)
    }, [
      el('span', { class: 'proster__no num', text: p.jerseyNo != null ? String(p.jerseyNo) : '' }),
      // 隊長徽章包在姓名格裡，不佔 grid 的一欄——
      // 否則有隊長的那一列會變成 6 個子節點塞進 5 欄，最後一欄（箭頭）被擠到第二行
      el('span', { class: 'proster__nameWrap' }, [
        el('span', { class: 'proster__name', text: p.displayName || '' }),
        p.isCaptain ? el('span', { class: 'proster__tag', text: '隊長' }) : null
      ].filter(Boolean)),
      el('span', { class: 'proster__pos', text: p.position || roleLabel(p.role) }),
      el('span', { class: 'proster__goals num', text: p.stats.goals ? `${p.stats.goals} 球` : '' }),
      icon('forward')
    ]));
  }

  function scheduleTab() {
    // 這一組的賽程還沒發布就當成「準備中」（同組別頁）
    const rows = state.division?.schedulePublished === false ? [] : state.matches;
    if (!rows.length) return empty('賽程準備中', '敬請期待。');
    return el('ul', { class: 'plist' }, rows.map(m => matchRow({
      match: m, division: state.division,
      onOpen: x => navigate(`/match/${encodeURIComponent(x.matchId)}`)
    })));
  }
}

/* ── 球員頁 ─────────────────────────────────────────────── */

export async function publicPlayer({ params, view }) {
  const { teamId, memberId } = params;
  const root = el('div', { class: 'pub' });
  mount(view, root);
  mount(root, skeleton(3));

  let team = null, me = null, matches = [], timeline = null;
  try {
    team = await data.getTeam(teamId);
    const roster = await data.getRoster(teamId);
    const raw = roster.find(m => m.memberId === memberId);
    me = raw ? publicMember(raw) : null;
    if (!me) {
      mount(root, pageHead('找不到球員', { onBack: () => history.back() }),
        empty('查無這位球員', '可能是名單尚未公開，或連結有誤。',
          { label: '回球隊', onClick: () => navigate(`/team/${encodeURIComponent(teamId)}`) }));
      return;
    }
    matches = sortByKickoff(await data.getTeamMatches(teamId).catch(() => []));
    // 需要 collectionGroup 索引，還沒開就回 null（見 data.js 的說明）
    timeline = await data.getPlayerTimeline(memberId);
  } catch (err) {
    mount(root, pageHead('球員', { onBack: () => history.back() }),
      empty('讀不到這位球員', err?.message || '請稍後再試。'));
    return;
  }

  const s = me.stats;
  const stat = (label, value) => el('div', { class: 'prec__cell' }, [
    el('span', { class: 'prec__val num', text: String(value) }),
    el('span', { class: 'prec__label', text: label })
  ]);

  mount(root,
    pageHead(me.displayName || memberId, {
      sub: [me.jerseyNo != null ? `#${me.jerseyNo}` : null, me.position || roleLabel(me.role),
            team?.name].filter(Boolean).join('　·　'),
      onBack: () => history.back()
    }),
    el('div', { class: 'prec' }, [
      stat('出賽', s.apps), stat('進球', s.goals), stat('助攻', s.assists),
      stat('黃牌', s.yellow), stat('紅牌', s.red)
    ]),
    sectionCard('出賽紀錄', 'list', appearances())
  );

  function appearances() {
    if (timeline === null) {
      // 誠實說明：這不是「沒有紀錄」，是這項功能還沒接上
      return empty('出賽紀錄整理中', '每一場的進球與卡片明細會在賽事期間開放。上方的累計數字已經是最新的。');
    }
    const done = matches.filter(isDoneMatch);
    if (!done.length) return empty('還沒有出賽紀錄', '球隊完賽後會出現在這裡。');
    const byMatch = new Map();
    for (const e of timeline) {
      if (e.voided) continue;
      if (!byMatch.has(e.matchId)) byMatch.set(e.matchId, []);
      byMatch.get(e.matchId).push(e);
    }
    return el('ul', { class: 'papp' }, done.map(m => {
      const evs = byMatch.get(m.matchId) || [];
      const opp = m.home?.teamId === teamId ? sideLabel(m, 'away') : sideLabel(m, 'home');
      const goals = evs.filter(e => ['goal', 'penalty_scored'].includes(e.type)).length;
      const cards = evs.filter(e => e.type === 'card').length;
      return el('li', { class: 'papp__row' }, [
        el('span', { class: 'papp__date', text: dateLabelFromYmd(m.date) }),
        el('button', {
          class: 'papp__opp', type: 'button',
          onClick: () => navigate(`/match/${encodeURIComponent(m.matchId)}`)
        }, `vs ${opp}`),
        el('span', { class: 'papp__marks num', text: [goals ? `${goals} 球` : '', cards ? `${cards} 卡` : ''].filter(Boolean).join('　') || '—' })
      ]);
    }));
  }
}

const roleLabel = r => ({ coach: '教練', manager: '領隊', staff: '隊職員', medic: '隊醫' })[r] || '';

export { roleLabel };
