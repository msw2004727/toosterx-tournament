/**
 * LIVE 賽務台
 * ------------------------------------------------------------------
 * 路由：#/staff/match/:matchId
 * 規格：docs/04-功能規格-賽務裁判端.md §5
 *
 * 設計鐵律（企劃書第三十二章）：
 *   ・高頻操作 ≤ 3 步：進球 = 點進球 → 選隊 → 選人
 *   ・主要動作在螢幕下半部，最小 56px 高（單手拇指可及）
 *   ・每一次送出都明示「已儲存／待同步／失敗」，絕不假成功
 *   ・離線可用：計時在本機跑，寫入排隊
 */

import { el, toast, confirmDialog, sheet, buzz, emptyState, mount } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { clockText, displayMinute, periodLabel, STATUS_LABEL, hhmm } from '../../lib/format.js';
import {
  elapsedSec, startClock, pauseClock, resetClock, nextPeriod,
  statusForPeriod, isPlayingPeriod, startTicker, now, isInAddedTime
} from '../../core/clock.js';
import { user, can, canScore, assignedToVenue } from '../../core/firebase.js';
import { navigate } from '../../core/router.js';
import {
  watchMatch, watchTimeline, getTeamRoster, getMatchSheet, getDivision,
  patchMatch, addTimelineEvent, voidTimelineEvent, writeAudit,
  submitFinish, undoFinish
} from './data.js';
import {
  buildGoalEvent, buildCardEvent, buildSubEvent, buildPeriodEvent,
  buildFinishPatch, finishSummary, suggestCardType, sentOffPlayerIds,
  checkSubLimit, eventText, EVENT_ICON, CARD_LABEL, sortEventsDesc,
  scoreFromTimeline, isLive, undoState, buildUndoPatch, UNDO_WINDOW_SEC
} from './live-actions.js';
import { syncIndicator } from './sync-indicator.js';
import { isOnline } from '../../core/sync.js';

