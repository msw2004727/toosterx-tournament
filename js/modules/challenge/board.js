/**
 * 關卡排行榜 `#/challenge/board/:challengeId`
 * ------------------------------------------------------------------
 * 規格：docs/06 §5.3；驗收 C03（成績送出後 ≤ 5 秒更新）、C09
 *
 * 三件不可協商：
 *   1. **自己不在前 50 時，底部固定顯示自己那一列**（§5.3）。
 *      看不到自己的排行榜對玩家沒有意義——他就是為了看自己才點進來的。
 *   2. **用監聽而不是讀一次。** 玩家常常就站在攤位旁邊等成績跳出來。
 *   3. **排行榜是 Function 產的，這裡只顯示。** 不在前端自己算——
 *      算出來的名次跟別人手機上看到的不一樣，那比沒有排行榜更糟。
 *      （`myRank` 只是在**已經產好的 rows** 上找自己，不是重算。）
 *
 * ⚠️ **分齡榜不做**（主辦 2026-09-05 決定只做總榜）。規格 §5.3 提到
 *    可切換兒童／青少年／成人——現在的 `leaderboards/{id}` 也只有一份
 *    總榜，畫一個切不動的分頁比沒有更糟。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式。
 */

import { el, mount, skeleton } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';
import { formatScore, rankInLadder, attemptMs } from '../../engine/challenge.js';
import * as data from './data.js';
import { savedPass } from './pass.js';

const TOP_N = 50;