export async function liveConsole({ params, scope, view }) {
  const { matchId } = params;

  const state = {
    match: null,
    events: [],
    division: null,
    rosters: { home: [], away: [] },
    loaded: false
  };

  const indicator = syncIndicator();
  const root = el('div', { class: 'live' });
  view.replaceChildren(root);

  let stopTicker = null;

  watchMatch(scope, matchId, async (m) => {
    const first = !state.match;
    state.match = m;
    if (!m) { render(); return; }
    if (first) {
      // 這三筆只讀一次：組別設定與名單在比賽期間不會變
      state.division = await getDivision(m.divisionId).catch(() => null);
      await loadRosters();
      state.loaded = true;
      stopTicker = startTicker(() => paintClock());
    }
    render();
  }, err => {
    console.error('[live] match', err);
    mount(root, emptyState({ title: '讀不到這個場次', note: err.message }));
  });

  watchTimeline(scope, matchId, evs => { state.events = evs; render(); });

  async function loadRosters() {
    const m = state.match;
    for (const side of ['home', 'away']) {
      const teamId = m[side]?.teamId;
      if (!teamId) { state.rosters[side] = []; continue; }
      // 出場名單優先；還沒確認名單時退回全隊名冊，現場才不會卡住
      const s = await getMatchSheet(matchId, teamId).catch(() => null);
      state.rosters[side] = s?.players?.length
        ? s.players
        : await getTeamRoster(teamId).catch(() => []);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  畫面
  // ══════════════════════════════════════════════════════════

  function render() {
    const m = state.match;
    if (!m) {
      mount(root, state.loaded
        ? emptyState({ title: '找不到這個場次', actionLabel: '回賽務首頁', onAction: () => navigate('/staff') })
        : el('p', { class: 'live__loading', text: '載入中…' }));
      return;
    }

    const readOnly = !canScore() || !assignedToVenue(m.venueId) || m.lock?.locked === true;

    mount(root,
      header(m),
      scoreboard(m, readOnly),
      clockPanel(m, readOnly),
      readOnly ? readOnlyNotice(m) : actionBar(m),
      timelineList(m, readOnly),
      finishBar(m, readOnly)
    );
    paintClock();
  }

  function header(m) {
    return el('div', { class: 'live__head' }, [
      el('button', { class: 'live__back', type: 'button', 'aria-label': '返回', onClick: () => navigate('/staff') }, icon('back')),
      el('div', { class: 'live__title' }, [
        el('strong', { text: m.label || m.matchId }),
        el('span', { class: 'live__meta', text: `${m.venueName || m.venueId || ''}．${hhmm(m.kickoffAt)}．${STATUS_LABEL[m.status] || m.status}` })
      ]),
      indicator.node
    ]);
  }

  function scoreboard(m, readOnly) {
    const mk = side => {
      const team = m[side] || {};
      return el('div', { class: `sb__side sb__side--${side}` }, [
        el('span', { class: 'sb__team', text: team.name || team.displayName || '待定' }),
        el('div', { class: 'sb__num-wrap' }, [
          readOnly ? null : el('button', {
            class: 'sb__step', type: 'button', 'aria-label': `${team.name || side} 減一分`,
            onClick: () => adjustScore(side, -1)
          }, '−'),
          el('span', { class: 'sb__num num', id: `score-${side}`, text: String(m.score?.[side] ?? 0) }),
          readOnly ? null : el('button', {
            class: 'sb__step', type: 'button', 'aria-label': `${team.name || side} 加一分`,
            onClick: () => adjustScore(side, +1)
          }, '＋')
        ].filter(Boolean))
      ]);
    };
    // 中間的分隔號要跟兩側「數字那一列」對齊，所以給它一個同結構的隱形隊名列。
    // 用 margin 硬調的話，字級一換（窄機的 --fs-score 會縮）就又跑掉了。
    const mid = el('div', { class: 'sb__mid' }, [
      el('span', { class: 'sb__team', 'aria-hidden': 'true', text: '　' }),
      el('span', { class: 'sb__dash', 'aria-hidden': 'true', text: '-' })
    ]);
    return el('div', { class: 'sb' }, [mk('home'), mid, mk('away')]);
  }

  function clockPanel(m, readOnly) {
    const period = m.period || 'pre';
    const running = m.clock?.running === true;
    const canPlay = isPlayingPeriod(period);

    return el('div', { class: 'clockbox' }, [
      el('div', { class: 'clockbox__period', text: periodLabel(period, state.division?.periods ?? 2) }),
      el('div', { class: 'clockbox__time num', id: 'match-clock', text: '00:00' }),
      el('div', { class: 'clockbox__minute', id: 'match-minute' }),
      // ⚠️ 時鐘是獨立的一條權限（`match.period`）。主辦關掉之後不要只是
      //    把按鈕拿掉——現場會以為系統壞了，然後開始重整頁面。
      (readOnly || can('match.period')) ? null
        : el('p', { class: 'clockbox__note', text: '主辦已關閉你的「控制比賽時鐘」。' }),
      (readOnly || !can('match.period')) ? null : el('div', { class: 'clockbox__btns' }, [
        period === 'pre'
          ? el('button', { class: 'btn btn--lg btn--primary', type: 'button', onClick: () => startPeriod('h1') }, iconText('play', '開賽'))
          : period === 'ht'
            ? el('button', { class: 'btn btn--lg btn--primary', type: 'button', onClick: () => startPeriod('h2') }, iconText('play', '開始下半場'))
            : period === 'ft'
              ? null
              : el('button', {
                  class: 'btn btn--lg', type: 'button',
                  onClick: () => (running ? pause() : resume())
                }, running ? iconText('pause', '暫停') : iconText('play', '繼續')),
        canPlay ? el('button', {
          class: 'btn btn--lg btn--ghost', type: 'button', onClick: () => endPeriod()
        }, iconText('stop', `結束${periodLabel(period, state.division?.periods ?? 2)}`)) : null
      ].filter(Boolean))
    ].filter(Boolean));
  }

  /** 只更新數字，不重畫整頁——每 250ms 重畫整頁會讓按鈕點不到 */
  function paintClock() {
    const m = state.match;
    if (!m) return;
    const sec = elapsedSec(m.clock, now());
    const t = document.getElementById('match-clock');
    const mi = document.getElementById('match-minute');
    if (t) t.textContent = clockText(sec);
    if (mi) {
      const dur = state.division?.matchDurationMin ?? 30;
      const per = state.division?.periods ?? 2;
      const txt = displayMinute(sec, m.period, dur, per);
      mi.textContent = txt;
      mi.classList.toggle('is-added', isInAddedTime(m.clock, m.period, dur, per));
    }

    // 撤回倒數：只換數字。歸零的那一秒重畫整列，把按鈕換成說明文字。
    const left = document.getElementById('undo-left');
    if (left) {
      const u = undoState({ match: m, nowMs: now(), online: isOnline(), uid: user()?.uid ?? null });
      if (!u.can) render();
      else left.textContent = mmss(u.leftSec);
    }
  }

  function actionBar(m) {
    return el('div', { class: 'actions' }, [
      bigBtn('goal', '進球', () => flowGoal()),
      bigBtn('card', '出牌', () => flowCard(), 'icon--card-fill icon--yellow'),
      bigBtn('sub',  '換人', () => flowSub())
    ]);
  }

  // 參數叫 iconName 而不是 icon：叫 icon 會蓋掉上面 import 進來的 icon()
  function bigBtn(iconName, label, onClick, iconCls) {
    return el('button', { class: 'bigbtn', type: 'button', onClick }, [
      el('span', { class: 'bigbtn__icon' }, icon(iconName, { cls: iconCls })),
      el('span', { class: 'bigbtn__label', text: label })
    ]);
  }

  function readOnlyNotice(m) {
    // 還在自撤回視窗內時不要說「需要管理員解鎖」——下面那一列就有撤回按鈕，
    // 兩句話互相矛盾會讓賽務直接放棄，改去打電話。
    const canUndo = undoState({
      match: m, nowMs: now(), online: isOnline(), uid: user()?.uid ?? null
    }).can;
    const why = !canScore() ? '你的帳號沒有記分權限。'
      : !assignedToVenue(m.venueId) ? '這個場次不在你被指派的場地，請聯絡管理員調整指派。'
      : canUndo ? '這場已送出完賽。要修改請先用下方的「撤回完賽」。'
      : '這場已完賽並鎖定，需要管理員解鎖才能修改。';
    return el('div', { class: 'notice notice--warn' }, [
      el('strong', { text: '唯讀模式' }),
      el('span', { text: why })
    ]);
  }

  function timelineList(m, readOnly) {
    const rows = sortEventsDesc(state.events);
    const wrap = el('section', { class: 'tl' }, [
      el('h2', { class: 'tl__head', text: `事件（${rows.filter(isLive).length}）` })
    ]);
    if (!rows.length) {
      wrap.append(el('p', { class: 'tl__empty', text: '還沒有任何事件。記錄進球、出牌或換人後會顯示在這裡。' }));
      return wrap;
    }
    const dur = state.division?.matchDurationMin ?? 30;
    const per = state.division?.periods ?? 2;
    wrap.append(el('ul', { class: 'tl__list' }, rows.map(e => el('li', {
      class: `tl__item ${e.voided ? 'is-voided' : ''} tl__item--${e.side}`
    }, [
      el('span', { class: 'tl__min num', text: displayMinute(e.clockSec ?? 0, e.periodId, dur, per) }),
      // 黃牌與紅牌要一眼分得出來——裁判在陽光下掃時間軸，靠的是顏色不是文字
      el('span', { class: 'tl__icon' }, icon(EVENT_ICON[e.type] || 'note', {
        cls: e.type === 'card'
          ? `icon--card-fill ${e.cardType === 'yellow' ? 'icon--yellow' : 'icon--red'}`
          : undefined
      })),
      el('span', { class: 'tl__text', text: eventText(e) }),
      el('span', { class: 'tl__team', text: teamNameOf(e.side) }),
      (!readOnly && !e.voided)
        ? el('button', { class: 'tl__more', type: 'button', 'aria-label': '修正這筆事件', onClick: () => voidFlow(e) }, icon('more'))
        : null
    ].filter(Boolean)))));
    return wrap;
  }

  /**
   * 底部主要動作列。
   *
   * ⚠️ 完賽當下就會 lock.locked = true，整頁進入唯讀——但撤回列**必須**留著，
   *    否則三分鐘自撤回這個功能等於不存在（第一版就是這樣寫的，
   *    E2E「完賽並鎖定後進入唯讀模式」剛好蓋不到，差點就出去了）。
   */
  function finishBar(m, readOnly) {
    const submitted = m.status === 'finished' || m.status === 'confirmed' || m.period === 'ft';
    if (submitted) return el('div', { class: 'finishbar' }, [undoBar(m)]);
    if (readOnly) return null;
    // 主辦可以把「送出完賽」從記錄員身上關掉（權限開關）。關掉之後
    // **要說出來並給下一步**：比分照記，完賽找管理員。少了這句，
    // 賽務會一直找那顆按鈕，然後在最忙的時候打電話。
    if (!can('match.finish')) {
      return el('div', { class: 'finishbar' }, [
        el('p', { class: 'undobar__msg', text: '主辦已關閉你的「送出完賽」。比分照記，完賽請找管理員。' })
      ]);
    }
    return el('div', { class: 'finishbar' }, [
      el('button', { class: 'btn btn--xl btn--primary', type: 'button', onClick: () => flowFinish() }, iconText('check', '完賽送出'))
    ]);
  }

  /**
   * 完賽之後的那一列：三分鐘內可以自己撤回（docs/10 §5.3）。
   *
   * 倒數的 DOM 由 paintClock() 每秒更新，不重畫整列——重畫會把手指下的
   * 按鈕抽掉。離線時這裡不會有倒數，只有一句「待同步」，
   * 因為此時根本不知道伺服器認可的送出時間（見 undoState 的註解）。
   */
  function undoBar(m) {
    const u = undoState({
      match: m, nowMs: now(), online: isOnline(),
      uid: user()?.uid ?? null
    });

    // 主辦關掉自撤回時，連倒數都不要畫——畫了就是一個會走完卻按不到的
    // 倒數，跟「離線不得畫限時操作」是同一條理由。
    if (!can('match.undo')) {
      return el('div', { class: 'undobar' }, [
        el('p', { class: 'undobar__msg', id: 'undo-msg', text: '已送出。主辦已關閉自撤回，要修改請找管理員。' })
      ]);
    }
    if (!u.can) {
      return el('div', { class: 'undobar' }, [
        el('p', { class: 'undobar__msg', id: 'undo-msg', text: u.reason || '已送出，積分榜更新中…' })
      ]);
    }
    return el('div', { class: 'undobar' }, [
      el('p', { class: 'undobar__msg' }, [
        document.createTextNode('已送出。發現記錯了？'),
        el('span', { class: 'undobar__left num', id: 'undo-left', text: mmss(u.leftSec) }),
        document.createTextNode(' 內可自行撤回。')
      ]),
      el('button', {
        class: 'btn btn--ghost', type: 'button', onClick: () => flowUndo()
      }, iconText('undo', '撤回完賽'))
    ]);
  }

  const mmss = sec => `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.max(0, sec) % 60).padStart(2, '0')}`;

  async function flowUndo() {
    const m = state.match;
    const u = undoState({ match: m, nowMs: now(), online: isOnline(), uid: user()?.uid ?? null });
    if (!u.can) { toast(u.reason, 'warn'); render(); return; }

    const ok = await confirmDialog({
      title: '撤回完賽',
      body: '場次會退回「進行中」，比分與所有事件都保留，計時歸零。撤回後請記得重新送出完賽。',
      confirmText: '撤回', tone: 'danger'
    });
    if (!ok) return;

    const patch = buildUndoPatch({ uid: user()?.uid ?? null, events: state.events });
    const { promise } = undoFinish(matchId, patch, `撤回完賽　${m.label || matchId}`);
    writeAudit({
      entity: 'match', entityId: matchId, action: 'match.finish.undo',
      before: { status: 'finished' }, after: { status: 'live' },
      reason: `送出者三分鐘內自行撤回（剩 ${u.leftSec} 秒）`
    });
    toast('已送出撤回。狀態請看右上角的燈號。', 'success');
    promise.then(r => {
      if (r.state !== 'saved') {
        toast(`撤回沒有成功：${r.error?.message ?? ''}　場次仍然是已完賽。`, 'error');
      }
    });
  }

  const teamNameOf = side => (side === 'home' || side === 'away')
    ? (state.match?.[side]?.name ?? '') : '';

  // ══════════════════════════════════════════════════════════
  //  操作流程
  // ══════════════════════════════════════════════════════════

  function ctxFor(side) {
    const m = state.match;
    return {
      matchId, events: state.events, side,
      period: m.period || 'pre',
      clockSec: elapsedSec(m.clock, now()),
      minute: Math.floor(elapsedSec(m.clock, now()) / 60),
      uid: user()?.uid ?? null,
      teamId: m[side]?.teamId ?? null
    };
  }

  async function pickSide(title) {
    const m = state.match;
    return sheet({
      title,
      columns: 2,
      options: [
        { value: 'home', label: m.home?.name || '主隊', sub: '主隊' },
        { value: 'away', label: m.away?.name || '客隊', sub: '客隊' }
      ]
    });
  }

  async function pickPlayer(side, { title, allowNone = false, exclude = new Set(), only = null }) {
    const list = (state.rosters[side] || []).filter(p => {
      if (exclude.has(p.memberId)) return false;
      if (only && !only.has(p.memberId)) return false;
      return true;
    });
    const off = sentOffPlayerIds(state.events);
    const options = list.map(p => ({
      value: p.memberId,
      label: p.displayName || p.name || '（未命名）',
      sub: p.jerseyNo != null ? `#${p.jerseyNo}` : '',
      note: off.has(p.memberId) ? '已離場' : '',
      disabled: off.has(p.memberId)
    }));
    if (allowNone) options.unshift({ value: '__none__', label: '不指定球員', sub: '', tone: 'ghost' });
    if (!options.length) {
      toast('這一隊還沒有名單。請先到「出場名單」確認，或改用「不指定球員」。', 'warn');
      return null;
    }
    const picked = await sheet({ title, columns: 2, options });
    if (picked == null) return null;
    if (picked === '__none__') return { memberId: null };
    return list.find(p => p.memberId === picked) || null;
  }

  // ── 進球（3 步）─────────────────────────────────────────

  async function flowGoal() {
    const side = await pickSide('哪一隊進球？');
    if (!side) return;

    const player = await pickPlayer(side, { title: '誰進的球？', allowNone: true });
    if (player === null) return;

    const ctx = ctxFor(side);
    const event = buildGoalEvent({ ...ctx, player: player.memberId ? player : null });
    const m = state.match;
    const nextScore = { ...(m.score || { home: 0, away: 0 }) };
    nextScore[side] = (Number(nextScore[side]) || 0) + 1;

    buzz(40);
    // 比分與事件分成兩筆寫入：即使其中一筆失敗，另一筆仍在，
    // 而且失敗的那筆會出現在待重送清單，不會靜靜消失。
    patchMatch(matchId, { score: nextScore }, `比分 ${nextScore.home}:${nextScore.away}`, { kind: 'score' });
    addTimelineEvent(matchId, event, `記錄進球　${player.displayName ? '#' + (player.jerseyNo ?? '') + ' ' + player.displayName : '未指定球員'}`);
    toast(`已記錄進球　${player.displayName ? playerShort(player) : '（未指定球員）'}`, 'success');
  }

  const playerShort = p => `${p.jerseyNo != null ? '#' + p.jerseyNo + ' ' : ''}${p.displayName || p.name || ''}`;

  // ── 出牌（4 步）─────────────────────────────────────────

  async function flowCard() {
    const side = await pickSide('哪一隊的球員？');
    if (!side) return;

    const player = await pickPlayer(side, { title: '哪一位球員？' });
    if (!player?.memberId) return;

    let cardType = await sheet({
      title: `${playerShort(player)} 的卡片`,
      columns: 1,
      options: [
        { value: 'yellow', label: '黃牌', iconName: 'card', iconCls: 'icon--yellow icon--card-fill' },
        { value: 'second_yellow', label: '兩黃換紅', iconName: 'card', iconCls: 'icon--red icon--card-fill' },
        { value: 'red', label: '直接紅牌', iconName: 'card', iconCls: 'icon--red icon--card-fill' }
      ]
    });
    if (!cardType) return;

    // §5.4：同一球員第二張黃牌主動提示
    const s = suggestCardType(state.events, player.memberId, cardType);
    if (s.suggest) {
      const yes = await confirmDialog({
        title: '第二張黃牌',
        body: s.reason,
        confirmText: '記為兩黃換紅',
        cancelText: '仍記為黃牌'
      });
      if (yes) cardType = 'second_yellow';
    }

    const event = buildCardEvent({ ...ctxFor(side), player, cardType });
    buzz([30, 40, 30]);
    addTimelineEvent(matchId, event, `記錄${CARD_LABEL[cardType]}　${playerShort(player)}`);

    if (cardType === 'red' || cardType === 'second_yellow') {
      toast(`${playerShort(player)} 已離場，之後不會出現在可選名單。`, 'warn');
    } else {
      toast(`已記錄 ${CARD_LABEL[cardType]}　${playerShort(player)}`, 'success');
    }
  }

  // ── 換人（4 步）─────────────────────────────────────────

  async function flowSub() {
    const side = await pickSide('哪一隊換人？');
    if (!side) return;

    const limit = state.division?.substitutionLimit ?? null;
    const chk = checkSubLimit(state.events, side, limit);
    if (chk.over) {
      // 超過上限只警示，不阻擋（§5.5：現場規則可能彈性）
      const go = await confirmDialog({ title: '已達換人上限', body: chk.message, confirmText: '仍要換人' });
      if (!go) return;
    }

    const outP = await pickPlayer(side, { title: '誰下場？' });
    if (!outP?.memberId) return;
    const inP = await pickPlayer(side, { title: '誰上場？', exclude: new Set([outP.memberId]) });
    if (!inP?.memberId) return;

    addTimelineEvent(matchId, buildSubEvent({ ...ctxFor(side), outPlayer: outP, inPlayer: inP }),
      `記錄換人　${playerShort(outP)} 下場／${playerShort(inP)} 上場`);
    buzz(30);
    toast(`已記錄換人（本隊第 ${chk.used + 1} 人次）`, 'success');
  }

  // ── 比分直接加減 ───────────────────────────────────────

  function adjustScore(side, delta) {
    const m = state.match;
    const nextScore = { ...(m.score || { home: 0, away: 0 }) };
    const v = (Number(nextScore[side]) || 0) + delta;
    if (v < 0 || v > 99) return;
    nextScore[side] = v;
    buzz(20);
    patchMatch(matchId, { score: nextScore }, `比分 ${nextScore.home}:${nextScore.away}`, { kind: 'score' });
  }

  // ── 計時與期別 ─────────────────────────────────────────

  function startPeriod(period) {
    const m = state.match;
    const clock = startClock(resetClock(m.clock), now());
    patchMatch(matchId, { period, status: statusForPeriod(period), clock },
      `${periodLabel(period, state.division?.periods ?? 2)} 開始`, { kind: 'period' });
    addTimelineEvent(matchId, buildPeriodEvent({ ...ctxFor('home'), period, clockSec: 0, ending: false }),
      `${periodLabel(period, state.division?.periods ?? 2)} 開始`);
  }

  function pause() {
    patchMatch(matchId, { clock: pauseClock(state.match.clock, now()) }, '暫停計時', { kind: 'clock' });
  }

  function resume() {
    patchMatch(matchId, { clock: startClock(state.match.clock, now()) }, '繼續計時', { kind: 'clock' });
  }

  async function endPeriod() {
    const m = state.match;
    const period = m.period;
    const sec = elapsedSec(m.clock, now());
    const tied = (m.score?.home ?? 0) === (m.score?.away ?? 0);
    const drawRule = state.division?.drawRule ?? 'penalty';
    const periods = state.division?.periods ?? 2;
    const next = nextPeriod(period, { tied, drawRule, periods });

    const ok = await confirmDialog({
      title: `結束${periodLabel(period, periods)}？`,
      body: `目前 ${clockText(sec)}，比分 ${m.score?.home ?? 0}:${m.score?.away ?? 0}。`,
      confirmText: '結束本節'
    });
    if (!ok) return;

    addTimelineEvent(matchId, buildPeriodEvent({ ...ctxFor('home'), period, clockSec: sec, ending: true }),
      `${periodLabel(period, periods)} 結束`);

    if (next === 'ft') {
      // 走完賽流程，不直接寫 ft——完賽要跳確認畫面
      await flowFinish();
      return;
    }

    const patch = { period: next, status: statusForPeriod(next), clock: resetClock(m.clock) };
    // 上半場結束時把半場比分固定下來
    if (period === 'h1') patch.htScore = { home: m.score?.home ?? 0, away: m.score?.away ?? 0 };
    patchMatch(matchId, patch, `進入${periodLabel(next, periods)}`, { kind: 'period' });
  }

  // ── 修正事件 ───────────────────────────────────────────

  async function voidFlow(e) {
    const isScoring = ['goal', 'own_goal', 'penalty_scored'].includes(e.type);
    const ok = await confirmDialog({
      title: '作廢這筆事件？',
      body: el('div', {}, [
        el('p', { text: eventText(e) }),
        el('p', { class: 'muted', text: isScoring ? '作廢後比分會一併扣回。原紀錄不會刪除，只會標記作廢。' : '原紀錄不會刪除，只會標記作廢。' })
      ]),
      confirmText: '作廢',
      tone: 'danger'
    });
    if (!ok) return;

    voidTimelineEvent(matchId, e.timelineId, '賽務現場修正', `作廢事件　${eventText(e)}`);

    if (isScoring) {
      const after = scoreFromTimeline(state.events.map(x => x.timelineId === e.timelineId ? { ...x, voided: true } : x));
      patchMatch(matchId, { score: after }, `比分修正為 ${after.home}:${after.away}`, { kind: 'score' });
    }
    writeAudit({
      entity: 'match', entityId: matchId, action: 'timeline.void',
      before: { timelineId: e.timelineId, type: e.type }, reason: '賽務現場修正'
    });
  }

  // ── 完賽送出 ───────────────────────────────────────────

  async function flowFinish() {
    const m = state.match;
    const s = finishSummary({ match: m, events: state.events });

    const body = el('div', { class: 'finish' }, [
      el('p', { class: 'finish__score num', text: `${s.home}　${s.score}　${s.away}` }),
      s.htScore ? el('p', { class: 'finish__ht', text: `半場 ${s.htScore}` }) : null,
      el('p', { class: 'finish__count', text: `事件 ${s.eventCount} 筆` }),
      el('p', { class: `finish__check ${s.consistency.ok ? 'is-ok' : 'is-warn'}` },
        iconText(s.consistency.ok ? 'check' : 'warn', s.consistency.message))
    ].filter(Boolean));

    const ok = await confirmDialog({ title: '確認完賽', body, confirmText: '確認完賽' });
    if (!ok) return;

    const patch = buildFinishPatch({
      score: m.score, htScore: m.htScore, penaltyScore: m.penaltyScore,
      events: state.events, uid: user()?.uid ?? null
    });

    // 用 submitFinish 而不是 patchMatch：它會補上伺服器時間的 scoreSubmittedAt，
    // 三分鐘自撤回的視窗完全靠那個欄位算（rules 分支 D）。
    const { promise } = submitFinish(matchId, patch, `完賽送出　${s.home} ${s.score} ${s.away}`);

    // ⚠️ 不 await 這個 promise 來決定要不要顯示成功。
    //    離線時它永遠不會 resolve，畫面會卡住，賽務會以為當機而重複點擊。
    //    正確做法：立刻顯示「已記錄」，真正的狀態交給右上角的三態燈。
    toast('已記錄完賽。狀態請看右上角：綠燈＝已儲存，黃燈＝待同步。', 'success');
    promise.then(r => {
      if (r.state === 'saved') {
        // 不自動跳回首頁：三分鐘的撤回視窗要留在這一頁才按得到。
        toast('已送出，積分榜更新中。三分鐘內在下方可以自行撤回。', 'success');
        render();
      } else {
        toast(`完賽尚未送出：${r.error?.message ?? ''}`, 'error');
      }
    });
  }

  // router 換頁時呼叫；監聽由 scope 自動回收
  return () => {
    stopTicker?.();
    indicator.destroy();
  };
}