export async function challengeBoardPage({ scope, view, params }) {
  const root = el('div', { class: 'chal' });
  mount(view, root);
  mount(root, skeleton(4));

  const challengeId = params.challengeId;
  const pass = savedPass();

  const state = {
    challenge: undefined,        // undefined = 還沒載入；null = 沒這一關
    board: null,
    best: null,                  // 我在這一關的最佳成績
    player: null,
    error: null
  };

  data.getChallenge(challengeId)
    .then(c => { state.challenge = c; render(); })
    .catch(err => { state.error = err; state.challenge = null; render(); });

  data.watchLeaderboard(scope, challengeId,
    b => { state.board = b; render(); },
    err => { state.error = err; render(); });

  // 我自己的最佳成績。不在前 50 名時，名次要靠它 ＋ ladder 算出來
  if (pass) {
    data.getMyBests(pass.playerId)
      .then(list => {
        const b = list.find(x => x.challengeId === challengeId);
        // ⚠️ 時間一律用引擎的 attemptMs——ladder 上的時間就是它算出來的。
        //    這裡換一支（例如 lib 的 toMillis）就可能差一點而排錯名次。
        state.best = b ? { rawValue: b.rawValue, attemptAtMs: attemptMs(b) } : null;
        render();
      })
      .catch(err => console.warn('[challenge] 讀不到最佳成績', err));
    data.watchPlayer(scope, pass.playerId, p => { state.player = p; render(); },
      err => console.warn('[challenge] 讀不到玩家', err));
  }

  // ── 具名函式（會被提升）───────────────────────────────────

  function rows() {
    return Array.isArray(state.board?.rows) ? state.board.rows : [];
  }

  /** 我在前 50 名裡的那一列（不在的話是 null） */
  function mineInTop() {
    if (!pass) return null;
    return rows().find(r => r.playerId === pass.playerId) ?? null;
  }

  /** 我的最佳成績（不管在不在前 50） */
  function myBest() {
    return state.best;
  }

  /**
   * 我的名次。
   *
   * 在前 50 名裡就直接用榜上那一列；不在的話用 `ladder`（只有數字的那一份）
   * 自己算——排行榜文件只存前 50 列，第 51 名之後的人在客戶端沒有別的
   * 東西可以算名次，而那一列正是他點進來的理由（docs/06 §5.3）。
   */
  function myRankNow() {
    const top = mineInTop();
    if (top) return top.rank;
    const b = myBest();
    if (!b) return null;
    return rankInLadder(state.board?.ladder, { value: b.rawValue, attemptAt: b.attemptAtMs }, state.challenge);
  }

  // ── 畫面 ─────────────────────────────────────────────────

  function medal(rank) {
    // ⚠️ 不用 🥇🥈🥉（R-UI-004）。名次本身就是資訊，前三名只加一點強調
    return el('span', {
      class: 'chal__rank', 'data-top': String(Number.isInteger(rank) && rank <= 3),
      text: Number.isInteger(rank) ? String(rank) : '—'
    });
  }

  function boardRow(r, { me = false } = {}) {
    return el('li', { class: 'chal__boardRow', 'data-me': String(me) }, [
      medal(r.rank),
      el('span', { class: 'chal__boardName', text: r.nickname ?? r.playerId ?? '—' }),
      el('span', { class: 'chal__boardValue', text: formatScore(r.value, state.challenge) })
    ]);
  }

  function myLine() {
    if (!pass) {
      return el('div', { class: 'chal__card' }, [
        el('p', { class: 'chal__hint', text: '有挑戰卡才看得到自己的名次。' }),
        el('button', {
          class: 'btn btn--lg btn--primary chal__go', type: 'button',
          onClick: () => navigate('/challenge/join')
        }, iconText('play', '開始挑戰'))
      ]);
    }
    const b = myBest();
    if (!b) {
      return el('div', { class: 'chal__card' }, [
        el('p', { class: 'chal__hint', text: '你還沒挑戰過這一關。' })
      ]);
    }
    const rank = myRankNow();
    // ⭐ 自己不在前 50 時，這一列就是整頁的重點
    return el('div', { class: 'chal__card chal__myLine' }, [
      el('span', { class: 'chal__label', text: '我的成績' }),
      el('ul', { class: 'chal__board' }, boardRow({
        rank,
        nickname: state.player?.nickname ?? pass.nickname ?? pass.playerId,
        value: b.rawValue
      }, { me: true })),
      // 名次算不出來時**說出來**，不要印一個猜的數字
      rank == null
        ? el('p', { class: 'chal__hint', text: '名次還在計算，稍後會出現。' })
        : null
    ].filter(Boolean));
  }

  function render() {
    if (state.challenge === undefined) { mount(root, skeleton(4)); return; }

    if (state.challenge === null) {
      mount(root,
        el('div', { class: 'chal__card chal__card--warn', role: 'alert' }, [
          el('strong', { text: '找不到這一關' }),
          el('button', {
            class: 'btn btn--lg', type: 'button', onClick: () => navigate('/challenge')
          }, iconText('back', '回挑戰區'))
        ]));
      return;
    }

    const c = state.challenge;
    const list = rows().slice(0, TOP_N);
    const meInTop = pass && list.some(r => r.playerId === pass.playerId);

    mount(root,
      el('div', { class: 'chal__hero' }, [
        el('span', { class: 'chal__heroIcon' }, icon(c.icon || 'target')),
        el('strong', { class: 'chal__heroTitle', text: c.name ?? challengeId }),
        c.boothLocation ? el('p', { class: 'chal__heroSub', text: c.boothLocation }) : null
      ].filter(Boolean)),

      c.rulesText
        ? el('div', { class: 'chal__card' }, [
            el('strong', { text: '怎麼玩' }),
            el('p', { class: 'chal__hint', text: c.rulesText })
          ])
        : null,

      list.length === 0
        ? el('div', { class: 'chal__card' }, [
            el('strong', { text: '還沒有人挑戰這一關' }),
            el('p', { class: 'chal__hint', text: '你可以是第一個。' })
          ])
        : el('div', { class: 'chal__card' }, [
            el('div', { class: 'chal__cardHead' }, [
              el('strong', { text: `排行榜（前 ${TOP_N} 名）` }),
              el('span', { class: 'chal__count', text: `${rows().length} 人` })
            ]),
            el('ul', { class: 'chal__board' },
              list.map(r => boardRow(r, { me: !!pass && r.playerId === pass.playerId })))
          ]),

      // 已經在前 50 裡就不用再印一次
      meInTop ? null : myLine(),

      el('button', {
        class: 'btn chal__back', type: 'button', onClick: () => navigate('/challenge')
      }, iconText('back', '回挑戰區'))
    );
  }
}
